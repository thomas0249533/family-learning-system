/**
 * 体验激励 · 成就徽章（28 枚）
 *
 * 原则（都来自教育心理学里对"外部激励"的共识）：
 *   1. 只奖"行为与坚持"，不奖"天赋与名次"——所以没有"考了 100 分"这种徽章；
 *   2. 门槛要够得着，前几枚必须很快拿到，否则孩子不会在意；
 *   3. 徽章口径全部来自已有数据（进度/错题/打卡/学习包）+ 本轮新增埋点
 *      （每日统计 dailyStats / 题型 attemptedTypes）。
 *
 * 四类：M 精熟目标 / G 成长型思维 / B 行为塑造阶梯 / E 探索。
 * 隐藏 3 枚（comeback / early-bird / night-owl）：解锁前不给任何暗示。
 * 连环 4 链（见 chains.ts）。
 *
 * 已解锁记录存 settings 的 achievements 键，本轮从 `string[]` 升级为
 * `{ id, unlockedAt }[]`（读时兼容旧格式）；一旦解锁就不再撤销。
 */
import { db, type ProgressRecord, type MistakeRecord } from '@/db'
import { bestStreak, localDayKey, type StreakState } from './streak'
import type { DailyStat } from './dailyStats'

export type AchievementCategory = 'M' | 'G' | 'B' | 'E'

/** 学习包元信息（供学科覆盖 / 探索类 / 掌握率判定）。 */
export interface PackageMeta {
  packageId: string
  subject: string
  grade: number
  term: string
  packageType: string
  kpCount: number
}

export interface AchievementContext {
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  streak: StreakState
  /** 学习包元信息（学科 / 年级 / 学期 / 类型 / 知识点数） */
  packages?: PackageMeta[]
  /** 每日学习统计（题量 + 首/末时刻） */
  dailyStats?: DailyStat[]
  /** 已尝试题型集合 */
  attemptedTypes?: string[]
}

export interface AchievementDef {
  id: string
  icon: string
  title: string
  desc: string
  /** 类别：M 精熟 / G 成长 / B 行为 / E 探索 */
  category: AchievementCategory
  /** 隐藏成就：解锁前以剪影展示，不给任何暗示 */
  hidden?: boolean
  /** 所属连环 id（见 chains.ts） */
  chain?: string
  /** 链内顺序（从 1 开始） */
  order?: number
  check: (ctx: AchievementContext) => boolean
}

// ---------- 统计辅助 ----------
const masteredKpCount = (p: ProgressRecord[]) => p.filter((x) => x.status === '已掌握').length
const clearedMistakeCount = (m: MistakeRecord[]) => m.filter((x) => x.mastered).length
const bestCorrectStreak = (p: ProgressRecord[]) =>
  p.reduce((max, x) => Math.max(max, x.correctStreak ?? 0), 0)
const maxAnswerCount = (p: ProgressRecord[]) =>
  p.reduce((max, x) => Math.max(max, (x.correctCount ?? 0) + (x.wrongCount ?? 0)), 0)
const totalReviewCorrect = (m: MistakeRecord[]) =>
  m.reduce((sum, x) => sum + (x.reviewCorrectCount ?? 0), 0)
/** 某个知识点曾答错 ≥3 次后转为「已掌握」 */
const hasComeback = (p: ProgressRecord[]) =>
  p.some((x) => x.status === '已掌握' && (x.wrongCount ?? 0) >= 3)
const distinctPackageCount = (ctx: AchievementContext) =>
  new Set(ctx.progress.map((x) => x.packageId)).size

/** 有学习记录（progress）的包集合。 */
function studiedPackageIds(ctx: AchievementContext): Set<string> {
  return new Set(ctx.progress.map((x) => x.packageId))
}

/** 已掌握知识点按学科计数（学科由 packageId → packages[].subject 映射）。 */
function masteredBySubject(ctx: AchievementContext): Record<string, number> {
  const pkgSubject = new Map<string, string>()
  for (const p of ctx.packages ?? []) pkgSubject.set(p.packageId, p.subject)
  const counts: Record<string, number> = {}
  for (const pr of ctx.progress) {
    if (pr.status !== '已掌握') continue
    const subj = pkgSubject.get(pr.packageId)
    if (!subj) continue
    counts[subj] = (counts[subj] ?? 0) + 1
  }
  return counts
}

/** 全库知识点总数（来自 packages[].kpCount）。 */
function totalKpCount(ctx: AchievementContext): number {
  return (ctx.packages ?? []).reduce((sum, p) => sum + (p.kpCount ?? 0), 0)
}

/** 学习过的学期集合（仅统计「有进度」的包）。 */
function studiedTerms(ctx: AchievementContext): Set<string> {
  const studied = studiedPackageIds(ctx)
  const terms = new Set<string>()
  for (const p of ctx.packages ?? []) if (studied.has(p.packageId)) terms.add(p.term)
  return terms
}

/** 学习过的学科集合（仅统计「有进度」的包）。 */
function studiedSubjects(ctx: AchievementContext): Set<string> {
  const studied = studiedPackageIds(ctx)
  const subs = new Set<string>()
  for (const p of ctx.packages ?? []) if (studied.has(p.packageId)) subs.add(p.subject)
  return subs
}

/** 某日首个学习时刻的小时数是否有满足条件者。 */
const anyFirstHourBefore = (stats: DailyStat[] | undefined, hour: number) =>
  (stats ?? []).some((s) => Number.isFinite(s.firstStudyAt) && new Date(s.firstStudyAt).getHours() < hour)
/** 某日最后学习时刻的小时数是否有满足条件者。 */
const anyLastHourAtLeast = (stats: DailyStat[] | undefined, hour: number) =>
  (stats ?? []).some((s) => Number.isFinite(s.lastStudyAt) && new Date(s.lastStudyAt).getHours() >= hour)
const anyDayQuestionAtLeast = (stats: DailyStat[] | undefined, n: number) =>
  (stats ?? []).some((s) => s.questionCount >= n)

export const ACHIEVEMENTS: AchievementDef[] = [
  // ==================== M · 精熟目标（8） ====================
  {
    id: 'first-step',
    icon: '🌱',
    title: '迈出第一步',
    desc: '掌握第 1 个知识点',
    category: 'M',
    chain: 'mastery',
    order: 1,
    check: (ctx) => masteredKpCount(ctx.progress) >= 1,
  },
  {
    id: 'ten-kp',
    icon: '📗',
    title: '小试牛刀',
    desc: '掌握 10 个知识点',
    category: 'M',
    chain: 'mastery',
    order: 2,
    check: (ctx) => masteredKpCount(ctx.progress) >= 10,
  },
  {
    id: 'fifty-kp',
    icon: '📚',
    title: '融会贯通',
    desc: '掌握 50 个知识点',
    category: 'M',
    chain: 'mastery',
    order: 3,
    check: (ctx) => masteredKpCount(ctx.progress) >= 50,
  },
  {
    id: 'hundred-kp',
    icon: '🎓',
    title: '百炼成钢',
    desc: '掌握 100 个知识点',
    category: 'M',
    chain: 'mastery',
    order: 4,
    check: (ctx) => masteredKpCount(ctx.progress) >= 100,
  },
  {
    id: 'kp-300',
    icon: '🏆',
    title: '学富五车',
    desc: '掌握 300 个知识点',
    category: 'M',
    chain: 'mastery',
    order: 5,
    check: (ctx) => masteredKpCount(ctx.progress) >= 300,
  },
  {
    id: 'subject-master-3',
    icon: '🌈',
    title: '三科通才',
    desc: '数学 / 语文 / 英语各掌握 ≥10 个知识点',
    category: 'M',
    check: (ctx) => {
      const c = masteredBySubject(ctx)
      return (c.math ?? 0) >= 10 && (c.chinese ?? 0) >= 10 && (c.english ?? 0) >= 10
    },
  },
  {
    id: 'perfect-kp',
    icon: '🎯',
    title: '一击即中',
    desc: '单个知识点连续答对 ≥10 题',
    category: 'M',
    check: (ctx) => bestCorrectStreak(ctx.progress) >= 10,
  },
  {
    id: 'mastery-half',
    icon: '📈',
    title: '半程山巅',
    desc: '全库掌握率 ≥50%（总知识点 ≥20）',
    category: 'M',
    check: (ctx) => {
      const total = totalKpCount(ctx)
      if (total < 20) return false
      return masteredKpCount(ctx.progress) / total >= 0.5
    },
  },

  // ==================== G · 成长型思维（7） ====================
  {
    id: 'mistake-first',
    icon: '🧩',
    title: '知错能改',
    desc: '首次攻克 1 道错题',
    category: 'G',
    chain: 'mistake',
    order: 1,
    check: (ctx) => clearedMistakeCount(ctx.mistakes) >= 1,
  },
  {
    id: 'mistake-cleaner',
    icon: '🧹',
    title: '错题清道夫',
    desc: '攻克 10 道错题',
    category: 'G',
    chain: 'mistake',
    order: 2,
    check: (ctx) => clearedMistakeCount(ctx.mistakes) >= 10,
  },
  {
    id: 'mistake-cleaner-50',
    icon: '🛠️',
    title: '错题终结者',
    desc: '攻克 50 道错题',
    category: 'G',
    chain: 'mistake',
    order: 3,
    check: (ctx) => clearedMistakeCount(ctx.mistakes) >= 50,
  },
  {
    id: 'comeback',
    icon: '🌟',
    title: '越挫越勇',
    desc: '某知识点曾答错 ≥3 次后转为「已掌握」',
    category: 'G',
    hidden: true,
    check: (ctx) => hasComeback(ctx.progress),
  },
  {
    id: 'review-20',
    icon: '🔁',
    title: '温故知新',
    desc: '复习答对累计 20 次',
    category: 'G',
    check: (ctx) => totalReviewCorrect(ctx.mistakes) >= 20,
  },
  {
    id: 'patience',
    icon: '🐢',
    title: '不厌其烦',
    desc: '单个知识点累计答题 ≥30 次',
    category: 'G',
    check: (ctx) => maxAnswerCount(ctx.progress) >= 30,
  },
  {
    id: 'streak-master',
    icon: '💎',
    title: '稳如磐石',
    desc: '单个知识点连续答对 5 题',
    category: 'G',
    check: (ctx) => bestCorrectStreak(ctx.progress) >= 5,
  },

  // ==================== B · 行为塑造阶梯（8） ====================
  {
    id: 'streak-3',
    icon: '🔥',
    title: '三日之约',
    desc: '连续学习 3 天',
    category: 'B',
    chain: 'streak',
    order: 1,
    check: (ctx) => bestStreak(ctx.streak) >= 3,
  },
  {
    id: 'streak-7',
    icon: '⚡',
    title: '一周不断',
    desc: '连续学习 7 天',
    category: 'B',
    chain: 'streak',
    order: 2,
    check: (ctx) => bestStreak(ctx.streak) >= 7,
  },
  {
    id: 'streak-30',
    icon: '🏔️',
    title: '持之以恒',
    desc: '连续学习 30 天',
    category: 'B',
    chain: 'streak',
    order: 3,
    check: (ctx) => bestStreak(ctx.streak) >= 30,
  },
  {
    id: 'streak-60',
    icon: '🗓️',
    title: '两月之志',
    desc: '连续学习 60 天',
    category: 'B',
    chain: 'streak',
    order: 4,
    check: (ctx) => bestStreak(ctx.streak) >= 60,
  },
  {
    id: 'streak-100',
    icon: '💯',
    title: '百日不辍',
    desc: '连续学习 100 天',
    category: 'B',
    chain: 'streak',
    order: 5,
    check: (ctx) => bestStreak(ctx.streak) >= 100,
  },
  {
    id: 'early-bird',
    icon: '🌅',
    title: '闻鸡起舞',
    desc: '在 07:00 前完成一次学习',
    category: 'B',
    hidden: true,
    check: (ctx) => anyFirstHourBefore(ctx.dailyStats, 7),
  },
  {
    id: 'night-owl',
    icon: '🌙',
    title: '挑灯夜读',
    desc: '在 21:00 后完成一次学习',
    category: 'B',
    hidden: true,
    check: (ctx) => anyLastHourAtLeast(ctx.dailyStats, 21),
  },
  {
    id: 'daily-20',
    icon: '⚡',
    title: '今日之星',
    desc: '单日完成 ≥20 题',
    category: 'B',
    check: (ctx) => anyDayQuestionAtLeast(ctx.dailyStats, 20),
  },

  // ==================== E · 探索（5） ====================
  {
    id: 'explorer-3',
    icon: '🧭',
    title: '初探门径',
    desc: '学习过 3 个不同学习包',
    category: 'E',
    chain: 'explore',
    order: 1,
    check: (ctx) => distinctPackageCount(ctx) >= 3,
  },
  {
    id: 'explorer-10',
    icon: '🗺️',
    title: '博览群书',
    desc: '学习过 10 个不同学习包',
    category: 'E',
    chain: 'explore',
    order: 2,
    check: (ctx) => distinctPackageCount(ctx) >= 10,
  },
  {
    id: 'type-collector',
    icon: '🎲',
    title: '题型收藏家',
    desc: '尝试过 5 种不同题型',
    category: 'E',
    check: (ctx) => (ctx.attemptedTypes?.length ?? 0) >= 5,
  },
  {
    id: 'term-cross',
    icon: '🌗',
    title: '上下求索',
    desc: '上册与下册都学习过',
    category: 'E',
    check: (ctx) => studiedTerms(ctx).size >= 2,
  },
  {
    id: 'senior-new',
    icon: '🔭',
    title: '另辟蹊径',
    desc: '首次学习非「数学」学科',
    category: 'E',
    check: (ctx) => [...studiedSubjects(ctx)].some((s) => s !== 'math'),
  },
]

// ==================== 存储（只增不减 · 兼容旧 string[]） ====================

const KEY = 'achievements'

export interface UnlockedRecord {
  id: string
  /** 解锁日期 YYYY-MM-DD（本地）；'' 表示旧数据未知 */
  unlockedAt: string
}

/** 兼容旧 `string[]` 与半迁移态，归一化为 UnlockedRecord[]。 */
export function normalizeUnlocked(raw: unknown): UnlockedRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((v) => {
    if (typeof v === 'string') return [{ id: v, unlockedAt: '' }]
    if (v && typeof (v as UnlockedRecord).id === 'string') {
      return [{ id: (v as UnlockedRecord).id, unlockedAt: String((v as UnlockedRecord).unlockedAt ?? '') }]
    }
    return []
  })
}

/** 读取全部已解锁记录（含解锁日期）。 */
export async function loadUnlocked(): Promise<UnlockedRecord[]> {
  try {
    const rec = await db.settings.get(KEY)
    return normalizeUnlocked(rec?.value)
  } catch {
    return []
  }
}

/** 读取已解锁 id 列表（供旧调用）。 */
export async function loadUnlockedIds(): Promise<string[]> {
  return (await loadUnlocked()).map((r) => r.id)
}

/** 写入已解锁记录（去重，保留已有 unlockedAt）。 */
export async function saveUnlocked(records: UnlockedRecord[]): Promise<void> {
  const map = new Map<string, UnlockedRecord>()
  for (const r of records) {
    const prev = map.get(r.id)
    if (!prev) map.set(r.id, r)
    else if (!prev.unlockedAt && r.unlockedAt) map.set(r.id, r)
  }
  await db.settings.put({ key: KEY, value: [...map.values()] })
}

/** 兼容旧签名：按 id 数组写入（unlockedAt=''）。 */
export async function saveUnlockedIds(ids: string[]): Promise<void> {
  await saveUnlocked([...new Set(ids)].map((id) => ({ id, unlockedAt: '' })))
}

/** 当前数据下所有满足条件的徽章 id */
export function evaluateAchievements(ctx: AchievementContext): string[] {
  return ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id)
}

export interface AchievementSyncResult {
  /** 最新全部已解锁 id */
  unlocked: string[]
  /** 最新全部已解锁记录（含日期） */
  unlockedRecords: UnlockedRecord[]
  /** 本次新解锁（用于弹祝贺） */
  newlyUnlocked: AchievementDef[]
}

/**
 * 结算徽章：把"已满足条件"的并入已解锁集合，返回新增的部分。
 * 已解锁的即使条件暂时不再满足也不会撤销；旧记录 unlockedAt 原样保留。
 */
export async function syncAchievements(
  ctx: AchievementContext,
  now: Date = new Date(),
): Promise<AchievementSyncResult> {
  const saved = await loadUnlocked()
  const savedIds = new Set(saved.map((r) => r.id))
  const earned = evaluateAchievements(ctx)

  const newlyIds = earned.filter((id) => !savedIds.has(id))
  const mergedMap = new Map<string, UnlockedRecord>()
  for (const r of saved) mergedMap.set(r.id, r)
  for (const id of earned) {
    if (!mergedMap.has(id)) mergedMap.set(id, { id, unlockedAt: localDayKey(now) })
  }
  const unlockedRecords = [...mergedMap.values()]

  if (unlockedRecords.length !== saved.length) {
    await saveUnlocked(unlockedRecords)
  }

  return {
    unlocked: unlockedRecords.map((r) => r.id),
    unlockedRecords,
    newlyUnlocked: ACHIEVEMENTS.filter((a) => newlyIds.includes(a.id)),
  }
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}
