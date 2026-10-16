import { describe, expect, it } from 'vitest'
import {
  applyMistakeReview,
  MISTAKE_LEVEL_LABEL,
  MISTAKE_REQUIRED_CORRECT,
  mistakeLevel,
  mistakeReviewCount,
  needsReview,
} from '@core/mistake/mistakeRules'

describe('mistakeLevel — 老数据（只有 mastered 布尔值）平滑折算', () => {
  it('mastered=true → 已掌握', () => {
    expect(mistakeLevel({ mastered: true })).toBe('mastered')
  })

  it('mastered=false → 未掌握', () => {
    expect(mistakeLevel({ mastered: false })).toBe('none')
  })

  it('已有三级字段时以它为准', () => {
    expect(mistakeLevel({ masteryLevel: 'partial', mastered: true })).toBe('partial')
  })

  it('两个字段都缺失时保守地按未掌握处理', () => {
    expect(mistakeLevel({})).toBe('none')
  })
})

describe('mistakeReviewCount — 老数据折算复习答对次数', () => {
  it('显式存在时直接采用', () => {
    expect(mistakeReviewCount({ reviewCorrectCount: 3 })).toBe(3)
  })

  it('已掌握折算出满额次数', () => {
    expect(mistakeReviewCount({ masteryLevel: 'mastered' })).toBe(MISTAKE_REQUIRED_CORRECT)
  })

  it('部分掌握折算出 1 次', () => {
    expect(mistakeReviewCount({ masteryLevel: 'partial' })).toBe(1)
  })

  it('未掌握折算为 0', () => {
    expect(mistakeReviewCount({ masteryLevel: 'none', mastered: false })).toBe(0)
  })
})

describe('applyMistakeReview — 三级状态推进', () => {
  it('未掌握 → 答对 1 次 → 部分掌握（仍留在错题本）', () => {
    const r = applyMistakeReview('none', 0, true)
    expect(r.level).toBe('partial')
    expect(r.reviewCorrectCount).toBe(1)
    expect(r.mastered).toBe(false)
    expect(needsReview(r.level)).toBe(true)
  })

  it('部分掌握 → 再答对 → 已掌握（移出待复习）', () => {
    const r = applyMistakeReview('partial', 1, true)
    expect(r.level).toBe('mastered')
    expect(r.mastered).toBe(true)
    expect(needsReview(r.level)).toBe(false)
  })

  it('★ 必须"连续"答对：部分掌握后又答错 → 直接退回未掌握并清零', () => {
    const r = applyMistakeReview('partial', 1, false)
    expect(r.level).toBe('none')
    expect(r.reviewCorrectCount).toBe(0)
    expect(r.mastered).toBe(false)
  })

  it('★ 已掌握的题又答错 → 复活回未掌握（错题不能凭空消失）', () => {
    const r = applyMistakeReview('mastered', MISTAKE_REQUIRED_CORRECT, false)
    expect(r.level).toBe('none')
    expect(r.mastered).toBe(false)
  })

  it('已掌握的题继续答对 → 保持已掌握且计数继续累加', () => {
    const r = applyMistakeReview('mastered', MISTAKE_REQUIRED_CORRECT, true)
    expect(r.level).toBe('mastered')
    expect(r.mastered).toBe(true)
  })

  it('任意状态 + 任意次数组合都不抛异常', () => {
    const levels = ['none', 'partial', 'mastered'] as const
    for (const lv of levels) {
      for (const n of [0, 1, 2, 5]) {
        expect(() => applyMistakeReview(lv, n, true)).not.toThrow()
        expect(() => applyMistakeReview(lv, n, false)).not.toThrow()
      }
    }
  })

  it('三级标签齐备，界面不会出现空标签', () => {
    expect(MISTAKE_LEVEL_LABEL.none).toBeTruthy()
    expect(MISTAKE_LEVEL_LABEL.partial).toBeTruthy()
    expect(MISTAKE_LEVEL_LABEL.mastered).toBeTruthy()
  })
})
