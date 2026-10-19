import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  type AchievementContext,
  type AchievementDef,
  type UnlockedRecord,
} from '@core/motivation/achievements'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  MEASURES,
  buildAchievementView,
  missingMeasures,
  progressOf,
} from '@core/motivation/achievementMeta'

/**
 * 成就的"解释层"（进度 / 提示 / 图鉴）测试（V1.3 · T03）。
 *
 * 最重要的一条：`check(ctx) === (current >= target)`。
 * 这条等价关系一旦破了，就会出现"进度条满格但徽章不亮"或"徽章亮了但进度 8/10"，
 * 是孩子最容易察觉、也最伤信任的一类 bug。
 */

// ---------- 上下文工厂 ----------

function ctx(over: Partial<AchievementContext> = {}): AchievementContext {
  return {
    progress: [],
    mistakes: [],
    streak: { current: 0, best: 0, lastDate: '' } as any,
    packages: [],
    dailyStats: [],
    attemptedTypes: [],
    ...over,
  }
}

function pkg(packageId: string, subject: string, kpCount: number, term = 'up') {
  return { packageId, subject, grade: 4, term, packageType: 'unit', kpCount }
}

function prog(packageId: string, opts: Partial<Record<string, any>> = {}) {
  return {
    packageId,
    knowledgePointId: `${packageId}::kp`,
    status: '学习中',
    correctCount: 0,
    wrongCount: 0,
    correctStreak: 0,
    wrongStreak: 0,
    lastStudiedAt: '2026-10-01T00:00:00.000Z',
    studySeconds: 0,
    ...opts,
  } as any
}

function mastered(packageId: string, n: number, opts: Partial<Record<string, any>> = {}) {
  return Array.from({ length: n }, (_, i) =>
    prog(packageId, { knowledgePointId: `${packageId}::kp${i}`, status: '已掌握', ...opts }),
  )
}

/** 一组"几乎什么都有"的富上下文，用来同时验证 28 枚的度量 */
function richCtx(): AchievementContext {
  return ctx({
    progress: [
      ...mastered('unit-math', 12),
      ...mastered('unit-chinese', 11),
      ...mastered('unit-english', 10),
      ...mastered('unit-math-2', 5, { wrongCount: 3 }),
      prog('unit-math-3', { correctStreak: 12, correctCount: 20, wrongCount: 10 }),
    ],
    mistakes: [
      ...Array.from({ length: 12 }, (_, i) => ({
        exerciseId: `ex${i}`,
        packageId: 'unit-math',
        mastered: true,
        reviewCorrectCount: 2,
      })),
    ] as any,
    streak: { current: 31, best: 31, lastDate: '2026-10-19' } as any,
    packages: [
      pkg('unit-math', 'math', 40),
      pkg('unit-chinese', 'chinese', 40),
      pkg('unit-english', 'english', 40),
      pkg('unit-math-2', 'math', 10, 'down'),
      pkg('unit-math-3', 'math', 10, 'down'),
    ],
    dailyStats: [
      { day: '2026-10-01', questionCount: 25, firstStudyAt: new Date('2026-10-01T06:10:00').getTime(), lastStudyAt: new Date('2026-10-01T21:30:00').getTime() },
    ] as any,
    attemptedTypes: ['single', 'blank', 'multiple', 'judge', 'matching'],
  })
}

// ---------- 覆盖率 ----------

describe('MEASURES 覆盖率', () => {
  it('28 枚成就每一枚都有进度度量（漏一枚 → 图鉴里进度永远是 0）', () => {
    expect(ACHIEVEMENTS).toHaveLength(28)
    expect(missingMeasures()).toEqual([])
    for (const a of ACHIEVEMENTS) expect(typeof MEASURES[a.id]).toBe('function')
  })

  it('MEASURES 里没有多余（拼错 id 的孤儿条目）', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id))
    expect(Object.keys(MEASURES).filter((id) => !ids.has(id))).toEqual([])
  })

  it('四个分类都有元数据与顺序', () => {
    expect(CATEGORY_ORDER).toEqual(['M', 'G', 'B', 'E'])
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_META[c].label).toBeTruthy()
      expect(CATEGORY_META[c].desc).toBeTruthy()
      expect(CATEGORY_META[c].icon).toBeTruthy()
    }
  })
})

// ---------- 等价关系（核心）----------

describe('★ 进度与判定必须等价：check(ctx) === (current >= target)', () => {
  const contexts: Array<[string, AchievementContext]> = [
    ['空数据', ctx()],
    ['富数据', richCtx()],
    [
      '只有 1 个已掌握',
      ctx({ progress: mastered('unit-math', 1), packages: [pkg('unit-math', 'math', 5)] }),
    ],
    [
      '总知识点不足 20（mastery-half 的前置闸门）',
      ctx({
        progress: mastered('unit-math', 9),
        packages: [pkg('unit-math', 'math', 10)],
      }),
    ],
    [
      '总知识点刚好 20 且掌握 10（50%）',
      ctx({
        progress: mastered('unit-math', 10),
        packages: [pkg('unit-math', 'math', 20)],
      }),
    ],
    [
      '错题清掉 9 道（差 1 道到十道档）',
      ctx({
        mistakes: Array.from({ length: 9 }, (_, i) => ({
          exerciseId: `e${i}`,
          packageId: 'unit-math',
          mastered: true,
          reviewCorrectCount: 0,
        })) as any,
      }),
    ],
    [
      '连续 6 天（差 1 天到七天档）',
      ctx({ progress: mastered('unit-math', 1), streak: { current: 6, best: 6, lastDate: 'x' } as any }),
    ],
  ]

  for (const [name, c] of contexts) {
    it(`${name}：28 枚全部双向一致`, () => {
      const mismatch: string[] = []
      for (const a of ACHIEVEMENTS) {
        const m = progressOf(a.id, c)
        expect(m, `${a.id} 缺度量`).not.toBeNull()
        const byProgress = (m!.current ?? 0) >= (m!.target ?? 0)
        const byCheck = a.check(c)
        if (byProgress !== byCheck) {
          mismatch.push(`${a.id}: 进度 ${m!.current}/${m!.target} → ${byProgress}，check → ${byCheck}`)
        }
      }
      expect(mismatch).toEqual([])
    })
  }
})

describe('进度数值的几个具体口径', () => {
  it('subject-master-3 取三科最小值（偏科就卡在最少的那个）', () => {
    const c = ctx({
      progress: [...mastered('m', 20), ...mastered('c', 12), ...mastered('e', 3)],
      packages: [pkg('m', 'math', 50), pkg('c', 'chinese', 50), pkg('e', 'english', 50)],
    })
    const m = progressOf('subject-master-3', c)!
    expect(m.current).toBe(3)
    expect(m.target).toBe(10)
    expect(m.hint).toContain('数学 20/10')
    expect(m.hint).toContain('英语 3/10')
  })

  it('mastery-half 在知识点总数 <20 时进度按 0 计，并说明原因', () => {
    const c = ctx({ progress: mastered('m', 9), packages: [pkg('m', 'math', 10)] })
    const m = progressOf('mastery-half', c)!
    expect(m.current).toBe(0)
    expect(m.hint).toContain('≥20')
  })

  it('explorer 类按"学习过的包"计数，不是按进度行数', () => {
    const c = ctx({
      progress: [...mastered('p1', 3), ...mastered('p2', 3), ...mastered('p3', 1)],
      packages: [pkg('p1', 'math', 10), pkg('p2', 'math', 10), pkg('p3', 'math', 10)],
    })
    expect(progressOf('explorer-3', c)!.current).toBe(3)
    expect(progressOf('explorer-10', c)!.current).toBe(3)
  })

  it('term-cross 按"学过的学期"计数并给出人话提示', () => {
    const c = ctx({
      progress: mastered('a', 1),
      packages: [pkg('a', 'math', 10, 'up'), pkg('b', 'math', 10, 'down')],
    })
    const m = progressOf('term-cross', c)!
    expect(m.current).toBe(1)
    expect(m.hint).toContain('上册')
  })

  it('缺度量时返回 null 而不是抛错（防御性）', () => {
    expect(progressOf('not-exist', ctx())).toBeNull()
  })
})

// ---------- 图鉴视图 ----------

describe('buildAchievementView', () => {
  const emptyView = () => buildAchievementView(ctx(), [])

  it('四组齐全、总数 28、全部未获得', () => {
    const v = emptyView()
    expect(v.groups).toHaveLength(4)
    expect(v.total).toBe(28)
    expect(v.earned).toBe(0)
    expect(v.percent).toBe(0)
    expect(v.groups.map((g) => g.category)).toEqual(CATEGORY_ORDER)
    expect(v.recent).toEqual([])
  })

  it('★ 已解锁只看持久化记录：条件不再满足也不会回收', () => {
    // 上下文里一个知识点都没掌握，但记录说 first-step 已解锁
    const v = buildAchievementView(ctx(), [{ id: 'first-step', unlockedAt: '2026-10-01' }])
    const item = v.groups.flatMap((g) => g.items).find((i) => i.id === 'first-step')!
    expect(item.earned).toBe(true)
    expect(item.percent).toBe(100)
    expect(item.hint).toBe('已获得')
    expect(v.earned).toBe(1)
  })

  it('★ 未获得时显示进度与提示（未解锁也能看到差多少）', () => {
    const c = ctx({ progress: mastered('m', 7), packages: [pkg('m', 'math', 50)] })
    const v = buildAchievementView(c, [])
    const item = v.groups.flatMap((g) => g.items).find((i) => i.id === 'ten-kp')!
    expect(item.earned).toBe(false)
    expect(item.current).toBe(7)
    expect(item.target).toBe(10)
    expect(item.percent).toBe(70)
    expect(item.hint).toContain('还差 3')
  })

  it('★ 隐藏成就未解锁 → 剪影，不泄露标题/描述/进度', () => {
    const v = buildAchievementView(ctx(), [])
    for (const id of ['comeback', 'early-bird', 'night-owl']) {
      const item = v.groups.flatMap((g) => g.items).find((i) => i.id === id)!
      expect(item.silhouetted).toBe(true)
      expect(item.title).toBe('？？？')
      expect(item.desc).toBe('达成后揭晓')
      expect(item.icon).toBe('🔒')
      expect(item.current).toBe(0)
      expect(item.percent).toBe(0)
    }
  })

  it('隐藏成就解锁后正常显示', () => {
    const v = buildAchievementView(ctx(), [{ id: 'comeback', unlockedAt: '2026-10-19' }])
    const item = v.groups.flatMap((g) => g.items).find((i) => i.id === 'comeback')!
    expect(item.silhouetted).toBe(false)
    expect(item.title).toBe('越挫越勇')
    expect(item.icon).toBe('🌟')
  })

  it('recent 按解锁日期倒序，空日期排最后，最多 3 条', () => {
    const v = buildAchievementView(ctx(), [
      { id: 'first-step', unlockedAt: '' },
      { id: 'streak-3', unlockedAt: '2026-10-01' },
      { id: 'streak-7', unlockedAt: '2026-10-10' },
      { id: 'explorer-3', unlockedAt: '2026-10-05' },
    ])
    expect(v.recent.map((r) => r.id)).toEqual(['streak-7', 'explorer-3', 'streak-3'])
  })

  it('closest 只统计"未获得且非隐藏"，按进度倒序', () => {
    // 已掌握 9 个 → first-step 必然已解锁（真实运行中 syncAchievements 会写进记录），
    // 这里显式给出记录，构造一个**自洽**的状态：剩下最接近的是 ten-kp(9/10)
    const c = ctx({
      progress: mastered('m', 9),
      packages: [pkg('m', 'math', 50)],
      streak: { current: 6, best: 6, lastDate: 'x' } as any,
    })
    const v = buildAchievementView(c, [{ id: 'first-step', unlockedAt: '2026-10-01' }])
    expect(v.closest.length).toBeGreaterThan(0)
    expect(v.closest.every((i) => !i.earned && !i.silhouetted)).toBe(true)
    const percents = v.closest.map((i) => i.percent)
    expect([...percents].sort((a, b) => b - a)).toEqual(percents)
    // 9/10 = 90% 应该排第一
    expect(v.closest[0].percent).toBe(90)
  })

  it('组内 closest 是折叠态摘要用的"最接近"那一枚', () => {
    const c = ctx({ progress: mastered('m', 9), packages: [pkg('m', 'math', 50)] })
    const g = buildAchievementView(c, [{ id: 'first-step', unlockedAt: '2026-10-01' }]).groups.find(
      (x) => x.category === 'M',
    )!
    expect(g.closest?.id).toBe('ten-kp')
    expect(g.closest?.percent).toBe(90)
  })

  it('全组已获得时 closest 为 null（折叠态显示"本组已全部获得"）', () => {
    const all: UnlockedRecord[] = ACHIEVEMENTS.filter((a) => a.category === 'E').map((a) => ({
      id: a.id,
      unlockedAt: '2026-10-01',
    }))
    const g = buildAchievementView(ctx(), all).groups.find((x) => x.category === 'E')!
    expect(g.earned).toBe(g.total)
    expect(g.closest).toBeNull()
  })

  it('整体百分比按枚数四舍五入', () => {
    const records: UnlockedRecord[] = (ACHIEVEMENTS.slice(0, 7) as AchievementDef[]).map((a) => ({
      id: a.id,
      unlockedAt: 'x',
    }))
    const v = buildAchievementView(ctx(), records)
    expect(v.earned).toBe(7)
    expect(v.percent).toBe(Math.round((7 / 28) * 100))
  })

  it('脏记录（id 不存在）被忽略，不影响总数', () => {
    const v = buildAchievementView(ctx(), [{ id: 'gone-forever', unlockedAt: 'x' }])
    expect(v.earned).toBe(0)
    expect(v.total).toBe(28)
  })
})
