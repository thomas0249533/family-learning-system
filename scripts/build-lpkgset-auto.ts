/**
 * 学习包集合自动打包（扫描目录版）
 *
 * 约定：
 *   content/xxx/ 下所有 .json 文件自动识别类型：
 *     unit-*    → type: unit,    visible: false
 *     term-*    → type: term,    visible: true
 *     special-* → type: special, visible: true, examMode: true
 *     sprint-*  → type: sprint,  visible: true, examMode: true
 *     base-*    → type: base,    visible: true
 *
 *   packageId = 文件名去 .json
 *
 * _set.json 只需保留集合级字段 + overrides（专项/冲刺的 sourceUnitIds）
 *
 * 用法：
 *   npm run build:set -- content/math-4-up-rjb
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { buildLpkgsetZip } from './lib/packSet'

interface SetConfig {
  setId: string
  title: string
  subject: string
  grade: number
  term: string
  edition: string
  /** 可选：手动覆盖某个包的属性（专项/冲刺必须提供 sourceUnitIds）*/
  overrides?: Record<string, {
    type?: string
    visible?: boolean
    examMode?: boolean
    sourceUnitIds?: string[]
    dependencies?: string[]
    importOrder?: number
  }>
}

type PackageType = 'unit' | 'term' | 'special' | 'sprint' | 'base'

interface BuiltPackage {
  fileName: string
  packageId: string
  type: PackageType
  visible: boolean
  examMode: boolean
  sourceUnitIds?: string[]
  dependencies: string[]
  sortKey: number
  raw: any
}

function parseArgs(): { inputDir: string; outputZip?: string } {
  const args = process.argv.slice(2)
  const inputDir = args[0]
  let outputZip: string | undefined
  const oIdx = args.indexOf('-o')
  if (oIdx >= 0) outputZip = args[oIdx + 1]
  if (!inputDir) {
    console.error('用法: npm run build:set -- <inputDir> [-o output.zip]')
    process.exit(1)
  }
  return { inputDir, outputZip }
}

function loadSetConfig(dir: string): SetConfig {
  const cfgPath = join(dir, '_set.json')
  if (!existsSync(cfgPath)) throw new Error(`缺少 _set.json：${cfgPath}`)
  return JSON.parse(readFileSync(cfgPath, 'utf-8'))
}

/** 从文件名推断类型 */
function inferType(fileName: string): PackageType | null {
  const base = fileName.replace(/\.json$/i, '').toLowerCase()
  if (base.startsWith('unit-')) return 'unit'
  if (base.startsWith('term-')) return 'term'
  if (base.startsWith('special-')) return 'special'
  if (base.startsWith('sprint-')) return 'sprint'
  if (base.startsWith('base-')) return 'base'
  return null
}

/** 从文件名推断排序（unit-pN 中的 N） */
function inferSortKey(fileName: string, type: PackageType): number {
  if (type === 'unit') {
    const m = fileName.match(/-p(\d+)\.json$/i)
    if (m) return parseInt(m[1], 10)
    return 999
  }
  if (type === 'term') return 10000
  if (type === 'special') return 20000
  if (type === 'sprint') return 30000
  return 50000
}

/** 扫描目录 */
function scanDirectory(dir: string, config: SetConfig): BuiltPackage[] {
  const entries = readdirSync(dir)
  const result: BuiltPackage[] = []
  const unitIds: string[] = []

  // 第一遍：收集所有 unit 的 packageId（供 term 依赖推断）
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    if (entry === '_set.json') continue
    const type = inferType(entry)
    if (type === 'unit') {
      unitIds.push(entry.replace(/\.json$/i, ''))
    }
  }
  // 按数字排序
  unitIds.sort((a, b) => {
    const ma = a.match(/-p(\d+)$/i)
    const mb = b.match(/-p(\d+)$/i)
    const na = ma ? parseInt(ma[1], 10) : 999
    const nb = mb ? parseInt(mb[1], 10) : 999
    return na - nb
  })

  // 第二遍：构建包列表
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    if (entry === '_set.json') continue

    const fullPath = join(dir, entry)
    if (!statSync(fullPath).isFile()) continue

    const type = inferType(entry)
    if (!type) {
      console.warn(`  ⚠️  跳过未识别文件: ${entry}`)
      continue
    }

    const packageId = entry.replace(/\.json$/i, '')
    const override = config.overrides?.[packageId] ?? {}

    // 默认属性
    let visible = true
    let examMode = false
    let dependencies: string[] = []

    if (type === 'unit') {
      visible = false
      // unit-pN 依赖 unit-p(N-1)
      const m = packageId.match(/-p(\d+)$/i)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > 1) {
          const prev = packageId.replace(/-p\d+$/, `-p${n - 1}`)
          if (unitIds.includes(prev)) dependencies = [prev]
        }
      }
    } else if (type === 'term') {
      visible = true
      dependencies = [...unitIds]
    } else if (type === 'special' || type === 'sprint') {
      visible = true
      examMode = true
      // 依赖从 override 提供
      dependencies = override.dependencies ?? []
    }

    // override 优先
    if (override.visible !== undefined) visible = override.visible
    if (override.examMode !== undefined) examMode = override.examMode
    if (override.dependencies !== undefined) dependencies = override.dependencies

    const raw = JSON.parse(readFileSync(fullPath, 'utf-8'))

    result.push({
      fileName: entry,
      packageId,
      type: override.type as PackageType ?? type,
      visible,
      examMode,
      sourceUnitIds: override.sourceUnitIds,
      dependencies,
      sortKey: override.importOrder ?? inferSortKey(entry, type),
      raw,
    })
  }

  // 排序
  result.sort((a, b) => a.sortKey - b.sortKey || a.packageId.localeCompare(b.packageId))
  return result
}

function main() {
  const { inputDir, outputZip } = parseArgs()
  const absDir = resolve(process.cwd(), inputDir)

  console.log(`📦 输入目录: ${absDir}`)
  const config = loadSetConfig(absDir)

  console.log(`🔍 扫描目录...`)
  const built = scanDirectory(absDir, config)
  console.log(`📋 集合: ${config.title}（${built.length} 个包）`)

  const builtPackages: any[] = []
  const importOrder: string[] = []

  for (const b of built) {
    const raw = b.raw
    raw.manifest = raw.manifest || {}
    raw.manifest.packageId = b.packageId
    raw.manifest.type = b.type
    raw.manifest.dependencies = b.dependencies
    raw.manifest.schemaVersion = raw.manifest.schemaVersion || '1.0'
    raw.manifest.subject = raw.manifest.subject || config.subject
    raw.manifest.grade = raw.manifest.grade || config.grade
    raw.manifest.term = raw.manifest.term || config.term
    raw.manifest.edition = raw.manifest.edition || config.edition
    if (!b.visible) raw.manifest.isInternal = true
    if (b.examMode) raw.manifest.examMode = true
    if (Array.isArray(b.sourceUnitIds)) raw.manifest.sourceUnitIds = b.sourceUnitIds

    const rewritten = rewriteIdsInPackage(raw, b.packageId)
    builtPackages.push(rewritten)
    importOrder.push(b.packageId)

    const flags: string[] = []
    if (raw.manifest.isInternal) flags.push('内部')
    if (raw.manifest.examMode) flags.push('考试')
    const flagStr = flags.length ? ` [${flags.join('|')}]` : ''
    const depStr = b.dependencies.length ? ` → 依赖 ${b.dependencies.length} 个` : ''
    console.log(`  ✅ ${b.fileName}${flagStr}${depStr}`)
  }

  const zipBytes = buildLpkgsetZip({
    manifest: {
      schemaVersion: '1.0',
      setId: config.setId,
      title: config.title,
      subject: config.subject,
      grade: config.grade,
      term: config.term,
      edition: config.edition,
      importOrder,
    },
    packages: builtPackages,
  })

  const outPath = outputZip
    ? resolve(process.cwd(), outputZip)
    : join(absDir, `${config.setId}.lpkgset.zip`)
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true })

  writeFileSync(outPath, Buffer.from(zipBytes))
  console.log(`\n✅ 已生成: ${outPath}`)
  console.log(`   大小: ${(zipBytes.length / 1024).toFixed(1)} KB`)
}

main()