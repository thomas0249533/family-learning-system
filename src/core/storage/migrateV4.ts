/**
 * DB v4 迁移：给三张表补 `profileId`，把 8 个 settings 键搬成 `<key>:<profileId>`。
 *
 * ## 与 v3 的本质差异（决定了本文件的设计重点）
 * |  | v3（E-01） | v4 |
 * |---|---|---|
 * | 目的 | **改内容**：`packageId` 归一化为归属包 | **加列 + 搬键** |
 * | 计算 | 需要包列表参与（算归属） | **不需要**任何业务计算 |
 * | 失败模式 | 统计口径不收敛（数字错） | **某个孩子的数据看起来归零**（且无报错） |
 *
 * 所以 v4 的重点不是"计划算得对"，而是**"清单穷举 + 未知键兜底 + 可核对"**。
 *
 * ## 四条铁律（与 v3 相同，逐条照抄）
 * 1. **只用 `tx.table(...)`**。在 versionchange 事务里访问 `db.xxx` 会死锁
 *    （`db` 上的操作另起事务并等待当前事务结束，而当前事务在等它）。
 * 2. 纯计算与哑 IO 分离：`planV4Migration` 只读 + 纯计算；`applyV4Plan` 只 update/put。
 * 3. 失败**不 rethrow**：rethrow 会让 `db.open()` 失败、整个应用变砖。
 * 4. 版本号一旦推进，`upgrade()` **不会**再被触发 —— 补偿靠 `migrateV4Recovery.ts`。
 *
 * ## 为什么"补一个字段"而不整行重写
 * `applyV4Plan` 用 `table.update(id, { profileId })`。若改成"读出来 + spread + put"，
 * 就会经过一次 JS 对象的序列化往返，`fsrs` / `bkt` 里的浮点与嵌套结构可能被顺手改写
 * （`toPlain()` 在别的模块里用的是 `JSON.parse(JSON.stringify())`）。迁移只应该做加法。
 */
import type { Transaction } from 'dexie'
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, PROFILES_KEY } from '@core/profile/profileTypes'
import type { ProfileMeta } from '@core/profile/profileTypes'
import { classifyKey, scopedKey } from '@core/profile/settingsScope'

export const V4_MARKER_KEY = 'migration:v4'
export const V4_MAX_ATTEMPTS = 3

export type V4Status = 'ok' | 'ok-recovered' | 'failed' | 'partial'

export interface V4Stats {
  progress: number
  mistakes: number
  sessions: number
  settingsCopied: number
  /** 没有出现在任何清单里的键（已按 per-profile 搬，同时告警） */
  unknownKeys: string[]
}

export interface V4Marker {
  status: V4Status
  at: string
  stats?: V4Stats
  error?: string
  attempts?: number
  /** 升级前是否导出过备份（PRD §4.5 的"升级前强制导出"） */
  preExport?: 'done' | 'skipped'
}

export interface V4Plan {
  progressPatches: Array<{ id: number; profileId: string }>
  mistakePatches: Array<{ id: number; profileId: string }>
  sessionPatches: Array<{ id: number; profileId: string }>
  /** 要写的 settings 行（含 `profiles` 键的初始化） */
  settingPuts: Array<{ key: string; value: unknown }>
  stats: V4Stats
}

/** 只用到这四个方法，故意不引 Dexie 的 Table 类型（迁移里用不到别的，且便于假 tx 测试） */
interface TxTable<T> {
  toArray(): Promise<T[]>
  put(value: T): Promise<unknown>
  update(key: number, changes: Partial<T>): Promise<number>
}

interface RawRow {
  id?: number
  profileId?: string
  [k: string]: unknown
}

function tableOf<T>(tx: Transaction, name: string): TxTable<T> {
  return tx.table(name) as unknown as TxTable<T>
}

/** 找出缺 `profileId` 的行，产出补丁。纯函数（输入就是行数组）。 */
export function planColumnPatch<T extends RawRow>(rows: T[]): Array<{ id: number; profileId: string }> {
  const patches: Array<{ id: number; profileId: string }> = []
  for (const row of rows) {
    if (typeof row.id !== 'number') continue
    const pid = typeof row.profileId === 'string' ? row.profileId.trim() : ''
    if (pid) continue
    patches.push({ id: row.id, profileId: DEFAULT_PROFILE_ID })
  }
  return patches
}

/**
 * 阶段 1：只读 + 纯计算。**唯一的 try/catch 面**在调用方。
 *
 * 幂等（两处，缺一处就会长出 `xxx:default:default`）：
 * 1. `planColumnPatch` 只挑缺字段的行 → 跑第二遍是空计划；
 * 2. settings 搬迁先看**目标键是否已存在**（挡 legacy 键），且 unknown 分支**先判后缀**
 *    （挡"上一轮自己造的副本"—— 副本自己也不在任何清单里，否则会被再复制一层）。
 */
export async function planV4Migration(tx: Transaction): Promise<V4Plan> {
  const progressRows = (await tableOf<RawRow>(tx, 'progress').toArray()) ?? []
  const mistakeRows = (await tableOf<RawRow>(tx, 'mistakes').toArray()) ?? []
  const sessionRows = (await tableOf<RawRow>(tx, 'examSessions').toArray()) ?? []
  const settingRows = (await tableOf<{ key: string; value: unknown }>(tx, 'settings').toArray()) ?? []

  const existing = new Set(settingRows.map((r) => r.key))
  const profileSuffix = `:${DEFAULT_PROFILE_ID}`
  const settingPuts: Array<{ key: string; value: unknown }> = []
  const unknownKeys: string[] = []
  let settingsCopied = 0

  for (const row of settingRows) {
    if (!row || typeof row.key !== 'string') continue
    const scope = classifyKey(row.key)

    if (scope.kind === 'global') continue
    if (scope.kind === 'profile') continue // 已经是新形态

    if (scope.kind === 'profile-legacy') {
      const target = scopedKey(scope.base, DEFAULT_PROFILE_ID)
      // 目标已存在 → 说明上一次迁移跑过（或用户手工造过），不覆盖
      if (!existing.has(target)) {
        settingPuts.push({ key: target, value: row.value })
        existing.add(target)
        settingsCopied++
      }
      continue
    }

    // unknown：口径是"按 per-profile 搬"，同时告警（见 settingsScope 文件头）。
    // 原键保留 —— 它可能是一个我们不认识的全局键，删了会伤到别的东西；
    // 复制一份带后缀的，是为了将来若有人把它登记进清单、读取端改成 scopedKey 时数据还在。
    //
    // ⚠️ 幂等闸门：**副本自己也是 unknown**（`weird:thing:default` 同样不在任何清单里），
    // 若不先判后缀，第二轮会再造出 `weird:thing:default:default`，补偿最多跑
    // V4_MAX_ATTEMPTS 次 → 一条脏键长成 4 层后缀，`stats.unknownKeys` 也每轮膨胀一条。
    // 命中闸门即视为"已搬过"：既不复制，也不再进告警列表（副本不是新信息，
    // 原键每轮仍会被报出来，家长端的核对提示不会因此消失）。
    //
    // 但"以 :default 结尾"本身不是充分证据 —— 第三方键**本来就可能叫** `vendor:flag:default`，
    // 那种键既没被搬过也不该被静默吞掉（正好是 v4 最怕的"漏搬且无告警"）。
    // 所以再要一层证据：**父键在场**才说明这行是迁移自己造的副本
    // （`weird:thing:default` 的父键 `weird:thing` 一定还在，原键从不删除）。
    // 残留歧义：用户迁移前就同时有 `foo` 与 `foo:default` 时无法区分，按"副本"处理 ——
    // 两个都保留、只报 `foo`，数据不丢。
    if (row.key.endsWith(profileSuffix) && existing.has(row.key.slice(0, -profileSuffix.length))) {
      continue
    }

    unknownKeys.push(row.key)
    const target = `${row.key}${profileSuffix}`
    if (!existing.has(target)) {
      settingPuts.push({ key: target, value: row.value })
      existing.add(target)
      settingsCopied++
    }
  }

  // `profiles` 键必须存在，否则 UI 与导入都得多一条"没读到就新建"的分支
  if (!existing.has(PROFILES_KEY)) {
    const list: ProfileMeta[] = [
      {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        createdAt: new Date(0).toISOString(),
      },
    ]
    settingPuts.push({ key: PROFILES_KEY, value: { activeId: DEFAULT_PROFILE_ID, list } })
    existing.add(PROFILES_KEY)
  }

  return {
    progressPatches: planColumnPatch(progressRows),
    mistakePatches: planColumnPatch(mistakeRows),
    sessionPatches: planColumnPatch(sessionRows),
    settingPuts,
    stats: {
      progress: progressRows.length,
      mistakes: mistakeRows.length,
      sessions: sessionRows.length,
      settingsCopied,
      unknownKeys,
    },
  }
}

/** 阶段 2：哑 IO。不含任何判断，只按计划写。 */
export async function applyV4Plan(tx: Transaction, plan: V4Plan): Promise<void> {
  const progress = tableOf<RawRow>(tx, 'progress')
  const mistakes = tableOf<RawRow>(tx, 'mistakes')
  const sessions = tableOf<RawRow>(tx, 'examSessions')
  const settings = tableOf<{ key: string; value: unknown }>(tx, 'settings')

  for (const p of plan.progressPatches) await progress.update(p.id, { profileId: p.profileId })
  for (const p of plan.mistakePatches) await mistakes.update(p.id, { profileId: p.profileId })
  for (const p of plan.sessionPatches) await sessions.update(p.id, { profileId: p.profileId })
  for (const s of plan.settingPuts) await settings.put(s)
}

export async function writeV4Marker(tx: Transaction, marker: V4Marker): Promise<void> {
  await tableOf<{ key: string; value: V4Marker }>(tx, 'settings').put({
    key: V4_MARKER_KEY,
    value: marker,
  })
}

/**
 * Dexie 的 `upgrade()` 回调。**永不抛**。
 *
 * 两条失败路径（与 v3 完全同构，别混）：
 *   A. 写库失败 → Dexie 把 versionchange 事务标记 aborted → 版本号**不推进** →
 *      下次 `open()` 从头重跑；此时写标记也会失败，静默。
 *   B. 钩子正常返回但计划构建失败 → 版本号照常推进 → 写 `failed` →
 *      由 `recoverV4IfNeeded()` 在普通读写事务里补跑（上限 3 次）。
 */
export async function migrateProfileV4(tx: Transaction): Promise<void> {
  let plan: V4Plan
  try {
    plan = await planV4Migration(tx)
  } catch (e) {
    console.warn('[migrateV4] 迁移计划构建失败，本次不改动（数据保持原样）', e)
    try {
      await writeV4Marker(tx, {
        status: 'failed',
        at: new Date().toISOString(),
        error: String(e),
        attempts: 0,
      })
    } catch {
      /* 标记也写不进去就算了：版本照常推进，下次启动靠补偿 */
    }
    return
  }

  try {
    await applyV4Plan(tx, plan)
    // 有未知键时不直接判 ok：让补偿路径再核一次（补偿里有"缺 profileId 的行"计数核对）
    await writeV4Marker(tx, {
      status: plan.stats.unknownKeys.length > 0 ? 'partial' : 'ok',
      at: new Date().toISOString(),
      stats: plan.stats,
    })
    if (plan.stats.unknownKeys.length > 0) {
      console.warn('[migrateV4] 以下 settings 键未在清单中登记，已按档案复制一份：', plan.stats.unknownKeys)
    }
  } catch (e) {
    console.warn('[migrateV4] 迁移写入失败，事务将回滚（下次启动重跑 upgrade）', e)
    try {
      await writeV4Marker(tx, {
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
 * 说明：`readV4Marker` / `recoverV4IfNeeded` 刻意**不放在本文件**。
 * 它们需要运行时的 `db`，而 `db/index.ts` 又要 import 本文件的 `migrateProfileV4` 去挂钩子 ——
 * 放一起就形成 `db → migrateV4 → db` 的循环。拆出去后依赖是单向的。
 */
