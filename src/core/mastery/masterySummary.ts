/**
 * 掌握率口径统一 —— 纯函数（`docs/mastery-metric-definition.md` §3 / §5）
 *
 * 一句话：**掌握率 = 已掌握的（去重）知识点数 / 去重后的知识点全集**，
 * 去重键 = `(packageId, kpId)` 二元组。**禁止裸 kpId 去重**
 * （english-7 的 49 个不同知识点共用 7 个裸 id，裸 id 去重会把 49 塌成 7）。
 *
 * 两层收敛（都在函数内部完成，调用方**不需要**预先去重 domain）：
 *   层 1：`${packageId}\0${kpId}` 建全集
 *   层 2：不同 packageId 下「同一 kpId 且 title 完全相同」的 key 收敛为 1
 *         （base + unit 重复登记同一知识点；english-7 因 title 各不相同 → **不收敛**）
 *
 * 语义分工（`docs/system_design-v1.3.md` §0）：
 *   - **统计层宽松**：本文件允许"同 kpId + title 全同 → 计 1"，因为统计不能因为历史脏数据给出错数；
 *   - **写入层严格**：`resolveOwnerPackageId` 绝不做这个合并，因为写错了会永久污染。
 *   两者是不同层的规则，不要互相套用。
 */
import type { LearningPackageRecord, ProgressRecord } from '@/db'
import { KEY_SEP } from '@core/progress/ownerIndex'

export interface CanonicalKp {
  /** 收敛后的唯一键（`packageId\0kpId`，取代表那条的键） */
  key: string
  packageId: string
  kpId: string
  title?: string
}

export interface MasterySummary {
  /** 去重 (packageId,kpId) 全集 */
  total: number
  mastered: number
  /** `status === '学习中'` */
  learning: number
  /** `status === '需复习'` */
  needReview: number
  /** 有 progress 记录但 `status === '未学'` */
  unlearned: number
  /** 全集内、从未产生 progress 记录 = total - 上述四类 */
  notStarted: number
  /** 0..100，`round(mastered / total * 100)`，clamp 到 [0,100] */
  rate: number
  /** progress 中 (packageId,kpId) 不在 domain 的记录数（诊断用，不计入任何桶） */
  orphanRecordCount: number
}

export interface CanonicalizedProgress {
  /** 收敛后的知识点全集（每个 key 唯一） */
  entries: CanonicalKp[]
  /** 收敛键 → 该键的进度行（同键多条时按 `lastStudiedAt` 取最新那条） */
  rowByKey: Map<string, ProgressRecord>
  /** 找不到归属的进度行（包已删除/重新导入）—— 不计入任何桶 */
  orphanRows: ProgressRecord[]
}

/** 二元组键。与 `ownerIndex.KEY_SEP` 同一分隔符，保证"索引键 = 统计键" */
export function progressKeyOf(r: { packageId: string; knowledgePointId: string }): string {
  return `${r.packageId}${KEY_SEP}${r.knowledgePointId}`
}

/** ISO 时间戳 → 毫秒；缺失/非法视为"最旧" */
function timeOf(iso?: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
}

/** `a` 是否比 `b` 新（同时间按 id 大者新，保证确定性） */
function isNewer(a: ProgressRecord, b: ProgressRecord): boolean {
  const ta = timeOf(a.lastStudiedAt)
  const tb = timeOf(b.lastStudiedAt)
  if (ta !== tb) return ta > tb
  const ia = typeof a.id === 'number' ? a.id : Number.NEGATIVE_INFINITY
  const ib = typeof b.id === 'number' ? b.id : Number.NEGATIVE_INFINITY
  return ia > ib
}

/**
 * 组内 title 是否"全同"。空/缺失 title 一律视为**不可比较** → 不收敛
 * （拿不到 title 时无法判定是不是同一个知识点，保守不合并；风险只落在分母偏大这一侧）。
 */
function sameTitle(group: CanonicalKp[]): boolean {
  const first = group[0]?.title
  if (typeof first !== 'string' || first.length === 0) return false
  return group.every((e) => e.title === first)
}

/** packageId 字典序升序（收敛代表的选择，必须确定性） */
function comparePkgId(a: CanonicalKp, b: CanonicalKp): number {
  if (a.packageId < b.packageId) return -1
  if (a.packageId > b.packageId) return 1
  return 0
}

/**
 * **唯一的收敛实现**：`computeMasterySummary` 与 `buildAchievementContext` 都必须调它（D5），
 * 这样成就分子与掌握率分子**结构上同源**（AC-E1-3），不需要改冻结的 `achievements.ts`。
 */
export function canonicalizeProgressRows(
  packages: LearningPackageRecord[],
  progress: ProgressRecord[]
): CanonicalizedProgress {
  // ---- 层 1：domain 二元组 ----
  const domain = new Map<string, CanonicalKp>()
  for (const pkg of packages ?? []) {
    const packageId = pkg?.packageId
    if (!packageId) continue
    for (const kp of pkg.knowledgePoints ?? []) {
      const kpId = kp?.id
      if (!kpId) continue
      const key = progressKeyOf({ packageId, knowledgePointId: kpId })
      if (!domain.has(key)) domain.set(key, { key, packageId, kpId, title: kp.title })
    }
  }

  // ---- 层 2：同 kpId + title 全同 → 收敛为 1 ----
  const byKpId = new Map<string, CanonicalKp[]>()
  for (const entry of domain.values()) {
    const list = byKpId.get(entry.kpId)
    if (list) list.push(entry)
    else byKpId.set(entry.kpId, [entry])
  }

  const canonicalKeyByOriginal = new Map<string, string>()
  const entries: CanonicalKp[] = []
  for (const group of byKpId.values()) {
    if (group.length === 1 || !sameTitle(group)) {
      for (const entry of group) {
        canonicalKeyByOriginal.set(entry.key, entry.key)
        entries.push(entry)
      }
      continue
    }
    const rep = [...group].sort(comparePkgId)[0]
    for (const entry of group) canonicalKeyByOriginal.set(entry.key, rep.key)
    entries.push(rep)
  }

  // ---- progress 行归位 ----
  const rowByKey = new Map<string, ProgressRecord>()
  const orphanRows: ProgressRecord[] = []
  for (const row of progress ?? []) {
    if (!row) continue
    const canonicalKey = canonicalKeyByOriginal.get(progressKeyOf(row))
    if (canonicalKey === undefined) {
      orphanRows.push(row)
      continue
    }
    const prev = rowByKey.get(canonicalKey)
    // 同 key 多条（历史重复，复合索引非唯一）→ 取 lastStudiedAt 最新那条
    if (!prev || isNewer(row, prev)) rowByKey.set(canonicalKey, row)
  }

  return { entries, rowByKey, orphanRows }
}

/**
 * 掌握率汇总。三处展示（Home / Parent / Report）与成就都必须用它，**禁止各自再排一遍**。
 *
 * 不变量（`mastery-metric-definition.md` §5.1，测试逐条覆盖）：
 *   I1 `mastered <= total`
 *   I2 `0 <= rate <= 100`
 *   I3 `notStarted >= 0`
 *   I4 `mastered + learning + needReview + unlearned + notStarted === total`
 *   I5 `orphanRecordCount >= 0` 且不进任何桶
 *   I6 空输入 → 全 0，不抛
 *   I7 幂等
 *   I8 同 key 多条 progress → 只计 1 次
 */
export function computeMasterySummary(
  packages: LearningPackageRecord[],
  progress: ProgressRecord[]
): MasterySummary {
  const { entries, rowByKey, orphanRows } = canonicalizeProgressRows(packages, progress)

  let mastered = 0
  let learning = 0
  let needReview = 0
  let unlearned = 0
  let notStarted = 0

  for (const entry of entries) {
    const row = rowByKey.get(entry.key)
    if (!row) {
      notStarted += 1
      continue
    }
    switch (row.status) {
      case '已掌握':
        mastered += 1
        break
      case '学习中':
        learning += 1
        break
      case '需复习':
        needReview += 1
        break
      case '未学':
        unlearned += 1
        break
      default:
        // 未知状态的脏数据：算"未开始"，保证 I4 恒成立
        notStarted += 1
        break
    }
  }

  const total = entries.length
  // I3：公式即定义，clamp 只是防御（各桶已恰好划分全集）
  const computedNotStarted = Math.max(0, total - mastered - learning - needReview - unlearned)
  const rawRate = total > 0 ? Math.round((mastered / total) * 100) : 0

  return {
    total,
    mastered,
    learning,
    needReview,
    unlearned,
    notStarted: computedNotStarted,
    rate: Math.min(100, Math.max(0, rawRate)),
    orphanRecordCount: orphanRows.length,
  }
}

/**
 * 学科分布（Parent / Report 共用）。**与 `computeMasterySummary` 同源**：
 * 分母是收敛后的知识点全集、分子是"该学科内已掌握"的去重条目。
 *
 * 为什么不能用"裸 kpId → subject"映射（旧实现）：
 * 同一个裸 id 在多个包里出现时，后写入的包会覆盖前面的学科归属，
 * 导致语文知识点被算进英语、分子分母都错。
 */
export interface SubjectMastery {
  subject: string
  total: number
  mastered: number
  /** 0..100 */
  rate: number
}

export function masteryBySubject(
  packages: LearningPackageRecord[],
  progress: ProgressRecord[]
): SubjectMastery[] {
  const { entries, rowByKey } = canonicalizeProgressRows(packages, progress)

  const subjectOf = new Map<string, string>()
  for (const pkg of packages ?? []) {
    const s = pkg?.manifest?.subject
    if (pkg?.packageId && typeof s === 'string' && s) subjectOf.set(pkg.packageId, s)
  }

  const acc = new Map<string, { total: number; mastered: number }>()
  for (const entry of entries) {
    const subject = subjectOf.get(entry.packageId)
    if (!subject) continue
    const bucket = acc.get(subject) ?? { total: 0, mastered: 0 }
    bucket.total += 1
    if (rowByKey.get(entry.key)?.status === '已掌握') bucket.mastered += 1
    acc.set(subject, bucket)
  }

  return [...acc.entries()]
    .map(([subject, v]) => ({
      subject,
      total: v.total,
      mastered: v.mastered,
      rate: v.total > 0 ? Math.min(100, Math.max(0, Math.round((v.mastered / v.total) * 100))) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject))
}

/**
 * 已掌握的去重知识点数。`(packageId, kpId)` 去重 —— 与掌握率、成就同源。
 *
 * @param domainKeys 传了就把 domain 外的行（孤儿）排除；不传 = 全量（供成就使用）
 */
export function countMasteredKps(
  progress: ProgressRecord[],
  domainKeys?: ReadonlySet<string>
): number {
  const seen = new Set<string>()
  for (const row of progress ?? []) {
    if (!row || row.status !== '已掌握') continue
    const key = progressKeyOf(row)
    if (domainKeys && !domainKeys.has(key)) continue
    seen.add(key)
  }
  return seen.size
}

/**
 * 由 packages 取出**原始** domain 键集合（供 `countMasteredKps` 的 `domainKeys` 入参）。
 *
 * 注意这里给的是**原始**二元组键，不是收敛后的代表键 —— 因为 `countMasteredKps` 直接拿进度行
 * 自己的 `(packageId, kpId)` 去比对，不做收敛映射。两者用途不同，别混用。
 */
export function domainKeySet(packages: LearningPackageRecord[]): Set<string> {
  const keys = new Set<string>()
  for (const pkg of packages ?? []) {
    const packageId = pkg?.packageId
    if (!packageId) continue
    for (const kp of pkg.knowledgePoints ?? []) {
      if (!kp?.id) continue
      keys.add(progressKeyOf({ packageId, knowledgePointId: kp.id }))
    }
  }
  return keys
}
