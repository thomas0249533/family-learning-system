import { describe, expect, it } from 'vitest'
import { evaluateRule, ruleMeasure } from '@core/motivation/customRule'
import { METRIC_META, type CounterMetric, type CustomRule } from '@core/motivation/customPackTypes'
import { ctx, mastered, prog } from './achievement-fixtures'

/**
 * 自定义规则求值测试（V1.4 · B3 / AC-P2-1、AC-P2-2 的求值侧）
 *
 * 这里刻意**不**造 db：`evaluateRule` / `ruleMeasure` 是纯函数，
 * 造一个假库只会把"它到底读不读库"这件事变得不可判定。
 *
 * 重点覆盖两类东西：
 *   1. 四个指标的**口径**（与 `achievementProgress.ts` 同口径，否则同一个孩子两个数字）；
 *   2. `Measure` 的 floor + clamp + kind 规则（与 `achievementProgress.counter` 同口径）。
 */

const counterRule = (metric: CounterMetric, target: number): CustomRule => ({
  kind: 'counter',
  metric,
  target,
})

const manualRule: CustomRule = { kind: 'manual-check', prompt: '做到了吗' }

/** 造一条合法 DailyStat（口径只关心 questionCount，但要满足类型） */
function day(date: string, questionCount: number) {
  return { date, questionCount, firstStudyAt: 0, lastStudyAt: 0 }
}

describe('指标口径（必须与 achievementProgress.ts 同源）', () => {
  it('masteredKp 只数「已掌握」的行', () => {
    const c = ctx({
      progress: [
        ...mastered('unit-math', 3),
        prog('unit-math', { knowledgePointId: 'unit-math::kp-x', status: '学习中' }),
        prog('unit-math', { knowledgePointId: 'unit-math::kp-y', status: '需复习' }),
        prog('unit-math', { knowledgePointId: 'unit-math::kp-z', status: '未学' }),
      ],
    })
    expect(evaluateRule(counterRule('masteredKp', 10), c)).toBe(3)
  })

  it('totalAttempts 是所有行 correctCount + wrongCount 之和（缺字段当 0）', () => {
    const c = ctx({
      progress: [
        prog('unit-math', { knowledgePointId: 'k1', correctCount: 2, wrongCount: 1 }),
        prog('unit-math', { knowledgePointId: 'k2', correctCount: 5, wrongCount: 0 }),
        // 老数据/半迁移态：字段可能整个缺失，不能算出 NaN
        prog('unit-math', { knowledgePointId: 'k3', correctCount: undefined, wrongCount: undefined }),
      ],
    })
    expect(evaluateRule(counterRule('totalAttempts', 100), c)).toBe(8)
  })

  it('studyDays 只数 questionCount > 0 的天（0 题那天不算学习日）', () => {
    const c = ctx({
      dailyStats: [day('2026-10-01', 0), day('2026-10-02', 5), day('2026-10-03', 1)],
    })
    expect(evaluateRule(counterRule('studyDays', 30), c)).toBe(2)
  })

  it('studyDays 对缺失的 dailyStats 返回 0 而不是抛错', () => {
    const c = ctx({ dailyStats: undefined })
    expect(evaluateRule(counterRule('studyDays', 30), c)).toBe(0)
  })

  it('streak 取 max(current, longest)：断签后仍按历史最长算', () => {
    expect(
      evaluateRule(counterRule('streak', 7), ctx({ streak: { current: 5, longest: 3, lastDate: '' } })),
    ).toBe(5)
    expect(
      evaluateRule(counterRule('streak', 7), ctx({ streak: { current: 0, longest: 30, lastDate: '' } })),
    ).toBe(30)
    expect(evaluateRule(counterRule('streak', 7), ctx())).toBe(0)
  })

  it('四个指标的 unit/noun 都来自 METRIC_META（没有第二套文案）', () => {
    for (const metric of ['masteredKp', 'totalAttempts', 'studyDays', 'streak'] as const) {
      const m = ruleMeasure(counterRule(metric, 10))(ctx())
      expect(m.unit).toBe(METRIC_META[metric].unit)
      expect(m.noun).toBe(METRIC_META[metric].noun)
    }
  })
})

describe('evaluateRule：返回原始值，不做截断', () => {
  it('超额时返回真实值（截断是 ruleMeasure 的展示决策）', () => {
    const c = ctx({ progress: mastered('unit-math', 12) })
    expect(evaluateRule(counterRule('masteredKp', 10), c)).toBe(12)
    expect(ruleMeasure(counterRule('masteredKp', 10))(c).current).toBe(10)
  })

  it('manual-check 恒为 0：勾选态不在库里，求值函数只负责「不参与计数」', () => {
    expect(evaluateRule(manualRule, ctx({ progress: mastered('unit-math', 99) }))).toBe(0)
  })

  it('未知 metric（绕过校验的脏数据）返回 0，不抛错', () => {
    const dirty = { kind: 'counter', metric: 'height', target: 10 } as unknown as CustomRule
    expect(evaluateRule(dirty, ctx({ progress: mastered('unit-math', 5) }))).toBe(0)
  })

  it('未知 kind（绕过校验的脏数据）返回 0，不抛错', () => {
    const dirty = { kind: 'expr', expr: 'masteredKp > 10' } as unknown as CustomRule
    expect(evaluateRule(dirty, ctx({ progress: mastered('unit-math', 5) }))).toBe(0)
    // 度量侧同样兜住：给一条恒 0 的 binary，而不是让页面崩
    const m = ruleMeasure(dirty)(ctx({ progress: mastered('unit-math', 5) }))
    expect(m).toMatchObject({ current: 0, target: 1, kind: 'binary' })
  })
})

describe('ruleMeasure：floor + clamp + kind（与 achievementProgress.counter 同口径）', () => {
  it('clamp 上界：永不超过 target', () => {
    const m = ruleMeasure(counterRule('masteredKp', 10))(ctx({ progress: mastered('unit-math', 12) }))
    expect(m).toMatchObject({ current: 10, target: 10, kind: 'counter' })
  })

  it('clamp 下界：脏数据里的负计数压成 0', () => {
    const c = ctx({
      progress: [prog('unit-math', { knowledgePointId: 'k1', correctCount: -5, wrongCount: -2 })],
    })
    expect(ruleMeasure(counterRule('totalAttempts', 10))(c).current).toBe(0)
  })

  it('floor：小数计数向下取整（脏数据也不该出现 1.9/10）', () => {
    const c = ctx({
      progress: [prog('unit-math', { knowledgePointId: 'k1', correctCount: 1.7, wrongCount: 0.2 })],
    })
    expect(ruleMeasure(counterRule('totalAttempts', 10))(c).current).toBe(1)
  })

  it('NaN 兜底为 0（进度条不能渲染成空白）', () => {
    const c = ctx({
      progress: [prog('unit-math', { knowledgePointId: 'k1', correctCount: NaN, wrongCount: 0 })],
    })
    expect(ruleMeasure(counterRule('totalAttempts', 10))(c).current).toBe(0)
  })

  it('target = 1 时 kind 降级为 binary（事件型文案「完成一次即可解锁」）', () => {
    const c = ctx({ progress: mastered('unit-math', 3) })
    expect(ruleMeasure(counterRule('masteredKp', 1))(c)).toMatchObject({
      current: 1,
      target: 1,
      kind: 'binary',
    })
    expect(ruleMeasure(counterRule('masteredKp', 2))(c).kind).toBe('counter')
  })

  it('target 脏值（0 / NaN / 小数）归一为 ≥1 的整数，不产生 0/0', () => {
    for (const bad of [0, -3, NaN, 2.6]) {
      const m = ruleMeasure(counterRule('masteredKp', bad))(ctx({ progress: mastered('unit-math', 1) }))
      expect(m.target).toBe(bad === 2.6 ? 2 : 1)
      expect(m.current).toBeLessThanOrEqual(m.target)
      expect(Number.isInteger(m.target)).toBe(true)
    }
  })

  it('manual-check 的度量是 0/1 binary（未勾选态，勾选态由视图层顶到 1）', () => {
    const m = ruleMeasure(manualRule)(ctx({ progress: mastered('unit-math', 99) }))
    expect(m).toMatchObject({ current: 0, target: 1, kind: 'binary', unit: '', noun: '' })
  })

  it('measure 工厂可复用：同一工厂换 ctx 就出不同数字，不残留上一次的值', () => {
    const measure = ruleMeasure(counterRule('masteredKp', 10))
    expect(measure(ctx({ progress: mastered('unit-math', 4) })).current).toBe(4)
    expect(measure(ctx({ progress: mastered('unit-math', 7) })).current).toBe(7)
    expect(measure(ctx()).current).toBe(0)
  })
})

describe('ruleMeasure 的量词/名词覆盖', () => {
  it('counter：override 优先于 METRIC_META', () => {
    const m = ruleMeasure(counterRule('masteredKp', 10), { unit: '关', noun: '关卡' })(
      ctx({ progress: mastered('unit-math', 2) }),
    )
    expect(m).toMatchObject({ unit: '关', noun: '关卡', current: 2, target: 10 })
  })

  it('counter：只覆盖 unit 时 noun 仍取指标默认值', () => {
    const m = ruleMeasure(counterRule('totalAttempts', 20), { unit: '道' })(ctx())
    expect(m.unit).toBe('道')
    expect(m.noun).toBe(METRIC_META.totalAttempts.noun)
  })

  it('空白覆盖视为「没覆盖」，回落到指标默认值', () => {
    const m = ruleMeasure(counterRule('studyDays', 30), { unit: '  ', noun: '' })(ctx())
    expect(m.unit).toBe(METRIC_META.studyDays.unit)
    expect(m.noun).toBe(METRIC_META.studyDays.noun)
  })

  it('manual-check 也支持覆盖（家长写「本」这类量词时不报错）', () => {
    const m = ruleMeasure(manualRule, { unit: '本', noun: '书' })(ctx())
    expect(m).toMatchObject({ unit: '本', noun: '书', current: 0, target: 1, kind: 'binary' })
  })
})
