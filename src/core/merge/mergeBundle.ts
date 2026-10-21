/**
 * 跨设备合并 · 总装（V1.4 · B2 / `system_design-v1.4.md` §6）
 *
 * ## 这个文件的全部职责
 * 把「本机现状 + 若干份备份」翻译成**一张写入清单**（`MergePlan`），然后停手。
 * 不写库、不读时钟、不产生随机 —— 这三条是 200 组属性测试能在几毫秒内跑完的前提，
 * 也是"预览"（给家长看要导入多少条）与"确认"（真正写）能共用同一份逻辑的原因：
 * 两次算出来的计划必须逐字节相同，否则家长看到的数字和实际写入的不是一回事。
 *
 * ## 档案上限为什么在这里判、而且是整笔拒绝
 * AC-P2-14：导入后会超过 `MAX_PROFILES`（4）时**整笔取消**，不做部分导入。
 * 部分导入是更坏的选择：家长看到"导入成功 3 个档案"，但漏掉的那个档案
 * 恰恰是老二最近的进度，而系统不会告诉他漏了哪个。整笔拒绝至少是**可解释**的。
 *
 * ## `profileId` 导入时不重写（D5「两台设备是同一个孩子」）
 * 跨设备的语义是"同一个孩子换了设备"，所以 pid 必须原样搬。
 * 重写 pid（比如"导入时总是落进当前档案"）会把两个孩子并成一个人，且事后无法区分。
 * 新档案的 `name` / `createdAt` 取备份里的值；**已有档案的 name 保持本机** ——
 * 家长在本机改的名字是本机意图，不该被一份旧备份改回去。
 */

import type { ExamSessionRecord, MistakeRecord, ProgressRecord } from '@/db'
import {
  isPlanNoop,
  emptyPlan,
  type Bundle,
  type LocalSnapshot,
  type MergePlan,
} from '@core/backup/types'
import { MAX_PROFILES } from '@core/profile/profileTypes'
import { PROFILE_SCOPED_KEYS, classifyKey } from '@core/profile/settingsScope'
import {
  mergeProgress,
  progressKey,
  type ProgressMergeOutcome,
} from './mergeProgress'
import { mergeMistakes, mistakeKey } from './mergeMistakes'
import { mergeSessions, sessionKey } from './mergeSessions'
import { isSkippedBase, mergeSettingValue, mergeSettings } from './mergeSettings'

/**
 * 全局键里**绝不合并**的两个：
 *   - `profiles`：档案列表由 `applyMergePlan` 按 `newProfiles` 精确追加，不走通用路径；
 *   - `achievement:customPacks`：自定义成就包是**设备级资产**（包内容不在数据备份里，
 *     见 types.ts 对 `BackupV2` 的注释）。合并它等于产出"启用了但内容不在本机"的假卡片，
 *     图鉴里会出现永远无法解锁的剪影 —— 比不导入糟糕得多。
 */
const GLOBAL_NEVER_MERGE = new Set<string>(['profiles', 'achievement:customPacks'])

/** 把一行的 `profileId` 强制成所属档案：**外层是权威归属** */
function stampProfile<T extends { profileId: string }>(rows: readonly T[], pid: string): T[] {
  return rows.map((row) => ({ ...row, profileId: pid }))
}

/** 防御未类型化的 JSON：备份可能被人工编辑过，字段缺失时按空数组处理 */
function rowsOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/** 按 key 覆盖或追加（只在折叠多份远端备份时用，不进库） */
function upsertByKey<T>(target: T[], upserts: readonly T[], keyOf: (row: T) => string): void {
  const at = new Map<string, number>()
  target.forEach((row, i) => at.set(keyOf(row), i))
  for (const row of upserts) {
    const k = keyOf(row)
    const i = at.get(k)
    if (i === undefined) {
      at.set(k, target.length)
      target.push(row)
    } else {
      target[i] = row
    }
  }
}

/**
 * 把同一档案的多份远端备份折叠成一份。
 *
 * 正常路径下每份备份里一个 pid 只出现一次，这个折叠是"零成本"的；
 * 但它挡住了两种真实情况：家长把同一份备份导了两次（文件名不同），
 * 或者手工拼接过备份。不折叠的话，两份备份会各自与本机比较，
 * 产生**同一个 key 的两条 upsert**，最终哪一条生效取决于写入顺序 —— 不可复现。
 */
function foldBundles(pid: string, bundles: readonly Bundle[]): Bundle {
  const progress: ProgressRecord[] = []
  const mistakes: MistakeRecord[] = []
  const examSessions: ExamSessionRecord[] = []
  const settings: Record<string, unknown> = {}

  for (const bundle of bundles) {
    const p: ProgressMergeOutcome = mergeProgress(
      progress,
      stampProfile(rowsOf<ProgressRecord>(bundle.progress), pid),
    )
    upsertByKey(progress, p.upserts, progressKey)

    const m = mergeMistakes(mistakes, stampProfile(rowsOf<MistakeRecord>(bundle.mistakes), pid))
    upsertByKey(mistakes, m.upserts, mistakeKey)

    const s = mergeSessions(
      examSessions,
      stampProfile(rowsOf<ExamSessionRecord>(bundle.examSessions), pid),
    )
    upsertByKey(examSessions, s.upserts, sessionKey)

    const raw = (bundle.settings ?? {}) as Record<string, unknown>
    for (const base of PROFILE_SCOPED_KEYS) {
      // 明确不合并的键（如 `customChecks`，理由见 mergeSettings 的 `SKIP_REASONS`）：
      // 在折叠阶段就丢掉，别让它以 `undefined` 值的形式占住 key 位置
      if (isSkippedBase(base)) continue
      if (!(base in raw) || raw[base] === undefined) continue
      settings[base] = mergeSettingValue(base, settings[base], raw[base])
    }
  }

  const head = bundles[0]
  return {
    profileId: pid,
    name: head?.name ?? '',
    createdAt: head?.createdAt ?? '',
    progress,
    mistakes,
    examSessions,
    settings,
  }
}

/** 按 pid 分组，保持备份里的首次出现顺序（计划必须是确定性的） */
function groupBundles(remote: readonly Bundle[]): Map<string, Bundle[]> {
  const out = new Map<string, Bundle[]>()
  for (const bundle of remote) {
    if (!bundle || typeof bundle.profileId !== 'string' || bundle.profileId === '') continue
    const list = out.get(bundle.profileId)
    if (list) list.push(bundle)
    else out.set(bundle.profileId, [bundle])
  }
  return out
}

/**
 * 算出"要写什么"。
 *
 * 计划里除了"要写什么"，还带一份 `stalenessGuard`（plan 生成时**本机行的基线**）。
 * 它只是 `local` 的投影，**不影响 planMerge 的纯度**（仍然无时钟、无 db、无随机）；
 * 用途与三个取舍见 `applyMergePlan` 文件头的「A6 · L2 陈旧快照守卫」。
 *
 * @param local  本机现状（在事务**外**读好，见 §6.4）
 * @param remote 备份内容（一个档案一份）
 * @param now    调用方传入的时间戳，仅用作缺失 `createdAt` 时的兜底 ——
 *               纯函数不许自己读时钟
 * @param remoteGlobals 备份里的**全局键**现值。**必填，故意不给默认值**：
 *               漏传会让"全局键搬不过来"这件事发生在用户机器上且没有任何告警，
 *               而本项目最忌讳的失败模式就是"漏搬"（数据消失，用户察觉不到）。
 *               宁可让忘记传的调用方在 `vue-tsc` 阶段就炸；确实没有全局键的场景
 *               请显式传 `{}`（意图写清楚：本次导入不看全局键）。
 *
 *               为什么不把全局键并进 `LocalSnapshot`（那样签名就不用加参数）：
 *               `Bundle` 必须是**单档案**结构，`LocalSnapshot` 与 `Bundle[]` 的
 *               "同构"是 §6.2 的核心前提（同一个合并函数跑两边）。把不属于任何
 *               档案的全局键塞进 local，这个前提就失效了，而且会诱导后来者
 *               在 `Bundle` 上也加一个 `globalSettings` 字段。
 */
export function planMerge(
  local: LocalSnapshot,
  remote: Bundle[],
  now: string,
  remoteGlobals: Record<string, unknown>,
): MergePlan {
  const plan = emptyPlan()

  const remoteByPid = groupBundles(remote ?? [])
  const localProfiles = new Map((local.profiles ?? []).map((p) => [p.id, p]))
  const localBundles = new Map((local.bundles ?? []).map((b) => [b.profileId, b]))

  // ---- 1. 新档案（本机没有的 pid）----
  for (const [pid, bundles] of remoteByPid) {
    if (localProfiles.has(pid)) continue
    const head = bundles[0]
    const name = String(head?.name ?? '').trim()
    plan.newProfiles.push({
      id: pid,
      name: name || pid,
      createdAt: String(head?.createdAt ?? '') || now,
    })
  }

  // ---- 2. 档案上限（AC-P2-14：超限整笔拒绝，其余字段保持空）----
  const projected = localProfiles.size + plan.newProfiles.length
  if (projected > MAX_PROFILES) {
    // 注意 `stats.noop` 在这里仍为 true（`emptyPlan()` 的默认值），且与 `isPlanNoop()`
    // 保持一致 —— 拒绝计划确实"一个字都不会写"。**调用方必须先看 `reject` 再看 `noop`**，
    // 否则会把这个失败显示成"没有发现新数据"，用户完全不知道自己的备份被拒了。
    return {
      ...emptyPlan(),
      reject: {
        reason: 'profile-limit',
        detail:
          `导入后会超过档案上限：本机已有 ${localProfiles.size} 个档案，` +
          `备份里还有 ${plan.newProfiles.length} 个本机没有的档案，` +
          `合计 ${projected} 个 > 上限 ${MAX_PROFILES} 个。` +
          '数据一行都没有写入。请先导出并删除一个本机档案，或换一份只含现有档案的备份。',
      },
    }
  }
  plan.stats.profilesAdded = plan.newProfiles.length

  // ---- 3. 逐档案合并三张表 + 全部分片键（键的真相是 PROFILE_SCOPED_KEYS）----
  for (const [pid, bundles] of remoteByPid) {
    const localBundle = localBundles.get(pid)
    const folded = foldBundles(pid, bundles)

    // A6 · L2 陈旧快照守卫的**本机基线**：plan 生成时这些行长什么样。
    // 为什么用 Map 而不是数组 find：同一 key 可能出现多行（脏数据），Map 取最后一行，
    // 与 `mergeProgress` 自我收敛后的"胜者"一致 —— 否则基线记的是被合并器丢掉的那行，
    // apply 时会拿它跟库里的胜者比，误报"有新记录"。
    const localProgressByKey = new Map(
      (localBundle?.progress ?? []).map((r) => [progressKey(r), r] as const),
    )
    const localMistakesByKey = new Map(
      (localBundle?.mistakes ?? []).map((r) => [mistakeKey(r), r] as const),
    )

    const progress = mergeProgress(localBundle?.progress ?? [], folded.progress)
    plan.progressUpserts.push(...progress.upserts)
    plan.stats.progressAdded += progress.added
    plan.stats.progressKeptLocal += progress.keptLocal

    // 守卫基线只记"plan 真的要写的行"：没写的行 apply 时也不会碰它，
    // 记了只会让计划变大（要 JSON 往返、要过 structured clone）。
    // 用 `?? null` 而不是 `??=`：本机没有这一行时基线是 `null`（"快照时不存在"），
    // 到 apply 时它突然出现同样是"有新记录"，必须中止（见 StalenessGuard 注释）。
    for (const row of progress.upserts) {
      const k = progressKey(row)
      let bucket = plan.stalenessGuard.progress[row.profileId]
      if (!bucket) {
        bucket = {}
        plan.stalenessGuard.progress[row.profileId] = bucket
      }
      bucket[k] = localProgressByKey.get(k) ?? null
    }

    const mistakes = mergeMistakes(localBundle?.mistakes ?? [], folded.mistakes)
    plan.mistakeUpserts.push(...mistakes.upserts)
    plan.stats.mistakesAdded += mistakes.added
    plan.stats.mistakesKeptLocal += mistakes.keptLocal

    for (const row of mistakes.upserts) {
      const k = mistakeKey(row)
      let bucket = plan.stalenessGuard.mistakes[row.profileId]
      if (!bucket) {
        bucket = {}
        plan.stalenessGuard.mistakes[row.profileId] = bucket
      }
      bucket[k] = localMistakesByKey.get(k) ?? null
    }

    const sessions = mergeSessions(localBundle?.examSessions ?? [], folded.examSessions)
    plan.sessionUpserts.push(...sessions.upserts)
    plan.stats.sessionsAdded += sessions.added
    plan.stats.sessionsKeptLocal += sessions.keptLocal

    const settings = mergeSettings(localBundle?.settings ?? {}, folded.settings, pid)
    plan.settingUpserts.push(...settings.upserts)
    plan.stats.settingsChanged += settings.changed
    plan.stats.settingsKeptLocal += settings.keptLocal
    plan.stats.achievementsAdded += settings.achievementsAdded
  }

  // ---- 4. 全局键：本机存在即保留，本机缺失才写入 ----
  for (const [key, value] of Object.entries(remoteGlobals)) {
    if (value === undefined) continue
    if (GLOBAL_NEVER_MERGE.has(key)) continue
    // 只搬"登记在册的全局键"。分片键（哪怕是 legacy 无后缀形态）与未知键一律跳过：
    // 前者该走 mergeSettings 才能拼出 `<base>:<pid>`，后者可能来自别的版本，
    // 盲目写进去等于往库里塞一个当前代码不认识的东西。
    if (classifyKey(key).kind !== 'global') continue
    if ((local.globalSettings ?? {})[key] !== undefined) {
      plan.stats.settingsKeptLocal++
      continue
    }
    plan.settingUpserts.push({ key, value })
    plan.stats.settingsChanged++
  }

  // ---- 5. noop 用 isPlanNoop 算，别自己数数组长度（两套口径必然分叉）----
  plan.stats.noop = isPlanNoop(plan)
  return plan
}
