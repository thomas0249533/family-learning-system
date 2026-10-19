import { describe, expect, it } from 'vitest'
import type { ProgressRecord } from '@/db'
import { buildOwnerIndex } from '@core/progress/ownerIndex'
import { mergeProgressGroup, planProgressMerge, checkConservation } from '@core/progress/progressMerge'
import { makeProgress, makePkg } from './helpers/progressFixtures'

/** 5 个归属包：`unit-a` 声明 kp-a，`unit-b` 声明 kp-b… */
const packages = [
  makePkg('unit-a', 'math', [{ id: 'kp-a' }]),
  makePkg('unit-b', 'math', [{ id: 'kp-b' }]),
  makePkg('unit-c', 'math', [{ id: 'kp-c' }]),
  makePkg('unit-amb-1', 'math', [{ id: 'kp-amb' }]),
  makePkg('unit-amb-2', 'math', [{ id: 'kp-amb' }]),
]
const index = buildOwnerIndex(packages)

/** 应用计划后的"库里剩下的行"（不再有 deletes 那些 id，put 覆盖同 id 行） */
function applyPlan(rows: ProgressRecord[], plan: ReturnType<typeof planProgressMerge>): ProgressRecord[] {
  const putById = new Map<number, ProgressRecord>()
  for (const put of plan.puts) putById.set(put.id as number, put)
  const out: ProgressRecord[] = []
  for (const row of rows) {
    const id = row.id as number
    if (plan.deletes.includes(id)) continue
    out.push(putById.get(id) ?? row)
  }
  return out
}

function sums(rows: ProgressRecord[]): { correct: number; wrong: number; seconds: number } {
  return rows.reduce(
    (acc, row) => ({
      correct: acc.correct + (row.correctCount ?? 0),
      wrong: acc.wrong + (row.wrongCount ?? 0),
      seconds: acc.seconds + (row.studySeconds ?? 0),
    }),
    { correct: 0, wrong: 0, seconds: 0 }
  )
}

describe('planProgressMerge — 同一知识点被 3 个入口包写入 → 1 行', () => {
  const rows: ProgressRecord[] = [
    makeProgress({
      id: 11,
      packageId: 'term-x',
      knowledgePointId: 'kp-a',
      status: '学习中',
      correctCount: 1,
      wrongCount: 0,
      studySeconds: 30,
      lastStudiedAt: '2026-03-01T08:00:00.000Z',
    }),
    makeProgress({
      id: 12,
      packageId: 'sprint-y',
      knowledgePointId: 'kp-a',
      status: '学习中',
      correctCount: 1,
      wrongCount: 1,
      studySeconds: 30,
      lastStudiedAt: '2026-03-02T08:00:00.000Z',
    }),
    makeProgress({
      id: 13,
      packageId: 'daily-z',
      knowledgePointId: 'kp-a',
      status: '已掌握',
      correctCount: 3,
      wrongCount: 1,
      correctStreak: 3,
      studySeconds: 30,
      lastStudiedAt: '2026-03-03T08:00:00.000Z',
    }),
  ]

  it('3 行合并成 1 行，只删 2 行，承载体是 id 最小的那条', () => {
    const plan = planProgressMerge(rows, index)
    expect(plan.puts).toHaveLength(1)
    expect(plan.deletes).toEqual([12, 13])
    expect(plan.puts[0].id).toBe(11)
    expect(plan.stats).toEqual({
      total: 3,
      rewritten: 0,
      mergedGroups: 1,
      mergedRowsRemoved: 2,
      ambiguousKept: 0,
      final: 1,
    })
  })

  it('合并后的键 = (归属包, kpId)，计数求和', () => {
    const merged = planProgressMerge(rows, index).puts[0]
    expect(merged.packageId).toBe('unit-a')
    expect(merged.knowledgePointId).toBe('kp-a')
    expect(merged.correctCount).toBe(5)
    expect(merged.wrongCount).toBe(2)
    expect(merged.studySeconds).toBe(90)
  })

  it('status / correctStreak / wrongStreak 取 lastStudiedAt 最新那条（禁止取 max 等级）', () => {
    const merged = planProgressMerge(rows, index).puts[0]
    expect(merged.lastStudiedAt).toBe('2026-03-03T08:00:00.000Z')
    expect(merged.status).toBe('已掌握')
    expect(merged.correctStreak).toBe(3)
    expect(merged.wrongStreak).toBe(0)
  })

  it('幂等：把合并结果再跑一次 → put / delete 全空', () => {
    const first = planProgressMerge(rows, index)
    const after = applyPlan(rows, first)
    const second = planProgressMerge(after, index)
    expect(second.puts).toEqual([])
    expect(second.deletes).toEqual([])
    expect(second.stats.final).toBe(first.stats.final)
    expect(second.stats.rewritten).toBe(0)
    expect(second.stats.mergedGroups).toBe(0)
  })
})

describe('mergeProgressGroup — 逐字段语义（C6 覆盖 PRD 的"取最高等级"）', () => {
  it('旧的「已掌握」不会被 max 等级锁死：新行是「学习中」就取「学习中」', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({
          id: 1,
          packageId: 'p',
          knowledgePointId: 'kp',
          status: '已掌握',
          correctStreak: 5,
          correctCount: 9,
          lastStudiedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeProgress({
          id: 2,
          packageId: 'p',
          knowledgePointId: 'kp',
          status: '学习中',
          correctStreak: 1,
          wrongStreak: 1,
          correctCount: 1,
          wrongCount: 1,
          lastStudiedAt: '2026-06-01T00:00:00.000Z',
        }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.status).toBe('学习中')
    expect(merged.correctStreak).toBe(1)
    expect(merged.wrongStreak).toBe(1)
    expect(merged.id).toBe(1) // 承载体仍是 id 最小
    expect(merged.packageId).toBe('unit-a')
  })

  it('bkt.observed 求和（计数可累加），pKnown / masteryProbability 取证据最多那条（禁止平均）', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({
          id: 1,
          packageId: 'p',
          knowledgePointId: 'kp',
          bkt: { pKnown: 0.92, observed: 12 },
          masteryProbability: 0.92,
          lastStudiedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeProgress({
          id: 2,
          packageId: 'p',
          knowledgePointId: 'kp',
          bkt: { pKnown: 0.2, observed: 2 },
          masteryProbability: 0.2,
          lastStudiedAt: '2026-06-01T00:00:00.000Z',
        }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    // 设计 §2.3.3：`bkt.observed` **求和** —— 12 + 2 = 14（它只是"观测了几次"的计数，
    // 组内两条本来就是同一个知识点被记了两遍，次数当然要相加）
    expect(merged.bkt).toEqual({ pKnown: 0.92, observed: 14 })
    // 但概率不求和、也不平均（0.56 谁都不是）：只认证据最多的那一行（observed 12 的那条）
    expect(merged.masteryProbability).toBe(0.92)
  })

  it('bkt 缺失的老数据按 observed = 0 记，不抛异常', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({ id: 1, packageId: 'p', knowledgePointId: 'kp', masteryProbability: 0.4 }),
        makeProgress({ id: 2, packageId: 'p', knowledgePointId: 'kp' }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.bkt).toBeUndefined()
    expect(merged.masteryProbability).toBe(0.4)
  })

  it('组内只有部分行有 bkt → 缺的那几行按 0 参与求和，不吞掉已有的证据', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({
          id: 1,
          packageId: 'p',
          knowledgePointId: 'kp',
          bkt: { pKnown: 0.75, observed: 5 },
          lastStudiedAt: '2026-01-01T00:00:00.000Z',
        }),
        // 老数据：这一行没有 bkt（升级前的行），不能因为"最新它在"就把 5 次观测丢掉
        makeProgress({ id: 2, packageId: 'p', knowledgePointId: 'kp', lastStudiedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.bkt).toEqual({ pKnown: 0.75, observed: 5 })
    expect(merged.masteryProbability).toBe(0.75)
  })

  it('fsrs 取 last_review 最新的整卡，且排期三件套与它同源', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({
          id: 1,
          packageId: 'p',
          knowledgePointId: 'kp',
          fsrs: { due: '2026-02-01', last_review: '2026-01-01', stability: 3 },
          reviewStage: 1,
          nextReviewAt: '2026-02-01',
          lastReviewAt: '2026-01-01',
          lastStudiedAt: '2026-06-01T00:00:00.000Z', // 老卡却更新近作答
        }),
        makeProgress({
          id: 2,
          packageId: 'p',
          knowledgePointId: 'kp',
          fsrs: { due: '2026-07-01', last_review: '2026-06-20', stability: 9 },
          reviewStage: 4,
          nextReviewAt: '2026-07-01',
          lastReviewAt: '2026-06-20',
          lastStudiedAt: '2026-05-01T00:00:00.000Z',
        }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.fsrs?.due).toBe('2026-07-01')
    // 跨行拼装会让 nextReviewAt 与卡片 due 打架 → 必须同源
    expect(merged.reviewStage).toBe(4)
    expect(merged.nextReviewAt).toBe('2026-07-01')
    expect(merged.lastReviewAt).toBe('2026-06-20')
  })

  it('全组都没有 fsrs → 保持 undefined（不造空卡）', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({ id: 1, packageId: 'p', knowledgePointId: 'kp' }),
        makeProgress({ id: 2, packageId: 'p', knowledgePointId: 'kp' }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.fsrs).toBeUndefined()
  })

  it('lastStudiedAt 相同 → 用 id 升序决定 latest（D10 确定性）', () => {
    const same = '2026-05-05T00:00:00.000Z'
    const merged = mergeProgressGroup(
      [
        makeProgress({
          id: 1,
          packageId: 'p',
          knowledgePointId: 'kp',
          status: '已掌握',
          correctStreak: 4,
          lastStudiedAt: same,
        }),
        makeProgress({
          id: 2,
          packageId: 'p',
          knowledgePointId: 'kp',
          status: '学习中',
          correctStreak: 1,
          lastStudiedAt: same,
        }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.status).toBe('已掌握')
    expect(merged.correctStreak).toBe(4)
  })

  it('lastStudiedAt 非法/空 视为最旧', () => {
    const merged = mergeProgressGroup(
      [
        makeProgress({ id: 1, packageId: 'p', knowledgePointId: 'kp', status: '已掌握', lastStudiedAt: '' }),
        makeProgress({
          id: 2,
          packageId: 'p',
          knowledgePointId: 'kp',
          status: '学习中',
          lastStudiedAt: 'not-a-date',
        }),
        makeProgress({
          id: 3,
          packageId: 'p',
          knowledgePointId: 'kp',
          status: '需复习',
          lastStudiedAt: '2026-04-01T00:00:00.000Z',
        }),
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    )
    expect(merged.status).toBe('需复习')
  })

  it('其余未知字段前向兼容：以 latest 为底保留', () => {
    const latest = makeProgress({
      id: 2,
      packageId: 'p',
      knowledgePointId: 'kp',
      lastStudiedAt: '2026-06-01T00:00:00.000Z', // 必须是 latest，否则未知字段取的是另一条
    }) as ProgressRecord & { futureField?: string }
    latest.futureField = 'keep-me'
    const merged = mergeProgressGroup(
      [
        makeProgress({
          id: 1,
          packageId: 'p',
          knowledgePointId: 'kp',
          lastStudiedAt: '2026-01-01T00:00:00.000Z',
        }),
        latest,
      ],
      { packageId: 'unit-a', knowledgePointId: 'kp' }
    ) as ProgressRecord & { futureField?: string }
    expect(merged.futureField).toBe('keep-me')
  })
})

describe('planProgressMerge — 边界与统计', () => {
  it('单行、键未变 → 零写入', () => {
    const rows = [makeProgress({ id: 1, packageId: 'unit-a', knowledgePointId: 'kp-a' })]
    const plan = planProgressMerge(rows, index)
    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.stats).toEqual({
      total: 1,
      rewritten: 0,
      mergedGroups: 0,
      mergedRowsRemoved: 0,
      ambiguousKept: 0,
      final: 1,
    })
  })

  it('单行、键变了（历史短 id）→ rewritten 1，其余字段原样', () => {
    const rows = [
      makeProgress({
        id: 7,
        packageId: 'term-x',
        knowledgePointId: 'kp-a',
        status: '已掌握',
        correctCount: 4,
        studySeconds: 120,
      }),
    ]
    const plan = planProgressMerge(rows, index)
    expect(plan.deletes).toEqual([])
    expect(plan.stats.rewritten).toBe(1)
    expect(plan.puts[0]).toMatchObject({
      id: 7,
      packageId: 'unit-a',
      knowledgePointId: 'kp-a',
      status: '已掌握',
      correctCount: 4,
      studySeconds: 120,
    })
  })

  it('归属歧义（2 个声明者）→ 原样保留，一行都不动', () => {
    const rows = [
      makeProgress({ id: 1, packageId: 'unit-amb-1', knowledgePointId: 'kp-amb' }),
      makeProgress({ id: 2, packageId: 'unit-amb-2', knowledgePointId: 'kp-amb' }),
    ]
    const plan = planProgressMerge(rows, index)
    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.stats.ambiguousKept).toBe(2)
    expect(plan.stats.final).toBe(2)
  })

  it('无归属的 id（词表 word id）→ 单行原样保留，零写入', () => {
    const rows = [makeProgress({ id: 1, packageId: 'unit-a', knowledgePointId: 'word-apple' })]
    const plan = planProgressMerge(rows, index)
    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.stats.ambiguousKept).toBe(1)
    expect(plan.stats.final).toBe(1)
  })

  it('无归属但同键重复的行 → 仍合并（同键重复就是脏数据，与归属无关）', () => {
    const rows = [
      makeProgress({ id: 1, packageId: 'unit-a', knowledgePointId: 'word-apple', correctCount: 2, studySeconds: 30 }),
      makeProgress({ id: 2, packageId: 'unit-a', knowledgePointId: 'word-apple', correctCount: 1, studySeconds: 30 }),
    ]
    const plan = planProgressMerge(rows, index)
    expect(plan.deletes).toEqual([2])
    expect(plan.puts[0]).toMatchObject({
      id: 1,
      packageId: 'unit-a',
      knowledgePointId: 'word-apple',
      correctCount: 3,
      studySeconds: 60,
    })
  })

  it('没有数值 id 的行不参与 put/delete（防御：put 无 id 会变插入）', () => {
    const rows: ProgressRecord[] = [
      { ...makeProgress({ id: 0, packageId: 'term-x', knowledgePointId: 'kp-a' }), id: undefined },
      makeProgress({ id: 2, packageId: 'term-y', knowledgePointId: 'kp-a' }),
    ]
    const plan = planProgressMerge(rows, index)
    // 只有带 id 的那条被改写；id 缺失的行原样留着（它的 id 数据本来就有问题）
    expect(plan.puts).toHaveLength(1)
    expect(plan.puts[0].id).toBe(2)
    expect(plan.deletes).toEqual([])
    expect(plan.stats.total).toBe(2)
    expect(plan.stats.final).toBe(2)
  })

  it('空输入 → 全零，不抛', () => {
    expect(planProgressMerge([], index)).toEqual({
      puts: [],
      deletes: [],
      stats: {
        total: 0,
        rewritten: 0,
        mergedGroups: 0,
        mergedRowsRemoved: 0,
        ambiguousKept: 0,
        final: 0,
      },
    })
  })
})

describe('planProgressMerge — 守恒（迁移正确性的唯一硬指标）', () => {
  /** 造一批杂乱的库：3 个入口包 × 3 个知识点 + 歧义行 + 孤儿行 + 词表行 */
  function makeMessyRows(): ProgressRecord[] {
    const entryPkgs = ['term-x', 'sprint-y', 'daily-z']
    const kpIds = ['kp-a', 'kp-b', 'kp-c']
    const rows: ProgressRecord[] = []
    let id = 1
    for (const packageId of entryPkgs) {
      for (const kpId of kpIds) {
        rows.push(
          makeProgress({
            id,
            packageId,
            knowledgePointId: kpId,
            correctCount: id % 4,
            wrongCount: id % 3,
            studySeconds: 30 * (id % 5),
            lastStudiedAt: `2026-0${(id % 9) + 1}-0${(id % 9) + 1}T00:00:00.000Z`,
            status: (['未学', '学习中', '已掌握', '需复习'] as const)[id % 4],
          })
        )
        id += 1
      }
    }
    rows.push(makeProgress({ id: 100, packageId: 'unit-amb-1', knowledgePointId: 'kp-amb', correctCount: 2 }))
    rows.push(makeProgress({ id: 101, packageId: 'unit-amb-2', knowledgePointId: 'kp-amb', correctCount: 3 }))
    rows.push(makeProgress({ id: 102, packageId: 'deleted-pkg', knowledgePointId: 'kp-ghost', correctCount: 1 }))
    rows.push(makeProgress({ id: 103, packageId: 'unit-a', knowledgePointId: 'word-apple', correctCount: 5 }))
    return rows
  }

  it('ΣcorrectCount / ΣwrongCount / ΣstudySeconds 前后完全相等', () => {
    const rows = makeMessyRows()
    const plan = planProgressMerge(rows, index)
    const after = applyPlan(rows, plan)
    expect(sums(after)).toEqual(sums(rows))
  })

  it('行数只减不增，且 final = total - mergedRowsRemoved', () => {
    const rows = makeMessyRows()
    const plan = planProgressMerge(rows, index)
    expect(plan.stats.final).toBe(rows.length - plan.stats.mergedRowsRemoved)
    expect(plan.stats.final).toBeLessThanOrEqual(rows.length)
    expect(applyPlan(rows, plan)).toHaveLength(plan.stats.final)
  })

  it('迁移后每个 (packageId, kpId) 至多 1 行（歧义/孤儿行除外），且再跑一次是零写入', () => {
    const rows = makeMessyRows()
    const first = planProgressMerge(rows, index)
    const after = applyPlan(rows, first)
    const second = planProgressMerge(after, index)
    expect(second.puts).toEqual([])
    expect(second.deletes).toEqual([])
    expect(sums(after)).toEqual(sums(rows))
  })
})

describe('checkConservation —— 迁移正确性的独立探针', () => {
  const row = (id: number, correct: number, wrong: number, seconds: number): ProgressRecord =>
    makeProgress({
      id,
      packageId: 'unit-a',
      knowledgePointId: 'kp-a',
      correctCount: correct,
      wrongCount: wrong,
      studySeconds: seconds,
    })

  it('可累加量前后相等 + 行数不增 → ok，diffs 为空', () => {
    const before = [row(1, 3, 1, 60), row(2, 2, 2, 40)]
    const after = [row(1, 5, 3, 100)]
    const report = checkConservation(before, after)
    expect(report.ok).toBe(true)
    expect(report.diffs).toEqual([])
  })

  it('ΣcorrectCount 被造多了 → ok false，diffs 指出是哪个字段差多少', () => {
    const report = checkConservation([row(1, 3, 1, 60), row(2, 2, 2, 40)], [row(1, 6, 3, 100)])
    expect(report.ok).toBe(false)
    expect(report.diffs.some((d) => d.includes('ΣcorrectCount'))).toBe(true)
  })

  it('ΣwrongCount / ΣstudySeconds 各有一条独立判据（不是只看 correctCount）', () => {
    const wrongUp = checkConservation([row(1, 3, 1, 60)], [row(1, 3, 2, 60)])
    expect(wrongUp.ok).toBe(false)
    expect(wrongUp.diffs.some((d) => d.includes('ΣwrongCount'))).toBe(true)

    const secondsUp = checkConservation([row(1, 3, 1, 60)], [row(1, 3, 1, 90)])
    expect(secondsUp.ok).toBe(false)
    expect(secondsUp.diffs.some((d) => d.includes('ΣstudySeconds'))).toBe(true)
  })

  it('行数变多 → ok false（合并只许减不许增）', () => {
    const report = checkConservation([row(1, 0, 0, 0)], [row(1, 0, 0, 0), row(2, 0, 0, 0)])
    expect(report.ok).toBe(false)
    expect(report.diffs.some((d) => d.includes('行数'))).toBe(true)
  })

  it('状态机产物（streak / status）变了不算破坏守恒 —— 它们本来就该变', () => {
    const before = [
      makeProgress({ id: 1, packageId: 'unit-a', knowledgePointId: 'kp-a', correctStreak: 5, status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'unit-a', knowledgePointId: 'kp-a', correctStreak: 1, status: '学习中' }),
    ]
    const after = [makeProgress({ id: 1, packageId: 'unit-a', knowledgePointId: 'kp-a', correctStreak: 1, status: '学习中' })]
    expect(checkConservation(before, after).ok).toBe(true)
  })

  it('空输入 → ok，不抛', () => {
    expect(checkConservation([], []).ok).toBe(true)
  })
})
