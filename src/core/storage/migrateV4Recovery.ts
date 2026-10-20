/**
 * v4 迁移的**启动补偿**与**完整性核对**（`docs/system_design-v1.4.md` §4.4）。
 *
 * 为什么需要它：`upgrade()` 只在版本号推进时触发一次。若它在"计划构建"阶段失败
 * （老数据形状超出预期），版本号已经推进，Dexie 不会再来一次 —— 这时只能靠这里补跑。
 *
 * 与 v3 补偿的两点差异：
 *   1. **多一个"看不见的行"核对**。v4 是加列，最隐蔽的失败是"某些行没被补上 profileId"：
 *      Dexie 不管语义，这些行**读得到但被 `progressOf(pid)` 过滤掉** → 统计偏低且无报错。
 *      所以补偿结束后必须数一遍 `缺 profileId 的行数`，不为 0 就继续试（上限 3 次）。
 *   2. **`partial` 是一个终态**。3 次之后仍有缺行 → 写 `partial` 并让家长端显示一条提示。
 *      绝对不静默吞掉：数据不对却说一切都好，是最坏的选择。
 */
import { db } from '@/db'
import {
  V4_MARKER_KEY,
  V4_MAX_ATTEMPTS,
  applyV4Plan,
  planV4Migration,
  type V4Marker,
  type V4Stats,
} from './migrateV4'
import { PROFILES_KEY } from '@core/profile/profileTypes'

/** 补偿期串行队列：避免两次补偿同时开写事务 */
let tail: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function readV4Marker(): Promise<V4Marker | null> {
  try {
    const row = await db.settings.get(V4_MARKER_KEY)
    const value = row?.value as V4Marker | undefined
    if (!value || typeof value !== 'object' || typeof value.status !== 'string') return null
    return value
  } catch {
    return null
  }
}

/**
 * 该不该跑补偿？纯函数，把"什么时候放弃"钉在测试里。
 *
 * `ok` **不跑**（一次性语义）；`partial` / `failed` 才跑，且都受 `V4_MAX_ATTEMPTS` 约束。
 * `partial` 也要跑，是因为它的成因可能是"unknownKeys 非空"这种无需修的情况，
 * 多核一次能把它升级成 `ok`（核完没有缺行、且 profiles 键在 → `ok`）。
 */
export function shouldRunV4Recovery(marker: V4Marker | null): boolean {
  if (!marker) return false
  if (marker.status === 'ok' || marker.status === 'ok-recovered') return false
  return (marker.attempts ?? 0) < V4_MAX_ATTEMPTS
}

/**
 * 数一遍"缺 profileId 的行"。用 `filter` 而不是建索引：这是一次性核对，
 * 表规模最多几万行，扫一遍几十毫秒，不值得为它加索引。
 */
export async function auditMissingProfileId(): Promise<{
  progress: number
  mistakes: number
  sessions: number
  hasProfilesKey: boolean
}> {
  const missing = (rows: Array<{ profileId?: string }>) =>
    rows.reduce((n, r) => (typeof r.profileId === 'string' && r.profileId.trim() ? n : n + 1), 0)

  const [progress, mistakes, sessions, profilesRow] = await Promise.all([
    db.progress.toArray(), // profile-scope-ok: 核对"有没有缺 profileId 的行"，必须看全库
    db.mistakes.toArray(), // profile-scope-ok: 同上
    db.examSessions.toArray(), // profile-scope-ok: 同上
    db.settings.get(PROFILES_KEY).catch(() => undefined),
  ])

  return {
    progress: missing(progress),
    mistakes: missing(mistakes),
    sessions: missing(sessions),
    hasProfilesKey: !!profilesRow,
  }
}

/** 是否还有需要修的问题（纯函数，便于测试） */
export function hasScopeGaps(audit: {
  progress: number
  mistakes: number
  sessions: number
  hasProfilesKey: boolean
}): boolean {
  return audit.progress > 0 || audit.mistakes > 0 || audit.sessions > 0 || !audit.hasProfilesKey
}

/**
 * 启动补偿。永不抛（调用方在启动链上，抛了会断掉后续步骤）。
 * 返回写下的 marker（或 null 表示没跑）。
 */
export async function recoverV4IfNeeded(): Promise<V4Marker | null> {
  return serialize(async (): Promise<V4Marker | null> => {
    const marker = await readV4Marker()
    if (!shouldRunV4Recovery(marker)) {
      if (marker && marker.status !== 'ok' && marker.status !== 'ok-recovered') {
        console.warn('[migrateV4] 补偿已达上限或无需补偿，保持原样', {
          status: marker.status,
          attempts: marker.attempts ?? 0,
          error: marker.error,
        })
      }
      return null
    }

    const attempts = (marker!.attempts ?? 0) + 1
    const at = new Date().toISOString()

    try {
      const stats: V4Stats = await db.transaction(
        'rw',
        db.progress,
        db.mistakes,
        db.examSessions,
        db.settings,
        async (tx) => {
          const plan = await planV4Migration(tx)
          await applyV4Plan(tx, plan)
          return plan.stats
        }
      )

      // 补完之后立刻核对：还有缺行就不算 ok
      const audit = await auditMissingProfileId()
      const gaps = hasScopeGaps(audit)
      const next: V4Marker = {
        status: gaps ? (attempts >= V4_MAX_ATTEMPTS ? 'partial' : 'failed') : 'ok-recovered',
        at,
        stats,
        attempts: gaps ? attempts : undefined,
        error: gaps ? `仍有缺 profileId 的行：${JSON.stringify(audit)}` : undefined,
      }

      await writeMarker(next)
      if (gaps) {
        console.warn('[migrateV4] 补偿后仍有缺行', audit)
      } else {
        console.info('[migrateV4] 补偿完成', stats)
      }
      return next
    } catch (e) {
      console.warn('[migrateV4] 补偿仍失败，保持原样', e)
      const next: V4Marker = {
        status: attempts >= V4_MAX_ATTEMPTS ? 'partial' : 'failed',
        at,
        error: String(e),
        attempts,
      }
      await writeMarker(next)
      return next
    }
  })
}

/** 写标记（独立小事务；补偿失败时上一个事务已回滚，不能复用） */
async function writeMarker(marker: V4Marker): Promise<void> {
  try {
    await db.settings.put({ key: V4_MARKER_KEY, value: marker })
  } catch {
    /* 连标记都写不进去 → 下次启动当作没跑过，仍只会再试有限几次 */
  }
}

/** 供 UI 判断"要不要提示家长数据修复未完成" */
export async function v4NeedsAttention(): Promise<boolean> {
  const marker = await readV4Marker()
  if (!marker) return false
  if (marker.status === 'partial') return true
  if (marker.status !== 'failed') return false
  return (marker.attempts ?? 0) >= V4_MAX_ATTEMPTS
}
