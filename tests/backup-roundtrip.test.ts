import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 备份往返（导出 → 清空 → 导入）与 AC-P2-17（v1 里的旧 `achievements` 键不该抹掉本机成就）。
 *
 * 为什么必须是"集成"测试：单测 `planMerge` 只能证明"算得对"，证明不了
 * "导出写的字段名和导入读的字段名一致"。这一层用内存版 Dexie 替身跑完整链路，
 * 任何一侧改了键名/形状都会在这里断掉。
 *
 * 替身来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）：
 * `where(索引名)` 按索引名解析字段，未知索引名直接抛错 ——
 * v4 删掉了 `[packageId+knowledgePointId]`，漏改的查询必须炸，不能静默跨档案。
 */
import { createFakeDexie } from './helpers/fakeDexie'

/**
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）：
 * 索引清单与 `src/db/index.ts` 的 `version(4)` 逐字对应，未知索引抛错。
 */
const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const { buildBackupV2, readLocalSnapshot } = await import('@core/backup/bundleIO')
const { importBackupFile, previewImport } = await import('@core/backup/importOrchestrator')
const { initProfile, __resetProfileForTest, switchProfile, listProfilesSync, profilesState, onProfileChange } =
  await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const { PROFILE_SCOPED_KEYS } = await import('@core/profile/settingsScope')

const T = '2025-03-01T00:00:00.000Z'

/** 两个档案 + 各自的数据 + 分片 settings（模拟"一台用了半年的设备"） */
async function seedTwoProfiles() {
  await fake.settings.put({
    key: 'profiles',
    value: {
      activeId: 'default',
      list: [
        { id: 'default', name: '老大', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'p_b', name: '老二', createdAt: '2024-02-01T00:00:00.000Z' },
      ],
    },
  })
  await initProfile()

  await fake.progress.add({
    id: 1,
    profileId: 'default',
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '已掌握',
    correctCount: 4,
    wrongCount: 0,
    correctStreak: 4,
    wrongStreak: 0,
    lastStudiedAt: T,
    studySeconds: 120,
  })
  await fake.progress.add({
    id: 2,
    profileId: 'default',
    packageId: 'pkg-a',
    knowledgePointId: 'kp-2',
    status: '学习中',
    correctCount: 1,
    wrongCount: 1,
    correctStreak: 0,
    wrongStreak: 1,
    lastStudiedAt: T,
    studySeconds: 60,
  })
  await fake.progress.add({
    id: 3,
    profileId: 'p_b',
    packageId: 'pkg-b',
    knowledgePointId: 'kp-9',
    status: '学习中',
    correctCount: 2,
    wrongCount: 0,
    correctStreak: 2,
    wrongStreak: 0,
    lastStudiedAt: T,
    studySeconds: 30,
  })
  await fake.mistakes.add({
    id: 1,
    profileId: 'default',
    packageId: 'pkg-a',
    exerciseId: 'ex-1',
    knowledgePointIds: ['kp-1'],
    wrongAt: T,
    wrongCount: 2,
    mastered: false,
    masteryLevel: 'none',
  })
  await fake.examSessions.add({
    id: 1,
    profileId: 'default',
    packageId: 'pkg-a',
    sessionIndex: 1,
    questionIds: ['q1', 'q2'],
    answers: {},
    currentIndex: 2,
    elapsedSeconds: 300,
    totalCount: 2,
    timeLimit: 0,
    startedAt: T,
    finishedAt: T,
    status: 'finished',
    finalCorrect: 2,
    finalRate: 1,
  })
  await fake.settings.put({
    key: 'achievements:default',
    value: [{ id: 'badge-a', unlockedAt: '2024-03-01T00:00:00.000Z' }],
  })
  await fake.settings.put({ key: 'studyStreak:default', value: { current: 3, best: 5, lastDate: '2025-03-01' } })
  await fake.settings.put({ key: 'fls:theme', value: 'forest' })
}

beforeEach(() => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  setActivePinia(createPinia())
})

describe('buildBackupV2 — 导出', () => {
  it('逐档案导出：两个档案各自一份，settings 用全名键', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()

    expect(backup.formatVersion).toBe(2)
    expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(backup.activeProfileId).toBe('default')
    expect(backup.profiles.map((p) => p.profileId)).toEqual(['default', 'p_b'])

    const first = backup.profiles[0]
    expect(first.name).toBe('老大')
    expect(first.progress).toHaveLength(2) // 老二那一行不能混进来
    expect(first.mistakes).toHaveLength(1)
    expect(first.examSessions).toHaveLength(1)
    // 键带 `:<pid>` 后缀（备份要能直接 settings.put 写回）
    expect(first.settings.map((s) => s.key).sort()).toEqual([
      'achievements:default',
      'studyStreak:default',
    ])

    const second = backup.profiles[1]
    expect(second.progress).toHaveLength(1)
    expect(second.progress[0].knowledgePointId).toBe('kp-9')
    // 某表为空 → `[]`，不省略字段
    expect(second.mistakes).toEqual([])
    expect(second.examSessions).toEqual([])
    expect(second.settings).toEqual([])
  })

  it('全局键进 globalSettings，且不含"本机跑过什么"的记账键', async () => {
    await seedTwoProfiles()
    await fake.settings.put({ key: 'migration:v4', value: { status: 'ok' } })
    const backup = await buildBackupV2()

    const keys = backup.globalSettings.map((s) => s.key)
    expect(keys).toContain('profiles')
    expect(keys).toContain('fls:theme')
    expect(keys).not.toContain('migration:v4')
  })

  it('未知键（表单里没登记的）也带进备份，但不进 Bundle.settings', async () => {
    await seedTwoProfiles()
    await fake.settings.put({ key: 'somethingFromTheFuture:default', value: { a: 1 } })

    const backup = await buildBackupV2()
    // 导出要忠实：静默漏一个键，用户恢复后它就永久消失了
    expect(backup.profiles[0].settings.map((s) => s.key)).toContain(
      'somethingFromTheFuture:default',
    )

    // 快照只带登记过的分片键（合并函数不认识别的，塞进去会被静默丢掉）
    const local = await readLocalSnapshot()
    expect(Object.keys(local.bundles[0].settings)).not.toContain('somethingFromTheFuture')
  })

  it('备份里没有 packages（包是设备级资产）', async () => {    await seedTwoProfiles()
    const backup = await buildBackupV2()
    expect((backup as unknown as Record<string, unknown>).packages).toBeUndefined()
    expect(JSON.stringify(backup)).not.toContain('"manifest"')
  })
})

// ---------------------------------------------------------------------------
// 反漂移：导出层不许对 `PROFILE_SCOPED_KEYS` 写死清单
// ---------------------------------------------------------------------------
describe('PROFILE_SCOPED_KEYS 反漂移', () => {
  it('★ 登记的每个分片键都能双向带出（以后加键不用改导出代码）', async () => {
    await seedTwoProfiles()
    // 逐个登记键塞一份，值里带 marker 便于认领
    for (const base of PROFILE_SCOPED_KEYS) {
      await fake.settings.put({ key: `${base}:default`, value: { marker: base } })
    }

    const backup = await buildBackupV2()
    const backupKeys = backup.profiles[0].settings.map((s) => s.key)
    const local = await readLocalSnapshot()

    for (const base of PROFILE_SCOPED_KEYS) {
      // 备份要**带全**：漏一个键 = 用户恢复后那个键永久消失，且没有任何提示
      expect(backupKeys, `备份漏了 ${base}`).toContain(`${base}:default`)
      // 快照要给**全**：合并函数按基名取（旧）值，漏了等于这个键永远不参与合并
      expect(local.bundles[0].settings, `快照漏了 ${base}`).toHaveProperty(base)
    }
  })
})

describe('readLocalSnapshot — 逐档案读，不串数据', () => {  it('每个档案只拿到自己的行；不在档案列表里的孤儿行被忽略', async () => {
    await seedTwoProfiles()
    // 已删除档案留下的孤儿行（pid 不在列表里）
    await fake.progress.add({
      id: 99,
      profileId: 'p_gone',
      packageId: 'pkg-z',
      knowledgePointId: 'kp-z',
      status: '学习中',
      correctCount: 9,
      wrongCount: 0,
      correctStreak: 0,
      wrongStreak: 0,
      lastStudiedAt: T,
      studySeconds: 0,
    })

    const local = await readLocalSnapshot()
    expect(local.bundles).toHaveLength(2)
    expect(local.bundles.every((b) => b.profileId !== 'p_gone')).toBe(true)
    expect(local.bundles[0].progress.every((r) => r.profileId === 'default')).toBe(true)
    // Bundle.settings 是基名 → 值
    expect(local.bundles[0].settings.achievements).toEqual([
      { id: 'badge-a', unlockedAt: '2024-03-01T00:00:00.000Z' },
    ])
    expect(local.globalSettings['fls:theme']).toBe('forest')
    expect(local.activeProfileId).toBe('default')
  })
})

describe('导出 → 清空 → 导入（往返）', () => {
  it('清空三张表后导入，数据一条不少；再导一次不产生任何变化', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()

    // 模拟"换设备"：数据表清空，档案列表还在（default 一定存在）
    fake.progress.__reset()
    fake.mistakes.__reset()
    fake.examSessions.__reset()
    fake.settings.__reset()
    await fake.settings.put({
      key: 'profiles',
      value: { activeId: 'default', list: [{ id: 'default', name: '老大', createdAt: '2024-01-01T00:00:00.000Z' }] },
    })
    await initProfile()

    // 预览：只算不写
    const preview = await previewImport(backup, T)
    expect(preview.route.kind).toBe('v2')
    expect(preview.local).not.toBeNull()
    expect(preview.plan).not.toBeNull()
    expect(preview.plan!.stats.noop).toBe(false)
    expect(preview.outcome).toBe('ready') // UI 只读 outcome
    expect(preview.plan!.newProfiles.map((p) => p.id)).toEqual(['p_b'])
    expect(fake.progress.rows).toHaveLength(0) // ★ 预览真的没写

    const result = await importBackupFile(backup, T)
    expect(result.applied).toBe(true)

    expect(fake.progress.rows).toHaveLength(3)
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.examSessions.rows).toHaveLength(1)
    // 老二的数据落在 p_b 上，不是被塞进 default
    const second = fake.progress.rows.filter((r) => r.profileId === 'p_b')
    expect(second).toHaveLength(1)
    expect(second[0].knowledgePointId).toBe('kp-9')
    // 徽章也回来了
    const badges = (await fake.settings.get('achievements:default'))!.value as any[]
    expect(badges.map((b) => b.id)).toContain('badge-a')

    // ★ 幂等（AC-P2-13）：第二遍什么都不做
    const again = await importBackupFile(backup, T)
    expect(again.applied).toBe(false)
    expect(again.plan!.stats.noop).toBe(true)
    expect(again.outcome).toBe('noop')
    expect(fake.progress.rows).toHaveLength(3)
  })

  it('导入新档案后内存状态立刻刷新并 emit（顶栏马上能切到新档案，不用 reload）', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()

    // 模拟换设备：数据清空、档案列表只剩 default
    fake.progress.__reset()
    fake.mistakes.__reset()
    fake.examSessions.__reset()
    fake.settings.__reset()
    await fake.settings.put({
      key: 'profiles',
      value: {
        activeId: 'default',
        list: [{ id: 'default', name: '老大', createdAt: '2024-01-01T00:00:00.000Z' }],
      },
    })
    await initProfile()

    const emitted: string[][] = []
    const off = onProfileChange((next) => emitted.push(next.list.map((p) => p.id)))
    try {
      await importBackupFile(backup, T)
    } finally {
      off()
    }

    // 内存状态已含新档案（否则顶栏切换器看不到，家长会以为导入失败）
    expect(listProfilesSync().map((p) => p.id)).toContain('p_b')
    expect(emitted.some((ids) => ids.includes('p_b'))).toBe(true) // ★ 真的 emit 了
    // 但不切档案：导入不打断本机正在用的人
    expect(profilesState().activeId).toBe('default')
  })

  it('导入不会把导出时的 activeProfileId 强加给本机（不打断当前使用者）', async () => {
    await seedTwoProfiles()
    // 本机切到老二
    await switchProfile('p_b')
    const backup = await buildBackupV2()
    expect(backup.activeProfileId).toBe('p_b')

    fake.progress.__reset()
    const result = await importBackupFile(backup, T)
    expect(result.applied).toBe(true)
    const { profilesState } = await import('@core/profile/currentProfile')
    // 仍在老二（导入不切档案）
    expect(profilesState().activeId).toBe('p_b')
  })
})

// ---------------------------------------------------------------------------
// AC-P2-17：v1 备份里带旧 `achievements` 键（无后缀），合并后本机成就墙不能被抹掉
// ---------------------------------------------------------------------------
describe('AC-P2-17 — 导入 v1 备份不抹掉本机成就', () => {
  it('本机徽章 + v1 备份徽章取并集，一个都不少', async () => {
    await seedTwoProfiles() // 本机有 badge-a

    const v1 = {
      version: '1.0',
      exportedAt: '2024-12-01T00:00:00.000Z',
      progress: [],
      mistakes: [],
      settings: [
        {
          key: 'achievements',
          value: [{ id: 'badge-b', unlockedAt: '2024-06-01T00:00:00.000Z' }],
        },
      ],
    }

    const preview = await previewImport(v1, T)
    expect(preview.route.kind).toBe('v1')
    // 适配器把扁平数据包成 default 档案
    expect(preview.bundles).toHaveLength(1)
    expect(preview.bundles[0].profileId).toBe('default')

    const result = await importBackupFile(v1, T)
    expect(result.applied).toBe(true)

    const badges = (await fake.settings.get('achievements:default'))!.value as any[]
    const ids = badges.map((b) => b.id)
    expect(ids).toContain('badge-a') // ★ 本机的没被抹掉
    expect(ids).toContain('badge-b') // 备份的进来了
    // v1 的键没有后缀 → 绝不能写成裸 `achievements`（那会让两个档案共用一份徽章）
    expect(await fake.settings.get('achievements')).toBeFalsy()
  })

  it('v1 备份的进度行落进 default 档案', async () => {
    await seedTwoProfiles()
    fake.progress.__reset()

    const v1 = {
      version: '1.0',
      exportedAt: '2024-12-01T00:00:00.000Z',
      progress: [
        {
          packageId: 'pkg-a',
          knowledgePointId: 'kp-1',
          status: '学习中',
          correctCount: 2,
          wrongCount: 0,
          correctStreak: 2,
          wrongStreak: 0,
          lastStudiedAt: '2024-11-01T00:00:00.000Z',
          studySeconds: 60,
        },
      ],
      mistakes: [],
      settings: [],
    }

    const result = await importBackupFile(v1, T)
    expect(result.applied).toBe(true)
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].profileId).toBe('default')
  })
})

// ---------------------------------------------------------------------------
// outcome 判序：reject → noop → ready（UI 只读这一个字段）
// ---------------------------------------------------------------------------
describe('ImportPreview.outcome — 判序锁死 reject → noop → ready', () => {
  /** 一份"档案数会超上限"的 v2 备份：5 个本机没有的档案 + 本机 1 个 = 6 > 4 */
  function tooManyProfiles() {
    const pids = ['p_1', 'p_2', 'p_3', 'p_4', 'p_5']
    return {
      formatVersion: 2 as const,
      exportedAt: T,
      appVersion: '1.9.1',
      activeProfileId: 'p_1',
      profiles: pids.map((pid) => ({
        profileId: pid,
        name: pid,
        createdAt: T,
        progress: [],
        mistakes: [],
        examSessions: [],
        settings: [],
      })),
      globalSettings: [],
    }
  }

  it('★ 超档案上限 → outcome 是 reject，而 stats.noop **仍为 true**（自洽：拒绝=零写入）', async () => {
    await seedTwoProfiles() // 本机 2 个档案 + 备份里 5 个新的 = 7 > 4

    const preview = await previewImport(tooManyProfiles(), T)

    expect(preview.outcome).toBe('reject') // ★ 判序必须 reject 优先
    expect(preview.plan!.reject?.reason).toBe('profile-limit')
    // 这两个断言一起锁住"为什么不能先判 noop"：
    expect(preview.plan!.stats.noop).toBe(true)
    expect(preview.plan!.newProfiles).toHaveLength(0)
    expect(fake.progress.rows).toHaveLength(3) // 一行没写
  })

  it('整笔拒绝时执行入口不写库、不抛（applied: false）', async () => {
    await seedTwoProfiles()
    const result = await importBackupFile(tooManyProfiles(), T)
    expect(result.applied).toBe(false)
    expect(result.outcome).toBe('reject')
    expect(fake.progress.rows).toHaveLength(3)
  })

  it('格式被拒 → outcome 也是 reject（plan 为 null）', async () => {
    await seedTwoProfiles()
    const preview = await previewImport({ formatVersion: 9, profiles: [] }, T)
    expect(preview.outcome).toBe('reject')
    expect(preview.plan).toBeNull()
    if (preview.route.kind !== 'reject') throw new Error('unreachable')
    expect(preview.route.reason).toBe('too-new')
  })

  it('本机已有全部数据 → outcome 是 noop（不是 reject）', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()
    const preview = await previewImport(backup, T)
    expect(preview.outcome).toBe('noop')
    expect(preview.plan!.reject).toBeUndefined()
  })

  it('有可导入内容 → outcome 是 ready', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()
    fake.progress.__reset()
    const preview = await previewImport(backup, T)
    expect(preview.outcome).toBe('ready')
  })
})

describe('previewImport — 拒绝路径不写库', () => {  it('来自更新版本的备份 → plan 为 null，本机数据一行不动', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()
    const future = { ...backup, formatVersion: 3 }

    const preview = await previewImport(future, T)
    expect(preview.route.kind).toBe('reject')
    if (preview.route.kind !== 'reject') throw new Error('unreachable')
    expect(preview.route.reason).toBe('too-new')
    expect(preview.plan).toBeNull()
    expect(fake.progress.rows).toHaveLength(3)
  })

  it('行内 pid 与外层不一致 → mismatch，且 applied 为 false', async () => {
    await seedTwoProfiles()
    const backup = await buildBackupV2()
    backup.profiles[0].progress[0].profileId = 'p_b' // 手工改坏

    const result = await importBackupFile(backup, T)
    expect(result.applied).toBe(false)
    if (result.route.kind !== 'reject') throw new Error('unreachable')
    expect(result.route.reason).toBe('mismatch')
    expect(fake.progress.rows).toHaveLength(3)
  })
})
