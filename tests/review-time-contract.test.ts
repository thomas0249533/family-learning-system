import { describe, expect, it } from 'vitest'
import { daysUntilDue, emptyCardState, fromCard, Rating, toCard } from '@core/review/fsrs'
import { isSameDay, legacyCardFromStage, scheduleReview } from '@core/review/reviewScheduler'

/**
 * V1.10 Stage E · E1-a 排期时间口径契约测试
 * ---------------------------------------------------------------------
 * E1-a 审计结论（详见 docs/memory/2026-10-22-v1.10-stage-e.md）：
 * fsrs.ts / reviewScheduler.ts 把 `due` / `last_review` 序列化成 **UTC 全时刻**
 * （`toISOString()`，Z 结尾），而仓库的日期口径纪律（tests/date-discipline.test.ts
 * 文件头）已裁定：**序列化时间戳是 toISOString 的正当用途，只要不截成"日键"就与
 * 本地口径无关**。审计逐一验证了全部消费端都走 `new Date(...)` 时刻比较
 * （toCard / daysUntilDue / isSameDay / isDueForReview / humanizeNextReview /
 * weakPoints 的 due / applyDecay），因此**不需要迁移、不需要 v5**。
 *
 * 本文件把两条容易被忘记的隐式契约钉住：
 *   1. **写入口格式契约**：mergeProgress 的 cmp() 用字典序比较 lastReviewAt
 *      （"更晚者胜"），字典序只有在**同格式**下才等于时间序。任何写入口改成
 *      带偏移格式（+08:00）都会让混合格式的字典序失效——更早的瞬时可能胜出，
 *      直接违反"单调不减"。谁要改格式，先在这里红，然后必须连 cmp 一起改。
 *   2. **时刻比较契约**：所有"是否同一天 / 还有几天"必须解析成时刻再算，
 *      不许对时间戳字符串切片比日（本仓踩过的那类坑）。
 */

/** UTC 全时刻：`2026-10-15T12:00:00.000Z`。Date.prototype.toISOString 的固定形态。 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('写入口格式契约：排期时间戳一律 UTC 全时刻（mergeProgress.cmp 依赖它）', () => {
  it('★ emptyCardState / scheduleReview / legacyCardFromStage 的输出全部匹配', () => {
    const now = new Date(2026, 9, 15, 20, 30) // 本地晚 20:30（东八区下 UTC 是 12:30）
    const state = emptyCardState(now)
    expect(state.due).toMatch(ISO_INSTANT)

    const s = scheduleReview({ rating: Rating.Good, now })
    expect(s.nextReviewAt).toMatch(ISO_INSTANT)
    expect(s.lastReviewAt).toMatch(ISO_INSTANT)
    expect(s.card.due).toMatch(ISO_INSTANT)
    expect(s.card.last_review == null || ISO_INSTANT.test(s.card.last_review)).toBe(true)

    expect(legacyCardFromStage(3, now).due).toMatch(ISO_INSTANT)
  })

  it('fromCard 序列化保持 Z 结尾（ts-fsrs 的 Card → 可持久化状态）', () => {
    const now = new Date(2026, 9, 15, 20, 30)
    const round = fromCard(toCard(emptyCardState(now)))
    expect(round.due).toMatch(ISO_INSTANT)
    // 往返不丢瞬时精度
    expect(new Date(round.due).getTime()).toBe(now.getTime())
  })
})

describe('时刻比较契约：不切字符串，一律解析成时刻', () => {
  it('★ 清晨学的与当天晚上算同一天（UTC 串的日期部分可能属于前一天）', () => {
    // 本地 10-16 07:00 学的 → 东八区下 toISOString = '2026-10-15T23:00:00.000Z'。
    // 若 isSameDay 退化成"切字符串比日"，同一个早晨的第二次答题会被允许
    // 再推进一次排期（shouldAdvanceSchedule 的"一天只推进一次"当场失效）。
    // TZ 安全性：UTC 时区下该瞬时本就不跨 UTC 日，用例仍为绿，不会假红。
    const now = new Date(2026, 9, 16, 7, 30)
    const lastReview = new Date(2026, 9, 16, 7, 0)
    expect(isSameDay(lastReview.toISOString(), now)).toBe(true)
  })

  it('跨到本地次日就是不同天（闸门不能被"都是 UTC 同日"蒙混）', () => {
    const now = new Date(2026, 9, 16, 7, 30)
    const yesterday = new Date(2026, 9, 15, 23, 0)
    expect(isSameDay(yesterday.toISOString(), now)).toBe(false)
  })

  it('daysUntilDue 跨 20:00 边界按瞬时差算，不按 UTC 日相减', () => {
    const now = new Date(2026, 9, 15, 20, 0) // 本地 15 日 20:00
    const state = {
      ...emptyCardState(now),
      // 本地次日 04:00 = 东八区下 UTC 当日 20:00（due 串的"日期部分"是 15 日）
      due: new Date(2026, 9, 16, 4, 0).toISOString(),
    }
    // 本地口径还有整整 8 小时；按 UTC 日串相减会被误判成"已逾期"
    expect(daysUntilDue(state, now)).toBeCloseTo(8 / 24, 5)
  })

  it('空/乱码时间戳不会把 isSameDay 抛炸（NaN 一律 false）', () => {
    const now = new Date(2026, 9, 16, 7, 30)
    expect(isSameDay(null, now)).toBe(false)
    expect(isSameDay('', now)).toBe(false)
    expect(isSameDay('not-a-date', now)).toBe(false)
  })
})
