import { describe, expect, it, vi } from 'vitest'

/**
 * 隐藏成就「发现」机制的纯函数测试（V1.3 · P1，2026-10 裁决推翻"P0 不引入随机"）。
 *
 * 这一层要钉住的是**机制的边界**，不是随机本身（随机用注入的 `rand` 完全控制）：
 *   1. 一天最多一次机会，不累积、不补发；
 *   2. 池内等概率（用假随机验证"打到池里每一个"）；
 *   3. 保底 N=5：连续 5 次重复后**第 5 次**必给新线索；
 *   4. 线索文案**不得泄露真实解锁条件**（这是"发现"与"泄底"的分界线）。
 */
vi.mock('@/db', () => ({
  db: { settings: { get: async () => undefined, put: async () => undefined } },
}))

const {
  CLUE_TEXT,
  GUARANTEE_N,
  HIDDEN_POOL,
  canDraw,
  drawDiscovery,
  emptyDiscoveryState,
  grantDailyChance,
  normalizeDiscoveryState,
  remainingUnrevealed,
} = await import('@core/motivation/achievementDiscovery')

const state = (over: Partial<ReturnType<typeof emptyDiscoveryState>> = {}) => ({
  ...emptyDiscoveryState(),
  ...over,
})

describe('normalizeDiscoveryState — 脏数据降级', () => {
  it('非对象 / 版本不对 → 当没玩过', () => {
    expect(normalizeDiscoveryState(null)).toEqual(emptyDiscoveryState())
    expect(normalizeDiscoveryState('x')).toEqual(emptyDiscoveryState())
    expect(normalizeDiscoveryState({ v: 2, chances: 3 })).toEqual(emptyDiscoveryState())
  })

  it('revealed 去重、剔除非字符串；负数与 NaN 归零', () => {
    const s = normalizeDiscoveryState({
      v: 1,
      chances: -2,
      revealed: ['comeback', 'comeback', 3, '', null, 'early-bird'],
      streakWithoutNew: Number.NaN,
      lastGrantDay: 5,
    })
    expect(s.chances).toBe(0)
    expect(s.revealed).toEqual(['comeback', 'early-bird'])
    expect(s.streakWithoutNew).toBe(0)
    expect(s.lastGrantDay).toBe('')
  })

  it('小数向下取整（不会出现半次机会）', () => {
    expect(normalizeDiscoveryState({ v: 1, chances: 2.9 }).chances).toBe(2)
  })
})

describe('grantDailyChance — 一天最多一次，不累积', () => {
  it('第一次发放成功，同一天再发不生效', () => {
    const a = grantDailyChance(state(), '2026-10-20')
    expect(a.granted).toBe(true)
    expect(a.state.chances).toBe(1)
    expect(a.state.lastGrantDay).toBe('2026-10-20')

    const b = grantDailyChance(a.state, '2026-10-20')
    expect(b.granted).toBe(false)
    expect(b.state.chances).toBe(1)
  })

  it('换一天再加一次（但昨天没用掉的不补发）', () => {
    const a = grantDailyChance(state(), '2026-10-20')
    const b = grantDailyChance(a.state, '2026-10-21')
    expect(b.granted).toBe(true)
    // 昨天那次还在（用户没点掉），今天是"多了一次"而不是"补成两次"
    expect(b.state.chances).toBe(2)
  })

  it('日期为空（本地口径算不出来）→ 不发放，避免无限刷', () => {
    expect(grantDailyChance(state(), '').granted).toBe(false)
  })
})

describe('canDraw / remainingUnrevealed', () => {
  it('没有机会 → 不能抽', () => {
    expect(canDraw(state({ chances: 0 }))).toBe(false)
    expect(canDraw(state({ chances: 1 }))).toBe(true)
  })

  it('线索全发现完 → 不能抽（机会留着也没意义）', () => {
    const s = state({ chances: 3, revealed: [...HIDDEN_POOL] })
    expect(remainingUnrevealed(s)).toEqual([])
    expect(canDraw(s)).toBe(false)
  })
})

describe('drawDiscovery — 等概率 + 保底', () => {
  it('没有机会时原样返回，不改状态', () => {
    const s = state({ chances: 0 })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 0)
    expect(r.clueId).toBeNull()
    expect(r.state).toBe(s)
  })

  it('等概率：rand 打到每个区间都能取出对应线索（不做权重）', () => {
    const s = state({ chances: 1 })
    const picks = [
      drawDiscovery(s, HIDDEN_POOL, () => 0).clueId,
      drawDiscovery(s, HIDDEN_POOL, () => 0.5).clueId,
      drawDiscovery(s, HIDDEN_POOL, () => 0.999).clueId,
    ]
    expect(picks).toEqual([...HIDDEN_POOL])
  })

  it('抽到新的 → revealed 增加、保底计数清零、机会 -1', () => {
    const s = state({ chances: 2, streakWithoutNew: 3 })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 0)
    expect(r.wasNew).toBe(true)
    expect(r.state.revealed).toEqual(['comeback'])
    expect(r.state.streakWithoutNew).toBe(0)
    expect(r.state.chances).toBe(1)
  })

  it('抽到重复 → revealed 不变、保底计数 +1', () => {
    const s = state({ chances: 2, revealed: ['comeback'] })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 0) // 池里第一枚 = comeback，已见过
    expect(r.wasNew).toBe(false)
    expect(r.state.revealed).toEqual(['comeback'])
    expect(r.state.streakWithoutNew).toBe(1)
    expect(r.state.chances).toBe(1)
  })

  it('★ 保底：连续 GUARANTEE_N-1 次重复后，第 N 次强制给新线索', () => {
    // 假随机永远指向池里第一枚（comeback，已见过）——没有保底就一定会重复
    const s = state({ chances: 1, revealed: ['comeback'], streakWithoutNew: GUARANTEE_N - 1 })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 0)
    expect(r.wasNew).toBe(true)
    expect(r.clueId).not.toBe('comeback')
    expect(r.state.streakWithoutNew).toBe(0)
  })

  it('保底生效的前一次仍允许重复（不是提前保底）', () => {
    const s = state({ chances: 1, revealed: ['comeback'], streakWithoutNew: GUARANTEE_N - 2 })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 0)
    expect(r.wasNew).toBe(false)
    expect(r.state.streakWithoutNew).toBe(GUARANTEE_N - 1)
  })

  it('池子抽干后再抽 → null，不再扣机会', () => {
    const s = state({ chances: 2, revealed: [...HIDDEN_POOL] })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 0)
    expect(r.clueId).toBeNull()
    expect(r.state.chances).toBe(2)
  })

  it('注入的 rand 返回 1（越界）不会取到 undefined', () => {
    const s = state({ chances: 1 })
    const r = drawDiscovery(s, HIDDEN_POOL, () => 1)
    expect(HIDDEN_POOL).toContain(r.clueId)
  })
})

describe('★ 线索不得泄露真实解锁条件', () => {
  it('线索文案里不出现精确阈值（时间/次数/学科）', () => {
    const all = Object.values(CLUE_TEXT).join(' ')
    for (const leak of ['07:00', '21:00', '≥3', '3 次', '已掌握', '小时']) {
      expect(all, `线索里出现了精确条件「${leak}」，等于直接告诉答案`).not.toContain(leak)
    }
  })

  it('三枚隐藏成就都有线索，且文案互不相同', () => {
    for (const id of HIDDEN_POOL) expect(CLUE_TEXT[id]).toBeTruthy()
    const texts = HIDDEN_POOL.map((id) => CLUE_TEXT[id])
    expect(new Set(texts).size).toBe(HIDDEN_POOL.length)
  })
})

describe('静态接线', () => {
  it('图鉴页用 canDraw / drawDiscovery，且家长开关关掉后整块不渲染', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/views/Achievements.vue', 'utf8')
    expect(page).toContain('canDraw(')
    expect(page).toContain('drawDiscovery(')
    expect(page).toContain('loadDiscoveryEnabled()')
    expect(page).toContain('v-if="discoveryEnabled')
    // 不能因为"抽到了"就直接解锁：页面不该调用任何写解锁记录的接口
    expect(page).not.toContain('saveUnlocked')
  })

  it('家长端有开关，并且写的是同一把键', async () => {
    const { readFileSync } = await import('node:fs')
    const parent = readFileSync('src/views/Parent.vue', 'utf8')
    expect(parent).toContain('saveDiscoveryEnabled')
    expect(parent).toContain('discoveryEnabled')
  })
})
