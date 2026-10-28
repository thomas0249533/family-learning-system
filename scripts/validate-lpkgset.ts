/**
 * 学习包集合目录批量校验
 *
 * 用法：
 *   npm run validate:set -- content/math-4-up-rjb
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative } from 'path'
import { normalizePackage, type NormalizeIssue } from '../src/core/importer/normalizePackage'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { qualityChecks } from './lib/qualityChecks'
import {
  MAX_ASSET_BYTES,
  MAX_ASSETS_TOTAL_BYTES,
  formatBytes,
  normalizeAssetPath,
  validateAsset,
} from '../src/core/package-manager/assetPath'

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

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
}

/** 内容质量提示按码累计（用于「content/ 实测命中条数」可复现） */
const qualityTally = new Map<string, number>()

function tallyQuality(issues: NormalizeIssue[]): void {
  for (const i of issues) {
    qualityTally.set(i.code, (qualityTally.get(i.code) ?? 0) + 1)
  }
}

function fmt(issue: NormalizeIssue, indent = '    '): string {
  const color = issue.level === 'error' ? C.red : C.yellow
  const tag = issue.level === 'error' ? '❌' : '⚠️ '
  const lines = [
    `${indent}${tag} [${C.bold}${issue.code}${C.reset}] ${C.gray}${issue.path}${C.reset}`,
    `${indent}   ${color}${issue.message}${C.reset}`,
  ]
  if (issue.hint) lines.push(`${indent}   ${C.cyan}💡 ${issue.hint}${C.reset}`)
  return lines.join('\n')
}

function parseArgs(): { inputDir: string } {
  const args = process.argv.slice(2)
  if (!args[0]) {
    console.error('用法: npm run validate:set -- <contentDir>')
    process.exit(1)
  }
  return { inputDir: args[0] }
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

interface ScannedAsset {
  /** 包内相对路径，如 `assets/shape-01.png` */
  path: string
  size: number
}

/**
 * 扫 `assets/<packageId>/` 得到每个包**实际拥有**的图片（V2.12）。
 *
 * 与 `build-lpkgset` 用同一套目录约定；两边都读同一份磁盘，
 * 所以"校验通过"意味着"打出来的 zip 里真有这张图"。
 */
function scanAssets(absDir: string): Map<string, ScannedAsset[]> {
  const map = new Map<string, ScannedAsset[]>()
  const root = join(absDir, 'assets')
  if (!existsSync(root)) return map

  for (const pkgDirName of readdirSync(root)) {
    const pkgDir = join(root, pkgDirName)
    if (!statSync(pkgDir).isDirectory()) continue
    const list: ScannedAsset[] = []
    for (const rel of walkFiles(pkgDir)) {
      list.push({ path: `assets/${rel}`, size: statSync(join(pkgDir, rel)).size })
    }
    map.set(pkgDirName, list)
  }
  return map
}

/** 收集一个包里所有题目引用到的图片路径 */
function collectReferencedImages(raw: any): string[] {
  const out: string[] = []
  const push = (ex: any) => {
    if (typeof ex?.image === 'string' && ex.image) out.push(ex.image)
  }
  for (const ex of raw?.exercises ?? []) push(ex)
  for (const unit of raw?.units ?? []) {
    for (const topic of unit?.topics ?? []) {
      for (const ex of topic?.exercises ?? []) push(ex)
    }
  }
  return out
}

function main() {
  const { inputDir } = parseArgs()
  const absDir = resolve(process.cwd(), inputDir)

  if (!existsSync(absDir)) {
    console.error(`${C.red}❌ 目录不存在: ${absDir}${C.reset}`)
    process.exit(1)
  }

  const setPath = join(absDir, '_set.json')
  if (!existsSync(setPath)) {
    console.error(`${C.red}❌ 缺少 _set.json: ${setPath}${C.reset}`)
    process.exit(1)
  }

  const config: SetConfig = JSON.parse(readFileSync(setPath, 'utf-8'))
  console.log(`\n${C.bold}📦 集合:${C.reset} ${config.title}`)
  console.log(`${C.gray}📁 目录: ${absDir}${C.reset}`)
  console.log(`${C.gray}📋 检查 ${config.packages.length} 个包...${C.reset}\n`)

  // ---------- 图片资产清单（V2.12） ----------
  const assetIndex = scanAssets(absDir)
  const knownPackageIds = new Set(config.packages.map((p) => p.packageId))
  const strayDirs = [...assetIndex.keys()].filter((id) => !knownPackageIds.has(id))
  if (strayDirs.length > 0) {
    console.log(
      `${C.yellow}⚠️  assets/ 下存在 _set.json 里没有的包目录: ${strayDirs.join(', ')}${C.reset}\n` +
        `   ${C.gray}这些图片不会进入任何包，请在 _set.json 里补上，或改名成正确的 packageId${C.reset}\n`,
    )
  }
  const totalAssetBytes = [...assetIndex.values()]
    .flat()
    .reduce((s, a) => s + a.size, 0)
  if (totalAssetBytes > 0) {
    console.log(
      `${C.gray}🖼  图片资产: ${[...assetIndex.values()].flat().length} 张，共 ${formatBytes(totalAssetBytes)}${C.reset}\n`,
    )
  }

  // 第一遍：读取全部原始 JSON，构建外部 ID 池
  const rawList: { entry: PackageEntry; raw: any; quality: NormalizeIssue[] }[] = []
  const externalKpIds = new Set<string>()
  const externalPackageIds = new Set<string>()

  for (const entry of config.packages) {
    const filePath = join(absDir, entry.file)
    if (!existsSync(filePath)) {
      console.error(`${C.red}❌ 文件不存在: ${entry.file}${C.reset}`)
      process.exit(1)
    }

    let raw: any
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch (e: any) {
      console.error(`${C.red}❌ ${entry.file}: JSON 解析失败${C.reset}`)
      console.error(`   ${e.message}`)
      process.exit(1)
    }

    // 注入 manifest
    raw.manifest = raw.manifest || {}
    raw.manifest.packageId = entry.packageId
    // ✅ 统一字段名：写入 packageType，清理 type
    raw.manifest.packageType = entry.type
    delete raw.manifest.type

    raw.manifest.dependencies = entry.dependencies ?? []
    raw.manifest.schemaVersion = raw.manifest.schemaVersion || '1.0'
    raw.manifest.subject = raw.manifest.subject || config.subject
    raw.manifest.grade = raw.manifest.grade || config.grade
    raw.manifest.term = raw.manifest.term || config.term
    raw.manifest.edition = raw.manifest.edition || config.edition
    if (entry.visible === false) raw.manifest.isInternal = true
    if (entry.examMode === true) raw.manifest.examMode = true
    if (Array.isArray(entry.sourceUnitIds)) raw.manifest.sourceUnitIds = entry.sourceUnitIds

    // 质量检查：在 ID 重写前做，检测原始输入
    const quality = qualityChecks(raw)

    // ID 重写
    const rewritten = rewriteIdsInPackage(raw, entry.packageId)

    // 汇总 ID 池
    externalPackageIds.add(entry.packageId)
    for (const kp of rewritten.knowledgePoints ?? []) {
      if (kp?.id) externalKpIds.add(kp.id)
    }

    rawList.push({ entry, raw: rewritten, quality })
  }

  // 第二遍：逐个规范化校验
  let totalErrors = 0
  let totalWarnings = 0
  let totalQuality = 0
  let totalKps = 0
  let totalExercises = 0
  let allPassed = true

  for (const { entry, raw, quality } of rawList) {
    const flags: string[] = []
    if (raw.manifest.isInternal) flags.push('内部')
    if (raw.manifest.examMode) flags.push('考试')
    const flagStr = flags.length ? ` ${C.gray}[${flags.join('|')}]${C.reset}` : ''

    const { errors, warnings, stats } = normalizePackage(raw, {
      externalKpIds,
      externalPackageIds,
      assetPaths: new Set((assetIndex.get(entry.packageId) ?? []).map((a) => a.path)),
    })

    // ---------- 图片资产体积 / 孤儿检查（V2.12） ----------
    const ownedAssets = assetIndex.get(entry.packageId) ?? []
    if (ownedAssets.length > 0) {
      const bytes = ownedAssets.reduce((s, a) => s + a.size, 0)
      if (bytes > MAX_ASSETS_TOTAL_BYTES) {
        errors.push({
          level: 'error',
          code: 'E024',
          path: `assets/${entry.packageId}`,
          message: `图片总量 ${formatBytes(bytes)} 超过单包上限 ${formatBytes(MAX_ASSETS_TOTAL_BYTES)}`,
          hint: '图形题建议用 SVG 或把人眼不可辨的细节去掉；确需更多图片时拆成两个包',
        })
      }
      for (const a of ownedAssets) {
        const reason = validateAsset({ path: a.path, size: a.size })
        if (reason === 'too-large') {
          errors.push({
            level: 'error',
            code: 'E024',
            path: a.path,
            message: `图片 ${a.path} 体积 ${formatBytes(a.size)} 超过单张上限 ${formatBytes(MAX_ASSET_BYTES)}`,
            hint: '压到 2MB 以内，或改用 SVG / WebP',
          })
        } else if (reason === 'unsupported-ext') {
          errors.push({
            level: 'error',
            code: 'E024',
            path: a.path,
            message: `图片 ${a.path} 格式不支持`,
            hint: '只收 png / jpg / jpeg / webp / gif / svg',
          })
        }
      }

      // 孤儿图：打进包里却没有任何题引用 —— 白占体积，且通常意味着路径写错了
      const referenced = new Set(
        collectReferencedImages(raw)
          .map((p) => normalizeAssetPath(p))
          .filter((p): p is string => p !== null),
      )
      for (const a of ownedAssets) {
        if (!referenced.has(a.path)) {
          warnings.push({
            level: 'warning',
            code: 'W036',
            path: a.path,
            message: `图片 ${a.path} 没有被任何题目引用`,
            hint: '多半是题目里的 image 路径写错了（或该图已废弃），确认后删除',
          })
        }
      }
    }

    if (errors.length > 0) {
      allPassed = false
      totalErrors += errors.length
      console.log(`${C.red}  ❌ ${entry.file}${flagStr}${C.reset}`)
      errors.forEach(e => console.log(fmt(e)))
    } else {
      const kp = stats?.knowledgePoints ?? 0
      const ex = stats?.exercises ?? 0
      totalKps += kp
      totalExercises += ex
      console.log(
        `${C.green}  ✅ ${entry.file}${C.reset}${flagStr} ` +
        `${C.gray}（知识点 ${kp}，题目 ${ex}）${C.reset}`
      )
    }

    if (warnings.length > 0) {
      totalWarnings += warnings.length
      warnings.forEach(w => console.log(fmt(w)))
    }

    // ✅ 质量检查（W021~W033）
    if (quality.length > 0) {
      totalQuality += quality.length
      tallyQuality(quality)
      quality.forEach(w => console.log(fmt(w)))
    }
  }

  console.log()
  if (!allPassed) {
    console.log(`${C.red}${C.bold}❌ 校验失败${C.reset}`)
    console.log(`   错误: ${totalErrors}，警告: ${totalWarnings}，质量提示: ${totalQuality}`)
    console.log()
    process.exit(1)
  }

  console.log(`${C.green}${C.bold}✅ 全部通过${C.reset}`)
  console.log(`   ${C.gray}包数: ${rawList.length}${C.reset}`)
  console.log(`   ${C.gray}总知识点: ${totalKps}${C.reset}`)
  console.log(`   ${C.gray}总题目: ${totalExercises}${C.reset}`)
  if (totalWarnings > 0) {
    console.log(`   ${C.yellow}警告: ${totalWarnings}${C.reset}`)
  }
  if (totalQuality > 0) {
    console.log(`   ${C.yellow}质量提示: ${totalQuality}（不阻塞，建议优化）${C.reset}`)
    const lines = [...qualityTally.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, n]) => `${code}×${n}`)
      .join('  ')
    console.log(`   ${C.gray}按码: ${lines}${C.reset}`)
  }
  console.log()
}

main()