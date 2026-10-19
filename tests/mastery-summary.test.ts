import { describe, expect, it } from 'vitest'
import type { LearningPackageRecord, ProgressRecord } from '@/db'
import {
  canonicalizeProgressRows,
  computeMasterySummary,
  countMasteredKps,
  domainKeySet,
  progressKeyOf,
} from '@core/mastery/masterySummary'
import { makeEnglishSeven, makeProgress, makePkg } from './helpers/progressFixtures'

const mathPkg = makePkg('unit-math-1', 'math', [
  { id: 'kp-a', title: '两位数乘法' },
  { id: 'kp-b', title: '带余除法' },
])
const chinesePkg = makePkg('unit-chinese-1', 'chinese', [
  { id: 'kp-c', title: '古诗默写' },
  { id: 'kp-d', title: '近义词辨析' },
])

describe('progressKeyOf —— 去重键必须是二元组', () => {
  it('同 kpId 不同包 → 不同键（禁止裸 kpId 去重）', () => {
    expect(progressKeyOf({ packageId: 'p1', knowledgePointId: 'kp-a' })).not.toBe(
      progressKeyOf({ packageId: 'p2', knowledgePointId: 'kp-a' })
    )
  })

  it('分隔符不是 `::`（避免 id 前缀撞键）', () => {
    expect(progressKeyOf({ packageId: 'a', knowledgePointId: 'b::c' })).not.toBe(
      progressKeyOf({ packageId: 'a::b', knowledgePointId: 'c' })
    )
  })
})

describe('english-7 夹具：49 个不同知识点不能塌成 7', () => {
  it('裸 JSON 路径（7 包 × 7 个同名裸 id，title 各不相同）→ total === 49', () => {
    const packages = makeEnglishSeven()
    const summary = computeMasterySummary(packages, [])
    expect(summary.total).toBe(49)
    expect(summary.notStarted).toBe(49)
  })

  it('运行时路径（id 带包前缀）→ total === 49', () => {
    const summary = computeMasterySummary(makeEnglishSeven(true), [])
    expect(summary.total).toBe(49)
  })

  it('49 个里只学过 1 个 → rate 2%（不是 14%）', () => {
    const packages = makeEnglishSeven()
    const progress = [
      makeProgress({
        id: 1,
        packageId: 'unit-english-7-up-rjb-p3',
        knowledgePointId: 'kp-reading-001',
        status: '已掌握',
      }),
    ]
    const summary = computeMasterySummary(packages, progress)
    expect(summary.total).toBe(49)
    expect(summary.mastered).toBe(1)
    expect(summary.rate).toBe(2)
  })
})

describe('层 2 收敛：同 kpId + title 全同 → 计 1', () => {
  it('base + unit 重复登记同一知识点 → 分母只 +1', () => {
    const base = makePkg('base-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const unit = makePkg('unit-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const summary = computeMasterySummary([base, unit], [])
    expect(summary.total).toBe(1)
  })

  it('title 改一个字 → 视为两个知识点，分母 +2', () => {
    const base = makePkg('base-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const unit = makePkg('unit-math', 'math', [{ id: 'kp-a', title: '两位数乘法（进阶）' }])
    expect(computeMasterySummary([base, unit], []).total).toBe(2)
  })

  it('收敛代表取 packageId 字典序最小的那条（确定性）', () => {
    const base = makePkg('base-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const unit = makePkg('unit-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const { entries } = canonicalizeProgressRows([unit, base], [])
    expect(entries).toHaveLength(1)
    expect(entries[0].packageId).toBe('base-math')
  })

  it('空 title 不参与收敛（无法判定是否同一知识点 → 保守不合并）', () => {
    const p1 = makePkg('a-1', 'math', [{ id: 'kp-a' }])
    const p2 = makePkg('b-1', 'math', [{ id: 'kp-a' }])
    // makePkg 会把缺省 title 补成 id 本身 → 这里手工抹成空串
    p1.knowledgePoints[0].title = ''
    p2.knowledgePoints[0].title = ''
    expect(computeMasterySummary([p1, p2], []).total).toBe(2)
  })

  it('收敛后，两个包各自的行都归到同一个 key（只计 1 次已掌握）', () => {
    const base = makePkg('base-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const unit = makePkg('unit-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const progress = [
      makeProgress({
        id: 1,
        packageId: 'base-math',
        knowledgePointId: 'kp-a',
        status: '已掌握',
        lastStudiedAt: '2026-02-01T00:00:00.000Z',
      }),
      makeProgress({
        id: 2,
        packageId: 'unit-math',
        knowledgePointId: 'kp-a',
        status: '需复习',
        lastStudiedAt: '2026-03-01T00:00:00.000Z',
      }),
    ]
    const summary = computeMasterySummary([base, unit], progress)
    expect(summary.total).toBe(1)
    expect(summary.mastered).toBe(0)
    expect(summary.needReview).toBe(1) // 最新那条胜出
    expect(summary.orphanRecordCount).toBe(0)
  })
})

describe('跨学科：同 kpId 不收敛（title 不同），各归其包', () => {
  it('数学 / 语文两包共用 kp-reading-001 → 计 2 个 key', () => {
    const math = makePkg('unit-math', 'math', [{ id: 'kp-reading-001', title: '应用题阅读理解' }])
    const chinese = makePkg('special-chinese', 'chinese', [{ id: 'kp-reading-001', title: '梅雨潭' }])
    const { entries } = canonicalizeProgressRows([math, chinese], [])
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((e) => e.packageId))).toEqual(new Set(['unit-math', 'special-chinese']))
  })
})

describe('孤儿隔离（I5）', () => {
  it('不在 domain 的 progress → 计入 orphanRecordCount，不进任何桶', () => {
    const progress = [
      makeProgress({ id: 1, packageId: 'unit-math-1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'deleted-pkg', knowledgePointId: 'kp-zzz', status: '已掌握' }),
    ]
    const summary = computeMasterySummary([mathPkg], progress)
    expect(summary.total).toBe(2)
    expect(summary.mastered).toBe(1)
    expect(summary.orphanRecordCount).toBe(1)
    expect(summary.mastered + summary.learning + summary.needReview + summary.unlearned + summary.notStarted).toBe(
      summary.total
    )
  })

  it('countMasteredKps 带 domainKeys 时排除孤儿', () => {
    const progress = [
      makeProgress({ id: 1, packageId: 'unit-math-1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'deleted-pkg', knowledgePointId: 'kp-zzz', status: '已掌握' }),
    ]
    expect(countMasteredKps(progress)).toBe(2)
    expect(countMasteredKps(progress, domainKeySet([mathPkg]))).toBe(1)
  })
})

describe('>100% 复现夹具：旧场景在新函数里必然 ≤100（I1 / I2）', () => {
  it('重复行 + 副本包：旧口径 mastered 5 / total 2 → 250%，新口径 1/1 = 100%', () => {
    const base = makePkg('base-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const unit = makePkg('unit-math', 'math', [{ id: 'kp-a', title: '两位数乘法' }])
    const progress: ProgressRecord[] = [
      makeProgress({ id: 1, packageId: 'base-math', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'unit-math', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 3, packageId: 'base-math', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 4, packageId: 'deleted-1', knowledgePointId: 'kp-ghost-1', status: '已掌握' }),
      makeProgress({ id: 5, packageId: 'deleted-2', knowledgePointId: 'kp-ghost-2', status: '已掌握' }),
    ]
    const summary = computeMasterySummary([base, unit], progress)
    expect(summary.total).toBe(1)
    expect(summary.mastered).toBe(1)
    expect(summary.rate).toBe(100)
    expect(summary.rate).toBeLessThanOrEqual(100)
    expect(summary.orphanRecordCount).toBe(2)
  })
})

describe('历史重复行（I8）：同 key 多条 → 只计 1 次，取 lastStudiedAt 最新', () => {
  it('一条「已掌握」旧、一条「学习中」新 → 计「学习中」', () => {
    const progress = [
      makeProgress({
        id: 1,
        packageId: 'unit-math-1',
        knowledgePointId: 'kp-a',
        status: '已掌握',
        lastStudiedAt: '2026-01-01T00:00:00.000Z',
      }),
      makeProgress({
        id: 2,
        packageId: 'unit-math-1',
        knowledgePointId: 'kp-a',
        status: '学习中',
        lastStudiedAt: '2026-05-01T00:00:00.000Z',
      }),
    ]
    const summary = computeMasterySummary([mathPkg], progress)
    expect(summary.total).toBe(2)
    expect(summary.mastered).toBe(0)
    expect(summary.learning).toBe(1)
    expect(summary.notStarted).toBe(1)
  })

  it('时间相同时 id 大者胜（确定性）', () => {
    const same = '2026-05-01T00:00:00.000Z'
    const progress = [
      makeProgress({
        id: 1,
        packageId: 'unit-math-1',
        knowledgePointId: 'kp-a',
        status: '已掌握',
        lastStudiedAt: same,
      }),
      makeProgress({
        id: 9,
        packageId: 'unit-math-1',
        knowledgePointId: 'kp-a',
        status: '需复习',
        lastStudiedAt: same,
      }),
    ]
    expect(computeMasterySummary([mathPkg], progress).needReview).toBe(1)
  })
})

describe('I1–I8 不变量（对任意输入恒成立）', () => {
  const messy: ProgressRecord[] = [
    makeProgress({ id: 1, packageId: 'unit-math-1', knowledgePointId: 'kp-a', status: '已掌握' }),
    makeProgress({ id: 2, packageId: 'unit-math-1', knowledgePointId: 'kp-b', status: '学习中' }),
    makeProgress({ id: 3, packageId: 'unit-chinese-1', knowledgePointId: 'kp-c', status: '需复习' }),
    makeProgress({ id: 4, packageId: 'unit-chinese-1', knowledgePointId: 'kp-d', status: '未学' }),
    makeProgress({ id: 5, packageId: 'unit-chinese-1', knowledgePointId: 'kp-d', status: '学习中' }),
    makeProgress({ id: 6, packageId: 'gone', knowledgePointId: 'kp-x', status: '已掌握' }),
  ]
  const packages = [mathPkg, chinesePkg]

  it('I1 mastered <= total', () => {
    const s = computeMasterySummary(packages, messy)
    expect(s.mastered).toBeLessThanOrEqual(s.total)
  })

  it('I2 0 <= rate <= 100', () => {
    const s = computeMasterySummary(packages, messy)
    expect(s.rate).toBeGreaterThanOrEqual(0)
    expect(s.rate).toBeLessThanOrEqual(100)
  })

  it('I3 notStarted >= 0', () => {
    expect(computeMasterySummary(packages, messy).notStarted).toBeGreaterThanOrEqual(0)
  })

  it('I4 五桶恰好划分全集', () => {
    const s = computeMasterySummary(packages, messy)
    expect(s.mastered + s.learning + s.needReview + s.unlearned + s.notStarted).toBe(s.total)
    // 具体值：kp-a 已掌握 / kp-b 学习中 / kp-c 需复习 / kp-d 取最新的学习中（未学那条被覆盖）
    expect(s).toMatchObject({
      total: 4,
      mastered: 1,
      learning: 2,
      needReview: 1,
      unlearned: 0,
      notStarted: 0,
      rate: 25,
      orphanRecordCount: 1,
    })
  })

  it('I5 orphanRecordCount >= 0 且不进桶', () => {
    const s = computeMasterySummary(packages, messy)
    expect(s.orphanRecordCount).toBe(1)
    expect(s.total).toBe(4) // 孤儿不放大分母
  })

  it('I6 空输入 → 全 0，不抛', () => {
    expect(computeMasterySummary([], [])).toEqual({
      total: 0,
      mastered: 0,
      learning: 0,
      needReview: 0,
      unlearned: 0,
      notStarted: 0,
      rate: 0,
      orphanRecordCount: 0,
    })
    expect(computeMasterySummary([], [makeProgress({ id: 1, packageId: 'x', knowledgePointId: 'y' })])).toMatchObject(
      { total: 0, rate: 0, orphanRecordCount: 1 }
    )
  })

  it('I7 幂等：同一输入多次调用结果全等', () => {
    const a = computeMasterySummary(packages, messy)
    const b = computeMasterySummary(packages, messy)
    expect(a).toEqual(b)
  })

  it('I8 同 key 多条 progress 只计 1 次（kp-d 有两条，桶里只出现一次）', () => {
    const s = computeMasterySummary(packages, messy)
    // kp-d 两条：id 4「未学」与 id 5「学习中」；只计最新那条 → 未学桶为 0
    expect(s.unlearned).toBe(0)
    expect(s.learning).toBe(2)
    const onlyD = computeMasterySummary(packages, [
      makeProgress({ id: 4, packageId: 'unit-chinese-1', knowledgePointId: 'kp-d', status: '未学' }),
      makeProgress({ id: 5, packageId: 'unit-chinese-1', knowledgePointId: 'kp-d', status: '学习中' }),
    ])
    // 若同一 key 被计两次，notStarted 会少 1 而 learning 会变 2
    expect(onlyD).toMatchObject({ total: 4, learning: 1, unlearned: 0, notStarted: 3 })
  })
})

describe('AC-E1-3 · 成就分子与掌握率分子同源', () => {
  it('无孤儿时 countMasteredKps(p) === computeMasterySummary(pkgs, p).mastered', () => {
    const progress = [
      makeProgress({ id: 1, packageId: 'unit-math-1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'unit-math-1', knowledgePointId: 'kp-b', status: '已掌握' }),
      makeProgress({ id: 3, packageId: 'unit-chinese-1', knowledgePointId: 'kp-c', status: '学习中' }),
    ]
    const s = computeMasterySummary([mathPkg, chinesePkg], progress)
    expect(s.orphanRecordCount).toBe(0)
    expect(countMasteredKps(progress)).toBe(s.mastered)
    expect(s.mastered).toBe(2)
  })

  it('有孤儿时：summary.mastered 只少数孤儿那一份，countMasteredKps 全量更大', () => {
    const progress = [
      makeProgress({ id: 1, packageId: 'unit-math-1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'gone', knowledgePointId: 'kp-x', status: '已掌握' }),
    ]
    const s = computeMasterySummary([mathPkg], progress)
    expect(s.orphanRecordCount).toBe(1)
    expect(s.mastered).toBe(1)
    expect(countMasteredKps(progress)).toBe(2)
  })
})

describe('canonicalizeProgressRows —— 三处展示共用的唯一收敛实现（D5）', () => {
  it('entries / rowByKey / orphanRows 三者自洽', () => {
    const packages: LearningPackageRecord[] = [mathPkg]
    const progress = [
      makeProgress({ id: 1, packageId: 'unit-math-1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'gone', knowledgePointId: 'kp-x', status: '已掌握' }),
    ]
    const { entries, rowByKey, orphanRows } = canonicalizeProgressRows(packages, progress)
    expect(entries.map((e) => e.kpId).sort()).toEqual(['kp-a', 'kp-b'])
    expect(rowByKey.get(progressKeyOf({ packageId: 'unit-math-1', knowledgePointId: 'kp-a' }))?.id).toBe(1)
    expect(orphanRows).toHaveLength(1)
  })
})
