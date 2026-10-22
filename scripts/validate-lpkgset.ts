/**
 * 学习包集合目录批量校验
 *
 * 用法：
 *   npm run validate:set -- content/math-4-up-rjb
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { normalizePackage, type NormalizeIssue } from '../src/core/importer/normalizePackage'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { qualityChecks } from './lib/qualityChecks'

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
    })

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