/**
 * v3 迁移的**启动补偿** + **导入后重归因**（`docs/system_design-v1.3.md` §2.3.4）。
 *
 * 两个入口，共用同一份纯函数计划（`planV3Migration`）与哑 IO（`applyMergePlan`）：
 *
 * | 入口 | 触发时机 | 写迁移标记 | 用途 |
 * |---|---|---|---|
 * | `recoverV3IfNeeded()` | 应用启动一次 | 写（`ok-recovered` / `failed`+attempts） | `upgrade()` 里计划构建失败后的补跑 |
 * | `ensureE1Migrated({ orphanOnly })` | 导入包 / 恢复备份之后 / 应用启动（一天最多一次，见 `startupOrphanRecovery.ts`） | **不写**（只写 `progress:lastRecovery`） | 新包进来后，原本"无主"的老进度行变得可归因 → 改写它们 |
 *
 * 为什么要区分：`migration:v3` 是**一次性版本迁移**的语义，一旦写成 `ok` 就不该再被改写；
 * 而"包变了 → 再归因一次"是**可重复发生**的日常动作，两者混写会让迁移状态变成谎言。
 *
 * 成本：正常启动只读一条 settings。`orphanOnly` 才会扫全表，且只在导入/恢复之后、
 * 或启动时（同一本地日期内只跑一次）发生。
 */
import { db } from '@/db'
import type { MigrationMarker } from './migrateV3'
import {
  MAX_ATTEMPTS,
  MIGRATION_KEY,
  applyMergePlan,
  planV3Migration,
  writeMarker,
} from './migrateV3'
import type { MergePlan, MergeStats } from '@core/progress/progressMerge'

/** 导入后重归因的"最后结果"标记（与 `migration:v3` 分开，互不覆盖） */
export const RECOVERY_KEY = 'progress:lastRecovery'

/** 迁移期单一飞行锁：启动补偿与导入重归因必须串行，否则两个事务会互相打架 */
let inflight: Promise<unknown> | null = null

/** 启动补偿的 promise（写入端可以 `await` 它，避免和正在跑的迁移抢事务） */
let settled: Promise<unknown> | null = null

/** 等启动补偿结束；没跑过就立即返回 */
export function awaitE1Settled(): Promise<unknown> {
  return settled ?? Promise.resolve()
}

/** 读迁移标记。读不到 / 结构非法 → null（当成"没跑过"，不补偿） */
export async function readMigrationMarker(): Promise<MigrationMarker | null> {
  try {
    const row = await db.settings.get(MIGRATION_KEY)
    const value = row?.value as MigrationMarker | undefined
    if (!value || typeof value !== 'object' || typeof value.status !== 'string') return null
    return value
  } catch {
    return null
  }
}

/**
 * 该不该跑启动补偿？纯函数，便于把"什么时候放弃"这条规则钉在测试里。
 *
 * 只有 `failed` 且尝试次数未到上限才跑。`ok` / `ok-recovered` **一律不跑** ——
 * 补偿是**一次性**的版本迁移语义，不是每次启动都扫一遍全表。
 */
export function shouldRunRecovery(marker: MigrationMarker | null): boolean {
  if (!marker || marker.status !== 'failed') return false
  return (marker.attempts ?? 0) < MAX_ATTEMPTS
}

/**
 * 启动补偿：只有 `status === 'failed'` 才动，且最多试 `MAX_ATTEMPTS` 次。
 * 失败仍然只告警不阻塞（AC-E1-7）—— 补偿是加分项，不是正确性前提。
 */
export async function recoverV3IfNeeded(): Promise<MigrationMarker | null> {
  if (inflight) return (await inflight) as MigrationMarker | null

  const run = (async (): Promise<MigrationMarker | null> => {
    const marker = await readMigrationMarker()
    if (!shouldRunRecovery(marker)) {
      if (marker?.status === 'failed') {
        // 反复失败说明是"数据形状超出预期"而不是偶发 IO 问题，再扫也没意义
        console.warn('[migrateV3] 补偿已达上限，保持原样（统计层按 key 去重自愈）', {
          attempts: marker.attempts ?? 0,
          error: marker.error,
        })
      }
      return null
    }

    const attempts = marker!.attempts ?? 0

    try {
      const stats = await db.transaction(
        'rw',
        db.packages,
        db.progress,
        db.settings,
        async (tx) => {
          const plan = await planV3Migration(tx)
          if (plan.puts.length > 0 || plan.deletes.length > 0) await applyMergePlan(tx, plan)
          await writeMarker(tx, {
            status: 'ok-recovered',
            at: new Date().toISOString(),
            stats: plan.stats,
          })
          return plan.stats
        }
      )
      console.info('[migrateV3] 补偿迁移完成', stats)
      return { status: 'ok-recovered', at: new Date().toISOString(), stats }
    } catch (e) {
      console.warn('[migrateV3] 补偿迁移仍失败，保持原样', e)
      // 记一次失败尝试（单独事务：上一个事务已回滚，不能复用）
      try {
        await db.settings.put({
          key: MIGRATION_KEY,
          value: {
            status: 'failed',
            at: new Date().toISOString(),
            error: String(e),
            attempts: attempts + 1,
          } satisfies MigrationMarker,
        })
      } catch {
        /* 连标记都写不进去 → 下次启动当作没跑过，仍然只会再试有限的几次 */
      }
      return null
    }
  })()

  inflight = run
  settled = run
  try {
    return await run
  } finally {
    if (inflight === run) inflight = null
  }
}

/**
 * 把当前库里的进度行**按最新包列表**重新归因一次。用于：
 *   - 导入包之后（原本 `|own| === 0` 的历史行，现在可能有了归属包）；
 *   - 恢复用户数据备份之后（备份里可能带着老的入口包 packageId）；
 *   - 应用启动（`startupOrphanRecovery.ts`，同一本地日期内最多一次）—— 兜住"用户既不导入
 *     也不恢复备份"时永远消不掉的孤儿行。
 *
 * 与 `recoverV3IfNeeded` 的差别：**永不写 `migration:v3`**。
 * 零计划时不起写事务（省掉一次无意义的 rw 事务）。
 *
 * `mode` 只影响 `progress:lastRecovery.mode` 这个**观察字段**（谁触发的），不参与任何判断：
 * 不传时按老规则推断（`orphanOnly ? 'import' : 'manual'`），两个旧调用点因此无需改动。
 *
 * 并发：单一飞行锁 + 先等启动补偿结束。
 */
export async function ensureE1Migrated(
  opts: {
    orphanOnly?: boolean
    /** 触发来源，仅用于日志/排查；不传则按 `orphanOnly` 推断 */
    mode?: 'import' | 'restore' | 'startup'
  } = {}
): Promise<MergeStats | null> {
  if (inflight) return (await inflight) as MergeStats | null

  const run = (async (): Promise<MergeStats | null> => {
    await awaitE1Settled()

    // 非 orphanOnly 模式下，迁移已经成功过就不用再扫（一次性语义）
    if (!opts.orphanOnly) {
      const marker = await readMigrationMarker()
      if (marker && (marker.status === 'ok' || marker.status === 'ok-recovered')) return null
    }

    // 阶段 1：只读算计划（零计划 → 不起写事务）
    let plan: MergePlan
    try {
      plan = await db.transaction('r', db.packages, db.progress, (tx) => planV3Migration(tx))
    } catch (e) {
      console.warn('[migrateV3] 重归因计划构建失败，本次跳过', e)
      return null
    }
    if (plan.puts.length === 0 && plan.deletes.length === 0) return plan.stats

    // 阶段 2：写。串行锁保证阶段 1、2 之间没有别的写入端插进来（进度写入也走这条锁的同一线程）
    try {
      await db.transaction('rw', db.progress, db.settings, async (tx) => {
        await applyMergePlan(tx, plan)
        await tx.table('settings').put({
          key: RECOVERY_KEY,
          value: { at: new Date().toISOString(), stats: plan.stats, mode: opts.mode ?? (opts.orphanOnly ? 'import' : 'manual') },
        })
      })
      console.info('[migrateV3] 进度重归因完成', plan.stats)
      return plan.stats
    } catch (e) {
      console.warn('[migrateV3] 进度重归因写入失败，本次跳过（下次导入/启动再说）', e)
      return null
    }
  })()

  inflight = run
  try {
    return await run
  } finally {
    if (inflight === run) inflight = null
  }
}
