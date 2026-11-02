/**
 * gen-content-dist.ts —— 生成「官方题库分发目录」（content-dist/）
 *
 * 产物（进仓库、随 main 分发，App 经 mirrors.ts 的镜像链拉取）：
 *   content-dist/<packageId>.json   每个包一份单文件 JSON（manifest.version 已收敛）
 *   content-dist/content-catalog.json  目录：packageId + version + title + sha256
 *
 * 铁律：
 *   1. **改了内容必须升 manifest.version** —— App 只按版本号判断"有没有更新"，
 *      内容变了版本没升 = 家庭端永远收不到这次修复，而且**不报错**。
 *      本脚本用「新旧 dist 逐字节对比」兜底：内容变了版本没升 → 退出码 1，
 *      让发版流程当场停下（--force 可越过，仅限确知无需分发的改动）。
 *   2. 只收**包文件**：content/<学科>/*.json 且含 manifest.packageId；
 *      _set.json / manifest.json / all_exercises.json / 子目录（packages、assets）全跳过。
 *   3. 每个包先过 normalizePackage 全量校验，校验不过不出 dist ——
 *      分发层不做二次矫正，坏数据在源头死。
 *
 * 用法：npx vite-node scripts/gen-content-dist.ts [--force]
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { normalizePackage } from '../src/core/importer/normalizePackage'
import { rewriteIdsInPackage } from './lib/idRewrite'

const ROOT = join(__dirname, '..')
const CONTENT_DIR = join(ROOT, 'content')
const DIST_DIR = join(ROOT, 'content-dist')
const CATALOG_FILE = join(DIST_DIR, 'content-catalog.json')

const force = process.argv.includes('--force')

interface DistEntry {
  packageId: string
  version: string
  title: string
  sha256: string
  size: number
}

/** 本地日期 YYYY-MM-DD（不许 toISOString —— 那是 UTC 口径，日期会漂） */
function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 收集所有包文件（深度 1 的学科目录下的 .json） */
function collectPackageFiles(): string[] {
  const files: string[] = []
  for (const e of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue // all_exercises.json、fix_sprint.py、资料/ 都不进
    for (const f of readdirSync(join(CONTENT_DIR, e.name))) {
      if (!f.endsWith('.json')) continue
      if (f === '_set.json' || f === 'manifest.json') continue
      files.push(join(CONTENT_DIR, e.name, f))
    }
  }
  return files.sort()
}

const entries: DistEntry[] = []
const stale: string[] = []
let skipped = 0

/** 第一遍：收集全部 packageId 与 kpId —— 跨包前置（`pkg::kp-x`）的校验需要全量池 */
const packageFiles = collectPackageFiles()
const externalKpIds = new Set<string>()
const externalPackageIds = new Set<string>()
const parsed = new Map<string, any>()
for (const file of packageFiles) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    parsed.set(file, raw)
    const packageId: string | undefined = raw?.manifest?.packageId
    if (!packageId) continue
    externalPackageIds.add(packageId)
    // 与 build-lpkgset 同一形态：先重写成限定 ID，再进池（源里裸/限定混写都收敛）
    const rewritten = rewriteIdsInPackage(raw, packageId)
    for (const kp of rewritten?.knowledgePoints ?? []) if (kp?.id) externalKpIds.add(kp.id)
  } catch {
    /* 留给第二遍报错 —— 语法错误在第二遍逐文件重新 parse 时会有更准的文件名 */
  }
}

for (const file of packageFiles) {
  const rel = relative(ROOT, file)
  const raw = parsed.get(file) ?? (() => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      console.error(`❌ ${rel}：JSON 解析失败 —— ${(err as Error).message}`)
      process.exit(1)
    }
  })()
  const packageId: string | undefined = raw?.manifest?.packageId
  if (!packageId) {
    skipped++ // 没有包身份的 json（历史遗留/草稿）静默跳过
    continue
  }

  // 版本收敛：源文件没写 version 的按 1.0.0 起步（dist 里一定带，App 比对才有依据）
  if (!raw.manifest.version) raw.manifest.version = '1.0.0'

  // 与 build-lpkgset 同一形态：限定 ID。App 里 installed 包的 kp/exercise id
  // 就是这个形态 —— 更新走 db.packages.put 覆盖，id 形态不一致 = 进度全断。
  const rewritten = rewriteIdsInPackage(raw, packageId)

  const { package: normalized, errors } = normalizePackage(rewritten, { externalKpIds, externalPackageIds })
  if (errors.length > 0 || !normalized) {
    console.error(`❌ ${rel}：校验未通过 ——\n  ${errors.map((e) => `${e.code} ${e.message}`).join('\n  ')}`)
    process.exit(1)
  }

  const text = JSON.stringify(normalized, null, 2) + '\n'
  const distFile = join(DIST_DIR, `${packageId}.json`)

  // 护栏 1：内容变了、版本没升 → 拒绝生成（见文件头铁律 1）
  if (existsSync(distFile)) {
    const old = readFileSync(distFile, 'utf8')
    if (old !== text) {
      try {
        const oldVersion = String(JSON.parse(old)?.manifest?.version ?? '')
        if (oldVersion === raw.manifest.version) {
          stale.push(`  ${packageId}: 内容已变化但 manifest.version 仍是 ${oldVersion}`)
        }
      } catch {
        stale.push(`  ${packageId}: 旧 dist 损坏（将整体重写）`)
      }
    }
  }

  entries.push({
    packageId,
    version: raw.manifest.version,
    title: String(raw.manifest.title ?? packageId),
    sha256: sha256(text),
    size: Buffer.byteLength(text, 'utf8'),
  })
  // 记下内容，等 stale 检查全部通过后再统一写盘
  ;(entries[entries.length - 1] as DistEntry & { _text: string })._text = text
}

if (stale.length > 0 && !force) {
  console.error(
    `❌ 以下学习包内容有变化但 manifest.version 没升，家庭端将收不到这次更新：\n${stale.join('\n')}\n` +
      `请在源文件里升 version（如 1.0.0 → 1.0.1）后重跑；确知无需分发可用 --force。`,
  )
  process.exit(1)
}

mkdirSync(DIST_DIR, { recursive: true })
const catalog = {
  updatedAt: localDate(),
  packages: entries.map(({ packageId, version, title, sha256: h }) => ({ packageId, version, title, sha256: h })),
}

for (const e of entries) {
  writeFileSync(join(DIST_DIR, `${e.packageId}.json`), (e as DistEntry & { _text: string })._text)
}
writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2) + '\n')

console.log(`✅ content-dist 生成完毕：${entries.length} 个包${skipped ? `（另跳过 ${skipped} 个非包文件）` : ''}`)
console.log(`   目录 updatedAt: ${catalog.updatedAt}`)
if (force && stale.length > 0) {
  console.warn(`⚠️ --force 越过了 ${stale.length} 个"内容变了版本没升"的包（本次不会推给家庭端）`)
}
