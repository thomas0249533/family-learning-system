import { describe, expect, it } from 'vitest'
import {
  BKT_CONFIDENT,
  BKT_DEFAULTS,
  bktPercent,
  guessProbFor,
  initBkt,
  isConfident,
  stateFromProbability,
  updateBkt,
  type BktState,
} from '@core/mastery/bkt'

/** 连续答对 n 次后的掌握度 */
function correctNTimes(n: number, guessProb: number): number {
  let s: BktState = initBkt()
  for (let i = 0; i < n; i++) s = updateBkt(s, true, guessProb)
  return s.pKnown
}

describe('guessProbFor — 蒙对率按题型区分，这是"猜对 vs 真会"的支点', () => {
  it('判断题最容易蒙（50%）', () => {
    expect(guessProbFor('judge')).toBe(0.5)
  })

  it('单选题按选项数量算蒙对率', () => {
    expect(guessProbFor('single', 4)).toBe(0.25)
    expect(guessProbFor('single', 3)).toBeCloseTo(0.33, 2)
    expect(guessProbFor('single')).toBe(0.25) // 缺省按 4 选项
  })

  it('填空/拼写几乎蒙不中', () => {
    expect(guessProbFor('blank')).toBe(0.05)
    expect(guessProbFor('spelling')).toBe(0.05)
  })

  it('未知题型走保守默认值，不会返回 0（否则贝叶斯会除零）', () => {
    expect(guessProbFor(undefined)).toBeGreaterThan(0)
    expect(guessProbFor('unknown-type')).toBeGreaterThan(0)
  })
})

describe('updateBkt — 同一份"答对"证据，题型不同则含金量不同', () => {
  it('★ 填空题答对 2 次 vs 判断题答对 2 次：前者高得多', () => {
    const blank2 = correctNTimes(2, guessProbFor('blank'))
    const judge2 = correctNTimes(2, guessProbFor('judge'))
    expect(blank2).toBeGreaterThan(judge2)
    expect(blank2 - judge2).toBeGreaterThan(0.2)
  })

  it('★ 抗蒙题：判断题需要更多证据才能判"稳定掌握"', () => {
    const blank2 = correctNTimes(2, guessProbFor('blank'))
    const judge2 = correctNTimes(2, guessProbFor('judge'))
    const judge5 = correctNTimes(5, guessProbFor('judge'))

    expect(blank2).toBeGreaterThanOrEqual(BKT_CONFIDENT) // 填空题两次就够
    expect(judge2).toBeLessThan(BKT_CONFIDENT) // 判断题两次不够
    expect(judge5).toBeGreaterThan(judge2) // 但继续答对会持续上升
  })

  it('答错会显著拉低掌握度', () => {
    let s = initBkt()
    for (let i = 0; i < 3; i++) s = updateBkt(s, true, 0.05)
    const before = s.pKnown
    const after = updateBkt(s, false, 0.05)
    expect(after.pKnown).toBeLessThan(before)
  })

  it('概率始终落在开区间 (0,1)，不会退化到 0 或 1', () => {
    let s = initBkt()
    for (let i = 0; i < 60; i++) {
      s = updateBkt(s, i % 7 !== 0, 0.05)
      expect(s.pKnown).toBeGreaterThan(0)
      expect(s.pKnown).toBeLessThan(1)
    }
  })

  it('观测次数逐次累加', () => {
    let s = initBkt()
    expect(s.observed).toBe(0)
    for (let i = 1; i <= 4; i++) {
      s = updateBkt(s, true, 0.2)
      expect(s.observed).toBe(i)
    }
  })

  it('全错不会把概率压成 0（保留"可能只是失误"的余地）', () => {
    let s = initBkt()
    for (let i = 0; i < 10; i++) s = updateBkt(s, false, 0.05)
    expect(s.pKnown).toBeGreaterThan(0)
  })

  it('异常入参不产生 NaN', () => {
    const s = updateBkt({ pKnown: 0.5, observed: 1 }, true, Number.NaN)
    expect(Number.isFinite(s.pKnown)).toBe(true)
  })
})

describe('展示与判定辅助', () => {
  it('bktPercent：未观测过返回 null（避免展示无意义的先验值）', () => {
    expect(bktPercent(null)).toBeNull()
    expect(bktPercent(initBkt())).toBeNull()
    expect(bktPercent({ pKnown: 0.834, observed: 2 })).toBe(83)
  })

  it('isConfident：达到门槛才算稳定掌握', () => {
    expect(isConfident(initBkt())).toBe(false)
    expect(isConfident({ pKnown: BKT_CONFIDENT, observed: 3 })).toBe(true)
    expect(isConfident({ pKnown: BKT_CONFIDENT - 0.01, observed: 3 })).toBe(false)
  })

  it('stateFromProbability：老数据只有概率数字时也能还原', () => {
    expect(stateFromProbability(undefined)).toBeNull()
    expect(stateFromProbability(0.7)).toEqual({ pKnown: 0.7, observed: 1 })
  })

  it('默认参数物理含义合理（先验 < 稳定掌握门槛）', () => {
    expect(BKT_DEFAULTS.pInit).toBeGreaterThan(0)
    expect(BKT_DEFAULTS.pInit).toBeLessThan(BKT_CONFIDENT)
    expect(BKT_DEFAULTS.pSlip).toBeGreaterThan(0)
    expect(BKT_DEFAULTS.pSlip).toBeLessThan(0.5)
  })
})
