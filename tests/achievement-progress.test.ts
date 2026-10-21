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
import type { AchievementContext, AchievementDef, PackageMeta } from '@core/motivation/achievements'
import type { DailyStat } from '@core/motivation/dailyStats'
import { RETAIN_DAYS } from '@core/motivation/dailyStats'
import type { MasteryStatus, MistakeRecord, ProgressRecord } from '@/db'
import type { StreakState } from '@core/motivation/streak'
import { localDayKey } from '@core/motivation/streak'

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

// ============================================================================
// B3 追加（V1.6）：算法边界 + 「显示与达成必须同频」
// ----------------------------------------------------------------------------
// 上面已有的用例覆盖的是「典型场景 × 28 枚」的等价性；这一段补的是**边界穷举**与
// **属性测试**，守的仍然是同一条铁律（进度真相 ⇔ 判定真相）：
//
//     progressOf(id, ctx).current >= target   ⇔   def.check(ctx)
//
// 另外钉死两件最容易被"顺手优化"掉的事：
//   1. `mastery-half` 的 50% 取整边界 —— 47.4% 不许算达成，47.6% 也不许；
//   2. `daily-20` 的滚动窗口**允许回落** —— 任何 `Math.max(历史值, 当前值)` 都必须变红。
//
// 夹具一律走 `ProgressRecord` / `MistakeRecord` / `DailyStat` 的真实形状，不用 `any`：
// `status: '已掌握'` 这类字面量仍受联合类型约束，写错的时候 tsc 直接拦。
// ============================================================================

function makeCtx(
  spec: {
    progress?: ProgressRecord[]
    mistakes?: MistakeRecord[]
    streak?: StreakState
    packages?: PackageMeta[]
    dailyStats?: DailyStat[]
    attemptedTypes?: string[]
  } = {},
): AchievementContext {
  return {
    progress: spec.progress ?? [],
    mistakes: spec.mistakes ?? [],
    streak: spec.streak ?? { current: 0, longest: 0, lastDate: '' },
    packages: spec.packages ?? [],
    dailyStats: spec.dailyStats ?? [],
    attemptedTypes: spec.attemptedTypes ?? [],
  }
}

function makePkgMeta(packageId: string, subject: string, kpCount: number, term = 'up'): PackageMeta {
  return { packageId, subject, grade: 4, term, packageType: 'unit', kpCount }
}

function makeProgressRow(spec: {
  packageId: string
  knowledgePointId: string
  status?: MasteryStatus
  correctCount?: number
  wrongCount?: number
  correctStreak?: number
}): ProgressRecord {
  return {
    profileId: 'default',
    packageId: spec.packageId,
    knowledgePointId: spec.knowledgePointId,
    status: spec.status ?? '学习中',
    correctCount: spec.correctCount ?? 0,
    wrongCount: spec.wrongCount ?? 0,
    correctStreak: spec.correctStreak ?? 0,
    wrongStreak: 0,
    lastStudiedAt: '2026-01-01T00:00:00.000Z',
    studySeconds: 0,
  }
}

/** n 条「已掌握」行（同一个包，kpId 互不相同） */
function masteredRows(packageId: string, n: number): ProgressRecord[] {
  return Array.from({ length: n }, (_, i) =>
    makeProgressRow({
      packageId,
      knowledgePointId: `${packageId}::kp${i}`,
      status: '已掌握',
    }),
  )
}

function makeMistakeRow(spec: {
  exerciseId: string
  packageId?: string
  mastered?: boolean
  reviewCorrectCount?: number
}): MistakeRecord {
  const packageId = spec.packageId ?? 'unit-math'
  return {
    profileId: 'default',
    packageId,
    exerciseId: spec.exerciseId,
    knowledgePointIds: [`${packageId}::kp0`],
    wrongAt: '2026-01-01T00:00:00.000Z',
    wrongCount: 1,
    mastered: spec.mastered ?? true,
    reviewCorrectCount: spec.reviewCorrectCount ?? 0,
  }
}

/** 第 offset 天（以 2026-01-01 为第 0 天）的本地日期键 —— 复用生产口径 `localDayKey` */
function dayKeyAt(offset: number): string {
  return localDayKey(new Date(2026, 0, 1 + offset))
}

function makeDailyStat(date: string, questionCount: number): DailyStat {
  // 用当天正午：`firstStudyAt/lastStudyAt` 只被隐藏成就（early-bird / night-owl）读，
  // 这里给一个"两个彩蛋都不成立"的中性时刻，免得顺手把隐藏成就点亮
  const at = new Date(`${date}T12:00:00`).getTime()
  return { date, questionCount, firstStudyAt: at, lastStudyAt: at }
}

function masteryHalfCtx(total: number, masteredCount: number): AchievementContext {
  return makeCtx({
    progress: masteredRows('unit-math', masteredCount),
    packages: [makePkgMeta('unit-math', 'math', total)],
  })
}

/** 按 id 取定义；缺定义直接在测试里炸掉，而不是让 `!` 把 undefined 传下去 */
function defOf(id: string): AchievementDef {
  const def = ACHIEVEMENTS.find((a) => a.id === id)
  if (!def) throw new Error(`成就定义缺失：${id}`)
  return def
}

/** 按 id 取度量；不可进度化直接炸（本段只碰可进度化的 25 枚） */
function measureOf(id: string, c: AchievementContext): Measure {
  const m = progressOf(id, c)
  if (!m) throw new Error(`成就不可进度化：${id}`)
  return m
}

// ============================================================================
// 一、mastery-half 穷举：50% 的取整边界
// ============================================================================

describe('★ mastery-half 的 50% 边界（进度与 check 必须同频）', () => {
  type MasteryCase = readonly [
    label: string,
    total: number,
    masteredCount: number,
    expectedCurrent: number,
    achieved: boolean,
  ]

  const CASES: MasteryCase[] = [
    ['18 个里 9 个（正好 50%）但总量不足 20 → 门槛压成 0', 18, 9, 0, false],
    ['18 个里 18 个（100%）但总量不足 20 → 仍然不达成，且不显示 100', 18, 18, 0, false],
    ['19 个里 9 个（47.4%，但总量不足 20 → 门槛先把它压成 0）', 19, 9, 0, false],
    ['19 个里 10 个（52.6%，但总量不足 20 → 门槛优先，仍然不算达成）', 19, 10, 0, false],
    ['20 个里 9 个（45%）', 20, 9, 45, false],
    ['20 个里 10 个（正好 50%）→ 达成', 20, 10, 50, true],
    ['20 个里 20 个（100%）→ 封顶显示 50/50', 20, 20, 50, true],
    ['21 个里 10 个（47.6%）→ 向下取整 47，不算达成', 21, 10, 47, false],
    ['21 个里 11 个（52.4%）→ 达成', 21, 11, 50, true],
    ['22 个里 10 个（45.4%）', 22, 10, 45, false],
    ['22 个里 11 个（正好 50%）→ 达成', 22, 11, 50, true],
    ['22 个里 22 个（100%）→ 封顶显示 50/50', 22, 22, 50, true],
    ['23 个里 11 个（47.8%）→ 向下取整 47，不算达成', 23, 11, 47, false],
    ['23 个里 12 个（52.2%）→ 达成', 23, 12, 50, true],
    ['24 个里 12 个（正好 50%）→ 达成', 24, 12, 50, true],
    ['27 个里 13 个（48.1%）→ 差一点点也不算', 27, 13, 48, false],
    ['39 个里 19 个（48.7%）→ 差一点点也不算', 39, 19, 48, false],
    ['40 个里 20 个（正好 50%）', 40, 20, 50, true],
    ['100 个里 49 个（49%）', 100, 49, 49, false],
    ['100 个里 50 个（正好 50%）', 100, 50, 50, true],
    ['0 个知识点（空库）→ gate，不抛错', 0, 0, 0, false],
  ]

  it.each(CASES)('%s', (_label, total, masteredCount, expectedCurrent, achieved) => {
    const c = masteryHalfCtx(total, masteredCount)
    const m = measureOf('mastery-half', c)
    const why = `total=${total} mastered=${masteredCount} → ${m.current}/${m.target}`

    expect(m.target, `target 恒为 50：${why}`).toBe(50)
    expect(m.current, `current 不符：${why}`).toBe(expectedCurrent)
    expect(m.current >= m.target, `进度与 check 不同频：${why}`).toBe(achieved)
    expect(defOf('mastery-half').check(c), `check 与期望不同：${why}`).toBe(achieved)

    if (total < 20) {
      expect(m.gate, `总量不足 20 必须给门槛文案：${why}`).toBe('需先有 20 个知识点')
    } else {
      expect(m.gate, `门槛满足后不该再有 gate：${why}`).toBeUndefined()
    }
  })

  it('total ∈ [18,22] × mastered ∈ [0,total] 全部 105 组逐组同频', () => {
    let checked = 0
    for (let total = 18; total <= 22; total += 1) {
      for (let m = 0; m <= total; m += 1) {
        const c = masteryHalfCtx(total, m)
        const measure = measureOf('mastery-half', c)
        const achieved = measure.current >= measure.target
        const why = `total=${total} mastered=${m} → ${measure.current}/${measure.target}`

        expect(achieved, `不同频：${why}`).toBe(defOf('mastery-half').check(c))
        if (achieved) {
          // 达成时必然被 clamp 到 50：不能出现 52/50 这种"超额"
          expect(measure.current, `达成时必须正好 50：${why}`).toBe(50)
        } else {
          // 关键：不能出现「显示已经 50% 但徽章不亮」
          expect(measure.current, `未达成时不得显示 50：${why}`).toBeLessThan(50)
        }
        checked += 1
      }
    }
    expect(checked).toBe(105)
  })

  it('0~45 个知识点的所有掌握数（1081 组）：绝不出现「显示 50% 却没达成」', () => {
    let checked = 0
    for (let total = 0; total <= 45; total += 1) {
      for (let masteredCount = 0; masteredCount <= total; masteredCount += 1) {
        const c = masteryHalfCtx(total, masteredCount)
        const measure = measureOf('mastery-half', c)
        const achieved = measure.current >= measure.target
        const why = `total=${total} mastered=${masteredCount} → ${measure.current}/${measure.target}`

        expect(achieved, `不同频：${why}`).toBe(defOf('mastery-half').check(c))
        if (achieved) {
          expect(measure.current, `达成时 current 必须等于 target：${why}`).toBe(measure.target)
        } else {
          expect(measure.current, `锁定时不能显示 50：${why}`).toBeLessThan(50)
        }
        // gate 与"压成 0"必须成对出现：有 gate 就一定 current=0，没有 gate 就一定不是被压的
        if (measure.gate !== undefined) {
          expect(measure.current, `有 gate 就必须压成 0：${why}`).toBe(0)
          expect(total, `gate 只该出现在总量 <20 时：${why}`).toBeLessThan(20)
        }
        checked += 1
      }
    }
    expect(checked).toBe(1081)
  })
})

// ============================================================================
// 二、daily-20 滚动窗口：进度必须能回落（禁止缓存历史最大值）
// ============================================================================

/** 第 peakIndex 天做 peak 题，其余天 rest 题，共 days 天 */
function rollingStats(peakIndex: number, days: number, peak: number, rest: number): DailyStat[] {
  return Array.from({ length: days }, (_, i) =>
    makeDailyStat(dayKeyAt(i), i === peakIndex ? peak : rest),
  )
}

/** 模拟生产的保留窗口（`pruneOld` 只留最近 RETAIN_DAYS 天） */
function lastNDays(stats: DailyStat[], n: number): DailyStat[] {
  return stats.slice(Math.max(0, stats.length - n))
}

describe('★ daily-20 的 60 天滚动窗口（进度允许回退 · 禁止缓存最大值）', () => {
  const dailyDef = defOf('daily-20')

  it('峰值在第 1 天、攒满 61 天后滚出窗口 → current 回落且 check 同步变假', () => {
    expect(RETAIN_DAYS, '本用例按 60 天窗口写死，改保留天数需同步改这里').toBe(60)

    const stats = rollingStats(0, 61, 30, 3)
    const withPeak = makeCtx({ dailyStats: stats })
    const before = measureOf('daily-20', withPeak)
    expect(before.current, '30 题封顶显示 20').toBe(20)
    expect(dailyDef.check(withPeak)).toBe(true)

    // 第 61 天：最早那天被 `pruneOld` 裁掉，峰值滚出窗口
    const rolled = makeCtx({ dailyStats: lastNDays(stats, RETAIN_DAYS) })
    expect(rolled.dailyStats, '窗口内只剩 60 天').toHaveLength(60)
    const after = measureOf('daily-20', rolled)
    expect(after.current, '峰值滚出后当前最多只有 3 题').toBe(3)
    expect(after.current).toBeLessThan(before.current)
    // check 也必须跟着回落 —— 否则就是"进度回退了但徽章还亮着"的另一种不同频
    expect(dailyDef.check(rolled), '窗口外的峰值不能继续撑起 check').toBe(false)
  })

  it('窗口边界精确到 1 天：峰值在最近 60 天内算，差一天就不算', () => {
    const inside = makeCtx({ dailyStats: lastNDays(rollingStats(1, 61, 30, 3), RETAIN_DAYS) })
    const outside = makeCtx({ dailyStats: lastNDays(rollingStats(0, 61, 30, 3), RETAIN_DAYS) })

    expect(measureOf('daily-20', inside).current).toBe(20)
    expect(dailyDef.check(inside)).toBe(true)

    expect(measureOf('daily-20', outside).current).toBe(3)
    expect(dailyDef.check(outside)).toBe(false)
  })

  it('19 题差一道、20 题刚好：进度文案与 check 同频', () => {
    const at19 = makeCtx({ dailyStats: [makeDailyStat(dayKeyAt(0), 19)] })
    const at20 = makeCtx({ dailyStats: [makeDailyStat(dayKeyAt(0), 20)] })

    const m19 = measureOf('daily-20', at19)
    expect(m19.current).toBe(19)
    expect(progressText(m19)).toBe('就快拿到了 · 还差 1道题')
    expect(dailyDef.check(at19)).toBe(false)

    const m20 = measureOf('daily-20', at20)
    expect(m20.current).toBe(20)
    expect(progressText(m20)).toBe('已达标 · 正在确认')
    expect(dailyDef.check(at20)).toBe(true)
  })

  it('连续多天都远超 20 也只显示 20/20（clamp，不出现 100/20）', () => {
    const c = makeCtx({
      dailyStats: Array.from({ length: 5 }, (_, i) => makeDailyStat(dayKeyAt(i), 100)),
    })
    const m = measureOf('daily-20', c)
    expect(m.current).toBe(m.target)
    expect(m.current).toBe(20)
  })

  it('先算峰值、再算回落，回落值不受先前调用影响（模块级无 max 缓存）', () => {
    const peak = makeCtx({ dailyStats: rollingStats(0, 61, 30, 3) })
    const shrunk = makeCtx({ dailyStats: lastNDays(rollingStats(0, 61, 30, 3), RETAIN_DAYS) })

    const seq = [
      measureOf('daily-20', peak).current,
      measureOf('daily-20', shrunk).current,
      measureOf('daily-20', shrunk).current,
      measureOf('daily-20', peak).current,
    ]
    expect(seq, '顺序必须是 20 → 3 → 3 → 20；任何一步停在 20 都说明缓存了历史峰值').toEqual([
      20, 3, 3, 20,
    ])
  })
})

// ============================================================================
// 三、属性测试：100 组确定性随机上下文
// ============================================================================

/** xorshift32：手写确定性 PRNG（不引 faker / seedrandom，失败可凭种子复现） */
function xorshift32(seed: number): () => number {
  let x = seed | 0
  if (x === 0) x = 0x1a2b3c4d
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

const STATUS_POOL: MasteryStatus[] = ['未学', '学习中', '已掌握', '需复习']
const SUBJECT_POOL = ['math', 'chinese', 'english', 'science'] as const

function randomCtx(rand: () => number): AchievementContext {
  const int = (maxExclusive: number) => Math.floor(rand() * maxExclusive)

  const packages: PackageMeta[] = []
  const pkgCount = int(4)
  for (let i = 0; i < pkgCount; i += 1) {
    packages.push(makePkgMeta(`unit-${i}`, SUBJECT_POOL[int(SUBJECT_POOL.length)], int(80)))
  }

  const progress: ProgressRecord[] = []
  const rowCount = int(40)
  for (let i = 0; i < rowCount; i += 1) {
    // 80% 挂在真实包上（让 mastery-half 的总量口径真的被行使），
    // 另 20% 是"包已删但进度还在"的孤儿行 —— 生产里删包不清进度，这条分支必须存在
    const packageId =
      packages.length > 0 && rand() < 0.8
        ? packages[int(packages.length)].packageId
        : `unit-orphan-${int(3)}`
    progress.push(
      makeProgressRow({
        packageId,
        knowledgePointId: `${packageId}::kp${i}`,
        status: STATUS_POOL[int(STATUS_POOL.length)],
        correctCount: int(35),
        wrongCount: int(10),
        correctStreak: int(15),
      }),
    )
  }

  const dailyStats = Array.from({ length: int(81) }, (_, i) =>
    makeDailyStat(dayKeyAt(i), int(45)),
  )

  const mistakes = Array.from({ length: int(20) }, (_, i) =>
    makeMistakeRow({ exerciseId: `ex-${i}`, mastered: rand() < 0.5, reviewCorrectCount: int(5) }),
  )

  // 不变量：`touchStudyDay` 保证 longest = max(prev.longest, current)。
  // 随机数据也必须守住它 —— 否则 `bestStreak()`（max(longest, effectiveCurrent(now))）
  // 与 `bestDayStreak()`（max(longest, current)）会在"current > longest"的脏数据上分叉，
  // 那是数据问题，不是这两份实现的问题。
  const longest = int(120)
  const current = int(longest + 1)

  return makeCtx({
    progress,
    mistakes,
    packages,
    dailyStats,
    attemptedTypes: Array.from({ length: int(7) }, (_, i) => `type-${i}`),
    streak: { current, longest, lastDate: '2026-01-01' },
  })
}

describe('★ 属性测试：100 组随机上下文 × 25 枚逐条同频（确定性种子）', () => {
  /** 失败时靠这个种子复现；改种子等于换一批随机数据，别随手改 */
  const SEED = 0x5eed1234

  it('100 组随机 ctx：current >= target ⇔ check(ctx)，且 current 恒为 [0,target] 内的整数', () => {
    const rand = xorshift32(SEED)
    for (let round = 0; round < 100; round += 1) {
      const c = randomCtx(rand)
      const detail = `round=${round} seed=0x${SEED.toString(16)} ctx=${JSON.stringify(c)}`

      for (const id of MEASURABLE_IDS) {
        const m = measureOf(id, c)
        expect(Number.isInteger(m.current), `${id} current 必须是整数 @ ${detail}`).toBe(true)
        expect(m.current, `${id} current 不得为负 @ ${detail}`).toBeGreaterThanOrEqual(0)
        expect(m.current, `${id} current 不得超过 target @ ${detail}`).toBeLessThanOrEqual(m.target)

        const achieved = m.current >= m.target
        expect(
          achieved,
          `${id} 进度 ${m.current}/${m.target} 与 check 不同频 @ ${detail}`,
        ).toBe(defOf(id).check(c))

        // 达成即满格：封顶后不存在 21/20 这种数字，也不存在"差一点点却算达成"
        if (achieved) {
          expect(m.current, `${id} 达成时 current 必须等于 target @ ${detail}`).toBe(m.target)
        }
      }
    }
  })

  it('随机上下文里 3 枚隐藏成就仍然恒为 null（不可进度化与数据无关）', () => {
    const rand = xorshift32(SEED)
    for (let round = 0; round < 100; round += 1) {
      const c = randomCtx(rand)
      for (const id of HIDDEN_NO_PROGRESS) {
        expect(progressOf(id, c), `round=${round} / ${id}`).toBeNull()
      }
    }
  })
})

// ============================================================================
// 四、其它值得钉的边界
// ============================================================================

describe('其它边界（空上下文 / 事件型 / 复合分项 / 文案）', () => {
  it('空上下文：25 枚全部可算、current 全 0、check 全 false、不抛错', () => {
    const empty = makeCtx()
    for (const id of MEASURABLE_IDS) {
      const m = measureOf(id, empty)
      expect(m.current, `${id} 空数据必须为 0`).toBe(0)
      expect(m.target, `${id} target 必须为正`).toBeGreaterThan(0)
      expect(defOf(id).check(empty), `${id} 空数据不该达成`).toBe(false)
    }
    // 唯一的例外是 mastery-half：它给的是门槛文案而不是"目标 50%"
    expect(measureOf('mastery-half', empty).gate).toBe('需先有 20 个知识点')
  })

  it('target === 1 的三枚是事件型（binary），文案随达成切换', () => {
    const binaryIds = MEASURABLE_IDS.filter((id) => measureOf(id, makeCtx()).target === 1)
    expect([...binaryIds].sort()).toEqual(['first-step', 'mistake-first', 'senior-new'])

    for (const id of MEASURABLE_IDS) {
      const m = measureOf(id, makeCtx())
      expect(m.kind, `${id}：kind 必须由 target 唯一决定`).toBe(
        m.target === 1 ? 'binary' : 'counter',
      )
    }

    const oneMastered = makeCtx({ progress: masteredRows('unit-math', 1) })
    const m1 = measureOf('first-step', oneMastered)
    expect(m1.current).toBe(1)
    expect(m1.current >= m1.target).toBe(defOf('first-step').check(oneMastered))
    expect(progressText(m1)).toBe('已达标 · 正在确认')
    expect(progressText(measureOf('first-step', makeCtx()))).toBe('完成一次即可解锁')
  })

  it('subject-master-3 的 parts 之和恒等于 current（分项与总数不能对不上）', () => {
    const cases = [
      ...Object.values(scenarios()),
      makeCtx({
        progress: [...masteredRows('m', 12), ...masteredRows('c', 4), ...masteredRows('e', 30)],
        packages: [makePkgMeta('m', 'math', 50), makePkgMeta('c', 'chinese', 50), makePkgMeta('e', 'english', 50)],
      }),
    ]
    for (const [i, c] of cases.entries()) {
      const m = measureOf('subject-master-3', c)
      expect(m.parts, `第 ${i} 组缺 parts`).toBeDefined()
      const parts = m.parts ?? []
      expect(parts, `第 ${i} 组必须正好三科`).toHaveLength(3)
      for (const p of parts) {
        expect(p.current, `第 ${i} 组分项 ${p.label} 超额`).toBeLessThanOrEqual(p.target)
      }
      expect(
        parts.reduce((sum, p) => sum + p.current, 0),
        `第 ${i} 组分项之和与 current 不一致`,
      ).toBe(m.current)
    }
  })

  it('已达标/门槛文案里不出现「还差 0」这种自相矛盾的说法', () => {
    for (const c of [makeCtx(), ...Object.values(scenarios())]) {
      for (const id of MEASURABLE_IDS) {
        const text = progressText(measureOf(id, c))
        expect(text, `${id} 文案出现「还差 0」：${text}`).not.toContain('还差 0')
      }
    }
  })
})
