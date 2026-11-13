/**
 * 导入前自检：对一个 .lpkgset.zip 复演 `importPackageSet` 的第 3/4 步
 * （建全局 ID 池 → 逐包 normalizePackage），不写库、不需要浏览器。
 *
 * 为什么需要：`build:lpkgset` 成功只代表「压出 zip 了」，不代表「App 能导入」。
 * E008（题目无知识点）、E009（引用悬空）、资产缺失都只在 normalize 阶段才暴露。
 *
 * 用法：
 *   npm run check:lpkg -- content/all-packages/all-packages-set.lpkgset.zip
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { unzipSync, strFromU8 } from 'fflate'
import { normalizePackage, type NormalizeIssue } from '../src/core/importer/normalizePackage'

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', gray: '\x1b[90m', bold: '\x1b[1m' }

async function main() {
  const input = process.argv[2]
  if (!input) {
    console.error('用法: npm run check:lpkg -- <file.lpkgset.zip>')
    process.exit(2)
  }
  const abs = resolve(process.cwd(), input)
  if (!existsSync(abs)) {
    console.error(`${C.red}找不到文件: ${abs}${C.reset}`)
    process.exit(2)
  }

  const files = unzipSync(new Uint8Array(readFileSync(abs)))
  const names = Object.keys(files)
  if (!names.includes('manifest.json')) {
    console.error(`${C.red}ZIP 缺少 manifest.json${C.reset}`)
    process.exit(1)
  }
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  const pkgNames = names.filter((n) => /^packages\/[^/]+\.json$/.test(n))
  if (pkgNames.length === 0) {
    console.error(`${C.red}ZIP 里没有 packages/*.json${C.reset}`)
    process.exit(1)
  }

  console.log(`${C.bold}📦 ${manifest.title ?? manifest.setId}${C.reset}  ${C.gray}(${pkgNames.length} 个包)${C.reset}`)

  const ordered = pkgNames
    .map((n) => JSON.parse(strFromU8(files[n])))
    .sort((a, b) => {
      const io: string[] = manifest.importOrder ?? []
      const ia = io.indexOf(a?.manifest?.packageId)
      const ib = io.indexOf(b?.manifest?.packageId)
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib)
    })

  // 第 3 步：全局 ID 池
  const externalKpIds = new Set<string>()
  const externalPackageIds = new Set<string>()
  for (const raw of ordered) {
    if (raw?.manifest?.packageId) externalPackageIds.add(raw.manifest.packageId)
    for (const kp of raw?.knowledgePoints ?? []) if (kp?.id) externalKpIds.add(kp.id)
  }

  // 资产清单（packages/<pkgId>/assets/...）
  const assetsByPkg = new Map<string, Set<string>>()
  for (const n of names) {
    const m = n.match(/^packages\/([^/]+)\/(assets\/.+)$/)
    if (!m) continue
    if (!assetsByPkg.has(m[1])) assetsByPkg.set(m[1], new Set())
    assetsByPkg.get(m[1])!.add(m[2])
  }

  // 第 4 步：逐包 normalize
  let errorCount = 0
  let warnCount = 0
  const byCode = new Map<string, number>()
  const seenIds = new Set<string>()

  for (const raw of ordered) {
    const pid = raw?.manifest?.packageId ?? '(unknown)'
    const merged = JSON.parse(JSON.stringify(raw))
    merged.manifest = merged.manifest ?? {}
    if (!merged.manifest.subject && manifest.subject) merged.manifest.subject = manifest.subject
    if (!merged.manifest.grade && manifest.grade) merged.manifest.grade = manifest.grade
    if (!merged.manifest.term && manifest.term) merged.manifest.term = manifest.term
    if (!merged.manifest.edition && manifest.edition) merged.manifest.edition = manifest.edition

    const { errors, warnings } = normalizePackage(merged, {
      externalKpIds,
      externalPackageIds,
      assetPaths: assetsByPkg.get(pid) ?? new Set(),
    })

    for (const issue of [...errors, ...warnings] as NormalizeIssue[]) {
      byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1)
    }
    if (errors.length > 0) {
      errorCount += errors.length
      console.log(`${C.red}  ✗ ${pid}${C.reset}`)
      for (const e of errors.slice(0, 5)) console.log(`    [${e.code}] ${e.message}`)
    } else if (warnings.length > 0) {
      warnCount += warnings.length
      console.log(`${C.yellow}  ⚠ ${pid}${C.reset}  ${C.gray}${warnings.length} 条提示${C.reset}`)
    } else {
      console.log(`${C.green}  ✓${C.reset} ${pid}`)
    }

    // 重复 packageId 检查
    if (seenIds.has(pid)) {
      errorCount++
      console.log(`${C.red}    重复 packageId: ${pid}${C.reset}`)
    }
    seenIds.add(pid)
  }

  const codes = [...byCode.entries()].sort((a, b) => b[1] - a[1])
  if (codes.length > 0) {
    console.log(`\n按码统计: ${codes.map(([k, v]) => `${k}×${v}`).join('  ')}`)
  }

  if (errorCount > 0) {
    console.log(`\n${C.red}${C.bold}❌ 有 ${errorCount} 个阻断错误，这份 zip 导入会被拒绝${C.reset}`)
    process.exit(1)
  }
  console.log(`\n${C.green}${C.bold}✅ 可导入${C.reset}  ${C.gray}${ordered.length} 个包，${warnCount} 条非阻断提示${C.reset}`)
}

main()
