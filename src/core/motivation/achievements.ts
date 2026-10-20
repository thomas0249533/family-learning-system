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
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'
import { bestStreak, localDayKey, type StreakState } from './streak'
import { evidenceOf } from './achievementProgress'
// 两个 `import type` 都不能变成运行时 import，否则成环：
//   - `achievementProgress` 在运行时只 import 本文件的 `AchievementContext`（type-only），
//     这里反向只取 `Measure` 的形状；
//   - `achievementTaxonomy` 在运行时 import 本文件的 `ACHIEVEMENTS`（真值），反向必须 type-only。
// type-only 在编译后整条消失，环就断在这里。
import type { Measure } from './achievementProgress'
import type { AchievementSource, AchievementTier } from './achievementTaxonomy'
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
  /**
   * 来源（V1.4 · B3）。内置 28 枚**不写**这个字段，由
   * `achievementTaxonomy.sourceOf(id)` 派生；自定义包的定义自带（包作者声明的来源），
   * 且**不可能**靠 id 反查出来 —— `TAXONOMY` 里没有它。
   */
  source?: AchievementSource
  /**
   * 稀有层级（同上）：自定义定义自带。省略时的回落由视图层决定 ——
   * 内置走 `achievementTaxonomy.tierOf(id)`，自定义包由 `customPack.deriveCustomTier` 推导。
   */
  tier?: AchievementTier
  /**
   * 进度度量（V1.4 · B3）。自定义定义自带（`manual-check` 的 0/1、
   * `counter` 的规则度量）；内置 28 枚不写，进度由 `progressOf(id, ctx)` 唯一提供。
   *
   * 为什么挂在定义上而不是另开一张 `id → measure` 的映射表：自定义 id 是运行时
   * 从库里读出来的，静态表装不下；挂在定义上则"定义在哪、度量在哪"，不会漏。
   */
  measure?: (ctx: AchievementContext) => Measure
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

/**
 * 键的**基名**。真实落库的键带档案后缀（`achievements:<profileId>`）。
 * 保留这个常量是因为测试与文档要按"逻辑键"引用；读写一律走 `achievementsKey()`。
 */
export const ACHIEVEMENTS_KEY = 'achievements'

/** 当前档案的成就键 */
export function achievementsKey(profileId: string = currentProfileId()): string {
  return scopedKey(ACHIEVEMENTS_KEY, profileId)
}

export interface UnlockedRecord {
  id: string
  /** 解锁日期 YYYY-MM-DD（本地）；'' 表示旧数据未知 */
  unlockedAt: string
  /**
   * 证据快照（V1.3 · A-06）：解锁瞬间固化的一句话事实，≤40 字，**此后不随数据变化**。
   *
   * 旧记录没有这个字段 → 已获得卡**不显示证据行**，绝不事后补算：
   * 补算出来的"证据"已经不是当时的证据了（PRD §4.1 迁移说明 2）。
   */
  evidence?: string
  /**
   * 重复达成次数（V1.4 · B6）。**1 或省略 = 只达成过一次**，≥2 时卡面显示「第 N 次」。
   *
   * ## 为什么这个字段现在**只写不涨**
   * B6 只落基础设施（字段 + 合并规则 + 卡面印记），写入侧**刻意不递增**。
   * 因为内置 28 枚的判定全是单调语义（`anyDayQuestionAtLeast` / `bestStreak` /
   * `totalAttempts`：一旦为真永远为真），而 `syncAchievements` 每次结算都会把
   * 已解锁项重新判为"满足" —— 字面实现「再次达成 +1」会让计数随路由跳转涨到几十，
   * 卡面出现"第 37 次"这种纯噪声。
   *
   * 真正的「再次达成」需要**周期化的成就定义**（`repeatable: 'daily' | 'weekly'`），
   * 让条件能回落再重新满足。那是成就定义模型的新能力，不在 V1.4 范围。
   *
   * 现在就把合并规则写好的理由（设计稿 R11）：字段一旦存在，跨设备导入就必须知道
   * 怎么合它。等将来真的开始递增再补规则，中间那段时间的备份会把重复次数抹成单次，
   * 而且**没有任何告警**。所以 DoD 是"加字段必须同时加合并规则"，不是"以后再说"。
   */
  repeatCount?: number
}

/** 重复次数的归一化：只认 ≥1 的整数；脏数据一律当"没有这个字段"（= 1 次）。 */
export function normalizeRepeatCount(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : undefined
}

/** 兼容旧 `string[]` 与半迁移态，归一化为 UnlockedRecord[]。 */
export function normalizeUnlocked(raw: unknown): UnlockedRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((v) => {
    if (typeof v === 'string') return [{ id: v, unlockedAt: '' }]
    if (v && typeof (v as UnlockedRecord).id === 'string') {
      const rec = v as UnlockedRecord
      const out: UnlockedRecord = { id: rec.id, unlockedAt: String(rec.unlockedAt ?? '') }
      // 只搬运非空字符串，脏数据（数字 / null / 空串）一律当"没有证据"
      if (typeof rec.evidence === 'string' && rec.evidence.trim() !== '') {
        out.evidence = rec.evidence
      }
      // 重复次数：旧记录没有 → 不写这个字段（而不是写 1）——
      // "没有这个字段"和"达成过一次"在显示上是同一件事，但在**合并**上不同：
      // 写死的 1 会与远端的 3 取 max 时看起来正常，可一旦将来改成省略即 1 的口径，
      // 满地显式 1 会让"这次备份到底带没带这个信息"无法判断
      const repeat = normalizeRepeatCount(rec.repeatCount)
      if (repeat !== undefined) out.repeatCount = repeat
      return [out]
    }
    return []
  })
}

/**
 * 读取某个档案的全部已解锁记录（含解锁日期）。
 *
 * @param profileId 默认当前档案。**家庭墙必须传**：它要并排渲染所有档案，
 *   用默认值会把当前档案的解锁记录填进别人的列里（症状是"老二和老大的徽章一模一样"）。
 */
export async function loadUnlocked(profileId: string = currentProfileId()): Promise<UnlockedRecord[]> {
  try {
    const rec = await db.settings.get(achievementsKey(profileId))
    return normalizeUnlocked(rec?.value)
  } catch {
    return []
  }
}

/** 读取已解锁 id 列表（供旧调用）。 */
export async function loadUnlockedIds(): Promise<string[]> {
  return (await loadUnlocked()).map((r) => r.id)
}

/**
 * 同 id 去重（写入前的唯一口径）。抽成纯函数是为了能直接测 ——
 * `saveUnlocked` 一碰 db 就必须 mock 整套 things，而这里要守的恰恰是三条容易写反的规则：
 *
 * 1. `unlockedAt` 取**先到的那次**（最接近真实解锁时刻）；
 * 2. `evidence` **优先本机**，本机为空才用后来的；
 * 3. `repeatCount` 取**较大**（累计事实，方向与上面两条相反）。
 */
export function dedupeUnlocked(records: UnlockedRecord[]): UnlockedRecord[] {
  const map = new Map<string, UnlockedRecord>()
  for (const r of records) {
    const prev = map.get(r.id)
    if (!prev) {
      map.set(r.id, r)
      continue
    }
    // 已有的日期/证据优先 —— "先到的那次"才是最接近真实解锁时刻的记录
    const merged: UnlockedRecord = {
      id: r.id,
      unlockedAt: prev.unlockedAt || r.unlockedAt,
    }
    const evidence = prev.evidence || r.evidence
    if (evidence) merged.evidence = evidence
    // 重复次数取**较大**：同一条记录在内存里出现两份时，取小值等于把已发生的重复抹掉
    // （与合并引擎 R11 同一个坑，只是发生在单机内）
    const repeat = Math.max(prev.repeatCount ?? 1, normalizeRepeatCount(r.repeatCount) ?? 1)
    if (repeat >= 2) merged.repeatCount = repeat
    map.set(r.id, merged)
  }
  return [...map.values()]
}

/** 写入已解锁记录（去重，保留已有 unlockedAt / evidence / repeatCount）。 */
export async function saveUnlocked(records: UnlockedRecord[]): Promise<void> {
  await db.settings.put({ key: achievementsKey(), value: dedupeUnlocked(records) })
}

/** 兼容旧签名：按 id 数组写入（unlockedAt=''）。 */
export async function saveUnlockedIds(ids: string[]): Promise<void> {
  await saveUnlocked([...new Set(ids)].map((id) => ({ id, unlockedAt: '' })))
}

/**
 * 当前数据下所有满足条件的徽章 id。
 *
 * @param extraDefs 额外定义（V1.4 · B3 的自定义包）。**默认空数组** = 老行为逐字节不变。
 *   刻意不把自定义定义合进 `ACHIEVEMENTS`：那是内置 28 枚的唯一真相，
 *   混进去会污染 `missingTaxonomy()` / `MEASURABLE_IDS` 之类按"内置 28 枚"成立的推导。
 */
export function evaluateAchievements(
  ctx: AchievementContext,
  extraDefs: AchievementDef[] = [],
): string[] {
  return [...ACHIEVEMENTS, ...extraDefs].filter((a) => a.check(ctx)).map((a) => a.id)
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
 *
 * 证据快照（A-06）在**这里**写：此刻 `ctx` 就是"达成时"的数据，
 * 写库成功后才返回 `newlyUnlocked`（调用方据此弹提示）——
 * 也就是"先落库、后提示"：宁可不弹，不可弹了却没存。
 */
export async function syncAchievements(
  ctx: AchievementContext,
  now: Date = new Date(),
  extraDefs: AchievementDef[] = [],
): Promise<AchievementSyncResult> {
  const saved = await loadUnlocked()
  const savedIds = new Set(saved.map((r) => r.id))
  const earned = evaluateAchievements(ctx, extraDefs)

  const newlyIds = earned.filter((id) => !savedIds.has(id))
  const mergedMap = new Map<string, UnlockedRecord>()
  for (const r of saved) mergedMap.set(r.id, r)
  // 已解锁且本轮**仍满足**的项：这里**不**递增 repeatCount（B6 裁决）。
  // 原因见 `UnlockedRecord.repeatCount` 的注释：内置判定全是单调的，而本函数每次结算都会
  // 跑一遍（AppShell 去抖 + 路由跳转都会触发），"满足即 +1"会让计数随翻页上涨。
  // 将来要做真重复，判据必须是"条件从 false 变 true 的跃迁"，且得先有周期化定义。
  for (const id of earned) {
    if (!mergedMap.has(id)) {
      // 自定义 id 在 `EVIDENCE_TPL` 里没有模板 → 空串 → 卡片不显示证据行。
      // 这是对的：证据文案是"内置 28 枚的口径"，不该给家长自建的卡临时编一句。
      const evidence = evidenceOf(id, ctx)
      mergedMap.set(id, {
        id,
        unlockedAt: localDayKey(now),
        ...(evidence ? { evidence } : {}),
      })
    }
  }
  const unlockedRecords = [...mergedMap.values()]

  if (unlockedRecords.length !== saved.length) {
    await saveUnlocked(unlockedRecords)
  }

  return {
    unlocked: unlockedRecords.map((r) => r.id),
    unlockedRecords,
    // 用"全部定义"过滤而不是只查 ACHIEVEMENTS：否则自定义卡解锁了却弹不出 toast
    // （结算已经落库，提示却永远不来 —— 孩子看不到自己刚拿到的徽章）
    newlyUnlocked: [...ACHIEVEMENTS, ...extraDefs].filter((a) => newlyIds.includes(a.id)),
  }
}

/**
 * 按 id 找定义。
 * @param extraDefs 额外定义（自定义包）。内置优先 —— id 撞车时（结构上不可能，
 *   校验器会拦）内置的定义才是可信的那一份。
 */
export function achievementById(
  id: string,
  extraDefs: AchievementDef[] = [],
): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id) ?? extraDefs.find((a) => a.id === id)
}
