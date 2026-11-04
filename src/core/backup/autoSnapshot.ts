/**
 * 自动快照（V3.0 · M4）—— 数据可信的第一道保险
 * ---------------------------------------------------------------------
 * ## 它解决什么
 * 现有备份是**手动**的：设置页点"导出"，选个文件夹，存下来。
 * 真实家庭里这件事基本不会发生 —— 于是"孩子三个月的学习记录"只存在于
 * IndexedDB 这一份里。一次误操作、一次升级出问题、一次浏览器清缓存，
 * 全没了，且**没有任何恢复入口**。
 *
 * 快照分两类，共用同一个 settings 键：
 *   - `daily`：每天首次启动静默拍一份，保留最近 7 份；
 *   - `preClear`：**任何清空动作执行前**强制拍一份，是"最后一道保险"。
 *
 * ## V3.1.3 事故复盘：为什么必须有 preClear
 * 真机事故（2026-11-04）：家长在 3.1.1 点了「清空所有数据（含包）」，
 * 该操作执行 `db.settings.clear()` —— 而每日快照**就存在 settings 表里**，
 * 于是救命的快照被这次清空一起删了。之后每天启动又拍"空数据"的新快照，
 * 7 天窗口滚完，清空前的记录彻底消失，没有任何恢复入口。
 * 三个致命缺陷叠加：① 清空前不拍；② 清空会删掉快照本身；③ 7 份滚动会把
 * 事发前的每日快照挤掉。本版逐一修掉：
 *   ① `capturePreClearSnapshot()` + `withPreClearSnapshot()`：拍失败就**中止清空**；
 *   ② `clearAllUserDataExceptSnapshots()`：清空业务表但把快照写回；
 *   ③ preClear 与 daily 分开计数、独立保留，且「清空快照」按钮不碰 preClear。
 *
 * ## 为什么直接复用 `buildBackupV2`
 * 它是全库唯一的"完整数据"口径（有 200 组属性测试 + 往返测试盯着）。
 * 为快照另写一套转储逻辑，等于制造第二个"什么算完整数据"的答案 ——
 * 两份迟早会分叉，而分叉的表现是"恢复后少了点东西"。
 *
 * ## 为什么快照**不进备份文件**
 * 快照的内容就是一份备份。若它跟着备份一起导出，备份文件里会有 N 份备份，
 * 每份又包含快照 —— 体积指数膨胀。所以：
 *   - `EXPORT_EXCLUDED_GLOBAL_KEYS` 排除它（两类共用一个键，已覆盖）；
 *   - `GLOBAL_NEVER_MERGE` 也不许它从别的设备的备份里混进来。
 *
 * ## 恢复语义：**合并**，不是覆盖
 * 恢复走 `previewImport` + `executeImport`（与"从文件导入备份"同一条路径）。
 * 这意味着：本地已删除的记录会被补回来，而本地**更新**的记录不会被旧快照覆盖
 * （合并规则是"较新者胜"）。对"误删/升级坏了"这两种真实事故，这正是想要的；
 * 对"我想要一周前的样子"则不适用 —— 那种需求该用手动导出文件，不是快照。
 */

import { db } from '@/db'
import { buildBackupV2 } from './bundleIO'
import { previewImport, executeImport } from './importOrchestrator'
import { localDayKey } from '@core/motivation/streak'
import pkg from '../../../package.json'
import type { BackupV2 } from './types'

/** settings 键（global：快照属于**这台设备**，不跟档案走） */
export const SNAPSHOTS_KEY = 'backup:snapshots'

/** 每日快照保留份数 */
export const KEEP_SNAPSHOTS = 7

/** 清空前保护快照保留份数（清空动作很罕见，留足多次反悔的余地） */
export const KEEP_PRE_CLEAR = 10

/** daily = 每日自动；preClear = 危险操作前的强制恢复点 */
export type SnapshotKind = 'daily' | 'preClear'

export interface SnapshotEntry {
  /** 唯一 id：恢复按它定位（同一天可能连拍多份 preClear，date 会重复） */
  id: string
  /** 本地日 YYYY-MM-DD */
  date: string
  /** 拍摄时刻（ISO） */
  createdAt: string
  /** 仅排障用 */
  appVersion: string
  /** 触发原因，仅 preClear 有（展示给家长："清空学习进度前的恢复点"） */
  reason?: string
  kind: SnapshotKind
  backup: BackupV2
}

export interface SnapshotFile {
  version: 1
  items: SnapshotEntry[]
}

const pkgVersion = (pkg as { version?: unknown }).version
const APP_VERSION: string =
  typeof pkgVersion === 'string' && pkgVersion !== '' ? pkgVersion : 'unknown'

function normalize(raw: unknown): SnapshotFile {
  const f = raw as SnapshotFile | undefined
  if (!f || f.version !== 1 || !Array.isArray(f.items)) return { version: 1, items: [] }
  const items: SnapshotEntry[] = f.items
    .filter(
      (it): it is SnapshotEntry =>
        !!it && typeof it.date === 'string' && typeof it.createdAt === 'string' && !!it.backup
    )
    // 向后兼容 3.1.2 及更早写的条目：没有 id / kind 的一律当 daily，
    // id 用 createdAt 兜底（同日多份 daily 本来就不会出现）。
    .map((it, i) => ({
      ...it,
      id: typeof it.id === 'string' && it.id ? it.id : `legacy-${it.createdAt}-${i}`,
      kind: it.kind === 'preClear' ? ('preClear' as const) : ('daily' as const),
    }))
  // 新→旧（listSnapshots 与 prune 都依赖这个顺序）
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { version: 1, items }
}

/** 按类别分组裁剪：preClear 不受 daily 的 7 份窗口挤压 */
function prune(items: SnapshotEntry[]): SnapshotEntry[] {
  const preClear = items.filter((it) => it.kind === 'preClear').slice(0, KEEP_PRE_CLEAR)
  const daily = items.filter((it) => it.kind !== 'preClear').slice(0, KEEP_SNAPSHOTS)
  return [...preClear, ...daily].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function newId(prefix: string, now: Date): string {
  // 同一天可能连拍多份保护快照，时间戳 + 随机后缀保证可唯一定位
  return `${prefix}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 列出已有快照（新 → 旧）。读失败一律返回空表（快照坏了不该让设置页白屏）。 */
export async function listSnapshots(): Promise<SnapshotEntry[]> {
  try {
    const rec = await db.settings.get(SNAPSHOTS_KEY)
    return normalize(rec?.value).items
  } catch {
    return []
  }
}

export interface SnapshotResult {
  created: boolean
  /** 当前保留的份数（created = false 时是既有份数） */
  count: number
  error?: string
}

/**
 * 今天还没拍过就拍一份。
 *
 * **失败绝不抛错**：快照是后台保险，不是用户操作。它失败不该打断启动流程、
 * 也不该弹窗（弹了家长也做不了什么）。错误记进返回值与 console，供排障。
 */
export async function maybeAutoSnapshot(now: Date = new Date()): Promise<SnapshotResult> {
  const today = localDayKey(now)
  try {
    const rec = await db.settings.get(SNAPSHOTS_KEY)
    const file = normalize(rec?.value)
    if (file.items.some((it) => it.date === today)) {
      return { created: false, count: file.items.length }
    }

    const backup = await buildBackupV2()
    const entry: SnapshotEntry = {
      id: newId('daily', now),
      date: today,
      createdAt: now.toISOString(),
      appVersion: APP_VERSION,
      kind: 'daily',
      backup,
    }
    const items = prune([entry, ...file.items])
    await db.settings.put({ key: SNAPSHOTS_KEY, value: { version: 1, items } })
    return { created: true, count: items.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[autoSnapshot] 自动快照失败（忽略）', err)
    return { created: false, count: 0, error: msg }
  }
}

/**
 * 强制拍一份「危险操作前」的保护快照。
 *
 * 与 `maybeAutoSnapshot` 的两点不同（都是故意的）：
 * 1. **不受"今天已拍过"限制** —— 一天内连点两次清空，两次都要各自留一个恢复点；
 * 2. **失败必须让调用方知道** —— 这是清空前最后一道保险，静默失败等于裸奔。
 *    所以这里返回 `ok:false` 而不是吞掉，由 `withPreClearSnapshot` 中止清空。
 */
export async function capturePreClearSnapshot(
  reason: string,
  now: Date = new Date()
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const backup = await buildBackupV2()
    const rec = await db.settings.get(SNAPSHOTS_KEY)
    const file = normalize(rec?.value)
    const entry: SnapshotEntry = {
      id: newId('preclear', now),
      date: localDayKey(now),
      createdAt: now.toISOString(),
      appVersion: APP_VERSION,
      reason,
      kind: 'preClear',
      backup,
    }
    const items = prune([entry, ...file.items])
    await db.settings.put({ key: SNAPSHOTS_KEY, value: { version: 1, items } })
    return { ok: true, id: entry.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[autoSnapshot] 清空前保护快照失败（将中止清空）', err)
    return { ok: false, error: msg }
  }
}

/**
 * 危险操作的统一守卫：**先拍保护快照，拍不上就不许动数据**。
 *
 * 语义上这是"写前日志"的退化版：IndexedDB 没有跨表事务外的事务日志，
 * 但清空是显式的一次性动作，一个前置快照足以覆盖 99% 的误操作场景。
 * 调用方必须检查 `ok`，`ok:false` 时 `action` 一次都不会执行。
 */
export async function withPreClearSnapshot(
  reason: string,
  action: () => Promise<void>
): Promise<{ ok: boolean; error?: string; snapshotId?: string }> {
  const cap = await capturePreClearSnapshot(reason)
  if (!cap.ok) return { ok: false, error: `无法保存恢复点，已取消操作：${cap.error ?? '未知原因'}` }
  try {
    await action()
    return { ok: true, snapshotId: cap.id }
  } catch (err) {
    // 恢复点已经落盘，清空本身失败也要把「已保留恢复点」告诉调用方
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg, snapshotId: cap.id }
  }
}

/**
 * 「清空所有数据（含包）」专用：**删掉业务数据，但把快照完整写回**。
 *
 * 3.1.2 及更早这里是 `db.settings.clear()`，把存在 settings 里的每日快照
 * 一起删了 —— 这正是 2026-11-04 事故拿不回进度的直接原因。
 * 现在先把快照读出来，清完 4 张表再写回；快照损坏/读失败时读出来是空表，
 * 但那种情况下前面 `capturePreClearSnapshot` 也会失败并中止清空，不会走到这里。
 */
export async function clearAllUserDataExceptSnapshots(): Promise<void> {
  const rec = await db.settings.get(SNAPSHOTS_KEY).catch(() => undefined)
  const snapshots = normalize(rec?.value)
  await Promise.all([
    db.packages.clear(),
    // profile-scope-ok: 「清空所有数据」语义就是整库重置（含全部档案），跨档案删除是需求；
    // 与 3.1.2 之前 Settings.vue 的 clearAllData 同口径，此处只是额外把快照写回。
    db.progress.clear(),
    // profile-scope-ok: 同上，整库重置按设计删除所有档案的错题。
    db.mistakes.clear(),
    db.settings.clear(),
  ])
  // 快照属于"这台设备的回滚点"，不是业务数据，必须留着
  if (snapshots.items.length > 0) {
    await db.settings.put({ key: SNAPSHOTS_KEY, value: snapshots })
  }
}

export interface RestoreResult {
  ok: boolean
  /** 合并统计（用于"补回了 N 条记录"的提示） */
  progressAdded?: number
  mistakesAdded?: number
  error?: string
}

/** 把一份备份合并回本机（两个恢复入口共用，避免两套口径） */
async function restoreBackup(backup: BackupV2): Promise<RestoreResult> {
  const preview = await previewImport(backup)

  // `noop` = 快照里的东西本机都有（且本机都更新）→ 成功的"无事可做"，不是失败
  if (preview.outcome === 'noop') return { ok: true, progressAdded: 0, mistakesAdded: 0 }
  if (preview.outcome !== 'ready' || !preview.plan) {
    const detail = preview.route.kind === 'reject' ? preview.route.detail : '快照无法合并'
    return { ok: false, error: detail }
  }

  const applied = await executeImport(preview.plan)
  return { ok: true, progressAdded: applied.progress, mistakesAdded: applied.mistakes }
}

/**
 * 按**唯一 id** 恢复（推荐入口）。同一天可能连拍多份 preClear，
 * 用 date 定位会命中错误的一份，所以 UI 一律传 id。
 * 走 previewImport → executeImport，自带陈旧守卫与跨档案守卫。
 */
export async function restoreSnapshotById(id: string): Promise<RestoreResult> {
  try {
    const items = await listSnapshots()
    const hit = items.find((it) => it.id === id)
    if (!hit) return { ok: false, error: '找不到这个恢复点' }
    return await restoreBackup(hit.backup)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[autoSnapshot] 恢复快照失败', err)
    return { ok: false, error: msg }
  }
}

/**
 * 恢复到指定日期的快照（**合并**语义，见文件头）。
 * 保留给老调用方/单测；同一天有多份时取最新的一份。
 * @deprecated UI 请改用 `restoreSnapshotById`
 */
export async function restoreSnapshot(date: string): Promise<RestoreResult> {
  try {
    const items = await listSnapshots()
    const hit = items.find((it) => it.date === date)
    if (!hit) return { ok: false, error: '没有这一天的快照' }
    return await restoreBackup(hit.backup)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[autoSnapshot] 恢复快照失败', err)
    return { ok: false, error: msg }
  }
}

/**
 * 「清空快照」按钮：**只清每日快照，保护快照一律保留**。
 *
 * 保护快照是误清空后唯一的救命稻草，绝不能被一个顺手的"清空快照"抹掉；
 * 要删它必须走单独入口（并且同样要有二次确认）。
 */
export async function clearSnapshots(): Promise<void> {
  try {
    const rec = await db.settings.get(SNAPSHOTS_KEY)
    const file = normalize(rec?.value)
    const kept = file.items.filter((it) => it.kind === 'preClear')
    await db.settings.put({ key: SNAPSHOTS_KEY, value: { version: 1, items: kept } })
  } catch (err) {
    console.warn('[autoSnapshot] 清空快照失败（忽略）', err)
  }
}

/** 删掉一份指定的保护快照（UI 二次确认后调用） */
export async function deleteSnapshot(id: string): Promise<void> {
  try {
    const rec = await db.settings.get(SNAPSHOTS_KEY)
    const file = normalize(rec?.value)
    await db.settings.put({
      key: SNAPSHOTS_KEY,
      value: { version: 1, items: file.items.filter((it) => it.id !== id) },
    })
  } catch (err) {
    console.warn('[autoSnapshot] 删除快照失败（忽略）', err)
  }
}
