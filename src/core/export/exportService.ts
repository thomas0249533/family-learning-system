/**
 * 导出 / 导入的**对外入口**（V1.4 · B2 重写；B6 清理旧入口）
 *
 * ## 重写的原因
 * V1.3 的这个文件是"扁平备份"的实现：`db.progress.toArray()` 整表读、整表写，
 * 没有档案概念，导入时用 `version: '1.0'` 的文件头。V1.4 之后三张表按档案分片，
 * 旧的读法会**跨档案串数据**（老二导入备份后能看到老大的错题本）。
 * 所以：
 *   - 导出走 `buildBackupV2()`（逐档案读，见 `core/backup/bundleIO.ts`）；
 *   - 导入走 `core/backup/importOrchestrator`（预览 + 单事务合并）。
 *
 * ## 旧入口已**物理删除**（2026-10-20）
 * `exportUserData` / `exportAll` / `importUserData` 三个兼容函数曾是 B2 的过渡垫片：
 * 那一批不动 UI，直接删签名会让 `Settings.vue` / `Mistakes.vue` 编译不过。
 * UI 改完后它们**零调用方**，于是删掉 —— 留着 `@deprecated` 的空壳比删掉更危险：
 *   - `importUserData` 内部还压着一条"`mode: 'replace'` 不再清库，只回一句说明"的
 *     语义陷阱，下一个人照签名调用就会以为覆盖生效了；
 *   - `exportUserData` 返回的 `settings` 计数在 v2 之后没有任何 UI 消费。
 * 判断依据：`grep -rn "exportUserData\|importUserData\|exportAll\b" src/` 零命中。
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
import type { BackupV2 } from '@core/backup/types'

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
 * 两个导出入口（`exportBackupV2` / `exportAchievementsJson`）共用 `downloadJson`
 * 与 `safeFileSegment`，避免出现两份文件名规则或两份"空备份不导出"的判据 ——
 * 那种分叉的症状是"一个按钮导出的文件名带档案名，另一个不带"。
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

/**
 * 只含**成就相关键**的 v2 备份（B5「导出成就记录」）。
 *
 * ## 为什么是"v2 的投影"而不是新格式
 * 新格式就得配一套新导入器，而导入器是这个项目里最容易出事的一层（跨档案、并集、
 * 单调不减、单事务）。投影之后：导出文件仍然是一份**合法的 `formatVersion: 2`**，
 * 导入走既有的 `routeBackup` → `planMerge` → `applyMergePlan`，一行新代码都不用。
 * AC-P2-9（同机导出再导入，记录完全一致）因此是**结构性成立**的，不靠额外测试去撞。
 *
 * ## 保留哪些键
 * - `achievements:<pid>`：解锁记录（含 `unlockedAt` / `evidence` / `repeatCount`）；
 * - `customChecks:<pid>`：家长手工勾选（自定义成就的**输入**）。
 *
 * ## 故意**不**保留
 * - `progress` / `mistakes` / `examSessions`：置空数组。合并是并集，空数组 = 不参与，
 *   所以这个文件绝不会动到接收方的学习进度（这一点比"少导了几个键"重要得多）；
 * - `globalSettings`：置空。自定义包的**包体**（`achievement:customPacks`）是设备级资产、
 *   永不参与合并，写进来只会让用户以为"导了文件就把包也搬过去了"。
 *   想在另一台设备上看到自定义卡，要另外导入包文件 —— 记录会等在那里，
 *   包一装上就显示出来（与 B1 对孤儿进度行的处理同向：保留不删）。
 */
export function buildAchievementsExport(backup: BackupV2): BackupV2 {
  const KEEP = ['achievements:', 'customChecks:']
  return {
    ...backup,
    profiles: backup.profiles.map((p) => ({
      ...p,
      progress: [],
      mistakes: [],
      examSessions: [],
      settings: p.settings.filter((s) => KEEP.some((prefix) => s.key.startsWith(prefix))),
    })),
    globalSettings: [],
  }
}

/**
 * 导出成就记录（JSON），返回文件里含几个档案、多少条解锁记录。
 *
 * 文件名带档案名，与家庭备份同一套规则（`safeFileSegment` + 时间戳）。
 */
export async function exportAchievementsJson(): Promise<{ profiles: number; records: number }> {
  const full = await buildBackupV2()
  const subset = buildAchievementsExport(full)

  const records = subset.profiles.reduce((n, p) => {
    const row = p.settings.find((s) => s.key.startsWith('achievements:'))
    return n + (Array.isArray(row?.value) ? (row.value as unknown[]).length : 0)
  }, 0)

  const name = safeFileSegment(currentProfile()?.name ?? '')
  downloadJson(subset, makeFilename(`fls-achievements-${name}`))
  return { profiles: subset.profiles.length, records }
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
