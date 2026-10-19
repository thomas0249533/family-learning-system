/**
 * 成就分类学（V1.3 · A-01）：`source`（来源）× `tier`（稀有层级）
 *
 * ## 为什么是"两套正交分类"而不是合并成一套
 * 方案原文的「系统核心 / 学科 / 坚持习惯 / 隐藏」回答的是**来源**（这枚从哪来、
 * 未来能不能被 JSON 包扩展）；M/G/B/E 回答的是**动机类型**（它在奖励哪种心理机制）。
 * 两者正交：`streak-7` 既是「坚持习惯」也是「行为塑造」。混成一套会丢信息，
 * 所以 M/G/B/E 保持唯一分类，`source` / `tier` 是**附加的只读派生字段**。
 *
 * ## 零数据迁移
 * 两个字段都不写进 IndexedDB，只在本文件的静态表里声明。已解锁记录
 * （`{ id, unlockedAt, evidence? }`）完全不需要改动 —— 表变了，旧记录照常匹配。
 *
 * ## 层级为什么是"算出来"而不是"写死"
 * PRD §4.2 定的是一套**按优先级命中即停**的规则（隐藏 > 稀有 > 进阶 > 常见）。
 * 如果直接手写 28 个 `tier`，规则就只活在文档里，改一次门槛要人工核对 28 条。
 * 这里拆成：`TIER_FACTS`（每枚的**事实**：目标值 / 连续门槛 / 掌握率门槛 /
 * 学科数 / 是否跨学期 / 是否隐藏 / 是否"首次发生"）+ `deriveTier(facts)`（规则）。
 * 好处是层级可以被穷举单测（28/28 与 PRD §4.5 的表逐条比对），
 * 而且"为什么这枚是稀有"永远能答出一句人话（"因为要连续 30 天"）。
 *
 * ## 层级只做视觉，不做语义
 * 儿童视图里**不出现**"稀有 / 史诗 / SSR"字样 —— 那会制造人为稀缺，
 * 把"学得好"偷换成"运气好"。层级只通过边框粗细、星标数量、底色软填充表达，
 * 并给 `aria-label` 一句中性描述（"层级：进阶"）作为色觉冗余。
 */
import { ACHIEVEMENTS } from './achievements'

/** 来源：决定"这枚成就从哪来"，未来 JSON 包过滤 / 家长端筛选 / 导入冲突判断都靠它 */
export type AchievementSource = 'core' | 'subject' | 'habit' | 'hidden'

/** 稀有层级：由**证据难度**决定，与概率无关（本轮没有随机） */
export type AchievementTier = 'common' | 'advanced' | 'rare' | 'hidden'

export interface SourceMeta {
  label: string
  desc: string
}

export const SOURCE_META: Record<AchievementSource, SourceMeta> = {
  core: { label: '系统核心', desc: '产品内置的机制型成就（答题 / 错题 / 复习）' },
  subject: { label: '学科积累', desc: '跟着内容资产增长的成就（知识点 / 题型 / 学期）' },
  habit: { label: '坚持习惯', desc: '靠连续天数堆出来的成就' },
  hidden: { label: '隐藏', desc: '达成前不揭晓' },
}

export interface TierMeta {
  /** 中文名（**仅家长视图使用**，儿童视图不出现） */
  label: string
  /** 星标数量（非颜色编码，色觉冗余） */
  stars: number
  /** 给读屏的中性描述 */
  ariaSuffix: string
}

export const TIER_META: Record<AchievementTier, TierMeta> = {
  common: { label: '常见', stars: 0, ariaSuffix: '层级：常见' },
  advanced: { label: '进阶', stars: 1, ariaSuffix: '层级：进阶' },
  rare: { label: '稀有', stars: 2, ariaSuffix: '层级：稀有' },
  hidden: { label: '隐藏', stars: 0, ariaSuffix: '' }, // 隐藏成就不额外标注，否则等于泄底
}

/**
 * 判定层级用到的**事实**（不是层级本身）。
 * 全部可选：不填即视为 0 / false，这样绝大多数条目只写关心的那一两项。
 */
export interface TierFacts {
  hidden?: boolean
  /** 目标值（累计类门槛） */
  target?: number
  /** 连续天数 / 连续次数门槛 */
  streak?: number
  /** 掌握率门槛（百分数） */
  masteryRate?: number
  /** 需覆盖的学科数 */
  subjectCount?: number
  /** 需跨学期 */
  crossTerm?: boolean
  /**
   * "首次发生"类事件（`senior-new`）。命中即归「常见」——
   * 它奖励的是"迈出去"，不是"走得远"；层级衡量证据强度，不衡量事件新奇度。
   */
  firstOccurrence?: boolean
}

/**
 * 层级判定（PRD §4.2）：按优先级**自上而下命中即停**。
 * 穷举单测在 `tests/achievement-taxonomy.test.ts`（28/28 与 PRD 表比对）。
 */
export function deriveTier(f: TierFacts): AchievementTier {
  if (f.hidden === true) return 'hidden'
  if (f.firstOccurrence === true) return 'common'

  if (
    (f.target ?? 0) >= 50 ||
    (f.streak ?? 0) >= 30 ||
    (f.masteryRate ?? 0) >= 50 ||
    (f.subjectCount ?? 0) >= 3
  ) {
    return 'rare'
  }

  if ((f.target ?? 0) >= 5 || (f.streak ?? 0) >= 5 || f.crossTerm === true) return 'advanced'

  return 'common'
}

interface TaxonomyRow {
  source: AchievementSource
  facts: TierFacts
}

/**
 * 28 枚逐条事实表（`source` + 层级判定所需事实）。
 * `tests/achievement-taxonomy.test.ts` 断言：覆盖率 28/28、来源分布
 * 7/13/5/3、层级分布 5/11/9/3，且与 PRD §4.5 的表格逐条一致。
 */
export const TAXONOMY: Record<string, TaxonomyRow> = {
  // ---------- M 精熟目标：入门锚点属核心，累计量与学科覆盖属学科 ----------
  'first-step': { source: 'core', facts: { target: 1 } },
  'ten-kp': { source: 'subject', facts: { target: 10 } },
  'fifty-kp': { source: 'subject', facts: { target: 50 } },
  'hundred-kp': { source: 'subject', facts: { target: 100 } },
  'kp-300': { source: 'subject', facts: { target: 300 } },
  'subject-master-3': { source: 'subject', facts: { subjectCount: 3 } },
  'perfect-kp': { source: 'core', facts: { target: 10 } },
  'mastery-half': { source: 'subject', facts: { masteryRate: 50 } },

  // ---------- G 成长型思维：错题机制是产品内置 → 核心；规模化攻克属学科证据 ----------
  'mistake-first': { source: 'core', facts: { target: 1 } },
  'mistake-cleaner': { source: 'subject', facts: { target: 10 } },
  'mistake-cleaner-50': { source: 'subject', facts: { target: 50 } },
  comeback: { source: 'hidden', facts: { hidden: true } },
  'review-20': { source: 'core', facts: { target: 20 } },
  patience: { source: 'core', facts: { target: 30 } },
  'streak-master': { source: 'core', facts: { target: 5 } },

  // ---------- B 行为塑造：连续天数即坚持习惯；单日题量是一次性行为 → 核心 ----------
  'streak-3': { source: 'habit', facts: { streak: 3 } },
  'streak-7': { source: 'habit', facts: { streak: 7 } },
  'streak-30': { source: 'habit', facts: { streak: 30 } },
  'streak-60': { source: 'habit', facts: { streak: 60 } },
  'streak-100': { source: 'habit', facts: { streak: 100 } },
  'early-bird': { source: 'hidden', facts: { hidden: true } },
  'night-owl': { source: 'hidden', facts: { hidden: true } },
  'daily-20': { source: 'core', facts: { target: 20 } },

  // ---------- E 探索：探索对象是内容资产（包 / 题型 / 学期 / 学科）----------
  'explorer-3': { source: 'subject', facts: { target: 3 } },
  'explorer-10': { source: 'subject', facts: { target: 10 } },
  'type-collector': { source: 'subject', facts: { target: 5 } },
  'term-cross': { source: 'subject', facts: { target: 2, crossTerm: true } },
  'senior-new': { source: 'subject', facts: { target: 1, firstOccurrence: true } },
}

/** 来源（未知 id 退化为 `core`，避免 UI 出现空白标签） */
export function sourceOf(id: string): AchievementSource {
  return TAXONOMY[id]?.source ?? 'core'
}

/** 层级（**由事实算出**，不是手写值） */
export function tierOf(id: string): AchievementTier {
  return deriveTier(TAXONOMY[id]?.facts ?? {})
}

/** 层级星标数量（非颜色编码） */
export function tierStars(id: string): number {
  return TIER_META[tierOf(id)].stars
}

/** 未登记在分类学表里的成就 id（正常应为空数组） */
export function missingTaxonomy(): string[] {
  return ACHIEVEMENTS.filter((a) => !TAXONOMY[a.id]).map((a) => a.id)
}
