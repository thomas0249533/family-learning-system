import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 成就单测：
 *   · 38 枚每一枚的判定条件都有正/负两向覆盖（含边界）；
 *   · 存储迁移 normalizeUnlocked（旧 string[] → {id,unlockedAt}[]）；
 *   · syncAchievements 幂等 / 只增不减 / unlockedAt 本地日期。
 *
 * 用内存版 Dexie 替身替代 IndexedDB（settings 表即可）。
 * V2.8 · C1：38 = 原 28（**判据一字未动**，AC-01）+ 习惯养成 10 枚。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const rows: Row[] = []
  return {
    rows,
    settings: {
      async get(k: any) { return rows.find((r) => r.key === k) },
      async put(r: Row) {
        const i = rows.findIndex((x) => x.key === r.key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return r.key
      },
    },
    __reset() { rows.length = 0 },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const {
  ACHIEVEMENTS,
  evaluateAchievements,
  normalizeUnlocked,
  loadUnlocked,
  syncAchievements,
  achievementById,
  achievementsKey,
} = await import('@core/motivation/achievements')
const { EMPTY_STREAK, localDayKey } = await import('@core/motivation/streak')

type Ctx = Parameters<typeof evaluateAchievements>[0]

function mastered(n: number, pkg = 'p'): any[] {
  return Array.from({ length: n }, (_, i) => ({
    profileId: 'default',
    packageId: pkg,
    knowledgePointId: `${pkg}-kp-${i}`,
    status: '已掌握' as const,
  }))
}

function pkgMeta(over: Partial<{ packageId: string; subject: string; grade: number; term: string; packageType: string; kpCount: number }>) {
  return { packageId: 'p', subject: 'math', grade: 4, term: 'up', packageType: 'base', kpCount: 0, ...over }
}

const base: Ctx = { progress: [], mistakes: [], streak: { ...EMPTY_STREAK } }

beforeEach(() => {
  fake.__reset()
})

// ---------------------------------------------------------------------
// 每枚徽章：PASS 上下文 → 命中；FAIL 上下文 → 不命中
// ---------------------------------------------------------------------
describe('38 枚成就判定（每枚正/负覆盖）', () => {
  const PASS: Record<string, Ctx> = {
    'first-step': { ...base, progress: mastered(1) },
    'ten-kp': { ...base, progress: mastered(10) },
    'fifty-kp': { ...base, progress: mastered(50) },
    'hundred-kp': { ...base, progress: mastered(100) },
    'kp-300': { ...base, progress: mastered(300) },
    'subject-master-3': {
      ...base,
      packages: [
        pkgMeta({ packageId: 'm', subject: 'math', kpCount: 12 }),
        pkgMeta({ packageId: 'c', subject: 'chinese', kpCount: 12 }),
        pkgMeta({ packageId: 'e', subject: 'english', kpCount: 12 }),
      ],
      progress: [...mastered(10, 'm'), ...mastered(10, 'c'), ...mastered(10, 'e')],
    },
    'perfect-kp': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '学习中', correctStreak: 10 } as any] },
    'mastery-half': {
      ...base,
      packages: [pkgMeta({ kpCount: 20 })],
      progress: mastered(10),
    },
    'mistake-first': { ...base, mistakes: [{ profileId: 'default', mastered: true, packageId: 'p', exerciseId: 'e', knowledgePointIds: [], wrongAt: '', wrongCount: 1 }] },
    'mistake-cleaner': { ...base, mistakes: Array.from({ length: 10 }, (_, i) => ({ profileId: 'default', mastered: true, packageId: 'p', exerciseId: 'e' + i, knowledgePointIds: [], wrongAt: '', wrongCount: 1 })) },
    'mistake-cleaner-50': { ...base, mistakes: Array.from({ length: 50 }, (_, i) => ({ profileId: 'default', mastered: true, packageId: 'p', exerciseId: 'e' + i, knowledgePointIds: [], wrongAt: '', wrongCount: 1 })) },
    'comeback': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '已掌握', wrongCount: 3 } as any] },
    'review-20': { ...base, mistakes: [{ profileId: 'default', mastered: false, packageId: 'p', exerciseId: 'e', knowledgePointIds: [], wrongAt: '', wrongCount: 1, reviewCorrectCount: 20 }] },
    'patience': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '学习中', correctCount: 20, wrongCount: 10 } as any] },
    'streak-master': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '学习中', correctStreak: 5 } as any] },
    'streak-3': { ...base, streak: { current: 3, longest: 3, lastDate: localDayKey() } },
    'streak-7': { ...base, streak: { current: 7, longest: 7, lastDate: localDayKey() } },
    'streak-30': { ...base, streak: { current: 30, longest: 30, lastDate: localDayKey() } },
    'streak-60': { ...base, streak: { current: 60, longest: 60, lastDate: localDayKey() } },
    'streak-100': { ...base, streak: { current: 100, longest: 100, lastDate: localDayKey() } },
    'early-bird': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: new Date(2024, 0, 1, 6, 30).getTime(), lastStudyAt: new Date(2024, 0, 1, 6, 40).getTime() }] },
    'night-owl': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: new Date(2024, 0, 1, 20, 0).getTime(), lastStudyAt: new Date(2024, 0, 1, 21, 30).getTime() }] },
    'daily-20': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 20, firstStudyAt: 0, lastStudyAt: 0 }] },
    'explorer-3': { ...base, progress: [...mastered(1, 'a'), ...mastered(1, 'b'), ...mastered(1, 'c')] },
    'explorer-10': { ...base, progress: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].flatMap((p) => mastered(1, p)) },
    'type-collector': { ...base, attemptedTypes: ['single', 'blank', 'multiple', 'judge', 'spelling'] },
    'term-cross': {
      ...base,
      packages: [pkgMeta({ packageId: 'a', term: 'up' }), pkgMeta({ packageId: 'b', term: 'down' })],
      progress: [...mastered(1, 'a'), ...mastered(1, 'b')],
    },
    'senior-new': {
      ...base,
      packages: [pkgMeta({ packageId: 'c', subject: 'chinese' })],
      progress: mastered(1, 'c'),
    },
    // ---------- V2.8 · C1 习惯养成 10 枚 ----------
    'focus-5': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 5 }] },
    'focus-15': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 15 }] },
    'focus-30': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 30 }] },
    'focus-days-3': {
      ...base,
      dailyStats: [1, 2, 3].map((d) => ({ date: `2024-01-0${d}`, questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 10 })),
    },
    'morning-light': {
      ...base,
      dailyStats: [1, 2, 3].map((d) => ({ date: `2024-01-0${d}`, questionCount: 1, firstStudyAt: new Date(2024, 0, d, 7, 30).getTime(), lastStudyAt: 0 })),
    },
    'one-go': { ...base, packages: [pkgMeta({ kpCount: 5 })], progress: mastered(5) },
    'perfect-day': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 20, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 30 }] },
    'streak-14': { ...base, streak: { current: 14, longest: 14, lastDate: localDayKey() } },
    'daily-50': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 50, firstStudyAt: 0, lastStudyAt: 0 }] },
    'weekend-2': {
      ...base,
      // 2024-01-06 是周六、2024-01-07 是周日
      dailyStats: [
        { date: '2024-01-06', questionCount: 5, firstStudyAt: 0, lastStudyAt: 0 },
        { date: '2024-01-07', questionCount: 5, firstStudyAt: 0, lastStudyAt: 0 },
      ],
    },
  }

  // 边界负例：恰好差一点
  const FAIL: Record<string, Ctx> = {
    'first-step': { ...base, progress: [] },
    'ten-kp': { ...base, progress: mastered(9) },
    'fifty-kp': { ...base, progress: mastered(49) },
    'hundred-kp': { ...base, progress: mastered(99) },
    'kp-300': { ...base, progress: mastered(299) },
    'subject-master-3': {
      ...base,
      packages: [pkgMeta({ packageId: 'm', subject: 'math' }), pkgMeta({ packageId: 'c', subject: 'chinese' }), pkgMeta({ packageId: 'e', subject: 'english' })],
      progress: [...mastered(10, 'm'), ...mastered(10, 'c'), ...mastered(9, 'e')],
    },
    'perfect-kp': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '学习中', correctStreak: 9 } as any] },
    'mastery-half': { ...base, packages: [pkgMeta({ kpCount: 20 })], progress: mastered(9) },
    'mistake-first': { ...base, mistakes: [] },
    'mistake-cleaner': { ...base, mistakes: Array.from({ length: 9 }, (_, i) => ({ profileId: 'default', mastered: true, packageId: 'p', exerciseId: 'e' + i, knowledgePointIds: [], wrongAt: '', wrongCount: 1 })) },
    'mistake-cleaner-50': { ...base, mistakes: Array.from({ length: 49 }, (_, i) => ({ profileId: 'default', mastered: true, packageId: 'p', exerciseId: 'e' + i, knowledgePointIds: [], wrongAt: '', wrongCount: 1 })) },
    'comeback': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '已掌握', wrongCount: 2 } as any] },
    'review-20': { ...base, mistakes: [{ profileId: 'default', mastered: false, packageId: 'p', exerciseId: 'e', knowledgePointIds: [], wrongAt: '', wrongCount: 1, reviewCorrectCount: 19 }] },
    'patience': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '学习中', correctCount: 19, wrongCount: 10 } as any] },
    'streak-master': { ...base, progress: [{ profileId: 'default', packageId: 'p', knowledgePointId: 'k', status: '学习中', correctStreak: 4 } as any] },
    'streak-3': { ...base, streak: { current: 2, longest: 2, lastDate: localDayKey() } },
    'streak-7': { ...base, streak: { current: 6, longest: 6, lastDate: localDayKey() } },
    'streak-30': { ...base, streak: { current: 29, longest: 29, lastDate: localDayKey() } },
    'streak-60': { ...base, streak: { current: 59, longest: 59, lastDate: localDayKey() } },
    'streak-100': { ...base, streak: { current: 99, longest: 99, lastDate: localDayKey() } },
    'early-bird': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: new Date(2024, 0, 1, 7, 0).getTime(), lastStudyAt: new Date(2024, 0, 1, 7, 10).getTime() }] },
    'night-owl': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: new Date(2024, 0, 1, 20, 0).getTime(), lastStudyAt: new Date(2024, 0, 1, 20, 59).getTime() }] },
    'daily-20': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 19, firstStudyAt: 0, lastStudyAt: 0 }] },
    'explorer-3': { ...base, progress: [...mastered(1, 'a'), ...mastered(1, 'b')] },
    'explorer-10': { ...base, progress: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].flatMap((p) => mastered(1, p)) },
    'type-collector': { ...base, attemptedTypes: ['single', 'blank', 'multiple', 'judge'] },
    'term-cross': { ...base, packages: [pkgMeta({ packageId: 'a', term: 'up' }), pkgMeta({ packageId: 'b', term: 'up' })], progress: [...mastered(1, 'a'), ...mastered(1, 'b')] },
    'senior-new': { ...base, packages: [pkgMeta({ packageId: 'm', subject: 'math' })], progress: mastered(1, 'm') },
    // ---------- V2.8 · C1 边界负例：恰好差一点 ----------
    'focus-5': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 4.9 }] },
    'focus-15': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 14.9 }] },
    'focus-30': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 29.9 }] },
    'focus-days-3': {
      ...base,
      dailyStats: [1, 2].map((d) => ({ date: `2024-01-0${d}`, questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 10 })),
    },
    'morning-light': {
      ...base,
      // 两天在 7:30（差一天），第三天在 8:00 整（不算"8 点前"）
      dailyStats: [
        { date: '2024-01-01', questionCount: 1, firstStudyAt: new Date(2024, 0, 1, 7, 30).getTime(), lastStudyAt: 0 },
        { date: '2024-01-02', questionCount: 1, firstStudyAt: new Date(2024, 0, 2, 7, 30).getTime(), lastStudyAt: 0 },
        { date: '2024-01-03', questionCount: 1, firstStudyAt: new Date(2024, 0, 3, 8, 0).getTime(), lastStudyAt: 0 },
      ],
    },
    'one-go': { ...base, packages: [pkgMeta({ kpCount: 5 })], progress: mastered(4) },
    'perfect-day': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 20, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 29.9 }] },
    'streak-14': { ...base, streak: { current: 13, longest: 13, lastDate: localDayKey() } },
    'daily-50': { ...base, dailyStats: [{ date: '2024-01-01', questionCount: 49, firstStudyAt: 0, lastStudyAt: 0 }] },
    'weekend-2': {
      ...base,
      // 只有周六；周日没学
      dailyStats: [{ date: '2024-01-06', questionCount: 5, firstStudyAt: 0, lastStudyAt: 0 }],
    },
  }

  it('共 38 枚', () => {
    expect(ACHIEVEMENTS).toHaveLength(38)
  })

  for (const a of ACHIEVEMENTS) {
    it(`#${a.id}（${a.category}）命中 PASS 且不命中 FAIL`, () => {
      expect(a.check(PASS[a.id]), `${a.id} 应在 PASS 上下文命中`).toBe(true)
      expect(a.check(FAIL[a.id]), `${a.id} 不应在 FAIL 上下文命中`).toBe(false)
    })
  }

  it('每枚 PASS 上下文都能被 evaluateAchievements 收集', () => {
    for (const a of ACHIEVEMENTS) {
      expect(evaluateAchievements(PASS[a.id]), `${a.id}`).toContain(a.id)
    }
  })

  it('四类数量 = M8 / G7 / B18 / E5（V2.8 · C1：习惯 10 枚全部落在 B）', () => {
    const count = (c: string) => ACHIEVEMENTS.filter((a) => a.category === c).length
    expect(count('M')).toBe(8)
    expect(count('G')).toBe(7)
    expect(count('B')).toBe(18)
    expect(count('E')).toBe(5)
  })

  it('隐藏 3 枚：comeback / early-bird / night-owl', () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id).sort()
    expect(hidden).toEqual(['comeback', 'early-bird', 'night-owl'])
  })

  it('旧 9 枚 id 全部保留且语义不变', () => {
    const oldIds = ['first-step', 'ten-kp', 'fifty-kp', 'hundred-kp', 'streak-3', 'streak-7', 'streak-30', 'mistake-cleaner', 'streak-master']
    for (const id of oldIds) expect(achievementById(id), `缺 ${id}`).toBeDefined()
    expect(achievementById('first-step')!.title).toBe('迈出第一步')
    expect(achievementById('streak-master')!.desc).toBe('单个知识点连续答对 5 题')
  })

  it('缺 packages/dailyStats/attemptedTypes 时不崩且相关徽章不命中', () => {
    expect(evaluateAchievements(base)).not.toContain('subject-master-3')
    expect(evaluateAchievements(base)).not.toContain('early-bird')
    expect(evaluateAchievements(base)).not.toContain('type-collector')
  })
})

// ---------------------------------------------------------------------
// 存储迁移
// ---------------------------------------------------------------------
describe('normalizeUnlocked — 旧 string[] 兼容', () => {
  it('string[] → {id,unlockedAt:""}', () => {
    expect(normalizeUnlocked(['a', 'b'])).toEqual([
      { id: 'a', unlockedAt: '' },
      { id: 'b', unlockedAt: '' },
    ])
  })

  it('混合半迁移态：字符串 + 对象', () => {
    expect(normalizeUnlocked(['a', { id: 'b', unlockedAt: '2024-05-01' }])).toEqual([
      { id: 'a', unlockedAt: '' },
      { id: 'b', unlockedAt: '2024-05-01' },
    ])
  })

  it('非数组 → []', () => {
    expect(normalizeUnlocked(null)).toEqual([])
    expect(normalizeUnlocked({})).toEqual([])
  })

  it('丢弃非法项', () => {
    expect(normalizeUnlocked([123, { foo: 'bar' }, { id: 'ok' }])).toEqual([
      { id: 'ok', unlockedAt: '' },
    ])
  })
})

describe('syncAchievements — 幂等 / 只增不减 / 解锁日期', () => {
  const now = new Date(2025, 4, 20, 10, 0, 0)
  const ctxFirst: Ctx = { ...base, progress: mastered(1) } // first-step

  it('首次结算：写入 unlockedAt=localDayKey', async () => {
    const r = await syncAchievements(ctxFirst, now)
    expect(r.newlyUnlocked.map((a) => a.id)).toContain('first-step')
    // 落库键必须带档案后缀（写成基名 = 换档案后两个孩子的成就串台）
    expect(achievementsKey()).toBe('achievements:default')
    expect(fake.rows.map((row) => row.key)).toEqual([achievementsKey()])
    const saved = await loadUnlocked()
    const rec = saved.find((s) => s.id === 'first-step')
    expect(rec?.unlockedAt).toBe(localDayKey(now))
  })

  it('幂等：二次结算不重复、unlockedAt 保留、newlyUnlocked 为空', async () => {
    await syncAchievements(ctxFirst, now)
    const r2 = await syncAchievements(ctxFirst, new Date(2025, 5, 1))
    expect(r2.newlyUnlocked).toHaveLength(0)
    const rec = (await loadUnlocked()).find((s) => s.id === 'first-step')
    expect(rec?.unlockedAt).toBe(localDayKey(now)) // 旧日期原样保留
  })

  it('只增不减：条件不再满足也不撤销', async () => {
    await syncAchievements(ctxFirst, now)
    // 空上下文（不再满足 first-step）
    const r = await syncAchievements({ ...base }, new Date(2025, 5, 1))
    expect(r.unlocked).toContain('first-step')
  })

  it('兼容旧存储：存 string[] 时能读出且不被清空', async () => {
    await fake.settings.put({ key: achievementsKey(), value: ['ten-kp'] })
    const saved = await loadUnlocked()
    expect(saved).toEqual([{ id: 'ten-kp', unlockedAt: '' }])
    // 再次结算（不满足 ten-kp）也应保留
    const r = await syncAchievements({ ...base }, now)
    expect(r.unlocked).toContain('ten-kp')
  })
})

describe('证据快照（A-06）', () => {
  const now = new Date(2025, 4, 20, 10, 0, 0)

  it('解锁瞬间写入 evidence，内容取自当时的进度', async () => {
    await syncAchievements({ ...base, progress: mastered(10) }, now)
    const rec = (await loadUnlocked()).find((s) => s.id === 'ten-kp')
    expect(rec?.evidence).toBe('已掌握 10 个知识点')
  })

  it('证据此后不随数据变化（再次结算不覆盖）', async () => {
    await syncAchievements({ ...base, progress: mastered(10) }, now)
    await syncAchievements({ ...base, progress: mastered(20) }, now)
    const rec = (await loadUnlocked()).find((s) => s.id === 'ten-kp')
    expect(rec?.evidence).toBe('已掌握 10 个知识点')
  })

  it('旧记录没有 evidence：读取后仍是 undefined（不补算）', async () => {
    await fake.settings.put({ key: achievementsKey(), value: [{ id: 'first-step', unlockedAt: '2026-01-01' }] })
    const rec = (await loadUnlocked()).find((s) => s.id === 'first-step')
    expect(rec?.evidence).toBeUndefined()
    expect(rec?.unlockedAt).toBe('2026-01-01')
  })

  it('脏 evidence（数字 / 空串）归一化为"没有证据"', async () => {
    await fake.settings.put({
      key: achievementsKey(),
      value: [
        { id: 'first-step', unlockedAt: '', evidence: 42 },
        { id: 'ten-kp', unlockedAt: '', evidence: '   ' },
        { id: 'fifty-kp', unlockedAt: '', evidence: '已掌握 50 个知识点' },
      ],
    })
    const saved = await loadUnlocked()
    expect(saved.find((s) => s.id === 'first-step')?.evidence).toBeUndefined()
    expect(saved.find((s) => s.id === 'ten-kp')?.evidence).toBeUndefined()
    expect(saved.find((s) => s.id === 'fifty-kp')?.evidence).toBe('已掌握 50 个知识点')
  })
})

describe('★ 写库失败：不落库、不产生"已解锁但没存"（AC-08）', () => {
  const now = new Date(2025, 4, 20, 10, 0, 0)
  const ctxFirst: Ctx = { ...base, progress: mastered(1) }

  it('put 抛错 → syncAchievements 抛出，且库内没有任何记录', async () => {
    const original = fake.settings.put
    fake.settings.put = async () => {
      throw new Error('IndexedDB 写入失败（模拟）')
    }
    try {
      await expect(syncAchievements(ctxFirst, now)).rejects.toThrow('写入失败')
    } finally {
      fake.settings.put = original
    }
    // 关键：失败后不能留下半条记录（否则会出现"弹了提示但库里没有"或反过来的错位）
    expect(await loadUnlocked()).toEqual([])
  })

  it('失败后重试能补上（下次触发自然重试）', async () => {
    const original = fake.settings.put
    fake.settings.put = async () => {
      throw new Error('boom')
    }
    await expect(syncAchievements(ctxFirst, now)).rejects.toThrow()
    fake.settings.put = original

    const r = await syncAchievements(ctxFirst, now)
    expect(r.newlyUnlocked.map((a) => a.id)).toContain('first-step')
    expect((await loadUnlocked()).some((s) => s.id === 'first-step')).toBe(true)
  })
})
