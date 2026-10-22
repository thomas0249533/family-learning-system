import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * E1 · 「备份引用了本机没装的学习包」（V1.6）
 * ------------------------------------------------------------------
 * 家长报的是「专项练习进度丢了」。真相是**数据一行没丢**：导出全量带走了，
 * 合并单调不减也没丢 —— 缺的是**包**（v2 备份按设计不含 `packages`，
 * 见 `types.ts` 的 `BackupV2` 注释），所以那些行在库里但没有可挂的入口。
 *
 * 所以本轮修复只做"把真相算出来告诉家长"，**一个字节的数据都不动**。
 * 这个文件守的就是这条边界：
 *   1. `collectMissingPackageIds` 是纯函数（零 Dexie），能穷举；
 *   2. 接线层（`previewImport`）**只填字段、不改判序** —— 缺包是警告不是拒绝。
 */
import { collectMissingPackageIds, countRowsForPackages } from '@core/backup/missingPackages'

const LOCAL: ReadonlySet<string> = new Set(['unit-a', 'unit-b', 'special-installed'])

describe('collectMissingPackageIds — 纯函数', () => {
  it('空入参 / 空本机 → []', () => {
    expect(collectMissingPackageIds([], LOCAL)).toEqual([])
    expect(collectMissingPackageIds([], new Set())).toEqual([])
    expect(collectMissingPackageIds(null, new Set())).toEqual([])
    expect(collectMissingPackageIds(undefined, new Set())).toEqual([])
  })

  it('全部命中（本机都装了）→ []', () => {
    const rows = [
      { packageId: 'unit-a' },
      { packageId: 'unit-b' },
      { packageId: 'special-installed' },
      { packageId: 'unit-a' }, // 重复也要能过
    ]
    expect(collectMissingPackageIds(rows, LOCAL)).toEqual([])
  })

  it('混合命中 → 只剩缺失的、升序、去重', () => {
    const rows = [
      { packageId: 'special-orphan' },
      { packageId: 'unit-a' }, // 命中
      { packageId: 'special-orphan' }, // 重复 → 只出现一次
      { packageId: 'aaa-missing' }, // 字典序最前
      { packageId: 'zzz-missing' },
    ]
    expect(collectMissingPackageIds(rows, LOCAL)).toEqual([
      'aaa-missing',
      'special-orphan',
      'zzz-missing',
    ])
  })

  it('progress 与 mistakes 同包 → 只出现一次（跨表去重）', () => {
    // 行形态故意做成两张表的样子（字段数不同），函数只认 packageId
    const rows = [
      { packageId: 'special-orphan', knowledgePointId: 'kp-1', status: '学习中' },
      { packageId: 'special-orphan', exerciseId: 'ex-1', knowledgePointIds: ['kp-1'] },
    ]
    expect(collectMissingPackageIds(rows, LOCAL)).toEqual(['special-orphan'])
  })

  it('packageId 为空串 / 缺失 / 非字符串 → 跳过，不炸', () => {
    const rows = [
      { packageId: '' },
      { packageId: undefined },
      { packageId: null },
      {},
      { packageId: 'special-orphan' },
    ]
    expect(collectMissingPackageIds(rows, LOCAL)).toEqual(['special-orphan'])
  })

  it('行本身是 null / undefined → 跳过，不炸', () => {
    const rows = [null, undefined, { packageId: 'zzz-missing' }] as unknown as Array<{
      packageId: string
    }>
    expect(collectMissingPackageIds(rows, LOCAL)).toEqual(['zzz-missing'])
  })

  it('本机 id 用 Set 传入（而非数组）行为一致，且不修改入参', () => {
    const local = new Set(['unit-a'])
    const rows = [{ packageId: 'unit-a' }, { packageId: 'special-x' }]
    expect(collectMissingPackageIds(rows, local)).toEqual(['special-x'])
    // 只读：本机集合与入参数组都不该被动过
    expect([...local]).toEqual(['unit-a'])
    expect(rows).toHaveLength(2)
  })

  it('升序是**字典序**而不是插入序（输出稳定，UI 与断言才不飘）', () => {
    const rows = [{ packageId: 'b' }, { packageId: 'a' }, { packageId: 'C' }, { packageId: '10' }]
    // 大写字母与数字都按 UTF-16 码位排，不用 localeCompare（后者随语言环境变）
    expect(collectMissingPackageIds(rows, new Set())).toEqual(['10', 'C', 'a', 'b'])
  })
})

describe('countRowsForPackages — 文案里的"几条记录"', () => {
  it('统计属于缺失包的行数，缺失包为空时为 0', () => {
    const rows = [
      { packageId: 'special-orphan' },
      { packageId: 'unit-a' },
      { packageId: 'special-orphan' },
    ]
    expect(countRowsForPackages(rows, ['special-orphan'])).toBe(2)
    expect(countRowsForPackages(rows, [])).toBe(0)
  })

  it('空行 / 空 packageId 的行不计入', () => {
    const rows = [{ packageId: '' }, {}, { packageId: 'special-orphan' }]
    expect(countRowsForPackages(rows, ['special-orphan'])).toBe(1)
    expect(countRowsForPackages([], ['special-orphan'])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 接线：`previewImport` 把结果挂到 `ImportPreview` 上，**不动判序**
// ---------------------------------------------------------------------------
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const { previewImport } = await import('@core/backup/importOrchestrator')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')

const T = '2025-03-01T00:00:00.000Z'

/** 本机：只装了 `unit-installed`（专项包 `special-orphan` 没装） */
async function seedLocal(): Promise<void> {
  await fake.settings.put({
    key: 'profiles',
    value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: T }] },
  })
  await initProfile()
  await fake.packages.put({
    packageId: 'unit-installed',
    manifest: { packageId: 'unit-installed', type: 'unit', subject: 'math', grade: 4 },
    knowledgePoints: [{ id: 'unit-installed::kp-unit-1', title: '知识点' }],
    exercises: [],
    units: [],
  })
}

/**
 * 备份：单元包一行 + 专项包两行（progress + mistakes）。
 * 专项包**没有**被装进本机 —— 这正是"进度看起来丢了"的场景。
 */
function backupWithOrphan(): unknown {
  return {
    formatVersion: 2,
    exportedAt: T,
    appVersion: '1.9.4',
    activeProfileId: 'default',
    profiles: [
      {
        profileId: 'default',
        name: '我',
        createdAt: T,
        progress: [
          {
            profileId: 'default',
            packageId: 'unit-installed',
            knowledgePointId: 'unit-installed::kp-unit-1',
            status: '已掌握',
            correctCount: 4,
            wrongCount: 0,
            correctStreak: 4,
            wrongStreak: 0,
            lastStudiedAt: T,
            studySeconds: 60,
          },
          {
            profileId: 'default',
            packageId: 'special-orphan',
            knowledgePointId: 'special-orphan::kp-special-1',
            status: '学习中',
            correctCount: 1,
            wrongCount: 1,
            correctStreak: 0,
            wrongStreak: 1,
            lastStudiedAt: T,
            studySeconds: 30,
          },
        ],
        mistakes: [
          {
            profileId: 'default',
            packageId: 'special-orphan',
            exerciseId: 'special-orphan::ex-1',
            knowledgePointIds: ['special-orphan::kp-special-1'],
            wrongAt: T,
            wrongCount: 1,
            mastered: false,
            masteryLevel: 'none',
          },
        ],
        examSessions: [],
        settings: [],
      },
    ],
    globalSettings: [],
  }
}

beforeEach(() => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  setActivePinia(createPinia())
})

describe('previewImport · missingPackages 接线', () => {
  it('缺失的专项包进 missingPackages，已装的包不进', async () => {
    await seedLocal()
    const preview = await previewImport(backupWithOrphan(), T)

    expect(preview.outcome).toBe('ready')
    expect(preview.missingPackages).toEqual(['special-orphan'])
    // 专项包：1 条进度 + 1 条错题
    expect(preview.missingPackageRows).toBe(2)
    // ★ 数据照常进计划（合并引擎单调不减，绝不因为包不存在而丢行）
    expect(preview.plan?.progressUpserts.map((r) => r.packageId).sort()).toEqual([
      'special-orphan',
      'unit-installed',
    ])
    expect(preview.plan?.mistakeUpserts).toHaveLength(1)
  })

  it('读本机包列表失败 → missingPackages 为 []，但**不把 outcome 变成 reject**', async () => {
    await seedLocal()
    fake.failOn.add('toArray:packages')

    const preview = await previewImport(backupWithOrphan(), T)

    // ★ 缺包是"警告"，不是"这份备份不能导" —— 判序不许被它影响
    expect(preview.outcome).toBe('ready')
    expect(preview.missingPackages).toEqual([])
    expect(preview.missingPackageRows).toBe(0)
    // 计划本身不受影响（数据照样要导入）
    expect(preview.plan?.progressUpserts).toHaveLength(2)
  })

  it('备份里每个包本机都装了 → missingPackages 为 []', async () => {
    await seedLocal()
    await fake.packages.put({
      packageId: 'special-orphan',
      manifest: { packageId: 'special-orphan', type: 'special', subject: 'math', grade: 4 },
      knowledgePoints: [{ id: 'special-orphan::kp-special-1', title: '知识点' }],
      exercises: [],
      units: [],
    })

    const preview = await previewImport(backupWithOrphan(), T)
    expect(preview.missingPackages).toEqual([])
    expect(preview.missingPackageRows).toBe(0)
  })

  it('版本路由就拒绝的备份 → missingPackages 为 []（没有可合并的东西）', async () => {
    await seedLocal()
    const preview = await previewImport({ formatVersion: 2, exportedAt: T }, T)

    expect(preview.outcome).toBe('reject')
    expect(preview.missingPackages).toEqual([])
    expect(preview.missingPackageRows).toBe(0)
  })
})
