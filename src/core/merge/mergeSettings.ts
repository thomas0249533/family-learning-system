/**
 * 跨设备合并 · 分片 settings（V1.4 · B2 / `system_design-v1.4.md` §6.3）
 *
 * ## 为什么登记在 `PROFILE_SCOPED_KEYS` 里的键必须**逐个**写规则
 * 它们的**语义各不相同**，用一条通用规则（比如"取更晚"或"取远端"）必然有一半是错的：
 *   - 徽章集合 → 并集（少一个 = 抹掉孩子的成就）
 *   - 打卡天数 → 逐字段 max（整对象取一边会出现 current > longest 或 longest 倒退）
 *   - 每日题量 → 逐字段 max（少算 = 今天的成就不达标）
 *   - 折叠状态 → 本机优先（纯界面态，跨设备合并没有意义）
 *   - "总结卡看过了" → 逻辑或（看过就是看过）
 *   - 自定义包勾选 → 本版**明确不合并**（理由见 `SKIP_REASONS`）
 *
 * 这里刻意**不写"共 N 个键"**：键数会随版本变（V1.4–B3 就把 8 变成了 9），
 * 写在注释里的数字只会变成下一个人的绊脚石。数字的唯一真相是 `PROFILE_SCOPED_KEYS`，
 * 而"每个键都有归属"由 `RULES` 的 `Record` 穷尽性在编译期保证。
 *
 * ## 值形状一律从真源读，不在这里猜
 * 每个键的形状定义在它自己的模块里（`core/motivation/*` 的读写函数）。
 * 这里直接 import 它们的 normalize 函数，**没有第二套口径** ——
 * 合并器里手写的 `{ questions, seconds }` 和真源里的 `{ questionCount }` 一旦不一致，
 * 症状是"导入后今日题量归零"，而且类型检查抓不到（settings 的 value 是 `unknown`）。
 *
 * ## 结果与现值逐字节相同就不写
 * 这是幂等（AC-P2-13）的另一半前提：`planMerge(merged, remote)` 必须产出空计划。
 * 若每次导入都把分片键原样重写一遍，`noop` 永远是 false，UI 会一直弹"发现新数据"。
 */

import type { SettingRecord } from '@/db'
import {
  PROFILE_SCOPED_KEYS,
  scopedKey,
  type ProfileScopedBase,
} from '@core/profile/settingsScope'
import {
  normalizeRepeatCount,
  normalizeRepeatPeriod,
  normalizeUnlocked,
  type UnlockedRecord,
} from '@core/motivation/achievements'
import {
  normalizeDiscoveryState,
  type DiscoveryState,
} from '@core/motivation/achievementDiscovery'
import { EMPTY_STREAK, type StreakState } from '@core/motivation/streak'
import type { DailyStat } from '@core/motivation/dailyStats'
import { normalizeBlindBoxState } from '@core/motivation/blindBox'

export interface SettingsMergeOutcome {
  /** 键是**全名**（`dailyStats:p1`），可直接 `settings.put` */
  upserts: SettingRecord[]
  /** 值发生变化、需要写库的键数 */
  changed: number
  /** 远端有值但本机胜出（或结果与现值相同）的键数 */
  keptLocal: number
  /** `achievements` 并集后**新增**的徽章 id 数（UI 文案「N 枚新成就」） */
  achievementsAdded: number
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** JSON 逐字节比较：判断"要不要写库"的唯一依据（见文件头最后一段） */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    // 循环引用之类（不该出现在 settings 里）：当作"不同"，宁可多写一次也别漏写
    return false
  }
}

/** 去重并集，保持本机顺序在前（顺序稳定 = JSON 比较稳定 = 幂等） */
function unionStrings(localRaw: unknown, remoteRaw: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const src of [localRaw, remoteRaw]) {
    if (!Array.isArray(src)) continue
    for (const v of src) {
      if (typeof v !== 'string' || v === '') continue
      if (seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/** 两个 ISO 日期取更晚（空串最小 = "从没发生过"） */
function laterDay(a: string, b: string): string {
  return a > b ? a : b
}

// ---------------------------------------------------------------------------
// achievements：按 id 取并集，unlockedAt 取更早
// ---------------------------------------------------------------------------

/**
 * 解锁日期的合并：**非空优先，其次更早**。
 *
 * 规则（V1.4 裁决，2026-06）：
 *   - 两边都非空 → 取更早（更早那次才更接近真实解锁时刻）；
 *   - 只有一边非空 → 取**非空**那侧；
 *   - 都为空 → `''`。
 *
 * 为什么不是简单的字符串比较（`'' < 任意非空`）：`''` 的语义是"旧数据不知道日期"，
 * **"未知"不能覆盖"已知"**。若按字符串比较，只要有一台设备是老数据，
 * 导入后那个徽章的真实日期就会永久变成空 —— 这不是风格问题，是真丢数据。
 * 同向证据：仓库自己的写入口 `saveUnlocked()` 用的是 `prev.unlockedAt || r.unlockedAt`
 * （同样优先非空），两处口径必须一致，否则"本机写的"和"导入来的"会互相打架。
 *
 * `evidence` 仍是本机非空则保留本机：证据是**解锁瞬间固化的一句话事实**，
 * 两台设备的证据指向同一次解锁，保留本机的可避免无意义的行重写。
 */
function earlierUnlockStamp(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

/** 取较晚的周键（周键定宽 `WYYYY-MM-DD`，字符串序即时间序） */
function laterRepeatPeriod(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a >= b ? a : b
}

function mergeAchievements(
  localRaw: unknown,
  remoteRaw: unknown,
): { value: UnlockedRecord[]; addedIds: number } {
  const local = normalizeUnlocked(localRaw)
  const remote = normalizeUnlocked(remoteRaw)

  const map = new Map<string, UnlockedRecord>()
  for (const r of local) if (!map.has(r.id)) map.set(r.id, { ...r })

  let addedIds = 0
  for (const r of remote) {
    const prev = map.get(r.id)
    if (!prev) {
      map.set(r.id, { ...r })
      addedIds++
      continue
    }
    const merged: UnlockedRecord = {
      id: prev.id,
      unlockedAt: earlierUnlockStamp(prev.unlockedAt, r.unlockedAt),
    }
    const evidence = prev.evidence || r.evidence
    if (evidence) merged.evidence = evidence
    // 重复次数取**较大**（V1.4 · B6 / 设计稿 R11）。
    // 与 `unlockedAt` 方向相反：日期要"最早那次"（第一次拿到），次数要"最多那次"。
    // 这一条是 B6 的 DoD —— 加字段不补规则，跨设备导入会把重复次数抹成单次，且无告警。
    // 注意 `?? 1`：老记录没有这个字段 = 只达成过一次。
    const repeat = Math.max(normalizeRepeatCount(prev.repeatCount) ?? 1, normalizeRepeatCount(r.repeatCount) ?? 1)
    if (repeat >= 2) merged.repeatCount = repeat
    // 幂等锚点取**较晚**（V1.5）。必须与 `repeatCount` 一起取 max，否则合并不自洽：
    // 假设本机本周已计入（锚点 W43、3 次），远端是上周的旧备份（锚点 W42、2 次），
    // 只取 count 的 max 会得到"3 次 + 锚点 W42" —— 合并后第一次结算就发现
    // "本周还没记过"，于是同一周又 +1，变成 4 次。两个字段方向必须一致。
    const period = laterRepeatPeriod(
      normalizeRepeatPeriod(prev.lastRepeatPeriod),
      normalizeRepeatPeriod(r.lastRepeatPeriod),
    )
    if (period) merged.lastRepeatPeriod = period
    // `repeatBase` **有意不合并**（V1.5）。它是 grow 型卡的"本机看到过的最后一个指标值"，
    // 不是事实：另一台设备的游标指向的是它在**它的**数据上看到的值，搬过来算增量没有意义。
    // 合并后本机第一次结算会重新落基线（`base === undefined` 分支），最多丢一周的增量；
    // 而随便挑一边合进来，会造出"明明没做到却又 +1"这种没法解释的记录。
    map.set(r.id, merged)
  }

  return { value: [...map.values()], addedIds }
}

// ---------------------------------------------------------------------------
// dailyStats：按 date 对齐，题量与时刻各自取"更多"
// ---------------------------------------------------------------------------

/** 形状见 `core/motivation/dailyStats.ts` 的 `DailyStat` */
function toCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 时刻归零 / 非法 → 视为"没有记录"（0 不是合法的 epoch ms） */
function toStamp(v: unknown): number {
  const n = toCount(v)
  return n > 0 ? n : 0
}

/**
 * 专注时长（V2.8 · C1）：缺失 / 0 / 脏值 → `undefined`（**保留"没有"的语义**，
 * 不补 0 —— 老 JSON 里没有这个字段，合并后也不该凭空长出 `focusMinutes: 0`）。
 */
function toFocusMinutes(v: unknown): number | undefined {
  const n = toCount(v)
  return n > 0 ? Math.round(n * 10) / 10 : undefined
}

function normalizeDailyStats(raw: unknown): DailyStat[] {
  if (!Array.isArray(raw)) return []
  const out: DailyStat[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const rec = item as Partial<DailyStat> | null
    if (!rec || typeof rec !== 'object') continue
    if (typeof rec.date !== 'string' || rec.date === '') continue
    if (seen.has(rec.date)) continue
    seen.add(rec.date)
    const focus = toFocusMinutes(rec.focusMinutes)
    out.push({
      date: rec.date,
      questionCount: toCount(rec.questionCount),
      firstStudyAt: toStamp(rec.firstStudyAt),
      lastStudyAt: toStamp(rec.lastStudyAt),
      ...(focus !== undefined ? { focusMinutes: focus } : {}),
    })
  }
  // 按日期升序：与 `flushDailyStats()` 的落盘顺序一致，保证 JSON 比较稳定
  out.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0))
  return out
}

/**
 * 每日统计合并：`questionCount` 取 max（**少算就是抹掉孩子的今日成就**），
 * `firstStudyAt` 取 min、`lastStudyAt` 取 max（"最早"与"最晚"各取极端，才留得住
 * 「闻鸡起舞 / 挑灯夜读」这两枚徽章的判定依据）；
 * `focusMinutes` 取 max（V2.8 · C1：两侧都没有时不落字段，与归一化口径一致）。
 */
function mergeDailyStats(localRaw: unknown, remoteRaw: unknown): DailyStat[] {
  const local = normalizeDailyStats(localRaw)
  const remote = normalizeDailyStats(remoteRaw)
  const map = new Map<string, DailyStat>()
  for (const s of local) map.set(s.date, s)

  for (const r of remote) {
    const prev = map.get(r.date)
    if (!prev) {
      map.set(r.date, r)
      continue
    }
    const first = prev.firstStudyAt > 0 && r.firstStudyAt > 0
      ? Math.min(prev.firstStudyAt, r.firstStudyAt)
      : Math.max(prev.firstStudyAt, r.firstStudyAt)
    const focus = Math.max(prev.focusMinutes ?? 0, r.focusMinutes ?? 0)
    map.set(r.date, {
      date: r.date,
      questionCount: Math.max(prev.questionCount, r.questionCount),
      firstStudyAt: first,
      lastStudyAt: Math.max(prev.lastStudyAt, r.lastStudyAt),
      ...(focus > 0 ? { focusMinutes: focus } : {}),
    })
  }

  return [...map.values()].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0))
}

// ---------------------------------------------------------------------------
// studyStreak：lastDate 取更晚，current / longest 分别取 max
// ---------------------------------------------------------------------------

function normalizeStreak(raw: unknown): StreakState {
  const rec = raw as Partial<StreakState> | null
  if (!rec || typeof rec !== 'object') return { ...EMPTY_STREAK }
  return {
    current: toCount(rec.current),
    longest: toCount(rec.longest),
    lastDate: typeof rec.lastDate === 'string' ? rec.lastDate : '',
  }
}

/**
 * 打卡合并：**`current` 与 `longest` 必须分别取 max**。
 *
 * 整对象按一个字段取（比如"lastDate 更晚的那台整个胜出"）会出两种错：
 *   - 另一台 `current` 更大 → 孩子看到的天数倒退；
 *   - 另一台 `longest` 更大 → 历史最佳倒退（最刺眼的一处，因为那是"记录"）。
 */
function mergeStreak(localRaw: unknown, remoteRaw: unknown): StreakState {
  const l = normalizeStreak(localRaw)
  const r = normalizeStreak(remoteRaw)
  return {
    current: Math.max(l.current, r.current),
    longest: Math.max(l.longest, r.longest),
    lastDate: laterDay(l.lastDate, r.lastDate),
  }
}

// ---------------------------------------------------------------------------
// achievement:discovery：机会取 max、线索取并集、发放日取更晚
// ---------------------------------------------------------------------------

/**
 * 发现机制状态（形状见 `core/motivation/achievementDiscovery.ts`）。
 *
 * - `revealed` 取并集：看过就算看过，取交集会让谜面合上；
 * - `chances` 取 max：**剩余机会是"已经发到手里的东西"**，取 min 等于凭空没收；
 * - `streakWithoutNew` 取 max：这是保底计数器，取小会让保底重新开始（等于让孩子白抽）；
 * - `lastGrantDay` 取更晚：防止同一天重复发机会。
 * 四条都是"单调不减"的方向，合并后再合一次不会变，幂等自动成立。
 */
function mergeDiscovery(localRaw: unknown, remoteRaw: unknown): DiscoveryState {
  const l = normalizeDiscoveryState(localRaw)
  const r = normalizeDiscoveryState(remoteRaw)
  return {
    v: 1,
    chances: Math.max(l.chances, r.chances),
    revealed: unionStrings(l.revealed, r.revealed),
    streakWithoutNew: Math.max(l.streakWithoutNew, r.streakWithoutNew),
    lastGrantDay: laterDay(l.lastGrantDay, r.lastGrantDay),
  }
}

// ---------------------------------------------------------------------------
// 逐键规则登记表
// ---------------------------------------------------------------------------

/** 标记：本版**明确不合并**这个键（理由见 `SKIP_REASONS`） */
const SKIP = Symbol('settings-merge-skip')

interface SettingRule {
  /** 本机值 + 备份值 → 合并结果 */
  merge(localRaw: unknown, remoteRaw: unknown): unknown
  /** 比较用视图：把本机现值归一化后再与合并结果比，避免格式差异导致每次都重写 */
  view(localRaw: unknown): unknown
}

/** 纯界面态 / 家长开关：本机有值就绝不让备份覆盖 */
const LOCAL_FIRST: SettingRule = {
  merge: (localRaw, remoteRaw) => (localRaw !== undefined ? localRaw : remoteRaw),
  view: (localRaw) => localRaw,
}

/**
 * ⚠️ 本模块**唯一的登记表**。
 *
 * `Record<ProfileScopedBase, …>` 的穷尽性由 `tsc` 兜底：`PROFILE_SCOPED_KEYS` 里新增一个键
 * 而这里不登记，**编译直接失败**。
 *
 * 为什么不能继续用 `switch`（这是 V1.4–B3 的真实教训）：B3 把 `customChecks` 登记进
 * `PROFILE_SCOPED_KEYS` 时，`switch` 只是"少一个 case"，运行时安静地返回 `undefined`，
 * 被下游当成"本机缺失"跳过 —— 一个"新功能没接上合并"的缺陷，**没有任何报错**。
 * `Record` 把这类遗漏提前到第一道门禁。加 `default` 也不行：`default` 会把
 * "漏登记"变成"永远不报错"，比不加更糟。
 */
const RULES: Record<ProfileScopedBase, SettingRule | typeof SKIP> = {
  achievements: {
    merge: (localRaw, remoteRaw) => mergeAchievements(localRaw, remoteRaw).value,
    view: normalizeUnlocked,
  },
  dailyStats: { merge: mergeDailyStats, view: normalizeDailyStats },
  studyStreak: { merge: mergeStreak, view: normalizeStreak },
  'achievement:discovery': { merge: mergeDiscovery, view: normalizeDiscoveryState },
  attemptedTypes: {
    merge: (localRaw, remoteRaw) => unionStrings(localRaw, remoteRaw),
    view: (localRaw) => unionStrings(localRaw, undefined),
  },
  'achievement:collectionSeen': {
    // 逻辑或：看过就算看过。远端看过而本机没见过 → 结果是 true，写进去
    merge: (localRaw, remoteRaw) => localRaw === true || remoteRaw === true,
    view: (localRaw) => localRaw === true,
  },
  achievementUi: LOCAL_FIRST,
  'achievement:discoveryEnabled': LOCAL_FIRST,
  // 盲盒（V2.8 · C2）：owned 并集（本机序优先，两端各开出的都是"已拥有"的事实）、
  // usedDays 并集后排序（防刷只查"今天在不在里面"，顺序只为 JSON 稳定）。
  blindBox: {
    merge: (localRaw, remoteRaw) => {
      const local = normalizeBlindBoxState(localRaw)
      const remote = normalizeBlindBoxState(remoteRaw)
      const owned = [...local.owned]
      for (const id of remote.owned) if (!owned.includes(id)) owned.push(id)
      const usedDays = [...new Set([...local.usedDays, ...remote.usedDays])].sort()
      return { owned, usedDays }
    },
    view: normalizeBlindBoxState,
  },
  customChecks: SKIP,
  // 每日目标（V3.0 · M1）：偏好类，本机优先。两端设了不同目标时没有"更正确"的一边，
  // 按"谁在用谁说了算"处理（换设备后如果本机没设过，自然取远端的）。
  dailyGoal: LOCAL_FIRST,
  // 今日队列（V3.0 · M1）：也是本机优先，且**过期自动失效** ——
  // 远端搬来的队列日期不是今天就由 `isPlanStale` 判掉并重算，
  // 所以这里不需要做"两台设备同一天的队列合并"（那会把两边的完成项混在一起）。
  dailyPlan: LOCAL_FIRST,
}

/**
 * 本版**明确不合并**的分片键 → 理由（理由不能为空，测试会检查）。
 *
 * `customChecks`（B3 自定义成就包的手动勾选）为什么不合并：
 * 勾选的对象是**自定义包的内容**，而 `achievement:customPacks` 是 `GLOBAL_NEVER_MERGE`
 * （包是设备级资产，内容不在数据备份里，见 `mergeBundle.ts` 头部注释）。
 * 更关键的是：`planMerge` 是**纯函数，看不到 `db.packages`**，因此它无法判断
 * "这台设备上到底有没有那个包"。盲写会有一半概率产出**孤儿勾选**
 * （有勾选、没有对应的包），等用户下次真把包搬过来时会"凭空多出几个勾"——
 * 比不导更让人困惑，也更难排查。
 *
 * 终态（V1.5 包进备份、或勾选改成独立表）：「按键取并集、`at` 取更早」——
 * 那时把 `customChecks` 从 `SKIP` 换成一个正常规则即可，其余代码一行不用动。
 */
export const SKIP_REASONS: Partial<Record<ProfileScopedBase, string>> = {
  customChecks:
    '勾选对象是自定义包内容，而包不在数据备份里；planMerge 看不到 db.packages，盲写会产出孤儿勾选',
}

/** 这个键是否属于"本版明确不合并"（`mergeSettings` 与 `planMerge` 的折叠都要先问它） */
export function isSkippedBase(base: ProfileScopedBase): boolean {
  return RULES[base] === SKIP
}

/**
 * 单个分片键的合并规则。
 *
 * 「本机缺失」（`localRaw === undefined`）时按空值参与合并，
 * 于是"本机优先"的两条规则（`achievementUi` / `achievement:discoveryEnabled`）
 * 会自然退化为"远端有就取远端"，不需要额外分支。
 *
 * 返回 `undefined` 只可能来自被跳过的键 —— 调用方应先过 `isSkippedBase()`。
 */
export function mergeSettingValue(
  base: ProfileScopedBase,
  localRaw: unknown,
  remoteRaw: unknown,
): unknown {
  const rule = RULES[base]
  if (rule === SKIP) return undefined
  return rule.merge(localRaw, remoteRaw)
}

/** 比较用的"本机视图"：把脏数据归一化后再比，避免格式差异导致每次都重写 */
function localViewOf(base: ProfileScopedBase, localRaw: unknown): unknown {
  const rule = RULES[base]
  return rule === SKIP ? localRaw : rule.view(localRaw)
}

/**
 * 合并一个档案的**全部分片键**（`PROFILE_SCOPED_KEYS`，逐键规则见 `RULES`）。
 *
 * @param local        本机现值（基名 → 值，已剥掉 `:<pid>` 后缀）
 * @param remote       备份里的值（同上）
 * @param profileId    输出键要拼回去的档案 id（**导入时不重写**，仍是备份里那个）
 */
export function mergeSettings(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  profileId: string,
): SettingsMergeOutcome {
  const outcome: SettingsMergeOutcome = {
    upserts: [],
    changed: 0,
    keptLocal: 0,
    achievementsAdded: 0,
  }

  for (const base of PROFILE_SCOPED_KEYS) {
    // 本版明确不合并的键（`SKIP_REASONS` 有理由）：**在计数之前**就跳过。
    // 若让它走到下面的 `merged === undefined` 分支，`keptLocal` 会多计 1，
    // 预览里的"本机保留 N 项"就会虚高，而用户没有任何办法理解多出来的那 1 项是什么。
    if (isSkippedBase(base)) continue

    // 备份里根本没有这个键 → 什么都没发生，不计数（同样会让预览数字虚高）
    if (!(base in remote) || remote[base] === undefined) continue

    const localRaw = local[base]
    const remoteRaw = remote[base]

    if (base === 'achievements') {
      // 新徽章数要单独拿：它是 UI 文案「N 枚新成就」的唯一来源
      const { value, addedIds } = mergeAchievements(localRaw, remoteRaw)
      outcome.achievementsAdded += addedIds
      if (sameValue(value, localViewOf(base, localRaw))) {
        outcome.keptLocal++
        continue
      }
      outcome.upserts.push({ key: scopedKey(base, profileId), value })
      outcome.changed++
      continue
    }

    const merged = mergeSettingValue(base, localRaw, remoteRaw)
    if (merged === undefined) {
      // 两边都没有可写的值：不写，避免往库里塞 undefined
      outcome.keptLocal++
      continue
    }
    if (sameValue(merged, localViewOf(base, localRaw))) {
      outcome.keptLocal++
      continue
    }
    outcome.upserts.push({ key: scopedKey(base, profileId), value: merged })
    outcome.changed++
  }

  return outcome
}
