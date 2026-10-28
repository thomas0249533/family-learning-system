// =====================================================================
// feedbackSettings · 音效 / 震动开关的读写与内存镜像（V2.11）
// ---------------------------------------------------------------------
// 为什么需要一个"内存镜像"：答题反馈是**同步**路径（提交按钮 → 立刻出声），
// 而 settings 在 IndexedDB 里是异步的。每次答题 await 一次读库会引入延迟和
// 抖动，所以启动时 load 一次进内存，设置页改动时同步刷新缓存 + 落库。
//
// 作用域为什么是 **global**：判据见 settingsScope.ts 顶部那句「这个值换了孩子
// 还成立吗」。音效/震动是**这台设备**的偏好（书房夜里吵不吵、音箱插没插），
// 不随孩子切换。老大要音效老二不要的场景，用"谁用谁去关"更自然，不值得为它
// 把偏好分片成两份。
// =====================================================================

import { db } from '@/db'

/** settings 表里的键（必须登记在 settingsScope.ts 的 GLOBAL_KEYS，否则 check:settings-keys 会拦） */
export const FEEDBACK_SETTINGS_KEY = 'fls:feedback'

export interface FeedbackPreferences {
  /** 答对/答错/按钮音效 */
  sound: boolean
  /** 物理震动（桌面端无此 API，实际静默） */
  haptics: boolean
}

/** 默认值：都开。首启即可感知反馈，觉得吵由家长在设置里关。 */
export const DEFAULT_FEEDBACK_PREFERENCES: FeedbackPreferences = {
  sound: true,
  haptics: true,
}

/**
 * 内存镜像。初始即为默认值，保证「App 还没 load 完就答题」也有确定行为
 * （有反馈，而不是莫名其妙没声）。
 */
let current: FeedbackPreferences = { ...DEFAULT_FEEDBACK_PREFERENCES }

/** 同步读取当前偏好（反馈路径专用，勿在组件里 await） */
export function getFeedbackPreferences(): FeedbackPreferences {
  return current
}

/** 归一化：脏数据/缺字段一律回落到默认值，不做抛错 */
export function normalizeFeedbackPreferences(raw: unknown): FeedbackPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FEEDBACK_PREFERENCES }
  const obj = raw as Partial<Record<keyof FeedbackPreferences, unknown>>
  return {
    sound: typeof obj.sound === 'boolean' ? obj.sound : DEFAULT_FEEDBACK_PREFERENCES.sound,
    haptics: typeof obj.haptics === 'boolean' ? obj.haptics : DEFAULT_FEEDBACK_PREFERENCES.haptics,
  }
}

/** 从库加载一次并刷新镜像（App 启动时调用；失败静默保持默认） */
export async function loadFeedbackPreferences(): Promise<FeedbackPreferences> {
  try {
    const rec = await db.settings.get(FEEDBACK_SETTINGS_KEY)
    current = normalizeFeedbackPreferences(rec?.value)
  } catch {
    current = { ...DEFAULT_FEEDBACK_PREFERENCES }
  }
  return current
}

/** 落库并刷新镜像 */
export async function saveFeedbackPreferences(
  next: Partial<FeedbackPreferences>,
): Promise<FeedbackPreferences> {
  current = normalizeFeedbackPreferences({ ...current, ...next })
  try {
    await db.settings.put({ key: FEEDBACK_SETTINGS_KEY, value: { ...current } })
  } catch {
    // 落库失败不影响本次会话的即时体验；下次启动回落到上次成功写入的值的默认值
  }
  return current
}

/** 仅测试用：把镜像复位到默认值，避免用例互相污染 */
export function resetFeedbackPreferencesForTest(next?: Partial<FeedbackPreferences>): void {
  current = normalizeFeedbackPreferences({ ...DEFAULT_FEEDBACK_PREFERENCES, ...next })
}
