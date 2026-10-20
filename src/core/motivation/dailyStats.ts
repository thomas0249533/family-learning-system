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
import { currentProfileId, onBeforeProfileSwitch, onProfileChange } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'

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

export const DAILY_STATS_KEY = 'dailyStats'

/** 当前档案的每日统计键（漏分片 → 统计图归零，且无报错） */
export function dailyStatsKey(profileId: string = currentProfileId()): string {
  return scopedKey(DAILY_STATS_KEY, profileId)
}

/** 保留天数 */
export const RETAIN_DAYS = 60
/** 防抖落盘时长（ms） */
export const FLUSH_DEBOUNCE_MS = 1500

let stats: DailyStat[] = []
let loaded = false
const queue: Array<{ count: number; at: Date }> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let hooksRegistered = false
/** 是否已登记"档案切换"钩子（幂等；`__resetDailyStatsForTest` 会复位） */
let profileHooksBound = false

/** 复用 streak.ts 的本地日期键口径（勿用 UTC）。 */
export function localDayKeyOf(d: Date = new Date()): string {
  return localDayKey(d)
}

function isDailyStat(v: unknown): v is DailyStat {
  const o = v as DailyStat
  return !!o && typeof o.date === 'string' && typeof o.questionCount === 'number'
}

/**
 * 把库里读出来的原始值归一化成 `DailyStat[]`（**唯一的形状归一化实现**）。
 *
 * 非数组 → `[]`；数组里形状不对的项（null / 字符串 / 缺 date 或 questionCount）逐条丢弃；
 * 留下来的**拷贝一份**，避免调用方拿到库里那份对象引用。
 *
 * `ensureLoaded()`（单档案缓存）与 `readDailyStatsFor()`（多档案只读）都走这里 ——
 * 复制第二份的话，"什么算一条合法统计"就会有两个答案，而这两个答案只在遇到脏数据时
 * 才会分叉（一个页面有数字、另一个页面没有），排查成本极高。
 */
function normalizeDailyStats(raw: unknown): DailyStat[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter(isDailyStat).map((s) => ({ ...s }))
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

/**
 * 档案切换的两个钩子（幂等登记）：
 *   - 切换**前**：把内存里待落盘的题量刷到**旧档案**的键上（否则会写进新档案）；
 *   - 切换**后**：清空内存缓存，下一次读会从新档案的键重新加载。
 * 顺序不能反。只清不刷 = 丢今天的题量；只刷不清 = 老二看到老大的题量。
 */
function bindProfileHooks(): void {
  if (profileHooksBound) return
  profileHooksBound = true
  onBeforeProfileSwitch(() => flushDailyStats())
  onProfileChange(() => resetDailyStatsCache())
}

/** 丢弃内存缓存（切档案时用；不落盘，调用方负责先 flush） */
export function resetDailyStatsCache(): void {
  stats = []
  loaded = false
  queue.length = 0
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  bindProfileHooks()
  try {
    const rec = await db.settings.get(dailyStatsKey())
    stats = normalizeDailyStats(rec?.value)
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
 * **只读**某个档案的每日统计（不写 `stats` 缓存、不写库、不注册钩子）。
 *
 * 存在的唯一理由：家庭成就墙要一屏读 4 个档案。若墙去调 `loadDailyStats()`，
 * 模块级缓存会把第一个档案的数据留在 `stats` 里并标记 `loaded = true`，
 * 之后热路径（`bumpDailyStats` 累加今日题量）就会往**别人的档案**上记 ——
 * 而且完全不报错，只是老二今天的题量长到了老大头上。
 *
 * 所以墙用这个函数绕开缓存；热路径完全不受影响（`loadDailyStats()` 仍是唯一缓存入口）。
 * 读失败 / 脏数据一律返回干净数组（墙是展示层，不能因为一个档案的坏数据白屏）。
 */
export async function readDailyStatsFor(profileId: string): Promise<DailyStat[]> {
  try {
    const rec = await db.settings.get(dailyStatsKey(profileId))
    return normalizeDailyStats(rec?.value)
  } catch {
    return []
  }
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
    await db.settings.put({ key: dailyStatsKey(), value: stats.map((s) => ({ ...s })) })
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
  profileHooksBound = false
}
