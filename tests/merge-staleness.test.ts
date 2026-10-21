import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bundle, LocalSnapshot } from '@core/backup/types'
import { createFakeDexie } from './helpers/fakeDexie'

/**
 * A6 · L2 **陈旧快照守卫**（V1.6 · Stage A）。
 *
 * ## 它要防的事故
 * 导入是两步：`previewImport` 事务外读快照 → 家长点确认 → `executeImport` 才落库。
 * 两步之间孩子跑去学习页答题，本地行被更新；直接 apply 会用备份里的旧值
 * **覆盖孩子刚产生的新记录**，而且不报错 —— 症状只是"刚答对的题又变成未掌握"，
 * 家长不会把它和几分钟前的导入联系起来。
 *
 * ## 夹具原则（比测试本身更重要）
 * **local 快照必须与库里的真实内容一致**。最稳的做法就是 seed 之后用
 * `fake.progress.toArray()` / `fake.mistakes.toArray()` 的返回值搭 `LocalSnapshot.bundles`
 * —— 这正是生产 `readLocalSnapshot()` 的行为，且 `id` 天然对齐。
 * 手写一份"看起来一样"的快照是这类测试最容易出现的假通过：基线对不上，
 * 守卫要么永远不触发（等于没测），要么永远触发（测的是夹具不是代码）。
 */

const PID = 'default'
const NOW = '2026-06-01T00:00:00.000Z'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const { applyMergePlan } = await import('@core/merge/applyMergePlan')
const { planMerge } = await import('@core/merge/mergeBundle')
const { progressKey } = await import('@core/merge/mergeProgress')
const { mistakeKey } = await import('@core/merge/mergeMistakes')
const { emptyPlan } = await import('@core/backup/types')

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function progressRow(over: Record<string, unknown> = {}) {
  return {
    profileId: PID,
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '学习中',
    correctCount: 1,
    wrongCount: 0,
    correctStreak: 0,
    wrongStreak: 0,
    lastStudiedAt: '2025-03-01T00:00:00.000Z',
    studySeconds: 10,
    ...over,
  }
}

function mistakeRow(over: Record<string, unknown> = {}) {
  return {
    profileId: PID,
    packageId: 'pkg-a',
    exerciseId: 'ex-1',
    knowledgePointIds: ['kp-1'],
    wrongAt: '2025-03-01T00:00:00.000Z',
    wrongCount: 1,
    mastered: false,
    masteryLevel: 'none',
    ...over,
  }
}

/** 远端档案：比本机更晚，这样才会产出 upsert（否则计划是 noop，没什么可守的） */
function remoteBundle(over: Partial<Bundle> = {}): Bundle {
  return {
    profileId: PID,
    name: '备份',
    createdAt: '2024-06-01T00:00:00.000Z',
    progress: [
      progressRow({
        status: '已掌握',
        correctCount: 9,
        correctStreak: 9,
        lastStudiedAt: '2026-05-01T00:00:00.000Z',
        lastReviewAt: '2026-05-02T00:00:00.000Z',
        studySeconds: 900,
      }),
    ],
    mistakes: [
      mistakeRow({
        wrongAt: '2026-05-01T00:00:00.000Z',
        wrongCount: 7,
        masteryLevel: 'mastered',
        mastered: true,
      }),
    ],
    examSessions: [],
    settings: {},
    ...over,
  }
}

/**
 * 从**假库当前内容**搭本机快照。
 *
 * 不用手写对象：手写一份"看起来一样"的快照会让基线与库对不上，
 * 守卫要么永远不触发（假通过），要么永远触发（测的是夹具）。见文件头。
 */
async function snapshotFromDb(profiles: string[] = [PID]): Promise<LocalSnapshot> {
  return {
    profiles: profiles.map((id) => ({ id, name: `名字-${id}`, createdAt: '2025-01-01T00:00:00.000Z' })),
    activeProfileId: profiles[0] ?? PID,
    bundles: await Promise.all(
      profiles.map(async (id) => ({
        profileId: id,
        name: `名字-${id}`,
        createdAt: '2025-01-01T00:00:00.000Z',
        progress: (await fake.progress.toArray()).filter((r) => r.profileId === id),
        mistakes: (await fake.mistakes.toArray()).filter((r) => r.profileId === id),
        examSessions: [],
        settings: {},
      })),
    ),
    globalSettings: {},
  }
}

/** 抓抛错并带回 code（守卫的失败必须带 code，UI 才能给"重新预览"的引导） */
async function captureError(fn: () => Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await fn()
  } catch (e) {
    return e as Error & { code?: string }
  }
  throw new Error('预期抛错，但实际没有抛')
}

/**
 * 清掉夹具 seed 产生的写记录。
 *
 * `fake.writes` 记的是**所有** put/add/update/delete，`fake.progress.add(row)` 也算。
 * 不清的话"apply 一个写动作都没发生"这条断言会被 seed 污染成假失败。
 */
function clearWrites(): void {
  fake.writes.length = 0
}

beforeEach(() => {
  fake.__reset()
})

// ---------------------------------------------------------------------------
// 1. 插队 → 中止
// ---------------------------------------------------------------------------

describe('A6 · L2 — 检测到本地新记录时中止（一行都不写）', () => {
  it('★ 进度插队：快照之后本地又学了同一知识点 → 中止、带 code、本机行一个字段都没被覆盖', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})
    expect(plan.progressUpserts).toHaveLength(1)
    // 基线确实是"plan 生成时那一行"
    expect(plan.stalenessGuard.progress[PID][progressKey(plan.progressUpserts[0])]).toBeTruthy()

    // 两步之间：孩子去学习页答对了 4 题（时间戳与内容都变了）
    await fake.progress.update(1, {
      correctCount: 5,
      correctStreak: 5,
      lastStudiedAt: '2026-05-20T00:00:00.000Z',
      lastReviewAt: '2026-05-21T00:00:00.000Z',
    })

    clearWrites()
    const err = await captureError(() => applyMergePlan(plan))
    expect(err.message).toBe('检测到新的学习记录，为了数据安全，请重新预览后再导入。')
    expect(err.code).toBe('stale-local-data')

    // 孩子刚学的内容**逐字段没被备份覆盖**，也没有 add 出新行
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(5)
    expect(fake.progress.rows[0].lastStudiedAt).toBe('2026-05-20T00:00:00.000Z')
    expect(fake.progress.rows[0].id).toBe(1)
    // 一个写动作都没发生（守卫前置于所有写入，不是"写了再回滚"）
    expect(fake.writes).toEqual([])
  })

  it('★ 错题插队：wrongAt / masteryLevel 被本地改过 → 中止', async () => {
    await fake.mistakes.add(mistakeRow({ id: 1, wrongAt: '2025-03-01T00:00:00.000Z', masteryLevel: 'none' }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})
    expect(plan.mistakeUpserts).toHaveLength(1)

    // 两步之间：孩子把这题复习到了 partial（只动 masteryLevel，时间戳可以不变 —— 见文件头取舍①）
    await fake.mistakes.update(1, { masteryLevel: 'partial', reviewCorrectCount: 1 })

    clearWrites()
    const err = await captureError(() => applyMergePlan(plan))
    expect(err.code).toBe('stale-local-data')
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].masteryLevel).toBe('partial')
    expect(fake.writes).toEqual([])
  })

  it('★ 基线为 null（快照时本机没有该行）→ apply 前该行出现 → 同样中止', async () => {
    // 本机**空**进度表：快照时这条知识点不存在 → 基线是 null
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})
    expect(plan.progressUpserts).toHaveLength(1)
    const k = progressKey(plan.progressUpserts[0])
    expect(plan.stalenessGuard.progress[PID][k]).toBeNull()

    // 两步之间：本地新建了同一知识点的进度（备份里没有、本机刚产生）
    await fake.progress.add(progressRow({ correctCount: 3, lastStudiedAt: '2026-05-20T00:00:00.000Z' }))

    clearWrites()
    const err = await captureError(() => applyMergePlan(plan))
    expect(err.code).toBe('stale-local-data')
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(3)
    expect(fake.writes).toEqual([])
  })

  it('不动 lastStudiedAt/lastReviewAt 的改动也会被抓到（浅合并下 masteryLevel/nextReviewAt 能在时间戳不变时被改）', async () => {
    await fake.progress.add(progressRow({ id: 1, nextReviewAt: '2025-03-02T00:00:00.000Z' }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})

    // 不动 lastStudiedAt / lastReviewAt，只改排期与掌握概率 —— 只比时间戳的守卫会漏掉这种
    await fake.progress.update(1, { nextReviewAt: '2026-01-01T00:00:00.000Z', masteryProbability: 0.77 })

    expect((await captureError(() => applyMergePlan(plan))).code).toBe('stale-local-data')
  })
})

// ---------------------------------------------------------------------------
// 2. 不误报
// ---------------------------------------------------------------------------

describe('A6 · L2 — 没有本地改动时正常放行', () => {
  it('★ 无插队：守卫放行，行被更新为备份值', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    await fake.mistakes.add(mistakeRow({ id: 1 }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})
    plan.stats.noop = false

    const applied = await applyMergePlan(plan)

    expect(applied.progress).toBe(1)
    expect(applied.mistakes).toBe(1)
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(9) // 备份更晚 → 覆盖
    expect(fake.progress.rows[0].status).toBe('已掌握')
    expect(fake.mistakes.rows[0].masteryLevel).toBe('mastered')
    expect(fake.writes).toContain('update:progress')
  })

  it('与 plan 无关的行被改动 → 不影响本次导入', async () => {
    await fake.progress.add(progressRow({ id: 1, knowledgePointId: 'kp-1' }))
    await fake.progress.add(progressRow({ id: 2, knowledgePointId: 'kp-无关' }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})

    // 改的是 plan 里没有的知识点：守卫只校验"plan 真的要写的行"
    await fake.progress.update(2, { correctCount: 99, lastStudiedAt: '2026-05-20T00:00:00.000Z' })

    await expect(applyMergePlan(plan)).resolves.toBeTruthy()
    expect(fake.progress.rows).toHaveLength(2)
  })

  it('★ 行被删掉再按同内容重建（id 变了）→ 不算"有新记录"，id 不参与比对', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})

    // id 是行身份的实现细节，不是内容：恢复备份/迁移都会让它变
    await fake.progress.update(1, { id: 77 })

    await expect(applyMergePlan(plan)).resolves.toBeTruthy()
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(9)
  })

  it('★ 基线键序不同、且带会被 JSON 往返丢掉的 undefined 值 → 不误报（stableStringify 的必要性）', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})
    const k = progressKey(plan.progressUpserts[0])
    const base = plan.stalenessGuard.progress[PID][k] as Record<string, unknown>

    // 换个键序 + 塞一个 executeImport 的 JSON 往返会整个丢掉的键
    const reordered: Record<string, unknown> = {}
    for (const key of Object.keys(base).reverse()) reordered[key] = base[key]
    reordered.nextReviewAt = undefined
    plan.stalenessGuard.progress[PID][k] = reordered

    await expect(applyMergePlan(plan)).resolves.toBeTruthy()
    expect(fake.progress.rows[0].correctCount).toBe(9)
  })

  it('手工拼的计划（没有基线）→ 跳过守卫而不是误报"检测到新记录"', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    const plan = emptyPlan()
    plan.stats.noop = false
    plan.progressUpserts.push(progressRow({ correctCount: 4 }))

    // 没有基线可比。报"检测到新的学习记录"会是**误导**（真正原因是计划没带基线），
    // 所以这里选择放行；代价由"planMerge 必须填满基线"那条用例兜住。
    await expect(applyMergePlan(plan)).resolves.toBeTruthy()
    expect(fake.progress.rows[0].correctCount).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 3. executeImport 的真实路径：JSON 往返
// ---------------------------------------------------------------------------

describe('A6 · L2 — executeImport 的 JSON 往返之后守卫依然有效', () => {
  it('★ 往返 + 无插队 → 放行', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle()], NOW, {})

    // executeImport 的做法：plan 塞进 Vue ref 会被深层代理，Proxy 不能 structured clone
    const plain = JSON.parse(JSON.stringify(plan))

    const applied = await applyMergePlan(plain)
    expect(applied.progress).toBe(1)
    expect(fake.progress.rows[0].correctCount).toBe(9)
  })

  it('★ 往返 + 插队 → 仍然中止（往返没把守卫冲掉）', async () => {
    await fake.progress.add(progressRow({ id: 1, correctCount: 1 }))
    const local = await snapshotFromDb()
    const plan = JSON.parse(JSON.stringify(planMerge(local, [remoteBundle()], NOW, {})))

    await fake.progress.update(1, { correctCount: 5, lastStudiedAt: '2026-05-20T00:00:00.000Z' })

    const err = await captureError(() => applyMergePlan(plan))
    expect(err.code).toBe('stale-local-data')
    expect(fake.progress.rows[0].correctCount).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 4. 基线必须由 planMerge 填满（否则上面那些"跳过"就是洞）
// ---------------------------------------------------------------------------

describe('A6 · L2 — planMerge 必须把基线填满', () => {
  it('★ 每个 upsert 都有基线，且基线就是本机那一行（没有就是 null）', async () => {
    await fake.progress.add(progressRow({ id: 1, knowledgePointId: 'kp-1' }))
    await fake.progress.add(progressRow({ id: 2, knowledgePointId: 'kp-2' }))
    await fake.mistakes.add(mistakeRow({ id: 1, exerciseId: 'ex-1' }))
    const local = await snapshotFromDb()

    const remote = remoteBundle({
      progress: [
        progressRow({ knowledgePointId: 'kp-1', lastStudiedAt: '2026-05-01T00:00:00.000Z', correctCount: 9 }),
        progressRow({ knowledgePointId: 'kp-2', lastStudiedAt: '2026-05-01T00:00:00.000Z', correctCount: 9 }),
        // kp-3 本机没有 → 基线应为 null
        progressRow({ knowledgePointId: 'kp-3', lastStudiedAt: '2026-05-01T00:00:00.000Z', correctCount: 9 }),
      ],
      mistakes: [
        mistakeRow({ exerciseId: 'ex-1', wrongAt: '2026-05-01T00:00:00.000Z', wrongCount: 9 }),
        mistakeRow({ exerciseId: 'ex-新', wrongAt: '2026-05-01T00:00:00.000Z', wrongCount: 9 }),
      ],
    })
    const plan = planMerge(local, [remote], NOW, {})

    expect(plan.progressUpserts).toHaveLength(3)
    expect(plan.mistakeUpserts).toHaveLength(2)

    // 桶的 key 集合 === upsert 的 key 集合（一个洞都不许有）
    expect(Object.keys(plan.stalenessGuard.progress[PID]).sort()).toEqual(
      plan.progressUpserts.map((r) => progressKey(r)).sort(),
    )
    expect(Object.keys(plan.stalenessGuard.mistakes[PID]).sort()).toEqual(
      plan.mistakeUpserts.map((r) => mistakeKey(r)).sort(),
    )
    // 基线内容就是本机那一行（含 id）
    const bucket = plan.stalenessGuard.progress[PID]
    expect((bucket['pkg-a\u0000kp-1'] as { id: number }).id).toBe(1)
    expect(bucket['pkg-a\u0000kp-3']).toBeNull()
    expect(plan.stalenessGuard.mistakes[PID]['ex-新']).toBeNull()
  })

  it('★ 两层 Record：同一 key 在两个档案下是两行，基线不串', async () => {
    const other = 'p2'
    await fake.progress.add(progressRow({ id: 1, profileId: PID, knowledgePointId: 'kp-1', correctCount: 1 }))
    await fake.progress.add(progressRow({ id: 2, profileId: other, knowledgePointId: 'kp-1', correctCount: 2 }))

    const local = await snapshotFromDb([PID, other])
    const remote = [
      remoteBundle({ profileId: PID }),
      remoteBundle({ profileId: other, name: '备份2' }),
    ]
    const plan = planMerge(local, remote, NOW, {})

    const key = progressKey(plan.progressUpserts[0])
    expect((plan.stalenessGuard.progress[PID][key] as { correctCount: number }).correctCount).toBe(1)
    expect((plan.stalenessGuard.progress[other][key] as { correctCount: number }).correctCount).toBe(2)

    // 只动 p2 那行 → 中止，且中止信息指向 p2 的桶
    await fake.progress.update(2, { correctCount: 8, lastStudiedAt: '2026-05-20T00:00:00.000Z' })
    expect((await captureError(() => applyMergePlan(plan))).code).toBe('stale-local-data')
  })

  it('空计划 / noop 计划不带基线，也不开事务', async () => {
    const local = await snapshotFromDb()
    const plan = planMerge(local, [remoteBundle({ progress: [], mistakes: [] })], NOW, {})
    expect(plan.stats.noop).toBe(true)
    expect(plan.stalenessGuard).toEqual({ progress: {}, mistakes: {} })

    const applied = await applyMergePlan(plan)
    expect(applied).toEqual({ progress: 0, mistakes: 0, sessions: 0, settings: 0, profiles: 0 })
    expect(fake.txCount).toBe(0)
  })
})
