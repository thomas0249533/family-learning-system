/**
 * 成就的**展示元数据 + 进度度量**（V1.3 · T03）。
 *
 * 为什么单独一个文件：`achievements.ts` 里的 28 枚定义是**冻结**的（口径定了就不许随手改），
 * 但"每枚成就现在走到哪了、差多少、达成提示写什么"是展示层的事，两者生命周期不同。
 * 拆开后：
 *   - `achievements.ts` 只负责「判定」（`check(ctx)`）；
 *   - 本文件负责「解释」（`current / target / hint`）。
 * 两者必须**语义等价**：`check(ctx) === (current >= target)`。
 * `tests/achievement-meta.test.ts` 用一组代表性上下文把这条等价关系钉死 ——
 * 否则会出现"进度显示 10/10 但徽章没亮"这种最伤人的 bug。
 *
 * ## 铁律：进度**只算当前值，禁止缓存历史最大值**
 * 曾经想过"记住最大值，避免孩子退步时进度回退"，但那会让
 * `current >= target ⇔ check(ctx)` 这条等价关系破裂（缓存值达标 ≠ 现在真的满足条件），
 * 于是会出现"进度条满了却永远不亮"或"亮着但进度显示 8/10"。
 * 正确做法：进度诚实地跟着数据走；**已解锁的徽章永不回收**（`syncAchievements` 只增不删，
 * 这是代码事实），所以孩子看到"已获得"的那一枚不会因为退步而消失，只是待解锁的进度会回退 ——
 * 那恰恰是真实状态。
 */
import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementContext,
  type AchievementDef,
  type UnlockedRecord,
} from './achievements'
import { bestStreak } from './streak'

export type { AchievementCategory }

// ==================== 分类元数据 ====================

export interface CategoryMeta {
  category: AchievementCategory
  /** 分组标题 */
  label: string
  /** 分组说明（一句话讲清这类奖的"为什么"） */
  desc: string
  icon: string
}

/** 展示顺序：先精熟，再成长，再习惯，最后探索 —— 与"在意什么"的优先级一致 */
export const CATEGORY_ORDER: AchievementCategory[] = ['M', 'G', 'B', 'E']

export const CATEGORY_META: Record<AchievementCategory, CategoryMeta> = {
  M: { category: 'M', label: '精熟目标', desc: '把知识点真正学懂、学牢', icon: '🎯' },
  G: { category: 'G', label: '成长型思维', desc: '从错误里学，越挫越勇', icon: '🌱' },
  B: { category: 'B', label: '行为塑造', desc: '让坚持变成习惯', icon: '⏱️' },
  E: { category: 'E', label: '探索发现', desc: '多走走，看看还有什么', icon: '🧭' },
}

// ==================== 度量 ====================

export interface Measure {
  /** 当前进度值（**实时计算，不缓存**） */
  current: number
  /** 达标值 */
  target: number
  /** 一句人话提示：还差什么 / 已经到哪了 */
  hint: string
}

export type MeasureFn = (ctx: AchievementContext) => Measure

// ---------- 与 achievements.ts 同口径的统计（刻意重复实现，避免把展示层耦合进判定层）----------
const masteredCount = (p: AchievementContext['progress']) =>
  p.filter((x) => x.status === '已掌握').length
const clearedMistakes = (ctx: AchievementContext) =>
  ctx.mistakes.filter((x) => x.mastered).length
const bestCorrectStreak = (ctx: AchievementContext) =>
  ctx.progress.reduce((max, x) => Math.max(max, x.correctStreak ?? 0), 0)
const maxAnswers = (ctx: AchievementContext) =>
  ctx.progress.reduce((max, x) => Math.max(max, (x.correctCount ?? 0) + (x.wrongCount ?? 0)), 0)
const reviewCorrect = (ctx: AchievementContext) =>
  ctx.mistakes.reduce((sum, x) => sum + (x.reviewCorrectCount ?? 0), 0)
const comebackHit = (ctx: AchievementContext) =>
  ctx.progress.some((x) => x.status === '已掌握' && (x.wrongCount ?? 0) >= 3)

const subjectMap = (ctx: AchievementContext) => {
  const m = new Map<string, string>()
  for (const p of ctx.packages ?? []) m.set(p.packageId, p.subject)
  return m
}
const masteredBySubject = (ctx: AchievementContext) => {
  const map = subjectMap(ctx)
  const counts: Record<string, number> = {}
  for (const pr of ctx.progress) {
    if (pr.status !== '已掌握') continue
    const s = map.get(pr.packageId)
    if (!s) continue
    counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}
const totalKp = (ctx: AchievementContext) =>
  (ctx.packages ?? []).reduce((sum, p) => sum + (p.kpCount ?? 0), 0)
const studiedPackageIds = (ctx: AchievementContext) =>
  new Set(ctx.progress.map((x) => x.packageId))
const studiedTerms = (ctx: AchievementContext) => {
  const studied = studiedPackageIds(ctx)
  const terms = new Set<string>()
  for (const p of ctx.packages ?? []) if (studied.has(p.packageId)) terms.add(p.term)
  return terms
}
const studiedSubjects = (ctx: AchievementContext) => {
  const studied = studiedPackageIds(ctx)
  const subs = new Set<string>()
  for (const p of ctx.packages ?? []) if (studied.has(p.packageId)) subs.add(p.subject)
  return subs
}
const maxDayQuestions = (ctx: AchievementContext) =>
  (ctx.dailyStats ?? []).reduce((max, s) => Math.max(max, s.questionCount ?? 0), 0)
const anyFirstHourBefore = (ctx: AchievementContext, hour: number) =>
  (ctx.dailyStats ?? []).some(
    (s) => Number.isFinite(s.firstStudyAt) && new Date(s.firstStudyAt).getHours() < hour,
  )
const anyLastHourAtLeast = (ctx: AchievementContext, hour: number) =>
  (ctx.dailyStats ?? []).some(
    (s) => Number.isFinite(s.lastStudyAt) && new Date(s.lastStudyAt).getHours() >= hour,
  )

/** 数值型度量的工厂：提示统一成「还差 X 单位 · 当前 a/b」，孩子一眼能懂 */
function counter(value: number, target: number, unit: string, label: string): Measure {
  const current = Math.max(0, Math.floor(value))
  if (current >= target) return { current, target, hint: `${label}已达成（${current}/${target}）` }
  return { current, target, hint: `还差 ${target - current} ${unit} · 当前 ${current}/${target}` }
}

const SUBJECT_LABEL: Record<string, string> = { math: '数学', chinese: '语文', english: '英语' }

/**
 * 每枚成就的度量。**必须覆盖 ACHIEVEMENTS 的每一个 id**
 * （`tests/achievement-meta.test.ts` 有覆盖率断言，漏一个就变红）。
 */
export const MEASURES: Record<string, MeasureFn> = {
  // ---------- M · 精熟 ----------
  'first-step': (ctx) => counter(masteredCount(ctx.progress), 1, '个知识点', '掌握第一个'),
  'ten-kp': (ctx) => counter(masteredCount(ctx.progress), 10, '个知识点', '掌握 10 个'),
  'fifty-kp': (ctx) => counter(masteredCount(ctx.progress), 50, '个知识点', '掌握 50 个'),
  'hundred-kp': (ctx) => counter(masteredCount(ctx.progress), 100, '个知识点', '掌握 100 个'),
  'kp-300': (ctx) => counter(masteredCount(ctx.progress), 300, '个知识点', '掌握 300 个'),

  'subject-master-3': (ctx) => {
    const c = masteredBySubject(ctx)
    const math = c.math ?? 0
    const chinese = c.chinese ?? 0
    const english = c.english ?? 0
    const min = Math.min(math, chinese, english)
    return {
      current: min,
      target: 10,
      hint: `数学 ${math}/10 · 语文 ${chinese}/10 · 英语 ${english}/10（看最少的那个）`,
    }
  },

  'perfect-kp': (ctx) => counter(bestCorrectStreak(ctx), 10, '题连对', '单点连对 10 题'),
  'mastery-half': (ctx) => {
    const total = totalKp(ctx)
    const mastered = masteredCount(ctx.progress)
    const rate = total > 0 ? Math.round((mastered / total) * 100) : 0
    // 前置条件（总数 ≥20）没满足时进度按 0 计 —— 与 check() 的口径保持一致
    const current = total >= 20 ? rate : 0
    return {
      current,
      target: 50,
      hint:
        total < 20
          ? `需要先有 ≥20 个知识点（当前 ${total} 个）`
          : `全库掌握率 ${rate}%，目标 50%（${mastered}/${total}）`,
    }
  },

  // ---------- G · 成长 ----------
  'mistake-first': (ctx) => counter(clearedMistakes(ctx), 1, '道错题', '攻克第一道错题'),
  'mistake-cleaner': (ctx) => counter(clearedMistakes(ctx), 10, '道错题', '攻克 10 道'),
  'mistake-cleaner-50': (ctx) => counter(clearedMistakes(ctx), 50, '道错题', '攻克 50 道'),
  comeback: (ctx) => {
    const hit = comebackHit(ctx)
    return {
      current: hit ? 1 : 0,
      target: 1,
      hint: hit ? '已经做到过' : '某个知识点错够 3 次后，把它彻底学会',
    }
  },
  'review-20': (ctx) => counter(reviewCorrect(ctx), 20, '次复习答对', '复习答对 20 次'),
  patience: (ctx) => counter(maxAnswers(ctx), 30, '题', '单点累计 30 题'),
  'streak-master': (ctx) => counter(bestCorrectStreak(ctx), 5, '题连对', '单点连对 5 题'),

  // ---------- B · 行为 ----------
  'streak-3': (ctx) => counter(bestStreak(ctx.streak), 3, '天', '连续 3 天'),
  'streak-7': (ctx) => counter(bestStreak(ctx.streak), 7, '天', '连续 7 天'),
  'streak-30': (ctx) => counter(bestStreak(ctx.streak), 30, '天', '连续 30 天'),
  'streak-60': (ctx) => counter(bestStreak(ctx.streak), 60, '天', '连续 60 天'),
  'streak-100': (ctx) => counter(bestStreak(ctx.streak), 100, '天', '连续 100 天'),
  'early-bird': (ctx) => {
    const hit = anyFirstHourBefore(ctx, 7)
    return { current: hit ? 1 : 0, target: 1, hint: hit ? '已经做到过' : '试着在早上 7 点前学一会儿' }
  },
  'night-owl': (ctx) => {
    const hit = anyLastHourAtLeast(ctx, 21)
    return { current: hit ? 1 : 0, target: 1, hint: hit ? '已经做到过' : '晚上 9 点后还在学习' }
  },
  'daily-20': (ctx) => counter(maxDayQuestions(ctx), 20, '题', '单日 20 题'),

  // ---------- E · 探索 ----------
  'explorer-3': (ctx) => counter(studiedPackageIds(ctx).size, 3, '个学习包', '学过 3 个包'),
  'explorer-10': (ctx) => counter(studiedPackageIds(ctx).size, 10, '个学习包', '学过 10 个包'),
  'type-collector': (ctx) => counter(ctx.attemptedTypes?.length ?? 0, 5, '种题型', '试过 5 种题型'),
  'term-cross': (ctx) => {
    const terms = studiedTerms(ctx)
    const names = [...terms].sort().map((t) => (t === 'up' ? '上册' : t === 'down' ? '下册' : t))
    return {
      current: terms.size,
      target: 2,
      hint: terms.size >= 2 ? '上下册都学了' : `已学 ${names.join('、') || '（还没有）'}，目标 2 个学期`,
    }
  },
  'senior-new': (ctx) => {
    const subs = [...studiedSubjects(ctx)]
    const other = subs.filter((s) => s !== 'math')
    return {
      current: other.length > 0 ? 1 : 0,
      target: 1,
      hint:
        other.length > 0
          ? `已学过 ${other.map((s) => SUBJECT_LABEL[s] ?? s).join('、')}`
          : '去学一学数学以外的学科',
    }
  },
}

/** 单枚成就的度量；缺度量返回 null（测试会拦住，生产里不至于崩） */
export function progressOf(id: string, ctx: AchievementContext): Measure | null {
  const fn = MEASURES[id]
  if (!fn) return null
  try {
    return fn(ctx)
  } catch {
    return null
  }
}

/** 缺少度量的成就 id（供测试与自检用；正常应为空数组） */
export function missingMeasures(): string[] {
  return ACHIEVEMENTS.filter((a) => !MEASURES[a.id]).map((a) => a.id)
}

// ==================== 视图 ====================

export interface AchievementItem {
  id: string
  icon: string
  title: string
  desc: string
  category: AchievementCategory
  /** 已解锁（**只看持久化记录，绝不因为条件暂时不满足而回收**） */
  earned: boolean
  /** 解锁日期 YYYY-MM-DD；旧数据可能为 '' */
  unlockedAt: string
  /** 隐藏成就且未解锁 → 剪影，不泄露任何信息 */
  silhouetted: boolean
  current: number
  target: number
  /** 0~100；已解锁恒 100，剪影恒 0 */
  percent: number
  /** 达成提示（剪影时为占位文案） */
  hint: string
}

export interface AchievementGroup {
  category: AchievementCategory
  label: string
  desc: string
  icon: string
  earned: number
  total: number
  items: AchievementItem[]
  /** 组内"最接近解锁"的那一枚（未解锁中 percent 最高者），供折叠态摘要 */
  closest: AchievementItem | null
}

export interface AchievementView {
  groups: AchievementGroup[]
  earned: number
  total: number
  /** 整体进度 0~100（按枚数） */
  percent: number
  /** 最近解锁（按日期倒序，最多 3 条） */
  recent: AchievementItem[]
  /** 最接近解锁的待解锁项（跨分组，percent 倒序，最多 3 条） */
  closest: AchievementItem[]
}

function toItem(def: AchievementDef, earnedAt: string | undefined, ctx: AchievementContext): AchievementItem {
  const earned = earnedAt !== undefined
  const silhouetted = !!def.hidden && !earned

  if (silhouetted) {
    return {
      id: def.id,
      icon: '🔒',
      title: '？？？',
      desc: '达成后揭晓',
      category: def.category,
      earned: false,
      unlockedAt: '',
      silhouetted: true,
      current: 0,
      target: 1,
      percent: 0,
      hint: '达成后揭晓',
    }
  }

  const m = progressOf(def.id, ctx)
  const current = m?.current ?? 0
  const target = m?.target ?? 1
  // ★ 未获得时上限 **99**：`current/target` 四舍五入可能算出 100（如 999/1000），
  // 那会渲染出"进度条满格但徽章没亮"——正是本模块最想避免的观感。
  // 未获得 ⇒ current < target（与 check 等价）⇒ 进度条永远差一点点，语义自洽。
  const percent = earned
    ? 100
    : target > 0
      ? Math.max(0, Math.min(99, Math.round((current / target) * 100)))
      : 0

  return {
    id: def.id,
    icon: def.icon,
    title: def.title,
    desc: def.desc,
    category: def.category,
    earned,
    unlockedAt: earnedAt ?? '',
    silhouetted: false,
    current,
    target,
    percent,
    hint: earned ? '已获得' : (m?.hint ?? def.desc),
  }
}

/**
 * 组装成就图鉴。
 *
 * @param ctx     当前数据上下文（**必须实时构建**，不要缓存）
 * @param records 已解锁记录（持久化来源）
 */
export function buildAchievementView(
  ctx: AchievementContext,
  records: UnlockedRecord[],
): AchievementView {
  const at = new Map<string, string>()
  for (const r of records ?? []) at.set(r.id, r.unlockedAt ?? '')

  const groups: AchievementGroup[] = CATEGORY_ORDER.map((category) => {
    const items = ACHIEVEMENTS.filter((a) => a.category === category).map((a) =>
      toItem(a, at.get(a.id), ctx),
    )
    const earned = items.filter((i) => i.earned).length
    const closest = items
      .filter((i) => !i.earned && !i.silhouetted)
      .sort((a, b) => b.percent - a.percent || a.target - b.target)[0] ?? null
    return { ...CATEGORY_META[category], earned, total: items.length, items, closest }
  })

  const all = groups.flatMap((g) => g.items)
  const earned = all.filter((i) => i.earned).length

  const recent = all
    .filter((i) => i.earned)
    .sort((a, b) => {
      if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt)
      if (a.unlockedAt) return -1
      if (b.unlockedAt) return 1
      return 0
    })
    .slice(0, 3)

  const closest = all
    .filter((i) => !i.earned && !i.silhouetted)
    .sort((a, b) => b.percent - a.percent || a.target - b.target)
    .slice(0, 3)

  return {
    groups,
    earned,
    total: all.length,
    percent: all.length > 0 ? Math.round((earned / all.length) * 100) : 0,
    recent,
    closest,
  }
}
