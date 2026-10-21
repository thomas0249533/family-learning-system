import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * V1.6 · Stage A · A2 · 档案隔离（写入端）
 *
 * ## 为什么单独一份文件
 * `tests/user-data-store.test.ts` 守的是"单个档案内"的链路（计数 → BKT → FSRS → 落库）。
 * 本文件守的是**跨档案**的那一层：同一个 `(packageId, kpId)` 在两个档案里必须是**两行**。
 *
 * 这条 invariants 在 V1.4 · B2 被真真实实违反过一次：`progressMerge` 的分组键漏了
 * `profileId`，于是"一个知识点一行"从档案内不变量悄悄变成了全库不变量 ——
 * 两个学同一本教材的孩子，后写的那个会把前一个的进度覆盖掉，
 * **行数不变、零报错**，只是某个孩子的学习记录凭空消失。
 *
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）。
 */
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const { useUserDataStore } = await import('@core/stores/userData')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const {
  currentProfileId,
  initProfile,
  switchProfile,
  __resetProfileForTest,
} = await import('@core/profile/currentProfile')
const { __resetDailyStatsForTest } = await import('@core/motivation/dailyStats')
const { __resetAttemptedTypesForTest } = await import('@core/motivation/attemptedTypes')

const PKG = 'unit-math-4-up-rjb-p1'
const KP = 'kp-num-001'

/** 一个题目对象（addMistake 只用到 id / question / answer） */
function question(id: string) {
  return { id, question: `${id} 题干`, answer: 'A', options: ['A', 'B'] } as any
}

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

/** 建第二个档案，然后**切回 default**（createProfile 会自动切到新档案，必须切回来） */
async function makeSecondProfile(): Promise<string> {
  const { createProfile } = await import('@core/profile/currentProfile')
  const meta = await createProfile('老二', new Date(2024, 0, 1))
  await switchProfile('default')
  expect(currentProfileId()).toBe('default')
  return meta.id
}

beforeEach(async () => {
  fake.__reset()
  // 三个模块级状态都要复位，且顺序有讲究：
  // `__resetProfileForTest` 会清空钩子表，而 dailyStats / attemptedTypes 的
  // `profileHooksBound` 是幂等标志 —— 不复用它们的 `__reset*ForTest` 的话，
  // 钩子被清走后永远不会再注册，"切档案前落盘"就静默失效，
  // 本文件的断言会全部变成假绿。这是抽取共享假 db 时暴露出来的第二类坑。
  __resetProfileForTest()
  __resetDailyStatsForTest()
  __resetAttemptedTypesForTest()
  invalidateOwnerIndex()
  await initProfile()
})

describe('档案隔离 · progress', () => {
  it('★ 两个档案学同一知识点 → 两行、各自计数，互不覆盖', async () => {
    const p2 = await makeSecondProfile()

    // 档案 A（default）答对 3 次
    await store().recordProgress(PKG, KP, true, { questionType: 'blank' })
    await store().recordProgress(PKG, KP, true, { questionType: 'blank' })
    await store().recordProgress(PKG, KP, true, { questionType: 'blank' })

    // 切到档案 B，同一个 (packageId, kpId) 再答一次
    await switchProfile(p2)
    expect(currentProfileId()).toBe(p2)
    await store().recordProgress(PKG, KP, true, { questionType: 'blank' })

    // 必须是两行 —— 合成一行就是 B2 那个"行数不变、零报错"的缺陷
    expect(fake.progress.rows).toHaveLength(2)
    const byPid = new Map(fake.progress.rows.map((r) => [r.profileId, r]))
    expect([...byPid.keys()].sort()).toEqual(['default', p2])
    expect(byPid.get('default')!.correctCount).toBe(3)
    expect(byPid.get(p2)!.correctCount).toBe(1)
    // 两行的 id 不同（不是同一行被改写）
    expect(byPid.get('default')!.id).not.toBe(byPid.get(p2)!.id)
  })

  it('★ 档案 A 写、档案 B 读 → B 一行都读不到（loadUserData 按档案过滤）', async () => {
    const p2 = await makeSecondProfile()
    // 注意：`store()` 每次都会新建 pinia，所以这里必须**复用同一个实例**，
    // 否则"读不到"是因为新 store 还没加载，而不是因为档案过滤。
    const s = store()
    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    await switchProfile(p2)
    await s.loadUserData()
    expect(s.progress).toHaveLength(0)

    // 切回 A 又能读到（不是被 B 的读操作清掉了）
    await switchProfile('default')
    await s.loadUserData()
    expect(s.progress).toHaveLength(1)
    expect(s.progress[0].correctCount).toBe(1)
  })

  it('同一档案重复写同一知识点 → 只 1 行、计数累加', async () => {
    const s = store()
    for (let i = 0; i < 5; i++) {
      await s.recordProgress(PKG, KP, true, { questionType: 'blank' })
    }
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(5)
  })

  it('两个档案的 FSRS 排期互不干扰（B 的作答不会把 A 的卡片顶爆）', async () => {
    const p2 = await makeSecondProfile()
    await store().recordProgress(PKG, KP, true, { questionType: 'blank' })
    const aCard = fake.progress.rows[0].fsrs

    await switchProfile(p2)
    for (let i = 0; i < 6; i++) {
      await store().recordProgress(PKG, KP, true, { questionType: 'blank' })
    }
    // 同一天内同一 KP 只推进一次排期，两行都还是 1 次
    expect(fake.progress.rows).toHaveLength(2)
    expect(fake.progress.rows.find((r) => r.profileId === 'default')!.fsrs).toEqual(aCard)
  })
})

describe('档案隔离 · mistakes', () => {
  it('★ 同一道题在两个档案各错一次 → 两行（错题本不串）', async () => {
    const p2 = await makeSecondProfile()

    await store().addMistake(question('ex-1'), PKG, [KP], 'B')
    await switchProfile(p2)
    await store().addMistake(question('ex-1'), PKG, [KP], 'B')

    expect(fake.mistakes.rows).toHaveLength(2)
    expect(fake.mistakes.rows.map((r) => r.profileId).sort()).toEqual(['default', p2])
    // 各自的 wrongCount 都是 1（没有互相累加）
    expect(fake.mistakes.rows.every((r) => r.wrongCount === 1)).toBe(true)
  })

  it('同一档案同一道题再错 → 只 1 行、wrongCount +1', async () => {
    const s = store()
    await s.addMistake(question('ex-1'), PKG, [KP], 'B')
    await s.addMistake(question('ex-1'), PKG, [KP], 'C')
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].wrongCount).toBe(2)
  })

  it('resolveMistake 只推进当前档案那一行', async () => {
    const p2 = await makeSecondProfile()
    await store().addMistake(question('ex-1'), PKG, [KP], 'B')

    await switchProfile(p2)
    await store().addMistake(question('ex-1'), PKG, [KP], 'B')
    await store().resolveMistake('ex-1', true)
    await store().resolveMistake('ex-1', true)

    const byPid = new Map(fake.mistakes.rows.map((r) => [r.profileId, r]))
    expect(byPid.get('default')!.masteryLevel).toBe('none')
    expect(byPid.get(p2)!.masteryLevel).toBe('mastered')
  })
})

describe('档案隔离 · settings 分片键', () => {
  it('★ 每日题量落在各自档案的键上（dailyStats:default / dailyStats:<p2>）', async () => {
    const p2 = await makeSecondProfile()
    const s = store()
    const { flushDailyStats } = await import('@core/motivation/dailyStats')

    // 内存在聚合、防抖 1500ms 才落盘，所以显式 flush 一下再断言
    // （浏览器里切档案会自动 flush；node 环境没有 window，钩子不注册，只能手动）
    await s.recordAnswerEvent({ exerciseId: 'ex-1', questionType: 'blank' })
    await flushDailyStats()

    await switchProfile(p2)
    await s.recordAnswerEvent({ exerciseId: 'ex-2', questionType: 'judge' })
    await flushDailyStats()
    await switchProfile('default')

    const keys = fake.settings.rows.map((r) => r.key)
    expect(keys).toContain('dailyStats:default')
    expect(keys).toContain(`dailyStats:${p2}`)
    // 没有任何一条键漏了分片后缀（漏了就是两个孩子共用一份统计）
    expect(keys.filter((k) => k === 'dailyStats')).toHaveLength(0)

    // 各自的题量是 1，不是 2（没有互相累加）
    const of = (pid: string) =>
      (fake.settings.rows.find((r) => r.key === `dailyStats:${pid}`)?.value as any[]) ?? []
    expect(of('default')).toHaveLength(1)
    expect(of('default')[0].questionCount).toBe(1)
    expect(of(p2)[0].questionCount).toBe(1)
  })

  it('题型记录同样分档案（attemptedTypes:<pid>）', async () => {
    const p2 = await makeSecondProfile()
    const s = store()
    const { flushAttemptedTypes } = await import('@core/motivation/attemptedTypes')

    await s.recordAnswerEvent({ questionType: 'spelling' })
    await flushAttemptedTypes()

    await switchProfile(p2)
    await s.recordAnswerEvent({ questionType: 'essay' })
    await flushAttemptedTypes()
    await switchProfile('default')

    const at = (pid: string) =>
      (fake.settings.rows.find((r) => r.key === `attemptedTypes:${pid}`)?.value as string[]) ?? []
    expect(at('default')).toEqual(['spelling'])
    expect(at(p2)).toEqual(['essay'])
  })
})
