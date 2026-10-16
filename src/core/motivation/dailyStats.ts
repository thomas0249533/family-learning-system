// =====================================================================
// 体验激励 · 每日学习统计（题量 + 首/末学习时刻）
// ---------------------------------------------------------------------
// 用途：为成就「今日之星（单日 ≥20 题）」「闻鸡起舞（07:00 前）」
//       「挑灯夜读（21:00 后）」提供埋点数据。
//
// 设计要点（避免热路径 I/O 放大）：
//   · 计量口径 = 「题」不是「知识点」：一次作答可能触达多个 KP，故 +1 只在
//     recordAnswerEvent（题目级）累加，绝不放 recordProgress（多 KP 会重复计数）。
//   · 内存聚合 + 1500ms 防抖落盘；hidden/beforeunload 各强制 flush 一次。
//   · 本地日期口径（复用 streak.ts 的 localDayKey，勿用 UTC/toISOString）。
//   · flush 时裁剪保留最近 RETAIN_DAYS 天，防膨胀。
// =====================================================================

import { db } from '@/db'
import { localDayKey } from './streak'

export interface DailyStat {
  /** 本地日期 YYYY-MM-DD */
  date: string
  /** 当日累计答题数 */
  questionCount: number
  /** 当日首次学习时刻（epoch ms） */
  firstStudyAt: number
  /** 当日最后一次学习时刻（epoch ms） */
  lastStudyAt: number
}

const KEY = 'dailyStats'
/** 保留天数 */
export const RETAIN_DAYS = 60
/** 防抖落盘时长（ms） */
export const FLUSH_DEBOUNCE_MS = 1500

let stats: DailyStat[] = []
let loaded = false
const queue: Array<{ count: number; at: Date }> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let hooksRegistered = false

/** 复用 streak.ts 的本地日期键口径（勿用 UTC）。 */
export function localDayKeyOf(d: Date = new Date()): string {
  return localDayKey(d)
}

function isDailyStat(v: unknown): v is DailyStat {
  const o = v as DailyStat
  return !!o && typeof o.date === 'string' && typeof o.questionCount === 'number'
}

function applyDelta(count: number, at: Date): void {
  const key = localDayKey(at)
  const ts = at.getTime()
  let row = stats.find((s) => s.date === key)
  if (!row) {
    row = { date: key, questionCount: 0, firstStudyAt: ts, lastStudyAt: ts }
    stats.push(row)
  }
  row.questionCount += count
  row.firstStudyAt = Math.min(row.firstStudyAt, ts)
  row.lastStudyAt = Math.max(row.lastStudyAt, ts)
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  try {
    const rec = await db.settings.get(KEY)
    const v = rec?.value
    stats = Array.isArray(v) ? (v as unknown[]).filter(isDailyStat).map((s) => ({ ...s })) : []
  } catch {
    stats = []
  }
  loaded = true
  while (queue.length > 0) {
    const d = queue.shift()!
    applyDelta(d.count, d.at)
  }
}

/** 读取全部每日统计（按日期升序）。 */
export async function loadDailyStats(): Promise<DailyStat[]> {
  await ensureLoaded()
  return stats.map((s) => ({ ...s }))
}

/**
 * 累加一次答题事件（题目级）。同步更新内存 + 触发防抖落盘。
 * @param opts.count 计数（默认 1）；at 事件时刻（默认 now）
 */
export function bumpDailyStats(opts: { count?: number; at?: Date } = {}): void {
  const count = opts.count ?? 1
  const at = opts.at ?? new Date()
  if (loaded) applyDelta(count, at)
  else queue.push({ count, at })
  scheduleFlush()
}

/** 裁剪保留最近 RETAIN_DAYS 天（按本地日期升序截断）。 */
function pruneOld(): void {
  stats.sort((a, b) => a.date.localeCompare(b.date))
  if (stats.length > RETAIN_DAYS) stats = stats.slice(stats.length - RETAIN_DAYS)
}

/** 立即落盘（并裁剪）。 */
export async function flushDailyStats(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await ensureLoaded()
  pruneOld()
  try {
    await db.settings.put({ key: KEY, value: stats.map((s) => ({ ...s })) })
  } catch {
    /* 落盘失败：内存态保留，下次再试 */
  }
}

function scheduleFlush(): void {
  if (typeof setTimeout !== 'function') return
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushDailyStats()
  }, FLUSH_DEBOUNCE_MS)
  registerHooks()
}

function registerHooks(): void {
  if (hooksRegistered || typeof window === 'undefined' || typeof document === 'undefined') return
  hooksRegistered = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushDailyStats()
  })
  window.addEventListener('beforeunload', () => {
    void flushDailyStats()
  })
}

/** 仅供测试：重置模块内存态与钩子标记。 */
export function __resetDailyStatsForTest(): void {
  stats = []
  loaded = false
  queue.length = 0
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  hooksRegistered = false
}
