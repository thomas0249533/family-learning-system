import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * dailyStats 单测：内存累加 / 多日 / 首末时刻 min-max / 裁剪 60 天 /
 * 防抖落盘 / flush 持久化。用内存版 settings 表替代 IndexedDB。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const rows: Row[] = []
  let putCalls = 0
  return {
    rows,
    get putCalls() { return putCalls },
    settings: {
      async get(k: any) { return rows.find((r) => r.key === k) },
      async put(r: Row) {
        putCalls++
        const i = rows.findIndex((x) => x.key === r.key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return r.key
      },
    },
    __reset() { rows.length = 0; putCalls = 0 },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const {
  loadDailyStats,
  bumpDailyStats,
  flushDailyStats,
  RETAIN_DAYS,
  FLUSH_DEBOUNCE_MS,
  __resetDailyStatsForTest,
} = await import('@core/motivation/dailyStats')

beforeEach(() => {
  fake.__reset()
  __resetDailyStatsForTest()
})

const day = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('dailyStats — 基础累加', () => {
  it('空库 → []', async () => {
    expect(await loadDailyStats()).toEqual([])
  })

  it('同日多次 bump：计数累加、首/末时刻取 min/max', async () => {
    bumpDailyStats({ count: 1, at: day(2025, 1, 1, 9, 0) })
    bumpDailyStats({ count: 2, at: day(2025, 1, 1, 20, 0) })
    bumpDailyStats({ count: 1, at: day(2025, 1, 1, 12, 0) })
    await flushDailyStats()

    const stats = await loadDailyStats()
    expect(stats).toHaveLength(1)
    expect(stats[0].date).toBe('2025-01-01')
    expect(stats[0].questionCount).toBe(4)
    expect(stats[0].firstStudyAt).toBe(day(2025, 1, 1, 9, 0).getTime())
    expect(stats[0].lastStudyAt).toBe(day(2025, 1, 1, 20, 0).getTime())
  })

  it('不同日期各自成行（按本地日期键）', async () => {
    bumpDailyStats({ count: 1, at: day(2025, 1, 1) })
    bumpDailyStats({ count: 1, at: day(2025, 1, 2) })
    await flushDailyStats()

    const stats = await loadDailyStats()
    expect(stats.map((s) => s.date)).toEqual(['2025-01-01', '2025-01-02'])
  })

  it('默认 count=1', async () => {
    bumpDailyStats({ at: day(2025, 1, 1) })
    await flushDailyStats()
    expect((await loadDailyStats())[0].questionCount).toBe(1)
  })
})

describe('dailyStats — 裁剪保留最近 60 天', () => {
  it('超过 RETAIN_DAYS 天只保留最近 60 条', async () => {
    const start = new Date(2024, 0, 1)
    for (let i = 0; i < 75; i++) {
      const d = new Date(start.getTime() + i * 86400000)
      bumpDailyStats({ count: 1, at: d })
    }
    await flushDailyStats()

    const stats = await loadDailyStats()
    expect(stats).toHaveLength(RETAIN_DAYS)
    // 保留的是最新的 60 天（升序，末位为最后一天）
    const last = new Date(start.getTime() + 74 * 86400000)
    const lastKey = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
    expect(stats[stats.length - 1].date).toBe(lastKey)
  })
})

describe('dailyStats — 防抖落盘', () => {
  it('bump 后不立即落盘（防抖）', async () => {
    await loadDailyStats() // 先加载，标记 loaded
    const before = fake.putCalls
    bumpDailyStats({ count: 1 })
    expect(fake.putCalls, 'bump 不应立即写库').toBe(before)
  })

  it('flushDailyStats 立即落盘并去重合并', async () => {
    bumpDailyStats({ count: 3, at: day(2025, 1, 1) })
    await flushDailyStats()
    expect(fake.putCalls).toBeGreaterThan(0)
    const row = fake.rows.find((r) => r.key === 'dailyStats')
    expect(row?.value).toHaveLength(1)
    expect(row?.value[0].questionCount).toBe(3)
  })

  it('防抖计时器到时自动落盘（fake timers）', async () => {
    vi.useFakeTimers()
    try {
      bumpDailyStats({ count: 2, at: day(2025, 1, 1) })
      expect(fake.putCalls).toBe(0)
      await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS + 100)
      expect(fake.putCalls).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('dailyStats — 页面隐藏 / 卸载强制 flush（钩子路径）', () => {
  const handlers: Record<string, Array<() => void>> = {}
  const g = globalThis as any

  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    g.window = {
      addEventListener: (t: string, cb: () => void) => { (handlers[t] ||= []).push(cb) },
    }
    g.document = {
      addEventListener: (t: string, cb: () => void) => { (handlers[t] ||= []).push(cb) },
      visibilityState: 'visible',
    }
    __resetDailyStatsForTest()
  })

  afterEach(() => {
    delete g.window
    delete g.document
  })

  it('visibilitychange → hidden 触发 flush', async () => {
    await loadDailyStats()
    bumpDailyStats({ count: 1, at: day(2025, 1, 1) })
    expect(handlers['visibilitychange']?.length, '应已注册 visibilitychange').toBeGreaterThan(0)
    const before = fake.putCalls
    g.document.visibilityState = 'hidden'
    handlers['visibilitychange'].forEach((cb) => cb())
    await new Promise((r) => setTimeout(r, 0))
    expect(fake.putCalls, 'hidden 应强制落盘').toBeGreaterThan(before)
  })

  it('visibilitychange 但 state=visible 不触发 flush', async () => {
    await loadDailyStats()
    bumpDailyStats({ count: 1, at: day(2025, 1, 1) })
    const before = fake.putCalls
    g.document.visibilityState = 'visible'
    handlers['visibilitychange'].forEach((cb) => cb())
    await new Promise((r) => setTimeout(r, 0))
    expect(fake.putCalls).toBe(before)
  })

  it('beforeunload 触发 flush', async () => {
    await loadDailyStats()
    bumpDailyStats({ count: 2, at: day(2025, 1, 1) })
    expect(handlers['beforeunload']?.length, '应已注册 beforeunload').toBeGreaterThan(0)
    const before = fake.putCalls
    handlers['beforeunload'].forEach((cb) => cb())
    await new Promise((r) => setTimeout(r, 0))
    expect(fake.putCalls, 'beforeunload 应强制落盘').toBeGreaterThan(before)
  })
})
