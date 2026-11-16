import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * V4.1 · 「手写作答」数据层回归测试。
 *
 * ## 这个文件在守什么
 * 手写作答有一条本仓最贵的红线：**它的结论会回流进 `progress` / `mistakes`**。
 * 那两个字段（`correctCount` / `bkt` / 状态机）是掌握率、成就、弱项推荐的共同输入，
 * 一旦被手写路径"顺手"改掉，所有统计都会说谎而**不报错**。所以这里的断言
 * 不是"有没有写进去"，而是"**该写的写了、不该写的一个字节都没动**"：
 *   - 提交 → `pending`（不是 correct/unknown），且按题可查回；
 *   - 批改 `wrong` → 只进错题本，`progress` 一行都不许出现；
 *   - 批改 `correct` → 只走 `recordProgress`（逐知识点），错题本一行都不许出现。
 *
 * 第二条红线是**保留策略**：`pending` 是待批改队列，自动清理等于丢作业。
 * 所以"5 份没批的，purge 之后还是 5 份"必须被钉死。
 *
 * 第三条是**档案隔离**：`id` 是全库自增主键，跨档案时不可信。老二不能看到、
 * 更不能批改老大的手写作业。
 *
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（单一真相）。`handwritings` 在
 * `POST_V5_INDICES` 里（db v9 新增，不属于 v3/v4/v5 任何历史快照）。
 */
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const {
  submitHandwriting,
  listPendingHandwriting,
  listHandwritingByExercise,
  countPendingHandwriting,
  gradeHandwriting,
  purgeOldHandwriting,
  HANDWRITING_ANSWER_PLACEHOLDER,
} = await import('@core/stores/handwriting')
const { keepRecentByExercise, pickOverflowByProfile, mergePurgeIds } = await import(
  '@core/handwriting/retention'
)
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const { __resetDailyStatsForTest } = await import('@core/motivation/dailyStats')
const { __resetAttemptedTypesForTest } = await import('@core/motivation/attemptedTypes')
const {
  __resetProfileForTest,
  createProfile,
  currentProfileId,
  initProfile,
  switchProfile,
} = await import('@core/profile/currentProfile')

const PKG = 'pkg-vocab-4-up-1'
const KP_A = 'kp-word-001'
const KP_B = 'kp-word-002'

/** 一次合法的提交（5 格，`cells[i]` 是逐格笔迹串；这里用极简串够断言用） */
function submission(over: Record<string, any> = {}) {
  return {
    packageId: PKG,
    exerciseId: 'ex-apple',
    knowledgePointIds: [KP_A],
    prompt: '「苹果」的英文',
    correctAnswer: 'apple',
    cells: ['[]', '[]', '[]', '[]', '[]'],
    ...over,
  }
}

/** 一行手写作答夹具（类型与真实表一致：status 是联合类型，写错就编译失败） */
type HW = import('@/db').HandwritingRecord

function hwRow(over: Partial<HW> = {}): HW {
  return {
    profileId: 'default',
    packageId: PKG,
    exerciseId: 'ex-apple',
    knowledgePointIds: [KP_A],
    prompt: '「苹果」的英文',
    correctAnswer: 'apple',
    cells: ['[]'],
    cellCount: 1,
    status: 'correct',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * 直接塞进假库（绕过 store），用于构造"历史记录"。
 * 假库的行是 `Record<string, any>`，而 `HW` 是 interface（没有隐式索引签名），
 * 所以这里需要一次 cast —— 这是测试夹具，不是生产代码的宽松处理。
 */
function pushRow(over: Partial<HW> = {}): HW {
  const row = hwRow(over)
  fake.handwritings.rows.push({ ...row } as Record<string, any>)
  return row
}

beforeEach(async () => {
  fake.__reset()
  // 四个模块级状态都要复位（顺序同 user-data-store-profile.test.ts：
  // `__resetProfileForTest` 会清空钩子表，dailyStats/attemptedTypes 的
  // `profileHooksBound` 是幂等标志，不复用它们的 reset 会让钩子永远不再注册）
  __resetProfileForTest()
  __resetDailyStatsForTest()
  __resetAttemptedTypesForTest()
  invalidateOwnerIndex()
  await initProfile()
  // `gradeHandwriting` 内部走 `useUserDataStore()`，没有 active pinia 会直接抛
  setActivePinia(createPinia())
})

describe('提交：落库即 pending', () => {
  it('提交后 status=pending、档案取自 currentProfileId、可按题查回', async () => {
    const id = await submitHandwriting(submission())

    expect(typeof id).toBe('number')
    const rows = await listHandwritingByExercise('ex-apple')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].profileId).toBe('default')
    expect(rows[0].packageId).toBe(PKG)
    expect(rows[0].knowledgePointIds).toEqual([KP_A])
    // 快照：题干与答案都留在行上（包后来被删/被更新也还能批改）
    expect(rows[0].prompt).toBe('「苹果」的英文')
    expect(rows[0].correctAnswer).toBe('apple')
    // cellCount 缺省取 cells.length
    expect(rows[0].cellCount).toBe(5)
    // 还没批 → 没有 reviewedAt
    expect(rows[0].reviewedAt).toBeUndefined()
  })

  it('可显式传 cellCount（前端按"题目格数"传，缺省才是 cells.length）', async () => {
    await submitHandwriting(submission({ cells: ['[]', '[]'], cellCount: 8 }))
    const [row] = await listHandwritingByExercise('ex-apple')
    expect(row.cells).toEqual(['[]', '[]'])
    expect(row.cellCount).toBe(8)
  })

  it('★ cells 逐格原样落库：不解析、不改写、空格子（\'[]\'）保留', async () => {
    // cells[i] 是 serializeStrokes() 的产物。数据层当**不透明字符串**处理：
    // 解析是渲染组件的事（store 里解析一次、组件里再解析一次 = 两处口径）
    const inkA = '[{"color":"warning","width":3,"points":[{"x":0.1235,"y":0.5}]}]'
    await submitHandwriting(submission({ cells: [inkA, '[]'] }))

    const [row] = await listHandwritingByExercise('ex-apple')
    expect(row.cells[0]).toBe(inkA) // 逐字未改
    expect(row.cells[1]).toBe('[]') // 没写的格子不被过滤（"第 2 格空着"是信息）
    expect(row.cellCount).toBe(2)
  })

  it('★ 一个字都没写也落库（pending 队列不能漏掉"缺笔"）', async () => {
    const id = await submitHandwriting(submission({ cells: ['[]', '[]'] }))

    const row = fake.handwritings.rows.find((r) => r.id === id)!
    expect(row.status).toBe('pending')
    expect(row.cells).toEqual(['[]', '[]'])
    expect(await countPendingHandwriting()).toBe(1)
  })
})

describe('待批改队列', () => {
  it('listPendingHandwriting 只返回 pending，且最早的在前（FIFO）', async () => {
    await submitHandwriting(submission({ exerciseId: 'ex-a' }))
    await submitHandwriting(submission({ exerciseId: 'ex-b' }))
    await submitHandwriting(submission({ exerciseId: 'ex-c' }))

    const pending = await listPendingHandwriting()
    expect(pending.map((r) => r.exerciseId)).toEqual(['ex-a', 'ex-b', 'ex-c'])
    expect(await countPendingHandwriting()).toBe(3)

    // 批掉中间那份 → 队列里就不该再有它
    expect(await gradeHandwriting(pending[1].id!, 'correct')).toBe('graded')
    const after = await listPendingHandwriting()
    expect(after.map((r) => r.exerciseId)).toEqual(['ex-a', 'ex-c'])
    expect(await countPendingHandwriting()).toBe(2)
  })

  it('limit 生效（按 FIFO 取前 N 条）', async () => {
    for (const ex of ['ex-a', 'ex-b', 'ex-c']) {
      await submitHandwriting(submission({ exerciseId: ex }))
    }
    const two = await listPendingHandwriting(2)
    expect(two.map((r) => r.exerciseId)).toEqual(['ex-a', 'ex-b'])
    expect(await listPendingHandwriting(0)).toEqual([])
  })
})

describe('批改回流', () => {
  it('★ wrong：进错题本 + 写 progress（对错都要记，否则 BKT 只涨不跌）', async () => {
    const id = await submitHandwriting(submission())
    expect(await gradeHandwriting(id, 'wrong')).toBe('graded')

    const row = fake.handwritings.rows.find((r) => r.id === id)!
    expect(row.status).toBe('wrong')
    expect(typeof row.reviewedAt).toBe('string')

    expect(fake.mistakes.rows).toHaveLength(1)
    const mistake = fake.mistakes.rows[0]
    expect(mistake.exerciseId).toBe('ex-apple')
    expect(mistake.packageId).toBe(PKG)
    expect(mistake.knowledgePointIds).toEqual([KP_A])
    // cells 是笔迹 JSON 不是文本 → 用占位文案（空串会被错题本当成"没答"）
    expect(mistake.lastUserAnswer).toBe(HANDWRITING_ANSWER_PLACEHOLDER)
    expect(mistake.mastered).toBe(false)

    // ★ 对称性：手写答错**必须**写 progress，否则 BKT 只涨不跌（系统性偏高）
    expect(fake.progress.rows).toHaveLength(1)
    const rec = fake.progress.rows[0]
    expect(rec.knowledgePointId).toBe(KP_A)
    expect(rec.wrongCount).toBe(1)
    expect(rec.wrongStreak).toBe(1)
    expect(rec.correctCount).toBe(0)
    expect(rec.status).not.toBe('已掌握')

    // wrong 不写 wrongCells（那是 partial 专用）
    expect(row.wrongCells).toBeUndefined()
  })

  it('★ correct：逐知识点走 recordProgress，且不进错题本', async () => {
    const id = await submitHandwriting(submission({ knowledgePointIds: [KP_A, KP_B] }))
    expect(await gradeHandwriting(id, 'correct')).toBe('graded')

    const row = fake.handwritings.rows.find((r) => r.id === id)!
    expect(row.status).toBe('correct')
    expect(typeof row.reviewedAt).toBe('string')

    expect(fake.progress.rows).toHaveLength(2)
    expect(fake.progress.rows.map((r) => r.knowledgePointId).sort()).toEqual([KP_A, KP_B])
    for (const rec of fake.progress.rows) {
      expect(rec.correctCount).toBe(1)
      expect(rec.wrongCount).toBe(0)
    }
    expect(fake.mistakes.rows).toHaveLength(0)
  })

  it('★ correct 且此前打字错过这题 → resolveMistake 推进三级状态', async () => {
    // 上一次（打字）错过同题，错题本里已有未掌握的行
    fake.mistakes.rows.push({
      id: 1,
      profileId: 'default',
      packageId: PKG,
      exerciseId: 'ex-apple',
      knowledgePointIds: [KP_A],
      wrongAt: '2025-01-01T00:00:00.000Z',
      wrongCount: 1,
      mastered: false,
      masteryLevel: 'none',
      reviewCorrectCount: 0,
    })

    const id = await submitHandwriting(submission())
    expect(await gradeHandwriting(id, 'correct')).toBe('graded')

    const mistake = fake.mistakes.rows[0]
    expect(mistake.reviewCorrectCount).toBe(1)
    expect(mistake.masteryLevel).toBe('partial')
    expect(mistake.mastered).toBe(false)
  })

  it('★ partial：与 wrong 统计口径完全一致，仅多记 wrongCells', async () => {
    const id = await submitHandwriting(submission({ cellCount: 2, cells: ['[]', '[]'] }))
    // 越界(5/-1)、非整数(0.5)、重复(1) 全部要被掐掉，只留落在 [0,2) 的整数
    expect(await gradeHandwriting(id, 'partial', [1, 1, 5, -1, 0.5])).toBe('graded')

    const row = fake.handwritings.rows.find((r) => r.id === id)!
    expect(row.status).toBe('partial')
    expect(row.wrongCells).toEqual([1])
    expect(typeof row.reviewedAt).toBe('string')

    // 进错题本（与 wrong 同构）
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].exerciseId).toBe('ex-apple')
    // 逐字信息不进 mistakes（那张表是题目粒度，硬塞会破坏三级状态机）
    expect(fake.mistakes.rows[0].wrongCells).toBeUndefined()

    // ★ progress 与 wrong 同构：错一次就记一次，不能因为"半对"漏记
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].wrongCount).toBe(1)
    expect(fake.progress.rows[0].correctCount).toBe(0)

    // 批完就离开待批改队列
    expect(await countPendingHandwriting()).toBe(0)
  })

  it('★ wrong 与 partial 产生的 progress 结果一致（同一 KP 各记一次错）', async () => {
    const wrongId = await submitHandwriting(submission({ exerciseId: 'ex-a' }))
    const partialId = await submitHandwriting(
      submission({ exerciseId: 'ex-b', knowledgePointIds: [KP_B], cells: ['[]', '[]'], cellCount: 2 })
    )
    await gradeHandwriting(wrongId, 'wrong')
    await gradeHandwriting(partialId, 'partial', [0])

    const byKp = new Map(fake.progress.rows.map((r) => [r.knowledgePointId, r]))
    const a = byKp.get(KP_A)!
    const b = byKp.get(KP_B)!
    expect(a.wrongCount).toBe(1)
    expect(b.wrongCount).toBe(1)
    expect(a.correctCount).toBe(0)
    expect(b.correctCount).toBe(0)
    expect(a.status).toBe(b.status)
    expect(a.correctStreak).toBe(b.correctStreak)
  })

  it('★ 回流抛错 → 状态退回 pending，且仍在待批改列表里（可原地重试）', async () => {
    const id = await submitHandwriting(submission({ knowledgePointIds: [KP_A, KP_B] }))
    // 让 recordProgress 的首次落库失败（新记录走 add）
    fake.failOn.add('add:progress')

    await expect(gradeHandwriting(id, 'correct')).rejects.toThrow(/progress/)

    const row = fake.handwritings.rows.find((r) => r.id === id)!
    expect(row.status).toBe('pending')
    expect(row.reviewedAt).toBeUndefined()
    expect(await countPendingHandwriting()).toBe(1)
    const pending = await listPendingHandwriting()
    expect(pending.map((r) => r.id)).toEqual([id])

    // 恢复后可原地重试成功
    fake.failOn.clear()
    await gradeHandwriting(id, 'correct')
    expect(fake.handwritings.rows.find((r) => r.id === id)!.status).toBe('correct')
    expect(fake.progress.rows).toHaveLength(2)
  })

  it('★ 幂等：同一 id 连批两次，第二次返回 already 且统计不双计', async () => {
    const id = await submitHandwriting(submission())
    expect(await gradeHandwriting(id, 'correct')).toBe('graded')
    // 第二次给出相反结论 —— 必须被忽略，不能"改判"
    expect(await gradeHandwriting(id, 'wrong')).toBe('already')

    const row = fake.handwritings.rows.find((r) => r.id === id)!
    expect(row.status).toBe('correct') // 第一次的结论保持
    expect(fake.mistakes.rows).toHaveLength(0) // 没有第二条错题
    expect(fake.progress.rows).toHaveLength(1)
    // recordProgress 只生效一次（连点两次批改不会把 correctCount 顶到 2）
    expect(fake.progress.rows[0].correctCount).toBe(1)
  })

  it('★ 行被孩子的新作答顶掉 → replaced（不回流统计）', async () => {
    const oldId = await submitHandwriting(submission())
    // 孩子重写了一遍同一题（K=2 之后旧行本会被淘汰，这里只模拟"update 打空"）
    const newId = await submitHandwriting(submission())

    const original = fake.handwritings.update
    fake.handwritings.update = async () => 0
    let outcome: string
    try {
      outcome = await gradeHandwriting(oldId, 'correct')
    } finally {
      fake.handwritings.update = original
    }

    expect(outcome).toBe('replaced')
    expect(fake.progress.rows).toHaveLength(0)
    // 两条都还在（pending 不受 K=2 影响），说明这是"被替换"而不是"被清理"
    expect(fake.handwritings.rows.map((r) => r.id).sort()).toEqual([oldId, newId])
  })

  it('行已消失（同题没有别的行）→ ignored', async () => {
    const id = await submitHandwriting(submission())
    const original = fake.handwritings.update
    fake.handwritings.update = async () => 0
    let outcome: string
    try {
      outcome = await gradeHandwriting(id, 'correct')
    } finally {
      fake.handwritings.update = original
    }

    expect(outcome).toBe('ignored')
    expect(fake.progress.rows).toHaveLength(0)
    expect(fake.handwritings.rows[0].status).toBe('pending')
  })

  it('行不存在 / id 非法 / 跨档案 → ignored（不抛）', async () => {
    expect(await gradeHandwriting(999, 'correct')).toBe('ignored')
    expect(await gradeHandwriting(Number.NaN, 'correct')).toBe('ignored')
  })
})

describe('保留策略', () => {
  it('★ pending 永远不被清理（待批改 = 队列，不是历史）', async () => {
    for (let i = 1; i <= 5; i++) {
      pushRow({
        id: i,
        exerciseId: 'ex-apple',
        status: 'pending',
        createdAt: `2025-01-0${i}T00:00:00.000Z`,
      })
    }

    // 传了 exerciseId（走每题 K=2 那层）也不许动 pending
    expect(await purgeOldHandwriting('ex-apple')).toBe(0)
    expect(await purgeOldHandwriting()).toBe(0)
    expect(fake.handwritings.rows).toHaveLength(5)
  })

  it('★ 已批改的同一题只留最近 2 条', async () => {
    for (let i = 1; i <= 5; i++) {
      pushRow({ id: i, createdAt: `2025-01-0${i}T00:00:00.000Z` })
    }

    // 传 exerciseId：只读这一题的行（不读全表 —— 见 purgeOldHandwriting 的性能注释）
    expect(await purgeOldHandwriting('ex-apple')).toBe(3)
    expect(fake.handwritings.rows.map((r) => r.id).sort()).toEqual([4, 5])
  })

  it('★ 清理只作用于"这一题"：别的题的旧记录不会因为本次提交被误删', async () => {
    // ex-b 有 4 条已批改（超过 K=2），但本次提交的是 ex-apple
    for (let i = 1; i <= 4; i++) {
      pushRow({ id: i, exerciseId: 'ex-b', createdAt: `2025-01-0${i}T00:00:00.000Z` })
    }

    expect(await purgeOldHandwriting('ex-apple')).toBe(0)
    expect(fake.handwritings.rows).toHaveLength(4)

    // 不带参数时**只跑档案上限**那层（≤ M 就一条不删），不做每题 K=2 ——
    // 因为"每题 K=2"本来就是在该题被再次作答时按写路径顺手做的，
    // 全量场景（清空数据）要的是整表清，不是逐题修剪。
    expect(await purgeOldHandwriting()).toBe(0)
    expect(fake.handwritings.rows).toHaveLength(4)

    // ex-b 自己再写一次时，它的旧记录才会被修剪到 2 条
    const id = await submitHandwriting(submission({ exerciseId: 'ex-b' }))
    const ids = fake.handwritings.rows.map((r) => r.id).sort()
    expect(ids).toEqual([id - 2, id - 1, id])
  })

  it('提交后自动跑一次保留策略（旧记录被清，pending 留下）', async () => {
    for (let i = 1; i <= 4; i++) {
      pushRow({ id: i, createdAt: `2025-01-0${i}T00:00:00.000Z` })
    }
    await submitHandwriting(submission())

    const ids = fake.handwritings.rows.map((r) => r.id).sort()
    // 4 条已批改 → 只留最近 2 条（id 3、4），加上刚提交的 pending
    expect(ids).toEqual([3, 4, 5])
    expect(fake.handwritings.rows.filter((r) => r.status === 'pending')).toHaveLength(1)
  })

  it('清理失败不影响提交结果（只 warn）', async () => {
    // 让"删除"这一步炸掉：purge 中途抛错，但提交本身必须已经成功
    for (let i = 1; i <= 4; i++) {
      pushRow({ id: i, createdAt: `2025-01-0${i}T00:00:00.000Z` })
    }
    fake.failOn.add('delete:handwritings')

    const id = await submitHandwriting(submission())

    expect(typeof id).toBe('number')
    // 提交的这份在库里；清理失败 → 旧记录一条没删（不是"删了一半"）
    expect(fake.handwritings.rows.find((r) => r.id === id)?.status).toBe('pending')
    expect(fake.handwritings.rows).toHaveLength(5)
  })
})

describe('跨档案隔离', () => {
  it('★ 另一个档案查不到、也批不了' , async () => {
    const id = await submitHandwriting(submission())
    expect(await countPendingHandwriting()).toBe(1)

    // createProfile 会自动切到新档案
    const meta = await createProfile('老二', new Date(2024, 0, 1))
    expect(currentProfileId()).toBe(meta.id)

    expect(await listHandwritingByExercise('ex-apple')).toEqual([])
    expect(await listPendingHandwriting()).toEqual([])
    expect(await countPendingHandwriting()).toBe(0)
    // 清理也只看自己那份 → 老大的行不会被别人删掉
    expect(await purgeOldHandwriting()).toBe(0)

    // 跨档案批改 → ignored（数据完好，状态不变）
    expect(await gradeHandwriting(id, 'correct')).toBe('ignored')
    expect(fake.handwritings.rows[0].status).toBe('pending')
    expect(fake.progress.rows).toHaveLength(0)

    // 切回去还在
    await switchProfile('default')
    expect(await countPendingHandwriting()).toBe(1)
  })
})

describe('不进备份（反向断言）', () => {
  /**
   * 钉住"笔迹不进备份/合并"。这条断言存在的理由只有一个：将来一定有人
   * "顺手把新表补进备份契约"。后果不是丢数据（判分已经落进 `progress` /
   * `mistakes`），而是**每份备份体积翻倍**、并且把 A 设备的笔迹搬到 B 设备
   * —— 那边格子布局不同，回放出来只会错位。
   */
  it('库里有待批改行时，buildBackupV2 / readLocalSnapshot 都不带 handwritings', async () => {
    await submitHandwriting(submission())
    expect(fake.handwritings.rows).toHaveLength(1)

    const { buildBackupV2, readLocalSnapshot } = await import('@core/backup/bundleIO')

    const backup = await buildBackupV2()
    expect(JSON.stringify(backup)).not.toContain('handwritings')
    expect(JSON.stringify(backup)).not.toContain('"cellCount"')

    const snapshot = await readLocalSnapshot()
    expect(JSON.stringify(snapshot)).not.toContain('handwritings')
  })
})

describe('清空所有数据', () => {
  /**
   * 「清空所有数据（含包）」必须连笔迹一起清。
   *
   * 不补的话症状是**用户可见**的：家长点完清空，家长页待批改角标还在、
   * 点进去还能看到已删除包的笔迹 —— 比"留下无害历史"糟得多。
   *
   * 同时钉住"快照要留下"这条：3.1.2 就是因为 `settings.clear()` 把快照一起删了，
   * 才出了拿不回进度的事故。加了第五张表之后这个不变量必须仍然成立。
   */
  it('★ clearAllUserDataExceptSnapshots 清掉 handwritings，但保护快照仍在', async () => {
    const { clearAllUserDataExceptSnapshots, SNAPSHOTS_KEY } = await import(
      '@core/backup/autoSnapshot'
    )

    await fake.settings.put({
      key: SNAPSHOTS_KEY,
      value: {
        version: 1,
        items: [
          {
            id: 'pre-1',
            kind: 'preClear',
            date: '2026-01-01',
            createdAt: '2026-01-01T00:00:00.000Z',
            appVersion: '4.0.0',
            backup: { formatVersion: 2, exportedAt: '2026-01-01T00:00:00.000Z', profiles: [] },
          },
        ],
      },
    })
    await submitHandwriting(submission())
    expect(await fake.handwritings.where('profileId').equals('default').count()).toBe(1)

    await clearAllUserDataExceptSnapshots()

    expect(await fake.handwritings.where('profileId').equals('default').count()).toBe(0)
    // 快照是"这台设备的回滚点"，不是业务数据 —— 一条都不许少
    const rec = await fake.settings.get(SNAPSHOTS_KEY)
    expect((rec?.value as { items: unknown[] }).items).toHaveLength(1)
  })
})

describe('保留策略纯函数（直接测判定，不碰 IO）', () => {
  const graded = (id: number, exerciseId: string, createdAt: string, profileId = 'default') =>
    hwRow({ id, exerciseId, createdAt, profileId, status: 'correct' })

  it('keepRecentByExercise 按 (档案, 题目) 分组各自留 k 条', () => {
    const rows = [
      graded(1, 'ex-a', '2025-01-01T00:00:00.000Z'),
      graded(2, 'ex-a', '2025-01-02T00:00:00.000Z'),
      graded(3, 'ex-a', '2025-01-03T00:00:00.000Z'),
      graded(4, 'ex-b', '2025-01-01T00:00:00.000Z'),
      graded(5, 'ex-b', '2025-01-02T00:00:00.000Z'),
      graded(8, 'ex-b', '2025-01-03T00:00:00.000Z'),
      // 同一题在另一个档案 → 独立计额（否则会被算成 ex-a 的 5 条）
      graded(6, 'ex-a', '2025-01-01T00:00:00.000Z', 'kid-2'),
      graded(7, 'ex-a', '2025-01-02T00:00:00.000Z', 'kid-2'),
    ]
    // ex-a@default 3 条 → 删最旧 1 条；ex-b@default 3 条 → 删最旧 1 条；
    // ex-a@kid-2 只有 2 条 → 不删
    expect(keepRecentByExercise(rows).sort((a, b) => a - b)).toEqual([1, 4])
  })

  it('keepRecentByExercise 跳过 pending 与没有 id 的行', () => {
    const rows = [
      hwRow({ id: 1, status: 'pending', createdAt: '2025-01-01T00:00:00.000Z' }),
      hwRow({ id: 2, status: 'pending', createdAt: '2025-01-02T00:00:00.000Z' }),
      hwRow({ id: 3, status: 'pending', createdAt: '2025-01-03T00:00:00.000Z' }),
      hwRow({ status: 'correct', createdAt: '2025-01-04T00:00:00.000Z' }),
    ]
    expect(keepRecentByExercise(rows)).toEqual([])
  })

  it('pickOverflowByProfile 超上限时淘汰最旧的，压到 keep 条', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      graded(i + 1, `ex-${i + 1}`, `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)
    )
    // 上限 5、压缩到 3 → 删掉最旧的 7 条（id 1..7）
    expect(pickOverflowByProfile(rows, 5, 3).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ])
  })

  it('pickOverflowByProfile 只统计已批改（pending 不占额、也不会被删）', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        hwRow({ id: i + 1, exerciseId: `ex-${i + 1}`, status: 'pending', createdAt: `2025-02-0${i + 1}T00:00:00.000Z` })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        graded(i + 100, `ex-${i + 100}`, `2025-01-0${i + 1}T00:00:00.000Z`)
      ),
    ]
    // 已批改只有 4 条，未超上限 5 → 一条都不删
    expect(pickOverflowByProfile(rows, 5, 3)).toEqual([])
  })

  it('pickOverflowByProfile 按档案分组各自计额', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => graded(i + 1, `ex-a-${i}`, `2025-01-0${i + 1}T00:00:00.000Z`)),
      ...Array.from({ length: 2 }, (_, i) => graded(i + 10, `ex-b-${i}`, `2025-01-0${i + 1}T00:00:00.000Z`, 'kid-2')),
    ]
    // max=3 / keep=2：default 4→2（删 2 条），kid-2 只有 2 条不删
    expect(pickOverflowByProfile(rows, 3, 2).sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('mergePurgeIds 去重且保序', () => {
    expect(mergePurgeIds([3, 1, 1], [2, 3], [])).toEqual([3, 1, 2])
  })
})
