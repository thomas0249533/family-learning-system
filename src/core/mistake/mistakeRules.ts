/**
 * P3 · 错题三级状态（纯函数，可单测）
 *
 * 原来只有 mastered: true / false 二元判定，太粗：
 * 孩子刚弄明白一次的题，和真正吃透的题，被当成同一种状态。
 *
 * 三级：
 *   none     未掌握   —— 刚收进错题本
 *   partial  部分掌握 —— 复习答对 1 次：仍留在错题本（排后面、降频），提示"再巩固一次"
 *   mastered 已掌握   —— 连续答对 2 次：移出待复习列表，但记录留档（不再出现在错题本）
 *
 * 注意"连续"：中途又答错会直接回到 none，避免"错-对-错-对"也被算成掌握。
 */
import type { MistakeMasteryLevel } from '@/db'

/** 判定"已掌握"所需的复习连续答对次数 */
export const MISTAKE_REQUIRED_CORRECT = 2

export const MISTAKE_LEVEL_LABEL: Record<MistakeMasteryLevel, string> = {
  none: '未掌握',
  partial: '部分掌握',
  mastered: '已掌握',
}

export const MISTAKE_LEVEL_ICON: Record<MistakeMasteryLevel, string> = {
  none: '❌',
  partial: '🟡',
  mastered: '✅',
}

/** 兼容老数据：只有 mastered 布尔值时折算成三级 */
export function mistakeLevel(m: {
  masteryLevel?: MistakeMasteryLevel
  mastered?: boolean
}): MistakeMasteryLevel {
  if (m.masteryLevel) return m.masteryLevel
  return m.mastered ? 'mastered' : 'none'
}

/** 兼容老数据：折算已有的复习答对次数 */
export function mistakeReviewCount(m: {
  reviewCorrectCount?: number
  masteryLevel?: MistakeMasteryLevel
  mastered?: boolean
}): number {
  if (typeof m.reviewCorrectCount === 'number') return m.reviewCorrectCount
  const level = mistakeLevel(m)
  if (level === 'mastered') return MISTAKE_REQUIRED_CORRECT
  if (level === 'partial') return 1
  return 0
}

export interface MistakeReviewResult {
  level: MistakeMasteryLevel
  reviewCorrectCount: number
  mastered: boolean
}

/** 复习作答后推进错题状态 */
export function applyMistakeReview(
  level: MistakeMasteryLevel,
  reviewCorrectCount: number,
  isCorrect: boolean
): MistakeReviewResult {
  if (!isCorrect) {
    return { level: 'none', reviewCorrectCount: 0, mastered: false }
  }
  // 未掌握状态下不继承历史计数：万一数据不一致（level 是 none 却带着次数），
  // 也要求重新连对够次数，不能凭空跳过。
  const base = level === 'none'
    ? 0
    : (Number.isFinite(reviewCorrectCount) ? reviewCorrectCount : 0)
  const n = base + 1
  if (n >= MISTAKE_REQUIRED_CORRECT) {
    return { level: 'mastered', reviewCorrectCount: n, mastered: true }
  }
  return { level: 'partial', reviewCorrectCount: n, mastered: false }
}

/** 部分掌握的题是否还应该出现在「待复习」列表里 */
export function needsReview(level: MistakeMasteryLevel): boolean {
  return level !== 'mastered'
}
