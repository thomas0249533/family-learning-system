/**
 * P0 · 复习调度门面
 *
 * 对外保持与旧版完全一致的函数签名（computeNextReview / isDueForReview /
 * humanizeNextReview / stageLabel / REVIEW_INTERVALS_DAYS），内部从"固定间隔表"
 * 换成 FSRS。这样 userData store、Review.vue、Home.vue 等调用方一行都不用改，
 * 避免重构牵连出一堆无关改动。
 *
 * 新增能力：
 *   - rateFromOutcome() 把二元对错自动推断成 FSRS 四档评分
 *   - scheduleReview()  用一张持久化卡片推进排期（新主路径）
 *   - retrievabilityOf() 取"此刻想得起来的概率"，用于展示记忆强度
 *
 * 时间口径见 `fsrs.ts` 文件头（V1.10 · E1-a 审计裁定）：`nextReviewAt` /
 * `lastReviewAt` 是 UTC 全时刻，消费一律 `new Date()` 解析后比较；
 * 要日粒度走 `localDayKey`。`mergeProgress` 的字典序比较依赖本格式，
 * 改格式前先看 `tests/review-time-contract.test.ts`。
 */
import {
  advance,
  daysUntilDue,
  emptyCardState,
  retrievability,
  Rating,
  State,
  type FsrsCardState,
  type FsrsRating,
} from './fsrs'

/** 保留旧常量：React/Vue 侧与老数据换算仍会引用 */
export const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60]

export interface ReviewState {
  reviewStage: number
  nextReviewAt: string
  lastReviewAt: string
}

/** 秒答阈值：≤12 秒答对视为"脱口而出"，可给到「轻松」档 */
export const FAST_ANSWER_MS = 12000

/** 把"下次间隔天数"折算成 0~6 的展示阶段（沿用旧 UI 的语义与配色） */
export function stageFromInterval(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0
  let idx = 0
  for (let i = 0; i < REVIEW_INTERVALS_DAYS.length; i++) {
    if (days >= REVIEW_INTERVALS_DAYS[i] - 0.5) idx = i
  }
  return idx
}

/**
 * 把旧的 reviewStage(0~6) 折算成一张近似的 FSRS 卡片。
 * 用途：升级前就已经存在的进度记录没有 fsrs 字段，用它平滑接管，不用清库。
 */
export function legacyCardFromStage(stage: number, now: Date = new Date()): FsrsCardState {
  const s = Math.max(0, Math.min(Math.floor(stage) || 0, REVIEW_INTERVALS_DAYS.length - 1))
  const card = emptyCardState(now)
  if (s === 0) return card
  const days = REVIEW_INTERVALS_DAYS[s]
  return {
    ...card,
    stability: days,
    difficulty: 5,
    scheduled_days: days,
    reps: s,
    state: State.Review,
    due: new Date(now.getTime() + days * 86400000).toISOString(),
  }
}

export interface OutcomeInput {
  isCorrect: boolean
  /** 该知识点历史上答错过 */
  everWrong?: boolean
  /** 本次作答耗时（毫秒），未采集时传 undefined */
  elapsedMs?: number
  /** 当前连续答对次数（含本次） */
  correctStreak?: number
}

/**
 * 自动推断评分档位——孩子这一端零额外操作。
 *
 *   答错                    → 忘记
 *   刚答错过、这次补上了    → 困难（间隔短一点，及时回补）
 *   连续答对≥3 且秒答       → 轻松
 *   其余答对                → 记得
 */
export function rateFromOutcome(o: OutcomeInput): FsrsRating {
  if (!o.isCorrect) return Rating.Again

  const streak = o.correctStreak ?? 1

  if (o.everWrong && streak <= 1) return Rating.Hard

  if (
    streak >= 3 &&
    o.elapsedMs !== undefined &&
    o.elapsedMs > 0 &&
    o.elapsedMs <= FAST_ANSWER_MS
  ) {
    return Rating.Easy
  }

  return Rating.Good
}

export interface ScheduleInput {
  card?: FsrsCardState | null
  rating: FsrsRating
  now?: Date
}

export interface ScheduleResult {
  card: FsrsCardState
  reviewStage: number
  nextReviewAt: string
  lastReviewAt: string
}

/** 用一次评分推进排期。这是新的主路径。 */
export function scheduleReview(input: ScheduleInput): ScheduleResult {
  const now = input.now ?? new Date()
  const base = input.card ?? emptyCardState(now)
  const card = advance(base, input.rating, now)
  return {
    card,
    reviewStage: stageFromInterval(card.scheduled_days),
    nextReviewAt: card.due,
    lastReviewAt: now.toISOString(),
  }
}

/**
 * 旧签名兼容入口：只有"阶段 + 对错"两个信息时使用。
 * 新代码请走 rateFromOutcome + scheduleReview，能带上难度与耗时信息。
 */
export function computeNextReview(
  prevStage: number,
  isCorrect: boolean,
  now: Date = new Date()
): ReviewState {
  const result = scheduleReview({
    card: legacyCardFromStage(prevStage, now),
    rating: isCorrect ? Rating.Good : Rating.Again,
    now,
  })
  return {
    reviewStage: result.reviewStage,
    nextReviewAt: result.nextReviewAt,
    lastReviewAt: result.lastReviewAt,
  }
}

/** 当前是否到期需要复习 */
export function isDueForReview(p: { nextReviewAt?: string }): boolean {
  if (!p.nextReviewAt) return false
  return new Date(p.nextReviewAt).getTime() <= Date.now()
}

/** 展示用：距离下次复习的人性化文本 */
export function humanizeNextReview(nextReviewAt?: string): string {
  if (!nextReviewAt) return '未安排'
  const ms = new Date(nextReviewAt).getTime() - Date.now()
  if (ms <= 0) return '现在该复习了'
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  if (days > 0) return `${days} 天后`
  if (hours > 0) return `${hours} 小时后`
  return '不到 1 小时'
}

/** 展示用：当前阶段说明 */
export function stageLabel(stage?: number): string {
  if (stage === undefined) return '未安排'
  const labels = ['第 1 次', '第 2 次', '第 3 次', '第 4 次', '第 5 次', '第 6 次', '已稳固']
  return labels[Math.min(Math.max(Math.floor(stage) || 0, 0), labels.length - 1)]
}

/** 展平用：两个时间是否落在同一个自然日（本地时区） */
export function isSameDay(a?: string | Date | null, b: Date = new Date()): boolean {
  if (!a) return false
  const d = typeof a === 'string' ? new Date(a) : a
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  )
}

/**
 * 本次作答是否应该推进 FSRS 排期。
 *
 * 这是整套调度里最容易出错、也最关键的一道闸门：
 * 一个 topic 里同一知识点会被连续答对多次（比如 8 道口算全对），
 * 如果每次都推进，一节课内间隔就会从 2 天冲到几十天，复习计划直接失效。
 * 所以规则是——同一天内只推进一次，答错除外（答错要立刻把复习拉回来）。
 */
export function shouldAdvanceSchedule(
  lastReview: string | null | undefined,
  isCorrect: boolean,
  now: Date = new Date()
): boolean {
  if (!isCorrect) return true
  return !isSameDay(lastReview, now)
}

/** 展示用：记忆强度百分比（0~100），无卡片时返回 null */
export function retrievabilityPercent(
  card?: FsrsCardState | null,
  now: Date = new Date()
): number | null {
  if (!card) return null
  if (!card.last_review) return null
  return Math.round(retrievability(card, now) * 100)
}

/** 展示用：记忆强度文案 */
export function memoryStrengthLabel(percent: number | null): string {
  if (percent === null) return '尚未复习'
  if (percent >= 85) return '记忆牢固'
  if (percent >= 60) return '记忆一般'
  return '需要复习'
}

/** 展示用：卡片是否已逾期 */
export function overdueDays(card?: FsrsCardState | null, now: Date = new Date()): number {
  if (!card) return 0
  const d = daysUntilDue(card, now)
  return d < 0 ? Math.floor(-d) : 0
}
