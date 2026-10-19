import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, type UnlockedRecord } from '@core/motivation/achievements'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  buildAchievementView,
  type AchievementItem,
} from '@core/motivation/achievementMeta'
import { ctx, mastered, pkg, scenarios } from './achievement-fixtures'

/**
 * 图鉴视图模型测试（V1.3 · A-04 / A-05，对应 PRD §5.1–§5.4）
 *
 * 组件里不做任何判断，所以"两级折叠、默认态、空态、文案、排序"全部在这里验收。
 * `tests/e2e/achievement.spec.ts` 再验证真机 DOM（折叠真的能点、状态真能持久化）。
 */

const rec = (id: string, unlockedAt = '2026-10-01', evidence?: string): UnlockedRecord => ({
  id,
  unlockedAt,
  ...(evidence ? { evidence } : {}),
})

const allUnlocked = (): UnlockedRecord[] =>
  ACHIEVEMENTS.map((a) => rec(a.id, '2026-10-19', '证据'))

const itemById = (items: AchievementItem[], id: string) => items.find((i) => i.id === id)!

/** 拍平所有分区里的卡片，便于按 id 找 */
function flat(view: ReturnType<typeof buildAchievementView>): AchievementItem[] {
  return view.sections.flatMap((s) => s.groups.flatMap((g) => g.items))
}

describe('分类元数据', () => {
  it('四类齐全，顺序 M→G→B→E', () => {
    expect(CATEGORY_ORDER).toEqual(['M', 'G', 'B', 'E'])
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_META[c].label).not.toBe('')
      expect(CATEGORY_META[c].icon).not.toBe('')
    }
  })
})

describe('分区与默认态（PRD §5.1 / §5.2）', () => {
  it('一枚未得：只有「待解锁」区，默认展开', () => {
    const v = buildAchievementView(ctx(), [])
    expect(v.sections.map((s) => s.key)).toEqual(['pending'])
    expect(v.sections[0].defaultOpen).toBe(true)
    expect(v.sections[0].count).toBe(28)
  })

  it('有几枚已获得：两个区都在，已获得区默认**收起**', () => {
    const v = buildAchievementView(scenarios()['临界值'], [rec('first-step'), rec('ten-kp')])
    const earned = v.sections.find((s) => s.key === 'earned')!
    const pending = v.sections.find((s) => s.key === 'pending')!
    expect(earned.count).toBe(2)
    expect(earned.defaultOpen).toBe(false)
    expect(pending.defaultOpen).toBe(true)
    expect(pending.count).toBe(26)
  })

  it('28 枚全解锁：隐藏「待解锁」区，「已获得」区强制展开（AC-15）', () => {
    const v = buildAchievementView(scenarios()['全达标'], allUnlocked())
    expect(v.complete).toBe(true)
    expect(v.earned).toBe(28)
    expect(v.sections.map((s) => s.key)).toEqual(['earned'])
    expect(v.sections[0].defaultOpen).toBe(true)
  })

  it('区内的组枚数 = 该组在本区的枚数（不是全组总数）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [rec('first-step'), rec('mistake-first')])
    const pending = v.sections.find((s) => s.key === 'pending')!
    const gM = pending.groups.find((g) => g.category === 'M')!
    // M 类共 8 枚，已获得 first-step → 待解锁 7 枚
    expect(gM.count).toBe(7)
    expect(gM.items).toHaveLength(7)
  })

  it('某组在本区 0 枚 → 整组不渲染（AC-15 第三行）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    const pending = v.sections[0]
    for (const g of pending.groups) expect(g.count).toBeGreaterThan(0)
  })
})

describe('排序（PRD §5.1）', () => {
  it('待解锁组内按完成度降序；不可进度化的剪影排最后', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    const pending = v.sections[0]
    for (const g of pending.groups) {
      const pcts = g.items.map((i) => (i.silhouetted ? -1 : i.percent))
      const sorted = [...pcts].sort((a, b) => b - a)
      expect(pcts).toEqual(sorted)
    }
    // B 类里 streak-3 已达标（3/3 → 99%）应当排第一，两个隐藏成就垫底
    const gB = pending.groups.find((g) => g.category === 'B')!
    expect(gB.items[0].id).toBe('streak-3')
    expect(gB.items.slice(-2).every((i) => i.silhouetted)).toBe(true)
  })

  it('已获得组内按解锁日期倒序（最近拿到的在前）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [
      rec('first-step', '2026-10-01'),
      rec('fifty-kp', '2026-10-19'),
      rec('ten-kp', '2026-10-10'),
    ])
    const earned = v.sections.find((s) => s.key === 'earned')!
    const gM = earned.groups.find((g) => g.category === 'M')!
    expect(gM.items.map((i) => i.id)).toEqual(['fifty-kp', 'ten-kp', 'first-step'])
  })

  it('recent 是跨分组的全局倒序（层级结构不改变"最近"语义）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [
      rec('first-step', '2026-10-01'),
      rec('fifty-kp', '2026-10-19'),
      rec('ten-kp', '2026-10-10'),
    ])
    expect(v.recent.map((i) => i.id)).toEqual(['fifty-kp', 'ten-kp', 'first-step'])
  })
})

describe('★ 已解锁只看持久化记录：条件不再满足也不回收', () => {
  it('进度回落后徽章仍在「已获得」区', () => {
    const v = buildAchievementView(ctx(), [rec('kp-300', '2026-09-01')])
    const item = itemById(flat(v), 'kp-300')
    expect(item.earned).toBe(true)
    expect(item.percent).toBe(100)
    expect(item.current).toBe(0) // 诚实反映当下数据，但徽章不回收
  })
})

describe('三类卡片（PRD §5.3）', () => {
  it('已获得卡：证据行透传，旧记录没有 evidence → 空串（不补算）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [
      rec('ten-kp', '2026-10-19', '已掌握 10 个知识点'),
      rec('first-step', '2026-10-01'),
    ])
    const items = flat(v)
    expect(itemById(items, 'ten-kp').evidence).toBe('已掌握 10 个知识点')
    expect(itemById(items, 'first-step').evidence).toBe('')
  })

  it('已获得卡带连环标记（精熟之链 1/5）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [rec('first-step', '2026-10-01')])
    expect(itemById(flat(v), 'first-step').chainLabel).toBe('精熟之链 1/5')
  })

  it('未获得卡：可进度化 → 有条 + 文案；二值 → 无条 + 「完成一次即可解锁」', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    const items = flat(v)
    const tenKp = itemById(items, 'ten-kp')
    expect(tenKp.metered).toBe(true)
    // 临界值场景刚好 10/10：展示为瞬时态「已达标 · 正在确认」，不显示"还差 0 个"
    expect(tenKp.hint).toBe('已达标 · 正在确认')
    const senior = itemById(items, 'senior-new')
    expect(senior.metered).toBe(true)
    expect(senior.target).toBe(1)
  })

  it('二值卡的文案是「完成一次即可解锁」（AC-13）', () => {
    const v = buildAchievementView(ctx(), [])
    const senior = itemById(flat(v), 'senior-new')
    expect(senior.hint).toBe('完成一次即可解锁')
  })

  it('★ 隐藏成就未解锁 → 剪影：视图对象里根本没有真实 title / desc（AC-14）', () => {
    const v = buildAchievementView(scenarios()['全达标'], [])
    const silhouette = flat(v).filter((i) => i.silhouetted)
    expect(silhouette).toHaveLength(3)
    for (const s of silhouette) {
      expect(s.title).toBe('？？？')
      expect(s.desc).toBe('达成后揭晓')
      expect(s.icon).toBe('🔒')
      expect(s.metered).toBe(false)
      expect(s.hint).toBe('达成后揭晓')
      // 关键：真实文案不得以任何形式残留在对象里
      const json = JSON.stringify(s)
      expect(json).not.toContain('闻鸡起舞')
      expect(json).not.toContain('挑灯夜读')
      expect(json).not.toContain('越挫越勇')
      expect(json).not.toContain('早上 7 点前')
    }
  })

  it('隐藏成就解锁后正常显示标题与层级', () => {
    const v = buildAchievementView(scenarios()['全达标'], [rec('early-bird', '2026-10-19', '早上 7 点前学过')])
    const item = itemById(flat(v), 'early-bird')
    expect(item.silhouetted).toBe(false)
    expect(item.title).toBe('闻鸡起舞')
    expect(item.tier).toBe('hidden')
    expect(item.evidence).toBe('早上 7 点前学过')
  })

  it('卡片带 source / tier / stars（层级不是颜色唯一编码）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    const items = flat(v)
    expect(itemById(items, 'ten-kp').tier).toBe('advanced')
    expect(itemById(items, 'ten-kp').stars).toBe(1)
    expect(itemById(items, 'fifty-kp').tier).toBe('rare')
    expect(itemById(items, 'fifty-kp').stars).toBe(2)
    expect(itemById(items, 'ten-kp').source).toBe('subject')
    expect(itemById(items, 'perfect-kp').source).toBe('core')
  })
})

describe('百分比：未获得上限 99（否则"满格不亮"）', () => {
  it('999/1000 这类分数不会算出 100', () => {
    const v = buildAchievementView(ctx(), [])
    for (const i of flat(v)) {
      if (!i.earned) expect(i.percent).toBeLessThanOrEqual(99)
    }
  })

  it('刚好达标但还没结算 → 99% 而不是 100%', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    expect(itemById(flat(v), 'ten-kp').percent).toBe(99)
  })

  it('已解锁恒 100', () => {
    const v = buildAchievementView(ctx(), [rec('kp-300')])
    expect(itemById(flat(v), 'kp-300').percent).toBe(100)
  })
})

describe('空态与边界（PRD §5.4）', () => {
  it('0 枚：empty=true + 引导文案，总进度 0%', () => {
    const v = buildAchievementView(ctx(), [])
    expect(v.empty).toBe(true)
    expect(v.percent).toBe(0)
    expect(v.emptyHint).toContain('还没有徽章')
  })

  it('无学习包时，探索类组给「导入学习包后开始探索」', () => {
    const v = buildAchievementView(ctx({ packages: [] }), [])
    const gE = v.sections[0].groups.find((g) => g.category === 'E')!
    expect(gE.guide).toBe('导入学习包后开始探索')
  })

  it('有学习包时，组级引导为空', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    const gE = v.sections[0].groups.find((g) => g.category === 'E')!
    expect(gE.guide).toBe('')
  })

  it('脏记录（id 不存在）被忽略，不影响总数', () => {
    const v = buildAchievementView(ctx(), [rec('gone-forever')])
    expect(v.earned).toBe(0)
    expect(v.total).toBe(28)
    expect(v.empty).toBe(true)
  })
})

describe('最近解锁与正在接近', () => {
  it('recent 按日期倒序，空日期排最后，最多 3 条', () => {
    const v = buildAchievementView(scenarios()['临界值'], [
      rec('first-step', '2026-10-01'),
      rec('ten-kp', ''),
      rec('streak-3', '2026-10-19'),
      rec('mistake-first', '2026-10-10'),
    ])
    expect(v.recent).toHaveLength(3)
    expect(v.recent[0].id).toBe('streak-3')
    expect(v.recent.map((i) => i.id)).not.toContain('ten-kp')
  })

  it('closest 只统计"未获得且非剪影"，按进度倒序，最多 3 条', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    expect(v.closest.length).toBe(3)
    for (const c of v.closest) {
      expect(c.earned).toBe(false)
      expect(c.silhouetted).toBe(false)
    }
    const pcts = v.closest.map((c) => c.percent)
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a))
  })

  it('组内 closest 是折叠态摘要用的"最接近"那一枚', () => {
    const v = buildAchievementView(scenarios()['临界值'], [])
    const gM = v.sections[0].groups.find((g) => g.category === 'M')!
    expect(gM.closest).not.toBeNull()
    expect(gM.closest!.silhouetted).toBe(false)
    expect(gM.closest!.percent).toBe(Math.max(...gM.items.filter((i) => !i.silhouetted).map((i) => i.percent)))
  })

  it('已获得区不提供 closest（都拿到了，没有"最接近"）', () => {
    const v = buildAchievementView(scenarios()['临界值'], [rec('first-step')])
    const earned = v.sections.find((s) => s.key === 'earned')!
    for (const g of earned.groups) expect(g.closest).toBeNull()
  })
})

describe('进度文案来自 progressOf，前端不另算', () => {
  it('未获得卡的 hint 就是 progressText 的输出（含量词）', () => {
    const c = ctx({ progress: mastered('m', 3), packages: [pkg('m', 'math', 100)] })
    const v = buildAchievementView(c, [])
    expect(itemById(flat(v), 'ten-kp').hint).toBe('已完成 3/10 · 还差 7个知识点')
  })

  it('已获得卡的 hint 固定为「已获得」', () => {
    const v = buildAchievementView(scenarios()['临界值'], [rec('ten-kp')])
    expect(itemById(flat(v), 'ten-kp').hint).toBe('已获得')
  })
})
