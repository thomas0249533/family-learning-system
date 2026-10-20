import { describe, expect, it, vi } from 'vitest'

/**
 * 成就概览派生（V1.3 · P1 收尾）的纯函数测试。
 *
 * 覆盖两件事：
 *   1. 家长端「四类来源分布」：**四个桶必须恒定存在且顺序固定**（某类 0 枚也要显示，
 *      否则家长会以为漏了一类）；
 *   2. 「解锁证据」：只取已解锁且证据非空的（旧记录没有快照就**不显示**，
 *      PRD §4.1 明确不许事后补算）；日期倒序、空日期垫底、同日期稳定、不改进参。
 *
 * `@/db` 只是被同文件的"看过总结卡"状态读写用到，这里用桩替掉，
 * 保证纯函数测试不依赖 Dexie。
 */
// 内存版 settings 表：够验"只弹一次"的读写往返，又不牵进 Dexie
const store = vi.hoisted(() => {
  const rows = new Map<string, unknown>()
  const state = { failGet: false, failPut: false }
  return {
    rows,
    state,
    db: {
      settings: {
        async get(key: string) {
          if (state.failGet) throw new Error('fake db: settings.get 失败')
          return rows.has(key) ? { key, value: rows.get(key) } : undefined
        },
        async put(rec: { key: string; value: unknown }) {
          if (state.failPut) throw new Error('fake db: settings.put 失败')
          rows.set(rec.key, rec.value)
        },
      },
    },
  }
})
vi.mock('@/db', () => ({ db: store.db }))

const {
  SOURCE_LABEL,
  SOURCE_ORDER,
  distributionBySource,
  evidenceLines,
  COLLECTION_SEEN_KEY,
  hasSeenCollection,
  markCollectionSeen,
} = await import('@core/motivation/achievementOverview')

import type { OverviewItem } from '@core/motivation/achievementOverview'

const item = (over: Partial<OverviewItem> & { id: string }): OverviewItem => ({
  source: 'core',
  earned: false,
  ...over,
})

describe('distributionBySource — 四类来源分布', () => {
  it('四个桶恒定存在、顺序固定，某类为 0 也显示', () => {
    const buckets = distributionBySource([item({ id: 'a', source: 'core', earned: true })])
    expect(buckets.map((b) => b.source)).toEqual(SOURCE_ORDER)
    expect(buckets).toHaveLength(4)
    expect(buckets.map((b) => b.label)).toEqual(SOURCE_ORDER.map((s) => SOURCE_LABEL[s]))
    // 其余三类各 0 枚，依然在列表里
    expect(buckets.slice(1).every((b) => b.total === 0 && b.earned === 0)).toBe(true)
  })

  it('按 source 归类，earned 只数已解锁的', () => {
    const buckets = distributionBySource([
      item({ id: 'a', source: 'core', earned: true }),
      item({ id: 'b', source: 'core', earned: false }),
      item({ id: 'c', source: 'subject', earned: true }),
      item({ id: 'd', source: 'habit', earned: false }),
      item({ id: 'e', source: 'hidden', earned: false }),
    ])
    const by = Object.fromEntries(buckets.map((b) => [b.source, b]))
    expect(by.core).toMatchObject({ total: 2, earned: 1 })
    expect(by.subject).toMatchObject({ total: 1, earned: 1 })
    expect(by.habit).toMatchObject({ total: 1, earned: 0 })
    expect(by.hidden).toMatchObject({ total: 1, earned: 0 })
  })

  it('空输入 → 四个 0 桶（不是空数组）', () => {
    const buckets = distributionBySource([])
    expect(buckets).toHaveLength(4)
    expect(buckets.every((b) => b.total === 0)).toBe(true)
  })

  it('不修改入参', () => {
    const input = Object.freeze([
      Object.freeze(item({ id: 'a', source: 'habit', earned: true })),
    ]) as unknown as OverviewItem[]
    expect(() => distributionBySource(input)).not.toThrow()
    expect(input[0]).toMatchObject({ id: 'a', source: 'habit', earned: true })
  })
})

describe('evidenceLines — 解锁证据列表', () => {
  it('只取「已解锁 + 证据非空」，未解锁/无证据/空串一律不显示', () => {
    const rows = evidenceLines([
      item({ id: 'a', earned: true, evidence: '连续 7 天没断', unlockedAt: '2026-10-01' }),
      item({ id: 'b', earned: false, evidence: '不该出现-未解锁', unlockedAt: '2026-10-02' }),
      item({ id: 'c', earned: true, evidence: '', unlockedAt: '2026-10-03' }),
      item({ id: 'd', earned: true, unlockedAt: '2026-10-04' }),
      item({ id: 'e', earned: true, evidence: '   ', unlockedAt: '2026-10-05' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('按解锁日期倒序；空日期排最后（空 = 未知，不是最早）', () => {
    const rows = evidenceLines([
      item({ id: 'old', earned: true, evidence: 'e1', unlockedAt: '2026-09-01' }),
      item({ id: 'unknown', earned: true, evidence: 'e2', unlockedAt: '' }),
      item({ id: 'new', earned: true, evidence: 'e3', unlockedAt: '2026-10-09' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['new', 'old', 'unknown'])
  })

  it('同日期保持入参顺序（刷新不抖动）', () => {
    const rows = evidenceLines([
      item({ id: 'x', earned: true, evidence: 'e', unlockedAt: '2026-10-01' }),
      item({ id: 'y', earned: true, evidence: 'e', unlockedAt: '2026-10-01' }),
      item({ id: 'z', earned: true, evidence: 'e', unlockedAt: '2026-10-01' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['x', 'y', 'z'])
  })

  it('limit 生效，默认 3 条', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      item({ id: `i${i}`, earned: true, evidence: `e${i}`, unlockedAt: `2026-10-0${i + 1}` }),
    )
    expect(evidenceLines(many)).toHaveLength(3)
    expect(evidenceLines(many, 0)).toHaveLength(0)
    // 取的是最新的三条（10-06 / 10-05 / 10-04）
    expect(evidenceLines(many).map((r) => r.id)).toEqual(['i5', 'i4', 'i3'])
  })

  it('缺 title/icon 时回落到 id 与默认图标（不渲染 undefined）', () => {
    const [row] = evidenceLines([item({ id: 'no-meta', earned: true, evidence: 'e' })])
    expect(row.title).toBe('no-meta')
    expect(row.icon).toBe('🏅')
  })

  it('不修改入参', () => {
    const input = Object.freeze([
      Object.freeze({ id: 'a', source: 'core', earned: true, evidence: 'e', unlockedAt: '2026-10-01' }),
    ]) as unknown as OverviewItem[]
    expect(() => evidenceLines(input)).not.toThrow()
    expect(input).toHaveLength(1)
  })
})

describe('静态接线（页面真的用了这套口径）', () => {
  it('家长端用 distributionBySource / evidenceLines，而不是自己再写一遍', async () => {
    const { readFileSync } = await import('node:fs')
    const parent = readFileSync('src/views/Parent.vue', 'utf8')
    expect(parent).toContain('distributionBySource(overviewItems.value)')
    expect(parent).toContain('evidenceLines(overviewItems.value, 3)')
    // 来源必须取自分类学事实表，不能在页面里硬编码 core/subject/habit/hidden
    expect(parent).toContain('TAXONOMY[a.id].source')
    expect(parent).not.toContain("source: 'habit'")
  })

  it('总结卡的"只弹一次"走 settings 标记，且判定复用 view.complete', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/views/Achievements.vue', 'utf8')
    expect(page).toContain('view.value?.complete === true')
    expect(page).toContain('hasSeenCollection()')
    expect(page).toContain('markCollectionSeen()')
    expect(page).toContain('@click="dismissCollection"')
    // 不允许页面自己再算一遍"是否集齐"
    expect(page).not.toContain('earned === total')
  })

  it('标记键落在熟悉的命名空间里（导出/恢复会一起带走）', () => {
    expect(COLLECTION_SEEN_KEY).toBe('achievement:collectionSeen')
  })
})

describe('总结卡「只弹一次」的状态读写', () => {
  it('默认没看过 → 标记后变成看过（往返一致），键写在 settings 里', async () => {
    store.rows.clear()
    expect(await hasSeenCollection()).toBe(false)
    await markCollectionSeen()
    expect(store.rows.get(COLLECTION_SEEN_KEY)).toBe(true)
    expect(await hasSeenCollection()).toBe(true)
  })

  it('读失败 → 当作没看过（宁可多弹一次，也不要把里程碑吞掉）', async () => {
    store.rows.clear()
    store.rows.set(COLLECTION_SEEN_KEY, true)
    store.state.failGet = true
    expect(await hasSeenCollection()).toBe(false)
    store.state.failGet = false
  })

  it('写失败不抛（关闭动作本身不该让页面报错）', async () => {
    store.rows.clear()
    store.state.failPut = true
    await expect(markCollectionSeen()).resolves.toBeUndefined()
    store.state.failPut = false
  })

  it('只认严格的 true（脏值不冒充"看过"）', async () => {
    store.rows.clear()
    store.rows.set(COLLECTION_SEEN_KEY, 'true')
    expect(await hasSeenCollection()).toBe(false)
    store.rows.set(COLLECTION_SEEN_KEY, 1)
    expect(await hasSeenCollection()).toBe(false)
  })
})
