import { db } from '@/db'
import type {
  ProgressRecord,
  MistakeRecord,
  SettingRecord,
} from '@/db'

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
      for (const p of json.progress) {
        const { id, ...rest } = p
        // 用 packageId + knowledgePointId 去重
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
  } catch (e: any) {
    result.errors.push(e.message ?? String(e))
  }

  return result
}