import { describe, expect, it } from 'vitest'

/**
 * 描红（`StrokeOrderTrace`）的纯逻辑层。
 *
 * 这三段函数是"孩子描完看到什么话"的唯一来源，而 SFC 在本仓不可单测
 * （vitest 是 node 环境，没有 canvas）。所以判据必须钉在这里：
 * - 出格判定用**内框**而不是画布（用画布会把"横画拖长"整类漏掉）；
 * - 覆盖度分档的分界点是产品判断，改一个数字就会让提示从"再描一点"
 *   跳到"注意收笔"，属于必须被测试拦住的那类改动；
 * - 溢出优先于覆盖度（前者是当下就能改的动作问题）。
 */
import {
  TRACE_FRAME_RATIO,
  coverageTier,
  isOutsideFrame,
  traceFrameInset,
  traceHintOf,
} from '@core/handwriting/trace'

describe('traceFrameInset', () => {
  it('按比例算内框留白（尺寸无关）', () => {
    expect(traceFrameInset(300)).toBeCloseTo(300 * TRACE_FRAME_RATIO, 6)
    expect(traceFrameInset(600)).toBeCloseTo(600 * TRACE_FRAME_RATIO, 6)
  })

  it('非法尺寸返回 0（不产生 NaN 坐标）', () => {
    for (const v of [0, -10, NaN, Infinity, undefined as any, '300' as any]) {
      expect(traceFrameInset(v)).toBe(0)
    }
  })
})

describe('isOutsideFrame', () => {
  const SIZE = 300
  const inset = traceFrameInset(SIZE)

  it('格子中心与内框内的点不算出格', () => {
    expect(isOutsideFrame(SIZE / 2, SIZE / 2, SIZE)).toBe(false)
    expect(isOutsideFrame(inset + 1, inset + 1, SIZE)).toBe(false)
    expect(isOutsideFrame(SIZE - inset - 1, SIZE - inset - 1, SIZE)).toBe(false)
  })

  it('正好压在内框线上不算出格（< 而非 <=）', () => {
    expect(isOutsideFrame(inset, inset, SIZE)).toBe(false)
    expect(isOutsideFrame(SIZE - inset, SIZE - inset, SIZE)).toBe(false)
  })

  it('四边越界都判出格', () => {
    expect(isOutsideFrame(inset - 1, SIZE / 2, SIZE)).toBe(true)
    expect(isOutsideFrame(SIZE / 2, inset - 1, SIZE)).toBe(true)
    expect(isOutsideFrame(SIZE - inset + 1, SIZE / 2, SIZE)).toBe(true)
    expect(isOutsideFrame(SIZE / 2, SIZE - inset + 1, SIZE)).toBe(true)
  })

  it('画布边缘（内框之外）算写出格 —— 这正是"横画拖太长"的形态', () => {
    expect(isOutsideFrame(2, SIZE / 2, SIZE)).toBe(true)
    expect(isOutsideFrame(SIZE - 2, SIZE / 2, SIZE)).toBe(true)
  })

  it('脏坐标不判出格（宁可少一次提示，也不要在 NaN 上闪烁）', () => {
    expect(isOutsideFrame(NaN, 10, SIZE)).toBe(false)
    expect(isOutsideFrame(10, Infinity, SIZE)).toBe(false)
    expect(isOutsideFrame(10, 10, NaN)).toBe(false)
    expect(isOutsideFrame(10, 10, 0)).toBe(false)
  })
})

describe('coverageTier', () => {
  it('0 档不给徽标文案（没描过就别显示 0%）', () => {
    const t = coverageTier(0)
    expect(t.key).toBe('empty')
    expect(t.label).toBe('')
    expect(t.hint).toBe('')
  })

  it('四档分界点各归其位', () => {
    expect(coverageTier(1).key).toBe('light')
    expect(coverageTier(19).key).toBe('light')
    expect(coverageTier(20).key).toBe('half')
    expect(coverageTier(49).key).toBe('half')
    expect(coverageTier(50).key).toBe('good')
    expect(coverageTier(79).key).toBe('good')
    expect(coverageTier(80).key).toBe('full')
    expect(coverageTier(100).key).toBe('full')
  })

  it('徽标带百分号且取整', () => {
    expect(coverageTier(33.4).label).toBe('33%')
    expect(coverageTier(33.6).label).toBe('34%')
  })

  it('每档都有可执行的建议，且不含"错"字（描红不判对错）', () => {
    for (const p of [5, 30, 60, 95]) {
      const t = coverageTier(p)
      expect(t.hint.length).toBeGreaterThan(0)
      expect(t.hint).not.toContain('错')
    }
  })

  it('越界与脏值都夹到 0..100，不出现 NaN% / 120%', () => {
    expect(coverageTier(-5).key).toBe('empty')
    expect(coverageTier(120).key).toBe('full')
    expect(coverageTier(120).label).toBe('100%')
    expect(coverageTier(NaN).key).toBe('empty')
    // Infinity 当作"没有读数"而不是"100%"：非有限数在本仓一律走 isFiniteNumber 那条
    // 纪律（见 core/reading/ink.ts），读数坏掉时不该冒出一个满格徽标
    expect(coverageTier(Infinity).key).toBe('empty')
    expect(coverageTier(undefined as any).key).toBe('empty')
  })
})

describe('traceHintOf', () => {
  it('什么都没画时返回空串（由组件兜默认文案）', () => {
    expect(traceHintOf({ coverage: 0, overflow: false })).toBe('')
  })

  it('溢出优先于覆盖度：写飞了先说"收在格子里"', () => {
    const hint = traceHintOf({ coverage: 95, overflow: true })
    expect(hint).toContain('田字格')
    expect(hint).not.toBe(coverageTier(95).hint)
  })

  it('没溢出时就是覆盖度建议', () => {
    expect(traceHintOf({ coverage: 60, overflow: false })).toBe(coverageTier(60).hint)
  })

  it('入参畸形不炸', () => {
    expect(() => traceHintOf(undefined as any)).not.toThrow()
    expect(traceHintOf(undefined as any)).toBe('')
  })
})
