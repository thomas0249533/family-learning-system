import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { buildLpkgsetZip } from './lib/packSet'

interface PackageEntry {
  file: string
  packageId: string
  type: string
  visible?: boolean
  examMode?: boolean
  sourceUnitIds?: string[]
  dependencies?: string[]
}

interface SetConfig {
  setId: string
  title: string
  subject: string
  grade: number
  term: string
  edition: string
  importOrder: string[]
  packages: PackageEntry[]
}

function parseArgs() {
  const args = process.argv.slice(2)
  const inputDir = args[0]
  let outputZip: string | undefined
  const oIdx = args.indexOf('-o')
  if (oIdx >= 0) outputZip = args[oIdx + 1]
  if (!inputDir) {
    console.error('用法: npm run build:lpkgset -- <inputDir> [-o output.zip]')
    process.exit(1)
  }
  return { inputDir, outputZip }
}

function loadSetConfig(dir: string): SetConfig {
  const cfgPath = join(dir, '_set.json')
  if (!existsSync(cfgPath)) throw new Error(`缺少 _set.json：${cfgPath}`)
  return JSON.parse(readFileSync(cfgPath, 'utf-8'))
}

function main() {
  const { inputDir, outputZip } = parseArgs()
  const absDir = resolve(process.cwd(), inputDir)

  console.log(`📦 输入目录: ${absDir}`)
  const config = loadSetConfig(absDir)
  console.log(`📋 集合: ${config.title}（${config.packages.length} 个包）`)

  const builtPackages: any[] = []

  for (const entry of config.packages) {
    const filePath = join(absDir, entry.file)
    if (!existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`)
      process.exit(1)
    }

    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    raw.manifest = raw.manifest || {}
    raw.manifest.packageId = entry.packageId

    // ✅ 关键修复：统一写入 packageType，并清理老字段 type
    raw.manifest.packageType = entry.type
    delete raw.manifest.type

    raw.manifest.dependencies = entry.dependencies ?? []
    raw.manifest.schemaVersion = raw.manifest.schemaVersion || '1.0'
    raw.manifest.subject = raw.manifest.subject || config.subject
    raw.manifest.grade = raw.manifest.grade || config.grade
    raw.manifest.term = raw.manifest.term || config.term
    raw.manifest.edition = raw.manifest.edition || config.edition

    // 内部包 / 考试模式 / 来源单元
    if (entry.visible === false) raw.manifest.isInternal = true
    if (entry.examMode === true) raw.manifest.examMode = true
    if (Array.isArray(entry.sourceUnitIds)) raw.manifest.sourceUnitIds = entry.sourceUnitIds

    const rewritten = rewriteIdsInPackage(raw, entry.packageId)
    builtPackages.push(rewritten)

    const flags: string[] = []
    if (raw.manifest.isInternal) flags.push('内部')
    if (raw.manifest.examMode) flags.push('考试')
    console.log(`  ✅ ${entry.file} → ${entry.packageId}${flags.length ? ' [' + flags.join('|') + ']' : ''}`)
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
      importOrder: config.importOrder,
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