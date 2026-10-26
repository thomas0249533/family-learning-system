import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 盲盒抽奖引擎单测（V2.8 · C2）。
 *
 * 三条主线（对应任务单）：
 *   1. 触发判定：三条激励条件逐条正/负 + 每日防刷 + 集齐失效；
 *   2. 抽取保底：必出未拥有、随机源可注入、5 次必集齐；
 *   3. 归一化：脏 JSON 不把抽取逻辑带偏。
 *
 * 时间全部注入（`now`），本地日期口径与生产同源（`localDayKey`）。
 * 存储层用 settings 键替身（与 achievements.test.ts 同款做法）。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const rows: Row[] = []
  return {
    rows,
    settings: {
      async get(k: any) {
        return rows.find((r) => r.key === k)
      },
      async put(r: Row) {
        const i = rows.findIndex((x) => x.key === r.key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return r.key
      },
    },
    __reset() {
      rows.length = 0
    },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const {
  BLIND_BOX_POOL,
  BLIND_BOX_TOTAL,
  BLIND_BOX_THRESHOLDS,
  blindBoxKey,
  drawBlindBox,
  emptyBlindBoxState,
  evaluateBlindBoxTrigger,
  normalizeBlindBoxState,
  performBlindBoxDraw,
  loadBlindBoxState,
  blindBoxDefById,
} = await import('@core/motivation/blindBox')
const { ACHIEVEMENTS } = await import('@core/motivation/achievements')
const { localDayKey } = await import('@core/motivation/streak')

/** 固定"今天"：2026-10-26（周一）本地时区 */
const NOW = new Date(2026, 9, 26, 15, 0, 0)
const TODAY = localDayKey(NOW)
const YESTERDAY = localDayKey(new Date(2026, 9, 25, 15, 0, 0))

const rec = (id: string, unlockedAt: string) => ({ id, unlockedAt })

function baseInput(over: Partial<Record<string, unknown>> = {}) {
  return {
    unlockedRecords: [] as ReturnType<typeof rec>[],
    streak: { current: 0, longest: 0, lastDate: '' },
    dailyStats: [],
    now: NOW,
    state: emptyBlindBoxState(),
    ...over,
  }
}

beforeEach(() => {
  fake.__reset()
})

describe('盲盒成就池（5 枚专属）', () => {
  it('恰好 5 枚，id 唯一，且**不在**普通图鉴里（不参与普通收集）', () => {
    expect(BLIND_BOX_POOL).toHaveLength(5)
    expect(BLIND_BOX_TOTAL).toBe(5)
    const ids = BLIND_BOX_POOL.map((a) => a.id)
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) {
      expect(ACHIEVEMENTS.some((a) => a.id === id), `${id} 不该出现在普通图鉴`).toBe(false)
    }
  })

  it('盲盒成就的 check 恒为 false（日常结算永不误发）', () => {
    for (const def of BLIND_BOX_POOL) {
      expect(def.check({ progress: [], mistakes: [], streak: { current: 0, longest: 0, lastDate: '' } })).toBe(false)
    }
  })

  it('blindBoxDefById：池内 id 可查、未知 id 返回 undefined', () => {
    expect(blindBoxDefById('bb-crown')?.title).toBe('隐藏王冠')
    expect(blindBoxDefById('nope')).toBeUndefined()
  })
})

describe('触发判定（纯函数）', () => {
  it('条件一：单日解锁普通成就 ≥3 → 触发；2 枚不触发', () => {
    const two = baseInput({ unlockedRecords: [rec('first-step', TODAY), rec('ten-kp', TODAY)] })
    expect(evaluateBlindBoxTrigger(two)).toEqual({ available: false, reason: 'none' })

    const three = baseInput({
      unlockedRecords: [rec('first-step', TODAY), rec('ten-kp', TODAY), rec('mistake-first', TODAY)],
    })
    expect(evaluateBlindBoxTrigger(three)).toEqual({ available: true, reason: 'unlocks-today' })
  })

  it('条件一的反例：昨天的 3 枚不算（单日语义）、night-owl 与盲盒 id 不计数', () => {
    // 昨天解锁 5 枚：触发的是"单日"，跨天不算
    const yesterday = baseInput({
      unlockedRecords: [rec('first-step', YESTERDAY), rec('ten-kp', YESTERDAY), rec('mistake-first', YESTERDAY)],
    })
    expect(evaluateBlindBoxTrigger(yesterday)).toEqual({ available: false, reason: 'none' })

    // night-owl（不参与收集的彩蛋）+ 盲盒 id 混在里面：只有 1 枚普通成就，不触发
    const mixed = baseInput({
      unlockedRecords: [
        rec('night-owl', TODAY),
        rec('bb-lucky-star', TODAY),
        rec('bb-moon', TODAY),
        rec('first-step', TODAY),
      ],
    })
    expect(evaluateBlindBoxTrigger(mixed)).toEqual({ available: false, reason: 'none' })
  })

  it('条件二：连续 ≥7 天 → 触发；6 天不触发；昨日打卡今日有宽限（effectiveCurrent 口径）', () => {
    const six = baseInput({ streak: { current: 6, longest: 6, lastDate: YESTERDAY } })
    expect(evaluateBlindBoxTrigger(six)).toEqual({ available: false, reason: 'none' })

    // lastDate = 昨天：今天还没学，但宽限口径下 current 仍算数
    const seven = baseInput({ streak: { current: 7, longest: 7, lastDate: YESTERDAY } })
    expect(evaluateBlindBoxTrigger(seven)).toEqual({ available: true, reason: 'streak' })

    // 断签两天以上：哪怕历史最长 100 天也不触发
    const broken = baseInput({
      streak: { current: 7, longest: 100, lastDate: localDayKey(new Date(2026, 9, 20)) },
    })
    expect(evaluateBlindBoxTrigger(broken)).toEqual({ available: false, reason: 'none' })
  })

  it('条件三：单日专注 ≥60 分钟 → 触发；59 分钟不触发；只认今天那行', () => {
    const days = (minutes: number) => [
      { date: YESTERDAY, questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 120 },
      { date: TODAY, questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: minutes },
    ]
    const under = baseInput({ dailyStats: days(59) })
    expect(evaluateBlindBoxTrigger(under)).toEqual({ available: false, reason: 'none' })

    const over = baseInput({ dailyStats: days(60) })
    expect(evaluateBlindBoxTrigger(over)).toEqual({ available: true, reason: 'focus' })
  })

  it('每日防刷：今天抽过 → 不触发（哪怕三条条件全满足）', () => {
    const all = baseInput({
      unlockedRecords: [rec('first-step', TODAY), rec('ten-kp', TODAY), rec('mistake-first', TODAY)],
      streak: { current: 7, longest: 7, lastDate: YESTERDAY },
      dailyStats: [{ date: TODAY, questionCount: 1, firstStudyAt: 0, lastStudyAt: 0, focusMinutes: 60 }],
      state: { owned: [], usedDays: [TODAY] },
    })
    expect(evaluateBlindBoxTrigger(all)).toEqual({ available: false, reason: 'used-today' })
  })

  it('集齐 5 枚 → 系统失效（reason: complete，比防刷优先级更高）', () => {
    const complete = baseInput({
      state: { owned: BLIND_BOX_POOL.map((a) => a.id), usedDays: [YESTERDAY] },
    })
    expect(evaluateBlindBoxTrigger(complete)).toEqual({ available: false, reason: 'complete' })

    // 集齐 + 今天也没抽过：仍然是 complete（不是 used-today / none）
    expect(evaluateBlindBoxTrigger(complete).reason).toBe('complete')
  })

  it('阈值常量与任务单一致（3 / 7 / 60）', () => {
    expect(BLIND_BOX_THRESHOLDS.UNLOCKS_TODAY).toBe(3)
    expect(BLIND_BOX_THRESHOLDS.STREAK_DAYS).toBe(7)
    expect(BLIND_BOX_THRESHOLDS.FOCUS_MINUTES).toBe(60)
  })
})

describe('抽取（保底必出未拥有）', () => {
  it('每次抽取必出一个未拥有的盲盒成就，且状态记录 owned + usedDays', () => {
    let state = emptyBlindBoxState()
    const drawn: string[] = []
    for (let i = 0; i < 5; i += 1) {
      // 每天抽一次：防刷锚点记在抽取时，同一天抽不了第二次
      const day = new Date(2026, 9, 26 + i, 15, 0, 0)
      const r = drawBlindBox(state, day, () => 0.5)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(BLIND_BOX_POOL.some((a) => a.id === r.id)).toBe(true)
        expect(state.owned, '抽前不包含').not.toContain(r.id)
        drawn.push(r.id)
        state = r.state
      }
    }
    // 5 次全部不同（保底 = 必出未拥有 → 5 次必集齐）
    expect(new Set(drawn).size).toBe(5)
    expect(state.owned).toHaveLength(5)
    expect(state.usedDays).toHaveLength(5)
  })

  it('同一天第二次抽取被拒（防刷锚点记在抽取时）', () => {
    const first = drawBlindBox(emptyBlindBoxState(), NOW, () => 0)
    expect(first.ok).toBe(true)
    const second = drawBlindBox(first.ok ? first.state : emptyBlindBoxState(), NOW, () => 0)
    expect(second).toEqual({ ok: false, reason: 'used-today' })
  })

  it('第二天可以再抽（防刷只限当天），日期累积', () => {
    const first = drawBlindBox(emptyBlindBoxState(), NOW, () => 0)
    expect(first.ok).toBe(true)
    const tomorrow = new Date(2026, 9, 27, 9, 0, 0)
    const second = drawBlindBox(first.ok ? first.state : emptyBlindBoxState(), tomorrow, () => 0)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.state.usedDays).toEqual([TODAY, localDayKey(tomorrow)])
      expect(second.state.owned).toHaveLength(2)
    }
  })

  it('全部拥有后抽取返回 all-owned（双保险：触发层已隐藏）', () => {
    const full = { owned: BLIND_BOX_POOL.map((a) => a.id), usedDays: [] }
    expect(drawBlindBox(full, NOW)).toEqual({ ok: false, reason: 'all-owned' })
  })

  it('随机源可注入：确定性序列决定开出哪一枚；异常随机值不炸', () => {
    const a = drawBlindBox(emptyBlindBoxState(), NOW, () => 0)
    const b = drawBlindBox(emptyBlindBoxState(), NOW, () => 0.999)
    expect(a.ok && b.ok && a.id).not.toBe(b.ok && b.id)
    // NaN / 负数 / 越界：兜底不抛错
    for (const bad of [Number.NaN, -1, 2, Number.POSITIVE_INFINITY]) {
      const r = drawBlindBox(emptyBlindBoxState(), NOW, () => bad)
      expect(r.ok).toBe(true)
    }
  })
})

describe('归一化与存储', () => {
  it('脏 JSON：非对象 / 非法 owned id / 非法日期全部丢弃，绝不带偏抽取逻辑', () => {
    expect(normalizeBlindBoxState(null)).toEqual(emptyBlindBoxState())
    expect(normalizeBlindBoxState('junk')).toEqual(emptyBlindBoxState())
    expect(
      normalizeBlindBoxState({
        owned: ['bb-lucky-star', 'not-in-pool', 'bb-lucky-star', 42],
        usedDays: [TODAY, '2026/10/25', 'garbage', 123],
      }),
    ).toEqual({ owned: ['bb-lucky-star'], usedDays: [TODAY] })
  })

  it('performBlindBoxDraw：一次抽取得同时落盲盒状态与成就记录', async () => {
    const def = await performBlindBoxDraw(NOW, () => 0)
    expect(def).toBeTruthy()
    expect(def!.id).toBe('bb-lucky-star') // rand=0 → 0 号

    // 盲盒状态键
    const state = await loadBlindBoxState()
    expect(state.owned).toEqual(['bb-lucky-star'])
    expect(state.usedDays).toEqual([TODAY])

    // 成就解锁记录（同键合并、不可撤销原则照用）
    const { loadUnlocked } = await import('@core/motivation/achievements')
    const records = await loadUnlocked()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: 'bb-lucky-star', unlockedAt: TODAY, evidence: '从盲盒中开出' })

    // 落库键必须带档案后缀
    expect(blindBoxKey()).toBe('blindBox:default')
  })

  it('performBlindBoxDraw：当天第二次返回 null，不重复落库', async () => {
    await performBlindBoxDraw(NOW, () => 0)
    const again = await performBlindBoxDraw(NOW, () => 0.9)
    expect(again).toBeNull()
    const state = await loadBlindBoxState()
    expect(state.owned).toHaveLength(1)
  })
})
