import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, join, dirname, relative } from 'path'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { buildLpkgsetZip, type PackAsset } from './lib/packSet'

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

/** 递归列出目录下所有文件，返回相对 `base` 的 posix 路径 */
function walkFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full, base))
    } else {
      out.push(relative(base, full).split('\\').join('/'))
    }
  }
  return out
}

/**
 * 收集图片资产（V2.12）。
 *
 * 源目录约定：
 * ```
 * content/<集合>/
 *   assets/
 *     <packageId>/            ← 目录名必须等于 _set.json 里的 packageId
 *       shape-01.png
 * ```
 * 打包后变成 `packages/<packageId>/assets/shape-01.png`，
 * 与导入器 `parseAssetPath` 的识别规则一一对应，中间不做任何路径换算。
 *
 * **目录名写错（比如拼错 packageId）不会在这里报错** —— 那会让图片
 * 悬空到一个不存在的包上，导入时静默丢弃。所以下面会和 `_set.json` 对一遍，
 * 出现陌生目录名直接中止。
 */
function collectAssets(absDir: string, knownPackageIds: Set<string>): PackAsset[] {
  const root = join(absDir, 'assets')
  if (!existsSync(root)) return []

  const result: PackAsset[] = []
  const unknown: string[] = []

  for (const pkgDirName of readdirSync(root)) {
    const pkgDir = join(root, pkgDirName)
    if (!statSync(pkgDir).isDirectory()) continue
    if (!knownPackageIds.has(pkgDirName)) {
      unknown.push(pkgDirName)
      continue
    }
    for (const rel of walkFiles(pkgDir)) {
      result.push({
        packageId: pkgDirName,
        path: `assets/${rel}`,
        bytes: readFileSync(join(pkgDir, rel)),
      })
    }
  }

  if (unknown.length > 0) {
    console.error(
      `❌ assets/ 下出现 _set.json 里没有的包目录: ${unknown.join(', ')}\n` +
        `   这些图片不会被打进任何包。请把目录名改成 packages[].packageId。`,
    )
    process.exit(1)
  }

  return result
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

  const assets = collectAssets(absDir, new Set(config.packages.map((p) => p.packageId)))
  if (assets.length > 0) {
    const totalBytes = assets.reduce((s, a) => s + a.bytes.byteLength, 0)
    console.log(`🖼  图片资产: ${assets.length} 张，共 ${(totalBytes / 1024).toFixed(1)} KB`)
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
    assets,
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