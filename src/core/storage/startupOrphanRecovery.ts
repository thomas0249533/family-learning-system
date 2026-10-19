/**
 * 启动期的"孤儿行"重归因（V1.3 · E-01 收尾，`docs/system_design-v1.3.md` §2.3.2 的第三个调用点）。
 *
 * 背景：`ensureE1Migrated({ orphanOnly: true })` 原本只在**导入包**与**恢复备份**之后被调用。
 * 老库里还有一类行既不来自导入也不来自恢复：入口包被卸载 / 改名之后，归属包解析不出来，
 * 键一直挂在那个已经不存在的 `packageId` 上 —— 掌握率被永久稀释。用户如果既不导入也不恢复备份，
 * 这些行永远没有机会被改写，所以必须由**启动**兜一次。
 *
 * 三条约束：
 *   1. **不阻塞首屏**：`main.ts` 在 `app.mount()` + `recoverV3IfNeeded()` **之后**才 `void` 调用它，
 *      首次渲染不等它。
 *   2. **共用单飞锁**：真正扫表的 `ensureE1Migrated` 与启动补偿 `recoverV3IfNeeded` 共用
 *      `migrateV3Recovery.ts` 里的 module 级 `inflight`（第二把锁会让"同一批行被求两次和 →
 *      correctCount 翻倍"重新变成可能）。本文件只补一把**启动触发自身**的去重锁，
 *      保证同一次启动里不会重复读标记、重复写标记 —— 它不参与数据库并发语义。
 *   3. **一天最多一次**：全表扫描不该每次开窗都做。用**本地日期键**（`localDayKey`）比较，
 *      **不用 `toISOString()`** —— 后者按 UTC 算，晚上 8 点之后会被算成第二天
 *      （`streak` 已经在这上面栽过一次，见 `core/motivation/streak.ts` 文件头）。
 *
 * 失败语义：一律 swallow（`console.warn`）。启动路径上没有任何理由让这件事把应用拖下水；
 * 失败时**不写** `progress:lastStartupRecovery`，于是下次启动会自然再试一次。
 */
import { db } from '@/db'
import { localDayKey } from '@core/motivation/streak'
import type { MergeStats } from '@core/progress/progressMerge'
import { ensureE1Migrated } from './migrateV3Recovery'

/**
 * "上次启动重归因"的 settings key。
 *
 * 刻意与 `migration:v3`（一次性版本迁移语义）、`progress:lastRecovery`（导入/恢复触发）
 * 分开：三者说的不是同一件事，混写会让每一条都变成谎言。
 */
export const STARTUP_RECOVERY_KEY = 'progress:lastStartupRecovery'

export interface StartupRecoveryMarker {
  /** 本地日期键 `YYYY-MM-DD`，只用于"一天一次"判断 */
  day: string
  /** 本地时间戳（给人看），刻意不是 ISO/UTC */
  at: string
  stats: MergeStats
}

/**
 * 今天该不该跑启动重归因？纯函数，便于把"一天一次"钉在测试里。
 *
 * @param lastDay 上次成功跑过的**本地日期键**；没跑过 → `null` / `undefined`
 * @param today 今天的本地日期键（`localDayKey()`）
 * @returns 只有"今天还没跑过"才是 true
 */
export function shouldRunOrphanRecovery(lastDay: string | null | undefined, today: string): boolean {
  if (!today) return false
  return lastDay !== today
}

/** 本地时间戳 `YYYY-MM-DD HH:mm:ss`。禁用 `toISOString()`：那是 UTC 口径 */
function localStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${localDayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 读标记。读不到 / 结构非法 / 读失败 → null（当成"今天没跑过"，最多多扫一次） */
async function readStartupMarker(): Promise<StartupRecoveryMarker | null> {
  try {
    const row = await db.settings.get(STARTUP_RECOVERY_KEY)
    const value = row?.value as StartupRecoveryMarker | undefined
    if (!value || typeof value !== 'object' || typeof value.day !== 'string') return null
    return value
  } catch {
    return null
  }
}

/** 写标记。写失败只告警：拿不到"今天跑过了"的证据，下次启动再扫一次即可 */
async function writeStartupMarker(day: string, stats: MergeStats): Promise<void> {
  try {
    await db.settings.put({
      key: STARTUP_RECOVERY_KEY,
      value: { day, at: localStamp(), stats } satisfies StartupRecoveryMarker,
    })
  } catch (e) {
    console.warn('[startup] 记录启动重归因结果失败（不影响本次结果，下次启动会再跑）', e)
  }
}

/** 启动触发自身的去重锁（与 `migrateV3Recovery` 的 `inflight` 不是一回事，见文件头第 2 条） */
let startupRun: Promise<MergeStats | null> | null = null

/**
 * 启动时跑一次"孤儿行"重归因。**永不抛**（AC-E1-7 的启动侧同款约定）。
 *
 * 返回本次的统计；跳过（今天已跑过 / 已在跑）或失败时返回 `null`。
 */
export async function runStartupOrphanRecovery(): Promise<MergeStats | null> {
  if (startupRun) return startupRun

  const run = (async (): Promise<MergeStats | null> => {
    const today = localDayKey()
    try {
      const marker = await readStartupMarker()
      if (!shouldRunOrphanRecovery(marker?.day, today)) return null

      // 内部已保证：不写 `migration:v3`、零计划不起写事务、与启动补偿共用单飞锁
      // mode:'startup' 只影响 `progress:lastRecovery.mode`（否则会被记成 'import'）
      const stats = await ensureE1Migrated({ orphanOnly: true, mode: 'startup' })
      if (stats === null) return null // 内部失败：不记标记 → 下次启动再试

      if (stats.rewritten > 0 || stats.mergedGroups > 0) {
        console.info('[startup] 孤儿进度行已重归因', stats)
      }
      await writeStartupMarker(today, stats)
      return stats
    } catch (e) {
      // `ensureE1Migrated` 自己吞异常；这里只兜它想不到的失败（读标记、写标记等）
      console.warn('[startup] 孤儿行重归因失败，忽略（不影响启动，下次启动再试）', e)
      return null
    }
  })()

  startupRun = run
  try {
    return await run
  } finally {
    if (startupRun === run) startupRun = null
  }
}
