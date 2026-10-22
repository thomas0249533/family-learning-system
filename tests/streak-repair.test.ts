import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDexie } from './helpers/fakeDexie'
import { ctx } from './achievement-fixtures'

/**
 * 连续天数补签（V1.6 · Stage C · C5 / PRD §11.1 + §11.6）
 * ---------------------------------------------------------------------------
 * 这一组测试守的是四件事，顺序即重要性：
 *  1. **不许凭空补签**：没有家长确认就一个字节都不写库（hard gate）；
 *  2. **只补昨天**：`diff === 2` 之外一律拒绝（今天已学 / 昨天学过 / 断了 ≥2 天）；
 *  3. **额度**：本地自然月 1 次，第 2 次拒，跨月自动重置；
 *  4. **一致性**：`longest` 不得低于"实际发生过的最长连续"（否则徽章判定会自相矛盾）。
 *
 * 假库用 `tests/helpers/fakeDexie.ts`（单一真相）：`settings` 表的访问语义与真库一致，
 * 并且记录 `writes` —— "不该写库时一个字节都不写"这类断言只能靠它。
 *
 * ⚠️ 补签计数**与打卡状态同一行**（`studyStreak:<pid>` 的 `repair` 字段），
 * 不是独立的 settings 键。理由见 `src/core/motivation/streak.ts` 的 `StreakState.repair`：
 * settings 键表是迁移 / 合并 / 导出的唯一真相，新开一个键要连带登记合并语义并改三处
 * 门禁断言，而月度额度是"本机的便利额度"而非孩子的事实数据。
 */
const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const {
  EMPTY_REPAIR,
  REPAIR_QUOTA_PER_MONTH,
  bestStreak,
  loadRepair,
  loadStreak,
  localDayKey,
  localMonthKey,
  missedYesterday,
  repairLeft,
  repairYesterday,
  saveRepair,
  streakText,
  touchStudyDay,
} = await import('@core/motivation/streak')
const { evaluateAchievements } = await import('@core/motivation/achievements')

/** 固定"现在"：2026-10-15 20:30 本地。所有固定日期用例都相对它算 */
const NOW = new Date(2026, 9, 15, 20, 30)

/** 相对 `base` 往前 n 天的本地日期键 */
const keyOf = (n: number, base: Date = NOW): string =>
  localDayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() - n))

/**
 * 直接往 settings 表塞一行（**不走 put**）。
 *
 * 为什么不用 `fake.settings.put`：本文件多处要断言"全程一个字节都没写"，
 * 用 put 造夹具会把 `writes` 弄脏，让那条断言失去判别力。
 */
function seedStreak(value: Record<string, unknown>, profileId = 'default'): void {
  fake.settings.rows.push({ key: `studyStreak:${profileId}`, value })
}

const storedStreak = (profileId = 'default'): Record<string, unknown> =>
  fake.settings.rows.find((r) => r.key === `studyStreak:${profileId}`)?.value

beforeEach(() => {
  fake.__reset()
})

// ===========================================================================
// 1. 第一道闸：家长确认
// ===========================================================================
describe('补签 · 第一道闸（家长作证）', () => {
  it('★ 无家长确认 → 拒绝 no-parent-consent，且一个字都不写库', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(2) })

    const res = await repairYesterday({ confirmedByParent: false, now: NOW })

    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('no-parent-consent')
    // 库里的行一字未动（连"顺手修一下"都没有）
    expect(fake.writes).toEqual([])
    expect(fake.settings.rows).toHaveLength(1)
    expect(storedStreak()).toEqual({ current: 5, longest: 5, lastDate: keyOf(2) })
    // 额度也一丝没扣
    expect(repairLeft(await loadRepair(), NOW)).toBe(REPAIR_QUOTA_PER_MONTH)
  })

  it('拒绝时把"当前状态"原样带出来（页面可以据此刷新而不必再读一次库）', async () => {
    const lastDate = keyOf(2)
    seedStreak({ current: 5, longest: 8, lastDate })

    const res = await repairYesterday({ confirmedByParent: false, now: NOW })

    expect(res.streak).toEqual({ current: 5, longest: 8, lastDate })
  })
})

// ===========================================================================
// 2. 适用范围：只补「昨天」
// ===========================================================================
describe('补签 · 只补昨天（diff === 2）', () => {
  it('missedYesterday 判据：只有 diff===2 为真', () => {
    expect(missedYesterday({ current: 3, longest: 3, lastDate: keyOf(0) }, NOW)).toBe(false)
    expect(missedYesterday({ current: 3, longest: 3, lastDate: keyOf(1) }, NOW)).toBe(false)
    expect(missedYesterday({ current: 3, longest: 3, lastDate: keyOf(2) }, NOW)).toBe(true)
    expect(missedYesterday({ current: 3, longest: 3, lastDate: keyOf(3) }, NOW)).toBe(false)
    expect(missedYesterday({ current: 0, longest: 0, lastDate: '' }, NOW)).toBe(false)
  })

  it('今天已学（diff=0）→ 拒绝 not-missed-yesterday', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(0) })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('not-missed-yesterday')
    expect(fake.writes).toEqual([])
  })

  it('昨天学过（diff=1，连续还活着）→ 拒绝，不许拿来"多加一天"', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(1) })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('not-missed-yesterday')
    expect(fake.writes).toEqual([])
  })

  it('★ 断了 2 天（diff=3）→ 拒绝（PRD：断 ≥2 天不补）', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(3) })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('not-missed-yesterday')
    expect(fake.writes).toEqual([])
  })

  it('从来没有记录（lastDate 空）→ no-record（补签没有可续的对象）', async () => {
    seedStreak({ current: 0, longest: 0, lastDate: '' })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('no-record')
    expect(fake.writes).toEqual([])
  })
})

// ===========================================================================
// 3. 成功路径
// ===========================================================================
describe('补签 · 成功路径', () => {
  it('★ diff=2 且额度未用 → current+1、lastDate=昨天、longest 不降', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(2) })

    const res = await repairYesterday({ confirmedByParent: true, now: NOW })

    expect(res.repaired).toBe(true)
    expect(res.reason).toBeUndefined()
    expect(res.streak.current).toBe(6)
    expect(res.streak.lastDate).toBe(keyOf(1)) // = 昨天
    expect(res.streak.longest).toBeGreaterThanOrEqual(6)

    // 落库形状：streak 与额度在**同一个 put** 里（一次 writes）
    expect(fake.writes).toEqual(['put:settings'])
    expect(storedStreak()).toMatchObject({
      current: 6,
      lastDate: keyOf(1),
      repair: { month: '2026-10', used: 1 },
    })

    // 补完之后"昨天学过"成立 → 展示口径恢复成 6 天，且不再提示可补签
    const after = await loadStreak()
    expect(after.current).toBe(6)
    expect(missedYesterday(after, NOW)).toBe(false)
    expect(repairLeft(await loadRepair(), NOW)).toBe(0)
  })

  it('longest 已经更高时不被拉低（历史最长只增不减）', async () => {
    seedStreak({ current: 2, longest: 30, lastDate: keyOf(2) })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.streak.current).toBe(3)
    expect(res.streak.longest).toBe(30)
  })

  it('★ 一致性不变量：bestStreak 不会自相矛盾（longest ≥ 实际最长）', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(2) })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    // 补签后"我连过 6 天"这件事必须同时体现在 current 与 longest 上，
    // 否则一旦断签，bestStreak 会掉回 5，与孩子记着的 6 天对不上（§11.6 第 2 条）。
    expect(res.streak.longest).toBeGreaterThanOrEqual(res.streak.current)
    expect(bestStreak(res.streak, NOW)).toBe(6)
  })
})

// ===========================================================================
// 4. 额度：每月 1 次
// ===========================================================================
describe('补签 · 每月 1 次', () => {
  it('★ 同月第二次 → 拒绝 quota-used，且不写库', async () => {
    seedStreak({
      current: 5,
      longest: 5,
      lastDate: keyOf(2),
      repair: { month: '2026-10', used: 1 },
    })

    const res = await repairYesterday({ confirmedByParent: true, now: NOW })

    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('quota-used')
    expect(fake.writes).toEqual([])
  })

  it('★ 真实顺序：第一次成功，同月再漏一天也不给第二次', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(2) })

    expect((await repairYesterday({ confirmedByParent: true, now: NOW })).repaired).toBe(true)

    // 孩子又漏了一天（把 lastDate 拨回前天，模拟"这个月再一次漏记"）
    const row = fake.settings.rows[0]
    row.value = { ...row.value, lastDate: keyOf(2) }
    fake.writes.length = 0

    const second = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(second.repaired).toBe(false)
    expect(second.reason).toBe('quota-used')
    expect(fake.writes).toEqual([])
  })

  it('跨月自动重置：上月已用满，本月首次 → 成功，且计数记在本月', async () => {
    seedStreak({
      current: 5,
      longest: 5,
      lastDate: keyOf(2),
      repair: { month: '2026-09', used: 1 },
    })
    expect(repairLeft(await loadRepair(), NOW)).toBe(1)

    const res = await repairYesterday({ confirmedByParent: true, now: NOW })

    expect(res.repaired).toBe(true)
    expect(storedStreak()?.repair).toEqual({ month: '2026-10', used: 1 })
  })

  it('repairLeft 口径：空计数 = 满额，别的月份 = 满额', () => {
    expect(repairLeft(EMPTY_REPAIR, NOW)).toBe(REPAIR_QUOTA_PER_MONTH)
    expect(repairLeft({ month: '2026-09', used: 1 }, NOW)).toBe(REPAIR_QUOTA_PER_MONTH)
    expect(repairLeft({ month: '2026-10', used: 1 }, NOW)).toBe(0)
    // 脏值（负数 / NaN / 超额）都不该算出负数额度
    expect(repairLeft({ month: '2026-10', used: -3 }, NOW)).toBe(REPAIR_QUOTA_PER_MONTH)
    expect(repairLeft({ month: '2026-10', used: Number.NaN }, NOW)).toBe(REPAIR_QUOTA_PER_MONTH)
    expect(repairLeft({ month: '2026-10', used: 99 }, NOW)).toBe(0)
  })
})

// ===========================================================================
// 5. 本地自然月口径（东八区血泪坑的守门人）
// ===========================================================================
describe('补签 · 额度按本地自然月计（禁用 UTC）', () => {
  /*
   * 为什么单独守这一条：`new Date(2026, 10, 1, 0, 30)` 是**本地 11 月 1 日凌晨**，
   * 而它的 `toISOString()` 是 `2026-10-31T16:30:00Z` —— UTC 还在 10 月。
   * 一旦用 `toISOString().slice(0,7)` 算月份，这个时刻会被算成「10 月」：
   * 家长在 11 月 1 日凌晨补签时，会被当成"10 月额度已用"而拒掉，
   * 或者反过来把 10 月的额度再扣一次。月初/月末各错一遍，且不报错。
   */
  const MONTH_EDGE = new Date(2026, 10, 1, 0, 30)

  it('★ localMonthKey 取本地月；同一时刻的 toISOString 在 10 月', () => {
    expect(localMonthKey(MONTH_EDGE)).toBe('2026-11')
    expect(MONTH_EDGE.toISOString().slice(0, 7)).toBe('2026-10') // 证明这个时刻真的会踩坑
  })

  it('跨年边界同样按本地月', () => {
    expect(localMonthKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12')
    expect(localMonthKey(new Date(2027, 0, 1, 0, 0))).toBe('2027-01')
  })

  it('★ 上月用满 + 本地已跨月 → 能补，且额度记在 11 月（UTC 口径会误判为配额用尽）', async () => {
    // 最后记录 2026-10-30 → 相对 11-01 是 diff=2，正好是"昨天（10-31）漏了"
    seedStreak({
      current: 3,
      longest: 3,
      lastDate: '2026-10-30',
      repair: { month: '2026-10', used: 1 },
    })

    expect(repairLeft(await loadRepair(), MONTH_EDGE)).toBe(1)

    const res = await repairYesterday({ confirmedByParent: true, now: MONTH_EDGE })

    expect(res.repaired).toBe(true)
    expect(res.streak.lastDate).toBe('2026-10-31') // 昨天是 10-31，不是 UTC 的"今天"
    expect(res.streak.current).toBe(4)
    expect(storedStreak()?.repair).toEqual({ month: '2026-11', used: 1 })
  })
})

// ===========================================================================
// 6. 档案隔离
// ===========================================================================
describe('补签 · 档案隔离（不准串孩子）', () => {
  it('★ default 补签后，老二的天数与额度完全不变', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: keyOf(2) }, 'default')
    seedStreak(
      { current: 9, longest: 12, lastDate: keyOf(2), repair: { month: '2026-10', used: 1 } },
      'erwa',
    )

    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(true)

    const erwa = await loadStreak('erwa')
    expect(erwa.current).toBe(9)
    expect(erwa.longest).toBe(12)
    expect(erwa.lastDate).toBe(keyOf(2))
    expect(erwa.repair).toEqual({ month: '2026-10', used: 1 })
    expect(repairLeft(await loadRepair('erwa'), NOW)).toBe(0)
    // 老二的额度用尽是它自己的事，不影响 default 的判定
    expect(storedStreak('erwa')?.repair).toEqual({ month: '2026-10', used: 1 })
  })
})

// ===========================================================================
// 7. 同一行的两个附带约束
// ===========================================================================
describe('补签 · 与打卡同存一行的约束', () => {
  it('★ touchStudyDay 不会把当月额度悄悄回满', async () => {
    seedStreak({
      current: 5,
      longest: 5,
      lastDate: keyOf(1),
      repair: { month: '2026-10', used: 1 },
    })

    const next = await touchStudyDay(NOW)

    expect(next.current).toBe(6)
    expect(repairLeft(await loadRepair(), NOW)).toBe(0)
  })

  it('saveRepair 只改额度，不动打卡字段', async () => {
    seedStreak({ current: 7, longest: 9, lastDate: keyOf(1) })

    await saveRepair({ month: '2026-10', used: 1 })

    const s = await loadStreak()
    expect(s.current).toBe(7)
    expect(s.longest).toBe(9)
    expect(s.lastDate).toBe(keyOf(1))
    expect(s.repair).toEqual({ month: '2026-10', used: 1 })
  })
})

// ===========================================================================
// 8. 文案
// ===========================================================================
describe('补签 · 首页文案（streakText 第三参）', () => {
  const missed: { current: number; longest: number; lastDate: string } = {
    current: 5,
    longest: 5,
    lastDate: keyOf(2),
  }

  it('★ 昨天漏了 + 还有额度 → PRD 原文照抄', () => {
    expect(streakText(missed, NOW, 1)).toBe('昨天漏学啦，可请家长补签 1 次（本月还剩 1 次）')
  })

  it('额度用尽 → 回落到"来打卡吧"，不新造责备措辞', () => {
    expect(streakText(missed, NOW, 0)).toBe('今天还没开始，来打卡吧')
    expect(streakText(missed, NOW)).toBe('今天还没开始，来打卡吧')
  })

  it('不是"昨天漏了"时，额度不改变文案（老行为逐字节不变）', () => {
    expect(streakText({ current: 3, longest: 3, lastDate: keyOf(1) }, NOW, 1)).toContain('续上')
    expect(streakText({ current: 3, longest: 3, lastDate: keyOf(0) }, NOW, 1)).toBe(
      '已连续学习 3 天',
    )
    expect(streakText({ current: 0, longest: 0, lastDate: '' }, NOW, 1)).toBe(
      '今天还没开始，来打卡吧',
    )
    // 断了 ≥2 天不可补 → 文案里也不该出现"补签"二字（否则家长会去点一个点不动的按钮）
    expect(streakText({ current: 3, longest: 3, lastDate: keyOf(3) }, NOW, 1)).not.toContain(
      '补签',
    )
  })
})

// ===========================================================================
// 9. 补签解锁边界（跨模块：streak → achievements）
// ===========================================================================
describe('补签 · 只解锁连续天数类成就', () => {
  /*
   * 构造：`current/longest = 2` 且"昨天漏了" → `bestStreak = 2`，`streak-3` 差 1。
   * 补签后 `current/longest = 3` → `bestStreak = 3`，`streak-3` 达标。
   *
   * 用**真实今天**造夹具（不走固定的 NOW）：成就的 `check` 调 `bestStreak(ctx.streak)`
   * 用的是真实 `new Date()`，固定到未来日期会让 `effectiveCurrent` 归零，测不到想看的东西。
   */
  const TODAY = new Date()
  const day = (n: number): string =>
    localDayKey(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n))

  it('★ 补签把 bestStreak 从 2 抬到 3 → 只新解锁 streak-3，题量/时段类一个不动', async () => {
    seedStreak({ current: 2, longest: 2, lastDate: day(2) })

    const before = evaluateAchievements(ctx({ streak: await loadStreak() }))
    expect(before).not.toContain('streak-3')

    const res = await repairYesterday({ confirmedByParent: true, now: TODAY })
    expect(res.repaired).toBe(true)

    const after = evaluateAchievements(ctx({ streak: await loadStreak() }))

    expect(after).toContain('streak-3')
    // 差额恰好是 streak-3 一枚 —— 补签不该顺手点亮任何别的东西
    expect(after.filter((id: string) => !before.includes(id))).toEqual(['streak-3'])

    /*
     * 依赖题量 / 时段的成就：补签**不写 dailyStats**，所以它们的输入一个字都没变。
     * 这是"补签不得借机解锁 daily-20 / early-bird / night-owl"（PRD §11.6 第 4 条）
     * 的结构性保证 —— 不是"记得别解锁"，而是"没有可写的入口"。
     */
    for (const id of ['daily-20', 'early-bird', 'night-owl']) {
      expect(after.includes(id), `${id} 不该因补签被解锁`).toBe(false)
      expect(after.includes(id)).toBe(before.includes(id))
    }
  })

  it('补签不改 dailyStats（题量/时段类成就的输入）', async () => {
    seedStreak({ current: 2, longest: 2, lastDate: day(2) })
    await repairYesterday({ confirmedByParent: true, now: TODAY })
    const dailyRows = fake.settings.rows.filter((r) => String(r.key).startsWith('dailyStats'))
    expect(dailyRows).toEqual([])
  })
})

// ===========================================================================
// 10. 不抛异常
// ===========================================================================
describe('补签 · 畸形数据不炸（返回拒绝而不是 throw）', () => {
  it('lastDate 是乱码 → 拒绝，不抛', async () => {
    seedStreak({ current: 5, longest: 5, lastDate: '乱码' })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('not-missed-yesterday')
    expect(fake.writes).toEqual([])
  })

  it('current=NaN / longest=-1 但真的漏了一天 → 按 0 处理，不产出 NaN', async () => {
    seedStreak({ current: Number.NaN, longest: -1, lastDate: keyOf(2) })

    const res = await repairYesterday({ confirmedByParent: true, now: NOW })

    expect(res.repaired).toBe(true)
    expect(Number.isFinite(res.streak.current)).toBe(true)
    expect(Number.isFinite(res.streak.longest)).toBe(true)
    expect(res.streak.current).toBe(1)
    expect(res.streak.longest).toBe(1)
  })

  it('整行 value 不是对象 → 当作没有记录（no-record），不抛', async () => {
    fake.settings.rows.push({ key: 'studyStreak:default', value: 'not-an-object' })
    const res = await repairYesterday({ confirmedByParent: true, now: NOW })
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('no-record')
  })
})
