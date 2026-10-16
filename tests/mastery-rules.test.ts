import { describe, expect, it } from 'vitest'
import { applyDecay, MASTERY_RULES, nextStatus, type MasteryInput } from '@core/mastery/masteryRules'

const base: MasteryInput = {
  correctCount: 0,
  wrongCount: 0,
  correctStreak: 0,
  wrongStreak: 0,
}

const rec = (o: Partial<MasteryInput>): MasteryInput => ({ ...base, ...o })

describe('nextStatus — 旧规则必须原样保留（不许降维）', () => {
  it('连续答对 ≥3 且正确率 ≥80% → 已掌握', () => {
    const r = { correctCount: 4, wrongCount: 1, correctStreak: 3, wrongStreak: 0 }
    expect(nextStatus('学习中', r, 0.95)).toBe('已掌握')
    expect(nextStatus('学习中', r, undefined)).toBe('已掌握') // 无概率信息时走旧路径
  })

  it('正确率不达标（<80%）即使连对 3 次也不算掌握', () => {
    // 3 对 3 错 → 正确率 50%
    const r = { correctCount: 4, wrongCount: 4, correctStreak: 3, wrongStreak: 0 }
    expect(nextStatus('学习中', r, 0.99)).toBe('学习中')
  })

  it('连续答错 ≥2 → 需复习', () => {
    expect(nextStatus('学习中', rec({ wrongStreak: 2, wrongCount: 2 }), 0.5)).toBe('需复习')
  })

  it('已掌握状态下连错 1 次 → 需复习', () => {
    expect(nextStatus('已掌握', rec({ correctCount: 5, wrongStreak: 1, wrongCount: 1 }), 0.9)).toBe('需复习')
  })

  it('需复习状态下连对 2 次 → 恢复已掌握', () => {
    expect(nextStatus('需复习', rec({ correctCount: 2, correctStreak: 2 }), 0.7)).toBe('已掌握')
  })

  it('未学状态下答对 1 次 → 学习中', () => {
    expect(nextStatus('未学', rec({ correctCount: 1, correctStreak: 1 }), 0.5)).toBe('学习中')
  })

  it('下降通道优先于上升通道（连错时不会被判已掌握）', () => {
    const r = { correctCount: 10, wrongCount: 3, correctStreak: 0, wrongStreak: 3 }
    expect(nextStatus('学习中', r, 0.99)).toBe('需复习')
  })
})

describe('nextStatus — BKT 概率带来的两项新增能力', () => {
  it('★ 防虚假掌握：概率过低时，即使满足旧规则也不给"已掌握"', () => {
    const r = { correctCount: 9, wrongCount: 1, correctStreak: 3, wrongStreak: 0 }
    // 概率 0.3 ≈ 全靠蒙
    expect(nextStatus('学习中', r, MASTERY_RULES.minProbabilityForMastered - 0.3)).not.toBe('已掌握')
    expect(nextStatus('学习中', r, 0.95)).toBe('已掌握')
  })

  it('★ 提前掌握：高置信度且一次没错时，不必再刷到第 3 次', () => {
    const r = { correctCount: 2, wrongCount: 0, correctStreak: 2, wrongStreak: 0 }
    expect(nextStatus('学习中', r, 0.93)).toBe('已掌握')
  })

  it('提前掌握要求一次都没错过', () => {
    const r = { correctCount: 5, wrongCount: 1, correctStreak: 2, wrongStreak: 0 }
    expect(nextStatus('学习中', r, 0.93)).not.toBe('已掌握')
  })

  it('提前掌握要求正确率性质的连对次数（1 次不够）', () => {
    const r = { correctCount: 1, wrongCount: 0, correctStreak: 1, wrongStreak: 0 }
    expect(nextStatus('学习中', r, 0.99)).toBe('学习中')
  })

  it('概率恰好等于门槛时算通过（边界包含）', () => {
    const r = { correctCount: 3, wrongCount: 0, correctStreak: 3, wrongStreak: 0 }
    expect(nextStatus('学习中', r, MASTERY_RULES.minProbabilityForMastered)).toBe('已掌握')
  })
})

describe('applyDecay — 久未学习的衰减', () => {
  const now = new Date('2026-10-15T09:00:00')
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86400000).toISOString()

  it('已掌握且刚学过 → 保持已掌握', () => {
    expect(applyDecay({ status: '已掌握', lastStudiedAt: daysAgo(1) }, now)).toBe('已掌握')
  })

  it('已掌握但超过衰减天数没学 → 需复习', () => {
    expect(
      applyDecay({ status: '已掌握', lastStudiedAt: daysAgo(MASTERY_RULES.reviewDecayDays + 1) }, now)
    ).toBe('需复习')
  })

  it('恰好等于衰减天数不衰减（边界）', () => {
    expect(
      applyDecay({ status: '已掌握', lastStudiedAt: daysAgo(MASTERY_RULES.reviewDecayDays) }, now)
    ).toBe('已掌握')
  })

  it('非已掌握状态不受衰减影响', () => {
    expect(applyDecay({ status: '学习中', lastStudiedAt: daysAgo(100) }, now)).toBe('学习中')
    expect(applyDecay({ status: '需复习', lastStudiedAt: daysAgo(100) }, now)).toBe('需复习')
    expect(applyDecay({ status: '未学', lastStudiedAt: daysAgo(100) }, now)).toBe('未学')
  })
})
