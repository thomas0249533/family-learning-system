/**
 * 手动完成标记的备份往返（V3.0 · M4）
 *
 * 为什么要有这一层（而不是只测 `mergeCardCompletions` 这个纯函数）：
 * 纯函数只能证明"算得对"，证明不了**导出写的字段名与导入读的字段名一致**。
 * 这条链路跨了四个文件（`bundleIO` → `types.Bundle` → `bundlesFromV2` →
 * `planMerge` → `applyMergePlan`），任何一处写错名字，症状都是
 * "换机后我标过的卡片全变灰了"，而且**不报错**。
 *
 * 也要钉住一个反面：**老备份文件里没有这个字段**。加必填校验会让用户手里
 * 所有历史备份变成"文件已损坏"，那是比丢标记更糟的事故。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

import { createFakeDexie } from './helpers/fakeDexie'

const { buildBackupV2 } = await import('@core/backup/bundleIO')
const { importBackupFile, previewImport } = await import('@core/backup/importOrchestrator')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')

const T = '2025-03-01T00:00:00.000Z'

async function seed() {
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

  await fake.cardCompletions.add({
    profileId: 'default',
    kind: 'unit',
    packageId: 'pkg-a',
    targetId: 'u1',
    createdAt: T,
  })
  await fake.cardCompletions.add({
    profileId: 'default',
    kind: 'package',
    packageId: 'pkg-a',
    targetId: 'pkg-a',
    createdAt: T,
  })
  await fake.cardCompletions.add({
    profileId: 'p_b',
    kind: 'unit',
    packageId: 'pkg-b',
    targetId: 'u9',
    createdAt: T,
  })
}

/** 模拟"另一台新设备"：数据表全清，只留本机档案列表 */
async function wipeAsNewDevice() {
  fake.progress.__reset()
  fake.mistakes.__reset()
  fake.examSessions.__reset()
  fake.cardCompletions.__reset()
  fake.settings.__reset()
  await fake.settings.put({
    key: 'profiles',
    value: {
      activeId: 'default',
      list: [{ id: 'default', name: '老大', createdAt: '2024-01-01T00:00:00.000Z' }],
    },
  })
  await initProfile()
}

beforeEach(() => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  setActivePinia(createPinia())
})

describe('标记随备份搬运', () => {
  it('导出 → 清空 → 导入：三条标记一条不少，且落在各自档案下', async () => {
    await seed()
    const backup = await buildBackupV2()

    // 导出的文档里必须有这个字段（否则整条链路根本没走通）
    expect(backup.profiles.map((p) => (p.cardCompletions ?? []).length).sort()).toEqual([1, 2])

    await wipeAsNewDevice()
    expect(fake.cardCompletions.rows).toHaveLength(0)

    const result = await importBackupFile(backup, T)
    expect(result.applied).toBe(true)
    expect(result.detail.marks).toBe(3)

    expect(fake.cardCompletions.rows).toHaveLength(3)
    const byPid = (pid: string) =>
      fake.cardCompletions.rows
        .filter((r) => r.profileId === pid)
        .map((r) => `${r.kind}/${r.packageId}/${r.targetId}`)
        .sort()
    expect(byPid('default')).toEqual(['package/pkg-a/pkg-a', 'unit/pkg-a/u1'])
    expect(byPid('p_b')).toEqual(['unit/pkg-b/u9'])
  })

  it('再导一次 → noop，标记一条不重复（幂等）', async () => {
    await seed()
    const backup = await buildBackupV2()
    await wipeAsNewDevice()
    await importBackupFile(backup, T)

    const again = await importBackupFile(backup, T)
    expect(again.applied).toBe(false)
    expect(again.outcome).toBe('noop')
    expect(fake.cardCompletions.rows).toHaveLength(3)
  })

  it('★ 只带标记、没有进度错题的备份也算"真的导入了"（applied 必须为 true）', async () => {
    await seed()
    const backup = await buildBackupV2()
    await wipeAsNewDevice()

    const result = await importBackupFile(backup, T)
    // 这份数据里 progress / mistakes / sessions 全是空的，只有 3 条标记。
    // 若 `written` 漏算 marks，UI 会弹"未导入任何数据"——而卡片其实已经绿了。
    expect(result.applied).toBe(true)
    expect(result.detail.marks).toBe(3)
  })

  it('本机已有的同一张卡片保留本机那行（不覆盖 createdAt）', async () => {
    await seed()
    const backup = await buildBackupV2()
    await wipeAsNewDevice()
    // 新设备上先手动标了同一个单元，时间戳与备份里不同
    const keptAt = '2026-06-06T00:00:00.000Z'
    await fake.cardCompletions.add({
      profileId: 'default',
      kind: 'unit',
      packageId: 'pkg-a',
      targetId: 'u1',
      createdAt: keptAt,
    })

    const result = await importBackupFile(backup, T)
    expect(result.detail.marks).toBe(2) // 只写另外两条
    const row = fake.cardCompletions.rows.find(
      (r) => r.profileId === 'default' && r.targetId === 'u1',
    )!
    expect(row.createdAt).toBe(keptAt)
  })
})

describe('老备份 / 坏数据', () => {
  it('★ 老备份没有 cardCompletions 字段 → 照常导入，不拒收', async () => {
    await seed()
    const backup = await buildBackupV2()
    // 模拟 V3.0 之前导出的文件：逐档案删掉这个键
    const old = JSON.parse(JSON.stringify(backup)) as typeof backup
    for (const p of old.profiles) delete p.cardCompletions

    await wipeAsNewDevice()
    const preview = await previewImport(old, T)
    expect(preview.outcome).not.toBe('reject')
    expect(preview.bundles.every((b) => b.cardCompletions.length === 0)).toBe(true)

    const result = await importBackupFile(old, T)
    expect(result.detail.marks).toBe(0)
    expect(fake.cardCompletions.rows).toHaveLength(0)
  })

  it('cardCompletions 不是数组 → reject（不能静默当"没有标记"）', async () => {
    await seed()
    const backup = JSON.parse(JSON.stringify(await buildBackupV2())) as any
    backup.profiles[0].cardCompletions = 'oops'

    const preview = await previewImport(backup, T)
    expect(preview.outcome).toBe('reject')
    expect(preview.route.kind === 'reject' && preview.route.detail).toContain('不是数组')
  })

  it('行内缺 targetId → reject', async () => {
    await seed()
    const backup = JSON.parse(JSON.stringify(await buildBackupV2())) as any
    backup.profiles[0].cardCompletions = [{ profileId: 'default', kind: 'unit', packageId: 'pkg-a' }]

    const preview = await previewImport(backup, T)
    expect(preview.outcome).toBe('reject')
    expect(preview.route.kind === 'reject' && preview.route.detail).toContain('targetId')
  })

  it('kind 不是 unit / package → reject（否则 UI 会拿到一张渲染不出来的卡片）', async () => {
    await seed()
    const backup = JSON.parse(JSON.stringify(await buildBackupV2())) as any
    backup.profiles[0].cardCompletions = [
      { profileId: 'default', kind: 'chapter', packageId: 'pkg-a', targetId: 'u1', createdAt: T },
    ]

    const preview = await previewImport(backup, T)
    expect(preview.outcome).toBe('reject')
    expect(preview.route.kind === 'reject' && preview.route.detail).toContain('kind')
  })

  it('行内 pid 与外层不一致 → mismatch（手工改过的文件）', async () => {
    await seed()
    const backup = JSON.parse(JSON.stringify(await buildBackupV2())) as any
    backup.profiles[0].cardCompletions = [
      { profileId: 'p_b', kind: 'unit', packageId: 'pkg-a', targetId: 'u1', createdAt: T },
    ]

    const preview = await previewImport(backup, T)
    expect(preview.outcome).toBe('reject')
    expect(preview.route.kind === 'reject' && preview.route.reason).toBe('mismatch')
  })
})
