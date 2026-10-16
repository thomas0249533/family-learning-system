/**
 * P1 · 贝叶斯知识追踪（Bayesian Knowledge Tracing）
 *
 * 旧的掌握度判定是硬阈值：「连续答对 ≥3 且正确率 ≥80%」。它有两个问题：
 *   1. 一道难题答对和一道简单题答对，权重完全一样；
 *   2. 一道 4 选 1 的选择题蒙对，和一道填空题真的会，被当成同一件事。
 *
 * BKT 为每个知识点维护一个"已经学会了"的概率，每答一次用贝叶斯公式更新。
 * 关键在于 G（guess，蒙对率）随题型变化——判断题有 50% 机率蒙对，
 * 填空题则几乎不可能蒙对，于是"答对"带来的证据强度天差地别：
 *
 *   填空题答对 2 次 → 掌握度 ≈ 99%
 *   判断题答对 2 次 → 掌握度 ≈ 70%
 *
 * 这正是我们要的"区分猜对与真会"。四个参数（先验/学习率/失误率/蒙对率）
 * 全部物理含义明确，不需要训练数据。
 */

export interface BktState {
  /** 当前"已掌握"的后验概率，0~1 */
  pKnown: number
  /** 累计观测次数 */
  observed: number
}

export interface BktParams {
  /** 先验：一个从没练过的知识点，孩子已经会的概率 */
  pInit: number
  /** 学习率：练一次之后，由"不会"变成"会"的概率 */
  pLearn: number
  /** 失误率：其实会了，却答错的概率 */
  pSlip: number
  /** 蒙对率：其实不会，却答对的概率（默认值，实际按题型覆盖） */
  pGuess: number
}

export const BKT_DEFAULTS: BktParams = {
  pInit: 0.25,
  pLearn: 0.18,
  pSlip: 0.1,
  pGuess: 0.2,
}

/** 判定为"稳定掌握"的概率门槛 */
export const BKT_CONFIDENT = 0.85

/** 概率下限/上限：避免 0 / 1 导致贝叶斯更新退化成不可逆 */
const P_MIN = 0.001
const P_MAX = 0.999

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return P_MIN
  return Math.min(P_MAX, Math.max(P_MIN, v))
}

/**
 * 按题型给出"蒙对"的概率。这是 BKT 能区分猜对与真会的关键。
 */
export function guessProbFor(type?: string, optionCount = 4): number {
  switch (type) {
    case 'judge':
      return 0.5
    case 'single': {
      const n = Number.isFinite(optionCount) && optionCount > 1 ? optionCount : 4
      return Math.round((1 / n) * 100) / 100
    }
    case 'multiple':
      // 组合型多选，蒙中的空间很小
      return 0.08
    case 'matching':
      return 0.05
    case 'essay':
      // 主观题是自评，宽松一些
      return 0.12
    case 'spelling':
    case 'blank':
    default:
      return 0.05
  }
}

export function initBkt(params: BktParams = BKT_DEFAULTS): BktState {
  return { pKnown: params.pInit, observed: 0 }
}

/**
 * 用一次作答结果更新掌握概率。
 *
 * 两步贝叶斯：
 *   ① 观测更新：P(已掌握 | 观察到对/错)
 *       对：P(会)·(1-失误) / [ P(会)·(1-失误) + P(不会)·蒙对 ]
 *       错：P(会)·失误     / [ P(会)·失误   + P(不会)·(1-蒙对) ]
 *   ② 学习迁移：P ← P + (1-P)·学习率   （练一次总有机会学会）
 */
export function updateBkt(
  state: BktState,
  isCorrect: boolean,
  guessProb: number = BKT_DEFAULTS.pGuess,
  params: BktParams = BKT_DEFAULTS
): BktState {
  const g = clamp01(guessProb)
  const slip = clamp01(params.pSlip)
  const prior = clamp01(state.pKnown)

  const posterior = isCorrect
    ? (prior * (1 - slip)) / (prior * (1 - slip) + (1 - prior) * g)
    : (prior * slip) / (prior * slip + (1 - prior) * (1 - g))

  const next = posterior + (1 - posterior) * params.pLearn

  return { pKnown: clamp01(next), observed: state.observed + 1 }
}

/** 展示用：掌握度百分比；没有观测过则返回 null（避免展示无意义的先验值） */
export function bktPercent(state?: BktState | null): number | null {
  if (!state || state.observed <= 0) return null
  return Math.round(state.pKnown * 100)
}

/** 是否已达"稳定掌握" */
export function isConfident(state?: BktState | null): boolean {
  return !!state && state.observed > 0 && state.pKnown >= BKT_CONFIDENT
}

/** 兼容：从"只有一个概率数字"还原出 BktState */
export function stateFromProbability(pKnown?: number | null, observed = 1): BktState | null {
  if (pKnown === undefined || pKnown === null || !Number.isFinite(pKnown)) return null
  return { pKnown: clamp01(pKnown), observed }
}
