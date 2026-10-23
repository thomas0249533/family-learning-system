import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 专题练习断点（V2.0 · 轨道 B）。
 *
 * ## 分两组，理由不同
 * 1. **纯函数**（快照 / 校验 / 累积 / 进度）：断点续传的全部风险都在这里 ——
 *    一行对不上的旧进度如果被"继续"，孩子会做到错位的题号上，而且**不报错**。
 *    所以四类腐坏（缺字段 / 类型错 / 题库对不上 / 题号越界）必须逐条钉死。
 * 2. **备份口径**：`topicSessions` 是设备本地瞬态，不准进 `buildBackupV2()` /
 *    `readLocalSnapshot()`。这条不钉住，将来一定有人"顺手补全" ——
 *    后果是把"做到一半的练习"同步到另一台设备上，那边开机就弹"继续上次"。
 *
 * 替身仍是 `tests/helpers/fakeDexie.ts`（索引清单与 `src/db/index.ts` 逐字比对，
 * 见 `fakeDexie-guard.test.ts`）。本文件不测 UI —— SFC 在本仓不可单测。
 */
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const { buildSnapshot, validateSnapshot, accumulateAnswer, progressOf } = await import(
  '@core/session/topicSession'
)
const { buildBackupV2, readLocalSnapshot } = await import('@core/backup/bundleIO')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')

const NOW = '2025-01-15T10:00:00.000Z'
const START = '2025-01-14T09:00:00.000Z'
const QIDS = ['q1', 'q2', 'q3', 'q4']

function baseInput(over: Record<string, any> = {}) {
  return {
    profileId: 'default',
    packageId: 'pkg',
    topicId: 'topic',
    questionIds: QIDS,
    answers: {},
    currentIndex: 0,
    startedAt: START,
    now: NOW,
    ...over,
  }
}

// ===========================================================================
// 1. buildSnapshot
// ===========================================================================

describe('buildSnapshot', () => {
  it('按题目集合算出 totalCount，并原样保留 profileId / packageId / topicId', () => {
    const snap = buildSnapshot(baseInput())
    expect(snap).toMatchObject({
      profileId: 'default',
      packageId: 'pkg',
      topicId: 'topic',
      questionIds: ['q1', 'q2', 'q3', 'q4'],
      totalCount: 4,
      currentIndex: 0,
      startedAt: START,
      updatedAt: NOW,
      status: 'ongoing',
    })
    expect(snap.id).toBeUndefined()
  })

  it('没传 startedAt 时用 now 起头；更新时 updatedAt 走 now', () => {
    const snap = buildSnapshot({ ...baseInput(), startedAt: undefined })
    expect(snap.startedAt).toBe(NOW)
    expect(snap.updatedAt).toBe(NOW)
  })

  it('题号去重；题库里没有的答案丢弃（防止旧题库残留串进新练习）', () => {
    const snap = buildSnapshot(
      baseInput({
        questionIds: ['q1', 'q1', 'q2'],
        answers: {
          q1: { userAnswer: 'A', isCorrect: true },
          ghost: { userAnswer: 'B', isCorrect: false },
        },
      })
    )
    expect(snap.questionIds).toEqual(['q1', 'q2'])
    expect(snap.totalCount).toBe(2)
    expect(Object.keys(snap.answers)).toEqual(['q1'])
  })

  it('currentIndex 越界会被夹回 [0, total-1]（负值 / 过大 / 非数字）', () => {
    expect(buildSnapshot(baseInput({ currentIndex: -5 })).currentIndex).toBe(0)
    expect(buildSnapshot(baseInput({ currentIndex: 99 })).currentIndex).toBe(3)
    expect(buildSnapshot(baseInput({ currentIndex: 'x' as any })).currentIndex).toBe(0)
  })

  it('空题库不炸：totalCount=0，currentIndex=0', () => {
    const snap = buildSnapshot(baseInput({ questionIds: [] }))
    expect(snap.totalCount).toBe(0)
    expect(snap.currentIndex).toBe(0)
  })

  it('isCorrect 不是布尔 → 归为 false；status 只认 finished', () => {
    const snap = buildSnapshot(
      baseInput({ answers: { q1: { userAnswer: 'A', isCorrect: 'yes' } }, status: 'done' })
    )
    expect(snap.answers.q1.isCorrect).toBe(false)
    expect(snap.status).toBe('ongoing')
    expect(buildSnapshot(baseInput({ status: 'finished' })).status).toBe('finished')
  })

  it('带上已有行的 id（upsert 不新增第二行）', () => {
    expect(buildSnapshot(baseInput({ id: 7 })).id).toBe(7)
  })
})

// ===========================================================================
// 2. validateSnapshot —— 四类腐坏，一律 null，绝不 throw
// ===========================================================================

describe('validateSnapshot', () => {
  /** 一条健康行（由 buildSnapshot 产出，保证与写路径同形） */
  function healthyRow(over: Record<string, any> = {}) {
    return buildSnapshot(
      baseInput({
        answers: {
          q1: { userAnswer: 'A', isCorrect: true },
          q2: { userAnswer: 'C', isCorrect: false },
        },
        currentIndex: 2,
        ...over,
      })
    )
  }

  it('健康行原样通过，且题号/答案都在', () => {
    const row = healthyRow()
    const ok = validateSnapshot(row, QIDS)
    expect(ok).not.toBeNull()
    expect(ok!.currentIndex).toBe(2)
    expect(Object.keys(ok!.answers).sort()).toEqual(['q1', 'q2'])
  })

  it('缺字段（profileId / packageId / topicId / questionIds / startedAt）→ null', () => {
    for (const key of ['profileId', 'packageId', 'topicId', 'questionIds', 'startedAt']) {
      const row: Record<string, any> = healthyRow()
      delete row[key]
      expect(validateSnapshot(row, QIDS), `缺 ${key}`).toBeNull()
    }
  })

  it('类型不对（questionIds 不是数组 / answers 是数组 / status 非法）→ null', () => {
    expect(validateSnapshot(healthyRow({ questionIds: 'q1,q2' as any }), QIDS)).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), answers: [] }, QIDS)).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), status: 'paused' }, QIDS)).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), id: '1' as any }, QIDS)?.id).toBeUndefined()
  })

  it('题库对不上（长度不同 / 同长度但 id 不同 / 顺序被重排）→ null', () => {
    const row = healthyRow()
    expect(validateSnapshot(row, ['q1', 'q2', 'q3'])).toBeNull()
    expect(validateSnapshot(row, ['q1', 'q2', 'q3', 'q9'])).toBeNull()
    // 顺序也算「对不上」：题号 = 下标，重排后"第 3 题"不再是同一道题
    expect(validateSnapshot(row, ['q2', 'q1', 'q3', 'q4'])).toBeNull()
  })

  it('currentIndex 越界 / 非整数 / totalCount 与题号数不符 → null', () => {
    expect(validateSnapshot({ ...healthyRow(), currentIndex: 4 }, QIDS)).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), currentIndex: -1 }, QIDS)).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), currentIndex: 1.5 }, QIDS)).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), totalCount: 9 }, QIDS)).toBeNull()
  })

  it('answers 里某条缺 isCorrect / 不是对象 → null（半截写入不能当进度）', () => {
    expect(
      validateSnapshot({ ...healthyRow(), answers: { q1: { userAnswer: 'A' } } }, QIDS)
    ).toBeNull()
    expect(validateSnapshot({ ...healthyRow(), answers: { q1: null } }, QIDS)).toBeNull()
  })

  it('题库里没有的答案键被丢掉（不阻断恢复，也不影响题号）', () => {
    const row: Record<string, any> = {
      ...healthyRow(),
      answers: {
        q1: { userAnswer: 'A', isCorrect: true },
        ghost: { userAnswer: 'B', isCorrect: true },
      },
    }
    const ok = validateSnapshot(row, QIDS)
    expect(ok).not.toBeNull()
    expect(Object.keys(ok!.answers)).toEqual(['q1'])
  })

  it('任意垃圾输入都不 throw，只返回 null', () => {
    const junk: any[] = [null, undefined, 0, 'row', [], [1, 2], { answers: {} }, new Date()]
    for (const v of junk) {
      expect(() => validateSnapshot(v, QIDS)).not.toThrow()
      expect(validateSnapshot(v, QIDS)).toBeNull()
    }
    // 当前题库本身是脏的也不能炸
    expect(validateSnapshot(healthyRow(), [] as any)).toBeNull()
    expect(validateSnapshot(healthyRow(), null as any)).toBeNull()
  })

  it('空题库的行（questionIds=[]）不可续传', () => {
    expect(validateSnapshot(buildSnapshot(baseInput({ questionIds: [] })), [])).toBeNull()
  })
})

// ===========================================================================
// 3. accumulateAnswer
// ===========================================================================

describe('accumulateAnswer', () => {
  it('返回新对象，不改入参（Vue ref 要能感知变化）', () => {
    const before = { q1: { userAnswer: 'A', isCorrect: true } }
    const after = accumulateAnswer(before, 'q2', { userAnswer: ['A', 'B'], isCorrect: false })
    expect(after).not.toBe(before)
    expect(Object.keys(before)).toEqual(['q1'])
    expect(after.q2).toEqual({ userAnswer: ['A', 'B'], isCorrect: false })
  })

  it('同一题重复作答覆盖旧值（不是追加）', () => {
    const first = accumulateAnswer({}, 'q1', { userAnswer: 'A', isCorrect: false })
    const second = accumulateAnswer(first, 'q1', { userAnswer: 'B', isCorrect: true })
    expect(Object.keys(second)).toEqual(['q1'])
    expect(second.q1).toEqual({ userAnswer: 'B', isCorrect: true })
  })

  it('空 qid / 非对象 payload / null 入参都不炸', () => {
    expect(accumulateAnswer(null, '', { userAnswer: 1, isCorrect: true })).toEqual({})
    expect(accumulateAnswer(undefined, 'q1', null as any)).toEqual({})
    expect(accumulateAnswer({ q1: { userAnswer: 1, isCorrect: true } }, '', null as any)).toEqual({
      q1: { userAnswer: 1, isCorrect: true },
    })
  })

  it('isCorrect 归一到布尔', () => {
    expect(accumulateAnswer({}, 'q1', { userAnswer: 'A', isCorrect: 'yes' as any }).q1.isCorrect).toBe(
      false
    )
  })
})

// ===========================================================================
// 4. progressOf
// ===========================================================================

describe('progressOf', () => {
  it('answered 数答案条数（不是 currentIndex+1）', () => {
    const row = buildSnapshot(
      baseInput({
        answers: {
          q1: { userAnswer: 'A', isCorrect: true },
          q3: { userAnswer: 'B', isCorrect: false },
        },
        currentIndex: 3,
      })
    )
    expect(progressOf(row)).toEqual({ answered: 2, total: 4, percent: 50, currentIndex: 3 })
  })

  it('null / 畸形行返回全零（弹窗文案不能显示 NaN）', () => {
    expect(progressOf(null)).toEqual({ answered: 0, total: 0, percent: 0, currentIndex: 0 })
    expect(progressOf({} as any)).toEqual({ answered: 0, total: 0, percent: 0, currentIndex: 0 })
  })

  it('题号越界的行也不会给出越界的 currentIndex', () => {
    const row = { ...buildSnapshot(baseInput()), currentIndex: 99 }
    expect(progressOf(row).currentIndex).toBe(3)
  })
})

// ===========================================================================
// 5. 备份口径 —— topicSessions 是设备本地瞬态
// ===========================================================================

describe('备份口径：topicSessions 不进备份 / 不进本机快照', () => {
  beforeEach(async () => {
    fake.__reset()
    __resetProfileForTest()
    await fake.settings.put({
      key: 'profiles',
      value: {
        activeId: 'default',
        list: [{ id: 'default', name: '老大', createdAt: '2024-01-01T00:00:00.000Z' }],
      },
    })
    await initProfile()
  })

  it('buildBackupV2 的 profile 字段集合仍是 progress/mistakes/examSessions', async () => {
    // 库里有三条断点（ongoing + finished + 别人的），备份都不该看见
    await fake.topicSessions.add({
      profileId: 'default',
      packageId: 'pkg',
      topicId: 't1',
      questionIds: ['q1', 'q2'],
      answers: { q1: { userAnswer: 'A', isCorrect: true } },
      currentIndex: 1,
      totalCount: 2,
      startedAt: START,
      updatedAt: NOW,
      status: 'ongoing',
    })

    const backup = await buildBackupV2()
    const profile = backup.profiles[0] as unknown as Record<string, unknown>

    expect(Object.keys(profile).sort()).toEqual(
      ['createdAt', 'examSessions', 'mistakes', 'name', 'profileId', 'progress', 'settings'].sort()
    )
    expect(JSON.stringify(backup)).not.toContain('topicSessions')
    expect(JSON.stringify(backup)).not.toContain('"topicId"')
  })

  it('readLocalSnapshot（合并引擎的输入）也不带 topicSessions', async () => {
    const snapshot = await readLocalSnapshot()
    const bundle = snapshot.bundles[0] as unknown as Record<string, unknown>
    expect(Object.keys(bundle).sort()).toEqual(
      ['createdAt', 'examSessions', 'mistakes', 'name', 'profileId', 'progress', 'settings'].sort()
    )
    expect(JSON.stringify(snapshot)).not.toContain('topicSessions')
  })

  it('反向验证：同样一条练习行如果混进 examSessions 会立刻出现在备份里（证明断言有牙）', async () => {
    await fake.examSessions.add({
      profileId: 'default',
      packageId: 'pkg',
      sessionIndex: 1,
      questionIds: ['q1'],
      answers: {},
      currentIndex: 0,
      elapsedSeconds: 0,
      totalCount: 1,
      timeLimit: 0,
      startedAt: START,
      status: 'ongoing',
    })
    const backup = await buildBackupV2()
    expect(JSON.stringify(backup)).toContain('examSessions')
    expect(backup.profiles[0].examSessions).toHaveLength(1)
  })
})
