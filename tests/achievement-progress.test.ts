import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '@core/motivation/achievements'
import {
  EVIDENCE_MAX,
  HIDDEN_NO_PROGRESS,
  MEASURABLE_IDS,
  evidenceOf,
  progressOf,
  progressText,
  type Measure,
} from '@core/motivation/achievementProgress'
import { ctx, mastered, mistake, pkg, prog, scenarios } from './achievement-fixtures'

/**
 * 成就**进度**测试（V1.3 · A-02，对应 PRD AC-03 / AC-04 / AC-04b）
 *
 * 这套用例存在的唯一理由：`progressOf` 与 `check()` 是两份实现（一个算数值、一个判布尔），
 * 漂移了就会出现"进度满格但不亮"或"亮了但进度 8/10"。所以这里用
 * **场景表 × 28 枚** 逐条断言 `current >= target ⇔ check(ctx)`，
 * 而不是抽几个样本看看。
 */

const HIDDEN = new Set<string>(HIDDEN_NO_PROGRESS)

describe('覆盖率与可进度化口径（AC-03）', () => {
  it('可进度化正好 25 枚', () => {
    expect(MEASURABLE_IDS).toHaveLength(25)
  })

  it('3 枚隐藏成就永远不可进度化（progressOf → null）', () => {
    expect([...HIDDEN].sort()).toEqual(['comeback', 'early-bird', 'night-owl'])
    for (const id of HIDDEN_NO_PROGRESS) {
      // 连"富上下文"下也必须是 null：不是"现在为 0"，是"设计上不给"
      expect(progressOf(id, scenarios()['全达标'])).toBeNull()
      expect(progressOf(id, ctx())).toBeNull()
    }
  })

  it('25 + 3 = 28，没有既不在度量表也不在隐藏表里的孤儿', () => {
    const union = new Set<string>([...MEASURABLE_IDS, ...HIDDEN])
    expect(union.size).toBe(ACHIEVEMENTS.length)
    for (const a of ACHIEVEMENTS) expect(union.has(a.id)).toBe(true)
  })

  it('未知 id 返回 null 而不是抛错（防御脏数据）', () => {
    expect(progressOf('no-such-achievement', ctx())).toBeNull()
  })
})

describe('★ 进度与判定必须等价：current >= target ⇔ check(ctx)（AC-04）', () => {
  const table = scenarios()

  for (const [name, c] of Object.entries(table)) {
    it(`${name}：25 枚逐条一致`, () => {
      for (const id of MEASURABLE_IDS) {
        const def = ACHIEVEMENTS.find((a) => a.id === id)!
        const m = progressOf(id, c)!
        expect(m, `${id} 缺进度`).not.toBeNull()
        expect(
          m.current >= m.target,
          `${name} / ${id}：进度 ${m.current}/${m.target} 但 check=${def.check(c)}`,
        ).toBe(def.check(c))
      }
    })
  }

  it('场景表覆盖了 0 值 / 临界值 / 达标 / 超额（AC-04 要求 ≥6 组）', () => {
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(6)
    expect(table['0 值']).toBeDefined()
    expect(table['临界值']).toBeDefined()
    expect(table['超额-单维']).toBeDefined()
    expect(table['门槛未满足']).toBeDefined()
  })

  it('隐藏成就只能靠 check 判定（进度恒 null）', () => {
    const full = table['全达标']
    for (const id of HIDDEN_NO_PROGRESS) {
      const def = ACHIEVEMENTS.find((a) => a.id === id)!
      expect(progressOf(id, full)).toBeNull()
      expect(typeof def.check(full)).toBe('boolean')
    }
  })
})

describe('current 恒在 [0, target]（AC-03 后半句）', () => {
  it('任何场景下都不出现 11/10 或负数', () => {
    for (const c of Object.values(scenarios())) {
      for (const id of MEASURABLE_IDS) {
        const m = progressOf(id, c)!
        expect(m.current).toBeGreaterThanOrEqual(0)
        expect(m.current).toBeLessThanOrEqual(m.target)
        expect(Number.isInteger(m.current)).toBe(true)
      }
    }
  })

  it('超额也只显示到目标值（300 个知识点 → 100/100 而不是 300/100）', () => {
    const m = progressOf('hundred-kp', scenarios()['超额-单维'])!
    expect(m.target).toBe(100)
    expect(m.current).toBe(100)
  })
})

describe('★ 纯函数：无状态、禁止缓存历史最大值（AC-04b）', () => {
  it('同一份数据连调两次结果完全一致', () => {
    const c = scenarios()['临界值']
    for (const id of MEASURABLE_IDS) {
      const a = progressOf(id, c)!
      const b = progressOf(id, c)!
      expect(a).toEqual(b)
    }
  })

  it('数据变化后进度**允许变小**（这正是"不缓存最大值"的证明）', () => {
    const before = progressOf('ten-kp', scenarios()['临界值'])!
    expect(before.current).toBe(10)

    // 学生退步 / 包被删 → 已掌握数掉到 6
    const after = progressOf('ten-kp', ctx({
      progress: mastered('unit-math', 6),
      packages: [pkg('unit-math', 'math', 100)],
    }))!
    expect(after.current).toBe(6)
    expect(after.current).toBeLessThan(before.current)
  })

  it('不读取时间：同一 ctx 在不同时刻调用结果一致（streak 用 longest 而非 now）', () => {
    // 断签场景：longest=30 但 current=0，用 bestStreak(now) 会随"今天是哪天"变化
    const c = scenarios()['连续中断']
    const m1 = progressOf('streak-30', c)!
    const m2 = progressOf('streak-30', c)!
    expect(m1.current).toBe(30)
    expect(m1).toEqual(m2)
  })
})

describe('几处容易错的口径', () => {
  it('subject-master-3 三科分别封顶 10 再求和（数学 50 个也不会虚高）', () => {
    const c = ctx({
      progress: [...mastered('m', 50), ...mastered('c', 3), ...mastered('e', 20)],
      packages: [pkg('m', 'math', 100), pkg('c', 'chinese', 100), pkg('e', 'english', 100)],
    })
    const m = progressOf('subject-master-3', c)!
    // min(50,10) + min(3,10) + min(20,10) = 10 + 3 + 10
    expect(m.current).toBe(23)
    expect(m.target).toBe(30)
    expect(m.parts?.map((p) => [p.label, p.current])).toEqual([
      ['数学', 10],
      ['语文', 3],
      ['英语', 10],
    ])
  })

  it('mastery-half 门槛不满足时进度压成 0 并给出 gate 文案', () => {
    const m = progressOf('mastery-half', scenarios()['门槛未满足'])!
    expect(m.current).toBe(0)
    expect(m.gate).toBe('需先有 20 个知识点')
    expect(progressText(m)).toBe('需先有 20 个知识点')
  })

  it('mastery-half 门槛满足后按整数百分比计（不出现 49.9999）', () => {
    const c = ctx({
      progress: mastered('m', 49),
      packages: [pkg('m', 'math', 100)],
    })
    const m = progressOf('mastery-half', c)!
    expect(m.current).toBe(49)
    expect(Number.isInteger(m.current)).toBe(true)
  })

  it('review-20 累加的是错题上的复习答对次数', () => {
    const c = ctx({
      mistakes: [mistake({ reviewCorrectCount: 12 }), mistake({ reviewCorrectCount: 9 })],
    })
    expect(progressOf('review-20', c)!.current).toBe(20) // 21 → clamp 到 20
  })

  it('patience 看单个知识点（取最大值），不是全库总和', () => {
    const c = ctx({
      progress: [
        prog('m', { knowledgePointId: 'm::a', correctCount: 20, wrongCount: 10 }),
        prog('m', { knowledgePointId: 'm::b', correctCount: 5 }),
      ],
    })
    expect(progressOf('patience', c)!.current).toBe(30)
  })
})

describe('progressText 文案规则（PRD §5.3 表）', () => {
  const mk = (over: Partial<Measure>): Measure => ({
    current: 0,
    target: 10,
    unit: '个',
    noun: '知识点',
    kind: 'counter',
    ...over,
  })

  it('c=0 → 「目标 t 单位」', () => {
    expect(progressText(mk({ current: 0, target: 10 }))).toBe('目标 10个知识点')
  })

  it('0<c<0.8t → 「已完成 c/t · 还差 n」', () => {
    expect(progressText(mk({ current: 3, target: 10 }))).toBe('已完成 3/10 · 还差 7个知识点')
  })

  it('c/t≥0.8 → 「就快拿到了 · 还差 n」', () => {
    expect(progressText(mk({ current: 8, target: 10 }))).toBe('就快拿到了 · 还差 2个知识点')
    expect(progressText(mk({ current: 9, target: 10 }))).toBe('就快拿到了 · 还差 1个知识点')
  })

  it('c≥t → 「已达标 · 正在确认」（结算未发生的瞬时态，不显示"还差 0 个"）', () => {
    expect(progressText(mk({ current: 10, target: 10 }))).toBe('已达标 · 正在确认')
  })

  it('事件型 t=1 → 「完成一次即可解锁」', () => {
    expect(progressText(mk({ current: 0, target: 1, unit: '科', noun: '学科', kind: 'binary' })))
      .toBe('完成一次即可解锁')
  })

  it('gate 优先于一切', () => {
    expect(progressText(mk({ current: 0, target: 50, gate: '需先有 20 个知识点' })))
      .toBe('需先有 20 个知识点')
  })

  it('量词表逐项正确（个/道/天/种/个/科）', () => {
    expect(progressText(mk({ current: 0, target: 5, unit: '道', noun: '错题' }))).toBe('目标 5道错题')
    expect(progressText(mk({ current: 0, target: 7, unit: '天', noun: '' }))).toBe('目标 7天')
    expect(progressText(mk({ current: 0, target: 5, unit: '种', noun: '题型' }))).toBe('目标 5种题型')
  })

  it('文案红线：不出现"抽/概率/稀有/限时/错过"', () => {
    const all = [
      mk({ current: 0 }),
      mk({ current: 3 }),
      mk({ current: 8 }),
      mk({ current: 10 }),
      mk({ current: 0, target: 1, kind: 'binary' }),
    ].map(progressText)
    for (const text of all) {
      for (const banned of ['抽', '概率', '稀有', '限时', '错过']) {
        expect(text).not.toContain(banned)
      }
    }
  })
})

describe('证据快照 evidenceOf（A-06）', () => {
  it('28 枚都有模板，且长度不超过 40 字', () => {
    const c = scenarios()['全达标']
    for (const a of ACHIEVEMENTS) {
      const ev = evidenceOf(a.id, c)
      expect(ev, `${a.id} 缺证据模板`).not.toBe('')
      expect(ev.length).toBeLessThanOrEqual(EVIDENCE_MAX)
    }
  })

  it('数字取自进度：已掌握 10 个 → 「已掌握 10 个知识点」', () => {
    expect(evidenceOf('ten-kp', scenarios()['临界值'])).toBe('已掌握 10 个知识点')
  })

  it('模板里的数字取自 clamp 后的 current —— 也就是这枚成就自己的里程碑值', () => {
    // `ten-kp` 的目标是 10，所以就算当时已掌握 30 个，证据也只写 10：
    // 一是 current 被 clamp 到 target（AC-03），二是"掌握 10 个"才是这枚徽章的事实。
    const atTen = scenarios()['临界值']
    const atThirty = ctx({
      progress: mastered('m', 30),
      packages: [pkg('m', 'math', 300)],
    })
    expect(evidenceOf('ten-kp', atTen)).toBe('已掌握 10 个知识点')
    expect(evidenceOf('ten-kp', atThirty)).toBe('已掌握 10 个知识点')
    // 想看真实总量就走没有封顶的成就（kp-300 的 target 是 300）
    expect(evidenceOf('kp-300', atThirty)).toBe('已掌握 30 个知识点')
  })

  it('隐藏成就用固定文案（事件型不写数字）', () => {
    const c = scenarios()['全达标']
    expect(evidenceOf('early-bird', c)).toContain('早上 7 点前')
    expect(evidenceOf('night-owl', c)).toContain('晚上 9 点后')
    expect(evidenceOf('comeback', c)).toContain('彻底学会')
  })
})
