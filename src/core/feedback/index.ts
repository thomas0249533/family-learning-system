// =====================================================================
// feedback · 反馈门面（音效 + 震动统一入口）
// ---------------------------------------------------------------------
// 组件只 import 本文件，不要直接碰 AudioEngine / haptics：
//   · 开关判定收敛在这一层（音效开关、震动开关是两件独立的事）
//   · 将来要加"上课模式全局静音"，只改这里
//
// 所有导出都是**同步 + 不抛**的：反馈失败绝不能影响答题主流程。
// =====================================================================

import { getAudioEngine } from './AudioEngine'
import { vibrate } from './haptics'
import { getFeedbackPreferences } from './feedbackSettings'

export { AudioEngine, getAudioEngine, isAudioSuppressed } from './AudioEngine'
export { HAPTIC_PATTERNS, isHapticsSupported, vibrate } from './haptics'
export {
  DEFAULT_FEEDBACK_PREFERENCES,
  FEEDBACK_SETTINGS_KEY,
  getFeedbackPreferences,
  loadFeedbackPreferences,
  saveFeedbackPreferences,
  type FeedbackPreferences,
} from './feedbackSettings'

/**
 * 把当前设置推给音频引擎。
 * App 启动加载完设置后、以及设置页保存后各调一次即可；不必每帧同步。
 */
export function syncFeedbackEngine(): void {
  getAudioEngine().setMuted(!getFeedbackPreferences().sound)
}

/** 答对：上行「叮」+ 短促震动 */
export function playCorrectFeedback(): void {
  const prefs = getFeedbackPreferences()
  if (prefs.sound) getAudioEngine().playCorrect()
  vibrate('correct', !prefs.haptics)
}

/** 答错：低沉「嗡」+ 三段震动 */
export function playWrongFeedback(): void {
  const prefs = getFeedbackPreferences()
  if (prefs.sound) getAudioEngine().playWrong()
  vibrate('wrong', !prefs.haptics)
}

/** 按钮点击「哒」（只播声音，不震动——键盘/鼠标高频点击震手很烦） */
export function playClickFeedback(): void {
  if (getFeedbackPreferences().sound) getAudioEngine().playClick()
}
