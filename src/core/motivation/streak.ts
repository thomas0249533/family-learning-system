/**
 * 体验激励 · 连续学习天数（streak）
 *
 * 教育心理学里，"每日坚持"这件事本身对习惯养成的贡献，比单次学多少更大。
 * 所以这里记录的是"有没有打开来做"（打卡），而不是"做了多少题"。
 *
 * 注意：刻意用**本地日期**做键，不用 toISOString()。
 * 后者按 UTC 算，中国时区下晚上 8 点之后会被算成第二天，连续天数会莫名其妙断掉。
 */
import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'

export interface StreakState {
  /** 当前连续天数 */
  current: number
  /** 历史最长连续天数 */
  longest: number
  /** 最后一次学习日期 YYYY-MM-DD（本地） */
  lastDate: string
}

export const STREAK_KEY = 'studyStreak'

/** 当前档案的连续天数键。漏分片的表现是"打卡天数突然归零"，最刺眼。 */
export function streakKey(profileId: string = currentProfileId()): string {
  return scopedKey(STREAK_KEY, profileId)
}

export const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastDate: '' }

/** 本地日期键 YYYY-MM-DD */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** a 比 b 晚多少天 */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ta = new Date(ay, am - 1, ad).getTime()
  const tb = new Date(by, bm - 1, bd).getTime()
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.NaN
  return Math.round((ta - tb) / 86400000)
}

/**
 * 读某个档案的连续天数状态。
 *
 * @param profileId 目标档案。**默认当前档案**，所以既有调用点（`touchStudyDay` /
 *   `settle` 等）一个都不用改；家庭成就墙这类"一次要读多个孩子"的页面显式传入，
 *   才不会把当前档案的打卡天数填进别人的墙。
 */
export async function loadStreak(profileId: string = currentProfileId()): Promise<StreakState> {
  try {
    const rec = await db.settings.get(streakKey(profileId))
    const v = rec?.value
    if (v && typeof v === 'object' && typeof v.current === 'number') {
      return { ...EMPTY_STREAK, ...v }
    }
  } catch {
    /* 读不到就当作没有记录 */
  }
  return { ...EMPTY_STREAK }
}

export async function saveStreak(s: StreakState): Promise<void> {
  await db.settings.put({ key: streakKey(), value: { ...s, lastDate: s.lastDate } })
}

/** 今天是否已经打过卡 */
export function studiedToday(s: StreakState, now: Date = new Date()): boolean {
  return s.lastDate === localDayKey(now)
}

/**
 * 记录"今天学过了"。同一天重复调用不会重复累加。
 * 返回值是更新后的状态（调用方可据此判断是否刚刚达成新的连续里程碑）。
 */
export async function touchStudyDay(now: Date = new Date()): Promise<StreakState> {
  const today = localDayKey(now)
  const prev = await loadStreak()
  if (prev.lastDate === today) return prev

  const gap = prev.lastDate ? dayDiff(today, prev.lastDate) : Number.NaN
  const current = gap === 1 ? prev.current + 1 : 1

  const next: StreakState = {
    current,
    longest: Math.max(prev.longest || 0, current),
    lastDate: today,
  }
  await saveStreak(next)
  return next
}

/**
 * 取"用于展示"的连续天数：
 * 今天已打卡 → 原值；今天没打卡但昨天打过 → 仍显示原值（还有机会续上）；
 * 已经断了两天以上 → 归零。
 */
export function effectiveCurrent(s: StreakState, now: Date = new Date()): number {
  if (!s.lastDate) return 0
  const diff = dayDiff(localDayKey(now), s.lastDate)
  if (diff === 0 || diff === 1) return s.current
  return 0
}

/** 展示用：连续天数文案 */
export function streakText(s: StreakState, now: Date = new Date()): string {
  const cur = effectiveCurrent(s, now)
  if (cur <= 0) return '今天还没开始，来打卡吧'
  if (studiedToday(s, now)) return `已连续学习 ${cur} 天`
  return `连续 ${cur} 天，今天再学一次就续上啦`
}

/** 展示用：达成过的连续里程碑（用于徽章判定） */
export function bestStreak(s: StreakState, now: Date = new Date()): number {
  return Math.max(s.longest || 0, effectiveCurrent(s, now))
}
