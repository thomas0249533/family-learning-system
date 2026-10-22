/**
 * 学习包校验 CLI
 *
 * 用法:
 *   npm run validate -- path/to/package.json
 *   npm run validate -- path/a.json path/b.json
 *
 * 退出码:
 *   0 = 全部通过
 *   1 = 有错误
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { normalizePackage, type NormalizeIssue } from '../src/core/importer/normalizePackage'
import { qualityChecks } from './lib/qualityChecks'

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
}

function fmt(issue: NormalizeIssue, indent = '  '): string {
  const color = issue.level === 'error' ? C.red : C.yellow
  const tag = issue.level === 'error' ? '❌' : '⚠️ '
  const lines = [
    `${indent}${tag} [${C.bold}${issue.code}${C.reset}] ${C.gray}${issue.path}${C.reset}`,
    `${indent}   ${color}${issue.message}${C.reset}`,
  ]
  if (issue.hint) {
    lines.push(`${indent}   ${C.cyan}💡 ${issue.hint}${C.reset}`)
  }
  return lines.join('\n')
}

/** 内容质量提示按码累计（跨文件汇总用，便于「实测命中条数」可复现） */
const qualityTally = new Map<string, number>()

function tallyQuality(issues: NormalizeIssue[]): void {
  for (const i of issues) {
    qualityTally.set(i.code, (qualityTally.get(i.code) ?? 0) + 1)
  }
}

function validateOne(filePath: string): boolean {
  const abs = resolve(process.cwd(), filePath)
  console.log(`\n${C.bold}📦 校验文件:${C.reset} ${filePath}`)

  // 1. 读文件
  let text: string
  try {
    text = readFileSync(abs, 'utf-8')
  } catch (e: any) {
    console.log(`${C.red}  ❌ 无法读取文件: ${e.message}${C.reset}`)
    return false
  }

  // 2. JSON 解析
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch (e: any) {
    console.log(`${C.red}  ❌ [E010] JSON 语法错误${C.reset}`)
    console.log(`     ${e.message}`)
    console.log(`${C.cyan}  💡 用 VSCode 打开文件，红色波浪线位置就是错误${C.reset}`)
    return false
  }

  // 3. 规范化
  const { errors, warnings, stats } = normalizePackage(raw)

  // 3b. 内容质量检查（W021~W033，只提示不阻断）
  const quality = qualityChecks(raw)
  tallyQuality(quality)

  // 4. 打印
  if (warnings.length > 0) {
    console.log(`${C.yellow}  ⚠️  ${warnings.length} 条警告${C.reset}`)
    warnings.forEach(w => console.log(fmt(w)))
  }

  if (quality.length > 0) {
    console.log(`${C.yellow}  ⚠️  ${quality.length} 条内容质量提示${C.reset}`)
    quality.forEach(w => console.log(fmt(w)))
  }

  if (errors.length > 0) {
    console.log(`${C.red}  ❌ 校验失败，共 ${errors.length} 个错误${C.reset}`)
    errors.forEach(e => console.log(fmt(e)))
    console.log(`${C.gray}  ─────────────────────────────${C.reset}`)
    return false
  }

  console.log(`${C.green}  ✅ 校验通过${C.reset}`)
  if (stats) {
    console.log(`${C.gray}  📊 统计:${C.reset}`)
    console.log(`     知识点: ${stats.knowledgePoints}`)
    console.log(`     题目:   ${stats.exercises}`)
    console.log(`     单元:   ${stats.units}`)
    console.log(`     主题:   ${stats.topics}`)
  }
  return true
}

function main() {
  const files = process.argv.slice(2)

  if (files.length === 0) {
    console.log(`${C.bold}学习包校验工具${C.reset}`)
    console.log(`\n用法:`)
    console.log(`  npm run validate -- <file.json> [<file2.json> ...]`)
    console.log(`\n示例:`)
    console.log(`  npm run validate -- packages/examples/math-4-up.json`)
    console.log(`  npm run validate -- packages/examples/*.json`)
    process.exit(1)
  }

  let allPassed = true
  let passed = 0
  let failed = 0

  for (const file of files) {
    const ok = validateOne(file)
    if (ok) passed++
    else {
      failed++
      allPassed = false
    }
  }

  console.log(`\n${C.bold}📋 汇总:${C.reset}`)
  console.log(`  ${C.green}通过: ${passed}${C.reset}`)
  console.log(`  ${C.red}失败: ${failed}${C.reset}`)

  if (qualityTally.size > 0) {
    const lines = [...qualityTally.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, n]) => `${code}×${n}`)
      .join('  ')
    console.log(`  ${C.yellow}内容质量提示（按码）: ${lines}${C.reset}`)
  }

  console.log('')
  process.exit(allPassed ? 0 : 1)
}

main()