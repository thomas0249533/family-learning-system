import { describe, it, expect } from 'vitest'
import { deriveUnitKnowledgePointIds } from '@core/content/unitKnowledge'

// ============================================================================
// V2.6 · 任务1 根因回归：词汇包 unit.knowledgePointIds 为空，
// 词实际在 unit.topics[].modules[].knowledgePointIds —— 必须能兜底推导。
// ============================================================================

describe('deriveUnitKnowledgePointIds', () => {
  it('优先返回单元显式 knowledgePointIds', () => {
    const unit = { id: 'u1', knowledgePointIds: ['a', 'b'] }
    expect(deriveUnitKnowledgePointIds(unit)).toEqual(['a', 'b'])
  })

  it('单元 knowledgePointIds 为空数组时，从 topics/modules 汇总（真实词汇包形态）', () => {
    // 这正是 special-chinese-4-up-vocab.json 的结构：
    // unit.knowledgePointIds = []，词都在 topic.modules[0].knowledgePointIds
    const unit = {
      id: 'vocab-u1',
      knowledgePointIds: [],
      topics: [
        { id: 't1', modules: [{ type: 'chinese.words', knowledgePointIds: ['w1', 'w2'] }] },
        { id: 't2', modules: [{ type: 'chinese.words', knowledgePointIds: ['w3'] }] },
      ],
    }
    expect(deriveUnitKnowledgePointIds(unit)).toEqual(['w1', 'w2', 'w3'])
  })

  it('跨 topic/module 去重', () => {
    const unit = {
      topics: [
        { modules: [{ knowledgePointIds: ['w1', 'w2'] }] },
        { knowledgePointIds: ['w2', 'w3'], modules: [{ knowledgePointIds: ['w1'] }] },
      ],
    }
    expect(deriveUnitKnowledgePointIds(unit)).toEqual(['w1', 'w2', 'w3'])
  })

  it('兼容 mod.knowledgePoints 与 topic.knowledgePointIds 旧字段', () => {
    const unit = {
      topics: [
        { knowledgePointIds: ['t-kp'], modules: [{ knowledgePoints: ['legacy-1'] }] },
      ],
    }
    expect(deriveUnitKnowledgePointIds(unit)).toEqual(['legacy-1', 't-kp'])
  })

  it('空单元 / 缺失字段 → []（不抛异常）', () => {
    expect(deriveUnitKnowledgePointIds({})).toEqual([])
    expect(deriveUnitKnowledgePointIds({ topics: [] })).toEqual([])
    expect(deriveUnitKnowledgePointIds(null)).toEqual([])
  })
})
