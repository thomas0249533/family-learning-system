/**
 * 今日任务编排（V3.0 · M1）—— 「今天该做什么」的**唯一实现**
 * ---------------------------------------------------------------------
 * ## 为什么需要这个文件
 * V3.0 之前，首页把「到期复习 / 最需要复习 / 今日推荐」三块**并排展示**，
 * 每一块都是"更多信息"，合起来却回答不了一个最简单的问题：
 * **今天要做几项、按什么顺序、做到哪算完？**
 *
 * 孩子面对三个列表时的真实行为是：点第一个看着顺眼的，做两题，退出。
 * 系统因此永远拿不到"今天完成了多少"这个数 —— 打卡、周报、成就都只能说
 * "你今天做了 7 题"，说不出"你今天做完了 7/24"。
 *
 * 本文件把这三块合并成**一条有序队列 + 一个目标**，并负责**裁剪**：
 * 到期 40 张卡时不排 40 张（那等于劝退），而是按逾期程度取前几张，
 * 剩下的明天还在。这是"节奏"与"信息"的区别。
 *
 * ## 为什么是纯函数、零 Vue 零 db
 * 与 `core/learning/cardStatus.ts` 同一纪律：单测跑在 node 环境（本机无 jsdom），
 * 任何 `ref()` / `db.*` 都会把断言拖进浏览器语境。编排规则是**产品规则**，
 * 必须能被一组固定输入断言出来（`tests/daily-plan.test.ts`）。
 * 读库、拼候选、落盘都在 `dailyPlanService.ts`。
 *
 * ## 三条不变量
 * 1. **同日冻结**：队列一旦生成，当天不再因为"做题导致到期集合变化"而重排
 *    （否则每做完一项，剩下的顺序就变一次，孩子会觉得列表在抽风）。
 *    冻结由 IO 层负责落盘，本文件只提供 `isPlanStale`。
 * 2. **至少一项**：只要还有候选，队列就不能是空的 —— 哪怕目标只剩 1 题、
 *    哪怕第一项的题量超过目标。空队列会让"开始学习"变成死按钮。
 * 3. **优先级不越级**：到期复习永远排在未学新内容之前。复习是"会忘的"，
 *    新学是"还没学的"，前者有时间成本，后者没有。
 * 4. **新学不可饿死**：只要还有没学过的内容，队列里就有它一项的位置
 *    （预算先扣预留）。否则"高优先级贪婪填充"会让旧账永远还不完。
 */

// ===========================================================================
// 类型
// ===========================================================================

/** 任务类型：与「为什么排它」一一对应 */
export type PlanItemKind = 'review' | 'mistake' | 'weak' | 'new'

/** 每日目标口径（V3.0 · M1：两种都要，设置里可切换） */
export type GoalMode = 'questions' | 'minutes'

export interface DailyGoal {
  mode: GoalMode
  /** 题量口径下的目标题数 */
  questions: number
  /** 时长口径下的目标分钟数 */
  minutes: number
}

/** 编排候选：由 IO 层从 progress / mistakes / 包结构拼出来 */
export interface PlanCandidate {
  kind: PlanItemKind
  packageId: string
  unitId: string
  topicId?: string
  knowledgePointId?: string
  /** 主标题：复习/错题/弱项用知识点标题，新学用单元名 */
  title: string
  /** 副标题：`学科 · 包名`（IO 层拼好，本层不查包） */
  subtitle: string
  /** 逾期天数（review 用；其余传 undefined） */
  overdueDays?: number
  /** 待攻克错题数（mistake 用） */
  pendingMistakes?: number
  /** 掌握概率 0..1（weak 用；无采集传 null） */
  mastery?: number | null
  /** 单元/主题的原始顺序（new 用；按教材顺序推进） */
  order?: number
  /** 该候选最多能出几道题（题库为空则传 0，会被跳过） */
  availableQuestions: number
}

export interface DailyPlanItem {
  /** 稳定键：完成标记靠它，**跨天不变**（同一天内绝不重复） */
  id: string
  kind: PlanItemKind
  packageId: string
  unitId: string
  topicId?: string
  knowledgePointId?: string
  title: string
  subtitle: string
  /** 「为什么给我排这个」——必须是人话，家长能读懂 */
  reason: string
  /** 计划题量（按该类型的标准题量与实际可出题数取小） */
  questions: number
  /** 预计分钟 */
  minutes: number
}

export interface DailyPlanTotals {
  questions: number
  minutes: number
}

export interface DailyPlan {
  version: 1
  /** 本地日 YYYY-MM-DD */
  date: string
  goal: DailyGoal
  items: DailyPlanItem[]
  /** 已完成项 id（顺序即完成顺序） */
  doneIds: string[]
  /** 计划总量（items 求和） */
  totals: DailyPlanTotals
  /**
   * 实际完成量（比 `totals` 更可信的"孩子真的做了多少"）。
   * 由 `markItemDone` 累加，加练（不算进计划的题）不进这里。
   */
  done: DailyPlanTotals
  builtAt: number
}

// ===========================================================================
// 常量
// ===========================================================================

/** 默认目标：24 题 / 20 分钟。双口径都存，切换时不用重算另一个。 */
export const DEFAULT_GOAL: DailyGoal = { mode: 'questions', questions: 24, minutes: 20 }

/** 目标上下界（防止设置页填出 0 或 999） */
export const GOAL_LIMITS = {
  questions: { min: 5, max: 120 },
  minutes: { min: 5, max: 180 },
} as const

/**
 * 每类任务的**标准题量与耗时**。
 *
 * 为什么用常量而不是"看看这个知识点有几道题就排几道"：题库大小差异极大
 * （词汇包一个 KP 只有 1 道默写，数学一个 KP 可能有 8 道），按实际排会让
 * 队列长度完全不可预测 —— 词汇包排 40 项、数学包排 3 项。这里给的是
 * "一道典型的复习任务长什么样"，实际题量再用 `availableQuestions` 封顶。
 */
export const KIND_COST: Record<PlanItemKind, DailyPlanTotals> = {
  review: { questions: 3, minutes: 2 },
  mistake: { questions: 3, minutes: 3 },
  weak: { questions: 4, minutes: 3 },
  new: { questions: 6, minutes: 5 },
}

/**
 * 第一轮配额：保证四类任务都能"上桌"，不被高优先级的那类独吞。
 * `new` 不设配额 —— 它就是剩下多少拿多少，因为它是唯一"不补会欠账"的一类。
 */
export const KIND_QUOTA: Record<Exclude<PlanItemKind, 'new'>, number> = {
  review: 0.5,
  mistake: 0.25,
  weak: 0.15,
}

/** 优先级顺序（数组顺序即优先级，不要改成对象字面量遍历 —— 那依赖插入顺序） */
export const KIND_ORDER: PlanItemKind[] = ['review', 'mistake', 'weak', 'new']

/**
 * 第二轮允许的软溢出**只对时长口径生效**：目标 20 分钟时塞到 24 分钟可以接受，
 * 为了"卡在 19/20 分钟却再也放不下一项"留 8 分钟空档不可接受。
 *
 * 题量口径**严格不超**：家长设了 24 题，给 28 题就是没听指令（而且题量是整数，
 * 不存在"差一点点"的问题）。
 */
export const OVERFLOW_TOLERANCE = 0.2

export const KIND_LABEL: Record<PlanItemKind, string> = {
  review: '复习',
  mistake: '错题',
  weak: '弱项',
  new: '新学',
}

// ===========================================================================
// 目标
// ===========================================================================

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * 归一化目标（设置页 / 老数据 / 备份导入都走这里）。
 *
 * 非法 `mode` 回落到 `questions`：题量口径不依赖设备快慢，是更稳的默认值。
 * 两个数字**都保留**——切换口径时不至于把另一个清零。
 */
export function normalizeGoal(raw?: Partial<DailyGoal> | null): DailyGoal {
  const mode: GoalMode = raw?.mode === 'minutes' ? 'minutes' : 'questions'
  return {
    mode,
    questions: clampInt(
      raw?.questions,
      GOAL_LIMITS.questions.min,
      GOAL_LIMITS.questions.max,
      DEFAULT_GOAL.questions
    ),
    minutes: clampInt(
      raw?.minutes,
      GOAL_LIMITS.minutes.min,
      GOAL_LIMITS.minutes.max,
      DEFAULT_GOAL.minutes
    ),
  }
}

/** 当前口径下的预算（题数或分钟），裁剪与进度都用它 */
export function budgetOf(goal: DailyGoal): { unit: GoalMode; value: number } {
  return goal.mode === 'minutes'
    ? { unit: 'minutes', value: goal.minutes }
    : { unit: 'questions', value: goal.questions }
}

function costIn(cost: DailyPlanTotals, unit: GoalMode): number {
  return unit === 'minutes' ? cost.minutes : cost.questions
}

// ===========================================================================
// 候选排序
// ===========================================================================

function compareCandidate(a: PlanCandidate, b: PlanCandidate): number {
  switch (a.kind) {
    case 'review': {
      // 逾期越久越先做；同逾期按标题稳定排序（避免每次重排顺序抖动）
      const d = (b.overdueDays ?? 0) - (a.overdueDays ?? 0)
      return d !== 0 ? d : a.title.localeCompare(b.title)
    }
    case 'mistake': {
      const d = (b.pendingMistakes ?? 0) - (a.pendingMistakes ?? 0)
      return d !== 0 ? d : a.title.localeCompare(b.title)
    }
    case 'weak': {
      // 掌握概率低的先做；没有采集值（null）排最后，不当成 0
      const am = a.mastery === null || a.mastery === undefined ? 1 : a.mastery
      const bm = b.mastery === null || b.mastery === undefined ? 1 : b.mastery
      const d = am - bm
      return d !== 0 ? d : a.title.localeCompare(b.title)
    }
    case 'new':
    default: {
      const d = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
      return d !== 0 ? d : a.title.localeCompare(b.title)
    }
  }
}

// ===========================================================================
// 理由文案
// ===========================================================================

/**
 * 「为什么排它」。四类各有确切的**事实来源**，不许写"系统推荐"这种空话 ——
 * 孩子问"凭什么先做这个"，家长要能指着屏幕念出来。
 */
export function reasonOf(c: PlanCandidate): string {
  switch (c.kind) {
    case 'review':
      if (c.overdueDays && c.overdueDays > 0) {
        return c.overdueDays === 1 ? '昨天到期，趁还没忘' : `逾期 ${c.overdueDays} 天`
      }
      return '今天到期，复习一下'
    case 'mistake': {
      const n = c.pendingMistakes ?? 0
      return n > 0 ? `还有 ${n} 道错题没攻克` : '巩固之前的错题'
    }
    case 'weak': {
      if (typeof c.mastery === 'number') {
        return `掌握度 ${Math.round(c.mastery * 100)}%，还不稳`
      }
      return '练得少，再看一遍'
    }
    case 'new':
    default:
      return '还没学过'
  }
}

// ===========================================================================
// item id
// ===========================================================================

/**
 * 稳定键。**同一天内绝不重复**，跨天可以重复（完成标记按天存）。
 *
 * 用 `\u0000` 分隔：kpId 自身含 `::`，标题里可能含任意字符，
 * 只有 NUL 不会出现在任何一层的字面量里（与 `ownerIndex.KEY_SEP` 同一约定）。
 */
export function planItemId(c: {
  kind: PlanItemKind
  packageId: string
  unitId: string
  topicId?: string
  knowledgePointId?: string
}): string {
  return [c.kind, c.packageId, c.unitId, c.topicId ?? '', c.knowledgePointId ?? ''].join('\u0000')
}

// ===========================================================================
// 编排
// ===========================================================================

export interface BuildPlanInput {
  /** 本地日 YYYY-MM-DD（由调用方给，便于测试与"本地口径"纪律） */
  date: string
  goal?: Partial<DailyGoal> | null
  candidates: PlanCandidate[]
  /** 生成时刻（ms），默认 0 以便测试断言（IO 层会传 Date.now()） */
  builtAt?: number
  /** 每类条数硬上限（防止"1 题 1 项"的极小目标下塞进几十个 0.5 分钟项） */
  maxItems?: number
}

/**
 * 生成今日队列。
 *
 * 三轮填充：
 * - **预留**：只要还有未学内容，先从预算里划出一项新学的钱（`workBudget`）；
 * - **第一轮**按配额，让复习/错题/弱项都上桌（详见 `KIND_QUOTA`）；
 * - **第二轮**用 `workBudget` 剩下的额度按优先级继续填；
 * - **第三轮**填新学（含预留额度 + 前两轮没花完的余额）。
 *
 * 最后兜底：队列为空但仍有候选 → 强制放第一项（不变量 2）。
 */
export function buildDailyPlan(input: BuildPlanInput): DailyPlan {
  const goal = normalizeGoal(input.goal)
  const { unit, value } = budgetOf(goal)
  const maxItems = input.maxItems ?? 12

  // 只留能出题的候选：availableQuestions <= 0 意味着题目被删/包重导，
  // 排进去会得到一个点开就空的项
  const usable = (input.candidates ?? []).filter(
    (c) => Number.isFinite(c.availableQuestions) && c.availableQuestions > 0
  )

  const byKind = new Map<PlanItemKind, PlanCandidate[]>()
  for (const kind of KIND_ORDER) byKind.set(kind, [])
  for (const c of usable) byKind.get(c.kind)?.push(c)
  for (const list of byKind.values()) list.sort(compareCandidate)

  const picked: DailyPlanItem[] = []
  const cursor = new Map<PlanItemKind, number>()
  for (const kind of KIND_ORDER) cursor.set(kind, 0)
  const used: DailyPlanTotals = { questions: 0, minutes: 0 }
  const kindUsed: Record<PlanItemKind, number> = { review: 0, mistake: 0, weak: 0, new: 0 }

  const toItem = (c: PlanCandidate): DailyPlanItem => {
    const std = KIND_COST[c.kind]
    const questions = Math.max(1, Math.min(std.questions, c.availableQuestions))
    // 题量被题库封顶时，耗时按比例缩（3 题 2 分钟的复习只出 1 题 → 约 1 分钟）
    const minutes =
      std.questions > 0
        ? Math.max(1, Math.round((std.minutes * questions) / std.questions))
        : std.minutes
    return {
      id: planItemId(c),
      kind: c.kind,
      packageId: c.packageId,
      unitId: c.unitId,
      topicId: c.topicId,
      knowledgePointId: c.knowledgePointId,
      title: c.title,
      subtitle: c.subtitle,
      reason: reasonOf(c),
      questions,
      minutes,
    }
  }

  /**
   * 放一项进队列。
   * @param kindLimit 该类的**累计**上限（第一轮 = 配额；第二轮 = Infinity）
   * @param totalLimit 全队列的**累计**上限（第一轮 = 硬目标；第二轮 = 软溢出上限）
   */
  const tryPush = (kind: PlanItemKind, kindLimit: number, totalLimit: number): boolean => {
    const list = byKind.get(kind) ?? []
    const i = cursor.get(kind) ?? 0
    if (i >= list.length) return false
    const item = toItem(list[i])
    const delta = costIn({ questions: item.questions, minutes: item.minutes }, unit)
    if (picked.length >= maxItems) return false
    if (kindUsed[kind] + delta > kindLimit) return false
    const usedTotal = unit === 'minutes' ? used.minutes : used.questions
    if (usedTotal + delta > totalLimit) return false
    picked.push(item)
    cursor.set(kind, i + 1)
    kindUsed[kind] += delta
    used.questions += item.questions
    used.minutes += item.minutes
    return true
  }

  // ---- 新学预留 ----
  // 只要还有没学过的内容，就从预算里**先划出一项新学的钱**。
  //
  // 为什么必须有这一步：复习与错题的供给是"无限的"（到期卡 40 张、错题 30 道），
  // 纯按优先级贪婪填充会把 24 题全花在旧账上，`new` 因为单项就要 6 题而永远排不进来。
  // 结果是孩子天天在还债、一个单元都推进不了 —— 这正是 V2.x 首页三块并列时的真实行为。
  const newList = byKind.get('new') ?? []
  const newReserve = newList.length > 0 ? firstCostOf(newList, unit) : 0
  /** 复习/错题/弱项可用的预算（已扣掉新学预留） */
  const workBudget = Math.max(0, value - newReserve)

  // ---- 第一轮：配额（配额基数用 workBudget，不是整份预算） ----
  for (const kind of KIND_ORDER) {
    if (kind === 'new') continue
    const quota = Math.max(KIND_QUOTA[kind] * workBudget, 0)
    let guard = 0
    // 配额小于一项成本时，允许放**恰好一项**（否则目标小的时候这类永远上不了桌）
    const firstCost = firstCostOf(byKind.get(kind) ?? [], unit)
    const effective = Math.max(quota, firstCost)
    // 单类放一项都不够预算时，仍允许越过 workBudget 一项 —— 见不变量 2「至少一项」
    const totalCap = Math.max(workBudget, picked.length === 0 ? firstCost : workBudget)
    while (guard++ < 50 && tryPush(kind, effective, totalCap)) {
      /* 继续填到配额用尽 */
    }
  }

  // ---- 第二轮：workBudget 里剩下的额度按优先级继续填（不含 new） ----
  const softLimit =
    unit === 'minutes' ? Math.ceil(workBudget * (1 + OVERFLOW_TOLERANCE)) : workBudget
  let progress = true
  while (progress && picked.length < maxItems) {
    progress = false
    for (const kind of KIND_ORDER) {
      if (kind === 'new') continue
      while (tryPush(kind, Number.POSITIVE_INFINITY, softLimit)) progress = true
    }
  }

  // ---- 第三轮：填新学（用它预留出来的额度 + 前面没用完的余额） ----
  {
    const newLimit = unit === 'minutes' ? Math.ceil(value * (1 + OVERFLOW_TOLERANCE)) : value
    let guard = 0
    while (guard++ < 50 && tryPush('new', Number.POSITIVE_INFINITY, newLimit)) {
      /* 教材顺序推进，能放几项放几项 */
    }
  }

  // ---- 兜底：至少一项 ----
  if (picked.length === 0 && usable.length > 0) {
    const first = KIND_ORDER.map((k) => (byKind.get(k) ?? [])[0]).find(Boolean)
    if (first) picked.push(toItem(first))
  }

  const totals = picked.reduce<DailyPlanTotals>(
    (acc, it) => ({ questions: acc.questions + it.questions, minutes: acc.minutes + it.minutes }),
    { questions: 0, minutes: 0 }
  )

  return {
    version: 1,
    date: input.date,
    goal,
    items: picked,
    doneIds: [],
    totals,
    done: { questions: 0, minutes: 0 },
    builtAt: input.builtAt ?? 0,
  }
}

function firstCostOf(list: PlanCandidate[], unit: GoalMode): number {
  const c = list[0]
  if (!c) return 0
  const std = KIND_COST[c.kind]
  const questions = Math.max(1, Math.min(std.questions, c.availableQuestions))
  const minutes =
    std.questions > 0 ? Math.max(1, Math.round((std.minutes * questions) / std.questions)) : std.minutes
  return costIn({ questions, minutes }, unit)
}

// ===========================================================================
// 完成标记 / 查询
// ===========================================================================

/**
 * 计划是否已过期（跨天 / 目标数字被改）。IO 层据此决定重算。
 *
 * **切换口径不重算**：队列内容与目标数字都没变，变的只是"进度分母用哪个"，
 * 重算等于把已经完成的项清空 —— 那是数据丢失，不是刷新。
 */
export function isPlanStale(plan: DailyPlan | null | undefined, today: string, goal?: DailyGoal): boolean {
  if (!plan || plan.version !== 1) return true
  if (plan.date !== today) return true
  if (goal && (plan.goal.questions !== goal.questions || plan.goal.minutes !== goal.minutes)) return true
  return false
}

/**
 * 标记某项完成（**幂等**：重复标记不累加）。
 *
 * 纯函数，返回新对象 —— 调用方（service）负责落盘。传 `actual` 可以把
 * "计划 3 题、实际做了 4 题"的真实值记进 `done`，进度环因此不会撒谎。
 */
export function markItemDone(
  plan: DailyPlan,
  itemId: string,
  actual?: { questions?: number; minutes?: number }
): DailyPlan {
  if (plan.doneIds.includes(itemId)) return plan
  const item = plan.items.find((it) => it.id === itemId)
  if (!item) return plan
  const q = Math.max(0, Math.round(actual?.questions ?? item.questions))
  const m = Math.max(0, actual?.minutes ?? item.minutes)
  return {
    ...plan,
    doneIds: [...plan.doneIds, itemId],
    done: { questions: plan.done.questions + q, minutes: plan.done.minutes + m },
  }
}

export interface PlanProgress {
  doneItems: number
  totalItems: number
  doneQuestions: number
  totalQuestions: number
  /** 0..1，按当前口径算（题量或分钟） */
  ratio: number
  remaining: number
  finished: boolean
}

/** 进度（进度环 + 「还剩 X 题」都读它，避免两处各算一遍） */
export function planProgress(plan: DailyPlan): PlanProgress {
  const { unit, value } = budgetOf(plan.goal)
  const done = unit === 'minutes' ? plan.done.minutes : plan.done.questions
  const total = unit === 'minutes' ? plan.totals.minutes : plan.totals.questions
  const ratio = total > 0 ? Math.min(1, done / total) : plan.items.length > 0 && plan.doneIds.length === plan.items.length ? 1 : 0
  return {
    doneItems: plan.doneIds.length,
    totalItems: plan.items.length,
    doneQuestions: plan.done.questions,
    totalQuestions: plan.totals.questions,
    ratio,
    remaining: Math.max(0, value - done),
    finished: plan.items.length > 0 && plan.doneIds.length >= plan.items.length,
  }
}

/** 下一项未完成的任务（"开始学习"按钮点下去进这个） */
export function nextPendingItem(plan: DailyPlan): DailyPlanItem | null {
  return plan.items.find((it) => !plan.doneIds.includes(it.id)) ?? null
}

/** 按类型统计队列构成（首页副标题：「复习 4 · 错题 1 · 新学 1」） */
export function kindBreakdown(plan: DailyPlan): Record<PlanItemKind, number> {
  const out: Record<PlanItemKind, number> = { review: 0, mistake: 0, weak: 0, new: 0 }
  for (const it of plan.items) out[it.kind] += 1
  return out
}

/** 空队列时的文案（区分"真的没事"与"候选全被过滤掉"） */
export function emptyPlanHint(goal: DailyGoal): string {
  return goal.mode === 'minutes'
    ? '今天没有到期的内容，去自由练习也能攒时间'
    : '今天没有到期的内容，去自由练习也能攒题数'
}
