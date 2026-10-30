import { describe, it, expect } from 'vitest'
import {
  normalizeDifficulty,
  difficultyOf,
  levelIndex,
  baseLevelOf,
  levelOf,
  selectSessionQuestions,
  describeShift,
} from '@core/plan/adaptive'

function q(d: string, id = d) {
  return { id, metadata: { difficulty: d } }
}

describe('normalizeDifficulty', () => {
  it('认三种中文档位', () => {
    expect(normalizeDifficulty('基础')).toBe('基础')
    expect(normalizeDifficulty('提高')).toBe('提高')
    expect(normalizeDifficulty('挑战')).toBe('挑战')
  })

  it('认英文别名', () => {
    expect(normalizeDifficulty('hard')).toBe('挑战')
    expect(normalizeDifficulty('medium')).toBe('提高')
    expect(normalizeDifficulty('basic')).toBe('基础')
  })

  it('脏值 / 缺失 / 非字符串一律按基础（宁可简单，不可一上手就劝退）', () => {
    expect(normalizeDifficulty(undefined)).toBe('基础')
    expect(normalizeDifficulty(null)).toBe('基础')
    expect(normalizeDifficulty(123)).toBe('基础')
    expect(normalizeDifficulty('  ')).toBe('基础')
    expect(normalizeDifficulty('很难')).toBe('基础')
  })

  it('difficultyOf 容忍缺 metadata 的题', () => {
    expect(difficultyOf({})).toBe('基础')
    expect(difficultyOf(null)).toBe('基础')
    expect(difficultyOf(undefined)).toBe('基础')
    expect(difficultyOf({ metadata: { difficulty: '挑战' } })).toBe('挑战')
  })

  it('levelIndex 单调', () => {
    expect(levelIndex('基础')).toBeLessThan(levelIndex('提高'))
    expect(levelIndex('提高')).toBeLessThan(levelIndex('挑战'))
  })
})

describe('baseLevelOf · 正确率 → 基准档位', () => {
  it('没做过题 → 基础', () => {
    expect(baseLevelOf({ correctCount: 0, wrongCount: 0 })).toBe('基础')
    expect(baseLevelOf({})).toBe('基础')
  })

  it('正确率 ≥85% → 挑战', () => {
    expect(baseLevelOf({ correctCount: 9, wrongCount: 1 })).toBe('挑战')
    expect(baseLevelOf({ correctCount: 17, wrongCount: 3 })).toBe('挑战')
  })

  it('60%–85% → 提高', () => {
    expect(baseLevelOf({ correctCount: 6, wrongCount: 4 })).toBe('提高')
    expect(baseLevelOf({ correctCount: 3, wrongCount: 2 })).toBe('提高')
  })

  it('<60% → 基础', () => {
    expect(baseLevelOf({ correctCount: 5, wrongCount: 5 })).toBe('基础')
    expect(baseLevelOf({ correctCount: 1, wrongCount: 9 })).toBe('基础')
  })

  it('有 BKT 掌握概率时用它（已含蒙对折扣），不看裸正确率', () => {
    // 3 对 1 错 = 75%，但 BKT 只有 0.3（蒙对）→ 基础
    expect(baseLevelOf({ correctCount: 3, wrongCount: 1, masteryProbability: 0.3 })).toBe('基础')
    // 5 对 5 错 = 50%，但 BKT 0.9 → 挑战
    expect(baseLevelOf({ correctCount: 5, wrongCount: 5, masteryProbability: 0.9 })).toBe('挑战')
  })
})

describe('levelOf · 连对升阶 / 连错降阶', () => {
  it('连对 3 次升一档', () => {
    expect(levelOf({ correctCount: 6, wrongCount: 4, correctStreak: 3 })).toBe('挑战')
  })

  it('连对 2 次还不升（阈值是 3）', () => {
    expect(levelOf({ correctCount: 6, wrongCount: 4, correctStreak: 2 })).toBe('提高')
  })

  it('连错 2 次降一档', () => {
    expect(levelOf({ correctCount: 6, wrongCount: 4, wrongStreak: 2 })).toBe('基础')
  })

  it('挑战档连对也只到挑战（不越界）', () => {
    expect(levelOf({ correctCount: 20, wrongCount: 0, correctStreak: 9 })).toBe('挑战')
  })

  it('基础档连错也只到基础（不越界）', () => {
    expect(levelOf({ correctCount: 0, wrongCount: 5, wrongStreak: 4 })).toBe('基础')
  })

  it('连对与连错同时存在时先升后降（净额可能抵消）', () => {
    // 理论冲突态：都以"连对优先"实现，再降一档 → 回原档
    expect(levelOf({ correctCount: 6, wrongCount: 4, correctStreak: 3, wrongStreak: 2 })).toBe('提高')
  })
})

describe('selectSessionQuestions · 挑题', () => {
  const pool = [
    q('基础', 'b1'), q('基础', 'b2'), q('基础', 'b3'), q('基础', 'b4'),
    q('提高', 'm1'), q('提高', 'm2'),
    q('挑战', 'h1'),
  ]

  it('题库为空 → 空数组', () => {
    expect(selectSessionQuestions([], '基础', 3)).toEqual([])
  })

  it('limit ≥ 题库量 → 全给，但按目标档位优先排', () => {
    const out = selectSessionQuestions(pool, '提高', 99)
    expect(out).toHaveLength(pool.length)
    expect(out[0].id).toBe('m1')
    expect(out[1].id).toBe('m2')
    // 目标档之后才是相邻档（基础与挑战都距提高 1 档，保持原顺序）
    expect(out.slice(2).map((x) => x.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'h1'])
  })

  it('目标档够用 → 只给目标档（不混档）', () => {
    const out = selectSessionQuestions(pool, '提高', 2)
    expect(out.map((x) => x.id)).toEqual(['m1', 'm2'])
  })

  it('目标档不够 → 先降阶补，再升阶补', () => {
    const out = selectSessionQuestions(pool, '提高', 4)
    expect(out.map((x) => x.id)).toEqual(['m1', 'm2', 'b1', 'b2'])
  })

  it('只有基础题时，挑战档也照样凑够 limit（不空转）', () => {
    const onlyBasic = [q('基础', 'b1'), q('基础', 'b2'), q('基础', 'b3')]
    const out = selectSessionQuestions(onlyBasic, '挑战', 3)
    expect(out).toHaveLength(3)
  })

  it('只有挑战题时，基础档也照样凑够 limit（不空转）', () => {
    const onlyHard = [q('挑战', 'h1'), q('挑战', 'h2')]
    const out = selectSessionQuestions(onlyHard, '基础', 2)
    expect(out.map((x) => x.id)).toEqual(['h1', 'h2'])
  })

  it('limit 非法（0 / 负数 / NaN）→ 当成"全都要"', () => {
    expect(selectSessionQuestions(pool, '基础', 0)).toHaveLength(pool.length)
    expect(selectSessionQuestions(pool, '基础', -5)).toHaveLength(pool.length)
    expect(selectSessionQuestions(pool, '基础', Number.NaN)).toHaveLength(pool.length)
  })

  it('不重复取题（同一道题不会出现两次）', () => {
    const out = selectSessionQuestions(pool, '基础', 7)
    const ids = out.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('缺 difficulty 的题按基础档参与（题库里常见）', () => {
    // 显式标注：直接写字面量会推成 `{id} | {id,metadata}` 的联合，TS 收窄不进去
    const mixed: Array<{ id: string; metadata?: { difficulty?: unknown } }> = [
      { id: 'x' },
      q('基础', 'b1'),
      q('提高', 'm1'),
    ]
    const out = selectSessionQuestions(mixed, '基础', 2)
    expect(out.map((x) => x.id)).toEqual(['x', 'b1'])
  })

  it('难度分布极不均（1 挑战 + 9 基础）时，提高档仍先拿提高，没有就降阶', () => {
    const skewed = [q('挑战', 'h1'), ...Array.from({ length: 9 }, (_, i) => q('基础', `b${i}`))]
    const out = selectSessionQuestions(skewed, '提高', 3)
    // 没有提高题 → 先降阶拿基础，而不是把唯一一道挑战题浪费掉
    expect(out.map((x) => x.id)).toEqual(['b0', 'b1', 'b2'])
  })
})

describe('describeShift · 预告文案', () => {
  it('升 / 降 / 不变三种说法', () => {
    expect(describeShift('基础', '提高')).toContain('换到提高')
    expect(describeShift('提高', '基础')).toContain('巩固基础')
    expect(describeShift('提高', '提高')).toBe('难度保持不变')
  })
})
