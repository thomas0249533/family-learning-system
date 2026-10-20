// profile-scope-ok-file: v1 扁平备份格式，按定义跨档案（B2 重写为 v2 分档案）
import { db } from '@/db'
import type {
  ProgressRecord,
  MistakeRecord,
  SettingRecord,
} from '@/db'
import { canonicalKpId, resolveOwnerPackageId } from '@core/progress/ownerIndex'
import { ensureOwnerIndex, invalidateOwnerIndex } from '@core/progress/ownerIndexCache'
import { mergeProgressGroup } from '@core/progress/progressMerge'
import { ensureE1Migrated } from '@core/storage/migrateV3Recovery'

export interface ExportOptions {
  includePackages?: boolean
  includeProgress?: boolean
  includeMistakes?: boolean
  includeSettings?: boolean
}

/** 生成导出文件名 */
function makeFilename(prefix: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

/** 通用下载 */
function downloadJson(data: any, filename: string) {
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

/** 导出单包 */
export async function exportPackage(packageId: string): Promise<boolean> {
  const pkg = await db.packages.get(packageId)
  if (!pkg) return false
  downloadJson(pkg, `${packageId}.json`)
  return true
}

/** 导出全部包 */
export async function exportAllPackages(): Promise<number> {
  const packages = await db.packages.toArray()
  if (packages.length === 0) return 0
  downloadJson({ packages }, makeFilename('packages'))
  return packages.length
}

/** 导出用户数据（进度 + 错题 + 设置） */
export async function exportUserData(opts: ExportOptions = {}): Promise<{
  progress: number
  mistakes: number
  settings: number
}> {
  const result = { progress: 0, mistakes: 0, settings: 0 }

  const payload: any = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
  }

  if (opts.includeProgress) {
    payload.progress = await db.progress.toArray()
    result.progress = payload.progress.length
  }
  if (opts.includeMistakes) {
    payload.mistakes = await db.mistakes.toArray()
    result.mistakes = payload.mistakes.length
  }
  if (opts.includeSettings) {
    payload.settings = await db.settings.toArray()
    result.settings = payload.settings.length
  }

  downloadJson(payload, makeFilename('userdata'))
  return result
}

/** 导出错题本（独立功能） */
export async function exportMistakes(): Promise<number> {
  const mistakes = await db.mistakes.toArray()
  if (mistakes.length === 0) return 0
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

/** 全量导出（包 + 用户数据） */
export async function exportAll(): Promise<void> {
  const [packages, progress, mistakes, settings] = await Promise.all([
    db.packages.toArray(),
    db.progress.toArray(),
    db.mistakes.toArray(),
    db.settings.toArray(),
  ])
  downloadJson(
    {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      packages,
      progress,
      mistakes,
      settings,
    },
    makeFilename('full-backup')
  )
}

/** 导入用户数据（进度 + 错题 + 设置） */
export async function importUserData(json: any, mode: 'merge' | 'replace' = 'merge'): Promise<{
  progress: number
  mistakes: number
  settings: number
  errors: string[]
}> {
  const result = { progress: 0, mistakes: 0, settings: 0, errors: [] as string[] }

  if (!json || typeof json !== 'object') {
    result.errors.push('数据格式无效')
    return result
  }

  try {
    if (Array.isArray(json.progress)) {
      if (mode === 'replace') await db.progress.clear()

      // 备份是"过去某个时刻"的快照，包可能在之后被导入/删除过 → 先让索引失效再重建，
      // 否则会拿旧包数组判断归属（D1 的老毛病：拿错包等于把记录写到别的知识点上）
      invalidateOwnerIndex()
      const index = await ensureOwnerIndex()
      // 老备份里同一个真实知识点可能有 2~3 行（写进了不同的入口包）。
      // 逐行 upsert 会让后一行**覆盖**前一行的计数 → 先把备份内部合并干净，再写库。
      const merged = new Map<string, ProgressRecord>()
      for (const row of json.progress as ProgressRecord[]) {
        if (!row || typeof row !== 'object') continue
        const { id: rawId, ...rest } = row
        const owner = resolveOwnerPackageId(rest.knowledgePointId, rest.packageId, index)
        const packageId = owner ?? rest.packageId
        const knowledgePointId = owner
          ? canonicalKpId(owner, rest.knowledgePointId, index)
          : rest.knowledgePointId
        const key = `${packageId}\u0000${knowledgePointId}`
        // id 只用于组内定序（承载体 / latest），写库时不带 id
        const candidate = {
          ...rest,
          id: typeof rawId === 'number' && Number.isFinite(rawId) ? rawId : 0,
          packageId,
          knowledgePointId,
        } as ProgressRecord
        const prev = merged.get(key)
        merged.set(
          key,
          prev ? mergeProgressGroup([prev, candidate], { packageId, knowledgePointId }) : candidate
        )
      }

      for (const row of merged.values()) {
        const { id: _ignored, ...rest } = row
        // 用 packageId + knowledgePointId 去重（保持"备份覆盖库"的既有语义，不求和）
        const existing = await db.progress
          .where('[packageId+knowledgePointId]')
          .equals([rest.packageId, rest.knowledgePointId])
          .first()
        if (existing) {
          await db.progress.update(existing.id!, rest)
        } else {
          await db.progress.add(rest as ProgressRecord)
        }
        result.progress++
      }
    }

    if (Array.isArray(json.mistakes)) {
      if (mode === 'replace') await db.mistakes.clear()
      for (const m of json.mistakes) {
        const { id, ...rest } = m
        const existing = await db.mistakes
          .where('exerciseId').equals(rest.exerciseId).first()
        if (existing) {
          await db.mistakes.update(existing.id!, rest)
        } else {
          await db.mistakes.add(rest as MistakeRecord)
        }
        result.mistakes++
      }
    }

    if (Array.isArray(json.settings)) {
      for (const s of json.settings) {
        await db.settings.put(s as SettingRecord)
        result.settings++
      }
    }

    // 备份里的包可能晚于进度行被导入 → 恢复完再按**当前**包列表归因一次，
    // 把"写入时无法归属"的行尽量救回来。失败只告警（数据已经进来了）。
    if (result.progress > 0) {
      try {
        await ensureE1Migrated({ orphanOnly: true })
      } catch (e) {
        console.warn('[export] 恢复后重归因失败（数据已导入，仅归因未收敛）', e)
      }
    }
  } catch (e: any) {
    result.errors.push(e.message ?? String(e))
  }

  return result
}