/**
 * 每日自动快照（V3.0 · M4）—— 数据可信的第一道保险
 * ---------------------------------------------------------------------
 * ## 它解决什么
 * 现有备份是**手动**的：设置页点"导出"，选个文件夹，存下来。
 * 真实家庭里这件事基本不会发生 —— 于是"孩子三个月的学习记录"只存在于
 * IndexedDB 这一份里。一次误操作、一次升级出问题、一次浏览器清缓存，
 * 全没了，且**没有任何恢复入口**。
 *
 * 自动快照把这一步变成每天一次的静默动作：首次启动时如果今天还没拍过，
 * 就用现成的 `buildBackupV2()` 拍一份，保留最近 7 份。
 *
 * ## 为什么直接复用 `buildBackupV2`
 * 它是全库唯一的"完整数据"口径（有 200 组属性测试 + 往返测试盯着）。
 * 为快照另写一套转储逻辑，等于制造第二个"什么算完整数据"的答案 ——
 * 两份迟早会分叉，而分叉的表现是"恢复后少了点东西"。
 *
 * ## 为什么快照**不进备份文件**
 * 快照的内容就是一份备份。若它跟着备份一起导出，备份文件里会有 7 份备份，
 * 每份又包含快照 —— 体积指数膨胀。所以：
 *   - `EXPORT_EXCLUDED_GLOBAL_KEYS` 排除它；
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

/** 保留份数 */
export const KEEP_SNAPSHOTS = 7

export interface SnapshotEntry {
  /** 本地日 YYYY-MM-DD（同一天只留一份） */
  date: string
  /** 拍摄时刻（ISO） */
  createdAt: string
  /** 仅排障用 */
  appVersion: string
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
  const items = f.items.filter(
    (it): it is SnapshotEntry =>
      !!it && typeof it.date === 'string' && typeof it.createdAt === 'string' && !!it.backup
  )
  // 新→旧（listSnapshots 与 prune 都依赖这个顺序）
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { version: 1, items }
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
      date: today,
      createdAt: now.toISOString(),
      appVersion: APP_VERSION,
      backup,
    }
    const items = [entry, ...file.items].slice(0, KEEP_SNAPSHOTS)
    await db.settings.put({ key: SNAPSHOTS_KEY, value: { version: 1, items } })
    return { created: true, count: items.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[autoSnapshot] 自动快照失败（忽略）', err)
    return { created: false, count: 0, error: msg }
  }
}

export interface RestoreResult {
  ok: boolean
  /** 合并统计（用于"补回了 N 条记录"的提示） */
  progressAdded?: number
  mistakesAdded?: number
  error?: string
}

/**
 * 恢复到指定日期的快照（**合并**语义，见文件头）。
 *
 * 走的是与"从文件导入"完全相同的两步（预览 → 执行），因此也自带：
 *   - 陈旧快照守卫（预览后本机又有新记录 → 中止并提示重新预览）；
 *   - 跨档案守卫（快照里混了别的档案的行 → 拒收）。
 */
export async function restoreSnapshot(date: string): Promise<RestoreResult> {
  try {
    const items = await listSnapshots()
    const hit = items.find((it) => it.date === date)
    if (!hit) return { ok: false, error: '没有这一天的快照' }

    const preview = await previewImport(hit.backup)

    // `noop` = 快照里的东西本机都有（且本机都更新）→ 成功的"无事可做"，不是失败
    if (preview.outcome === 'noop') return { ok: true, progressAdded: 0, mistakesAdded: 0 }
    if (preview.outcome !== 'ready' || !preview.plan) {
      const detail = preview.route.kind === 'reject' ? preview.route.detail : '快照无法合并'
      return { ok: false, error: detail }
    }

    const applied = await executeImport(preview.plan)
    return {
      ok: true,
      progressAdded: applied.progress,
      mistakesAdded: applied.mistakes,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[autoSnapshot] 恢复快照失败', err)
    return { ok: false, error: msg }
  }
}

/** 删掉全部快照（家长主动清理；设置页的"清空快照"按钮用） */
export async function clearSnapshots(): Promise<void> {
  try {
    await db.settings.put({ key: SNAPSHOTS_KEY, value: { version: 1, items: [] } })
  } catch (err) {
    console.warn('[autoSnapshot] 清空快照失败（忽略）', err)
  }
}
