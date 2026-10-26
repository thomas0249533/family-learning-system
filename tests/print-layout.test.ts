import { describe, expect, it } from 'vitest'
import { paginateByCategory, pageLabel, PRINT_PER_PAGE } from '@core/report/printLayout'
import { buildAchievementItems, type AchievementItem } from '@core/motivation/achievementMeta'
import { isCollectible, type AchievementDef } from '@core/motivation/achievements'

/**
 * V1.4 · B5 · 打印分页（AC-P2-16）
 *
 * AC 原文：内置 38 枚 + 某组自定义包 → 每页只含一个小组；M/G/B/E 顺序正确；
 * 空组不出页；页码连续；单组超容量时续页标"（续）"且页码不重编。
 *
 * 分页是纯函数，所以这五条能在这里全部钉死；渲染层只需要"按 pages 循环 + 用 pageLabel 编号"。
 */

const ctx = { progress: [], mistakes: [], streak: { current: 0, longest: 0, lastDate: '' } }

/** 造 n 枚自定义定义，全部落在某个小组里 */
function defs(category: AchievementDef['category'], n: number, prefix = 'custom::x'): AchievementDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    icon: '🧩',
    title: `自定义 ${i + 1}`,
    desc: '测试用',
    category,
    check: () => false,
  }))
}

function itemsOf(extra: AchievementDef[] = []): AchievementItem[] {
  return buildAchievementItems(ctx, [], extra)
}

describe('paginateByCategory — 内置 38 枚的基线', () => {
  const pages = paginateByCategory(itemsOf())

  it('38 枚按 M/G/B/B/E 出 5 页，顺序正确（B 组 17 枚超容量续页）', () => {
    expect(pages.map((p) => p.category)).toEqual(['M', 'G', 'B', 'B', 'E'])
  })

  it('每页只含一个小组（这条是"按小组分页"的定义）', () => {
    for (const page of pages) {
      const cats = new Set(page.items.map((i) => i.category))
      expect(cats.size).toBe(1)
      expect([...cats][0]).toBe(page.category)
    }
  })

  // V1.6 · C6：B 组少的那一枚是 night-owl（不参与收集的彩蛋），所以是 17 而不是 18。
  // V2.8 · C1：B 组 8 → 18（习惯 10 枚），收集面 17 枚超过容量 12 → 续页（12+5）。
  it('内置分布是 M8 / G7 / B17 / E5；B 组分两页（12+5），其余组无续页', () => {
    expect(pages.map((p) => p.items.length)).toEqual([8, 7, 12, 5, 5])
    expect(pages.map((p) => p.continued)).toEqual([false, false, false, true, false])
    expect(PRINT_PER_PAGE).toBe(12)
  })

  it('groupTotal / groupEarned 与实物一致（页眉数字的唯一来源）', () => {
    expect(pages.map((p) => p.groupTotal)).toEqual([8, 7, 17, 17, 5])
    expect(pages.every((p) => p.groupEarned === 0)).toBe(true)
  })

  it('页内顺序 = 传入顺序（家长习惯稳定：ACHIEVEMENTS 声明顺序）', () => {
    const all = itemsOf()
    const flat = pages.flatMap((p) => p.items.map((i) => i.id))
    // 期望值也按可收集口径取（不参与收集的彩蛋不会出现在任何一页上）
    const expected = all
      .filter((i) => ['M', 'G', 'B', 'E'].includes(i.category) && isCollectible(i.id))
      .map((i) => i.id)
    expect(flat).toEqual(expected)
  })
})

describe('paginateByCategory — 自定义包进来之后（AC-P2-16 的核心场景）', () => {
  it('B 组加 3 枚自定义 → 20 枚分两页（12+8），页数不变仍是 5', () => {
    // B 组内置 17 枚（night-owl 不参与收集）+ 3 枚自定义 = 20
    const pages = paginateByCategory(itemsOf(defs('B', 3)))
    expect(pages).toHaveLength(5)
    const bPages = pages.filter((p) => p.category === 'B')
    expect(bPages).toHaveLength(2)
    expect(bPages[0].items).toHaveLength(12)
    expect(bPages[1].items).toHaveLength(8)
    expect(bPages[0].groupTotal).toBe(20)
    expect(bPages[0].continued).toBe(false)
    expect(bPages[1].continued).toBe(true)
  })

  it('★ 某组 13 枚 → 该组续页，第二页 continued=true 且只含该组', () => {
    // 用 E 组（内置 5 枚）加 8 枚凑 13，复现"恰好超出容量 1 枚"的续页形态
    const pages = paginateByCategory(itemsOf(defs('E', 8))) // 5 + 8 = 13（满页 12 → 续 1 枚）
    expect(pages.map((p) => p.category)).toEqual(['M', 'G', 'B', 'B', 'E', 'E'])
    const second = pages[5]
    expect(second.category).toBe('E')
    expect(second.continued).toBe(true)
    expect(second.items).toHaveLength(1)
    expect(second.items.every((i) => i.category === 'E')).toBe(true)
    // 同一组的两页报同一个总数，页眉才不会跳
    expect(second.groupTotal).toBe(pages[4].groupTotal)
    expect(second.groupEarned).toBe(pages[4].groupEarned)
  })

  it('续页页码连续、不重编（pageLabel 是渲染层唯一来源）', () => {
    const pages = paginateByCategory(itemsOf(defs('B', 6))) // 17 + 6 = 23 → 仍 5 页（B 12+11）
    const labels = pages.map((_, i) => pageLabel(i, pages.length))
    expect(labels).toEqual(['第 1 / 5 页', '第 2 / 5 页', '第 3 / 5 页', '第 4 / 5 页', '第 5 / 5 页'])
    // 反例：若两页各自算总数，会出现"第 4 / 5 页"与"第 4 / 4 页"并存
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('paginateByCategory — 边界', () => {
  it('空组不产页：只有 M 组就只出 1 页', () => {
    const onlyM = itemsOf().filter((i) => i.category === 'M')
    const pages = paginateByCategory(onlyM)
    expect(pages).toHaveLength(1)
    expect(pages[0].category).toBe('M')
  })

  it('一枚都没有 → 0 页（渲染层据此显示"还没有成就可打印"）', () => {
    expect(paginateByCategory([])).toEqual([])
  })

  it('perPage 为 0 / 负数 / NaN 时按 1 处理（否则 chunk 循环不前进）', () => {
    const items = itemsOf().filter((i) => i.category === 'E') // 5 枚
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pages = paginateByCategory(items, bad)
      expect(pages.length).toBeGreaterThanOrEqual(1)
      expect(pages.every((p) => p.items.length >= 1)).toBe(true)
      expect(pages.reduce((n, p) => n + p.items.length, 0)).toBe(5)
    }
  })

  it('pageLabel 在 total=0 时不产生"第 1 / 0 页"', () => {
    expect(pageLabel(0, 0)).toBe('第 1 / 1 页')
  })
})
