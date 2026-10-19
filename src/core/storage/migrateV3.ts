/**
 * DB v3 迁移：`progress.packageId` 归一化为**归属包**（E-01）。
 *
 * 三条设计约束（`docs/system_design-v1.3.md` §2.3）：
 *   1. **只用 `tx.table(...)`**。在 Dexie 的 versionchange 事务里访问 `db.progress.*` 会死锁
 *      （`db` 上的操作会另起事务，等待当前事务结束，而当前事务在等它）。本文件因此在
 *      `applyV3Migration` 里**不出现任何 `db.` 前缀**，只认 `tx`。
 *   2. 纯计算与哑 IO **分离**：`planV3Migration` 只读 + 纯函数算计划；`applyMergePlan` 只 put/delete，
 *      不含任何业务判断。这样"计划构建失败"和"写库失败"是两类可分辨的失败。
 *   3. 失败**不 rethrow**（AC-E1-7）。rethrow 会让 `db.open()` 失败、整个应用变砖。
 *
 * ## 关于"失败之后还会不会重跑"（两条路径，别混）
 * 版本号一旦推进到 3，Dexie 就**不会再触发** `upgrade()` —— 所以 `upgrade()` 内部的失败
 * **不会**靠"下次打开"自愈。真正兜住失败的是**两条互相独立的路径**：
 *   - **A. 事务被 Dexie 标记 aborted**（写库失败）：整个 versionchange 事务回滚，
 *     版本号**不推进** → 下次 `db.open()` 会从头重跑 upgrade。此时写标记也会失败，被静默吞掉。
 *   - **B. 钩子正常返回、但计划构建失败**（老数据形状意外）：版本号**照常推进**，
 *     我们写入 `migration:v3 = { status: 'failed' }` → 由启动时的 `recoverV3IfNeeded()`
 *     用**同一份纯函数**在普通读写事务里补跑（最多 3 次，见 `MAX_ATTEMPTS`）。
 * 因此"schema 与 v2 逐字符相同"的意义不是"下次自动重试"，而是：
 * **迁移彻底失败也只是统计口径暂时不收敛，应用照常可用、数据一行不丢**。
 */
import type { Transaction } from 'dexie'
import type { LearningPackageRecord, ProgressRecord, SettingRecord } from '@/db'
import { buildOwnerIndex } from '@core/progress/ownerIndex'
import { planProgressMerge, type MergePlan, type MergeStats } from '@core/progress/progressMerge'
import { ensureFields } from '@core/progress/progressRecord'

/** 迁移标记的 settings key（`failed` 时启动会做一次补偿，见 `recoverV3IfNeeded`） */
export const MIGRATION_KEY = 'migration:v3'

/** 补偿最多尝试次数：超过就放弃（避免每次启动都白扫一遍全表） */
export const MAX_ATTEMPTS = 3

export type MigrationStatus = 'ok' | 'failed' | 'ok-recovered'

export interface MigrationMarker {
  status: MigrationStatus
  at: string
  stats?: MergeStats
  error?: string
  /** 已经尝试过几次补偿（只在 `failed` 语义下有意义） */
  attempts?: number
}

/** 只用到 `toArray` / `put` / `delete`，故意不引 Dexie 的 Table 类型（迁移里用不到别的） */
interface TxTable<T> {
  toArray(): Promise<T[]>
  put(value: T): Promise<unknown>
  delete(key: number): Promise<void>
}

function progressTable(tx: Transaction): TxTable<ProgressRecord> {
  return tx.table('progress') as unknown as TxTable<ProgressRecord>
}

function packagesTable(tx: Transaction): TxTable<LearningPackageRecord> {
  return tx.table('packages') as unknown as TxTable<LearningPackageRecord>
}

function settingsTable(tx: Transaction): TxTable<SettingRecord> {
  return tx.table('settings') as unknown as TxTable<SettingRecord>
}

/**
 * 阶段 1：只读 + 纯计算。**唯一的 try/catch 面**（计划构建失败 → 本次不合并）。
 *
 * 接收 `tx` 而不是自己开事务，是为了**可测性**：测试可以塞一个假 `tx`
 * （只需 `table(name) → { toArray, put, delete }`）直接验证计划与写入顺序，
 * 不需要 IndexedDB / fake-indexeddb。
 */
export async function planV3Migration(tx: Transaction): Promise<MergePlan> {
  const packages = (await packagesTable(tx).toArray()) as LearningPackageRecord[]
  const rawRows = (await progressTable(tx).toArray()) as ProgressRecord[]
  // v1 行可能缺 fsrs / bkt / reviewStage / lastReviewAt → 先补默认值再合并
  const rows = rawRows.map(ensureFields)
  return planProgressMerge(rows, buildOwnerIndex(packages))
}

/**
 * 阶段 2：哑 IO。**不含任何业务逻辑、不解析、不校验**，只按计划写。
 * put 必须在 delete 之前（先写后删），且在同一个 versionchange 事务内。
 */
export async function applyMergePlan(tx: Transaction, plan: MergePlan): Promise<void> {
  const table = progressTable(tx)
  for (const put of plan.puts) await table.put(put)
  for (const id of plan.deletes) await table.delete(id)
}

/** 计划 + 应用，返回统计（供 `upgrade()` 与补偿路径共用） */
export async function applyV3Migration(tx: Transaction): Promise<MergeStats> {
  const plan = await planV3Migration(tx)
  await applyMergePlan(tx, plan)
  return plan.stats
}

export async function writeMarker(tx: Transaction, marker: MigrationMarker): Promise<void> {
  await settingsTable(tx).put({ key: MIGRATION_KEY, value: marker })
}

/**
 * Dexie 的 `upgrade()` 回调。**永不抛**（除写入标记也失败时静默）。
 */
export async function migrateProgressV3(tx: Transaction): Promise<void> {
  let plan: MergePlan
  try {
    plan = await planV3Migration(tx)
  } catch (e) {
    console.warn('[migrateV3] 合并计划构建失败，本次不合并（数据保持原样）', e)
    try {
      await writeMarker(tx, {
        status: 'failed',
        at: new Date().toISOString(),
        error: String(e),
        attempts: 0,
      })
    } catch {
      /* 标记也写不进去就算了：版本照常推进，统计层自愈 */
    }
    return
  }

  try {
    await applyMergePlan(tx, plan)
    await writeMarker(tx, { status: 'ok', at: new Date().toISOString(), stats: plan.stats })
  } catch (e) {
    // 路径 A（见文件头）：写库失败 → Dexie 会把整个 versionchange 事务标记为 aborted，
    // 版本号不推进，下次 open() 从头重跑 upgrade；此时再写标记也会失败 → 静默降级。
    console.warn('[migrateV3] 迁移写入失败，事务将回滚（下次启动重跑 upgrade）', e)
    try {
      await writeMarker(tx, {
        status: 'failed',
        at: new Date().toISOString(),
        error: String(e),
        attempts: 0,
      })
    } catch {
      /* 忽略 */
    }
  }
}

/*
 * 说明：`readMigrationMarker` / `recoverV3IfNeeded` 刻意**不放在本文件**。
 * 它们需要运行时的 `db`，而 `db/index.ts` 又要 import 本文件的 `migrateProgressV3` 去挂 upgrade 钩子 ——
 * 放一起就形成 `db → migrateV3 → db` 的循环。拆到 `migrateV3Recovery.ts` 后依赖是单向的：
 *   recovery → db、recovery → migrateV3
 */
