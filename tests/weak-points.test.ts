/**
 * C3 · 弱项推荐（computeWeakPoints）单测
 *
 * 覆盖主理人点名的场景（每条都能独立失败）：
 *   1. 筛选：已掌握不进 / 未学不进 / 「或」逻辑两半（需复习+高分 仍入选；已掌握+低分 入选）；
 *   2. 排序三级：wrongCount 降 → score 升（null 垫底）→ nextReviewAt 升（null 垫底）；
 *   3. limit：默认 5 / 显式 3 / 0 → []；
 *   4. excludeKpIds：排除第 1 名后由第 6 名递补；
 *   5. reason：四种组合 + 探针（score=37 绝不漏进 reason）；
 *   6. 去重：同 kpId 同包两行只出一条且用新行；
 *   7. 孤儿行：packageId 不在 packages → 不进；
 *   8. due 边界：now 可注入，刚好等于算到期、晚一分钟不算；
 *   9. 畸形行不抛异常；
 *   10. 空输入 → []。
 *
 * 铁律（§11.5）：score 只进 WeakPoint.score（供排序/断言），绝不进 reason / 任何 UI 文案。
 */
import { describe, expect, it } from 'vitest'
import type { LearningPackageRecord, MasteryStatus, ProgressRecord } from '@/db'
import { computeMasteryScore } from '@core/mastery/masterySummary'
import { computeWeakPoints } from '@core/recommendation/weakPoints'
import { makePkg, makeProgress } from './helpers/progressFixtures'

const PKG = 'pkg-a'

/** 固定 now，保证 due / reason 断言不受真实时间影响 */
const NOW = Date.parse('2026-06-01T00:00:00.000Z')

/**
 * 造一条进度行。`score`（0–100）经 `masteryProbability = score/100` 精确落到
 * `computeMasteryScore`（无 FSRS → round(100·p)）；`score: null` → 无 BKT/FSRS → 估不出。
 */
function row(spec: {
  id: number
  kpId: string
  packageId?: string
  status?: MasteryStatus
  wrongCount?: number
  score?: number | null
  nextReviewAt?: string | null
  lastStudiedAt?: string
}): ProgressRecord {
  return makeProgress({
    id: spec.id,
    packageId: spec.packageId ?? PKG,
    knowledgePointId: spec.kpId,
    status: spec.status ?? '需复习',
    wrongCount: spec.wrongCount ?? 0,
    nextReviewAt: spec.nextReviewAt ?? undefined,
    lastStudiedAt: spec.lastStudiedAt,
    masteryProbability:
      spec.score === null || spec.score === undefined ? undefined : spec.score / 100,
  })
}

/** 造一个含指定知识点的最小包 */
function pkgWith(kpIds: Array<{ id: string; title?: string }>): LearningPackageRecord {
  return makePkg(PKG, 'math', kpIds)
}

// =====================================================================
// 1. 筛选（§11.4：未掌握 / 需复习 / 熟练度 < 60）
// =====================================================================
describe('computeWeakPoints —— 筛选', () => {
  it('已掌握且熟练度 ≥ 60 → 不进', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: '两位数乘法' }])
    const progress = [row({ id: 1, kpId: 'kp-1', status: '已掌握', score: 80 })]
    expect(computeWeakPoints([pkg], progress)).toEqual([])
  })

  it('已掌握且无熟练度（score=null）→ 不进（两个条件都不满足）', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])
    const progress = [row({ id: 1, kpId: 'kp-1', status: '已掌握', score: null })]
    expect(computeWeakPoints([pkg], progress)).toEqual([])
  })

  it('entries 有但无进度行（没学过）→ 不进', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'X' },
      { id: 'kp-2', title: 'Y' },
    ])
    // 只给 kp-1 建行，kp-2 从未学过
    const progress = [row({ id: 1, kpId: 'kp-1', status: '需复习', score: 50 })]
    const result = computeWeakPoints([pkg], progress)
    expect(result.map((w) => w.knowledgePointId)).toEqual(['kp-1'])
  })

  it('status=需复习 且 score=80（≥60）仍入选（锁定「或」逻辑前半：未掌握即算弱项）', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])
    const progress = [row({ id: 1, kpId: 'kp-1', status: '需复习', score: 80 })]
    const result = computeWeakPoints([pkg], progress)
    expect(result).toHaveLength(1)
    expect(result[0].knowledgePointId).toBe('kp-1')
  })

  it('status=已掌握 且 score=45（<60）入选（锁定「或」逻辑后半：低分即使已掌握也练）', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])
    const progress = [row({ id: 1, kpId: 'kp-1', status: '已掌握', score: 45 })]
    const result = computeWeakPoints([pkg], progress)
    expect(result).toHaveLength(1)
    expect(result[0].knowledgePointId).toBe('kp-1')
  })
})

// =====================================================================
// 2. 排序三级（wrongCount 降 → score 升 → nextReviewAt 升，null 垫底）
// =====================================================================
describe('computeWeakPoints —— 排序', () => {
  it('第一级：wrongCount 大的在前', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'A' },
      { id: 'kp-2', title: 'B' },
    ])
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 1, score: 50 }),
      row({ id: 2, kpId: 'kp-2', wrongCount: 5, score: 50 }),
    ]
    expect(computeWeakPoints([pkg], progress).map((w) => w.knowledgePointId)).toEqual(['kp-2', 'kp-1'])
  })

  it('第二级：同 wrongCount 时 score 小的在前', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'A' },
      { id: 'kp-2', title: 'B' },
    ])
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 3, score: 70 }),
      row({ id: 2, kpId: 'kp-2', wrongCount: 3, score: 40 }),
    ]
    expect(computeWeakPoints([pkg], progress).map((w) => w.knowledgePointId)).toEqual(['kp-2', 'kp-1'])
  })

  it('第三级：前两级都相同时 nextReviewAt 早的在前', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'A' },
      { id: 'kp-2', title: 'B' },
    ])
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 3, score: 50, nextReviewAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 2, kpId: 'kp-2', wrongCount: 3, score: 50, nextReviewAt: '2026-05-01T00:00:00.000Z' }),
    ]
    expect(computeWeakPoints([pkg], progress).map((w) => w.knowledgePointId)).toEqual(['kp-2', 'kp-1'])
  })

  it('第二级 null 垫底：同 wrongCount 时，能估出分数的排在估不出的前面', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'A' },
      { id: 'kp-2', title: 'B' },
    ])
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 3, score: null }),
      row({ id: 2, kpId: 'kp-2', wrongCount: 3, score: 90 }),
    ]
    const result = computeWeakPoints([pkg], progress)
    expect(result.map((w) => w.knowledgePointId)).toEqual(['kp-2', 'kp-1'])
    expect(result[1].score).toBeNull()
  })

  it('第三级 null 垫底：前两级相同时，有到期时间的排在 null 前面', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'A' },
      { id: 'kp-2', title: 'B' },
    ])
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 3, score: 50, nextReviewAt: null }),
      row({ id: 2, kpId: 'kp-2', wrongCount: 3, score: 50, nextReviewAt: '2026-05-01T00:00:00.000Z' }),
    ]
    expect(computeWeakPoints([pkg], progress).map((w) => w.knowledgePointId)).toEqual(['kp-2', 'kp-1'])
  })

  it('三级联动：错最多者居首，与 score/到期无关', () => {
    const pkg = pkgWith([
      { id: 'kp-hot', title: '最该练' },
      { id: 'kp-mid', title: '中间' },
      { id: 'kp-low', title: '最低' },
    ])
    const progress = [
      // kp-low：错最少但分数最低、最早到期 —— 仍应排在最后（wrongCount 优先）
      row({ id: 1, kpId: 'kp-low', wrongCount: 0, score: 10, nextReviewAt: '2026-01-01T00:00:00.000Z' }),
      row({ id: 2, kpId: 'kp-mid', wrongCount: 2, score: 55, nextReviewAt: null }),
      row({ id: 3, kpId: 'kp-hot', wrongCount: 9, score: 95, nextReviewAt: null }),
    ]
    expect(computeWeakPoints([pkg], progress).map((w) => w.knowledgePointId)).toEqual([
      'kp-hot',
      'kp-mid',
      'kp-low',
    ])
  })
})

// =====================================================================
// 3. limit
// =====================================================================
describe('computeWeakPoints —— limit', () => {
  const pkg = pkgWith([
    { id: 'kp-1' },
    { id: 'kp-2' },
    { id: 'kp-3' },
    { id: 'kp-4' },
    { id: 'kp-5' },
    { id: 'kp-6' },
    { id: 'kp-7' },
  ])
  // 7 个候选，wrongCount 7..1 递减 → 排序后 kp-1..kp-7
  const progress = Array.from({ length: 7 }, (_, i) =>
    row({ id: i + 1, kpId: `kp-${i + 1}`, wrongCount: 7 - i, score: 50 })
  )

  it('默认 5（构造 7 个候选，取错误次数最高的前 5）', () => {
    const result = computeWeakPoints([pkg], progress)
    expect(result.map((w) => w.knowledgePointId)).toEqual(['kp-1', 'kp-2', 'kp-3', 'kp-4', 'kp-5'])
  })

  it('显式 limit: 3', () => {
    const result = computeWeakPoints([pkg], progress, { limit: 3 })
    expect(result.map((w) => w.knowledgePointId)).toEqual(['kp-1', 'kp-2', 'kp-3'])
  })

  it('limit: 0 → []', () => {
    expect(computeWeakPoints([pkg], progress, { limit: 0 })).toEqual([])
  })
})

// =====================================================================
// 4. excludeKpIds（与今日推荐去重，§11.4 硬约束）
// =====================================================================
describe('computeWeakPoints —— excludeKpIds', () => {
  it('排除第 1 名后由第 6 名递补', () => {
    const pkg = pkgWith([
      { id: 'kp-1' },
      { id: 'kp-2' },
      { id: 'kp-3' },
      { id: 'kp-4' },
      { id: 'kp-5' },
      { id: 'kp-6' },
    ])
    const progress = Array.from({ length: 6 }, (_, i) =>
      row({ id: i + 1, kpId: `kp-${i + 1}`, wrongCount: 6 - i, score: 50 })
    )
    // 排序本应是 kp-1..kp-6，排除榜首 kp-1 后取前 5 → kp-2..kp-6
    const result = computeWeakPoints([pkg], progress, { excludeKpIds: ['kp-1'] })
    expect(result).toHaveLength(5)
    expect(result.map((w) => w.knowledgePointId)).toEqual(['kp-2', 'kp-3', 'kp-4', 'kp-5', 'kp-6'])
    // 第 6 名递补进来（若不去重它会被 limit 挡掉）
    expect(result.some((w) => w.knowledgePointId === 'kp-6')).toBe(true)
  })
})

// =====================================================================
// 5. reason（只含事实，绝不露分数）
// =====================================================================
describe('computeWeakPoints —— reason（§11.4/§11.5 只展事实不露分数）', () => {
  const pkg = pkgWith([
    { id: 'kp-due-wrong' },
    { id: 'kp-wrong' },
    { id: 'kp-due' },
    { id: 'kp-none' },
  ])

  it('due 且 wrongCount>0 → "错了 N 次，且到了该复习的时间"', () => {
    const progress = [
      row({ id: 1, kpId: 'kp-due-wrong', wrongCount: 3, score: 50, nextReviewAt: '2026-05-01T00:00:00.000Z' }),
    ]
    const result = computeWeakPoints([pkg], progress, { now: NOW })
    expect(result[0].reason).toBe('错了 3 次，且到了该复习的时间')
  })

  it('wrongCount>0 但未到期 → "错了 N 次"', () => {
    const progress = [row({ id: 1, kpId: 'kp-wrong', wrongCount: 3, score: 50, nextReviewAt: null })]
    const result = computeWeakPoints([pkg], progress, { now: NOW })
    expect(result[0].reason).toBe('错了 3 次')
  })

  it('due 且 wrongCount=0 → "到了该复习的时间"', () => {
    const progress = [
      row({ id: 1, kpId: 'kp-due', wrongCount: 0, score: 50, nextReviewAt: '2026-05-01T00:00:00.000Z' }),
    ]
    const result = computeWeakPoints([pkg], progress, { now: NOW })
    expect(result[0].reason).toBe('到了该复习的时间')
  })

  it('未到期且 wrongCount=0 → "需要练一练"', () => {
    const progress = [row({ id: 1, kpId: 'kp-none', wrongCount: 0, score: 50, nextReviewAt: null })]
    const result = computeWeakPoints([pkg], progress, { now: NOW })
    expect(result[0].reason).toBe('需要练一练')
  })

  it('探针：computeMasteryScore=37 的行，reason 不出现 "37"/"分"/"熟练度"/"%"', () => {
    const probe = row({ id: 1, kpId: 'kp-none', wrongCount: 2, score: 37, nextReviewAt: null })
    // 先确认这一行确实被算成 37 分（否则探针空转）
    expect(computeMasteryScore(probe)).toBe(37)
    const result = computeWeakPoints([pkg], [probe], { now: NOW })
    expect(result).toHaveLength(1)
    // score 进结构（供排序），但不进 reason
    expect(result[0].score).toBe(37)
    expect(result[0].reason).not.toContain('37')
    expect(result[0].reason).not.toContain('分')
    expect(result[0].reason).not.toContain('熟练度')
    expect(result[0].reason).not.toContain('%')
  })
})

// =====================================================================
// 6. 去重（canonicalize：同 key 多条取最新）
// =====================================================================
describe('computeWeakPoints —— 去重', () => {
  it('同一 kpId 同包两行（lastStudiedAt 一旧一新）→ 只出一条且用新行数据', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])
    const progress = [
      // 旧行：已掌握 + 错 9 次 + 高分 —— 若误用旧行，会被过滤掉或给出错数据
      row({
        id: 1,
        kpId: 'kp-1',
        status: '已掌握',
        wrongCount: 9,
        score: 90,
        lastStudiedAt: '2026-01-01T00:00:00.000Z',
      }),
      // 新行：需复习 + 错 2 次
      row({
        id: 2,
        kpId: 'kp-1',
        status: '需复习',
        wrongCount: 2,
        score: 40,
        lastStudiedAt: '2026-06-01T00:00:00.000Z',
      }),
    ]
    const result = computeWeakPoints([pkg], progress)
    expect(result).toHaveLength(1)
    expect(result[0].wrongCount).toBe(2) // 用新行
    expect(result[0].reason).toBe('错了 2 次')
  })
})

// =====================================================================
// 7. 孤儿行（packageId 不在 packages）
// =====================================================================
describe('computeWeakPoints —— 孤儿行', () => {
  it('packageId 不在 packages 的进度行 → 不进结果（canonicalize 的 orphanRows）', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])
    const progress = [
      row({ id: 1, kpId: 'kp-1', packageId: PKG, status: '需复习', wrongCount: 3 }),
      row({ id: 2, kpId: 'kp-ghost', packageId: 'deleted-pkg', status: '需复习', wrongCount: 99 }),
    ]
    const result = computeWeakPoints([pkg], progress)
    expect(result.map((w) => w.knowledgePointId)).toEqual(['kp-1'])
  })
})

// =====================================================================
// 8. due 边界（now 可注入）
// =====================================================================
describe('computeWeakPoints —— due 边界', () => {
  const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])

  it('nextReviewAt 刚好等于 now → 算到期（<= 语义）', () => {
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 0, score: 50, nextReviewAt: '2026-06-01T00:00:00.000Z' }),
    ]
    const result = computeWeakPoints([pkg], progress, { now: NOW })
    expect(result[0].reason).toBe('到了该复习的时间')
  })

  it('nextReviewAt 晚一分钟 → 不算到期', () => {
    const progress = [
      row({ id: 1, kpId: 'kp-1', wrongCount: 0, score: 50, nextReviewAt: '2026-06-01T00:01:00.000Z' }),
    ]
    const result = computeWeakPoints([pkg], progress, { now: NOW })
    expect(result[0].reason).toBe('需要练一练')
  })
})

// =====================================================================
// 9. 畸形行不抛异常
// =====================================================================
describe('computeWeakPoints —— 畸形行不抛异常', () => {
  it('wrongCount 缺失 / nextReviewAt 乱码 / fsrs={} / bkt 缺 pKnown → 不 throw', () => {
    const pkg = pkgWith([
      { id: 'kp-1', title: 'A' },
      { id: 'kp-2', title: 'B' },
      { id: 'kp-3', title: 'C' },
    ])
    const r1 = makeProgress({ id: 1, packageId: PKG, knowledgePointId: 'kp-1', status: '需复习' })
    // wrongCount 整个字段缺失
    delete (r1 as { wrongCount?: number }).wrongCount

    const r2 = makeProgress({
      id: 2,
      packageId: PKG,
      knowledgePointId: 'kp-2',
      status: '需复习',
      nextReviewAt: '乱码乱码',
    })
    // fsrs 是 {}、bkt 缺 pKnown：在 ProgressRecord 上直接覆写成畸形值（绕开 fixture 强类型）
    ;(r2 as { fsrs?: unknown; bkt?: unknown }).fsrs = {}
    ;(r2 as { fsrs?: unknown; bkt?: unknown }).bkt = {}

    const progress: ProgressRecord[] = [
      r1,
      r2,
      makeProgress({ id: 3, packageId: PKG, knowledgePointId: 'kp-3', status: '需复习' }),
    ]

    let result: ReturnType<typeof computeWeakPoints> = []
    expect(() => {
      result = computeWeakPoints([pkg], progress)
    }).not.toThrow()

    expect(Array.isArray(result)).toBe(true)
    // 缺 wrongCount 归一为 0，不是 NaN
    expect(result.find((w) => w.knowledgePointId === 'kp-1')?.wrongCount).toBe(0)
    // 乱码 nextReviewAt 视为未到期、不当成有效排序键
    expect(result.find((w) => w.knowledgePointId === 'kp-2')?.nextReviewAt).toBe('乱码乱码')
  })
})

// =====================================================================
// 10. 空输入
// =====================================================================
describe('computeWeakPoints —— 空输入', () => {
  it('packages=[] → []', () => {
    expect(computeWeakPoints([], [])).toEqual([])
  })

  it('progress=[] → []（有条目但都没学过）', () => {
    const pkg = pkgWith([{ id: 'kp-1', title: 'X' }])
    expect(computeWeakPoints([pkg], [])).toEqual([])
  })
})

// =====================================================================
// 附：title / sourcePkgTitle / sourcePackageId 取值正确
// =====================================================================
describe('computeWeakPoints —— 来源字段', () => {
  it('title / sourcePackageId / sourcePkgTitle 取自 entry 与包记录', () => {
    const manifest = { ...makePkg('pkg-a', 'math', []).manifest, title: '四年级数学·上' }
    const pkg: LearningPackageRecord = {
      packageId: 'pkg-a',
      manifest: manifest as LearningPackageRecord['manifest'],
      knowledgePoints: [{ id: 'kp-1', type: 'concept', title: '两位数乘法', content: '' }],
      exercises: [],
      units: [],
    }
    const progress = [row({ id: 1, kpId: 'kp-1', wrongCount: 4, score: 50 })]
    const result = computeWeakPoints([pkg], progress)
    expect(result[0]).toMatchObject({
      knowledgePointId: 'kp-1',
      title: '两位数乘法',
      sourcePackageId: 'pkg-a',
      sourcePkgTitle: '四年级数学·上',
    })
  })
})
