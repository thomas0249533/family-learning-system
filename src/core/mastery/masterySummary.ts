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

// =====================================================================
// 掌握度联合估计（Mastery Score）—— 逐知识点的"多熟"，供算法消费
// ---------------------------------------------------------------------
// `computeMasterySummary` 一族回答"**几个**知识点已掌握"（状态计数：整数个数）；
// 本节回答单个知识点"**多熟**"（0–100 的连续分数）。两者服务不同问题：
//   - 状态计数驱动首页/报告的定性展示（已掌握 N 个、学习中 N 个）；
//   - 本分数驱动 C3 弱项推荐的筛选与排序（未掌握/需复习/熟练度<60，
//     错误次数 > 熟练度 > 到期时间）。
// **按 PRD §11.5：熟练度 / pKnown / BKT 概率值不进任何 UI**（孩子端与家长端
// 都不进）——"平均熟练度 82 分"会被读成分数。本函数只作算法输入，
// 不要在视图层展示，也不要再往上包"平均分"之类的聚合。
// 单知识点分数把两套本来割裂的估计合成一个可比的数：
//   - BKT 的 `pKnown`（0~1 概率）：这道题**会不会**；
//   - FSRS 的 `stability`（天）：这个"会"**能扛多久不忘**；
//   - FSRS 的 `difficulty`（1~10）：这道题**对孩子多难**。
// 只有一个概率、没有任何记忆保持证据时，分数退化为纯 BKT（见下降级原则）。
// =====================================================================

/**
 * FSRS 稳定性系数的时间常数（天）。
 *
 * 为什么是 30：与 FSRS 遗忘曲线的量级同阶 —— stability ≈ 30 天时
 * `kS = 1 - e^{-30/30} ≈ 0.63`，即"一个月后还记得"算六成熟，
 * 而不是 0（全忘）或 1（永久记住）。取 30 让"一月"这个天然的复习周期
 * 落在分数中段：短期死记（S≈3 天，kS≈0.10）与长期保持（S≈90 天，kS≈0.95）
 * 能拉开档次，而不是一律顶格。
 */
const STABILITY_TAU_DAYS = 30

/**
 * 难度系数的最大折扣（25%）。
 *
 * 为什么是 0.25：难度是"这道题对**这个孩子**多难"，是局部调节量，
 * 不该压过能力本身（p）与记忆保持（kS）—— difficulty 从 1 到 10
 * 最多把分数打到七五折：再难的题，也不至于把"会"打压成"不会"。
 */
const DIFFICULTY_MAX_PENALTY = 0.25

/** 收敛到 [0,1]；调用方保证入参有限（NaN 会被 finiteOrNull 先行挡掉） */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/** 取有限数；NaN / Infinity / 非数字（脏数据）一律视为"没有这个值" */
function finiteOrNull(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

/**
 * BKT 概率来源：`masteryProbability ?? bkt.pKnown`。
 * 某个字段存在但是 NaN/Infinity（脏数据）时跳过它试下一个；
 * 两个来源都不可用 → null（**无法估计，不编一个数**）。
 */
function bktProbabilityOf(row: ProgressRecord): number | null {
  const direct = finiteOrNull(row.masteryProbability)
  if (direct !== null) return direct
  return finiteOrNull(row.bkt?.pKnown)
}

/**
 * 单知识点掌握度分数（0–100 的整数）。
 *
 * 公式（主理人定稿，勿改常量）：
 *   1. `p = masteryProbability ?? bkt.pKnown`；两者都无 → **null**
 *   2. 没有可用 FSRS 卡 → `round(100 * clamp01(p))`（纯 BKT 降级）
 *   3. 有可用 FSRS 卡 → `round(100 * clamp01(p * kS * kD))`
 *        `kS = 1 - e^{-S/30}`，`kD = 1 - 0.25 * (D-1)/9`
 *
 * "FSRS 卡可用"的判定（任一不满足即视作没有卡，退回纯 BKT）：
 *   - `stability` 是有限数且 > 0（S=0/负数/NaN 都是没进入复习节奏的卡）；
 *   - `difficulty` 是非 NaN 的数（缺字段/NaN 时无法乘，降级而不是猜一个难度）。
 *
 * 降级原则（用户原话：旧数据缺 FSRS 时必须优雅降级，绝不能白屏）：
 * 任何畸形输入只被 clamp 收敛或返回 null，**绝不抛异常**。
 */
export function computeMasteryScore(row: ProgressRecord): number | null {
  if (!row) return null
  const p = bktProbabilityOf(row)
  if (p === null) return null

  const s = finiteOrNull(row.fsrs?.stability)
  const dRaw = row.fsrs?.difficulty
  // NaN 显式排除；±Infinity 交给下面的 clamp 自然收敛到 1/10
  const d = typeof dRaw === 'number' && !Number.isNaN(dRaw) ? dRaw : null
  if (s === null || s <= 0 || d === null) {
    return Math.round(100 * clamp01(p))
  }

  const kS = 1 - Math.exp(-s / STABILITY_TAU_DAYS)
  // difficulty 越界（0 / 99 / 负数）收敛到 [1,10]
  const D = Math.min(10, Math.max(1, d))
  const kD = 1 - DIFFICULTY_MAX_PENALTY * (D - 1) / 9
  return Math.round(100 * clamp01(p * kS * kD))
}
