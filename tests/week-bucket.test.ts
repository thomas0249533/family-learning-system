import { describe, expect, it } from 'vitest'
import { groupByWeek, hasMultipleWeeks, resolveWeekOf } from '@core/learning/weekBucket'

/**
 * V2.7 · 轨道 A3 · 「按周分桶」纯函数
 *
 * 这套用例存在的唯一理由：分桶一旦算错，界面上**看不出来**（周号错位仍然渲染得很好看），
 * 所以把"能不能认周号""认错了会不会造桶"全部钉在纯函数层。
 */

describe('resolveWeekOf · 认周号', () => {
  it('显式字段优先：week / weekIndex / weekNo', () => {
    expect(resolveWeekOf({ week: 3 })).toBe(3)
    expect(resolveWeekOf({ weekIndex: 7 })).toBe(7)
    expect(resolveWeekOf({ weekNo: 12 })).toBe(12)
  })

  it('字符串数字也认（JSON 里很常见）', () => {
    expect(resolveWeekOf({ week: '4' })).toBe(4)
  })

  it('标题里带周号也能认：第 5 周 / 第5周 / Week 3', () => {
    expect(resolveWeekOf({ title: '每日一练 · 第 5 周' })).toBe(5)
    expect(resolveWeekOf({ title: '第5周 口算' })).toBe(5)
    expect(resolveWeekOf({ title: 'Daily Week 3' })).toBe(3)
  })

  it('越界/脏值一律当"没声明"，不硬塞成第 0 周或第 99 周', () => {
    expect(resolveWeekOf({ week: 0 })).toBeNull()
    expect(resolveWeekOf({ week: 99 })).toBeNull()
    expect(resolveWeekOf({ week: -2 })).toBeNull()
    expect(resolveWeekOf({ week: 'abc' })).toBeNull()
    expect(resolveWeekOf({ title: '每日一练' })).toBeNull()
  })

  it('空输入不炸', () => {
    expect(resolveWeekOf(null)).toBeNull()
    expect(resolveWeekOf(undefined)).toBeNull()
    expect(resolveWeekOf({})).toBeNull()
  })
})

describe('groupByWeek · 分桶与排序', () => {
  const item = (title: string, week: number | null) => ({ title, week })

  it('按周号升序，"未分周"永远排最后', () => {
    const buckets = groupByWeek([item('c', null), item('a', 2), item('b', 1)])
    expect(buckets.map((b) => b.week)).toEqual([1, 2, null])
    expect(buckets.map((b) => b.label)).toEqual(['第 1 周', '第 2 周', '未分周'])
  })

  it('桶内按标题排序（不依赖入库顺序，进来每次一样）', () => {
    const buckets = groupByWeek([item('乙', 1), item('甲', 1), item('丙', 1)])
    expect(buckets[0].items.map((i) => i.title)).toEqual(['丙', '甲', '乙'])
  })

  it('★ 一个包都没声明周号时只出 1 个桶（绝不按"每 7 个一周"硬切）', () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`包${i}`, null))
    const buckets = groupByWeek(many)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].week).toBeNull()
    expect(buckets[0].items).toHaveLength(9)
    expect(hasMultipleWeeks(many)).toBe(false)
  })

  it('真的多周时 hasMultipleWeeks 为真', () => {
    expect(hasMultipleWeeks([item('a', 1), item('b', 2)])).toBe(true)
  })

  it('空列表 → 空桶列表', () => {
    expect(groupByWeek([])).toEqual([])
    expect(hasMultipleWeeks([])).toBe(false)
  })
})
