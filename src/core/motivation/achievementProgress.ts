/**
 * 成就进度 · **唯一进度真相**（V1.3 · A-02）
 *
 * 分工：
 *   - `achievements.ts` 的 `check(ctx)` = 唯一**解锁真相**（谓词，已冻结，本轮不改语义）；
 *   - 本文件 `progressOf(id, ctx)` = 唯一**进度真相**（数值）。
 *
 * 两者必须**语义等价**：`progressOf(id, ctx).current >= target ⇔ check(ctx) === true`。
 * `tests/achievement-progress.test.ts` 用多组上下文（0 值 / 临界 / 达标 / 超额）把这条
 * 等价关系钉死 —— 一旦出现"进度显示 10/10 但徽章没亮"，孩子会直接不信这个功能。
 *
 * ## 三条硬约束
 * 1. **纯函数**：不读 db、不读 store、不碰 `Date.now()`（时间由 `ctx` 提供）。
 * 2. **无状态、无持久化、禁止缓存历史最大值**：`current` 只能是「当下数据算出来的值」。
 *    进度**允许回退**（口径修正、包被删、窗口滚出都会让它变小）——那是真实状态，
 *    已解锁的徽章由 `syncAchievements` 的"只增不删"保证不回收，不需要在这里兜底。
 *    任何 `Math.max(current, lastSeen)` 都会让上面的等价关系破裂，绝对禁止。
 * 3. **`current` 恒 clamp 到 `[0, target]`**：不允许出现 `11/10` 这种数字。
 *
 * ## 为什么 3 枚隐藏成就返回 `null`
 * `comeback` / `early-bird` / `night-owl` 是**元认知与时段彩蛋**：达成前不给任何提示
 * （否则就不叫隐藏了），达成后按 §5.4 也只显示"已解锁 + 日期"，**不补显示进度**。
 * 所以"无法进度化"对它们是恒定的，与是否已解锁无关 → 一律返回 `null`。
 * 于是可进度化 = 35 枚（V2.8 · C1 起含习惯养成 10 枚），不可进度化 = 3 枚，与 PRD §4.5 的统计口径完全一致。
 *
 * ## 与 `check()` 的重复实现是刻意的
 * 本文件重算了一遍统计基元（而不是复用 `achievements.ts` 的内部函数，那些没有导出）。
 * 好处是判定层与展示层不互相 import，坏处是有漂移风险 —— 所以用等价性测试兜住。
 * 改任何一侧的公式，必须两边一起改，并让测试变绿。
 */
import type { AchievementContext } from './achievements'
import type { DailyStat } from './dailyStats'

export type ProgressKind = 'counter' | 'binary'

/** 复合成就的分项（例如三科通才的数学/语文/英语各多少） */
export interface ProgressPart {
  label: string
  current: number
  target: number
}

export interface Measure {
  /** 当前值，**恒在 `[0, target]`** */
  current: number
  /** 目标值 */
  target: number
  /** 量词：个 / 道 / 天 / 种 / 科（见 PRD §5.3 量词表） */
  unit: string
  /** 量词后的名词：知识点 / 错题 / 学习包 / 题型 / 学期 / 学科；无名词时为空串 */
  noun: string
  /** counter = 累计型；binary = 事件型（target 恒为 1） */
  kind: ProgressKind
  /** 复合成就的分项展示（可选） */
  parts?: ProgressPart[]
  /**
   * 前置门槛未满足时的替代文案（如「需先有 20 个知识点」）。
   * 存在即表示 current 被压成 0（门槛不满足时不可能达成），UI 优先显示它。
   */
  gate?: string
}

// ==================== 统计基元（与 achievements.ts 同口径）====================

const masteredKp = (ctx: AchievementContext) =>
  ctx.progress.filter((x) => x.status === '已掌握').length
const clearedMistake = (ctx: AchievementContext) =>
  ctx.mistakes.filter((x) => x.mastered).length
const bestCorrectStreak = (ctx: AchievementContext) =>
  ctx.progress.reduce((max, x) => Math.max(max, x.correctStreak ?? 0), 0)
const maxAnswerCount = (ctx: AchievementContext) =>
  ctx.progress.reduce(
    (max, x) => Math.max(max, (x.correctCount ?? 0) + (x.wrongCount ?? 0)),
    0,
  )
const reviewCorrect = (ctx: AchievementContext) =>
  ctx.mistakes.reduce((sum, x) => sum + (x.reviewCorrectCount ?? 0), 0)

const subjectOf = (ctx: AchievementContext) => {
  const m = new Map<string, string>()
  for (const p of ctx.packages ?? []) m.set(p.packageId, p.subject)
  return m
}
const masteredBySubject = (ctx: AchievementContext) => {
  const map = subjectOf(ctx)
  const counts: Record<string, number> = {}
  for (const pr of ctx.progress) {
    if (pr.status !== '已掌握') continue
    const s = map.get(pr.packageId)
    if (!s) continue
    counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}
const totalKp = (ctx: AchievementContext) =>
  (ctx.packages ?? []).reduce((sum, p) => sum + (p.kpCount ?? 0), 0)

const studiedPackageIds = (ctx: AchievementContext) =>
  new Set(ctx.progress.map((x) => x.packageId))
const studiedTerms = (ctx: AchievementContext) => {
  const studied = studiedPackageIds(ctx)
  const terms = new Set<string>()
  for (const p of ctx.packages ?? []) if (studied.has(p.packageId)) terms.add(p.term)
  return terms
}
const nonMathSubjects = (ctx: AchievementContext) => {
  const studied = studiedPackageIds(ctx)
  const subs = new Set<string>()
  for (const p of ctx.packages ?? []) {
    if (studied.has(p.packageId) && p.subject !== 'math') subs.add(p.subject)
  }
  return subs
}
const maxDayQuestions = (ctx: AchievementContext) =>
  (ctx.dailyStats ?? []).reduce((max, s) => Math.max(max, s.questionCount ?? 0), 0)

// ---------- V2.8 · C1：习惯养成类统计基元（与 achievements.ts 同口径的双份实现） ----------
const maxDayFocusMinutes = (ctx: AchievementContext) =>
  (ctx.dailyStats ?? []).reduce((max, s) => Math.max(max, s.focusMinutes ?? 0), 0)
const distinctFocusDays = (ctx: AchievementContext, minMinutes: number) =>
  new Set(
    (ctx.dailyStats ?? []).filter((s) => (s.focusMinutes ?? 0) >= minMinutes).map((s) => s.date),
  ).size
const distinctMorningDays = (ctx: AchievementContext, hour: number) =>
  new Set(
    (ctx.dailyStats ?? [])
      .filter(
        (s) =>
          Number.isFinite(s.firstStudyAt) &&
          s.firstStudyAt > 0 &&
          new Date(s.firstStudyAt).getHours() < hour,
      )
      .map((s) => s.date),
  ).size
function distinctWeekendStudyDays(ctx: AchievementContext): number {
  const days = new Set<string>()
  for (const s of ctx.dailyStats ?? []) {
    if ((s.questionCount ?? 0) <= 0 && (s.focusMinutes ?? 0) <= 0) continue
    if (typeof s.date === 'string' && s.date !== '') days.add(s.date)
  }
  let n = 0
  for (const d of days) {
    const wd = new Date(`${d}T12:00:00`).getDay()
    if (wd === 0 || wd === 6) n += 1
  }
  return n
}
/** 「最接近通关」的合格包（kpCount ≥5）通关百分比；100 ⇔ check（floor 保证 99.x 不越线） */
function bestPackageCompletionPercent(ctx: AchievementContext): number {
  const mastered = new Map<string, number>()
  for (const p of ctx.progress) {
    if (p.status !== '已掌握') continue
    mastered.set(p.packageId, (mastered.get(p.packageId) ?? 0) + 1)
  }
  let best = 0
  for (const p of ctx.packages ?? []) {
    if ((p.kpCount ?? 0) < 5) continue
    const ratio = Math.min(1, (mastered.get(p.packageId) ?? 0) / (p.kpCount ?? 0))
    best = Math.max(best, Math.floor(ratio * 100))
  }
  return best
}
/** 完美一天（同一天双达标）：50 ⇔ check，分项拆解见 `MEASURES['perfect-day']` */
function bestPerfectDayScore(ctx: AchievementContext): { score: number; day?: DailyStat } {
  let best = -1
  let day: DailyStat | undefined
  for (const s of ctx.dailyStats ?? []) {
    const score =
      Math.min(Math.floor(s.questionCount ?? 0), 20) +
      Math.min(Math.floor(s.focusMinutes ?? 0), 30)
    if (score > best) {
      best = score
      day = s
    }
  }
  return { score: Math.max(0, best), day }
}

/** 历史最长连续天数（纯函数版 bestStreak，见下方 streak-* 处的说明） */
const bestDayStreak = (ctx: AchievementContext) =>
  Math.max(ctx.streak?.longest ?? 0, ctx.streak?.current ?? 0)

export const SUBJECT_LABEL: Record<string, string> = {
  math: '数学',
  chinese: '语文',
  english: '英语',
}

// ==================== 构造器 ====================

/** 累计型度量：自动 floor + clamp，避免出现 11/10 */
function counter(
  raw: number,
  target: number,
  unit: string,
  noun: string,
): Measure {
  const current = Math.max(0, Math.min(target, Math.floor(raw)))
  return { current, target, unit, noun, kind: target === 1 ? 'binary' : 'counter' }
}

// ==================== 35 枚可进度化成就 ====================

const MEASURES: Record<string, (ctx: AchievementContext) => Measure> = {
  // ---------- M · 精熟 ----------
  'first-step': (c) => counter(masteredKp(c), 1, '个', '知识点'),
  'ten-kp': (c) => counter(masteredKp(c), 10, '个', '知识点'),
  'fifty-kp': (c) => counter(masteredKp(c), 50, '个', '知识点'),
  'hundred-kp': (c) => counter(masteredKp(c), 100, '个', '知识点'),
  'kp-300': (c) => counter(masteredKp(c), 300, '个', '知识点'),

  // 三科各 10 个 → 用 min 封顶后求和，这样进度条不会因为"数学 50 个"就虚高
  'subject-master-3': (c) => {
    const by = masteredBySubject(c)
    const cap = (s: string) => Math.min(by[s] ?? 0, 10)
    const parts: ProgressPart[] = [
      { label: '数学', current: cap('math'), target: 10 },
      { label: '语文', current: cap('chinese'), target: 10 },
      { label: '英语', current: cap('english'), target: 10 },
    ]
    return {
      current: parts.reduce((s, p) => s + p.current, 0),
      target: 30,
      unit: '个',
      noun: '知识点',
      kind: 'counter',
      parts,
    }
  },

  'perfect-kp': (c) => counter(bestCorrectStreak(c), 10, '题', '连对'),
  'mastery-half': (c) => {
    const total = totalKp(c)
    // ★ 门槛不满足时 current 压成 0：与 check() 的 `total < 20 → false` 等价。
    // 若这里照实返回掌握率，会出现"进度 60% 但永远不亮"的观感灾难。
    if (total < 20) {
      return {
        current: 0,
        target: 50,
        unit: '%',
        noun: '',
        kind: 'counter',
        gate: '需先有 20 个知识点',
      }
    }
    const rate = Math.floor((masteredKp(c) / total) * 100)
    return {
      current: Math.max(0, Math.min(50, rate)),
      target: 50,
      unit: '%',
      noun: '',
      kind: 'counter',
    }
  },

  // ---------- G · 成长 ----------
  'mistake-first': (c) => counter(clearedMistake(c), 1, '道', '错题'),
  'mistake-cleaner': (c) => counter(clearedMistake(c), 10, '道', '错题'),
  'mistake-cleaner-50': (c) => counter(clearedMistake(c), 50, '道', '错题'),
  'review-20': (c) => counter(reviewCorrect(c), 20, '次', '复习答对'),
  patience: (c) => counter(maxAnswerCount(c), 30, '道', '题'),
  'streak-master': (c) => counter(bestCorrectStreak(c), 5, '题', '连对'),

  // ---------- B · 行为 ----------
  // ★ 连续天数用 `max(longest, current)` 而**不用** `bestStreak()`：后者内部默认
  //   `now = new Date()`，会让本模块变成非纯函数。`touchStudyDay` 保证
  //   `longest = max(prev.longest, current)`，所以两者在合法数据上恒等。
  'streak-3': (c) => counter(bestDayStreak(c), 3, '天', ''),
  'streak-7': (c) => counter(bestDayStreak(c), 7, '天', ''),
  'streak-30': (c) => counter(bestDayStreak(c), 30, '天', ''),
  'streak-60': (c) => counter(bestDayStreak(c), 60, '天', ''),
  'streak-100': (c) => counter(bestDayStreak(c), 100, '天', ''),
  'daily-20': (c) => counter(maxDayQuestions(c), 20, '道', '题'),

  // ---------- B · 行为（V2.8 · C1 习惯养成 10 枚） ----------
  'focus-5': (c) => counter(maxDayFocusMinutes(c), 5, '分钟', ''),
  'focus-15': (c) => counter(maxDayFocusMinutes(c), 15, '分钟', ''),
  'focus-30': (c) => counter(maxDayFocusMinutes(c), 30, '分钟', ''),
  'focus-days-3': (c) => counter(distinctFocusDays(c, 10), 3, '天', ''),
  'morning-light': (c) => counter(distinctMorningDays(c, 8), 3, '天', ''),
  // 通关百分比：只有 kpCount ≥5 的包参评，100 ⇔「整包全部掌握」
  'one-go': (c) => counter(bestPackageCompletionPercent(c), 100, '%', ''),
  // 双门槛（同一天）：分项封顶求和 = 50 ⇔ 答题 20 且专注 30（subject-master-3 同款手法）
  'perfect-day': (c) => {
    const { score, day } = bestPerfectDayScore(c)
    const parts: ProgressPart[] = day
      ? [
          { label: '答题', current: Math.min(Math.floor(day.questionCount ?? 0), 20), target: 20 },
          { label: '专注', current: Math.min(Math.floor(day.focusMinutes ?? 0), 30), target: 30 },
        ]
      : []
    return {
      current: Math.max(0, Math.min(50, score)),
      target: 50,
      unit: '分',
      noun: '',
      kind: 'counter',
      ...(parts.length > 0 ? { parts } : {}),
    }
  },
  'streak-14': (c) => counter(bestDayStreak(c), 14, '天', ''),
  'daily-50': (c) => counter(maxDayQuestions(c), 50, '道', '题'),
  'weekend-2': (c) => counter(distinctWeekendStudyDays(c), 2, '天', ''),

  // ---------- E · 探索 ----------
  'explorer-3': (c) => counter(studiedPackageIds(c).size, 3, '个', '学习包'),
  'explorer-10': (c) => counter(studiedPackageIds(c).size, 10, '个', '学习包'),
  'type-collector': (c) => counter(c.attemptedTypes?.length ?? 0, 5, '种', '题型'),
  'term-cross': (c) => counter(studiedTerms(c).size, 2, '个', '学期'),
  'senior-new': (c) => counter(nonMathSubjects(c).size > 0 ? 1 : 0, 1, '科', '学科'),
}

/**
 * 隐藏成就：**永远**不可进度化（未解锁不提示，已解锁不补进度）。
 * 从 `MEASURES` 里物理删除而不是返回 0/1，这样"漏了度量"和"故意不给度量"
 * 在类型层面就能区分，测试也不至于把 0/1 当成真进度。
 */
export const HIDDEN_NO_PROGRESS = ['comeback', 'early-bird', 'night-owl'] as const

/** 可进度化的成就 id（35 枚） */
export const MEASURABLE_IDS = Object.keys(MEASURES)

/**
 * 单枚成就的进度。`null` = 该成就无法进度化（仅 3 枚隐藏成就）。
 * 未知 id 也返回 `null`（防御：脏数据不该让页面崩）。
 */
export function progressOf(id: string, ctx: AchievementContext): Measure | null {
  const fn = MEASURES[id]
  if (!fn) return null
  try {
    return fn(ctx)
  } catch {
    return null
  }
}

// ==================== 文案（PRD §5.3「进度提示文案规则」）====================

/**
 * 进度提示文案。所有文案的**数字都来自 Measure**，前端不得另算一套。
 *
 * | 状态 | 文案 |
 * |---|---|
 * | 门槛未满足 | 门槛说明（如「需先有 20 个知识点」） |
 * | c ≥ t | 已达标 · 正在确认 |
 * | t === 1 且 c === 0 | 完成一次即可解锁 |
 * | c === 0 | 目标 {t}{unit}{noun} |
 * | c/t ≥ 0.8 | 就快拿到了 · 还差 {n}{unit}{noun} |
 * | 其余 | 已完成 {c}/{t} · 还差 {n}{unit}{noun} |
 *
 * 红线：不出现"抽/概率/稀有/限时/错过就没了"，也不出现否定式催促。
 */
export function progressText(m: Measure): string {
  if (m.gate) return m.gate
  const { current: c, target: t, unit, noun } = m
  const tail = `${unit}${noun}`

  if (c >= t) return '已达标 · 正在确认'
  if (t <= 1) return '完成一次即可解锁'
  if (c <= 0) return `目标 ${t}${tail}`

  const gap = `还差 ${t - c}${tail}`
  // 用整数比较避免浮点误差：8/10 恰好 0.8，写成 c/t >= 0.8 在 7/10 之类上也无风险，
  // 但乘 100 后取整更稳，且不依赖浮点边界。
  const reached = c * 100 >= t * 80
  return reached ? `就快拿到了 · ${gap}` : `已完成 ${c}/${t} · ${gap}`
}

// ==================== 证据快照（A-06）====================

/**
 * 解锁瞬间固化的一句话事实（≤40 字）。
 *
 * `{n}` 会被替换成**达成时的 current**。已解锁的隐藏成就用固定文案 ——
 * 它们是"事件型"，写数字反而奇怪（"连续学习 1 天"？）。
 *
 * 铁律：旧记录没有 `evidence` 就**不显示该行**，绝不事后补算 ——
 * 补算出来的"证据"已经不是当时的证据了。
 */
const EVIDENCE_TPL: Record<string, string> = {
  'first-step': '已掌握 {n} 个知识点',
  'ten-kp': '已掌握 {n} 个知识点',
  'fifty-kp': '已掌握 {n} 个知识点',
  'hundred-kp': '已掌握 {n} 个知识点',
  'kp-300': '已掌握 {n} 个知识点',
  'subject-master-3': '数学 / 语文 / 英语各掌握 ≥10 个知识点',
  'perfect-kp': '单个知识点连续答对 {n} 题',
  'mastery-half': '全库掌握率 {n}%',
  'mistake-first': '已攻克 {n} 道错题',
  'mistake-cleaner': '已攻克 {n} 道错题',
  'mistake-cleaner-50': '已攻克 {n} 道错题',
  'review-20': '复习答对累计 {n} 次',
  patience: '单个知识点累计答题 {n} 次',
  'streak-master': '单个知识点连续答对 {n} 题',
  'streak-3': '连续学习 {n} 天',
  'streak-7': '连续学习 {n} 天',
  'streak-30': '连续学习 {n} 天',
  'streak-60': '连续学习 {n} 天',
  'streak-100': '连续学习 {n} 天',
  'daily-20': '单日最多完成 {n} 题',
  // V2.8 · C1 习惯养成 10 枚
  'focus-5': '单日最多专注 {n} 分钟',
  'focus-15': '单日最多专注 {n} 分钟',
  'focus-30': '单日最多专注 {n} 分钟',
  'focus-days-3': '有 {n} 天专注满 10 分钟',
  'morning-light': '{n} 天在早上 8 点前开始学习',
  'one-go': '完整拿下一个学习包的全部知识点',
  'perfect-day': '单日答题 20 题且专注满 30 分钟',
  'streak-14': '连续学习 {n} 天',
  'daily-50': '单日最多完成 {n} 题',
  'weekend-2': '{n} 个周末日坚持学习',
  'explorer-3': '学习过 {n} 个不同学习包',
  'explorer-10': '学习过 {n} 个不同学习包',
  'type-collector': '尝试过 {n} 种题型',
  'term-cross': '上册与下册都学过',
  'senior-new': '开始学习数学以外的学科',
  // 隐藏成就：事件型，写固定文案
  comeback: '某个知识点错够 3 次后，最终彻底学会',
  'early-bird': '在早上 7 点前完成过一次学习',
  'night-owl': '在晚上 9 点后完成过一次学习',
}

/** 证据文本上限（PRD §4.4：≤40 字） */
export const EVIDENCE_MAX = 40

/** 生成某枚成就的证据快照；拿不到度量时退回描述文案 */
export function evidenceOf(id: string, ctx: AchievementContext): string {
  const tpl = EVIDENCE_TPL[id]
  if (!tpl) return ''
  const m = progressOf(id, ctx)
  const text = tpl.includes('{n}') ? tpl.replace('{n}', String(m?.current ?? 0)) : tpl
  return text.length > EVIDENCE_MAX ? `${text.slice(0, EVIDENCE_MAX - 1)}…` : text
}
