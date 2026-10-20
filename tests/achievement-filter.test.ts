import { describe, expect, it } from 'vitest'
import {
  buildAchievementViewFromItems,
  filterAchievementItems,
  type AchievementItem,
  type AchievementSource,
} from '@core/motivation/achievementMeta'

/**
 * 图鉴筛选（V1.3 · P1「支持筛选 / 搜索」）的纯函数测试。
 *
 * 这一层最容易出的两类错，都在这里钉死：
 *   1. **剪影被搜出来** —— 未解锁的隐藏成就连"存在"都不该被确认，搜词绝不能命中它；
 *   2. **总口径被筛选带跑** —— 总览卡"已获得 x / 28"是全集口径，筛完不能变成 "x / 3"。
 */

const mk = (i: number, over: Partial<AchievementItem> = {}): AchievementItem => ({
  id: `a${i}`,
  icon: '🏅',
  title: `成就${i}`,
  desc: `描述${i}`,
  category: 'M',
  source: 'core',
  tier: 'common',
  stars: 0,
  earned: false,
  unlockedAt: '',
  evidence: '',
  silhouetted: false,
  metered: true,
  current: 0,
  target: 10,
  percent: 0,
  hint: `还差 10 个`,
  chainLabel: '',
  ...over,
})

const ids = (items: AchievementItem[]) => items.map((i) => i.id)

/** 12 枚：4 已获得（含 1 枚剪影未解锁）、8 待解锁；来源覆盖四类 */
function sample(): AchievementItem[] {
  return [
    mk(1, { earned: true, unlockedAt: '2026-10-01', source: 'core' }),
    mk(2, { earned: true, source: 'subject' }),
    mk(3, { earned: true, source: 'habit' }),
    mk(4, { earned: true, source: 'hidden', tier: 'hidden' }),
    mk(5, { source: 'core' }),
    mk(6, { source: 'subject', title: '连续七天' }),
    mk(7, { source: 'subject', desc: '在 07:00 前学习' }),
    mk(8, { source: 'habit' }),
    mk(9, { source: 'habit' }),
    mk(10, { source: 'core' }),
    // 剪影：标题/描述已经是遮罩后的文案，但**仍然不许被关键词命中**
    mk(11, { source: 'hidden', tier: 'hidden', silhouetted: true, title: '？？？', desc: '达成后揭晓' }),
    mk(12, { source: 'hidden', tier: 'hidden' }),
  ]
}

describe('filterAchievementItems', () => {
  it('空筛选 → 原样返回（同一个数组引用，不做无谓拷贝）', () => {
    const items = sample()
    expect(filterAchievementItems(items, {})).toBe(items)
    expect(filterAchievementItems(items)).toBe(items)
    expect(filterAchievementItems(items, { query: '   ', state: 'all', source: 'all' })).toBe(items)
  })

  it('按状态筛：earned / pending', () => {
    const items = sample()
    expect(ids(filterAchievementItems(items, { state: 'earned' }))).toEqual(['a1', 'a2', 'a3', 'a4'])
    const pending = filterAchievementItems(items, { state: 'pending' })
    expect(pending).toHaveLength(8)
    expect(pending.every((i) => !i.earned)).toBe(true)
  })

  it('按来源筛（含隐藏来源）', () => {
    const items = sample()
    expect(ids(filterAchievementItems(items, { source: 'hidden' }))).toEqual(['a4', 'a11', 'a12'])
  })

  it('关键词命中标题或描述，大小写与首尾空白都不敏感', () => {
    const items = sample()
    expect(ids(filterAchievementItems(items, { query: '连续七天' }))).toEqual(['a6'])
    expect(ids(filterAchievementItems(items, { query: '07:00' }))).toEqual(['a7'])
    expect(ids(filterAchievementItems(items, { query: '  成就3  ' }))).toEqual(['a3'])
    expect(filterAchievementItems(items, { query: '不存在的词' })).toHaveLength(0)
  })

  it('★ 剪影卡永不被关键词命中（搜"？？？"也搜不到）', () => {
    const items = sample()
    for (const q of ['？？？', '达成后揭晓', '？', '揭晓']) {
      const hit = filterAchievementItems(items, { query: q })
      expect(hit.some((i) => i.silhouetted), `关键词「${q}」命中了剪影`).toBe(false)
    }
  })

  it('只按状态/来源筛时，剪影卡照常保留（它们也是"待解锁"的一部分）', () => {
    const items = sample()
    expect(filterAchievementItems(items, { state: 'pending' }).some((i) => i.silhouetted)).toBe(true)
    expect(filterAchievementItems(items, { source: 'hidden' }).some((i) => i.silhouetted)).toBe(true)
  })

  it('多个条件是"与"关系', () => {
    const items = sample()
    expect(ids(filterAchievementItems(items, { state: 'pending', source: 'habit' }))).toEqual([
      'a8',
      'a9',
    ])
  })

  it('顺序保持原样（分组顺序才稳定）', () => {
    const items = sample()
    expect(ids(filterAchievementItems(items, { source: 'core' }))).toEqual(['a1', 'a5', 'a10'])
  })
})

describe('buildAchievementViewFromItems — 筛选不改变总口径', () => {
  it('★ 筛选后 total / earned / percent / complete 仍是全集口径', () => {
    const items = sample()
    const all = buildAchievementViewFromItems(items)
    const filtered = buildAchievementViewFromItems(items, {}, { state: 'earned', source: 'core' })

    expect(filtered.total).toBe(all.total)
    expect(filtered.earned).toBe(all.earned)
    expect(filtered.percent).toBe(all.percent)
    expect(filtered.complete).toBe(all.complete)
    // 只有"可见集合"变小
    expect(filtered.filteredTotal).toBe(1)
    expect(all.filteredTotal).toBe(12)
  })

  it('sections 只包含可见项；筛到只剩已获得时不出现「待解锁」区', () => {
    const items = sample()
    const v = buildAchievementViewFromItems(items, {}, { state: 'earned' })
    expect(v.sections.map((s) => s.key)).toEqual(['earned'])
    expect(v.sections[0].groups.flatMap((g) => g.items).every((i) => i.earned)).toBe(true)
  })

  it('筛成空 → 没有分区，且文案说明"是筛空的"而不是"还没有徽章"', () => {
    const items = sample()
    const v = buildAchievementViewFromItems(items, {}, { query: '绝对搜不到' })
    expect(v.filteredTotal).toBe(0)
    expect(v.sections).toHaveLength(0)
    expect(v.filterActive).toBe(true)
    expect(v.emptyHint).toContain('没有匹配')
  })

  it('未筛选且一枚都没有 → 仍是原来的引导文案', () => {
    const items = sample().map((i) => ({ ...i, earned: false }))
    const v = buildAchievementViewFromItems(items)
    expect(v.empty).toBe(true)
    expect(v.filterActive).toBe(false)
    expect(v.emptyHint).toContain('还没有徽章')
  })

  it('recent / closest 用全量（侧栏推荐不该被筛选影响）', () => {
    const items = sample()
    const v = buildAchievementViewFromItems(items, {}, { source: 'hidden' })
    expect(v.recent.map((r) => r.id)).toContain('a2') // 已获得里的 subject，不在筛选结果内
    expect(v.closest.every((c) => !c.silhouetted)).toBe(true)
  })

  it('noPackages 时探索组带引导文案', () => {
    const items = [mk(1, { category: 'E', source: 'subject' })]
    const v = buildAchievementViewFromItems(items, { noPackages: true })
    const e = v.sections[0].groups.find((g) => g.category === 'E')
    expect(e?.guide).toContain('导入学习包')
  })
})

describe('静态接线（图鉴页真的把筛选传下去了）', () => {
  it('页面用 buildAchievementViewFromItems(items, …, filter)，而不是另写一套过滤', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/views/Achievements.vue', 'utf8')
    expect(page).toContain('buildAchievementViewFromItems(')
    expect(page).toContain('achievementStore.items')
    // 筛选控件必须可被读屏识别成"开关"而不是纯装饰
    expect(page).toContain(':aria-pressed=')
    expect(page).toContain('aria-label="搜索成就"')
    // 筛空要说清楚（复用视图给的 emptyHint，不在模板里硬写第二份文案）
    expect(page).toContain(':description="view.emptyHint"')
  })
})
