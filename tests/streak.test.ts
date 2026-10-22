import { describe, expect, it } from 'vitest'
import {
  effectiveCurrent,
  EMPTY_STREAK,
  localDayKey,
  streakText,
  studiedToday,
  type StreakState,
} from '@core/motivation/streak'

const NOW = new Date(2026, 9, 15, 20, 30) // 2026-10-15 20:30 本地时间
const keyOf = (n: number) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n)
  return localDayKey(d)
}

const streak = (o: Partial<StreakState>): StreakState => ({ ...EMPTY_STREAK, ...o })

describe('localDayKey — 用本地日期，不用 UTC', () => {
  it('格式为 YYYY-MM-DD', () => {
    expect(localDayKey(NOW)).toBe('2026-10-15')
  })

  it('★ 晚上打卡不会被算成第二天（toISOString 会，这是老实现的隐患）', () => {
    const evening = new Date(2026, 9, 15, 23, 30)
    expect(localDayKey(evening)).toBe('2026-10-15')
  })

  it('清晨打卡也是当天', () => {
    expect(localDayKey(new Date(2026, 9, 15, 0, 5))).toBe('2026-10-15')
  })

  it('跨月/跨年正确补零', () => {
    expect(localDayKey(new Date(2026, 0, 3))).toBe('2026-01-03')
    expect(localDayKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('E1-a 指定三边界：20:00 / 23:59 / 00:01', () => {
    // 用本地构造（new Date(y,m,d,h)），任何时区下断言语义一致
    expect(localDayKey(new Date(2026, 9, 15, 20, 0))).toBe('2026-10-15')
    expect(localDayKey(new Date(2026, 9, 15, 23, 59))).toBe('2026-10-15')
    expect(localDayKey(new Date(2026, 9, 16, 0, 1))).toBe('2026-10-16')
  })
})

describe('studiedToday', () => {
  it('今天打过卡 → true', () => {
    expect(studiedToday(streak({ lastDate: keyOf(0), current: 4 }), NOW)).toBe(true)
  })

  it('昨天打的卡 → false', () => {
    expect(studiedToday(streak({ lastDate: keyOf(1), current: 4 }), NOW)).toBe(false)
  })
})

describe('effectiveCurrent — 展示口径', () => {
  it('没有记录 → 0', () => {
    expect(effectiveCurrent(EMPTY_STREAK, NOW)).toBe(0)
  })

  it('今天已打卡 → 显示当前连续天数', () => {
    expect(effectiveCurrent(streak({ lastDate: keyOf(0), current: 6 }), NOW)).toBe(6)
  })

  it('★ 今天还没打卡但昨天打过 → 仍显示原值（还有机会续上，不打击人）', () => {
    expect(effectiveCurrent(streak({ lastDate: keyOf(1), current: 6 }), NOW)).toBe(6)
  })

  it('★ 断了两天以上 → 归零', () => {
    expect(effectiveCurrent(streak({ lastDate: keyOf(2), current: 6 }), NOW)).toBe(0)
    expect(effectiveCurrent(streak({ lastDate: keyOf(30), current: 6 }), NOW)).toBe(0)
  })
})

describe('streakText — 文案不能有打击感', () => {
  it('从未学习 → 邀请式文案', () => {
    expect(streakText(EMPTY_STREAK, NOW)).toContain('打卡')
  })

  it('今天已打卡 → 正向陈述', () => {
    expect(streakText(streak({ lastDate: keyOf(0), current: 3 }), NOW)).toBe('已连续学习 3 天')
  })

  it('今天未打卡但未断 → 温和提醒，而不是责备', () => {
    const text = streakText(streak({ lastDate: keyOf(1), current: 3 }), NOW)
    expect(text).toContain('续上')
    expect(text).not.toContain('失败')
    expect(text).not.toContain('断')
  })
})
