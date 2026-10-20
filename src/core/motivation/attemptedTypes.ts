// =====================================================================
// 体验激励 · 已尝试题型集合
// ---------------------------------------------------------------------
// 用途：成就「题型收藏家（尝试过 ≥5 种不同题型）」。
// 埋点口径：每次作答（题目级）把 questionType 记入集合（Set 去重），
//   同每日统计一样「内存聚合 + 防抖落盘」，避免热路径 I/O 放大。
// =====================================================================

import { db } from '@/db'
import { currentProfileId, onBeforeProfileSwitch, onProfileChange } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'

export const ATTEMPTED_TYPES_KEY = 'attemptedTypes'

/** 当前档案的题型集合键（漏分片会让"题型收藏家"按另一个孩子的进度判定） */
export function attemptedTypesKey(profileId: string = currentProfileId()): string {
  return scopedKey(ATTEMPTED_TYPES_KEY, profileId)
}
export const FLUSH_DEBOUNCE_MS = 1500

let cache: Set<string> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let hooksRegistered = false
/** 是否已登记"档案切换"钩子（幂等；测试重置会复位） */
let profileHooksBound = false

/** 档案切换钩子：先落盘到旧档案，再清缓存（与 dailyStats 同一套理由） */
function bindProfileHooks(): void {
  if (profileHooksBound) return
  profileHooksBound = true
  onBeforeProfileSwitch(() => flushAttemptedTypes())
  onProfileChange(() => resetAttemptedTypesCache())
}

/** 丢弃内存缓存（不落盘） */
export function resetAttemptedTypesCache(): void {
  cache = null
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

async function ensure(): Promise<void> {
  if (cache) return
  bindProfileHooks()
  try {
    const rec = await db.settings.get(attemptedTypesKey())
    const v = rec?.value
    cache = new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    cache = new Set()
  }
}

/** 读取已尝试题型（数组，去重）。 */
export async function loadAttemptedTypes(): Promise<string[]> {
  await ensure()
  return [...cache!]
}

/**
 * **只读**某个档案的已尝试题型（不碰 `cache`、不写库、不注册钩子）。
 *
 * 存在的理由与 `readDailyStatsFor` 相同：家庭成就墙要一屏读多个档案，
 * 而 `cache` 是**单档案**的（切档案时由钩子清空）。墙若走 `loadAttemptedTypes()`，
 * 后一个孩子会把前一个孩子的题型留进缓存，热路径（`addAttemptedType`）随后
 * 就往别人的档案上记 —— 不报错，只是数据串了。
 *
 * 归一化口径与 `ensure()` 逐字一致（只留 string、去重），共用同一个 `Set` 构造。
 */
export async function readAttemptedTypesFor(profileId: string): Promise<string[]> {
  try {
    const rec = await db.settings.get(attemptedTypesKey(profileId))
    const v = rec?.value
    return [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])]
  } catch {
    return []
  }
}

/** 记录一个题型（去重）。 */
export function addAttemptedType(type: string): void {
  if (!type) return
  const apply = () => {
    cache!.add(type)
    scheduleFlush()
  }
  if (cache) apply()
  else void ensure().then(apply)
}

/** 立即落盘。 */
export async function flushAttemptedTypes(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await ensure()
  try {
    await db.settings.put({ key: attemptedTypesKey(), value: [...cache!] })
  } catch {
    /* 落盘失败：内存态保留 */
  }
}

function scheduleFlush(): void {
  if (typeof setTimeout !== 'function') return
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushAttemptedTypes()
  }, FLUSH_DEBOUNCE_MS)
  registerHooks()
}

function registerHooks(): void {
  if (hooksRegistered || typeof window === 'undefined' || typeof document === 'undefined') return
  hooksRegistered = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAttemptedTypes()
  })
  window.addEventListener('beforeunload', () => {
    void flushAttemptedTypes()
  })
}

/** 仅供测试：重置模块内存态。 */
export function __resetAttemptedTypesForTest(): void {
  cache = null
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  hooksRegistered = false
  profileHooksBound = false
}
