/**
 * 全库合集打包：把 `content/*` 下所有包集合合成**一个**导入文件。
 *
 * 为什么要有它：一次修内容往往同时动好几个集合，家长侧就得挨个导入 10 个 zip；
 * 合集把「导入 N 次」压成「导入 1 次」，包列表本身不变（包仍是各自的 packageId）。
 *
 * 与逐集合打包的一致性：
 *   - ID 前缀同样用 `packageId`，所以合集里的题与单独导入的题 ID 完全相同，
 *     导入合集不会产生重复进度，也不会把已有进度变成孤儿。
 *   - 包内缺失的集合级字段（subject/grade/term/edition）用**它自己那个集合**的值补齐，
 *     和「单独导入该集合」的结果一致（合集级 manifest 只做兜底）。
 *
 * 用法：
 *   npm run build:all                    # 产出 content/all-packages/all-packages-set.lpkgset.zip
 *   npm run build:all -- -o out.zip      # 指定输出
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { buildLpkgsetZip, type PackAsset } from './lib/packSet'

interface PackageEntry {
  file: string
  packageId: string
  type: string
  visible?: boolean
  examMode?: boolean
  sourceUnitIds?: string[]
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
  green: '\x1b[32m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
}

function walkFiles(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, rel))
    else out.push(rel)
  }
  return out
}

function collectAssets(absDir: string, knownPackageIds: Set<string>): PackAsset[] {
  const root = join(absDir, 'assets')
  if (!existsSync(root)) return []
  const result: PackAsset[] = []
  for (const pkgDirName of readdirSync(root)) {
    const pkgDir = join(root, pkgDirName)
    if (!statSync(pkgDir).isDirectory()) continue
    if (!knownPackageIds.has(pkgDirName)) continue
    for (const rel of walkFiles(pkgDir)) {
      result.push({
        packageId: pkgDirName,
        path: `assets/${rel}`,
        bytes: readFileSync(join(pkgDir, rel)),
      })
    }
  }
  return result
}

function parseArgs() {
  const args = process.argv.slice(2)
  const oIdx = args.indexOf('-o')
  const output = oIdx >= 0 ? args[oIdx + 1] : undefined
  return { output }
}

function main() {
  const { output } = parseArgs()
  const contentRoot = resolve(process.cwd(), 'content')
  const setDirs = readdirSync(contentRoot)
    .map((n) => join(contentRoot, n))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, '_set.json')))

  const builtPackages: any[] = []
  const assets: PackAsset[] = []
  const importOrder: string[] = []
  const seen = new Map<string, string>()
  const sets: string[] = []

  for (const dir of setDirs) {
    const config: SetConfig = JSON.parse(readFileSync(join(dir, '_set.json'), 'utf8'))
    sets.push(config.title)
    const known = new Set(config.packages.map((p) => p.packageId))
    assets.push(...collectAssets(dir, known))
    let count = 0

    for (const entry of config.packages) {
      if (seen.has(entry.packageId)) {
        console.error(
          `${C.red}❌ packageId 重复：${entry.packageId}（${seen.get(entry.packageId)} 与 ${config.setId}）${C.reset}`,
        )
        process.exit(1)
      }
      seen.set(entry.packageId, config.setId)

      const raw = JSON.parse(readFileSync(join(dir, entry.file), 'utf8'))
      raw.manifest = raw.manifest ?? {}
      // 用**本集合**的值补齐，行为与单独导入该集合完全一致
      raw.manifest.subject = raw.manifest.subject || config.subject
      raw.manifest.grade = raw.manifest.grade || config.grade
      raw.manifest.term = raw.manifest.term || config.term
      raw.manifest.edition = raw.manifest.edition || config.edition
      if (entry.visible === false) raw.manifest.isInternal = true
      if (entry.examMode === true) raw.manifest.examMode = true
      if (Array.isArray(entry.sourceUnitIds)) raw.manifest.sourceUnitIds = entry.sourceUnitIds

      builtPackages.push(rewriteIdsInPackage(raw, entry.packageId))
      importOrder.push(entry.packageId)
      count++
    }
    console.log(`${C.gray}  · ${config.setId}：${count} 个包${C.reset}`)
  }

  const zipBytes = buildLpkgsetZip({
    manifest: {
      schemaVersion: '1.0',
      setId: 'all-packages-set',
      title: '全部学习包（合集）',
      // 合集是混学科的，这几个字段只作兜底；包自身的值优先，已在上面补齐
      subject: 'math',
      grade: 0,
      term: 'up',
      edition: '',
      importOrder,
    },
    packages: builtPackages,
    assets,
  })

  const outPath = output
    ? resolve(process.cwd(), output)
    : join(contentRoot, 'all-packages', 'all-packages-set.lpkgset.zip')
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, Buffer.from(zipBytes))

  const nExercises = builtPackages.reduce(
    (s, p) =>
      s + (p.units ?? []).reduce((t: number, u: any) => t + (u.topics ?? []).reduce((k: number, tp: any) => k + (tp.exercises?.length ?? 0), 0), 0),
    0,
  )
  console.log(
    `\n${C.green}${C.bold}✅ 合集已生成${C.reset} ${C.gray}(${sets.length} 个集合)${C.reset}`,
  )
  console.log(`   ${outPath}`)
  console.log(
    `   ${builtPackages.length} 个包 · ${nExercises} 道题 · ${assets.length} 张图 · ${(zipBytes.length / 1024 / 1024).toFixed(2)} MB`,
  )
}

main()
