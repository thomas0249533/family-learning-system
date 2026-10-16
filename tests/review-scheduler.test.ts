import { describe, expect, it } from 'vitest'
import {
  computeNextReview,
  humanizeNextReview,
  isDueForReview,
  isSameDay,
  legacyCardFromStage,
  memoryStrengthLabel,
  rateFromOutcome,
  retrievabilityPercent,
  REVIEW_INTERVALS_DAYS,
  scheduleReview,
  shouldAdvanceSchedule,
  stageFromInterval,
  stageLabel,
} from '@core/review/reviewScheduler'
import { Rating } from '@core/review/fsrs'

const DAY = 86400000
const T0 = new Date('2026-10-15T09:00:00Z')
/** 在 T0 之后 n 天的时刻 */
const at = (n: number) => new Date(T0.getTime() + n * DAY)

// ---------------------------------------------------------------- 评分推断

describe('rateFromOutcome — 把孩子这一端的"对/错"自动翻译成 FSRS 四档评分', () => {
  it('答错 → 忘记 (Again)', () => {
    expect(rateFromOutcome({ isCorrect: false, correctStreak: 5 })).toBe(Rating.Again)
  })

  it('刚答错过、这次补上了 → 困难 (Hard)', () => {
    expect(rateFromOutcome({ isCorrect: true, everWrong: true, correctStreak: 1 })).toBe(Rating.Hard)
  })

  it('连续答对≥3 且秒答 → 轻松 (Easy)', () => {
    expect(
      rateFromOutcome({ isCorrect: true, correctStreak: 3, elapsedMs: 4000 })
    ).toBe(Rating.Easy)
  })

  it('连续答对但磨蹭 → 只给「记得」，不给「轻松」', () => {
    expect(
      rateFromOutcome({ isCorrect: true, correctStreak: 4, elapsedMs: 45000 })
    ).toBe(Rating.Good)
  })

  it('没有耗时信息时不会误判成「轻松」', () => {
    expect(rateFromOutcome({ isCorrect: true, correctStreak: 9 })).toBe(Rating.Good)
  })

  it('答错之后即使很快，也不会给「轻松」', () => {
    expect(
      rateFromOutcome({ isCorrect: false, correctStreak: 0, elapsedMs: 1000 })
    ).toBe(Rating.Again)
  })
})

// ---------------------------------------------------------------- 排期推进

describe('scheduleReview — 用评分推进排期', () => {
  it('新卡片答对 → 下次复习落在未来，且至少间隔 1 天', () => {
    const r = scheduleReview({ rating: Rating.Good, now: T0 })
    const days = (new Date(r.nextReviewAt).getTime() - T0.getTime()) / DAY
    expect(days).toBeGreaterThanOrEqual(1)
    expect(r.reviewStage).toBeGreaterThanOrEqual(0)
    expect(r.reviewStage).toBeLessThan(REVIEW_INTERVALS_DAYS.length)
    expect(new Date(r.lastReviewAt).getTime()).toBe(T0.getTime())
  })

  it('答错的复习间隔明显短于答对（错误要被及时回补）', () => {
    const wrong = scheduleReview({ rating: Rating.Again, now: T0 })
    const right = scheduleReview({ rating: Rating.Good, now: T0 })
    expect(new Date(wrong.nextReviewAt).getTime()).toBeLessThan(
      new Date(right.nextReviewAt).getTime()
    )
  })

  it('连续答对时间隔单调不减、记忆稳定性单调递增', () => {
    let card = scheduleReview({ rating: Rating.Good, now: T0 }).card
    let prevDays = card.scheduled_days
    let prevStability = card.stability
    let cursor = T0

    for (let i = 0; i < 5; i++) {
      cursor = new Date(cursor.getTime() + card.scheduled_days * DAY)
      card = scheduleReview({ card, rating: Rating.Good, now: cursor }).card
      expect(card.scheduled_days).toBeGreaterThanOrEqual(prevDays)
      expect(card.stability).toBeGreaterThan(prevStability)
      prevDays = card.scheduled_days
      prevStability = card.stability
    }
  })

  it('答错会显著压低记忆稳定性（lapses 计数增加）', () => {
    let card = scheduleReview({ rating: Rating.Good, now: T0 }).card
    card = scheduleReview({ card, rating: Rating.Good, now: at(3) }).card
    card = scheduleReview({ card, rating: Rating.Good, now: at(12) }).card
    const before = card.stability

    const lapsed = scheduleReview({ card, rating: Rating.Again, now: at(40) }).card
    expect(lapsed.stability).toBeLessThan(before)
    expect(lapsed.lapses).toBeGreaterThan(card.lapses)
  })

  it('「轻松」得到的间隔不小于「记得」', () => {
    const good = scheduleReview({ rating: Rating.Good, now: T0 })
    const easy = scheduleReview({ rating: Rating.Easy, now: T0 })
    expect(new Date(easy.nextReviewAt).getTime()).toBeGreaterThanOrEqual(
      new Date(good.nextReviewAt).getTime()
    )
  })
})

// -------------------------------------------------- 每日只推进一次的关键闸门

describe('shouldAdvanceSchedule — 同一天内不重复推进（防止一节课把间隔顶爆）', () => {
  it('从未复习过 → 推进', () => {
    expect(shouldAdvanceSchedule(null, true, T0)).toBe(true)
  })

  it('今天已经推进过、这次又答对 → 不推进', () => {
    expect(shouldAdvanceSchedule(T0.toISOString(), true, at(0))).toBe(false)
  })

  it('今天已经推进过、这次答错 → 仍然推进（错误必须立刻回补）', () => {
    expect(shouldAdvanceSchedule(T0.toISOString(), false, at(0))).toBe(true)
  })

  it('上次是昨天 → 推进', () => {
    expect(shouldAdvanceSchedule(T0.toISOString(), true, at(1))).toBe(true)
  })

  it('模拟真实课堂：同一知识点一节课连答对 8 次，间隔不会被顶到天上', () => {
    let card = scheduleReview({ rating: Rating.Good, now: T0 }).card
    let lastReview: string = T0.toISOString()
    const firstInterval = card.scheduled_days

    // 同一天里又答对 7 次
    for (let i = 0; i < 7; i++) {
      const t = new Date(T0.getTime() + (i + 1) * 60000) // 每分钟一题
      if (shouldAdvanceSchedule(lastReview, true, t)) {
        card = scheduleReview({ card, rating: Rating.Good, now: t }).card
        lastReview = t.toISOString()
      }
    }

    expect(card.scheduled_days).toBe(firstInterval)
    expect(card.scheduled_days).toBeLessThan(30)
  })
})

// ------------------------------------------------------- 老数据平滑过渡

describe('legacyCardFromStage — 升级前的老进度记录平滑接管', () => {
  it('阶段 0 折算成一张新卡片', () => {
    const c = legacyCardFromStage(0, T0)
    expect(c.reps).toBe(0)
    expect(c.stability).toBe(0)
  })

  it('阶段 N 折算成对应天数稳定度', () => {
    for (let s = 1; s < REVIEW_INTERVALS_DAYS.length; s++) {
      const c = legacyCardFromStage(s, T0)
      expect(c.stability).toBe(REVIEW_INTERVALS_DAYS[s])
      expect(c.scheduled_days).toBe(REVIEW_INTERVALS_DAYS[s])
      expect(c.reps).toBe(s)
    }
  })

  it('越界的阶段被夹取到合法范围', () => {
    expect(() => legacyCardFromStage(999, T0)).not.toThrow()
    expect(legacyCardFromStage(-5, T0).reps).toBe(0)
  })
})

describe('stageFromInterval — 把间隔折算回界面用的 0~6 阶段', () => {
  it('区间映射单调不减', () => {
    let prev = -1
    for (const d of [0.5, 1, 2, 4, 7, 15, 30, 60, 120, 365]) {
      const s = stageFromInterval(d)
      expect(s).toBeGreaterThanOrEqual(prev)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(REVIEW_INTERVALS_DAYS.length)
      prev = s
    }
  })

  it('非法输入不炸，退化为 0', () => {
    expect(stageFromInterval(Number.NaN)).toBe(0)
    expect(stageFromInterval(-1)).toBe(0)
  })
})

// ------------------------------------------------------- 旧签名兼容性

describe('computeNextReview — 旧签名必须继续可用（零连带改动）', () => {
  it('返回结构保持 { reviewStage, nextReviewAt, lastReviewAt }', () => {
    const r = computeNextReview(0, true, T0)
    expect(Object.keys(r).sort()).toEqual(['lastReviewAt', 'nextReviewAt', 'reviewStage'])
    expect(typeof r.reviewStage).toBe('number')
    expect(new Date(r.nextReviewAt).getTime()).toBeGreaterThan(T0.getTime())
    expect(new Date(r.lastReviewAt).getTime()).toBe(T0.getTime())
  })

  it('答对会推进、答错会回落', () => {
    const up = computeNextReview(3, true, T0)
    const down = computeNextReview(5, false, T0)
    expect(up.reviewStage).toBeGreaterThanOrEqual(0)
    expect(down.reviewStage).toBeLessThan(5)
  })

  it('任意阶段输入都不会抛异常', () => {
    for (const s of [-1, 0, 1, 3, 6, 99]) {
      expect(() => computeNextReview(s, true, T0)).not.toThrow()
      expect(() => computeNextReview(s, false, T0)).not.toThrow()
    }
  })
})

describe('展示用函数（Review.vue / Home.vue 依赖，行为不能变）', () => {
  it('isDueForReview：无排期不算到期，过期算到期', () => {
    expect(isDueForReview({})).toBe(false)
    expect(isDueForReview({ nextReviewAt: new Date(Date.now() - DAY).toISOString() })).toBe(true)
    expect(isDueForReview({ nextReviewAt: new Date(Date.now() + DAY).toISOString() })).toBe(false)
  })

  it('humanizeNextReview：未安排 / 现在 / N 天后 / N 小时后', () => {
    expect(humanizeNextReview(undefined)).toBe('未安排')
    expect(humanizeNextReview(new Date(Date.now() - DAY).toISOString())).toBe('现在该复习了')
    expect(humanizeNextReview(new Date(Date.now() + 3 * DAY).toISOString())).toBe('3 天后')
    expect(humanizeNextReview(new Date(Date.now() + 5 * 3600000).toISOString())).toBe('5 小时后')
  })

  it('stageLabel：越界不返回 undefined', () => {
    expect(stageLabel(0)).toBe('第 1 次')
    expect(stageLabel(6)).toBe('已稳固')
    expect(stageLabel(99)).toBe('已稳固')
    expect(stageLabel(undefined)).toBe('未安排')
  })

  it('isSameDay：按自然日比较，且不因 UTC 偏移误判', () => {
    expect(isSameDay('2026-10-15T00:10:00', new Date(2026, 9, 15, 23, 50))).toBe(true)
    expect(isSameDay('2026-10-14T23:50:00', new Date(2026, 9, 15, 0, 10))).toBe(false)
    expect(isSameDay(null, new Date())).toBe(false)
  })

  it('retrievabilityPercent / memoryStrengthLabel：新卡片返回 null 而不是 0', () => {
    expect(retrievabilityPercent(null)).toBeNull()
    expect(memoryStrengthLabel(null)).toBe('尚未复习')
    expect(memoryStrengthLabel(90)).toBe('记忆牢固')
    expect(memoryStrengthLabel(50)).toBe('需要复习')
  })
})
