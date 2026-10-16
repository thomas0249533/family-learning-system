// =====================================================================
// 年级 → 学段主题 推断（纯函数 · 无副作用）
// ---------------------------------------------------------------------
// 刻意不放进 store：store 只做「编排」（调用本函数 + 决定是否覆盖），
// 这样本文件保持纯逻辑、可直接单测，无 Vue / Pinia / Dexie 依赖。
// =====================================================================

import type { ThemePreset } from '@core/styles/tokens'

/** 推断的数据来源：一个学习包 manifest 的年级与时间戳。 */
export interface GradeSource {
  /** manifest.grade */
  grade: number
  /** manifest.updatedAt */
  updatedAt?: string
  /** manifest.createdAt */
  createdAt?: string
}

export interface PresetInference {
  /** 推断出的学段预设 */
  preset: ThemePreset
  /** 采用的年级；无有效来源时为 null */
  grade: number | null
  /** 是否走了默认兜底（无有效来源） */
  usedFallback: boolean
}

/** 年级 → 学段：≤6 小学 / 7-9 初中 / ≥10 高中。 */
export function gradeToPreset(grade: number): ThemePreset {
  if (grade <= 6) return 'primary'
  if (grade <= 9) return 'junior'
  return 'senior'
}

/** 取一个来源的时间戳（updatedAt 优先，其次 createdAt）；无法解析返回 -Infinity。 */
function timestampOf(s: GradeSource): number {
  const raw = s.updatedAt ?? s.createdAt
  const v = raw ? Date.parse(raw) : Number.NaN
  return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY
}

/**
 * 依据多个年级来源推断学段预设。
 *
 * 规则：
 *   1. 取 grade 的**众数**（出现次数最多者）；
 *   2. 并列时取 `updatedAt ?? createdAt` **最新**者；
 *   3. 无有效来源 → `{ preset: 'junior', grade: null, usedFallback: true }`（默认初中，零回归）。
 */
export function inferPreset(sources: GradeSource[]): PresetInference {
  const valid = (Array.isArray(sources) ? sources : []).filter(
    (s): s is GradeSource => !!s && typeof s.grade === 'number' && Number.isFinite(s.grade),
  )

  if (valid.length === 0) {
    return { preset: 'junior', grade: null, usedFallback: true }
  }

  // 计数
  const counts = new Map<number, number>()
  for (const s of valid) counts.set(s.grade, (counts.get(s.grade) ?? 0) + 1)

  let maxCount = 0
  for (const c of counts.values()) maxCount = Math.max(maxCount, c)

  const winners = Array.from(counts.entries())
    .filter(([, c]) => c === maxCount)
    .map(([g]) => g)

  let chosen: number
  if (winners.length === 1) {
    chosen = winners[0]
  } else {
    // 并列 → 取时间戳最新的来源
    const tied = valid.filter((s) => winners.includes(s.grade))
    let best = tied[0]
    let bestTs = timestampOf(best)
    for (const s of tied) {
      const ts = timestampOf(s)
      if (ts > bestTs) {
        bestTs = ts
        best = s
      }
    }
    chosen = best.grade
  }

  return { preset: gradeToPreset(chosen), grade: chosen, usedFallback: false }
}
