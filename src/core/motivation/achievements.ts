/**
 * 体验激励 · 成就徽章
 *
 * 原则（都来自教育心理学里对"外部激励"的共识）：
 *   1. 只奖"行为与坚持"，不奖"天赋与名次"——所以没有"考了 100 分"这种徽章；
 *   2. 门槛要够得着，前几枚必须很快拿到，否则孩子不会在意；
 *   3. 徽章口径全部来自已有数据（进度/错题/打卡），不额外造埋点。
 *
 * 已解锁的徽章 id 存在 settings 表里，一旦解锁就不会再撤销（避免"掉徽章"挫败感）。
 */
import { db, type ProgressRecord, type MistakeRecord } from '@/db'
import { bestStreak, type StreakState } from './streak'

export interface AchievementContext {
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  streak: StreakState
}

export interface AchievementDef {
  id: string
  icon: string
  title: string
  desc: string
  check: (ctx: AchievementContext) => boolean
}

const masteredKpCount = (p: ProgressRecord[]) => p.filter(x => x.status === '已掌握').length
const clearedMistakeCount = (m: MistakeRecord[]) => m.filter(x => x.mastered).length
const bestCorrectStreak = (p: ProgressRecord[]) =>
  p.reduce((max, x) => Math.max(max, x.correctStreak ?? 0), 0)

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-step',
    icon: '🌱',
    title: '迈出第一步',
    desc: '掌握第 1 个知识点',
    check: ctx => masteredKpCount(ctx.progress) >= 1,
  },
  {
    id: 'ten-kp',
    icon: '📗',
    title: '小试牛刀',
    desc: '掌握 10 个知识点',
    check: ctx => masteredKpCount(ctx.progress) >= 10,
  },
  {
    id: 'fifty-kp',
    icon: '📚',
    title: '融会贯通',
    desc: '掌握 50 个知识点',
    check: ctx => masteredKpCount(ctx.progress) >= 50,
  },
  {
    id: 'hundred-kp',
    icon: '🎓',
    title: '百炼成钢',
    desc: '掌握 100 个知识点',
    check: ctx => masteredKpCount(ctx.progress) >= 100,
  },
  {
    id: 'streak-3',
    icon: '🔥',
    title: '三日之约',
    desc: '连续学习 3 天',
    check: ctx => bestStreak(ctx.streak) >= 3,
  },
  {
    id: 'streak-7',
    icon: '⚡',
    title: '一周不断',
    desc: '连续学习 7 天',
    check: ctx => bestStreak(ctx.streak) >= 7,
  },
  {
    id: 'streak-30',
    icon: '🏔️',
    title: '持之以恒',
    desc: '连续学习 30 天',
    check: ctx => bestStreak(ctx.streak) >= 30,
  },
  {
    id: 'mistake-cleaner',
    icon: '🧹',
    title: '错题清道夫',
    desc: '攻克 10 道错题',
    check: ctx => clearedMistakeCount(ctx.mistakes) >= 10,
  },
  {
    id: 'streak-master',
    icon: '💎',
    title: '稳如磐石',
    desc: '单个知识点连续答对 5 题',
    check: ctx => bestCorrectStreak(ctx.progress) >= 5,
  },
]

const KEY = 'achievements'

export async function loadUnlockedIds(): Promise<string[]> {
  try {
    const rec = await db.settings.get(KEY)
    const v = rec?.value
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  } catch {
    /* ignore */
  }
  return []
}

export async function saveUnlockedIds(ids: string[]): Promise<void> {
  await db.settings.put({ key: KEY, value: [...new Set(ids)] })
}

/** 当前数据下所有满足条件的徽章 id */
export function evaluateAchievements(ctx: AchievementContext): string[] {
  return ACHIEVEMENTS.filter(a => a.check(ctx)).map(a => a.id)
}

export interface AchievementSyncResult {
  /** 最新全部已解锁 */
  unlocked: string[]
  /** 本次新解锁（用于弹祝贺） */
  newlyUnlocked: AchievementDef[]
}

/**
 * 结算徽章：把"已满足条件"的并入已解锁集合，返回新增的部分。
 * 已解锁的即使条件暂时不再满足也不会撤销。
 */
export async function syncAchievements(ctx: AchievementContext): Promise<AchievementSyncResult> {
  const saved = await loadUnlockedIds()
  const earned = evaluateAchievements(ctx)

  const merged = Array.from(new Set([...saved, ...earned]))
  const newlyIds = earned.filter(id => !saved.includes(id))

  if (merged.length !== saved.length) {
    await saveUnlockedIds(merged)
  }

  return {
    unlocked: merged,
    newlyUnlocked: ACHIEVEMENTS.filter(a => newlyIds.includes(a.id)),
  }
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find(a => a.id === id)
}
