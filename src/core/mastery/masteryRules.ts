/**
 * P1 · 掌握度状态机（纯函数，可单测）
 *
 * 从 userData store 里抽出来，原因有两个：
 *   1. 原来的 nextStatus 藏在 Pinia store 里，依赖 IndexedDB，根本没法写单测；
 *   2. BKT 概率要参与判定，规则需要集中在一处，方便用测试锁住行为。
 *
 * 设计原则：**不降低现有判定门槛**。
 * 旧规则（连对 ≥3 且正确率 ≥80%）原样保留，BKT 只做两件事：
 *   - 补一条"高置信度提前掌握"通道（填空题这种几乎不可能蒙对的题型，
 *     答对 2 次就能拿到 ≈99% 掌握度，没必要再刷到 3 次）；
 *   - 加一道防虚假掌握的安全阀（概率太低不许判已掌握）。
 */
import type { MasteryStatus } from '@/db'

export type MasteryInput = {
  correctCount: number
  wrongCount: number
  correctStreak: number
  wrongStreak: number
}

export const MASTERY_RULES = {
  /** 连错几次进入「需复习」 */
  needReviewWrongStreak: 2,
  /** 判定已掌握所需的连续答对次数 */
  masteredCorrectStreak: 3,
  /** 判定已掌握所需的最低正确率 */
  masteredMinAccuracy: 0.8,
  /** 需复习状态下，复习后连对几次恢复「已掌握」 */
  reviewRecoverStreak: 2,
  /** 已掌握后多少天没学（且没复习）就衰减为需复习 */
  reviewDecayDays: 7,
  /** 防虚假掌握：低于该掌握度不允许判「已掌握」 */
  minProbabilityForMastered: 0.6,
  /** 提前掌握：掌握度达到该值且一次没错，可直接判「已掌握」 */
  earlyMasteredProbability: 0.9,
  /** 提前掌握所需的最少连续答对次数 */
  earlyMasteredStreak: 2,
}

/**
 * 计算下一个掌握状态。
 * @param pKnown BKT 掌握概率（0~1）；老数据或未采集时传 undefined，此时完全走旧规则。
 */
export function nextStatus(
  prev: MasteryStatus,
  rec: MasteryInput,
  pKnown?: number
): MasteryStatus {
  const total = rec.correctCount + rec.wrongCount
  const accuracy = total > 0 ? rec.correctCount / total : 0

  // ---- 1. 下降通道：优先于一切 ----
  if (rec.wrongStreak >= MASTERY_RULES.needReviewWrongStreak) return '需复习'
  if (prev === '已掌握' && rec.wrongStreak >= 1) return '需复习'

  // ---- 2. 上升通道 ----
  const hasProb = typeof pKnown === 'number' && Number.isFinite(pKnown)
  const probOk = !hasProb || pKnown >= MASTERY_RULES.minProbabilityForMastered

  // 2a. 旧规则（原样保留，只是多一道概率安全阀）
  if (
    rec.correctStreak >= MASTERY_RULES.masteredCorrectStreak &&
    accuracy >= MASTERY_RULES.masteredMinAccuracy &&
    probOk
  ) {
    return '已掌握'
  }

  // 2b. BKT 提前掌握：证据足够强时不必再刷题
  //     要求"一次都没错过"——错过说明这个知识点对孩子并不轻松，
  //     即便当时答对也不该抄近道，老老实实走 2a 的连对 3 次。
  if (
    hasProb &&
    pKnown >= MASTERY_RULES.earlyMasteredProbability &&
    rec.correctStreak >= MASTERY_RULES.earlyMasteredStreak &&
    rec.wrongStreak === 0 &&
    rec.wrongCount === 0
  ) {
    return '已掌握'
  }

  // 2c. 需复习恢复
  if (prev === '需复习' && rec.correctStreak >= MASTERY_RULES.reviewRecoverStreak) return '已掌握'

  // ---- 3. 其余保持/降级 ----
  if (prev === '未学' || prev === '需复习') return '学习中'
  return prev === '已掌握' ? '已掌握' : '学习中'
}

/**
 * 时间衰减：已掌握但久未学习 → 需复习。
 * 只看"上次作答时间"，故意不动 lastStudiedAt，避免把复习时间刷新掉。
 */
export function applyDecay(
  rec: { status: MasteryStatus; lastStudiedAt: string },
  now: Date = new Date()
): MasteryStatus {
  if (rec.status !== '已掌握') return rec.status
  const days = (now.getTime() - new Date(rec.lastStudiedAt).getTime()) / 86400000
  if (days > MASTERY_RULES.reviewDecayDays) return '需复习'
  return rec.status
}
