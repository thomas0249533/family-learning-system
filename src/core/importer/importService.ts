import { db } from '@/db'
import { unzipSync } from 'fflate'
import { normalizePackage, type NormalizeIssue } from './normalizePackage'
import { countImageExercises } from './imageRefs'
import { invalidateOwnerIndex } from '@core/progress/ownerIndexCache'
import { ensureE1Migrated } from '@core/storage/migrateV3Recovery'
import {
  ASSET_REJECT_TEXT,
  parseAssetPath,
  planPackageAssets,
  type IncomingAsset,
} from '@core/package-manager/packageAssetStore'
// 重新导出：包解析逻辑本体在零依赖的 assetPath 里（node 单测可直接跑）
export { parseAssetPath }

export type ImportIssue = NormalizeIssue

export interface ParsePreview {
  rawPackage: any
  manifest: {
    subject?: string
    grade?: number
    term?: string
    templateId?: string
    edition?: string
    title?: string
    packageId?: string
  }
}

export interface ImportConfirmPayload {
  subject: string
  grade: number
  term: string
}

export interface ImportResult {
  success: boolean
  errors?: ImportIssue[]
  warnings?: ImportIssue[]
  packageId?: string
}

export interface ImportSetResult {
  success: boolean
  /** 新增/更新的包数量 */
  imported?: number
  /** 全部包的 packageId */
  packageIds?: string[]
  /** 出错时指示哪个包失败 */
  failedPackageId?: string
  /** 本次写入的图片资产张数 */
  assetsImported?: number
  errors?: ImportIssue[]
  warnings?: ImportIssue[]
}

/** 判定是否为 ZIP 文件 */
export function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.zip') || name.endsWith('.lpkgset')
}

/** 解压 ZIP 包集合（含图片资产） */
async function unzipPackageSet(file: File): Promise<{
  manifest: any
  packages: any[]
  assets: Map<string, IncomingAsset[]>
}> {
  const buffer = await file.arrayBuffer()
  const files = unzipSync(new Uint8Array(buffer))

  const decoder = new TextDecoder('utf-8')

  // 1. 读取 manifest.json
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('ZIP 缺少 manifest.json')
  const manifest = JSON.parse(decoder.decode(manifestBytes))

  // 2. 读取 packages/ 下所有 .json
  const packages: any[] = []
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('packages/')) continue
    if (path.includes('/assets/')) continue // 图片不走这条
    if (!path.endsWith('.json')) continue
    try {
      const pkg = JSON.parse(decoder.decode(bytes))
      packages.push(pkg)
    } catch (e: any) {
      throw new Error(`解析 ${path} 失败：${e.message}`)
    }
  }

  if (packages.length === 0) throw new Error('ZIP 内没有 packages/*.json')

  // 3. 收集图片资产
  const assets = new Map<string, IncomingAsset[]>()
  const rootAssets: IncomingAsset[] = []
  for (const [path, bytes] of Object.entries(files)) {
    // 目录条目在 fflate 里也会出现，长度为 0 的直接跳过
    if (!bytes || bytes.byteLength === 0) continue
    const parsed = parseAssetPath(path)
    if (!parsed) continue
    if (parsed.packageId === '') {
      rootAssets.push({ path: parsed.path, bytes })
      continue
    }
    const list = assets.get(parsed.packageId) ?? []
    list.push({ path: parsed.path, bytes })
    assets.set(parsed.packageId, list)
  }

  // 根级 assets/ 只在一个包时归属明确；多包时无法判断，宁可报错也不猜
  if (rootAssets.length > 0) {
    if (packages.length === 1) {
      const only = packages[0]?.manifest?.packageId
      if (only) assets.set(only, [...(assets.get(only) ?? []), ...rootAssets])
    } else {
      throw new Error(
        `ZIP 根目录有 assets/ 但包含 ${packages.length} 个包，无法确定图片归属；` +
          `请改为 packages/<packageId>/assets/ 结构`,
      )
    }
  }

  return { manifest, packages, assets }
}

/** 按 manifest.importOrder 排序；未列出的排在最后 */
function sortByImportOrder(packages: any[], importOrder: string[]): any[] {
  if (!Array.isArray(importOrder) || importOrder.length === 0) return packages
  const orderMap = new Map<string, number>()
  importOrder.forEach((id, i) => orderMap.set(id, i))
  return [...packages].sort((a, b) => {
    const ai = orderMap.get(a.manifest?.packageId) ?? 9999
    const bi = orderMap.get(b.manifest?.packageId) ?? 9999
    return ai - bi
  })
}

/**
 * 包集合变化后的收尾（V1.3 · E-01）。
 *
 * 两件事，顺序不能反：
 *   1. `invalidateOwnerIndex()` —— 归属索引缓存里还是导入前的包数组，先失效；
 *   2. `ensureE1Migrated({ orphanOnly: true })` —— 导入前"无主"的历史进度行
 *      （`|own| === 0` 时保留的是入口包 id）现在可能有了归属包，趁这次机会改写。
 *
 * **必须 await**：调用方紧接着就会读进度列表，而且重归因与 `recordProgress`
 * 的写入必须串行，否则同一条进度会被写两行。
 * 失败只告警 —— 导入本身已经成功，重归因是加分项。
 */
async function afterPackagesChanged(): Promise<void> {
  invalidateOwnerIndex()
  try {
    await ensureE1Migrated({ orphanOnly: true })
  } catch (e) {
    console.warn('[import] 进度重归因失败（不影响导入结果）', e)
  }
  // V3.0 · M1：今日队列是**当天冻结**的，包集合变了必须让它失效，
  // 否则早上导入了新包、今日页仍说"今天没有排任务"。
  // 动态 import 是为了让 plan 层可独立删除而不牵连导入链（也没有静态循环依赖）。
  try {
    const { invalidateDailyPlan } = await import('@core/plan/dailyPlanService')
    await invalidateDailyPlan()
  } catch (e) {
    console.warn('[import] 今日队列失效失败（不影响导入结果）', e)
  }
}

export const PackageImporter = {
  async parseFileAndPreview(file: File): Promise<ParsePreview> {
    const text = await file.text()
    let raw: any
    try {
      raw = JSON.parse(text)
    } catch (e: any) {
      throw new Error(`JSON 语法错误：${e.message}`)
    }
    if (!raw || typeof raw !== 'object') throw new Error('文件不是有效的 JSON 对象')
    if (!raw.manifest || typeof raw.manifest !== 'object') throw new Error('缺少 manifest 字段')

    return {
      rawPackage: raw,
      manifest: {
        subject: raw.manifest.subject,
        grade: raw.manifest.grade,
        term: raw.manifest.term,
        templateId: raw.manifest.templateId,
        edition: raw.manifest.edition,
        title: raw.manifest.title,
        packageId: raw.manifest.packageId,
      },
    }
  },

  async confirmAndImport(
    rawPackage: any,
    confirm: ImportConfirmPayload
  ): Promise<ImportResult> {
    const merged = JSON.parse(JSON.stringify(rawPackage))
    if (!merged.manifest) merged.manifest = {}
    if (confirm.subject) merged.manifest.subject = confirm.subject
    if (confirm.grade) merged.manifest.grade = confirm.grade
    if (confirm.term) merged.manifest.term = confirm.term

    if (!merged.manifest.packageId) {
      return {
        success: false,
        errors: [{ level: 'error', code: 'E003', path: 'manifest.packageId', message: '缺少 manifest.packageId', hint: 'packageId 是学习包唯一标识' }],
      }
    }

    const { package: normalized, errors, warnings } = normalizePackage(merged)

    if (errors.length > 0) return { success: false, errors, warnings }
    if (!normalized) {
      return { success: false, errors: [{ level: 'error', code: 'E999', path: '$', message: '规范化失败' }] }
    }

    // 单包 JSON 结构上不带图片：含图的包必须走 .lpkgset.zip。
    // 不提示的话，导入会"成功"、题目正常出现、每道带图的题下面一块「配图缺失」，
    // 而用户完全无法从导入结果里看出问题出在文件形式上（V2.12.3 补的提示）。
    const imgCount = countImageExercises(normalized)
    if (imgCount > 0) {
      warnings.push({
        level: 'warning',
        code: 'W037',
        path: 'exercises',
        message: `本包有 ${imgCount} 道题带配图，但单个 JSON 文件不携带图片文件，这些题会显示「配图缺失」`,
        hint: '请改用 .lpkgset.zip 集合包导入 —— 图片在 ZIP 内的 packages/<包id>/assets/ 下',
      })
    }

    // 依赖检查
    const allPackages = await db.packages.toArray()
    const localIds = new Set(allPackages.map(p => p.packageId))
    const missing: string[] = []
    for (const depId of normalized.manifest.dependencies ?? []) {
      if (!localIds.has(depId) && depId !== normalized.packageId) {
        missing.push(depId)
      }
    }
    if (missing.length > 0) {
      warnings.push({
        level: 'warning',
        code: 'W021',
        path: 'manifest.dependencies',
        message: `以下依赖包未在本地找到: ${missing.join(', ')}`,
        hint: '包已导入，但相关功能可能不可用',
      })
    }

    try {
      await db.packages.put(normalized)
    } catch (e: any) {
      return {
        success: false,
        errors: [{ level: 'error', code: 'E011', path: 'IndexedDB', message: `写入失败：${e.message}` }],
      }
    }

    // 包集合变了 → 索引失效 + 老进度行重归因（见 afterPackagesChanged 注释）
    await afterPackagesChanged()

    return { success: true, warnings, packageId: normalized.manifest.packageId }
  },

  /**
   * 批量导入 ZIP 包集合
   */
  async importPackageSet(file: File): Promise<ImportSetResult> {
    // 1. 解压
    let manifest: any
    let rawPackages: any[]
    let assetsByPackage: Map<string, IncomingAsset[]>
    try {
      const r = await unzipPackageSet(file)
      manifest = r.manifest
      rawPackages = r.packages
      assetsByPackage = r.assets
    } catch (e: any) {
      return {
        success: false,
        errors: [{ level: 'error', code: 'E030', path: 'zip', message: `解压失败：${e.message}`, hint: '确认 ZIP 内含 manifest.json 和 packages/*.json' }],
      }
    }

    // 2. 排序
    const ordered = sortByImportOrder(rawPackages, manifest.importOrder ?? [])

    // 3. 预扫描：构建全局 ID 池
    const externalKpIds = new Set<string>()
    const externalPackageIds = new Set<string>()
    for (const raw of ordered) {
      if (raw?.manifest?.packageId) externalPackageIds.add(raw.manifest.packageId)
      for (const kp of raw?.knowledgePoints ?? []) {
        if (kp?.id) externalKpIds.add(kp.id)
      }
    }

    // 4. 逐个规范化（全部通过才入库）
    const normalizedList: any[] = []
    const allWarnings: ImportIssue[] = []

    for (const raw of ordered) {
      const merged = JSON.parse(JSON.stringify(raw))
      if (!merged.manifest) merged.manifest = {}
      // 从 manifest.json 补全缺失字段
      if (!merged.manifest.subject && manifest.subject) merged.manifest.subject = manifest.subject
      if (!merged.manifest.grade && manifest.grade) merged.manifest.grade = manifest.grade
      if (!merged.manifest.term && manifest.term) merged.manifest.term = manifest.term
      if (!merged.manifest.edition && manifest.edition) merged.manifest.edition = manifest.edition

      // 本包可用的图片资产清单 → 用于校验题目引用的图是否真的在 zip 里。
      // 没有资产的包传空 Set 也是安全的：只有题目**确实引用**图片时才会去查。
      const pkgId = merged.manifest.packageId
      const ownAssets = assetsByPackage.get(pkgId) ?? []
      const assetPaths = new Set(ownAssets.map((a) => a.path))

      const { package: normalized, errors, warnings } = normalizePackage(merged, {
        externalKpIds,
        externalPackageIds,
        assetPaths,
      })

      if (errors.length > 0) {
        return {
          success: false,
          failedPackageId: raw?.manifest?.packageId ?? '(unknown)',
          errors,
          warnings: [...allWarnings, ...warnings],
        }
      }
      if (!normalized) {
        return {
          success: false,
          failedPackageId: raw?.manifest?.packageId,
          errors: [{ level: 'error', code: 'E999', path: '$', message: '规范化失败' }],
        }
      }
      normalizedList.push(normalized)
      allWarnings.push(...warnings)
    }

    // 5. 事务批量写入（学习包 + 图片资产）
    //
    // 资产写在**同一个事务**里：包入库成功但图片落空，会得到一堆"题干正常、图不见了"
    // 的题 —— 这种半成功状态比整批回滚更难排查。
    let assetsImported = 0
    const assetRejects: ImportIssue[] = []
    try {
      await db.transaction('rw', db.packages, db.packageAssets, async () => {
        for (const pkg of normalizedList) {
          await db.packages.put(pkg)

          const packageId: string = pkg.packageId
          const incoming = assetsByPackage.get(packageId) ?? []
          // 先清空该包旧资产：重导入时以 zip 为准。即使这次没带图也要清 ——
          // 否则题目已改指向新路径，旧图会变成永远没人引用、也永远删不掉的孤儿。
          await db.packageAssets.where('packageId').equals(packageId).delete()
          if (incoming.length === 0) continue

          const plan = planPackageAssets(packageId, incoming)
          for (const row of plan.rows) {
            await db.packageAssets.put(row)
          }
          assetsImported += plan.rows.length
          for (const r of plan.rejected) {
            assetRejects.push({
              level: 'warning',
              code: 'W035',
              path: r.path,
              message: `图片未能导入：${r.path}（${ASSET_REJECT_TEXT[r.reason]}）`,
              hint: '该题仍会正常出现在练习里，只是不显示配图',
            })
          }
        }
      })
    } catch (e: any) {
      return {
        success: false,
        errors: [{ level: 'error', code: 'E011', path: 'IndexedDB', message: `批量写入失败：${e.message}`, hint: '数据已回滚，请重试' }],
      }
    }

    // 一次导入十几个包（含链式依赖）→ 更要重归因：之前无主的历史行可能整批变得可归因
    await afterPackagesChanged()

    return {
      success: true,
      imported: normalizedList.length,
      packageIds: normalizedList.map(p => p.manifest.packageId),
      assetsImported,
      warnings: [...allWarnings, ...assetRejects],
    }
  },
}