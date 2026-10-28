// =====================================================================
// haptics · 物理震动反馈（V2.11 · 多邻国风）
// ---------------------------------------------------------------------
// 现实约束（务必知情，别对着代码猜）：
//   · `navigator.vibrate` 是 **Vibration API**，Android Chrome / 部分安卓
//     WebView 支持；**Windows WebView2（家庭端 Tauri）与桌面 Chromium 一律
//     没有这个 API**；iOS Safari 也不支持。
//   · 也就是说本模块在家庭端当前是「永远静默的空转」——保留它是为了将来
//     上移动端时零改动可用，并不是现在真的有震动。
//   · 因此它**绝不能**承担唯一的反馈职责：真实可感知的反馈是音效 + 动画。
//
// 设计约定：
//   · 不支持 → 静默返回 false，绝不抛。
//   · 自动化环境（webdriver）→ 直接跳过，保证 e2e 行为确定。
// =====================================================================

/** 震动节奏（毫秒）。答错用「长-停-长」三段，与答对的单次短促明确区分。 */
export type HapticKind = 'correct' | 'wrong' | 'click'

export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  /** 答对：20ms 短促一下 */
  correct: 20,
  /** 答错：[震50, 停50, 震50] */
  wrong: [50, 50, 50],
  /** 按钮：8ms 极轻 */
  click: 8,
}

/** 当前环境是否可能支持震动（仅判定 API 存在性，不保证硬件真的有马达） */
export function isHapticsSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === 'function'
}

function isAutomated(): boolean {
  if (typeof navigator === 'undefined') return true
  return (navigator as Navigator & { webdriver?: boolean }).webdriver === true
}

/**
 * 触发震动。
 *
 * @param kind 预设节奏
 * @param muted 设置里的「震动」开关关闭时为 true
 * @returns 是否真的发起了震动（不支持/被静音 → false）
 */
export function vibrate(kind: HapticKind, muted = false): boolean {
  if (muted || isAutomated() || !isHapticsSupported()) return false
  try {
    return (navigator as Navigator & { vibrate(p: number | number[]): boolean }).vibrate(
      HAPTIC_PATTERNS[kind],
    )
  } catch {
    // 某些 WebView 里存在该函数但调用即抛 —— 静默
    return false
  }
}
