/**
 * WebDAV 同步编排（V1.11 · Stage F · F2-core / `docs/plan/v1.11-stage-f.md` §F2）
 *
 * ## 铁律：这里一行合并逻辑都不写
 * 两端谁胜、`lastStudiedAt` 怎么比、settings 怎么并集 —— 全部由既有引擎决定：
 *   - `planMerge(local, remote, now, globals)` 算计划（单调不减，V1.4 · B2）；
 *   - `applyMergePlan` 在**单事务**里落库；
 *   - `executeImport`（`importOrchestrator`）负责"预览 → 执行"的两阶段与写后的缓存刷新。
 * 本文件只做三件新事：**① 打包上传 ② 下载 + 前置校验 ③ 给出冲突三态**。
 *
 * 为什么必须这么老实：V1.4 合并引擎的第一铁律是"单调不减"（谁新谁胜，从不丢行）。
 * 通道层一旦自己"顺手"做一次合并/覆盖，就会冒出第二套口径，
 * 而两套口径分叉的症状（"预览说保持本机，同步完却变了"）在家长的机器上无法复现。
 *
 * ## 复用 `importOrchestrator` 而**不是**另写一份"写后刷新"
 * 数据是绕过 store 直接写进库的，写完之后必须：重读档案列表（否则第二次同步会把
 * 刚进来的档案又当"新档案"）、失效归属索引、重归因 E1、重载 `userData` store。
 * 这四步在 `executeImport` 里已经按正确顺序排好（理由见那个文件的文件头），
 * **`syncManager` 照用就是了** —— 抄一份出来意味着下次修 bug 得改两个地方。
 *
 * ## 冲突三态给谁用
 * UI（F2-UI）要在家长按下"下载"之前告诉她"哪边更新"，并在真正冲突时让她选。
 * 所以这里产出**可断言的三态**（`local-newer` / `remote-newer` / `conflict`），
 * **不弹窗、不做决策、也不修改计划**。注意三态只是"给人看的结论"：
 * 无论她选什么，`planMerge` 的单调不减都成立（典型并发场景是两侧各改了不同的行）。
 */

import { buildBackupV2, readLocalSnapshot } from '@core/backup/bundleIO'
import {
  APP_FORMAT_VERSION,
  isPlanNoop,
  type BackupV2,
  type Bundle,
  type LocalSnapshot,
  type MergePlan,
} from '@core/backup/types'
import {
  bundlesFromV2,
  executeImport,
  globalsFromV2,
  type ImportApplied,
} from '@core/backup/importOrchestrator'
import { routeBackup } from '@core/backup/routeBackup'
import { planMerge } from '@core/merge/mergeBundle'
import { progressKey, progressRank } from '@core/merge/mergeProgress'
import { currentProfileId } from '@core/profile/currentProfile'
import { isTauri } from '@core/pwa/isTauri'
import {
  buildBackupUrl,
  getBackup,
  isWebDavError,
  putBackup,
  statBackup,
  WebDavError,
  type RequestDeps,
  type WebDavConfig,
} from './webdavClient'

// ---------------------------------------------------------------------------
// 冲突三态（纯计算 · UI 消费）
// ---------------------------------------------------------------------------

export type SyncConflictState =
  /** 本机更晚，下载不会动这些行（此刻该做的是把本机传上去） */
  | 'local-newer'
  /** 远端更晚，下载会把这些行搬过来 */
  | 'remote-newer'
  /** 两侧都有更晚的行，或同一行时间戳相同但内容不同 → 需要家长裁决 */
  | 'conflict'
  /** 双方完全一致（含"没有可比的行"） */
  | 'in-sync'

export type SyncRowState = Extract<SyncConflictState, 'local-newer' | 'remote-newer' | 'conflict'>

/** 一行知识点的对比结果 */
export interface SyncRowDiff {
  profileId: string
  packageId: string
  knowledgePointId: string
  /** 本机的排序值（`progressRank`：`lastReviewAt ?? lastStudiedAt`） */
  localAt: string
  remoteAt: string
  row: SyncRowState
}

export interface ConflictReport {
  /** 总判定；UI 只看这一个字段决定给什么文案 */
  state: SyncConflictState
  /** 两边都有的行数（可比对的样本） */
  comparedRows: number
  localNewerRows: number
  remoteNewerRows: number
  /** 时间戳相同但内容不同的行数 —— 时间轴分不出胜负，只能交给人 */
  conflictRows: number
  /** 只有本机有的行（上传后会到远端；下载侧不会碰它们） */
  localOnlyRows: number
  /** 只有远端有的行（下载后会落到本机） */
  remoteOnlyRows: number
  /** 明细，按 `profileId → packageId → knowledgePointId` 排序（确定性输出，便于快照比对） */
  rows: SyncRowDiff[]
}

/** 空报告：还没拿到远端数据时的中性值 */
export function emptyConflictReport(): ConflictReport {
  return {
    state: 'in-sync',
    comparedRows: 0,
    localNewerRows: 0,
    remoteNewerRows: 0,
    conflictRows: 0,
    localOnlyRows: 0,
    remoteOnlyRows: 0,
    rows: [],
  }
}

/**
 * 递归序列化：`id` 剔除、**键序无关**、`undefined` 值忽略。
 *
 * 三处取舍与 `applyMergePlan.rowFingerprint` 同口径（那边的理由写得很细）：
 *   - `id` 是行身份的实现细节，删行重建不该算"内容变了"；
 *   - 两条读取路径（Dexie 读 vs 对象字面量）的键序不保证一致；
 *   - `undefined` 键在 JSON 往返里会消失（同步就得过一次 JSON）。
 * 这里没有把它导出/抬出 `applyMergePlan` 内部实现，是因为那边的 `stableStringify`
 * 服务于"守卫 vs 库里当前值"，语义虽同、用途不同，耦合过去会让两边互相牵制。
 */
function stableText(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    return `{${Object.keys(rec)
      .filter((k) => k !== 'id' && rec[k] !== undefined)
      .sort()
      .map((k) => `${k}:${stableText(rec[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

/**
 * 以时间为基准算出冲突三态。
 *
 * ## 排序值为什么复用 `progressRank` 而不是直接读 `lastStudiedAt`
 * 三态是给家长看的**结论文案**，它必须和 `planMerge` 真正要做的事一致。
 * 而合并用的是 `progressRank`（`lastReviewAt ?? lastStudiedAt`，见 `mergeProgress`）。
 * 这里若另起口径（只看 `lastStudiedAt`），就会出现
 * "系统说是本机更新、点完下载却发现某一行被远端改了" —— 自相矛盾比错误更伤信任。
 * **结论：三态的判据必须与合并引擎同源。**
 *
 * ## 谁能进"三态"
 * 只有**两边都有**的行才参与判定：
 *   - 只有本机有的行：合并不会动它（不存在被覆盖的可能），也不需要决策 → 单独计 `localOnlyRows`；
 *   - 只有远端有的行：合并一定新增 → `remoteOnlyRows`。
 *
 * ## 什么时候算 conflict
 * ① 时间戳相同但内容不同（真正的并发改写，时间轴分不出胜负）；
 * ② 同一份数据里既有本机更晚的行、又有远端更晚的行（两边各自学了自己的部分）。
 * 第 ② 种在数据层面是安全的（逐行谁新谁胜），但对家长意味着"两边都有对方没有的东西"，
 * 必须让她知道，而不是静默合成一份她没见过的样子。
 */
export function classifySyncConflict(
  local: LocalSnapshot,
  remote: readonly Bundle[],
): ConflictReport {
  const localRowsByPid = new Map<string, Map<string, { row: Record<string, unknown>; raw: unknown }>>()
  for (const bundle of local.bundles ?? []) {
    const inner = new Map<string, { row: Record<string, unknown>; raw: unknown }>()
    for (const row of bundle.progress ?? []) {
      inner.set(progressKey(row), {
        row: row as unknown as Record<string, unknown>,
        raw: row,
      })
    }
    localRowsByPid.set(bundle.profileId, inner)
  }

  const comparedKeys = new Set<string>()
  const rows: SyncRowDiff[] = []
  let localNewerRows = 0
  let remoteNewerRows = 0
  let conflictRows = 0
  let localOnlyRows = 0
  let remoteOnlyRows = 0
  let comparedRows = 0

  for (const bundle of remote ?? []) {
    const pid = bundle?.profileId
    if (typeof pid !== 'string' || pid === '') continue
    const localInner = localRowsByPid.get(pid)

    for (const remoteRow of bundle.progress ?? []) {
      const key = progressKey(remoteRow)
      const hit = localInner?.get(key)
      if (!hit) {
        remoteOnlyRows++
        continue
      }
      comparedKeys.add(`${pid}\u0000${key}`)
      comparedRows++

      const localAt = progressRank(hit.row as { lastReviewAt?: string | null; lastStudiedAt?: string })
      const remoteAt = progressRank(remoteRow)
      const base = {
        profileId: pid,
        packageId: remoteRow.packageId,
        knowledgePointId: remoteRow.knowledgePointId,
        localAt,
        remoteAt,
      }

      if (localAt > remoteAt) {
        localNewerRows++
        rows.push({ ...base, row: 'local-newer' })
        continue
      }
      if (localAt < remoteAt) {
        remoteNewerRows++
        rows.push({ ...base, row: 'remote-newer' })
        continue
      }
      // 时间戳相同：内容不同才是冲突；内容相同说明本来就一致，不必惊动任何人
      if (stableText(hit.raw) === stableText(remoteRow)) continue
      conflictRows++
      rows.push({ ...base, row: 'conflict' })
    }
  }

  // 本机有、远端没有的行
  for (const bundle of local.bundles ?? []) {
    for (const row of bundle.progress ?? []) {
      if (!comparedKeys.has(`${bundle.profileId}\u0000${progressKey(row)}`)) localOnlyRows++
    }
  }

  rows.sort(
    (a, b) =>
      a.profileId.localeCompare(b.profileId) ||
      a.packageId.localeCompare(b.packageId) ||
      a.knowledgePointId.localeCompare(b.knowledgePointId),
  )

  let state: SyncConflictState = 'in-sync'
  if (conflictRows > 0 || (localNewerRows > 0 && remoteNewerRows > 0)) state = 'conflict'
  else if (remoteNewerRows > 0) state = 'remote-newer'
  else if (localNewerRows > 0) state = 'local-newer'

  return {
    state,
    comparedRows,
    localNewerRows,
    remoteNewerRows,
    conflictRows,
    localOnlyRows,
    remoteOnlyRows,
    rows,
  }
}

// ---------------------------------------------------------------------------
// 合并前置校验：防跨档案串数据
// ---------------------------------------------------------------------------

export type SyncGuardCode = 'ok' | 'empty-remote' | 'row-profile-mismatch' | 'cross-profile'

/**
 * 前置校验的结果。
 *
 * **刻意做成可辨识联合**：`ok === false` 时 `code` 的类型自动收窄到三种拒绝原因，
 * 于是 `guard.code` 可以直接当 `SyncRejectCode` 用 —— 不需要 `as`，也不会冒出
 * "校验通过却带着拒绝原因"这种不存在的组合让 tsc 放过。
 */
export type SyncGuardResult =
  | { ok: true; code: 'ok'; detail: string; shared: string[]; added: string[] }
  | {
      ok: false
      code: Exclude<SyncGuardCode, 'ok'>
      detail: string
      shared: string[]
      added: string[]
    }

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

/** 三张业务表的中文名（拒绝文案要写"哪张表"，家长才可能看懂） */
const ROW_TABLE_LABEL: Record<'progress' | 'mistakes' | 'examSessions', string> = {
  progress: '学习进度',
  mistakes: '错题本',
  examSessions: '模考记录',
}

/**
 * **合并之前**的档案身份校验。必须在 `planMerge` 之前跑，理由是：
 *
 * `planMerge` 按 `profileId` **分组**，本机没有的 pid 会被当成"新档案"整批建出来
 * （对"导入另一台设备的整个备份"来说，这是正确的语义）。于是一份**别人家的备份**
 * 落到本机时，后果不是报错，而是静默多出一个写着陌生名字的档案，里面全是别人家的进度
 * —— 家长看到的是"孩子的学习记录突然翻倍"，而我们事后无法区分哪条本来是谁的。
 *
 * 三条判据：
 *  ① 远端必须有档案（`empty-remote`）；
 *  ② 行内 `profileId` 必须与所属档案一致（`row-profile-mismatch`）。
 *     `routeBackup` 已经查过一次，但**同步的数据不是只从可信路径来的**：
 *     网盘上的文件可能被别的程序改写过，这一步必须自己再挡一次；
 *  ③ 本机已有档案时，远端必须与本机**至少共享一个 id**（`cross-profile`）。
 *     判据来自 D5「两台设备是同一个孩子」：`profileId` 跨设备恒定，
 *     所以同一家两台设备的备份**必然有交集**；完全不相交只可能是拿错了文件或别人的网盘。
 *     本机一个档案都没有时（全新设备）跳过这条 —— 那时"全部是新档案"正是正确的语义。
 */
export function guardRemoteBundles(
  local: LocalSnapshot,
  remote: readonly Bundle[],
): SyncGuardResult {
  const bundles = (remote ?? []).filter(
    (b) => b && typeof b.profileId === 'string' && b.profileId !== '',
  )
  if (bundles.length === 0) {
    return {
      ok: false,
      code: 'empty-remote',
      detail: '网盘上的这份备份里没有任何档案数据，可能是别的软件写的同名文件。',
      shared: [],
      added: [],
    }
  }

  for (const bundle of bundles) {
    const pid = bundle.profileId
    for (const field of ['progress', 'mistakes', 'examSessions'] as const) {
      for (const row of (bundle[field] ?? []) as Array<{ profileId?: string }>) {
        const rowPid = row?.profileId
        if (typeof rowPid !== 'string' || rowPid === '') {
          return {
            ok: false,
            code: 'row-profile-mismatch',
            detail: `档案 ${pid} 的${ROW_TABLE_LABEL[field]}里有一行缺少档案标识，文件可能被别的程序改过。`,
            shared: [],
            added: [],
          }
        }
        if (rowPid !== pid) {
          return {
            ok: false,
            code: 'row-profile-mismatch',
            detail:
              `档案 ${pid} 的${ROW_TABLE_LABEL[field]}里混着属于 ${rowPid} 的行 —— ` +
              '这可能是别人家的数据，已停止合并（本机一个字节都没有改动）。',
            shared: [],
            added: [],
          }
        }
      }
    }
  }

  const localIds = (local.profiles ?? []).map((p) => p.id)
  const remoteIds = bundles.map((b) => b.profileId)
  const localSet = new Set(localIds)
  const shared = remoteIds.filter((id) => localSet.has(id))
  const added = remoteIds.filter((id) => !localSet.has(id))

  if (localIds.length > 0 && shared.length === 0) {
    return {
      ok: false,
      code: 'cross-profile',
      detail:
        '这份备份里的孩子和本机完全对不上（一个档案标识都不相同），已停止合并 —— ' +
        `本机是 ${sortedUnique(localIds).join('、')}，网盘上是 ${sortedUnique(remoteIds).join('、')}。` +
        '多半是下载到了别人网盘上的同名文件。本机数据一个字节都没有改动。',
      shared: [],
      added: sortedUnique(added),
    }
  }

  return {
    ok: true,
    code: 'ok',
    detail: '',
    shared: sortedUnique(shared),
    added: sortedUnique(added),
  }
}

// ---------------------------------------------------------------------------
// 编排：预览（不写）与执行（写）
// ---------------------------------------------------------------------------

export type SyncRejectCode =
  /** `routeBackup` 判为不可用（too-new / malformed / mismatch / unknown / v1） */
  | 'backup-route'
  /** `planMerge` 拒绝：导入后会超过档案上限（AC-P2-14） */
  | 'profile-limit'
  /**
   * `guardRemoteBundles` 拦下的三种原因。
   *
   * 用 `Exclude` 而不是把三个名字再抄一遍：抄一遍就会出现"多了个种类却没被收入"的窗口，
   * 而 `'ok' 也可能是拒绝原因` 这种不存在的分支正是我们想要 tsc 替我们挡住的。
   */
  | Exclude<SyncGuardCode, 'ok'>

export type SyncOutcome = 'reject' | 'noop' | 'ready'

export interface SyncPreview {
  /** 实际读的那个远端 URL（"到底同步到哪了"只有它说得清） */
  url: string
  /** 判序收死的结果：`reject` → `noop` → `ready`（与 `importOrchestrator` 同口径） */
  outcome: SyncOutcome
  reject?: { code: SyncRejectCode; detail: string }
  /** 冲突三态（供 UI 决策；**不影响**任何写入） */
  state: SyncConflictState
  conflict: ConflictReport
  /**
   * 前置校验结果。**为 `null` 表示还没跑到校验就被版本路由拒绝了** ——
   * 用 `null` 而不是塞一个"看起来通过"的对象，避免 UI 误读。
   */
  guard: SyncGuardResult | null
  /** 可写的计划；被拒绝时为 `null`（不给 UI 任何"会发现几个新档案"的数字） */
  plan: MergePlan | null
  /** 远端备份的导出时间（v2 才有） */
  remoteExportedAt?: string
  /** 远端备份来自哪个版本（**仅展示**，不参与任何判断） */
  remoteAppVersion?: string
}

export interface SyncOptions extends RequestDeps {
  /** 合并用的"当前时间"（`planMerge` 是纯函数，不读时钟）。默认读真实时钟 */
  now?: string
  /** 要同步的档案；缺省用当前档案 */
  profileId?: string
}

/**
 * 桌面端 / 网页端的 CORS 现实 —— 拼进错误文案里，别让家长自己去猜为什么不行。
 *
 * 这不是免责声明，是**这件事的真相**：本仓没有 Rust 侧的 http 插件
 * （`Cargo.toml` 里只有 `tauri-plugin-log`），所以桌面端同样跑在 WebView 的同源策略下。
 * 没验证过就声称支持，是这个项目最忌讳的事。
 */
export function environmentHint(): string {
  return isTauri()
    ? '当前是桌面端：桌面容器本身没有放宽网页的跨域检查，真机直连还需要 Rust 侧的 HTTP 插件放行（已单开任务）。'
    : '当前是网页版（浏览器）：云端网盘默认不给网页放行跨域，这一跳基本必被拦住。'
}

/**
 * 给传输层错误补一句当前环境的实话。
 *
 * 只有 CORS 失败需要补：它是唯一"换种运行环境结论可能不同"的失败类型，
 * 补上这句家长就不会反复重试一个注定失败的请求。
 */
function enrichTransportError(err: unknown): unknown {
  if (isWebDavError(err) && err.code === 'cors') {
    return new WebDavError('cors', `${err.message}${environmentHint()}`, err.cause)
  }
  return err
}

interface RemotePayload {
  bundles: Bundle[]
  globals: Record<string, unknown>
  exportedAt?: string
  appVersion?: string
}

/**
 * 远端 JSON → 可合并且未被污染的输入。
 *
 * 版本判据**只有一处**（`routeBackup`），这里不发明第二套。
 *
 * ## 为什么 v1 在同步里直接拒绝，而不像导入那样用适配器兜住
 * 导入做的是"用户挑了一个文件"，包容遇到的任何老文件是对的；同步做的是
 * "读网盘上那份由本系统自己写出去的文件"，它**只可能是 v2**
 * （这个通道是在 v2 之后才有的，从来不曾写过 v1）。
 * 更关键的是：`routeBackup` 对"没有 formatVersion 的任意 JSON 对象"一律按 v1 处理，
 * 于是网盘上任何一个陌生文件（登录页的 JSON 分支、别的软件的导出）都会被
 * `adaptV1ToBundles` 包成一个 `default` 档案 —— 如果本机恰好也叫 `default`，
 * 它会以"一份空备份"的形态通过前置校验，最后告诉家长"两边已经一致"。
 * 这句话是假的。所以这里明确拒绝，并把人指到能处理老文件的导入通道去。
 */
function adaptRemote(
  json: unknown,
): RemotePayload | { reject: { code: SyncRejectCode; detail: string } } {
  const route = routeBackup(json, APP_FORMAT_VERSION)
  if (route.kind === 'reject') {
    return {
      reject: {
        code: 'backup-route',
        detail: `网盘上这份文件不能用来同步：${route.detail}`,
      },
    }
  }
  if (route.kind === 'v1') {
    return {
      reject: {
        code: 'backup-route',
        detail:
          '网盘上这份是很早以前版本的备份（没有档案信息），本通道不处理它。' +
          '请用新版本导出一份备份再上传一次；那份旧文件仍然可以用「导入文件」直接导入。',
      },
    }
  }
  return {
    bundles: bundlesFromV2(route.data),
    globals: globalsFromV2(route.data),
    exportedAt: route.data.exportedAt,
    appVersion: route.data.appVersion,
  }
}

function rejectPreview(
  url: string,
  code: SyncRejectCode,
  detail: string,
  guard: SyncGuardResult | null,
): SyncPreview {
  return {
    url,
    outcome: 'reject',
    reject: { code, detail },
    state: 'in-sync',
    conflict: emptyConflictReport(),
    guard,
    plan: null,
  }
}

/**
 * 第一阶段：**只下载 + 只算，一个字节都不写**。
 *
 * 顺序刻意为之：下载 → 版本路由 → **前置校验** → 才敢 `planMerge`。
 * 前置校验必须在 `planMerge` 之前：一旦进了 `planMerge`，"本机没有的档案"就被放进计划
 * 里了 —— 那时再拒绝虽然还来得及不写库，但 UI 已经告诉家长"有 3 个新档案"，
 * 那是比拒绝更糟的谎话。
 */
export async function previewPull(
  config: WebDavConfig,
  options: SyncOptions = {},
): Promise<SyncPreview> {
  const { now: nowOption, profileId: profileIdOption, ...deps } = options
  const profileId = profileIdOption ?? currentProfileId()
  const url = buildBackupUrl(config.baseUrl, profileId)

  let remoteJson: unknown
  try {
    remoteJson = (await getBackup(config, profileId, deps)).json
  } catch (err) {
    throw enrichTransportError(err)
  }

  const adapted = adaptRemote(remoteJson)
  if ('reject' in adapted) {
    return rejectPreview(url, adapted.reject.code, adapted.reject.detail, null)
  }

  const local = await readLocalSnapshot()
  const guard = guardRemoteBundles(local, adapted.bundles)
  if (!guard.ok) {
    // ★ 拒绝时**完全不进 planMerge**：不带 plan，也不给任何统计数字
    // 校验失败的原因就是拒绝原因（两个联合里的这三个名字是同一个语义）
  return rejectPreview(url, guard.code, guard.detail, guard)
  }

  const now = nowOption ?? new Date().toISOString()
  const plan = planMerge(local, adapted.bundles, now, adapted.globals)
  const conflict = classifySyncConflict(local, adapted.bundles)
  const meta = {
    ...(adapted.exportedAt ? { remoteExportedAt: adapted.exportedAt } : {}),
    ...(adapted.appVersion ? { remoteAppVersion: adapted.appVersion } : {}),
  }

  // 判序与 `importOrchestrator.resolveOutcome` 同口径：**先 reject 再 noop**。
  // 颠倒的后果写在那个文件里 —— 家长会把"备份被拒绝"读成"没有新内容"，
  // 于是既不去处理原因，也不会换一份文件。
  if (plan.reject) {
    return {
      url,
      outcome: 'reject',
      reject: { code: 'profile-limit', detail: plan.reject.detail },
      state: conflict.state,
      conflict,
      guard,
      plan: null,
      ...meta,
    }
  }

  return {
    url,
    outcome: isPlanNoop(plan) ? 'noop' : 'ready',
    state: conflict.state,
    conflict,
    guard,
    plan,
    ...meta,
  }
}

/**
 * 第二阶段：**写**。
 *
 * 写入 + 写后刷新全部委托给 `executeImport`（内部是 `applyMergePlan` 的单事务），
 * 本文件不自己碰 db —— 理由见文件头第二段。
 *
 * @throws 预览为 `reject` / `noop` 时抛出（没有任何东西可写）。
 */
export async function executePull(preview: SyncPreview): Promise<ImportApplied> {
  if (preview.outcome !== 'ready' || !preview.plan) {
    throw new Error(
      preview.reject
        ? `这次同步没有写入任何数据：${preview.reject.detail}`
        : '这次同步两边已经一致，没有需要写入的变化。',
    )
  }
  return executeImport(preview.plan)
}

/** 一步到位：预览 + 执行（UI 的默认走法） */
export async function pullSync(
  config: WebDavConfig,
  options: SyncOptions = {},
): Promise<{ preview: SyncPreview; applied: ImportApplied | null }> {
  const preview = await previewPull(config, options)
  if (preview.outcome !== 'ready') return { preview, applied: null }
  return { preview, applied: await executePull(preview) }
}

export interface PushResult {
  url: string
  profileId: string
  bytes: number
  /** 本次打包的导出时间 */
  exportedAt: string
  /** 打包进去的档案数（备份内容是全家的快照，文件按当前孩子命名） */
  profileCount: number
}

/**
 * 上传：打包（**复用 `buildBackupV2`，绝不自己组装 JSON**）→ PUT。
 *
 * 为什么内容是"全档案快照"、文件名却按当前孩子命名：
 *   - 内容必须是全家的（`buildBackupV2` 逐档案读，少任何一个都会让另一台设备缺数据）；
 *   - 文件名标识"这份是哪边的最后状态"，两台设备可在同一目录里各存一份互不冲突，
 *     而下载侧由 `guardRemoteBundles` 兜住跨档案的风险。
 */
export async function pushBackup(
  config: WebDavConfig,
  options: SyncOptions = {},
): Promise<PushResult> {
  const { profileId: profileIdOption, ...deps } = options
  const profileId = profileIdOption ?? currentProfileId()
  const backup: BackupV2 = await buildBackupV2()
  try {
    const res = await putBackup(config, profileId, backup, deps)
    return {
      url: res.url,
      profileId,
      bytes: res.bytes,
      exportedAt: backup.exportedAt,
      profileCount: backup.profiles.length,
    }
  } catch (err) {
    throw enrichTransportError(err)
  }
}

/** 网盘上有没有这份备份（UI 用它在"首次上传"前给正确的提示） */
export async function remoteExists(
  config: WebDavConfig,
  options: SyncOptions = {},
): Promise<boolean> {
  const { profileId: profileIdOption, ...deps } = options
  const profileId = profileIdOption ?? currentProfileId()
  try {
    return (await statBackup(config, profileId, deps)).exists
  } catch (err) {
    throw enrichTransportError(err)
  }
}
