/**
 * 导入编排：**预览（只算）** 与 **执行（只写）** 两个阶段（V1.4 · B2 / `system_design-v1.4.md` §6.1、§8.3）
 *
 * ## 为什么必须是两阶段
 * PRD 要求"导入前先告诉用户会发生什么"（AC-P2-12/13/14：新增多少、保持本机多少、
 * 整份无变化、超档案上限要整笔拒绝）。这些数字只能来自"先算一遍"。
 * 如果做成一步（边算边写），用户看到统计时数据已经进库了 —— "取消"按钮就成了摆设。
 *
 * ## 事务边界（本项目最容易被破坏的一条）
 * **所有 db 写入只发生在 `applyMergePlan` 内部的那一个事务里**。
 * 编排层自己绝不写表，理由：
 *   1. 部分写入的备份是最糟的状态 —— 用户以为导入失败了，实际进了一半，
 *      再导一次又可能因为"本机更新"规则而丢掉另一半；
 *   2. 合并计划可以整笔拒绝（AC-P2-14 档案超限），只有在单事务里才可能"一行都不写"。
 *
 * ## 导入后为什么要重读缓存
 * 数据是绕过 store 写进库的（直接 put），所以：
 *   - 归属索引（进程内 Map）还停留在导入前的包列表上 → 先失效再重建；
 *   - `progress` 里可能带着"写入时无法归属"的行，包导入后能救回来 → `ensureE1Migrated`；
 *   - `userData` store 的 ref 还是旧数组 → `loadUserData()` 重读。
 * 这三步都**不是**"切档案"语义，所以不调 `resetForProfileSwitch`（那会重置成就 toast 队列
 * 与档案级缓存的状态机，把用户正在看的东西清掉）。
 *
 * ## E1 · "备份引用了本机没装的包"只是**提示**（V1.6）
 * v2 备份按设计不含 `packages`（包是设备级资产）。于是导入之后，行全在库里，
 * 挂它的包却不在 —— 家长看到的就是"专项练习进度丢了"。
 * 这里**只把它算出来告诉家长**（`missingPackages`），不动任何一行数据，
 * 也不让 `outcome` 变成 `reject`：缺包是"下一步去做的事"，不是"这份备份不能导"。
 * 详见 `missingPackages.ts` 文件头。
 */

import { getActivePinia } from 'pinia'
import { db } from '@/db'
import {
  collectMissingPackageIds,
  countRowsForPackages,
  type PackageRefRow,
} from './missingPackages'
import { ensureOwnerIndex, invalidateOwnerIndex } from '@core/progress/ownerIndexCache'
import { ensureE1Migrated } from '@core/storage/migrateV3Recovery'
import { useUserDataStore } from '@core/stores/userData'
import { initProfile, isProfileInitialized, refreshProfilesFromDb } from '@core/profile/currentProfile'
import { classifyKey } from '@core/profile/settingsScope'
import { planMerge } from '@core/merge/mergeBundle'
import { applyMergePlan } from '@core/merge/applyMergePlan'
import { readLocalSnapshot } from './bundleIO'
import { routeBackup } from './routeBackup'
import { adaptV1ToBundles } from './v1Adapter'
import {
  APP_FORMAT_VERSION,
  isPlanNoop,
  type BackupRoute,
  type BackupV2,
  type Bundle,
  type LocalSnapshot,
  type MergePlan,
} from './types'

/** `executeImport` 的返回值：字段名与 `ImportPreview` 的统计一一对应 */
export interface ImportApplied {
  progress: number
  mistakes: number
  sessions: number
  settings: number
  profiles: number
  /** 写入的手动完成标记条数（V3.0 · M4 起随备份搬运） */
  marks: number
  /**
   * 实际写进库的那些行里，属于"本机没装的包"的包 id（升序去重）。
   *
   * 与预览态的区别：预览按**备份里**的行算（含"本机更新、保持本机"的行），
   * 这里按**真正写下去**的行算 —— 完成提示要说的是"刚才发生了什么"。
   */
  missingPackages: string[]
  /** `missingPackages` 牵连的行数（完成提示要报"几条记录"） */
  missingPackageRows: number
}

/**
 * 预览结论：拒绝 / 无变化 / 可导入。
 *
 * **UI 只读这个字段**（`views/settings/ImportPreview.vue`）。之所以要编排层给出结论、
 * 而不是让 UI 自己看 `route` / `plan.stats`：判序写错一次，"备份被拒"就会显示成
 * "没有发现新数据"，而这两句话对家长的含义**完全相反**（一个要换文件，一个不用管）。
 */
export type ImportOutcome = 'reject' | 'noop' | 'ready'

export interface ImportPreview {
  /** 版本路由结果（`kind === 'reject'` 时 UI 直接展示 `detail`） */
  route: BackupRoute
  /** `route` 不是 v1/v2 时为 `null`（没有可合并的东西） */
  plan: MergePlan | null
  /** 已适配、准备合并的数据（v1 会被包成单个 `default` 档案） */
  bundles: Bundle[]
  /** 本机现状；拒绝时也尽量给（UI 可展示"本机有几个档案"），但读库失败为 `null` */
  local: LocalSnapshot | null
  /** 判序收死：`reject`（含 `plan.reject` 档案超限）→ `noop` → `ready`，见 `resolveOutcome` */
  outcome: ImportOutcome
  /**
   * 备份数据引用了、但本机 `db.packages` 里没有的学习包 id（升序去重）。
   *
   * 这些行会**照常入库**（合并引擎单调不减，绝不因为包不存在而丢行），
   * 但在对应的包被导入之前，`/learn` 的列表里看不到它们 —— 家长报的
   * "专项练习进度丢了"就是这个（详见 `missingPackages.ts` 文件头）。
   *
   * 读库失败时为 `[]`：缺包是**警告**，不是拒绝。
   */
  missingPackages: string[]
  /** 备份里属于 `missingPackages` 的行数（给家长的文案要报"几条记录"） */
  missingPackageRows: number
}

/**
 * 从 `route` + `plan` 得出结论。**判序不许改**：
 *
 * `plan.reject` 非空时 `stats.noop` **仍然是 `true`** —— 这不是 bug，是合并引擎为了让
 * `noop === isPlanNoop(plan)` 自洽而做的选择（拒绝计划确实零写入）。
 * 所以**必须先判 `reject` 再判 `noop`**：
 *   - 先判 reject：家长看到"这份备份会让档案超过 4 个，导入被拒绝"；
 *   - 若反过来先判 noop：家长看到"本机已有全部数据，没有发现新内容" ——
 *     他既不会去删档案，也不会想到换一份备份，问题被这句话永久掩盖。
 */
function resolveOutcome(route: BackupRoute, plan: MergePlan | null): ImportOutcome {
  if (route.kind === 'reject') return 'reject'
  if (plan?.reject) return 'reject'
  if (!plan) return 'noop'
  if (plan.stats.noop || isPlanNoop(plan)) return 'noop'
  return 'ready'
}

/** 全零结果（noop / 拒绝时用，避免各处自己拼字面量） */
function zeroApplied(): ImportApplied {
  return {
    progress: 0,
    mistakes: 0,
    sessions: 0,
    settings: 0,
    profiles: 0,
    marks: 0,
    missingPackages: [],
    missingPackageRows: 0,
  }
}

/**
 * 本机装了哪些包 —— 只要 id。
 *
 * 用 `toArray()` 而不是更省的 `toCollection().primaryKeys()`：后者在单测替身里
 * 没有实现（`tests/helpers/fakeDexie.ts` 只做到表级方法），而 E1 这条链路
 * 必须能被单测直接覆盖。代价是把包体（含题目）整包读进内存 ——
 * 导入是一次性路径，且 `ensureOwnerIndex()` / `packageStore.loadPackages()` 早就在
 * 做同样的事，这里没有引入新的内存量级。
 *
 * @throws 读库失败照抛，由调用方决定降级成"没有缺失"还是别的。
 */
async function readLocalPackageIds(): Promise<ReadonlySet<string>> {
  const rows = await db.packages.toArray()
  const ids = new Set<string>()
  for (const row of rows) {
    const id = row?.packageId
    if (typeof id === 'string' && id !== '') ids.add(id)
  }
  return ids
}

/**
 * 备份里所有带 `packageId` 的行。
 *
 * 只取 `progress` 与 `mistakes`：这两张表是"学习记录"，也是家长会看的
 * （进度卡 / 错题卡都按包渲染）。`examSessions` 的模考记录不进学习列表，
 * 它的包缺失另有语义，本轮不碰。
 */
function packageRefRowsOf(bundles: readonly Bundle[]): PackageRefRow[] {
  const rows: PackageRefRow[] = []
  for (const bundle of bundles) {
    for (const row of bundle.progress) rows.push(row)
    for (const row of bundle.mistakes) rows.push(row)
  }
  return rows
}

/**
 * v2 文档 → `Bundle[]`。
 *
 * 与 `v1Adapter` 相反的方向：把**全名** settings 键（`dailyStats:p1`）剥成基名，
 * 因为合并函数只认识基名（`Bundle` 契约）。归属是确定的（就是所属 profile），
 * 所以这不是"猜"，是格式转换。`routeBackup` 已经保证不会出现后缀指向别的档案的键。
 */
export function bundlesFromV2(doc: BackupV2): Bundle[] {
  return doc.profiles.map((profile) => {
    const settings: Record<string, unknown> = {}
    const suffix = `:${profile.profileId}`

    for (const row of profile.settings) {
      if (!row || typeof row.key !== 'string' || row.key === '') continue
      const scope = classifyKey(row.key)
      if (scope.kind === 'global') {
        // 全局键在 `globalSettings` 里，不属于任何档案（塞进 Bundle 会被合并函数丢掉）
        continue
      }
      if (scope.kind === 'profile' || scope.kind === 'profile-legacy') {
        settings[scope.base] = row.value
        continue
      }
      // unknown：能剥掉本档案后缀就剥（备份文件里未知键通常也带后缀）
      const base = row.key.endsWith(suffix) ? row.key.slice(0, -suffix.length) : row.key
      if (base) settings[base] = row.value
    }

    return {
      profileId: profile.profileId,
      name: profile.name,
      createdAt: profile.createdAt,
      progress: profile.progress,
      mistakes: profile.mistakes,
      examSessions: profile.examSessions,
      // 老备份文件没有这个字段（V3.0 之前不导出）→ 按"没有标记"处理，不拒收
      cardCompletions: Array.isArray(profile.cardCompletions) ? profile.cardCompletions : [],
      settings,
    }
  })
}

/**
 * 备份里的**全局键**现值（`planMerge` 的第 4 个参数，**必填**）。
 *
 * 为什么要单独走一条路：`Bundle` 只描述单个档案（`types.ts` 契约），全局键
 * （`fls:theme` / `achievement:audit` …）没有地方可挂。不带过去的话，
 * 新设备恢复备份后主题、审计日志全部丢失 —— 而三张表的数据都在，
 * 用户会以为"备份不完整"。
 *
 * **为什么 v1 传 `{}`**：v1 时代没有 `globalSettings` 这一层结构，`LegacyFlat.settings`
 * 是一堆未分类的键值对（真实的 v1 全量备份里混着 `profiles`、`achievement:customPacks`、
 * 甚至迁移标记）。把它们当全局键搬过去，等于让一份"可能被手工编辑过的旧文件"
 * 直接改写本机的档案列表/成就包配置 —— 那是"换设备"的语义，不是"合并"的语义。
 * v1 里真正该恢复的东西（进度、错题、登记过的分片键）适配器已经全部接过来了；
 * 主题这类纯偏好不 restore 也不会丢数据。**有意为之，不是漏搬。**
 *
 * V1.11 · F2-core：`syncManager` 也用它取全局键。同步是"同一个家的两台设备"，
 * 与导入同语义（偏好类键要带过去），所以共用这一个函数而不是再写一份 ——
 * 全局键是哪一层结构只应该有这一个地方知道。
 */
export function globalsFromV2(doc: BackupV2): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of doc.globalSettings) {
    if (!row || typeof row.key !== 'string' || row.key === '') continue
    out[row.key] = row.value
  }
  return out
}

/**
 * 第一阶段：**只算不写**。
 *
 * @param json 已 `JSON.parse` 的备份内容
 * @param now 合并时要用的"当前时间"（`planMerge` 是纯函数，不读时钟）。
 *   默认取真实时钟；测试传固定值即可得到确定的计划。
 */
export async function previewImport(json: unknown, now?: string): Promise<ImportPreview> {
  const route = routeBackup(json, APP_FORMAT_VERSION)

  if (route.kind === 'reject') {
    return {
      route,
      plan: null,
      bundles: [],
      local: null,
      outcome: resolveOutcome(route, null),
      missingPackages: [],
      missingPackageRows: 0,
    }
  }

  const bundles =
    route.kind === 'v1' ? adaptV1ToBundles(route.data) : bundlesFromV2(route.data)
  // v1 显式传 `{}`（见 globalsFromV2 上方注释），v2 传真实全局键
  const globals = route.kind === 'v1' ? {} : globalsFromV2(route.data)

  const local = await readLocalSnapshot()
  const plan = planMerge(local, bundles, now ?? new Date().toISOString(), globals)

  // E1：备份引用了但本机没装的包。**只提示、不参与判序**（见文件头末段）：
  // 读库失败 → `[]`，警告宁可不出现，也不能把 outcome 变成 reject ——
  // "这份备份不能导"与"导完之后还得去装个包"是两件完全不同的事。
  const localPackageIds = await readLocalPackageIds().catch(() => null)
  const refRows = packageRefRowsOf(bundles)
  const missingPackages = localPackageIds
    ? collectMissingPackageIds(refRows, localPackageIds)
    : []
  const missingPackageRows =
    missingPackages.length > 0 ? countRowsForPackages(refRows, missingPackages) : 0

  return {
    route,
    plan,
    bundles,
    local,
    outcome: resolveOutcome(route, plan),
    missingPackages,
    missingPackageRows,
  }
}

/**
 * 第二阶段：**只写**（写入全部发生在 `applyMergePlan` 的单事务里）。
 *
 * @throws 计划带 `reject`（档案超限）时抛出，且**一行都不写**。
 */
export async function executeImport(plan: MergePlan): Promise<ImportApplied> {
  // AC-P2-14：整笔拒绝。放在最前面 —— 任何写动作之前。
  if (plan.reject) {
    const err = new Error(plan.reject.detail) as Error & { code?: string }
    err.code = plan.reject.reason
    throw err
  }

  // AC-P2-13：整份备份没有新增 → **零写入**（不调 apply，连空事务都不开）
  if (plan.stats.noop || isPlanNoop(plan)) return zeroApplied()

  // ⚠️ 规范化成"纯对象"再写库。
  //
  // 调用方（设置页）把 `previewImport()` 的结果放在 Vue 的 `ref` 里，**深层代理**会让
  // `plan.progressUpserts[i]` 等变成 Proxy；而 Proxy **不能被 structured clone**，
  // Dexie 的 `put()` 会抛 `DataCloneError: #<Object> could not be cloned`。
  // 这不是理论风险：B2 的真机 e2e 第一次跑就是这个错误（页面显示"未导入任何数据"）。
  //
  // 为什么在 core 兜而不是只改 UI：`executeImport` 是对外 API，将来任何把计划塞进
  // 响应式容器（或包了类实例）的调用方都会踩同一个坑，而报错发生在**写库那一刻**、
  // 文案又完全不指向根因。导入是一次性路径，一次 JSON 往返的代价可忽略。
  //
  // ⚠️ 约束：这一步要求**记录是 JSON-safe 的**。JSON 往返是**有损**的 ——
  // `Date` 会变 ISO 字符串、`Set`/`Map` 变 `{}`、值为 `undefined` 的键被丢掉、
  // `BigInt` 直接抛。当前 `src/db/index.ts` 的时间字段全是 `string`（`createdAt` /
  // `lastStudiedAt` / `answeredAt` …），所以今天无损。**若将来给某张表加 `Date` 字段，
  // 必须改成显式序列化**，否则日期会被静默写成字符串（比 DataCloneError 更难查：它不报错）。
  const plain: MergePlan = JSON.parse(JSON.stringify(plan))

  // 写入全部发生在这里（`applyMergePlan` 自己开单事务）。
  // 计数用它的**实际写入结果**而不是计划的数组长度：万一将来 apply 做了二次去重，
  // 用户看到的数字仍然是"真的写了几条"。
  const applied = await applyMergePlan(plain)

  // ---- 让"今日队列"失效（V3.0 · M1/M4 的接缝）----
  //
  // 队列是**当天冻结**的（同日重排会让每做完一项顺序就变，孩子会晕）。
  // 但导入/恢复改变了进度与错题的**全集**：昨天排的"复习 3 题"可能已经不需要了，
  // 而新导进来的到期卡、待攻克错题根本没进队列。所以这里必须主动失效一次。
  //
  // 为什么放在 `core` 而不是 UI：恢复快照（`autoSnapshot.restoreSnapshot`）、
  // 设置页导入、将来的同步下行走的都是 `executeImport` 这一个入口 ——
  // 让每个调用方各自记得去失效，迟早漏一个，而漏掉的症状是
  // "导入了但今天没任务"，安静得没有任何报错（本轮的 e2e 主闭环就是这么抓到的）。
  //
  // 动态 import：`dailyPlanService` 依赖 db 与 stores，静态引入会让这个纯逻辑层
  // 在单测/启动早期被拖进一整套依赖。失败一律吞掉（队列失效不成功最多是今天还用旧队列）。
  try {
    const { invalidateDailyPlan } = await import('@core/plan/dailyPlanService')
    await invalidateDailyPlan()
  } catch (e) {
    console.warn('[backup] 导入后使今日队列失效失败（今日页可能仍显示旧队列）', e)
  }

  // ---- 以下都是"重新读一遍"，不写业务表 ----

  // ① 档案列表可能刚被 apply 写过（新档案）。`currentProfile` 模块持有一份内存状态，
  // 不重读的话：新档案在 UI 里不存在、`readLocalSnapshot()` 读不到它 →
  // **第二次导入又会把它当成"新档案"**（幂等直接失效）。
  //
  // 用 `refreshProfilesFromDb()` 而不是 `initProfile()`：后者会给已初始化的模块
  // **再写一次库**，而且不 emit → 顶栏切换器要 reload 才看得到新档案，
  // 家长导入完回到首页会以为导入失败。只有在尚未初始化（启动前就被调用）时才退回它。
  if (plan.newProfiles.length > 0) {
    try {
      if (isProfileInitialized()) await refreshProfilesFromDb()
      else await initProfile()
    } catch (e) {
      console.warn('[backup] 导入后重读档案列表失败（档案已落库，重启后可见）', e)
    }
  }

  // ② 归属索引是进程内缓存，包列表可能在别处变过；导入的数据里也有老入口包 id
  invalidateOwnerIndex()
  await ensureOwnerIndex()

  // 备份里的包可能晚于数据行被导入 → 按**当前**包列表再归因一次。
  // 失败只告警：数据已经进来了，归因不收敛只是统计口径问题，不该让用户看到"导入失败"。
  try {
    await ensureE1Migrated({ orphanOnly: true })
  } catch (e) {
    console.warn('[backup] 导入后重归因失败（数据已导入，仅归因未收敛）', e)
  }

  // store 的 ref 还是旧数组。没有 pinia（单测 / 启动期）就跳过 —— 不能因为"刷新 UI"
  // 把一次成功的导入变成异常。
  if (getActivePinia()) {
    try {
      await useUserDataStore().loadUserData()
    } catch (e) {
      console.warn('[backup] 导入后重读 userData store 失败（数据已入库）', e)
    }
  }

  // E1：完成提示要说"刚才写进去的行里，有几条挂在没装的包上"。
  // 按**实际写入的行**算（`plan` 的 upserts），而不是备份里的全部行 ——
  // "本机更新、保持本机"的那部分没被写进来，不该出现在完成提示里。
  // 读库失败同样降级为"没有缺失"：它只是提示，失败不该让导入看起来有问题。
  const localPackageIds = await readLocalPackageIds().catch(() => null)
  const writtenRows: PackageRefRow[] = [...plan.progressUpserts, ...plan.mistakeUpserts]
  const missingPackages = localPackageIds
    ? collectMissingPackageIds(writtenRows, localPackageIds)
    : []
  const missingPackageRows =
    missingPackages.length > 0 ? countRowsForPackages(writtenRows, missingPackages) : 0

  return {
    progress: applied.progress,
    mistakes: applied.mistakes,
    sessions: applied.sessions,
    settings: applied.settings,
    profiles: applied.profiles,
    marks: applied.marks,
    missingPackages,
    missingPackageRows,
  }
}

/**
 * 一步到位：预览 + 执行。**预览显示无变化时不执行**（AC-P2-13 的用户可见面）。
 *
 * 拒绝（`route.kind === 'reject'` 或 `plan.reject`）**不抛异常**：
 * 调用方拿到 `applied: false` 后从 `route.detail` / `plan.reject.detail` 取文案展示。
 * 只有 `applyMergePlan` 自己失败才抛 —— 那时数据状态是未知的，必须让调用方知道。
 */
export async function importBackupFile(
  json: unknown,
  now?: string
): Promise<ImportPreview & { applied: boolean; detail: ImportApplied }> {
  const preview = await previewImport(json, now)
  const plan = preview.plan

  // 结论直接用 `outcome`（判序只写一处，见 `resolveOutcome`）：
  // 这里若自己再排一次 reject / noop，就会有两套口径 —— 而 UI 读的是 `outcome`，
  // 两边一旦分叉，用户的按钮状态与点击后的行为会对不上。
  if (preview.outcome === 'reject' || preview.outcome === 'noop' || !plan) {
    return { ...preview, applied: false, detail: zeroApplied() }
  }

  const applied = await executeImport(plan)
  // `applied` 以**实际写入条数**为准：计划说"有 3 条"，但若 apply 侧做了二次去重一条都没写，
  // 报 `true` 会让 UI 弹出"导入成功"，而用户看到的数据没有任何变化。
  const written =
    applied.progress +
    applied.mistakes +
    applied.sessions +
    applied.settings +
    applied.profiles +
    // V3.0 · M4：只带过来几条手动标记也是一次真实导入（否则会报"未导入任何数据"）
    applied.marks
  return { ...preview, applied: written > 0, detail: applied }
}
