/**
 * 「全部完成」判定 —— 每日打卡卡 / 专项练习单元卡的**题目级**完成度
 * -------------------------------------------------------------------------
 * ## 要解决的用户痛点
 *
 * 用户的原话：
 *
 * > 「每日打卡，现在是做过的题目会有这个边框和标识，但是没有全做对的，这种就必须得
 * > 从头再做一遍。这种模式很费时。」
 *
 * 根因是**口径错位**：卡片状态（`cardStatus.ts`）完全由 `progress.status` 聚合，
 * 而 `progress.status` 是**知识点级**的掌握度状态机 —— 判「已掌握」要**连对 3 次**
 * 且正确率 ≥ 80%（或 BKT 提前通道连对 2 次且一次没错）。
 *
 * 但「这一天做完了没有」是**题目级**的问题：一道题做对一次就算做完了。
 * 于是：
 *
 * - 一天 8 道题分 4 个知识点，每个知识点只做 2 题 → 全对也够不着「连对 3 次」→
 *   卡片永远停在「学习中」→ 只能**从头再做一遍**；
 * - 只要错了一道，那个知识点要连对 3 次才能回「已掌握」→ 又是从头重做。
 *
 * ## 本模块的口径
 *
 * > **一个卡片范围内的所有知识点都学过，且该卡片范围内没有「未掌握」的错题
 * > → 判「已掌握」（全部完成）。**
 *
 * 两个条件分别对应用户的两个诉求：
 *
 * 1. **都学过** → 「当日题型全部掌握」：一天全部做对了，本来就该是「全部完成」，
 *    不该因为「连对 3 次」这种为**复习**设计的门槛而卡住。
 * 2. **错题都掌握了** → 「错题本里已掌握，标识就自动更新为全掌握」：
 *    错题在错题本里连续答对 2 次即 `mastered`（见 `@core/mistake/mistakeRules`），
 *    此时卡片自动转绿，**不必把整天重做一遍**。
 *
 * ## 为什么**不**去改 `progress.status`
 *
 * 掌握度状态是 BKT / FSRS / 掌握率统计 / 成就 / 弱项推荐的共同输入。在这条链上
 * 「一键把 status 改成已掌握」会污染全部统计口径（这正是 V2.4「虚拟 Good」踩过的
 * 红线，见 `userData.ts` 的 `markReviewedVirtual` 注释）。
 *
 * 所以本模块是**纯 UI 层的判定**：不写库、不改 progress，卡片显示「已掌握」，
 * 而掌握率统计仍然是原来那套干净口径。
 *
 * ## 手动通道
 *
 * 自动判定解决不了「题目**本来**就是对的，但历史上被判错了」的情况（例如判分缺陷
 * 造成的错题）。所以另有**手动「标记全部完成」**通道，存在独立的表里
 * （`cardCompletions`），与 `progress` 完全隔离，可撤销。
 *
 * ## 纯函数
 *
 * 本仓单测跑在 `environment: 'node'`（无 jsdom / @vue/test-utils），所以判定逻辑
 * 必须是纯函数：输入是进度行、错题行与卡片范围，输出是一个 `CardStatus`。
 */
import type { MistakeRecord, ProgressRecord } from '@/db'
import {
  aggregateCardStatus,
  buildStatusIndex,
  statusOfOwner,
  type CardStatus,
} from '@core/learning/cardStatus'
import { mistakeLevel } from '@core/mistake/mistakeRules'
import type { OwnerIndex } from '@core/progress/ownerIndex'

/** 一张卡片覆盖的范围 */
export interface CompletionScope {
  /** 入口包 id（与 `recordProgress` 第 1 参数同义：谁把用户带进这张卡） */
  entryPackageId: string
  /** 卡片覆盖的知识点 id（**原值**，与 `topic.knowledgePointIds` 同源） */
  kpIds: string[]
  /**
   * 卡片覆盖的题目 id。
   *
   * 为什么需要：错题行的 `knowledgePointIds` 可能是空的（题目没带知识点、或
   * 手工导入的裸 JSON）。这时只靠 kpIds 匹配，那条错题就会**漏出**这张卡的视野 →
   * 「没有未掌握的错题」被误判成立 → 卡片提前变绿。用题目 id 兜底即可堵住。
   */
  exerciseIds?: string[]
}

export interface CompletionInput extends CompletionScope {
  /** 当前档案的进度行 */
  progress: readonly ProgressRecord[]
  /** 当前档案的错题行 */
  mistakes: readonly MistakeRecord[]
  /** 归属包索引（用于把进度查到真正落库的包上） */
  ownerIndex?: OwnerIndex | null
  /** 是否被**手动**标记为全部完成（`cardCompletions` 表） */
  manual?: boolean
}

/**
 * 一条错题是否落在卡片范围内。
 *
 * 两条命中路径：
 * 1. 它的 `knowledgePointIds` 与卡片的 `kpIds` 有交集 —— 两者都是**原值**
 *    （错题行保留题目携带的 kpId，见 `ownerIndex.ts` 的 `resolveMistakeTarget` 注释：
 *    「不规范化 kpId，错题复习和分组都按它反查」），所以**直接比字符串**即可；
 * 2. 它的 `exerciseId` 在卡片的题目集合里 —— 兜住「没带知识点」的错题。
 */
function isMistakeInScope(mistake: MistakeRecord, scope: CompletionScope): boolean {
  const kpSet = new Set(scope.kpIds)
  const ids = Array.isArray(mistake.knowledgePointIds) ? mistake.knowledgePointIds : []
  for (const id of ids) {
    if (kpSet.has(id)) return true
  }
  if (scope.exerciseIds && scope.exerciseIds.length > 0) {
    if (scope.exerciseIds.includes(mistake.exerciseId)) return true
  }
  return false
}

/**
 * 卡片范围内**尚未掌握**的错题条数。
 *
 * 「已掌握」的判定复用 `@core/mistake/mistakeRules` 的 `mistakeLevel`（兼容老数据
 * 里只有 `mastered` 布尔值的情况）—— 与错题本列表显示的「已掌握 ✅」是同一口径。
 */
export function pendingMistakeCount(input: CompletionInput): number {
  let count = 0
  for (const m of input.mistakes ?? []) {
    if (!m) continue
    if (!isMistakeInScope(m, input)) continue
    if (mistakeLevel(m) !== 'mastered') count++
  }
  return count
}

/**
 * 卡片的「全部完成」判定。
 *
 * 顺序即优先级（**勿调**）：
 *
 * 1. **手动标记** → `mastered`（家长/孩子的显式确认，最高优先级，可撤销）；
 * 2. 卡片没有知识点 → `none`（不编状态）；
 * 3. 现有掌握度聚合已经是 `mastered` → `mastered`（既有语义，不动）；
 * 4. 现有聚合是 `none`（一次都没做过）→ `none`（没做过的东西不能说"做完了"）；
 * 5. **自动通道**：所有知识点都学过 **且** 范围内没有未掌握的错题 → `mastered`；
 * 6. 其余 → 沿用现有聚合结果（`learning` / `review`）。
 *
 * ## 第 5 步的两个条件缺一不可
 *
 * - 「都学过」：只做了一部分的卡片不能算完成（否则孩子点开第一个知识点就变绿）；
 * - 「错题都掌握」：做错还没攻克的题不算完成 —— 这正是用户要「错题本里已掌握就
 *   自动更新」的那条路径。
 *
 * @param input 见 `CompletionInput`
 */
export function completionStatusOf(input: CompletionInput): CardStatus {
  if (input.manual) return 'mastered'

  const kpIds = (input.kpIds ?? []).filter((id) => typeof id === 'string' && id !== '')
  if (kpIds.length === 0) return 'none'

  const index = buildStatusIndex(input.progress ?? [])
  const statuses = kpIds.map((kpId) =>
    statusOfOwner(index, input.entryPackageId, kpId, input.ownerIndex ?? null),
  )
  const base = aggregateCardStatus(statuses, 'progress')

  if (base === 'mastered') return 'mastered'
  if (base === 'none') return 'none'

  // 自动通道：都学过 + 错题都掌握
  const allLearned = statuses.every((s) => s !== '未学')
  if (!allLearned) return base
  if (pendingMistakeCount(input) > 0) return base
  return 'mastered'
}

/**
 * 收集一个单元范围内的知识点 id 与题目 id。
 *
 * @param unit `units[].topics[]` 形状（`knowledgePointIds` + `exercises[].id`）
 */
export function scopeOfUnit(unit: {
  topics?: { knowledgePointIds?: string[]; exercises?: { id?: string }[] }[]
} | null | undefined): { kpIds: string[]; exerciseIds: string[] } {
  const kpIds: string[] = []
  const exerciseIds: string[] = []
  const seenKp = new Set<string>()
  const seenEx = new Set<string>()

  for (const topic of unit?.topics ?? []) {
    for (const id of topic?.knowledgePointIds ?? []) {
      if (typeof id !== 'string' || id === '') continue
      if (seenKp.has(id)) continue
      seenKp.add(id)
      kpIds.push(id)
    }
    for (const ex of topic?.exercises ?? []) {
      const id = ex?.id
      if (typeof id !== 'string' || id === '') continue
      if (seenEx.has(id)) continue
      seenEx.add(id)
      exerciseIds.push(id)
    }
  }

  return { kpIds, exerciseIds }
}

/**
 * 收集一个**学习包**范围内的知识点 id 与题目 id（把包内所有单元摊平）。
 *
 * @param pkg `LearningPackageRecord` 形状（`units[].topics[]`）
 */
export function scopeOfPackage(pkg: {
  units?: { topics?: { knowledgePointIds?: string[]; exercises?: { id?: string }[] }[] }[]
} | null | undefined): { kpIds: string[]; exerciseIds: string[] } {
  const kpIds: string[] = []
  const exerciseIds: string[] = []
  const seenKp = new Set<string>()
  const seenEx = new Set<string>()

  for (const unit of pkg?.units ?? []) {
    const scope = scopeOfUnit(unit)
    for (const id of scope.kpIds) {
      if (seenKp.has(id)) continue
      seenKp.add(id)
      kpIds.push(id)
    }
    for (const id of scope.exerciseIds) {
      if (seenEx.has(id)) continue
      seenEx.add(id)
      exerciseIds.push(id)
    }
  }

  return { kpIds, exerciseIds }
}
