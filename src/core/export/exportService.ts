/**
 * 导出 / 导入的**对外入口**（V1.4 · B2 重写）
 *
 * ## 重写的原因
 * V1.3 的这个文件是"扁平备份"的实现：`db.progress.toArray()` 整表读、整表写，
 * 没有档案概念，导入时用 `version: '1.0'` 的文件头。V1.4 之后三张表按档案分片，
 * 旧的读法会**跨档案串数据**（老二导入备份后能看到老大的错题本）。
 * 所以：
 *   - 导出走 `buildBackupV2()`（逐档案读，见 `core/backup/bundleIO.ts`）；
 *   - 导入走 `core/backup/importOrchestrator`（预览 + 单事务合并）。
 *
 * ## 为什么旧函数名还留着
 * UI（`views/Settings.vue`、`views/Mistakes.vue`）还在调 `exportUserData` /
 * `exportAll` / `importUserData`。B2 这一批不改 UI，若直接删函数，UI 一次性改不完
 * 就会编译不过。所以旧入口全部保留签名、内部委托新引擎，并标 `@deprecated`。
 * **B2 完成后 UI 只应调用 `exportBackupV2()`**。
 *
 * ## profile-scope 门禁
 * 这个文件曾经有一行 `// profile-scope-ok-file:` 整文件豁免（旧格式按定义跨档案）。
 * 重写后已经没有"必须跨档案"的读：每个读点都带 `where('profileId')`。
 * 整文件豁免被删除 —— 豁免留在文件头，等于把这把门禁在这个文件上永久关掉。
 */

import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'
import { currentProfile, currentProfileId } from '@core/profile/currentProfile'
import { buildBackupV2 } from '@core/backup/bundleIO'
import { executeImport, previewImport } from '@core/backup/importOrchestrator'

/** 旧导出选项（`@deprecated`：v2 备份总是全量，不再支持挑选字段） */
export interface ExportOptions {
  includePackages?: boolean
  includeProgress?: boolean
  includeMistakes?: boolean
  includeSettings?: boolean
}

/** 时间戳片段：`yyyyMMdd-HHmm`（文件名用，本地时区） */
function stamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 生成导出文件名 */
function makeFilename(prefix: string): string {
  return `${prefix}-${stamp()}.json`
}

/**
 * 把档案名变成"可以放进文件名"的样子。
 *
 * 为什么不直接用档案名：档案名是用户输入的自由文本，可能含 `/`、`\`、`:`、`?` 等
 * 非法字符（在 Windows 上会直接保存失败），也可能是很长的中文句子。
 * 文件名是**用户可见信息**，所以要保留可读性，只做非法字符替换，不做哈希。
 */
export function safeFileSegment(raw: string, fallback: string = 'family'): string {
  const cleaned = (raw ?? '')
    // 半角/全角路径分隔符与 Windows 保留字符，统一替换成一个 `-`
    .replace(/[\\/:*?"<>|\uFF0F\uFF1A\uFF0A\uFF1F\uFF1C\uFF1E\uFF5C]+/g, '-')
    .replace(/\s+/g, '-')
    // 连续 `-` 折叠：`我的 档案 / 1` → `我的-档案-1`
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return cleaned || fallback
}

/** 通用下载（Web）。Tauri 下的落盘差异由 UI 层决定，不在服务层分叉。 */
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 统计一份备份里的行数（返回值同时给 UI 做提示与测试断言） */
function countBackup(backup: {
  profiles: Array<{ progress: unknown[]; mistakes: unknown[]; settings: unknown[] }>
}): { profiles: number; progress: number; mistakes: number; settings: number } {
  let progress = 0
  let mistakes = 0
  let settings = 0
  for (const p of backup.profiles) {
    progress += p.progress.length
    mistakes += p.mistakes.length
    settings += p.settings.length
  }
  return { profiles: backup.profiles.length, progress, mistakes, settings }
}

/**
 * 构建 + 下载一份 v2 备份，返回"这份文件里有什么"。
 *
 * 两个导出入口（`exportBackupV2` / 兼容用的 `exportUserData`）共用这一段，
 * 避免出现两份文件名规则或两份"空备份不导出"的判据 —— 那种分叉的症状是
 * "一个按钮导出的文件名带档案名，另一个不带"。
 *
 * 文件名形如 `fls-backup-老大-20251020-1149.json`。
 * 注意：文件名里放的是**档案名**（昵称），不是真实姓名；非法字符统一换成 `-`
 * （见 `safeFileSegment`）。
 */
async function downloadBackupV2(): Promise<{
  profiles: number
  progress: number
  mistakes: number
  settings: number
}> {
  const backup = await buildBackupV2()
  const counts = countBackup(backup)

  // 空备份不导出：正常不会出现（至少 1 个档案），但真出现了，导出一个空文件
  // 会让用户误以为"备份成功了"。
  if (counts.profiles === 0) return counts

  const name = safeFileSegment(currentProfile()?.name ?? '')
  downloadJson(backup, makeFilename(`fls-backup-${name}`))
  return counts
}

/**
 * 构建并下载一份 v2 备份（**UI 唯一应该调用的导出入口**）。
 *
 * @returns 备份里含几个档案、多少条进度、多少条错题（UI 据此给"已导出 N 条"的提示）
 */
export async function exportBackupV2(): Promise<{
  profiles: number
  progress: number
  mistakes: number
}> {
  const counts = await downloadBackupV2()
  return { profiles: counts.profiles, progress: counts.progress, mistakes: counts.mistakes }
}

/** 导出单包（packages 表**不分片**，与档案无关，逻辑不变） */
export async function exportPackage(packageId: string): Promise<boolean> {
  const pkg: LearningPackageRecord | undefined = await db.packages.get(packageId)
  if (!pkg) return false
  downloadJson(pkg, `${packageId}.json`)
  return true
}

/** 导出全部包（同上，不分片） */
export async function exportAllPackages(): Promise<number> {
  const packages = await db.packages.toArray()
  if (packages.length === 0) return 0
  downloadJson({ packages }, makeFilename('packages'))
  return packages.length
}

/**
 * 导出错题本（独立功能，只导**当前档案**）。
 *
 * V1.3 是 `db.mistakes.toArray()` —— v4 之后那会把两个孩子的错题一起导出来，
 * 而且收件人（老师/家长）看不出混了人。这里改成 `where('profileId')`。
 */
export async function exportMistakes(): Promise<number> {
  const pid = currentProfileId()
  const mistakes = await db.mistakes.where('profileId').equals(pid).toArray()
  if (mistakes.length === 0) return 0
  // 刻意写成 **v1 形状**（`version: '1.0'`、无 `formatVersion`）：
  // 这份文件只有错题、没有档案结构，若写成 v2 会被 `routeBackup` 判成
  // "缺少 appVersion / profiles" 的损坏备份 —— 用户想把它再导回来就更困惑了。
  // v1 形状 → 适配器会把它包成 `default` 档案的错题（行内 pid 原样保留）。
  downloadJson(
    {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      mistakes,
    },
    makeFilename('mistakes')
  )
  return mistakes.length
}

/**
 * @deprecated v2 备份总是全量（含全部档案），不再支持 `includeXxx` 选择。
 * 保留签名只为让 UI 一次性改不完时仍能编译。新代码用 `exportBackupV2()`。
 */
export async function exportUserData(_opts: ExportOptions = {}): Promise<{
  progress: number
  mistakes: number
  settings: number
}> {
  const counts = await downloadBackupV2()
  return { progress: counts.progress, mistakes: counts.mistakes, settings: counts.settings }
}

/**
 * @deprecated 同上，委托 `exportBackupV2()`。v2 备份**不含 packages**
 * （包是设备级资产，PRD §P0-3b）——"完整备份"这个名字在 v2 之后名不副实，
 * 所以这里只导出数据，包要用 `exportAllPackages()` 单独搬。
 */
export async function exportAll(): Promise<void> {
  await exportBackupV2()
}

/**
 * 导入备份（旧入口）。
 *
 * @deprecated 新代码用 `previewImport()` + `executeImport()` 两阶段（UI 要先给用户
 * 看"会发生什么"）。这个函数为了兼容旧调用点，一步做完并返回扁平统计。
 *
 * `mode` 的语义变化：v2 只做**合并**。传 `'replace'` 不再清库，
 * 而是在 `errors` 里返回一条明确说明 —— 静默按合并处理，用户会以为"覆盖成功了"。
 */
export async function importUserData(
  json: unknown,
  mode: 'merge' | 'replace' = 'merge'
): Promise<{
  progress: number
  mistakes: number
  settings: number
  errors: string[]
}> {
  const errors: string[] = []
  if (mode === 'replace') {
    errors.push('v2 起不支持覆盖导入，已按合并处理')
  }

  if (!json || typeof json !== 'object') {
    errors.push('数据格式无效')
    return { progress: 0, mistakes: 0, settings: 0, errors }
  }

  try {
    const preview = await previewImport(json)

    // 结论统一读 `outcome`（判序收死在编排层）。这里若自己再排一次 reject/noop，
    // 就成了第二套口径 —— 而 UI 读的是 `outcome`，两边分叉的症状是"提示说可以导入，
    // 点下去却什么都没发生"。
    if (preview.outcome === 'reject') {
      const detail =
        preview.route.kind === 'reject'
          ? preview.route.detail
          : (preview.plan?.reject?.detail ?? '这份备份不能导入')
      errors.push(detail)
      return { progress: 0, mistakes: 0, settings: 0, errors }
    }
    // 新增为 0 **不是错误**（AC-P2-13 的正常结果：本机已有全部数据）。
    // 不能塞进 `errors` —— 旧 UI 把 errors 非空当成"导入失败"，那会骗用户。
    if (preview.outcome === 'noop' || !preview.plan) {
      return { progress: 0, mistakes: 0, settings: 0, errors }
    }

    const applied = await executeImport(preview.plan)
    return {
      progress: applied.progress,
      mistakes: applied.mistakes,
      settings: applied.settings,
      errors,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errors.push(message)
    return { progress: 0, mistakes: 0, settings: 0, errors }
  }
}
