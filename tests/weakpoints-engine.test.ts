import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * E2 · 智能错题重组引擎（`special-weakpoints-auto` 临时 special 包）
 * ------------------------------------------------------------------
 * 目标：按错因 + 失败程度，把长期没搞懂的错题重新打包成临时 special 包，
 * 让孩子集中攻克。包 id 稳定、每次生成**覆盖**旧包、不累积。
 *
 * ## 本文件的头号测试：归属回流
 * 临时包如果把自己选中 KP 的**定义**抄进 `knowledgePoints`，这些 KP 就有两个
 * 声明者 → `resolveOwnerPackageId` 判歧义返回 null → `recordProgress` 回落到
 * **入口包（临时包自己）** → 原包掌握度永不更新、家长端数字与孩子实际水平脱节。
 *
 * 所以引擎的设计选择是：临时包的 topic 通过 `knowledgePointIds` **引用**原 KP id，
 * 自己的 `knowledgePoints` 保持为空（唯一声明者留在原包）。这与线上既有的
 * `content/math-4-up-rjb/special-math-4-up-jiajiancheng.json` 完全同构
 * （它的 topics 引用 `unit-math-4-up-rjb-p5::kp-rel-*`，自己只声明 kp-rel-101）。
 * 下面第一条用例就是为这条设计背书的。
 *
 * fakeDexie 模式照 `tests/missing-packages.test.ts` / `tests/user-data-store.test.ts`。
 */

import { createFakeDexie } from './helpers/fakeDexie'
import type { LearningPackageRecord, MistakeRecord } from '@/db'
import type { WeakpointCandidate } from '@core/weakpoints/weakpointsEngine'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const { useUserDataStore } = await import('@core/stores/userData')
const { generateWeakpointsPackage } = await import('@core/weakpoints/generateWeakpoints')
const {
  WEAKPOINTS_PACKAGE_ID,
  WEAKPOINTS_CARELESS_RATIO,
  WEAKPOINTS_FAIL_THRESHOLD,
  WEAKPOINTS_MAX_QUESTIONS,
  buildWeakpointsPackage,
  exerciseFromMistake,
  selectWeakpoints,
} = await import('@core/weakpoints/weakpointsEngine')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { computeMasterySummary } = await import('@core/mastery/masterySummary')
const { MEASURABLE_IDS, progressOf } = await import('@core/motivation/achievementProgress')

// ---------------------------------------------------------------------------
// 夹具：一个单元包（三个 KP 分属两个单元内的 topic）+ 错题工厂
// ---------------------------------------------------------------------------

const UNIT_PKG = 'unit-math-4-up-rjb-p5'
const KP_ADD = 'unit-math-4-up-rjb-p5::kp-rel-001'
const KP_MUL = 'unit-math-4-up-rjb-p5::kp-rel-002'
const KP_GEO = 'unit-math-4-up-rjb-p5::kp-geo-006'
const UNIT_U8 = 'unit-math-4-up-rjb-p5::u8'
const UNIT_U7 = 'unit-math-4-up-rjb-p5::u7'
const ENG_PKG = 'unit-english-4-up-rjb-p1'
const KP_ENG = 'unit-english-4-up-rjb-p1::kp-word-001'

function seedUnitPackage(): LearningPackageRecord {
  return {
    packageId: UNIT_PKG,
    manifest: {
      schemaVersion: '1.0',
      packageId: UNIT_PKG,
      type: 'unit',
      subject: 'math',
      grade: 4,
      term: 'up',
      edition: '人教版',
      title: '第五单元',
    },
    knowledgePoints: [
      { id: KP_ADD, title: '速度、时间与路程', prerequisites: [] },
      { id: KP_MUL, title: '单价、数量与总价', prerequisites: [] },
      { id: KP_GEO, title: '几何图形', prerequisites: [] },
    ],
    exercises: [],
    units: [
      {
        id: UNIT_U7,
        name: '第七单元',
        title: '第七单元',
        topics: [
          { id: 'unit-math-4-up-rjb-p5::t0', title: '几何', knowledgePointIds: [KP_GEO], modules: [], exercises: [] },
        ],
      },
      {
        id: UNIT_U8,
        name: '第八单元',
        title: '第八单元',
        topics: [
          { id: 'unit-math-4-up-rjb-p5::t1', title: '行程问题', knowledgePointIds: [KP_ADD], modules: [], exercises: [] },
          { id: 'unit-math-4-up-rjb-p5::t2', title: '价格问题', knowledgePointIds: [KP_MUL], modules: [], exercises: [] },
        ],
      },
    ],
  } as unknown as LearningPackageRecord
}

function seedEnglishPackage(): LearningPackageRecord {
  return {
    packageId: ENG_PKG,
    manifest: {
      schemaVersion: '1.0',
      packageId: ENG_PKG,
      type: 'unit',
      subject: 'english',
      grade: 4,
      term: 'up',
      title: '英语第一单元',
    },
    knowledgePoints: [{ id: KP_ENG, title: '家庭成员单词', prerequisites: [] }],
    exercises: [],
    units: [
      {
        id: 'unit-english-4-up-rjb-p1::u1',
        name: '第一单元',
        title: '第一单元',
        topics: [
          { id: 'unit-english-4-up-rjb-p1::t1', title: '单词', knowledgePointIds: [KP_ENG], modules: [], exercises: [] },
        ],
      },
    ],
  } as unknown as LearningPackageRecord
}

let exSeq = 0

/** 造一条错题行。questionData 形如 QuizQuestion（addMistake 落库的就是它） */
function makeMistake(kpId: string, overrides: Partial<MistakeRecord> = {}): MistakeRecord {
  exSeq += 1
  const exerciseId = `ex-${kpId}-${exSeq}`
  const base: MistakeRecord = {
    profileId: 'default',
    packageId: UNIT_PKG,
    exerciseId,
    knowledgePointIds: [kpId],
    wrongAt: '2026-10-01T00:00:00.000Z',
    wrongCount: 1,
    mastered: false,
    masteryLevel: 'none',
    reviewCorrectCount: 0,
    questionData: {
      id: exerciseId,
      type: 'blank',
      question: `${exerciseId} 题干`,
      answer: '42',
      explanation: '解析',
      knowledgePointIds: [kpId],
    },
  }
  return { ...base, ...overrides, exerciseId }
}

/** 纯函数层候选（source 已解析；IO 层的解析逻辑另见 generateWeakpoints） */
function candidate(
  kpId: string,
  opts: {
    cause?: MistakeRecord['mistakeCause']
    level?: MistakeRecord['masteryLevel']
    wrongCount?: number
    wrongAt?: string
    subject?: string
  } = {}
): WeakpointCandidate {
  const cause = opts.cause ?? 'knowledge'
  const level = opts.level ?? 'none'
  const wrongCount = opts.wrongCount ?? 1
  return {
    mistake: makeMistake(kpId, {
      mistakeCause: cause,
      masteryLevel: level,
      mastered: level === 'mastered',
      wrongCount,
      ...(opts.wrongAt ? { wrongAt: opts.wrongAt } : {}),
    }),
    cause: cause!,
    level: level!,
    wrongCount,
    source: {
      packageId: opts.subject === 'english' ? ENG_PKG : UNIT_PKG,
      subject: opts.subject ?? 'math',
      grade: 4,
      term: 'up',
      kpTitle: `${kpId}-title`,
      unitId: opts.subject === 'english' ? 'unit-english-4-up-rjb-p1::u1' : UNIT_U8,
    },
  }
}

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

beforeEach(async () => {
  fake.__reset()
  __resetProfileForTest()
  // 归属索引是进程内缓存，测试之间必须清掉（照 user-data-store.test.ts）
  invalidateOwnerIndex()
  await initProfile()
  setActivePinia(createPinia())
})

// ---------------------------------------------------------------------------
// 1. 归属回流（本任务的头号测试）
// ---------------------------------------------------------------------------

describe('★ 归属回流：临时包内练习的进度必须落回原包', () => {
  it('recordProgress(临时包, 原kpId) → 落库行是原包 + 规范 kpId；原包 FSRS/BKT 被推进', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await fake.mistakes.add(makeMistake(KP_MUL, { wrongCount: 2, mistakeCause: 'timeout' }))

    const result = await generateWeakpointsPackage()
    expect(result.generated).toBe(true)
    expect(result.packageId).toBe(WEAKPOINTS_PACKAGE_ID)

    // 设计基石：临时包自己不声明 KP 定义（唯一声明者留在原包）
    const tempPkg = await fake.packages.get(WEAKPOINTS_PACKAGE_ID)
    expect(tempPkg).toBeDefined()
    expect(tempPkg!.knowledgePoints).toEqual([])

    const s = store()
    await s.recordProgress(WEAKPOINTS_PACKAGE_ID, KP_ADD, true, { questionType: 'blank' })

    const rows = fake.progress.rows
    expect(rows).toHaveLength(1)
    expect(rows[0].packageId).toBe(UNIT_PKG) // ← 回流到原包，不是临时包
    expect(rows[0].knowledgePointId).toBe(KP_ADD)
    expect(rows[0].correctCount).toBe(1)
    // 原包的掌握度证据被推进
    expect(rows[0].fsrs).toBeTruthy()
    expect(rows[0].masteryProbability).toBeGreaterThan(0)
    // 没有任何一行落在临时包名下
    expect(rows.some((r) => r.packageId === WEAKPOINTS_PACKAGE_ID)).toBe(false)
  })

  it('同一 KP 在临时包里答两次 → 仍然只有原包一行、计数累加（不稀释）', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await generateWeakpointsPackage()

    const s = store()
    await s.recordProgress(WEAKPOINTS_PACKAGE_ID, KP_ADD, true, { questionType: 'blank' })
    await s.recordProgress(WEAKPOINTS_PACKAGE_ID, KP_ADD, true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].packageId).toBe(UNIT_PKG)
    expect(fake.progress.rows[0].correctCount).toBe(2)
  })

  it('临时包里答对 → 错题本同 exerciseId 行的三级状态被推进（partial）', async () => {
    await fake.packages.put(seedUnitPackage())
    const m = makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' })
    await fake.mistakes.add(m)
    const gen = await generateWeakpointsPackage()
    expect(gen.generated).toBe(true)

    const s = store()
    // ExamPanel 的正确作答路径：先 recordProgress 再 resolveMistake
    await s.recordProgress(WEAKPOINTS_PACKAGE_ID, KP_ADD, true, { questionType: 'blank' })
    await s.resolveMistake(m.exerciseId, true)

    const row = await fake.mistakes
      .where('[profileId+exerciseId]')
      .equals(['default', m.exerciseId])
      .first()
    expect(row!.masteryLevel).toBe('partial')
  })

  it('临时包里答错 → addMistake 也归到原包（不错题本指向临时包）', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await generateWeakpointsPackage()

    const s = store()
    await s.addMistake(
      { id: 'brand-new-ex', type: 'blank', question: '新错题', answer: '1', explanation: '' } as never,
      WEAKPOINTS_PACKAGE_ID,
      [KP_MUL],
      'wrong-answer'
    )

    const row = await fake.mistakes
      .where('[profileId+exerciseId]')
      .equals(['default', 'brand-new-ex'])
      .first()
    expect(row!.packageId).toBe(UNIT_PKG)
  })

  it('归属解析失败的错题（KP 无唯一声明者）→ 不进卷、不生成包', async () => {
    await fake.packages.put(seedUnitPackage())
    // ghost KP：任何包都没声明 → resolveOwnerPackageId 返回 null
    await fake.mistakes.add(makeMistake('ghost::kp-nobody', { wrongCount: 5, mistakeCause: 'knowledge' }))

    const result = await generateWeakpointsPackage()

    expect(result.generated).toBe(false)
    expect(result.skippedCount).toBe(1)
    expect(result.reason).toBe('no-weakness')
    // 没有写出任何包（写出去了就会把进度锁在临时包上）
    expect(fake.packages.rows.filter((r) => r.packageId === WEAKPOINTS_PACKAGE_ID)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. 选题规则（纯函数）
// ---------------------------------------------------------------------------

describe('选题规则：错因 + 失败程度', () => {
  it('knowledge/timeout/misread 优先；careless 只按少量配额混入', () => {
    const selected = selectWeakpoints([
      candidate(KP_ADD, { cause: 'knowledge' }),
      candidate(KP_MUL, { cause: 'timeout' }),
      candidate(KP_GEO, { cause: 'misread' }),
      candidate(KP_ADD, { cause: 'careless' }),
      candidate(KP_MUL, { cause: 'careless' }),
      candidate(KP_GEO, { cause: 'careless' }),
      candidate(KP_ADD, { cause: 'careless' }),
      candidate(KP_MUL, { cause: 'careless' }),
      candidate(KP_GEO, { cause: 'careless' }),
    ])

    expect(selected.selected).toHaveLength(3 + Math.round(3 * WEAKPOINTS_CARELESS_RATIO))
    expect(selected.primaryCount).toBe(3)
    expect(selected.carelessCount).toBe(Math.round(3 * WEAKPOINTS_CARELESS_RATIO))
    // 混入的 careless 是少数派
    expect(selected.carelessCount).toBeLessThan(selected.primaryCount)
  })

  it('连续失败 ≥2 次的 careless 也算优先（练不会的，不是练粗心）', () => {
    const selected = selectWeakpoints([
      candidate(KP_ADD, { cause: 'careless', wrongCount: WEAKPOINTS_FAIL_THRESHOLD }),
      candidate(KP_MUL, { cause: 'careless', wrongCount: 1 }),
      candidate(KP_GEO, { cause: 'careless', wrongCount: 1 }),
    ])

    expect(selected.primaryCount).toBe(1)
    expect(selected.carelessCount).toBe(0) // 主池只有 1 题 → 配额 round(0.2)=0
    expect(selected.selected).toHaveLength(1)
  })

  it('mastered 的不选（needsReview 口径）', () => {
    const selected = selectWeakpoints([
      candidate(KP_ADD, { cause: 'knowledge', level: 'mastered' }),
      candidate(KP_MUL, { cause: 'knowledge', level: 'partial' }),
    ])

    expect(selected.selected).toHaveLength(1)
    expect(selected.selected[0].level).toBe('partial')
  })

  it('只有 careless 且未连续失败 → 空 selection，不炸', () => {
    const selected = selectWeakpoints([
      candidate(KP_ADD, { cause: 'careless' }),
      candidate(KP_MUL, { cause: 'careless', level: 'partial' }),
    ])

    expect(selected.selected).toEqual([])
    expect(selected.subject).toBeNull()
  })

  it('空错题本 → 空 selection，不炸', () => {
    expect(selectWeakpoints([]).selected).toEqual([])
    expect(selectWeakpoints(null as never).selected).toEqual([])
  })

  it('题目数受 WEAKPOINTS_MAX_QUESTIONS 上限约束', () => {
    const many: WeakpointCandidate[] = []
    for (let i = 0; i < WEAKPOINTS_MAX_QUESTIONS + 10; i++) {
      many.push(candidate(KP_ADD, { cause: 'knowledge', wrongCount: 1 }))
    }
    const selected = selectWeakpoints(many)
    expect(selected.selected).toHaveLength(WEAKPOINTS_MAX_QUESTIONS)
  })

  it('相同输入 → 相同输出顺序（确定性）', () => {
    const input = [
      candidate(KP_ADD, { cause: 'knowledge', wrongCount: 2 }),
      candidate(KP_MUL, { cause: 'knowledge', wrongCount: 5 }),
      candidate(KP_GEO, { cause: 'careless' }),
    ]
    const a = selectWeakpoints(input).selected.map((c) => c.mistake.exerciseId)
    const b = selectWeakpoints(input).selected.map((c) => c.mistake.exerciseId)
    expect(a).toEqual(b)
  })

  it('跨学科：只打包主导学科，另一学科的错题不混入（subject 闸门安全）', () => {
    const selected = selectWeakpoints([
      candidate(KP_ADD, { cause: 'knowledge' }),
      candidate(KP_MUL, { cause: 'knowledge' }),
      candidate(KP_GEO, { cause: 'knowledge' }),
      candidate(KP_ENG, { cause: 'knowledge', subject: 'english' }),
    ])

    expect(selected.subject).toBe('math')
    expect(selected.selected.every((c) => c.source?.subject === 'math')).toBe(true)
    expect(selected.selected).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// 3. 覆盖语义（不累积）
// ---------------------------------------------------------------------------

describe('覆盖语义：连生成两次，db.packages 里只有一行', () => {
  it('第二次生成覆盖同一 packageId，且反映最新错题本', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await fake.mistakes.add(makeMistake(KP_MUL, { wrongCount: 2, mistakeCause: 'misread' }))

    const first = await generateWeakpointsPackage()
    expect(first.questionCount).toBe(2)

    // 错题本变了：新增一道
    await fake.mistakes.add(makeMistake(KP_GEO, { wrongCount: 4, mistakeCause: 'knowledge' }))
    const second = await generateWeakpointsPackage()

    const rows = fake.packages.rows.filter((r) => r.packageId === WEAKPOINTS_PACKAGE_ID)
    expect(rows).toHaveLength(1)
    expect(second.questionCount).toBe(3)

    const pkg = rows[0]
    const count = (pkg.units ?? []).reduce(
      (n: number, u: any) => n + (u.topics ?? []).reduce((m: number, t: any) => m + (t.exercises ?? []).length, 0),
      0
    )
    expect(count).toBe(3)
  })

  it('空错题本 → 不生成、不写库、不炸', async () => {
    await fake.packages.put(seedUnitPackage())
    const result = await generateWeakpointsPackage()

    expect(result.generated).toBe(false)
    expect(result.questionCount).toBe(0)
    expect(fake.packages.rows).toHaveLength(1) // 只有原包
  })
})

// ---------------------------------------------------------------------------
// 4. 成就不污染
// ---------------------------------------------------------------------------

describe('成就不污染：临时包进 ctx.packages 不改变任何度量', () => {
  it('全部可进度化成就 + 掌握率汇总，带/不带临时包结果一致', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.packages.put(seedEnglishPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await fake.mistakes.add(makeMistake(KP_MUL, { wrongCount: 2, mistakeCause: 'timeout' }))

    // 先在原包上留下真实进度行（模拟孩子本来就学过）
    const s = store()
    await s.recordProgress(UNIT_PKG, KP_ADD, true, { questionType: 'blank' })
    await s.recordProgress(UNIT_PKG, KP_GEO, false, { questionType: 'blank' })

    await generateWeakpointsPackage()

    const packages = (await fake.packages.toArray()) as LearningPackageRecord[]
    const progress = fake.progress.rows
    const metas = packages.map((p) => ({
      packageId: p.packageId,
      subject: p.manifest.subject as string,
      grade: p.manifest.grade as number,
      term: p.manifest.term as string,
      packageType: (p.manifest as { type?: string }).type ?? '',
      kpCount: p.knowledgePoints?.length ?? 0,
    }))

    const baseCtx = {
      progress,
      mistakes: fake.mistakes.rows,
      streak: { current: 0, longest: 0, lastDate: '' },
      dailyStats: [],
      attemptedTypes: [],
    }
    const ctxWithTemp = { ...baseCtx, packages: metas }
    const ctxWithoutTemp = {
      ...baseCtx,
      packages: metas.filter((m) => m.packageId !== WEAKPOINTS_PACKAGE_ID),
    }

    for (const id of MEASURABLE_IDS) {
      expect(progressOf(id, ctxWithTemp as never)).toEqual(progressOf(id, ctxWithoutTemp as never))
    }

    // 掌握率分母/分子（Home / Parent / Report 同源）不受影响
    const withTemp = computeMasterySummary(packages, progress as never)
    const withoutTemp = computeMasterySummary(
      packages.filter((p) => p.packageId !== WEAKPOINTS_PACKAGE_ID),
      progress as never
    )
    expect(withTemp).toEqual(withoutTemp)
    // 临时包 kpCount 为 0 → 不进分母
    expect(metas.find((m) => m.packageId === WEAKPOINTS_PACKAGE_ID)!.kpCount).toBe(0)
  })

  it('回流之后：探索类成就的"学过的包"仍按原包计，不含临时包', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await generateWeakpointsPackage()

    const s = store()
    await s.recordProgress(WEAKPOINTS_PACKAGE_ID, KP_ADD, true, { questionType: 'blank' })

    const metas = (await fake.packages.toArray() as LearningPackageRecord[]).map((p) => ({
      packageId: p.packageId,
      subject: p.manifest.subject as string,
      grade: p.manifest.grade as number,
      term: p.manifest.term as string,
      packageType: (p.manifest as { type?: string }).type ?? '',
      kpCount: p.knowledgePoints?.length ?? 0,
    }))
    const ctx = {
      progress: fake.progress.rows,
      mistakes: fake.mistakes.rows,
      streak: { current: 0, longest: 0, lastDate: '' },
      dailyStats: [],
      attemptedTypes: [],
      packages: metas,
    }
    // explorer-3 数的是 progress 行的 packageId 去重 → 只有原包
    expect(progressOf('explorer-3', ctx as never)!.current).toBe(1)
    // term-cross 只认学过的包 → 临时包从未出现在进度行里
    expect(progressOf('term-cross', ctx as never)!.current).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 5. manifest 铁律
// ---------------------------------------------------------------------------

describe('manifest 铁律', () => {
  it('examMode / sourceUnitIds / dependencies / subject 口径全部合规', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await fake.mistakes.add(makeMistake(KP_MUL, { wrongCount: 2, mistakeCause: 'timeout' }))
    await generateWeakpointsPackage()

    const pkg = (await fake.packages.get(WEAKPOINTS_PACKAGE_ID)) as LearningPackageRecord
    const m = pkg.manifest as unknown as Record<string, unknown>

    expect(m.examMode).toBe(true)
    expect(m.type).toBe('special')
    expect(m.packageId).toBe(WEAKPOINTS_PACKAGE_ID)
    expect(pkg.packageId).toBe(WEAKPOINTS_PACKAGE_ID)
    expect(Array.isArray(m.sourceUnitIds)).toBe(true)
    expect((m.sourceUnitIds as string[]).length).toBeGreaterThan(0)
    // dependencies 列源单元包（照既有专项包实例，不是空）
    expect(m.dependencies).toEqual([UNIT_PKG])
    expect(m.subject).toBe('math')
    expect(m.grade).toBe(4)
    expect(m.term).toBe('up')
    expect(m.edition).toBe('人教版')

    // 题目携带的是原 KP id 的引用，且临时包没有声明任何 KP 定义
    const allKpRefs: string[] = []
    for (const u of pkg.units ?? []) {
      for (const t of u.topics ?? []) {
        allKpRefs.push(...((t.knowledgePointIds as string[]) ?? []))
        for (const ex of t.exercises ?? []) {
          allKpRefs.push(...((ex.knowledgePointIds as string[]) ?? []))
        }
      }
    }
    expect(allKpRefs.length).toBeGreaterThan(0)
    expect(allKpRefs.every((id) => id === KP_ADD || id === KP_MUL)).toBe(true)
    expect(pkg.knowledgePoints).toEqual([])
  })

  it('sourceUnitIds 精确到 KP 所在的单元（u8，不含无关的 u7）', async () => {
    await fake.packages.put(seedUnitPackage())
    await fake.mistakes.add(makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' }))
    await fake.mistakes.add(makeMistake(KP_MUL, { wrongCount: 2, mistakeCause: 'timeout' }))
    await generateWeakpointsPackage()

    const pkg = (await fake.packages.get(WEAKPOINTS_PACKAGE_ID)) as LearningPackageRecord
    expect((pkg.manifest as { sourceUnitIds?: string[] }).sourceUnitIds).toEqual([UNIT_U8])
  })

  it('topic 按 KP 分组、题目保留原 exerciseId（resolveMistake / addMistake 去重靠它）', async () => {
    await fake.packages.put(seedUnitPackage())
    const m1 = makeMistake(KP_ADD, { wrongCount: 3, mistakeCause: 'knowledge' })
    const m2 = makeMistake(KP_MUL, { wrongCount: 2, mistakeCause: 'timeout' })
    await fake.mistakes.add(m1)
    await fake.mistakes.add(m2)
    await generateWeakpointsPackage()

    const pkg = (await fake.packages.get(WEAKPOINTS_PACKAGE_ID)) as LearningPackageRecord
    const topicKpIds = (pkg.units ?? []).flatMap((u: any) =>
      (u.topics ?? []).map((t: any) => (t.knowledgePointIds as string[])[0])
    )
    expect(topicKpIds.sort()).toEqual([KP_ADD, KP_MUL].sort())

    const exerciseIds = (pkg.units ?? []).flatMap((u: any) =>
      (u.topics ?? []).flatMap((t: any) => (t.exercises ?? []).map((ex: any) => ex.id))
    )
    expect(exerciseIds.sort()).toEqual([m1.exerciseId, m2.exerciseId].sort())
  })
})

// ---------------------------------------------------------------------------
// 6. 题目归一化与包构建（纯函数边界）
// ---------------------------------------------------------------------------

describe('exerciseFromMistake / buildWeakpointsPackage', () => {
  it('questionData 缺 id 时回退错题行的 exerciseId（resolveMistake 匹配靠它）', () => {
    const m = makeMistake(KP_ADD)
    m.questionData = { type: 'blank', question: 'x', answer: '1' }
    expect(exerciseFromMistake(m)!.id).toBe(m.exerciseId)
  })

  it('questionData 与 exerciseId 双缺 / 缺 type / 缺 answer → 归一化失败（null）', () => {
    const noId = makeMistake(KP_ADD)
    noId.questionData = { type: 'blank', question: 'x', answer: '1' }
    noId.exerciseId = ''
    expect(exerciseFromMistake(noId)).toBeNull()

    const noType = makeMistake(KP_ADD)
    noType.questionData = { id: 'e1', question: 'x', answer: '1' }
    expect(exerciseFromMistake(noType)).toBeNull()

    const noAnswer = makeMistake(KP_ADD)
    noAnswer.questionData = { id: 'e1', type: 'blank', question: 'x' }
    expect(exerciseFromMistake(noAnswer)).toBeNull()

    const noKp = makeMistake(KP_ADD)
    noKp.knowledgePointIds = []
    expect(exerciseFromMistake(noKp)).toBeNull()
  })

  it('空 selection → buildWeakpointsPackage 抛错（程序员错误要响）', () => {
    expect(() => buildWeakpointsPackage(selectWeakpoints([]))).toThrow()
  })
})
