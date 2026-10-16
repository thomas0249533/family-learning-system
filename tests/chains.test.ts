import { describe, expect, it } from 'vitest'
import { CHAINS, chainNextOf, type ChainDef } from '../src/core/motivation/chains'

describe('chainNextOf — 连环「下一环」', () => {
  const chain: ChainDef = { id: 'x', name: 'X链', ids: ['a', 'b', 'c'] }

  it('未解锁任何环 → null', () => {
    expect(chainNextOf(chain, [])).toBeNull()
  })

  it('解锁首环 → 下一环 = b', () => {
    expect(chainNextOf(chain, ['a'])).toBe('b')
  })

  it('解锁 a,b → 下一环 = c', () => {
    expect(chainNextOf(chain, ['a', 'b'])).toBe('c')
  })

  it('全部解锁 → null', () => {
    expect(chainNextOf(chain, ['a', 'b', 'c'])).toBeNull()
  })

  it('跳环解锁（a,c，最高已解锁=c）→ null', () => {
    expect(chainNextOf(chain, ['a', 'c'])).toBeNull()
  })

  it('乱序传入已解锁 id 不影响结果', () => {
    expect(chainNextOf(chain, ['b', 'a'])).toBe('c')
  })
})

describe('CHAINS — 定义完整性', () => {
  it('共 4 条连环，id 唯一', () => {
    expect(CHAINS).toHaveLength(4)
    const ids = CHAINS.map((c) => c.id)
    expect(new Set(ids).size).toBe(4)
  })

  it('每条连环都有 ≥2 环、名称非空、环序去重', () => {
    for (const c of CHAINS) {
      expect(c.ids.length, `${c.id} 至少 2 环`).toBeGreaterThanOrEqual(2)
      expect(c.name.length).toBeGreaterThan(0)
      expect(new Set(c.ids).size).toBe(c.ids.length)
    }
  })

  it('坚持之链顺序正确：streak-3 → streak-7 → …', () => {
    const streak = CHAINS.find((c) => c.id === 'streak')!
    expect(streak.ids[0]).toBe('streak-3')
    expect(chainNextOf(streak, ['streak-3'])).toBe('streak-7')
    expect(chainNextOf(streak, ['streak-3', 'streak-7'])).toBe('streak-30')
  })
})
