/**
 * 每日自动快照（V3.0 · M4）
 *
 * 这块的失败模式与别处不同：**它静默**。快照是后台保险，失败不弹窗、不阻断启动，
 * 所以"没拍上"这件事家长永远不知道 —— 直到真出事需要它的时候。
 * 因此这里把边界一条条钉住：同一天不重复、超过 7 份要裁掉最旧的、
 * 数据被写坏要能自愈、恢复只补不覆盖。
 *
 * 恢复语义特别值得注意：它是**合并**（走 `previewImport` / `executeImport`），
 * 不是"回到过去"。所以"本机更新记录不会被旧快照覆盖"是一条必须有的断言 ——
 * 否则家长在事故后点恢复，反而把最近几天的进度退回去了。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const {
  SNAPSHOTS_KEY,
  KEEP_SNAPSHOTS,
  listSnapshots,
  maybeAutoSnapshot,
  restoreSnapshot,
  clearSnapshots,
} = await import('@core/backup/autoSnapshot')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')

const T = '2025-03-01T00:00:00.000Z'

/** 造一天（本地时区，与 `localDayKey` 同口径） */
function day(d: number): Date {
  return new Date(2026, 0, d, 10, 0, 0)
}

async function seedProfile(progressCount = 1) {
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

/** 直接写一批快照条目（避免为了测裁剪而真拍 8 次快照） */
async function seedSnapshots(days: number[]) {
  const items = days.map((d) => ({
    date: `2026-01-${String(d).padStart(2, '0')}`,
    createdAt: new Date(2026, 0, d, 9, 0, 0).toISOString(),
    appVersion: '2.12.7',
    backup: { formatVersion: 2, exportedAt: T, appVersion: 'x', activeProfileId: 'default', profiles: [], globalSettings: [] },
  }))
  await fake.settings.put({ key: SNAPSHOTS_KEY, value: { version: 1, items } })
}

beforeEach(() => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  setActivePinia(createPinia())
})

describe('maybeAutoSnapshot — 每天一份，不多不少', () => {
  it('今天还没拍过 → 拍一份，count 为 1', async () => {
    await seedProfile()
    const r = await maybeAutoSnapshot(day(5))
    expect(r.created).toBe(true)
    expect(r.count).toBe(1)
    expect((await listSnapshots())[0].date).toBe('2026-01-05')
  })

  it('★ 同一天再调一次 → 不重复拍（启动多次只留一份）', async () => {
    await seedProfile()
    await maybeAutoSnapshot(day(5))
    const again = await maybeAutoSnapshot(day(5))
    expect(again.created).toBe(false)
    expect(again.count).toBe(1)
  })

  it('第二天 → 新增一份，且新→旧排序', async () => {
    await seedProfile()
    await maybeAutoSnapshot(day(5))
    await maybeAutoSnapshot(day(6))
    const items = await listSnapshots()
    expect(items.map((i) => i.date)).toEqual(['2026-01-06', '2026-01-05'])
  })

  it('★ 超过保留份数 → 裁掉最旧的，只留 KEEP_SNAPSHOTS 份', async () => {
    await seedProfile()
    // 已有 7 份（1..7 号），再拍 8 号 → 应当是 8 份被裁到 7 份，且最旧的 1 号没了
    await seedSnapshots([1, 2, 3, 4, 5, 6, 7])
    const r = await maybeAutoSnapshot(day(8))
    expect(r.created).toBe(true)
    const items = await listSnapshots()
    expect(items).toHaveLength(KEEP_SNAPSHOTS)
    expect(items.some((i) => i.date === '2026-01-01')).toBe(false)
    expect(items[0].date).toBe('2026-01-08')
  })

  it('快照内容是完整的 v2 备份（含进度行）', async () => {
    await seedProfile(2)
    await maybeAutoSnapshot(day(5))
    const [entry] = await listSnapshots()
    expect(entry.backup.formatVersion).toBe(2)
    expect(entry.backup.profiles[0].progress).toHaveLength(2)
  })

  it('★ 存储被写坏（不是 SnapshotFile 形状）→ 自愈：当成空表重新拍', async () => {
    await seedProfile()
    await fake.settings.put({ key: SNAPSHOTS_KEY, value: 'garbage' })
    expect(await listSnapshots()).toEqual([])
    const r = await maybeAutoSnapshot(day(5))
    expect(r.created).toBe(true)
    expect(r.count).toBe(1)
  })

  it('items 里的畸形条目被过滤，好条目保留', async () => {
    await fake.settings.put({
      key: SNAPSHOTS_KEY,
      value: {
        version: 1,
        items: [
          { date: '2026-01-05', createdAt: T, backup: { formatVersion: 2 } },
          { date: 123, createdAt: T, backup: {} },
          { createdAt: T, backup: {} },
          null,
        ],
      },
    })
    const items = await listSnapshots()
    expect(items).toHaveLength(1)
    expect(items[0].date).toBe('2026-01-05')
  })

  it('★ 读库失败 → 返回 error 且**不抛**（不能打断启动）', async () => {
    await seedProfile()
    fake.failOn.add('get:settings')
    const r = await maybeAutoSnapshot(day(5))
    expect(r.created).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('listSnapshots 读库失败 → 空表（不该让设置页白屏）', async () => {
    fake.failOn.add('get:settings')
    expect(await listSnapshots()).toEqual([])
  })

  it('clearSnapshots → 清空后列表为空', async () => {
    await seedProfile()
    await maybeAutoSnapshot(day(5))
    await clearSnapshots()
    expect(await listSnapshots()).toEqual([])
  })
})

describe('restoreSnapshot — 合并语义，只补不覆盖', () => {
  it('找不到那一天 → ok:false 且给出原因', async () => {
    const r = await restoreSnapshot('2026-01-09')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有这一天的快照')
  })

  it('★ 误删的进度能被补回来', async () => {
    await seedProfile(2)
    await maybeAutoSnapshot(day(5))
    const date = (await listSnapshots())[0].date

    // 模拟误删：进度表清空
    fake.progress.__reset()
    expect(fake.progress.rows).toHaveLength(0)

    const r = await restoreSnapshot(date)
    expect(r.ok).toBe(true)
    expect(r.progressAdded).toBe(2)
    expect(fake.progress.rows).toHaveLength(2)
  })

  it('★ 本机更新过的行不会被旧快照覆盖（合并 = 较新者胜，不是回滚）', async () => {
    await seedProfile(1)
    await maybeAutoSnapshot(day(5))
    const date = (await listSnapshots())[0].date

    // 快照之后孩子又学了：正确次数 1 → 9
    const row = fake.progress.rows[0]
    await fake.progress.update(row.id, { correctCount: 9, lastStudiedAt: '2026-02-01T00:00:00.000Z' })

    const r = await restoreSnapshot(date)
    // 快照里那条更旧 → 保持本机，一条都不写
    expect(r.ok).toBe(true)
    expect(r.progressAdded).toBe(0)
    expect(fake.progress.rows[0].correctCount).toBe(9)
  })

  it('本机什么都没有、快照也空 → 视为成功（noop 不是失败）', async () => {
    await seedProfile(0)
    await maybeAutoSnapshot(day(5))
    const date = (await listSnapshots())[0].date
    const r = await restoreSnapshot(date)
    expect(r.ok).toBe(true)
    expect(r.progressAdded).toBe(0)
  })

  it('快照格式被拒（手工改坏）→ ok:false 且带 detail，不写库', async () => {
    await seedProfile(1)
    await fake.settings.put({
      key: SNAPSHOTS_KEY,
      value: {
        version: 1,
        items: [{ date: '2026-01-05', createdAt: T, appVersion: 'x', backup: { formatVersion: 99 } }],
      },
    })
    const r = await restoreSnapshot('2026-01-05')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(fake.progress.rows).toHaveLength(1)
  })
})
