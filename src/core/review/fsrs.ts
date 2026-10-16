/**
 * P0 · FSRS 复习内核
 *
 * 为什么替换掉固定间隔表 [1,2,4,7,15,30,60]：
 *   固定表隐含两个不成立的假设——"所有知识点难度相同""所有答对等价"。
 *   FSRS（Free Spaced Repetition Scheduler，Anki 现行默认算法）为每个知识点
 *   维护 Difficulty（难度）/ Stability（记忆稳定性）/ Retrievability（可提取性）
 *   三个状态，按目标记忆率反推下次复习时间，因此能区分"轻松答对"和"犹豫后答对"，
 *   也能让难的知识点自动多复习、简单的少复习。
 *
 * 本文件只负责两件事：
 *   1. 包住 ts-fsrs 官方参考实现，固定一份适合小学日常节奏的参数；
 *   2. 把 ts-fsrs 的 Card（含 Date 对象）转成能写进 IndexedDB 的纯 JSON。
 * 业务代码一律只依赖 reviewScheduler.ts 的门面函数，不直接 import 本文件。
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
  type Steps,
} from 'ts-fsrs'

/** 目标记忆率。0.9 为 FSRS 默认；小学生遗忘更快，取 0.92 略偏保守。 */
export const REQUEST_RETENTION = 0.92

/** 间隔上限（天） */
export const MAX_INTERVAL_DAYS = 365

/**
 * 学习步 / 重学步长度。
 *
 * ts-fsrs 默认是分钟级（1m / 10m），那是为"一天内多次打开 Anki"设计的。
 * 本系统按天使用、界面文案也是「N 天后」，所以改用日粒度：
 * 答错后 1 天回补，而不是 10 分钟后再来一遍。
 */
const STEP: Steps = ['1d']

const scheduler = fsrs(
  generatorParameters({
    request_retention: REQUEST_RETENTION,
    maximum_interval: MAX_INTERVAL_DAYS,
    // 关闭随机抖动：同样的输入必须得到同样的排期，否则无法写单测断言。
    enable_fuzz: false,
    // 开启短期记忆模型，配合上面的日粒度步长。
    enable_short_term: true,
    learning_steps: STEP,
    relearning_steps: STEP,
  })
)

/** 四档评分：忘记 / 困难 / 记得 / 轻松 */
export type FsrsRating = Grade

export const RATING_LABEL: Record<number, string> = {
  [Rating.Again]: '忘记',
  [Rating.Hard]: '困难',
  [Rating.Good]: '记得',
  [Rating.Easy]: '轻松',
}

export { Rating, State }

/**
 * 可持久化的卡片状态。
 * ts-fsrs 的 Card 用 Date 对象，IndexedDB 里统一存 ISO 字符串。
 */
export interface FsrsCardState {
  /** 下次复习时间（ISO） */
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  /** 0=New 1=Learning 2=Review 3=Relearning */
  state: number
  last_review?: string | null
}

export function fromCard(card: Card): FsrsCardState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days ?? 0,
    scheduled_days: card.scheduled_days ?? 0,
    learning_steps: card.learning_steps ?? 0,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    state: Number(card.state),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  }
}

export function toCard(s: FsrsCardState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days ?? 0,
    scheduled_days: s.scheduled_days ?? 0,
    learning_steps: s.learning_steps ?? 0,
    reps: s.reps ?? 0,
    lapses: s.lapses ?? 0,
    state: Number(s.state),
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

/** 一张从未复习过的新卡片 */
export function emptyCardState(now: Date = new Date()): FsrsCardState {
  return fromCard(createEmptyCard(now))
}

/**
 * 用一次评分推进卡片，返回新状态。
 * 这是整个复习调度的唯一推进入口。
 */
export function advance(
  state: FsrsCardState,
  rating: FsrsRating,
  now: Date = new Date()
): FsrsCardState {
  const { card } = scheduler.next(toCard(state), now, rating)
  return fromCard(card)
}

/**
 * 当前可提取性 R ∈ (0,1)：此刻考一次，"想得起来"的概率。
 * 用于界面展示"记忆强度"。
 */
export function retrievability(state: FsrsCardState, now: Date = new Date()): number {
  const r = scheduler.get_retrievability(toCard(state), now, false)
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0
}

/** 距离下次复习还有多少天（负数=已逾期） */
export function daysUntilDue(state: FsrsCardState, now: Date = new Date()): number {
  return (new Date(state.due).getTime() - now.getTime()) / 86400000
}
