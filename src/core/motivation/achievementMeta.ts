/**
 * 成就的**展示视图模型**（V1.3 · A-04 / A-05）
 *
 * 分工：
 *   - `achievements.ts`         → 判定（`check`）+ 持久化（`syncAchievements`）
 *   - `achievementProgress.ts`  → 进度（`progressOf` / `progressText` / `evidenceOf`）
 *   - `achievementTaxonomy.ts`  → 静态分类（`source` / `tier`）
 *   - 本文件                     → 把上面三者拼成**一份可直接渲染的数据**
 *
 * 组件里不允许再做任何成就相关的判断或计算：文案、排序、分区、空态全部在这里定，
 * 这样"同一份数据在不同页面显示不一致"从结构上就不可能出现。
 *
 * ## 铁律：进度只算当前值，禁止缓存历史最大值
 * 曾经想过"记住最大值，避免孩子退步时进度回退"，但那会让
 * `current >= target ⇔ check(ctx)` 破裂（缓存值达标 ≠ 现在真的满足条件），
 * 于是会出现"进度条满了却永远不亮"。正确做法：进度诚实地跟着数据走；
 * **已解锁的徽章永不回收**（`syncAchievements` 只增不删），所以孩子看到
 * "已获得"的那一枚不会因为退步而消失，只是待解锁的进度会回退 —— 那恰恰是真实状态。
 */
import {
  ACHIEVEMENTS,
  isCollectible,
  normalizeRepeatCount,
  type AchievementCategory,
  type AchievementContext,
  type AchievementDef,
  type UnlockedRecord,
} from './achievements'
import { progressOf, progressText, type Measure } from './achievementProgress'
import {
  TIER_META,
  sourceOf,
  tierOf,
  type AchievementSource,
  type AchievementTier,
} from './achievementTaxonomy'
import { CHAINS } from './chains'

export type { AchievementCategory, AchievementSource, AchievementTier }

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

// ==================== 视图类型 ====================

export type AchievementSectionKey = 'earned' | 'pending'

export interface AchievementItem {
  id: string
  icon: string
  title: string
  desc: string
  category: AchievementCategory
  /** 来源（静态派生，不入库） */
  source: AchievementSource
  /** 稀有层级（静态规则算出，不入库） */
  tier: AchievementTier
  /** 星标数量（非颜色编码，色觉冗余） */
  stars: number
  /** 已解锁（**只看持久化记录，绝不因为条件暂时不满足而回收**） */
  earned: boolean
  /** 解锁日期 YYYY-MM-DD；旧数据可能为 '' */
  unlockedAt: string
  /** 证据快照；旧记录为空串 → 卡片不渲染该行 */
  evidence: string
  /** 隐藏成就且未解锁 → 剪影，不泄露任何信息 */
  silhouetted: boolean
  /** 可否进度化（false = 3 枚隐藏成就） */
  metered: boolean
  current: number
  target: number
  /** 0~100；已解锁恒 100，剪影恒 0 */
  percent: number
  /** 进度提示文案（来自 `progressText`，**唯一来源**） */
  hint: string
  /** 连环标记，如「精熟之链 2/5」；不属于任何链为空串 */
  chainLabel: string
  /**
   * 重复达成次数（V1.4 · B6）。**1 = 只达成过一次**，≥2 时卡面显示「第 N 次」。
   *
   * 恒有值（不设 optional）：卡面模板拿它做比较，`undefined >= 2` 虽然也是 false，
   * 但那让"没这个字段"和"第一次"在类型上变成两件事，模板里迟早有人写 `!item.repeatCount`
   * 把第一次当成假值。归一化在 `toItem` 里做一次，下游只读数字。
   */
  repeatCount: number
}

export interface AchievementGroup {
  category: AchievementCategory
  label: string
  desc: string
  icon: string
  /** **该组在本区内的**枚数（已获得区不显示 /总数，总数已在总览条） */
  count: number
  items: AchievementItem[]
  /** 折叠态摘要：本区内"最接近解锁"的那一枚（仅待解锁区有值） */
  closest: AchievementItem | null
  /** 组级引导文案（例如"导入学习包后开始探索"），无则为空串 */
  guide: string
}

export interface AchievementSectionData {
  key: AchievementSectionKey
  label: string
  /** 该区总枚数 */
  count: number
  groups: AchievementGroup[]
  /** 默认是否展开（已获得默认收起、待解锁默认展开） */
  defaultOpen: boolean
}

export interface AchievementFilter {
  /** 关键词（匹配标题/描述；**剪影卡不参与匹配**，不泄底） */
  query?: string
  /** 解锁状态 */
  state?: 'all' | 'earned' | 'pending'
  /** 来源 */
  source?: AchievementSource | 'all'
}

export interface AchievementView {
  /** 已获得枚数（**可收集**口径） */
  earned: number
  /**
   * **可收集**总数（27 + 自定义；不含 `night-owl`）。
   * 定义总数（28）见 `achievements.ts` 的 `ACHIEVEMENT_TOTAL_DEFINED`。
   */
  total: number
  /** 整体进度 0~100（按枚数） */
  percent: number
  /** 可收集的全部解锁 */
  complete: boolean
  /** 一枚都没有（→ 不渲染「已获得」区） */
  empty: boolean
  /** 两个分区：已获得 / 待解锁（空区不出现） */
  sections: AchievementSectionData[]
  /** 是否处于筛选态（关键词 / 状态 / 来源任一非默认） */
  filterActive: boolean
  /** 筛选后可见枚数（未筛选时等于 total） */
  filteredTotal: number
  /** 0 枚（或被筛空）时的引导文案 */
  emptyHint: string
  /** 最近解锁（按日期倒序，最多 3 条） */
  recent: AchievementItem[]
  /** 最接近解锁的待解锁项（跨分组，percent 倒序，最多 3 条） */
  closest: AchievementItem[]
}

// ==================== 单枚成就 → 视图项 ====================

/** 连环标记：`精熟之链 2/5` */
function chainLabelOf(def: AchievementDef): string {
  for (const chain of CHAINS) {
    const i = chain.ids.indexOf(def.id)
    if (i >= 0) return `${chain.name} ${i + 1}/${chain.ids.length}`
  }
  return ''
}

/**
 * 单枚成就的度量（V1.4 · B3 起有两条来源）。
 *
 * - 自定义定义自带 `measure`（家长的 `counter` 规则 / `manual-check` 的 0/1）；
 * - 内置 38 枚没有 `measure` → 回落到 `progressOf`（唯一进度真相）。
 *
 * `def.measure` 是**外部数据驱动的闭包**（规则来自家长导入的 JSON），一次抛错不能把
 * 整页 38 枚一起搞崩 —— 吞掉异常并当作"不可进度化"，卡片仍能正常显示标题与描述。
 */
function measureOf(def: AchievementDef, ctx: AchievementContext): Measure | null {
  if (!def.measure) return progressOf(def.id, ctx)
  try {
    return def.measure(ctx)
  } catch (e) {
    console.warn('[achievementMeta] 自定义成就度量抛错，按不可进度化处理', def.id, e)
    return null
  }
}

function toItem(
  def: AchievementDef,
  record: UnlockedRecord | undefined,
  ctx: AchievementContext,
): AchievementItem {
  const earned = record !== undefined
  const silhouetted = def.hidden === true && !earned
  // 层级/来源：自定义定义自带（`TAXONOMY` 里没有它们的 id），内置则由静态表派生
  const tier = def.tier ?? tierOf(def.id)
  const base = {
    id: def.id,
    category: def.category,
    source: def.source ?? sourceOf(def.id),
    tier,
    stars: TIER_META[tier].stars,
    earned,
    unlockedAt: record?.unlockedAt ?? '',
    chainLabel: earned ? chainLabelOf(def) : '',
    // 剪影恒 1：没解锁的卡不该泄露"这个成就被重复达成过"
    // （隐藏成就的重复次数本身就是信息，等于告诉你"这条路你已经走通过"）
    repeatCount: silhouetted ? 1 : (normalizeRepeatCount(record?.repeatCount) ?? 1),
  }

  // 剪影：**只输出占位文本**，真实 title/desc 连字符串都不进入视图对象，
  // 这样"用 CSS 藏起来但源码里能搜到"的泄底路径不存在（PRD AC-14）。
  if (silhouetted) {
    return {
      ...base,
      icon: '🔒',
      title: '？？？',
      desc: '达成后揭晓',
      evidence: '',
      silhouetted: true,
      metered: false,
      current: 0,
      target: 0,
      percent: 0,
      hint: '达成后揭晓',
    }
  }

  const m: Measure | null = measureOf(def, ctx)
  const current = m?.current ?? 0
  const target = m?.target ?? 0

  // ★ 未获得时上限 **99**：`current/target` 四舍五入可能算出 100（如 99/100），
  // 那会渲染出"进度条满格但徽章没亮"——正是本模块最想避免的观感。
  // 未获得 ⇒ current < target（与 check 等价）⇒ 进度条永远差一点点，语义自洽。
  const percent = earned
    ? 100
    : target > 0
      ? Math.max(0, Math.min(99, Math.round((current / target) * 100)))
      : 0

  return {
    ...base,
    icon: def.icon,
    title: def.title,
    desc: def.desc,
    // 旧记录没有 evidence → 空串 → 卡片不渲染该行（绝不事后补算）
    evidence: record?.evidence ?? '',
    silhouetted: false,
    metered: m !== null,
    current,
    target,
    percent,
    hint: earned ? '已获得' : m ? progressText(m) : def.desc,
  }
}

// ==================== 排序 ====================

/** 已获得：解锁日期倒序（最近拿到的在前），空日期排最后 */
function sortEarned(items: AchievementItem[]): AchievementItem[] {
  return [...items].sort((a, b) => {
    if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt)
    if (a.unlockedAt) return -1
    if (b.unlockedAt) return 1
    return 0
  })
}

/**
 * 待解锁：完成度降序；不可进度化（剪影）排最后；同分保持既有定义顺序。
 * `Array.prototype.sort` 在 ES2019 起是稳定排序，所以"同分按定义顺序"是免费得到的。
 */
function sortPending(items: AchievementItem[]): AchievementItem[] {
  return [...items].sort((a, b) => {
    if (a.silhouetted !== b.silhouetted) return a.silhouetted ? 1 : -1
    return b.percent - a.percent
  })
}

// ==================== 组装 ====================

function buildSection(
  key: AchievementSectionKey,
  label: string,
  defaultOpen: boolean,
  items: AchievementItem[],
  guideFor: (cat: AchievementCategory) => string,
): AchievementSectionData {
  const groups: AchievementGroup[] = CATEGORY_ORDER.map((category) => {
    const inGroup = items.filter((i) => i.category === category)
    const sorted = key === 'earned' ? sortEarned(inGroup) : sortPending(inGroup)
    const closest =
      key === 'pending'
        ? (sorted.find((i) => !i.silhouetted) ?? null)
        : null
    return {
      ...CATEGORY_META[category],
      count: sorted.length,
      items: sorted,
      closest,
      guide: sorted.length > 0 ? guideFor(category) : '',
    }
  }).filter((g) => g.count > 0) // ★ §5.4「某组 0 枚 → 该组不渲染」，避免空白组头

  return { key, label, count: items.length, groups, defaultOpen }
}

/**
 * 组装成就图鉴。
 *
 * @param ctx       当前数据上下文（**必须实时构建**，不要缓存）
 * @param records   已解锁记录（持久化来源）
 * @param filter    筛选条件
 * @param extraDefs 额外定义（V1.4 · B3 自定义包；默认空 = 老行为逐字节不变）。
 *                  放在**最后**而不是第 3 个参数：`filter` 是既有调用点全部会传的位置，
 *                  插在中间等于让所有调用方静默把 filter 当成 extraDefs。
 */
export function buildAchievementView(
  ctx: AchievementContext,
  records: UnlockedRecord[],
  filter?: AchievementFilter,
  extraDefs: AchievementDef[] = [],
): AchievementView {
  return buildAchievementViewFromItems(buildAchievementItems(ctx, records, extraDefs), {
    noPackages: (ctx.packages ?? []).length === 0,
  }, filter)
}

/**
 * 只组装全部卡片（内置定义 + 额外定义），供页面在**已缓存 items** 上反复筛选而不重读库。
 *
 * ⚠️ 这里**必须**产出完整的内置定义（含不参与收集的 `night-owl`）：
 * 它是"定义真相"的投影，AC-01 / taxonomy 的断言与导出图片/打印都按定义枚举。
 * 隐藏它在**视图层**做（`filterAchievementItems` / `buildAchievementViewFromItems`），
 * 数据层保持完整 —— 否则"定义总数 28"与"已解锁但看不到"的矛盾就无处落脚。
 *
 * @param extraDefs 额外定义（V1.4 · B3 自定义包）。追加在内置之后 → 同 category 分组内
 *   保持"内置在前、自定义在后"，与家长"后来装的"直觉一致。
 */
export function buildAchievementItems(
  ctx: AchievementContext,
  records: UnlockedRecord[],
  extraDefs: AchievementDef[] = [],
): AchievementItem[] {
  const at = new Map<string, UnlockedRecord>()
  for (const r of records ?? []) at.set(r.id, r)
  return [...ACHIEVEMENTS, ...extraDefs].map((a) => toItem(a, at.get(a.id), ctx))
}

/** 关键词规范化：合并空白、去首尾、小写（全角空格一并折叠） */
function normalizeQuery(q?: string): string {
  return (q ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 筛选（纯函数，顺序不变）。
 *
 * 三条硬约束：
 *   0. **不参与收集的彩蛋（`night-owl`）在筛选里彻底隐身**（V1.6 · C6）——
 *      放在最前面、无可绕过：`night-owl` 连"筛选出来的空"都不算。
 *      主理人终审原话：「确保它在收集图鉴中彻底隐身」，所以这里**没有开关**，
 *      不要为了"调试方便"给它加一个 includeEggs 参数（那等于给泄底留后门）。
 *   1. **剪影卡不参与关键词匹配** —— 未解锁的隐藏成就连"被搜到"都不该发生，
 *      否则搜一个词命中剪影就等于确认了隐藏成就的存在与数量；
 *   2. 只按状态/来源筛时，剪影卡**照常保留**（它们也是"待解锁"的一部分）。
 */
export function filterAchievementItems(
  items: AchievementItem[],
  filter?: AchievementFilter,
): AchievementItem[] {
  // ★ 第一道闸：可收集过滤（含"无筛选条件"的早退分支，见下）
  const collectible = items.filter((it) => isCollectible(it.id))
  const q = normalizeQuery(filter?.query)
  const state = filter?.state ?? 'all'
  const source = filter?.source ?? 'all'
  // 早退也返回**过滤后**的集合：否则"不筛选"时 night-owl 会原样漏出去
  if (!q && state === 'all' && source === 'all') return collectible

  return collectible.filter((it) => {
    if (state === 'earned' && !it.earned) return false
    if (state === 'pending' && it.earned) return false
    if (source !== 'all' && it.source !== source) return false
    if (q) {
      if (it.silhouetted) return false
      if (!`${it.title} ${it.desc}`.toLowerCase().includes(q)) return false
    }
    return true
  })
}

/**
 * 从**已有的 items** 组装视图（页面筛选走这里，避免每次输入都重算内置定义的进度）。
 *
 * ## 口径分层（容易搞混，写清楚）
 *   - **可收集过滤**：所有统计都只基于 `items.filter(isCollectible)` ——
 *     `night-owl` 不计入分母、不进 `sections`、不进 `recent` / `closest`
 *     （PRD §11.2 + 主理人终审"收集图鉴中彻底隐身"）。数据层
 *     （`buildAchievementItems`）仍然产出含 `night-owl` 的完整 items：
 *     那是定义真相，AC-01 / taxonomy 的断言依赖它；
 *   - `total` / `earned` / `percent` / `complete` / `empty` / `recent` / `closest` → **全量可收集**口径，
 *     筛选不改变"可收集的 27 枚里已得几枚"，否则总览卡会随筛选跳数字；
 *   - `sections` → **筛选后**的可见集合（这才是筛选该影响的）；
 *   - `filterActive` / `filteredTotal` 让页面知道"当前是筛过的空"还是"真的一枚都没有"。
 *
 * ⚠️ 刻意**不**新增 `eggs` / `hidden-egg` 之类的字段来承载 `night-owl`：
 * 终审要求彻底隐身，任何"单独一块彩蛋区"都等于把它重新摆回图鉴。
 */
export function buildAchievementViewFromItems(
  items: AchievementItem[],
  opts: { noPackages?: boolean } = {},
  filter?: AchievementFilter,
): AchievementView {
  const visible = filterAchievementItems(items, filter)
  const filterActive =
    normalizeQuery(filter?.query) !== ''
    || (filter?.state ?? 'all') !== 'all'
    || (filter?.source ?? 'all') !== 'all'

  // ★ 分母口径唯一出口：可收集集合。所有统计都从这里派生，别各算一遍。
  const collectible = items.filter((i) => isCollectible(i.id))
  const earnedAll = collectible.filter((i) => i.earned)
  const pendingAll = collectible.filter((i) => !i.earned)
  const total = collectible.length
  const earned = earnedAll.length
  const complete = total > 0 && earned === total
  const empty = earned === 0

  const guideFor = (cat: AchievementCategory) =>
    opts.noPackages && cat === 'E' ? '导入学习包后开始探索' : ''

  const visibleEarned = visible.filter((i) => i.earned)
  const visiblePending = visible.filter((i) => !i.earned)

  const sections: AchievementSectionData[] = []
  // ★ §5.4：0 枚时不渲染「已获得」区（避免一个空壳分区）
  if (visibleEarned.length > 0) {
    // ★ §5.4：全收集时「已获得」区强制展开、隐藏「待解锁」区
    sections.push(buildSection('earned', '已获得', complete, visibleEarned, guideFor))
  }
  if (visiblePending.length > 0) {
    sections.push(buildSection('pending', '待解锁', true, visiblePending, guideFor))
  }

  const closest = pendingAll
    .filter((i) => !i.silhouetted)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 3)

  return {
    earned,
    total,
    percent: total > 0 ? Math.round((earned / total) * 100) : 0,
    complete,
    empty,
    sections,
    filterActive,
    filteredTotal: visible.length,
    emptyHint: filterActive && visible.length === 0
      ? '没有匹配的成就。换个关键词，或把筛选切回「全部」。'
      : '还没有徽章。掌握第一个知识点，就能拿到第 1 枚。',
    recent: sortEarned(earnedAll).slice(0, 3),
    closest,
  }
}
