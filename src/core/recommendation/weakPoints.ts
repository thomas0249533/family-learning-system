/**
 * V1.6 · C3 · 弱项推荐（纯函数，零 db 访问，可单测）
 * =====================================================================
 * 目的：把「今天就能动手练」的知识点放上首页「今日计划」区，让孩子一打开
 * 就知道先练哪个。规格见 `docs/prd-v1.3-achievement.md` §11.4 / §11.5。
 *
 * ## 为什么弱项**不进报告页**（只在首页）
 * 报告页是「回顾」——把弱项写进报告，等于把行动推到以后某个闲暇时刻，
 * 而弱项的价值恰恰在「现在、今天、打开 app 的那一刻」就能练一道题。
 * 落报告 = 把行动推迟；放首页 = 今天就能动手。所以这里只服务首页行动入口，
 * 不向 Report / FamilyWall 等回顾型视图暴露。
 *
 * ## 为什么必须走 `canonicalizeProgressRows` 去重
 * 掌握率口径早就因为「同一知识点被重复登记」翻过车（english-7 的 49 个
 * 不同知识点共用 7 个裸 id，裸 id 去重会把 49 塌成 7；base + unit 也可能
 * 把同一知识点登记两遍）。所以这里**绝不自己写第二套去重**，统一复用
 * `masterySummary` 的 `canonicalizeProgressRows`：它按 `(packageId, kpId)`
 * 二元组建全集、按 `lastStudiedAt` 取最新行、把找不到归属的行丢进
 * `orphanRows`。没有进度行（没学过）的知识点是「新知识」，归今日推荐管，
 * 不是弱项——所以第二步直接跳过无行条目。
 *
 * ## 为什么 `reason` 绝不带分数（§11.5 硬约束）
 * 熟练度 / `pKnown` / BKT 概率值**不进任何 UI**（孩子端与家长端都不进）：
 * 「这个知识点你只有 45 分」会被读成对孩子能力的打分，而不是下一步的行动。
 * `computeMasteryScore` 只作**算法输入**（筛选 / 排序），`score` 字段保留在
 * 返回值里仅供排序与测试断言，**任何视图都不得渲染它**。给用户看的 `reason`
 * 只陈述事实——错了多少次、是不是到了该复习的时间。
 * 一句话：**家长要知道该练哪个，不是知道孩子有多笨。**
 */
import type { LearningPackageRecord, ProgressRecord } from '@/db'
import type { CanonicalKp } from '@core/mastery/masterySummary'
import { canonicalizeProgressRows, computeMasteryScore } from '@core/mastery/masterySummary'

/** 一条弱项推荐。`score` / `nextReviewAt` 仅供排序，**不得进任何 UI 文案**（§11.5）。 */
export interface WeakPoint {
  /** 完整知识点 id（可能带 `pkg::` 前缀），供 `findUnitByKnowledgePoint` 反查 */
  knowledgePointId: string
  title: string
  sourcePackageId: string
  sourcePkgTitle: string
  /** 错题次数（事实，可展示） */
  wrongCount: number
  /** 仅供排序，按 §11.5 不得出现在任何 UI 文案里 */
  score: number | null
  /** ISO 时间戳或 null（仅供排序与 due 判定，不直接展示） */
  nextReviewAt: string | null
  /** 事实型文案，只含计数与到期事实，**绝不出现 score** */
  reason: string
}

export interface ComputeWeakPointsOptions {
  /** 今日推荐已占走的 kpId（mistake / review 类）——按 kpId 排除，同 KP 换包仍是同一知识点 */
  excludeKpIds?: Iterable<string>
  /** 返回条数上限，默认 5 */
  limit?: number
  /** 熟练度阈值（低于它算弱项），默认 60 */
  scoreThreshold?: number
  /** 毫秒时间戳，默认 `Date.now()`；仅为可测性注入 */
  now?: number
}

const DEFAULT_LIMIT = 5
const DEFAULT_SCORE_THRESHOLD = 60

/** 候选条目（内部结构，排序后映射为 `WeakPoint`） */
interface Candidate {
  entry: CanonicalKp
  score: number | null
  wrongCount: number
  nextReviewAt: string | null
  due: boolean
}

/**
 * 熟练度升序，`null` 垫底。
 * `null` 表示「无法估计」——不知强弱时不该抢在已知弱项的前面，故排最后。
 */
function compareScoreAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

/**
 * 到期时间升序，`null` / 无法解析（乱码）垫底。
 * 乱码串的 `Date.parse` 是 `NaN`，与 `null` 同等对待（排最后），且**绝不抛异常**。
 */
function compareReviewAsc(a: string | null, b: string | null): number {
  const ta = a === null ? Number.NaN : Date.parse(a)
  const tb = b === null ? Number.NaN : Date.parse(b)
  const aOk = Number.isFinite(ta)
  const bOk = Number.isFinite(tb)
  if (!aOk && !bOk) return 0
  if (!aOk) return 1
  if (!bOk) return -1
  return ta - tb
}

/** 取有限数；NaN / Infinity / 非数字（脏数据）一律归一为 `fallback` */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 事实型文案（只含计数与到期事实，**绝不出现 score**）。
 * 四种组合按优先级：既错又多 → 只错 → 只到期 → 兜底。
 */
function buildReason(due: boolean, wrongCount: number): string {
  if (due && wrongCount > 0) return `错了 ${wrongCount} 次，且到了该复习的时间`
  if (wrongCount > 0) return `错了 ${wrongCount} 次`
  if (due) return `到了该复习的时间`
  return '需要练一练'
}

/**
 * 计算首页「今日计划 · 最需要复习」的弱项列表。
 *
 * 算法（顺序即语义，勿调）：
 *   1. `canonicalizeProgressRows` 去重（见文件头：禁止自己写第二套）；
 *   2. 遍历收敛后的 `entries`，取 `rowByKey.get(entry.key)`；**无行跳过**（没学过 = 新知识）；
 *   3. 筛选（**或**逻辑，满足其一即入选）：`status !== '已掌握'`，或 `score !== null && score < 阈值`；
 *   4. `excludeKpIds.has(entry.kpId)` 跳过（与今日推荐去重，同一屏不重复出现同一知识点）；
 *   5. 归一 `wrongCount` / `nextReviewAt`，算 `due`（到期 = `nextReviewAt <= now`，乱码视为未到期）；
 *   6. 排序：`wrongCount` 降序 → `score` 升序（`null` 垫底）→ `nextReviewAt` 升序（`null` 垫底）；
 *   7. `slice(0, limit)`；
 *   8. 生成 `reason`（只含事实，不含分数）。
 *
 * 任何畸形输入（缺 `wrongCount` / 乱码 `nextReviewAt` / `fsrs={}` / `bkt` 缺 `pKnown`）
 * 都被归一或判为不入选，**绝不抛异常**。
 */
export function computeWeakPoints(
  packages: LearningPackageRecord[],
  progress: ProgressRecord[],
  options: ComputeWeakPointsOptions = {}
): WeakPoint[] {
  const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT)
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
  const now = options.now ?? Date.now()
  const excludeKpIds = new Set<string>(options.excludeKpIds ?? [])

  // ---- 1. 去重（复用掌握率口径，禁止第二套实现）----
  const { entries, rowByKey } = canonicalizeProgressRows(packages, progress)

  // 包标题字典：entry.packageId 恒在 domain 内（entries 由 packages 生成），仍防御性兜底
  const pkgById = new Map<string, LearningPackageRecord>()
  for (const pkg of packages ?? []) {
    if (pkg?.packageId) pkgById.set(pkg.packageId, pkg)
  }

  // ---- 2~5. 遍历 + 筛选 + 归一 ----
  const candidates: Candidate[] = []
  for (const entry of entries) {
    const row = rowByKey.get(entry.key)
    if (!row) continue // 没学过 = 新知识，归今日推荐管

    const score = computeMasteryScore(row)

    // ---- 3. 或逻辑：未掌握 或 熟练度低于阈值 ----
    const isWeak = row.status !== '已掌握' || (score !== null && score < scoreThreshold)
    if (!isWeak) continue

    // ---- 4. 与今日推荐去重（按 kpId，同 KP 换包仍是同一知识点）----
    if (excludeKpIds.has(entry.kpId)) continue

    // ---- 5. 归一字段 + due 判定（畸形值一律安全降级）----
    const wrongCount = finiteOr(row.wrongCount, 0)
    const nextReviewAt = typeof row.nextReviewAt === 'string' ? row.nextReviewAt : null
    const due = nextReviewAt !== null && new Date(nextReviewAt).getTime() <= now

    candidates.push({ entry, score, wrongCount, nextReviewAt, due })
  }

  // ---- 6. 三级排序 ----
  candidates.sort((a, b) => {
    if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount // 错误次数降序
    const byScore = compareScoreAsc(a.score, b.score) // 熟练度升序，null 垫底
    if (byScore !== 0) return byScore
    return compareReviewAsc(a.nextReviewAt, b.nextReviewAt) // 到期时间升序，null 垫底
  })

  // ---- 7~8. 截断 + 生成事实型 reason ----
  return candidates.slice(0, limit).map(({ entry, score, wrongCount, nextReviewAt, due }) => {
    const pkg = pkgById.get(entry.packageId)
    return {
      knowledgePointId: entry.kpId,
      title: entry.title ?? entry.kpId,
      sourcePackageId: entry.packageId,
      sourcePkgTitle: pkg?.manifest?.title ?? '',
      wrongCount,
      score,
      nextReviewAt,
      reason: buildReason(due, wrongCount),
    }
  })
}
