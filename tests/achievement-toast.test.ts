import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, type AchievementDef } from '@core/motivation/achievements'
import {
  MERGE_THRESHOLD,
  MERGED_ID,
  mergeUnlocksForToast,
  mergedRepresentative,
  tierRankOf,
  tierRankTable,
} from '@core/motivation/achievementToast'

/**
 * 解锁提示合并规则测试（V1.3 · AC-07）
 *
 * 规则：**≥4 枚合并成一条**，图标取层级最高那枚。
 * 这条规则只能在真机上看出效果，但规则本身是纯函数，所以边界（3/4 枚、层级相同、
 * 空输入、脏输入）全部在 node 里穷举，e2e 只验"真的只弹了一条"。
 */

const byId = (id: string): AchievementDef => ACHIEVEMENTS.find((a) => a.id === id)!

/** 常/进/稀/隐 各一枚，便于验证"取最高层级" */
const common = byId('first-step') // 常见
const advanced = byId('ten-kp') // 进阶
const rare = byId('fifty-kp') // 稀有
const hidden = byId('comeback') // 隐藏

describe('阈值', () => {
  it('阈值是 4（PRD §6.3「超过 3 枚」）', () => {
    expect(MERGE_THRESHOLD).toBe(4)
  })

  it('1–3 枚逐条播放，顺序与输入一致', () => {
    for (const n of [1, 2, 3]) {
      const input = [common, advanced, rare].slice(0, n)
      const out = mergeUnlocksForToast(input)
      expect(out).toHaveLength(n)
      expect(out.map((d) => d.id)).toEqual(input.map((d) => d.id))
      expect(out.some((d) => d.id === MERGED_ID)).toBe(false)
    }
  })

  it('4 枚起合并成一条', () => {
    for (const n of [4, 5, 8]) {
      const input = Array.from({ length: n }, () => common)
      // 用不同 id 构造，避免"同一枚重复"这种非法输入干扰断言
      const distinct = ACHIEVEMENTS.slice(0, n)
      expect(input.length).toBe(n)
      const out = mergeUnlocksForToast(distinct)
      expect(out).toHaveLength(1)
      expect(out[0].id).toBe(MERGED_ID)
      expect(out[0].title).toBe(`解锁 ${n} 枚新成就`)
    }
  })
})

describe('合并提示的内容', () => {
  const four = [common, advanced, rare, hidden]

  it('图标取层级最高那一枚（隐藏 > 稀有 > 进阶 > 常见）', () => {
    // 注意：低于阈值不合并，所以每个用例都凑够 4 枚
    expect(mergeUnlocksForToast(four)[0].icon).toBe(hidden.icon)
    expect(mergeUnlocksForToast([common, advanced, rare, common])[0].icon).toBe(rare.icon)
    expect(mergeUnlocksForToast([common, advanced, common, common])[0].icon).toBe(advanced.icon)
    expect(mergeUnlocksForToast([common, common, common, common])[0].icon).toBe(common.icon)
  })

  it('描述列出前 3 个标题并加「等」', () => {
    const desc = mergeUnlocksForToast(four)[0].desc
    expect(desc).toContain(common.title)
    expect(desc).toContain(advanced.title)
    expect(desc).toContain(rare.title)
    expect(desc).not.toContain(hidden.title) // 第 4 个被"等"掉
    expect(desc.endsWith('等')).toBe(true)
  })

  it('合成项信息不丢失：仍然只是一条展示项，真实记录由「已获得」区承载', () => {
    const out = mergeUnlocksForToast(four)
    expect(out).toHaveLength(1)
    // 合成项不属于 28 枚中的任何一枚
    expect(ACHIEVEMENTS.some((a) => a.id === out[0].id)).toBe(false)
    // 且它的 check 永远 true（只用于展示，不会被结算读取）
    expect(out[0].check({ progress: [], mistakes: [], streak: { current: 0, longest: 0, lastDate: '' } })).toBe(true)
  })
})

describe('鲁棒性', () => {
  it('空数组 / null / undefined → 空结果（不抛错）', () => {
    expect(mergeUnlocksForToast([])).toEqual([])
    expect(mergeUnlocksForToast(null)).toEqual([])
    expect(mergeUnlocksForToast(undefined)).toEqual([])
  })

  it('过滤掉数组里的空洞', () => {
    const out = mergeUnlocksForToast([common, null as any, advanced])
    expect(out.map((d) => d.id)).toEqual([common.id, advanced.id])
  })

  it('不改动入参数组', () => {
    const input = [common, advanced, rare, hidden]
    const snapshot = [...input]
    mergeUnlocksForToast(input)
    expect(input).toEqual(snapshot)
  })
})

describe('层级权重表', () => {
  it('常见 1 < 进阶 2 < 稀有 3 < 隐藏 4', () => {
    expect(tierRankOf('first-step')).toBe(1)
    expect(tierRankOf('ten-kp')).toBe(2)
    expect(tierRankOf('fifty-kp')).toBe(3)
    expect(tierRankOf('comeback')).toBe(4)
  })

  it('38 枚都有权重，且没有 0', () => {
    const table = tierRankTable()
    expect(Object.keys(table)).toHaveLength(38)
    for (const [id, rank] of Object.entries(table)) expect(rank, id).toBeGreaterThan(0)
  })

  it('未知 id 退化为「常见」权重（不返回 0，避免排序时沉底）', () => {
    expect(tierRankOf('no-such-id')).toBe(tierRankOf('first-step'))
  })

  it('mergedRepresentative 返回代表项；空输入返回 null', () => {
    expect(mergedRepresentative([common, rare])?.id).toBe(rare.id)
    expect(mergedRepresentative([])).toBeNull()
  })
})
