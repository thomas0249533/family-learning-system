import { describe, expect, it } from 'vitest'
import { buildStudyTip } from '@core/report/reportGenerator'

/**
 * V2.9 · 学习小贴士（buildStudyTip）纯函数回归。
 * 优先级链：无记录 → 到期复习 → 未攻克错题 → ≥90% → ≥60% → 学习中 → 连续天数 → 兜底。
 */
describe('buildStudyTip', () => {
  const base = {
    totalKnowledgePoints: 100,
    mastered: 60,
    learning: 20,
    needReview: 0,
    notStarted: 20,
    masteryRate: 60,
    continuousDays: 2,
    unmasteredMistakes: 0,
  }

  it('没有任何知识点 → 引导开始（最高优先级）', () => {
    expect(
      buildStudyTip({ ...base, totalKnowledgePoints: 0, mastered: 0, learning: 0, notStarted: 0, masteryRate: 0 })
    ).toContain('还没有学习记录')
  })

  it('有到期复习 → 建议先复习（压过错题/掌握率分支）', () => {
    const tip = buildStudyTip({ ...base, needReview: 5, unmasteredMistakes: 8, masteryRate: 95 })
    expect(tip).toContain('5 个知识点到了复习时间')
  })

  it('无到期但有未攻克错题 → 建议清错题', () => {
    expect(buildStudyTip({ ...base, unmasteredMistakes: 3 })).toContain('3 题待攻克')
  })

  it('掌握率 ≥ 90% → 保持性鼓励（压过 ≥60% 分支）', () => {
    const tip = buildStudyTip({ ...base, masteryRate: 92 })
    expect(tip).toContain('92%')
    expect(tip).toContain('冲刺')
  })

  it('掌握率 ≥ 60% → 主攻「学习中」', () => {
    expect(buildStudyTip({ ...base, masteryRate: 60, learning: 20 })).toContain('20 个知识点')
  })

  it('掌握率 < 60% 但有学习中 → 积少成多', () => {
    expect(buildStudyTip({ ...base, masteryRate: 40, learning: 7 })).toContain('7 个知识点正在学习中')
  })

  it('全学完但低掌握率 + 无学习中 + 连续 ≥ 3 天 → 打卡鼓励', () => {
    const tip = buildStudyTip({ ...base, masteryRate: 10, learning: 0, continuousDays: 5 })
    expect(tip).toContain('连续学习 5 天')
  })

  it('全兜底 → 开场鼓励', () => {
    expect(buildStudyTip({ ...base, masteryRate: 10, learning: 0, continuousDays: 1 })).toContain(
      '第一道题'
    )
  })
})
