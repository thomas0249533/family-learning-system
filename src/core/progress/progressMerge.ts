/**
 * E-01 · progress 合并计划 —— 纯函数（D3）
 *
 * 为什么是纯函数：`tests/user-data-store.test.ts` 用的是**假 Dexie**，
 * `version(3).upgrade()` 钩子在 node 环境里根本跑不到。
 * 把"该怎么改"算成一份计划（puts / deletes），钩子只负责 apply —— 逻辑才可测。
 *
 * 三条硬约束（`docs/system_design-v1.3.md` §2.3.3）：
 *   1. 本文件**不 import Dexie**，不知道 DB 存在；
 *   2. 幂等：对同一输入连跑两次，第二次 `puts` / `deletes` 都为空；
 *   3. 守恒失败 → **宁可不动**（puts/deletes 清空）—— 动了就是不可逆的数据损坏。
 *
 * 合并语义（逐字段，C6 覆盖 PRD AC-E1-5）：
 *   - 可累加量求和：`correctCount` / `wrongCount` / `studySeconds` / `bkt.observed`
 *   - 时间取最新：`lastStudiedAt`
 *   - **状态机产物取 `lastStudiedAt` 最新那条的值**（`status` / `correctStreak` / `wrongStreak`）
 *     —— 禁止求和、禁止取最高等级：取 max 会把一条 3 个月前的"已掌握"永久锁死，掩盖当前退步
 *   - `bkt.observed` **求和**（累计观测次数可累加，它只是计数）；
 *     `bkt.pKnown` / `masteryProbability` 取 `bkt.observed` 最大那条的**同源**值
 *     （**禁止平均**，平均会造出一个"谁都不是"的概率）
 *   - `fsrs` 取 `last_review` 最新的整卡；`reviewStage` / `nextReviewAt` / `lastReviewAt`
 *     必须与选定 `fsrs` **同一来源行**（跨行拼装会让 `nextReviewAt` 与卡片 `due` 打架）
 *
 * ⚠️ 唯一不可挽回的信息损失：两张 FSRS 卡不可合并，必丢一张的复习历史。
 */
import type { ProgressRecord } from '@/db'
import { canonicalKpId, resolveOwnerPackageId, type OwnerIndex } from './ownerIndex'

export interface MergeStats {
  /** 迁移前行数 */
  total: number
  /** packageId（或 kpId）改写、无同键冲突的行数 */
  rewritten: number
  /** 发生 N→1 合并的组数 */
  mergedGroups: number
  /** 被删掉的行数 = Σ(groupSize - 1) */
  mergedRowsRemoved: number
  /** 归属解析为 null，原样保留的行数 */
  ambiguousKept: number
  /** 迁移后行数，必须 = total - mergedRowsRemoved */
  final: number
}

export interface MergePlan {
  /** 承载体（id 已存在，含合并后字段） */
  puts: ProgressRecord[]
  /** 要物理删除的 id */
  deletes: number[]
  stats: MergeStats
}

export interface MergeTarget {
  packageId: string
  knowledgePointId: string
}

/** 行的 id 数值；缺失视为 +∞（排在最后，且不参与删除） */
function idOf(row: ProgressRecord): number {
  return typeof row.id === 'number' && Number.isFinite(row.id) ? row.id : Number.POSITIVE_INFINITY
}

/** ISO 时间戳 → 毫秒；缺失/非法视为"最旧"（-∞） */
function timeOf(iso?: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
}

/** 组内按 id 升序（D10：id 是稳定可复现的，`lastStudiedAt` 相同则无法定序） */
function sortByIdAsc(group: ProgressRecord[]): ProgressRecord[] {
  return [...group].sort((a, b) => idOf(a) - idOf(b))
}

/**
 * 组内排序：`lastStudiedAt` 降序，同时间按 **id 升序**（D10 的确定性要求）。
 * 第一条即 `latest`。
 */
function sortByLatest(group: ProgressRecord[]): ProgressRecord[] {
  return [...group].sort((a, b) => {
    const delta = timeOf(b.lastStudiedAt) - timeOf(a.lastStudiedAt)
    if (delta !== 0) return delta
    return idOf(a) - idOf(b)
  })
}

/**
 * 合并一组同键行。**对外导出是为了能逐字段单测**（生产调用方只有 `planProgressMerge`）。
 *
 * @param group 同终键的行，至少一条
 * @param target 归一化后的终键（`packageId` + `knowledgePointId`）
 */
export function mergeProgressGroup(group: ProgressRecord[], target: MergeTarget): ProgressRecord {
  const byId = sortByIdAsc(group)
  const keeper = byId[0] // 承载体：组内 id 最小（D10）
  const byLatest = sortByLatest(group)
  const latest = byLatest[0] // 状态机产物与未知字段的来源

  // ---- 可累加量求和 ----
  let correctCount = 0
  let wrongCount = 0
  let studySeconds = 0
  for (const row of byId) {
    correctCount += row.correctCount ?? 0
    wrongCount += row.wrongCount ?? 0
    studySeconds += row.studySeconds ?? 0
  }

  // ---- bkt：计数求和，概率取"证据最多"那条（禁止平均）----
  // `observed` 是**累计观测次数**，可累加：组内两条本来就是同一个知识点被记了两遍，
  // 观测次数必须相加（设计 §2.3.3 合并语义表的 `bkt.observed` → 求和）。
  // `pKnown` 不可累加：把 0.92 和 0.2 平均出 0.56，会造出一个"谁都不是"的后验，
  // 所以只认证据（observed）最多的那一行的值。两者来源不同，是刻意的。
  let evidenceRow: ProgressRecord | undefined
  let maxObs = Number.NEGATIVE_INFINITY
  for (const row of byLatest) {
    if (!row.bkt) continue
    const observed = row.bkt.observed ?? 0
    if (observed > maxObs) {
      maxObs = observed
      evidenceRow = row
    }
  }

  let observedTotal = 0
  for (const row of byId) observedTotal += row.bkt?.observed ?? 0

  const bkt = evidenceRow?.bkt ? { ...evidenceRow.bkt, observed: observedTotal } : undefined

  // ---- fsrs：取 last_review 最新的整卡；全组都没有则保持 undefined ----
  // ⚠️ 这一步**有损，且不可逆**：两张 FSRS 卡（各自的 stability / difficulty / 复习轮次）
  // 在数学上无法合并，只能整卡择优保留 `last_review` 最新的那张，**另一张的复习历史被主动丢弃**。
  // 之所以宁可丢历史也不拼装：拼出一张"谁都没经历过"的卡，会让下一次 advance() 以错误间隔排期，
  // 孩子会在本该校复习时被排到很久以后 —— 丢一段历史，好过制造一个假的记忆模型。
  let fsrsRow: ProgressRecord | undefined
  let bestReview = Number.NEGATIVE_INFINITY
  for (const row of byLatest) {
    const t = timeOf(row.fsrs?.last_review)
    if (t > bestReview) {
      bestReview = t
      fsrsRow = row
    }
  }
  // 排期三件套必须与选定 fsrs 同源；全组无 fsrs 时退回 latest（此时不存在"与卡片打架"的问题）
  const scheduleSource = fsrsRow ?? latest

  const merged: ProgressRecord = {
    // 其余未知字段前向兼容：以 latest 为底
    ...latest,
    id: keeper.id,
    packageId: target.packageId,
    knowledgePointId: target.knowledgePointId,
    correctCount,
    wrongCount,
    studySeconds,
    lastStudiedAt: latest.lastStudiedAt,
    // 状态机产物：取最新那条，禁止求和 / 禁止取 max 等级
    status: latest.status,
    correctStreak: latest.correctStreak ?? 0,
    wrongStreak: latest.wrongStreak ?? 0,
    // 证据计数求和；概率与 BKT 参数取证据最多的那条
    bkt,
    masteryProbability: evidenceRow
      ? evidenceRow.bkt?.pKnown ?? evidenceRow.masteryProbability
      : latest.masteryProbability,
    // 卡片与其排期同源。
    // ⚠️ 这里**不能用 `fsrsRow?.fsrs`**：卡片存在但 `last_review` 缺失时 `timeOf` 返回 -Infinity，
    // `-Infinity > -Infinity` 为 false → `fsrsRow` 保持 undefined → 会把 `...latest` 里的
    // 卡片**覆盖成 undefined**（一次"合并"把唯一的记忆模型删掉了）。
    // 取 `scheduleSource.fsrs` 既避免这个问题，也保证"卡片 ↔ 排期三件套"永远同一来源行。
    fsrs: scheduleSource.fsrs,
    reviewStage: scheduleSource.reviewStage,
    nextReviewAt: scheduleSource.nextReviewAt,
    lastReviewAt: scheduleSource.lastReviewAt,
  }

  return merged
}

interface Bucket {
  key: string
  target: MergeTarget
  rows: ProgressRecord[]
  keyChanged: boolean
}

function sumsOf(rows: ProgressRecord[]): { correct: number; wrong: number; seconds: number } {
  let correct = 0
  let wrong = 0
  let seconds = 0
  for (const row of rows) {
    correct += row.correctCount ?? 0
    wrong += row.wrongCount ?? 0
    seconds += row.studySeconds ?? 0
  }
  return { correct, wrong, seconds }
}

export interface ConservationReport {
  ok: boolean
  /** 人可读的差异描述；`ok === true` 时为空数组 */
  diffs: string[]
}

/**
 * 守恒校验：合并只能"搬字段"，不能"造数字"。
 *
 * 为什么把它抽成独立的纯函数，而不是留在 `planProgressMerge` 内部：
 *   1. `planProgressMerge` 用它做**应用前**自检（失败即清空 puts/deletes，宁可不动）；
 *   2. T02 的迁移在 apply 之后可以拿 DB 里的行再跑一次 —— 同一份判据既验"计划算对了"
 *      又验"apply 真执行对了"，比复制一遍求和逻辑可靠；
 *   3. 它是"迁移正确性的唯一硬指标"，值得被单独断言。
 *
 * 只校验**可累加量**与**行数方向**：`correctStreak` / `status` / `pKnown` 这类"状态机产物"
 * 合并后本来就会变（取最新那条），拿它们做守恒判据会把正确行为判成损坏。
 */
export function checkConservation(
  before: ProgressRecord[],
  after: ProgressRecord[]
): ConservationReport {
  const beforeRows = before ?? []
  const afterRows = after ?? []
  const b = sumsOf(beforeRows)
  const a = sumsOf(afterRows)
  const diffs: string[] = []

  if (b.correct !== a.correct) {
    diffs.push(`ΣcorrectCount ${b.correct} → ${a.correct}（差 ${a.correct - b.correct}）`)
  }
  if (b.wrong !== a.wrong) {
    diffs.push(`ΣwrongCount ${b.wrong} → ${a.wrong}（差 ${a.wrong - b.wrong}）`)
  }
  if (b.seconds !== a.seconds) {
    diffs.push(`ΣstudySeconds ${b.seconds} → ${a.seconds}（差 ${a.seconds - b.seconds}）`)
  }
  // 合并只能减少行数：任何"变多"都说明计划里混进了新增（迁移必须只减不增）
  if (afterRows.length > beforeRows.length) {
    diffs.push(`行数 ${beforeRows.length} → ${afterRows.length}（合并只能减少，不许新增）`)
  }

  return { ok: diffs.length === 0, diffs }
}

/**
 * 纯函数：给定行集合与归属索引，算出"应该怎么改"，不碰 DB。
 *
 * 幂等：对同一输入连跑两次，第二次 `puts` / `deletes` 都为空。
 *
 * @param rows `progress` 表的全部行
 * @param index `buildOwnerIndex(packages)` 的结果
 */
export function planProgressMerge(rows: ProgressRecord[], index: OwnerIndex): MergePlan {
  const allRows = rows ?? []

  // 没有数值 id 的行无法安全 put/delete（put 会变成插入新行），一律原样保留。
  // 生产路径上 Dexie 行必有 id，这里纯属防御。
  const addressable: ProgressRecord[] = []
  for (const row of allRows) {
    if (row && typeof row.id === 'number' && Number.isFinite(row.id)) addressable.push(row)
  }

  // ---- 1. 定终键 ----
  const buckets = new Map<string, Bucket>()
  let ambiguousKept = 0
  for (const row of addressable) {
    const owner = resolveOwnerPackageId(row.knowledgePointId, row.packageId, index)
    if (owner === null) ambiguousKept += 1
    const packageId = owner ?? row.packageId
    const knowledgePointId = owner ? canonicalKpId(owner, row.knowledgePointId, index) : row.knowledgePointId
    const key = `${packageId}\u0000${knowledgePointId}`
    const existing = buckets.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      buckets.set(key, {
        key,
        target: { packageId, knowledgePointId },
        rows: [row],
        keyChanged: packageId !== row.packageId || knowledgePointId !== row.knowledgePointId,
      })
    }
  }

  // ---- 2. 逐组生成写入计划 ----
  const puts: ProgressRecord[] = []
  const deletes: number[] = []
  const untouched: ProgressRecord[] = []
  let rewritten = 0
  let mergedGroups = 0
  let mergedRowsRemoved = 0

  for (const bucket of buckets.values()) {
    const group = bucket.rows
    if (group.length === 1) {
      const only = group[0]
      if (!bucket.keyChanged) {
        untouched.push(only) // 零写入
        continue
      }
      puts.push({
        ...only,
        packageId: bucket.target.packageId,
        knowledgePointId: bucket.target.knowledgePointId,
      })
      rewritten += 1
      continue
    }

    const mergedRow = mergeProgressGroup(group, bucket.target)
    puts.push(mergedRow)
    for (const row of group) {
      if (row.id !== mergedRow.id) deletes.push(row.id as number)
    }
    mergedGroups += 1
    mergedRowsRemoved += group.length - 1
  }

  const total = allRows.length
  const final = total - mergedRowsRemoved

  // ---- 3. 守恒自检：只打日志、不抛；失败则放弃整次迁移 ----
  // `numerable` 即"迁移后仍存在的全部可寻址行"：未动的 + 要写回的（合并行 / 改键行）。
  const numerable = [...untouched, ...puts]
  const conservation = checkConservation(addressable, numerable)
  const countOk = numerable.length + (total - addressable.length) === final

  if (!countOk || !conservation.ok) {
    // 宁可不动：动了就是不可逆的数据损坏
    console.error('[planProgressMerge] 守恒自检失败，放弃本次合并', {
      diffs: conservation.diffs,
      countOk,
      total,
      final,
      puts: puts.length,
      deletes: deletes.length,
    })
    return {
      puts: [],
      deletes: [],
      stats: {
        total,
        rewritten: 0,
        mergedGroups: 0,
        mergedRowsRemoved: 0,
        ambiguousKept,
        final: total,
      },
    }
  }

  return {
    puts,
    deletes,
    stats: { total, rewritten, mergedGroups, mergedRowsRemoved, ambiguousKept, final },
  }
}
