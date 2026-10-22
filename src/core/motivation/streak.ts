/**
 * 体验激励 · 连续学习天数（streak）
 *
 * 教育心理学里，"每日坚持"这件事本身对习惯养成的贡献，比单次学多少更大。
 * 所以这里记录的是"有没有打开来做"（打卡），而不是"做了多少题"。
 *
 * 注意：刻意用**本地日期**做键，不用 toISOString()。
 * 后者按 UTC 算，中国时区下晚上 8 点之后会被算成第二天，连续天数会莫名其妙断掉。
 */
import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'

export interface StreakState {
  /** 当前连续天数 */
  current: number
  /** 历史最长连续天数 */
  longest: number
  /** 最后一次学习日期 YYYY-MM-DD（本地） */
  lastDate: string
  /**
   * 补签额度（V1.6 · Stage C · C5，见文件末尾「补签」一节）。省略 = 没补过。
   *
   * **为什么挂在打卡状态里，而不是另开一个 settings 键**：
   * 1. `settingsScope.ts` 那张键表是迁移 / 跨设备合并 / 导出三处的唯一真相。
   *    新登记一个键，就同时要求「写一条合并语义」并改三处门禁断言
   *    （`profile-scope` 的键数、`settings-keys` 的访问点计数、`merge-settings`
   *    的归属列表）—— 而补签额度是**本机的月度便利额度**，不是孩子的事实数据，
   *    不值得进那套账（对照 `customChecks` 最终被裁决为 SKIP 的先例）。
   * 2. 额度与连续天数必须**一次 put 落盘**。分成两行写会出现
   *    「连续天数恢复了、额度没扣」（可无限补签）或反过来的半截状态。
   *
   * 已知代价：跨设备导入时 `mergeSettings` 的 `studyStreak` 规则只归一化
   * current / longest / lastDate，本字段会被丢掉 → 当月额度重置一次。
   * 这点代价远小于"多一个键要维护三套账"，且方向是"多给家长一次机会"，不会误伤。
   */
  repair?: RepairState
}

export const STREAK_KEY = 'studyStreak'

/** 当前档案的连续天数键。漏分片的表现是"打卡天数突然归零"，最刺眼。 */
export function streakKey(profileId: string = currentProfileId()): string {
  return scopedKey(STREAK_KEY, profileId)
}

export const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastDate: '' }

// ---------------------------------------------------------------------------
// 补签额度（V1.6 · Stage C · C5）
// ---------------------------------------------------------------------------

/** 每月可补签的次数。**1 次**，不累积、不跨月（PRD §11.1 / §11.6）。 */
export const REPAIR_QUOTA_PER_MONTH = 1

/**
 * 补签计数。
 *
 * `month` 是**本地自然月** `YYYY-MM`（不是 `YYYY-MM-DD`、更不是 UTC 月），
 * 只有「当月用满几次」这一个作用，用来做跨月自动重置。
 */
export interface RepairState {
  /** 本地自然月 `YYYY-MM`；`''` = 从没用过 */
  month: string
  /** 该月已用次数 */
  used: number
}

export const EMPTY_REPAIR: RepairState = { month: '', used: 0 }

/**
 * 补签计数的**语义基名**。
 *
 * ⚠️ 它**不是**一个独立的 settings 键：补签计数就存在打卡那一行里
 * （`streakKey()`，见 `StreakState.repair` 的注释）。保留这个常量是为了让
 * "补签额度"在库里有一句可读的名字，日志 / 注释 / 未来若真拆行时有据可查。
 */
export const REPAIR_KEY = 'studyStreakRepair'

/**
 * 补签计数所在的 settings 键。
 *
 * 与 `streakKey()` **同键**（理由见 `StreakState.repair`）。签名保留 `profileId`
 * 形参，是为了让调用点与 `loadStreak(profileId?)` 保持同一种书写习惯，
 * 将来若真要拆成独立行，改这一个函数即可。
 */
export function repairKey(profileId: string = currentProfileId()): string {
  return streakKey(profileId)
}

/** 本地自然月键 `YYYY-MM`。**禁用 `toISOString()`**：东八区下 UTC 月会在月初/月末算错额度。 */
export function localMonthKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 脏数据一律按"没补过"处理：`used` 只认正有限数，`month` 只认 `YYYY-MM` */
function normalizeRepair(raw: unknown): RepairState {
  const rec = raw as Partial<RepairState> | null
  if (!rec || typeof rec !== 'object') return { ...EMPTY_REPAIR }
  const used =
    typeof rec.used === 'number' && Number.isFinite(rec.used) && rec.used > 0
      ? Math.floor(rec.used)
      : 0
  if (used <= 0) return { ...EMPTY_REPAIR }
  const month = typeof rec.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(rec.month) ? rec.month : ''
  return { month, used }
}

/** 把补签计数挂到打卡状态上（空额度不写字段，保持老数据的落库形状逐字节不变） */
function attachRepair(s: StreakState, repair: RepairState): StreakState {
  const next: StreakState = { current: s.current, longest: s.longest, lastDate: s.lastDate }
  const rep = normalizeRepair(repair)
  if (rep.used > 0) next.repair = rep
  return next
}

/** 本地日期键 YYYY-MM-DD */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 该日期所在周的**周一**（本地零点）。
 *
 * `getDay()` 是 0=周日 … 6=周六，而周一起算的口径里周日属于**上一周**，
 * 所以要回退 6 天。用 `new Date(y, m, d - back)` 构造而不是 `setDate()`：
 * 前者让运行时自己处理跨月/跨年（`new Date(2026, 0, 1 - 5)` 会正确落到 2025-12-27），
 * 也不需要关心 DST（本项目全用本地日期，不做时区换算）。
 */
export function mondayOf(d: Date = new Date()): Date {
  const dow = d.getDay()
  const back = dow === 0 ? 6 : dow - 1
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

/**
 * 本地周键 `W<那周周一的日期>`，例如 `W2026-10-19`。**周一起算**。
 *
 * ## 为什么不是 `YYYY-Www`
 * ISO 周号在年边界上要跨年换算（2026-12-28 究竟是 `2026-W53` 还是 `2027-W01`
 * 取决于用哪套口径），算错了不会报错、只会把某一周静默并到隔壁。
 * 直接给"那周周一的日期"则：定宽、可直接字符串比大小（判断哪个周期更晚）、
 * 日志里一眼看出是哪一周、也不用维护周号表。
 *
 * 前缀 `W` 的作用是避免与 `localDayKey()` 的日键混淆 —— 两种键会同时出现在
 * `UnlockedRecord` 里（`unlockedAt` 是日、`lastRepeatPeriod` 是周）。
 */
export function localWeekKey(d: Date = new Date()): string {
  return `W${localDayKey(mondayOf(d))}`
}

/** a 比 b 晚多少天 */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ta = new Date(ay, am - 1, ad).getTime()
  const tb = new Date(by, bm - 1, bd).getTime()
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.NaN
  return Math.round((ta - tb) / 86400000)
}

/**
 * 读某个档案的连续天数状态。
 *
 * @param profileId 目标档案。**默认当前档案**，所以既有调用点（`touchStudyDay` /
 *   `settle` 等）一个都不用改；家庭成就墙这类"一次要读多个孩子"的页面显式传入，
 *   才不会把当前档案的打卡天数填进别人的墙。
 */
export async function loadStreak(profileId: string = currentProfileId()): Promise<StreakState> {
  try {
    const rec = await db.settings.get(streakKey(profileId))
    const v = rec?.value
    if (v && typeof v === 'object' && typeof v.current === 'number') {
      const merged: StreakState = { ...EMPTY_STREAK, ...v }
      // 补签计数与打卡同存一行（见 `StreakState.repair`）：读的时候归一化，
      // 脏值当"没补过"，绝不让一个坏字段把整天的连续天数读成 NaN。
      const rep = normalizeRepair(v.repair)
      if (rep.used > 0) merged.repair = rep
      else delete merged.repair
      return merged
    }
  } catch {
    /* 读不到就当作没有记录 */
  }
  return { ...EMPTY_STREAK }
}

/**
 * 写当前档案的打卡状态。
 *
 * 刻意**不新增第二个 `db.settings.put` 访问点**：`tests/settings-keys.test.ts`
 * 把每个 settings 访问点数成已知值，多开一个入口就必须回去改那个数字
 * （那道门禁的意义是"强迫审视新访问点"）。补签写入复用这里，故本函数保持原样。
 */
export async function saveStreak(s: StreakState): Promise<void> {
  await db.settings.put({ key: streakKey(), value: { ...s, lastDate: s.lastDate } })
}

/** 今天是否已经打过卡 */
export function studiedToday(s: StreakState, now: Date = new Date()): boolean {
  return s.lastDate === localDayKey(now)
}

/**
 * 记录"今天学过了"。同一天重复调用不会重复累加。
 * 返回值是更新后的状态（调用方可据此判断是否刚刚达成新的连续里程碑）。
 */
export async function touchStudyDay(now: Date = new Date()): Promise<StreakState> {
  const today = localDayKey(now)
  const prev = await loadStreak()
  if (prev.lastDate === today) return prev

  const gap = prev.lastDate ? dayDiff(today, prev.lastDate) : Number.NaN
  const current = gap === 1 ? prev.current + 1 : 1

  // 补签计数与打卡同存一行，所以这里必须显式带上 `prev.repair`：
  // 漏掉的表现是"打过一次卡，当月额度就悄悄回满"（补签能无限用）。
  const next: StreakState = attachRepair(
    { current, longest: Math.max(prev.longest || 0, current), lastDate: today },
    prev.repair ?? EMPTY_REPAIR,
  )
  await saveStreak(next)
  return next
}

/**
 * 取"用于展示"的连续天数：
 * 今天已打卡 → 原值；今天没打卡但昨天打过 → 仍显示原值（还有机会续上）；
 * 已经断了两天以上 → 归零。
 */
export function effectiveCurrent(s: StreakState, now: Date = new Date()): number {
  if (!s.lastDate) return 0
  const diff = dayDiff(localDayKey(now), s.lastDate)
  if (diff === 0 || diff === 1) return s.current
  return 0
}

/**
 * 展示用：连续天数文案。
 *
 * @param repairLeftCount 本月**剩余**补签次数（V1.6 · C5）。省略 = 0 = 老行为逐字节不变，
 *   所以既有调用点（Home / 家庭墙）不改也能编译，只是拿不到补签提示。
 *   只有当"昨天真的漏了"且还有额度时才改口；额度用尽**回落到原文案** ——
 *   不新造「名额用完了」这类带责备意味的措辞（PRD §11.1：焦虑来自归零的视觉，
 *   不是来自"你还有几次机会"）。
 */
export function streakText(
  s: StreakState,
  now: Date = new Date(),
  repairLeftCount: number = 0,
): string {
  const cur = effectiveCurrent(s, now)
  if (cur <= 0) {
    // PRD 原文照抄（`docs/prd-v1.3-achievement.md` §11.1 的补签文案）
    if (repairLeftCount > 0 && missedYesterday(s, now)) {
      return `昨天漏学啦，可请家长补签 1 次（本月还剩 ${repairLeftCount} 次）`
    }
    return '今天还没开始，来打卡吧'
  }
  if (studiedToday(s, now)) return `已连续学习 ${cur} 天`
  return `连续 ${cur} 天，今天再学一次就续上啦`
}

/** 展示用：达成过的连续里程碑（用于徽章判定） */
export function bestStreak(s: StreakState, now: Date = new Date()): number {
  return Math.max(s.longest || 0, effectiveCurrent(s, now))
}

// ===========================================================================
// 补签（V1.6 · Stage C · C5 / PRD §11.1 + §11.6）
// ===========================================================================
/*
 * ## 产品裁决：保留严格连续语义，只给每月一次"补记"出口
 *
 * 成就按 `bestStreak`（历史最长）判定，断签**不会丢徽章**；真正制造焦虑的只是
 * 首页那个"归零"的视觉。所以这里不放松 `effectiveCurrent`（`diff===0||diff===1`
 * 才算连着、`diff>=2` 归零），而是另开一条**有额度、要家长作证**的出口。
 *
 * ## 补签是"补记"，不是"免签"
 * 只补「昨天学过但没留下记录」这一种情况，因此：
 *   - 只认 `diff === 2`（= 前天是最后一条记录 → 昨天漏了）；断 ≥2 天一律不补；
 *   - 必须家长确认（`confirmedByParent`）：昨天真的做了线下练习 / 纸质作业。
 *     **禁止凭空补签** —— 没有这道闸，补签就等于"给一个按钮让孩子把天数刷回来"。
 *
 * ## 不写 `dailyStats`
 * 这是「补签只解锁连续天数类成就」的**结构性保证**（PRD §11.6 第 4 条）：
 * 补签只动 streak 一行，题量类（`daily-20`）与时段类（`early-bird` / `night-owl`）
 * 的输入一个字都没变，所以它们不可能因为补签而解锁 —— 不靠"忘了写"，
 * 而是靠"没有可写的入口"。
 */

/**
 * 补签被拒的原因。四个值各自对应一句人话（文案在 `Parent.vue`）。
 *
 * - `no-parent-consent`：没有家长确认（第一道闸，一个字节都不写库）
 * - `no-record`：从来没有学习记录（补签没有可续的对象）
 * - `not-missed-yesterday`：不是"昨天漏了一天"的形态（今天已学 / 昨天学过 / 断了 ≥2 天）
 * - `quota-used`：本月额度已用完
 */
export type RepairRejectReason =
  | 'no-parent-consent'
  | 'no-record'
  | 'not-missed-yesterday'
  | 'quota-used'

export interface RepairResult {
  /** 是否真的补上了（写库成功） */
  repaired: boolean
  /** 被拒原因（`repaired === true` 时不存在） */
  reason?: RepairRejectReason
  /** 操作后的打卡状态（被拒时是**原样**的当前状态，方便调用点统一刷新 UI） */
  streak: StreakState
}

/** 读某个档案的补签计数（与打卡同一行；读不到 = 没补过） */
export async function loadRepair(profileId: string = currentProfileId()): Promise<RepairState> {
  const s = await loadStreak(profileId)
  return normalizeRepair(s.repair)
}

/**
 * 单独写**当前档案**的补签计数（测试与运维用）。
 *
 * 生产路径不要用它 —— 补签必须走 `repairYesterday()`：那里的 streak 与计数
 * 是同一个 `put` 落盘的（分成两次写会产生"天数恢复了但额度没扣"的半截状态）。
 *
 * 为什么没有 `profileId` 形参：写入口一律取当前档案（与 `saveStreak` /
 * `touchStudyDay` 同一条纪律），并且补签只在家长端对"正在看的那个孩子"发生。
 * 读侧（`loadRepair(profileId?)`）保留形参，家庭墙那类"一次读多个孩子"的场景要用。
 */
export async function saveRepair(s: RepairState): Promise<void> {
  const cur = await loadStreak()
  await saveStreak(attachRepair(cur, s))
}

/** 本月剩余补签次数。月份口径是**本地自然月**，跨月自动回满。 */
export function repairLeft(rep: RepairState, now: Date = new Date()): number {
  const month = localMonthKey(now)
  // 计数属于别的月份 → 这个月的额度还一次没用（不累积、也不惩罚上个月）
  if (!rep || rep.month !== month) return REPAIR_QUOTA_PER_MONTH
  const used = Number.isFinite(rep.used) && rep.used > 0 ? Math.floor(rep.used) : 0
  return Math.max(0, REPAIR_QUOTA_PER_MONTH - used)
}

/**
 * 是否「昨天漏学」——补签唯一适用的场景，**精确等于 `diff === 2`**。
 *
 * 语义链：`diff = 今天 - 最后记录日`
 *   - 0 = 今天学过（不需要补）
 *   - 1 = 昨天学过（连续还活着，不需要补）
 *   - **2 = 前天是最后一条 → 昨天漏了**（可补）
 *   - ≥3 = 断了至少两天（不补，PRD 明确"断 ≥2 天不补"）
 */
export function missedYesterday(s: StreakState, now: Date = new Date()): boolean {
  if (!s || !s.lastDate) return false
  const diff = dayDiff(localDayKey(now), s.lastDate)
  return diff === 2
}

/** 昨天（本地）的日期键。用 `new Date(y, m, d-1)` 构造：跨月/跨年交给运行时 */
function yesterdayKey(now: Date): string {
  return localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
}

/**
 * 补签「昨天」。家长确认后调用。
 *
 * ## 执行顺序就是安全边界（不许调整）
 * 1. 没有家长确认 → 立刻拒绝，**一个字节都不写库**（连读都不做多余的写）；
 * 2. 读打卡状态与额度；
 * 3. 逐条前置：有记录 → 真的是昨天漏了 → 本月还有额度；
 * 4. 一次 `put` 落盘：`lastDate = 昨天`、`current + 1`、`longest = max(...)`、额度 +1。
 *
 * ## 一致性不变量（PRD §11.6 第 2 条）
 * `longest = max(longest, current + 1)` 就是"历史最长连续"不得低于"实际发生过的最长连续"。
 * 少这一行的表现：`current` 变成 6、`longest` 还是 5，`bestStreak()` 下次取 max 才凑巧
 * 看对，而一旦断签就永远停在 5 —— 徽章判定会与孩子记着的"我连过 6 天"对不上。
 *
 * ## 不抛异常
 * 畸形值（`current: NaN`、`longest: -1`、`lastDate: '乱码'`）一律按"0 / 没记录"处理，
 * 返回拒绝结果而不是 throw —— 家长点一下按钮不该看到白屏。
 * 例外：**写库失败会抛**（`db.settings.put` reject）。"报成功但没落库"比抛错更糟，
 * 调用方（`Parent.vue`）必须 try/catch 并把失败说出来。
 */
export async function repairYesterday(opts: {
  confirmedByParent: boolean
  now?: Date
}): Promise<RepairResult> {
  const now = opts.now ?? new Date()

  // ---- 第 1 道闸：没有家长作证，一律拒绝，且不写任何东西 ----
  if (!opts.confirmedByParent) {
    return { repaired: false, reason: 'no-parent-consent', streak: await loadStreak() }
  }

  // ---- 第 2 步：读现状（额度就在同一行里，不再多读一次，保证两者同源）----
  const s = await loadStreak()
  const rep = normalizeRepair(s.repair)

  // ---- 第 3 步：三条前置（顺序固定，先便宜的、再需要计算的）----
  if (!s.lastDate) return { repaired: false, reason: 'no-record', streak: s }
  if (!missedYesterday(s, now)) {
    return { repaired: false, reason: 'not-missed-yesterday', streak: s }
  }
  if (repairLeft(rep, now) <= 0) return { repaired: false, reason: 'quota-used', streak: s }

  // ---- 第 4 步：一次 put 落盘 ----
  const cur = Number.isFinite(s.current) && s.current > 0 ? Math.floor(s.current) : 0
  const longest = Number.isFinite(s.longest) && s.longest > 0 ? Math.floor(s.longest) : 0
  const nextCurrent = cur + 1
  const month = localMonthKey(now)
  const next: StreakState = attachRepair(
    {
      // 补签把「昨天」标记为已学习 → 连续值恢复为 current + 1
      current: nextCurrent,
      // ★ §11.6 一致性不变量：历史最长不得低于实际发生过的最长（见上方 JSDoc）
      longest: Math.max(longest, nextCurrent),
      lastDate: yesterdayKey(now),
    },
    // 跨月自动重置：上个月的 used 不能带进这个月
    { month, used: (rep.month === month ? rep.used : 0) + 1 },
  )
  await saveStreak(next)
  return { repaired: true, streak: next }
}
