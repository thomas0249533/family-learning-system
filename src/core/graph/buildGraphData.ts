// =====================================================================
// G1 · 技能树数据层 —— 纯函数（零 I/O、零 echarts 依赖）
// ---------------------------------------------------------------------
// 输入：包清单 packages[] + 进度行 progress[]；
// 输出：`学科 → (单元，若包有 units) → 知识点` 的多叉树（每棵树一个学科根）。
//
// 铁律（v1.12-stage-g 方案 §G1）：
//   状态判定**复用** src/core/mastery/ 的既有判据 —— 写入端的状态机
//   （`nextStatus` / `applyDecay`）已在作答时把 `ProgressRecord.status`
//   算好，`computeMasterySummary` 展示时直接读该字段；本层与 summary 同口径，
//   只做「MasteryStatus → 图谱四态」的桶映射，**禁止在此另写掌握度公式**。
//
// 去重键与统计层同源：`progressKeyOf`（`(packageId, kpId)` 二元组）。
//
// 防御性（脏数据不炸）：
//   packages / progress 非数组、包缺 manifest/subject、KP 缺 id、unit 缺 id、
//   进度行缺键、status 是未知脏值 —— 一律跳过或落到保守桶，绝不抛异常。
// =====================================================================

import type { LearningPackageRecord, ProgressRecord } from '@/db'
import { progressKeyOf } from '@core/mastery/masterySummary'

/** 图谱节点四态（展示层口径，与 masterySummary 的四个桶一一对应） */
export type GraphNodeStatus = 'unlearned' | 'learning' | 'review' | 'mastered'

export interface GraphNode {
  /** 唯一 id（知识点/单元用 `\0` 组合键，与 ownerIndex.KEY_SEP 同思路，绝不撞键） */
  id: string
  /** 展示名（echarts tree 的 name 直接用它） */
  name: string
  status: GraphNodeStatus
  /** 累计错误次数：知识点 = 进度行 wrongCount；容器节点 = 子树求和 */
  wrongCount: number
  children?: GraphNode[]
}

/** manifest.subject → 展示名（与 Review.vue 的 subjectLabel 同口径） */
const SUBJECT_LABELS: Record<string, string> = {
  math: '数学',
  chinese: '语文',
  english: '英语',
}

/** subject 缺失 / 不认识的包落到这里（聚合包历史缺 subject 的兜底） */
const FALLBACK_SUBJECT_LABEL = '未分组'

/** 取有限数；脏数据（NaN/Infinity/非数字）一律视为 0 */
function finiteCount(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

/**
 * 单知识点状态。与 `computeMasterySummary` 的桶映射逐条对齐：
 *   无进度行（summary 的 notStarted）/ '未学' / 未知脏值 → unlearned；
 *   '学习中' → learning；'需复习' → review；'已掌握' → mastered。
 * 时间衰减（applyDecay）是**写入层**的事，读层不重复判（与 summary 同口径）。
 */
export function graphStatusOfRow(row: ProgressRecord | undefined): GraphNodeStatus {
  if (!row) return 'unlearned'
  switch (row.status) {
    case '已掌握':
      return 'mastered'
    case '学习中':
      return 'learning'
    case '需复习':
      return 'review'
    case '未学':
      return 'unlearned'
    default:
      return 'unlearned'
  }
}

/** 同 key 多条进度行取最新（与 masterySummary 的 isNewer 同思路：时间优先，id 决胜） */
function isNewer(a: ProgressRecord, b: ProgressRecord): boolean {
  const ta = a.lastStudiedAt ? Date.parse(a.lastStudiedAt) : Number.NEGATIVE_INFINITY
  const tb = b.lastStudiedAt ? Date.parse(b.lastStudiedAt) : Number.NEGATIVE_INFINITY
  if (ta !== tb) return ta > tb
  const ia = typeof a.id === 'number' ? a.id : Number.NEGATIVE_INFINITY
  const ib = typeof b.id === 'number' ? b.id : Number.NEGATIVE_INFINITY
  return ia > ib
}

/** 进度行索引：`(packageId, kpId)` → 最新一条。缺键 / 非法行直接跳过 */
function indexProgress(progress: unknown): Map<string, ProgressRecord> {
  const byKey = new Map<string, ProgressRecord>()
  if (!Array.isArray(progress)) return byKey
  for (const row of progress) {
    if (!row || typeof row !== 'object') continue
    const r = row as ProgressRecord
    if (!r.packageId || !r.knowledgePointId) continue
    const key = progressKeyOf({ packageId: r.packageId, knowledgePointId: r.knowledgePointId })
    const prev = byKey.get(key)
    if (!prev || isNewer(r, prev)) byKey.set(key, r)
  }
  return byKey
}

/** 容器节点聚合（纯展示口径，不是掌握度公式）：
 *  全部 mastered → mastered；有 review → review；有 learning → learning；
 *  其余（部分已掌握 + 部分未学）→ learning（推进中）；全未学 → unlearned。 */
function aggregateChildren(children: GraphNode[]): { status: GraphNodeStatus; wrongCount: number } {
  let mastered = 0
  let learning = 0
  let review = 0
  let unlearned = 0
  let wrongCount = 0
  for (const c of children) {
    wrongCount += c.wrongCount
    switch (c.status) {
      case 'mastered': mastered += 1; break
      case 'learning': learning += 1; break
      case 'review': review += 1; break
      case 'unlearned': unlearned += 1; break
    }
  }
  const total = children.length
  let status: GraphNodeStatus
  if (total > 0 && mastered === total) status = 'mastered'
  else if (review > 0) status = 'review'
  else if (learning > 0) status = 'learning'
  else if (mastered > 0) status = 'learning'
  else status = 'unlearned'
  return { status, wrongCount }
}

/** 学科根排序：按展示名的码点序（确定性，不依赖 locale 实现） */
function compareByName(a: GraphNode, b: GraphNode): number {
  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

/**
 * 组装技能树。返回**多棵根**（每学科一棵），直接可作为 echarts tree 的 data
 * （视图层再补 itemStyle / label）。
 *
 * 结构：
 *   - 学科来自包元数据（manifest.subject）；缺失/未知落「未分组」根；
 *   - 包有 units 且 unit.topics.knowledgePointIds 命中该包 KP → 插入单元层；
 *     没被任何 unit 收编的 KP 直接挂学科根下（空单元节点丢弃）；
 *   - 同一 KP 被多个 unit 引用 → 首个 unit 收编，不重复出节点；
 *   - 聚合包（dependencies 拉远端内容）不做依赖解析 —— 那是异步 I/O，
 *     本层只渲染各包**自有** knowledgePoints（与 Home 今日推荐同口径）。
 */
export function buildGraphData(
  packages: LearningPackageRecord[] | null | undefined,
  progress: ProgressRecord[] | null | undefined
): GraphNode[] {
  const rows = indexProgress(progress)
  const subjectRoots = new Map<string, GraphNode>()

  const rootOf = (subject: unknown): GraphNode => {
    const key = typeof subject === 'string' && subject ? subject : ''
    let root = subjectRoots.get(key)
    if (!root) {
      root = {
        id: key ? `subject-${key}` : 'subject-unknown',
        name: key ? (SUBJECT_LABELS[key] ?? key) : FALLBACK_SUBJECT_LABEL,
        status: 'unlearned',
        wrongCount: 0,
        children: [],
      }
      subjectRoots.set(key, root)
    }
    return root
  }

  const seenPackageIds = new Set<string>()

  for (const pkg of Array.isArray(packages) ? packages : []) {
    if (!pkg || typeof pkg !== 'object') continue
    const packageId = pkg.packageId
    if (!packageId || seenPackageIds.has(packageId)) continue
    seenPackageIds.add(packageId)

    const kps = Array.isArray(pkg.knowledgePoints) ? pkg.knowledgePoints : []
    if (kps.length === 0) continue

    const root = rootOf(pkg.manifest?.subject)

    // ---- 单元层（若包有 units）：unit.id → 节点；kpId → 首个收编它的单元 ----
    const unitNodes = new Map<string, GraphNode>()
    const unitOfKp = new Map<string, GraphNode>()
    const units = Array.isArray(pkg.units) ? pkg.units : []
    for (const unit of units) {
      if (!unit || typeof unit !== 'object') continue
      const unitId = (unit as { id?: unknown }).id
      if (typeof unitId !== 'string' || !unitId || unitNodes.has(unitId)) continue
      const node: GraphNode = {
        id: `${packageId}\0${unitId}`,
        name:
          typeof (unit as { title?: unknown }).title === 'string' &&
          (unit as { title: string }).title
            ? (unit as { title: string }).title
            : unitId,
        status: 'unlearned',
        wrongCount: 0,
        children: [],
      }
      unitNodes.set(unitId, node)
      const topics = Array.isArray((unit as { topics?: unknown }).topics)
        ? (unit as { topics: Array<{ knowledgePointIds?: unknown }> }).topics
        : []
      for (const topic of topics) {
        if (!topic || typeof topic !== 'object') continue
        const ids = Array.isArray(topic.knowledgePointIds) ? topic.knowledgePointIds : []
        for (const kpId of ids) {
          if (typeof kpId === 'string' && kpId && !unitOfKp.has(kpId)) unitOfKp.set(kpId, node)
        }
      }
    }

    // ---- 知识点节点 ----
    const seenKpIds = new Set<string>()
    const kpsUnderRoot: GraphNode[] = []
    for (const kp of kps) {
      if (!kp || typeof kp !== 'object') continue
      const kpId = (kp as { id?: unknown }).id
      if (typeof kpId !== 'string' || !kpId || seenKpIds.has(kpId)) continue
      seenKpIds.add(kpId)

      const row = rows.get(progressKeyOf({ packageId, knowledgePointId: kpId }))
      const node: GraphNode = {
        id: progressKeyOf({ packageId, knowledgePointId: kpId }),
        name:
          typeof (kp as { title?: unknown }).title === 'string' && (kp as { title: string }).title
            ? (kp as { title: string }).title
            : kpId,
        status: graphStatusOfRow(row),
        wrongCount: finiteCount(row?.wrongCount),
      }
      const unit = unitOfKp.get(kpId)
      if (unit) unit.children!.push(node)
      else kpsUnderRoot.push(node)
    }

    // ---- 单元聚合并入学科根（空单元丢弃：topics 引用的 KP 都不在本包） ----
    for (const unit of unitNodes.values()) {
      if (unit.children!.length === 0) continue
      const agg = aggregateChildren(unit.children!)
      unit.status = agg.status
      unit.wrongCount = agg.wrongCount
      root.children!.push(unit)
    }
    root.children!.push(...kpsUnderRoot)
  }

  // ---- 学科根聚合（只有确有内容的学科才出根） ----
  const roots: GraphNode[] = []
  for (const root of subjectRoots.values()) {
    if (root.children!.length === 0) continue
    root.children!.sort(compareByName)
    const agg = aggregateChildren(root.children!)
    root.status = agg.status
    root.wrongCount = agg.wrongCount
    roots.push(root)
  }
  roots.sort(compareByName)
  return roots
}
