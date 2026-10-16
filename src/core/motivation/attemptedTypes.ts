// =====================================================================
// 体验激励 · 已尝试题型集合
// ---------------------------------------------------------------------
// 用途：成就「题型收藏家（尝试过 ≥5 种不同题型）」。
// 埋点口径：每次作答（题目级）把 questionType 记入集合（Set 去重），
//   同每日统计一样「内存聚合 + 防抖落盘」，避免热路径 I/O 放大。
// =====================================================================

import { db } from '@/db'

const KEY = 'attemptedTypes'
export const FLUSH_DEBOUNCE_MS = 1500

let cache: Set<string> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let hooksRegistered = false

async function ensure(): Promise<void> {
  if (cache) return
  try {
    const rec = await db.settings.get(KEY)
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
    await db.settings.put({ key: KEY, value: [...cache!] })
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
}
