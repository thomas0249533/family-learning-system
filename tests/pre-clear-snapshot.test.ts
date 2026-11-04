/**
 * 清空前保护快照（V3.1.3）—— 2026-11-04 数据丢失事故的根因回归
 * =====================================================================
 * ## 事故
 * 家长在 3.1.1 点了「清空所有数据（含包）」，该操作执行 `db.settings.clear()`，
 * 而每日自动快照就存在 settings 表里 → 救命的快照被清空一起删了。
 * 之后每天启动又拍"空数据"新快照，7 天窗口滚完，进度彻底无恢复入口。
 *
 * ## 这组测试钉死的五条不变量
 * 1. 任何清空动作执行**之前**必拍一份 preClear 快照，且带原因；
 * 2. 拍失败 → **清空一次都不许执行**（宁可清空失败，不能让数据裸奔）；
 * 3. 清空所有数据后，快照仍在，且能真的把进度合并回来（端到端闭环）；
 * 4. preClear 与 daily 分开计数，连续拍 8 份 daily 也挤不掉 preClear；
 * 5. 「清空每日快照」不碰 preClear —— 最后的回滚点不能被顺手抹掉。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const {
  SNAPSHOTS_KEY,
  KEEP_SNAPSHOTS,
  KEEP_PRE_CLEAR,
  listSnapshots,
  maybeAutoSnapshot,
  capturePreClearSnapshot,
  withPreClearSnapshot,
  clearAllUserDataExceptSnapshots,
  restoreSnapshotById,
  clearSnapshots,
} = await import('@core/backup/autoSnapshot')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')

const T = '2025-03-01T00:00:00.000Z'
const day = (d: number): Date => new Date(2026, 0, d, 10, 0, 0)

async function seedProfile(progressCount = 2) {
  await fake.settings.put({
    key: 'profiles',
    value: {
      activeId: 'default',
      list: [{ id: 'default', name: '老大', createdAt: '2024-01-01T00:00:00.000Z' }],
    },
  })
  await initProfile()
  for (let i = 0; i < progressCount; i++) {
    await fake.progress.add({
      profileId: 'default',
      packageId: 'pkg-a',
      knowledgePointId: `kp-${i}`,
      status: '学习中',
      correctCount: 1,
      wrongCount: 0,
      correctStreak: 0,
      wrongStreak: 0,
      lastStudiedAt: T,
      studySeconds: 60,
    })
  }
}

beforeEach(() => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  setActivePinia(createPinia())
})

describe('capturePreClearSnapshot · 清空前必拍', () => {
  it('生成一份 preClear 快照，带原因与完整进度', async () => {
    await seedProfile(2)
    const r = await capturePreClearSnapshot('清空学习进度', day(5))
    expect(r.ok).toBe(true)

    const items = await listSnapshots()
    const pre = items.filter((it) => it.kind === 'preClear')
    expect(pre).toHaveLength(1)
    expect(pre[0].reason).toBe('清空学习进度')
    expect(pre[0].backup.profiles[0].progress).toHaveLength(2)
  })

  it('★ 同一天连拍两份（两次清空）→ 两份都在、id 不同，不受"今天已拍过"限制', async () => {
    await seedProfile(1)
    const a = await capturePreClearSnapshot('第一次清空', day(5))
    const b = await capturePreClearSnapshot('第二次清空', day(5))
    expect(a.ok && b.ok).toBe(true)
    expect(a.id).not.toBe(b.id)

    const pre = (await listSnapshots()).filter((it) => it.kind === 'preClear')
    expect(pre).toHaveLength(2)
    expect(new Set(pre.map((it) => it.id)).size).toBe(2)
  })

  it('读库失败 → ok:false（调用方必须据此中止清空）', async () => {
    await seedProfile(1)
    fake.failOn.add('put:settings')
    const r = await capturePreClearSnapshot('清空学习进度', day(5))
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('withPreClearSnapshot · 拍不上就中止清空', () => {
  it('★ 快照写失败 → action 一次都不执行，进度原封不动', async () => {
    await seedProfile(2)
    fake.failOn.add('put:settings')

    let called = 0
    const r = await withPreClearSnapshot('清空学习进度', async () => {
      called += 1
      await fake.progress.clear()
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已取消操作')
    expect(called).toBe(0)
    expect(fake.progress.rows).toHaveLength(2)
  })

  it('快照成功 → action 正常执行', async () => {
    await seedProfile(2)
    const r = await withPreClearSnapshot('清空学习进度', async () => {
      await fake.progress.clear()
    })
    expect(r.ok).toBe(true)
    expect(r.snapshotId).toBeTruthy()
    expect(fake.progress.rows).toHaveLength(0)
  })
})

describe('clearAllUserDataExceptSnapshots · 事故闭环', () => {
  it('★ 清空全部业务数据后，快照仍在且能真的把进度恢复回来', async () => {
    await seedProfile(2)
    const cap = await capturePreClearSnapshot('清空所有数据（含包）', day(5))
    expect(cap.ok).toBe(true)

    await clearAllUserDataExceptSnapshots()
    expect(fake.progress.rows).toHaveLength(0)
    expect(fake.packages.rows).toHaveLength(0)

    // 快照必须还在 settings 里（3.1.2 这里会被 settings.clear() 一起删掉）
    const rec = await fake.settings.get(SNAPSHOTS_KEY)
    expect(rec?.value?.items?.length ?? 0).toBeGreaterThan(0)

    const restored = await restoreSnapshotById(cap.id!)
    expect(restored.ok).toBe(true)
    expect(fake.progress.rows).toHaveLength(2)
  })

  it('保护快照保留上限 KEEP_PRE_CLEAR 份，不会无限膨胀', async () => {
    await seedProfile(1)
    for (let i = 0; i < KEEP_PRE_CLEAR + 3; i++) {
      await capturePreClearSnapshot(`第 ${i} 次清空`, day(5))
    }
    const pre = (await listSnapshots()).filter((it) => it.kind === 'preClear')
    expect(pre).toHaveLength(KEEP_PRE_CLEAR)
  })
})

describe('daily 与 preClear 分开计数 / 清空每日快照不误删', () => {
  it('★ 连续拍满并超过 7 份 daily，也挤不掉 preClear', async () => {
    await seedProfile(1)
    await capturePreClearSnapshot('清空所有数据（含包）', day(1))
    for (let d = 2; d <= KEEP_SNAPSHOTS + 4; d++) {
      await maybeAutoSnapshot(day(d))
    }
    const items = await listSnapshots()
    const daily = items.filter((it) => it.kind === 'daily')
    const pre = items.filter((it) => it.kind === 'preClear')
    expect(daily).toHaveLength(KEEP_SNAPSHOTS)
    expect(pre).toHaveLength(1)
    expect(pre[0].reason).toBe('清空所有数据（含包）')
  })

  it('★ clearSnapshots 只清 daily，preClear 一条不少', async () => {
    await seedProfile(1)
    await capturePreClearSnapshot('清空学习进度', day(1))
    await maybeAutoSnapshot(day(2))
    expect(await listSnapshots()).toHaveLength(2)

    await clearSnapshots()
    const items = await listSnapshots()
    expect(items.filter((it) => it.kind === 'daily')).toHaveLength(0)
    expect(items.filter((it) => it.kind === 'preClear')).toHaveLength(1)
  })

  it('3.1.2 及更早的旧条目（无 id / kind）被兼容为 daily', async () => {
    await fake.settings.put({
      key: SNAPSHOTS_KEY,
      value: {
        version: 1,
        items: [
          {
            date: '2026-01-05',
            createdAt: T,
            appVersion: '3.1.2',
            backup: { formatVersion: 2, exportedAt: T, appVersion: 'x', activeProfileId: 'default', profiles: [], globalSettings: [] },
          },
        ],
      },
    })
    const items = await listSnapshots()
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('daily')
    expect(items[0].id).toBeTruthy()
  })
})
