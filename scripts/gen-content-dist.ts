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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'fs'
import { join, relative, dirname } from 'path'
import { zipSync } from 'fflate'
import { normalizePackage } from '../src/core/importer/normalizePackage'
import { rewriteIdsInPackage } from './lib/idRewrite'

const ROOT = join(__dirname, '..')
const CONTENT_DIR = join(ROOT, 'content')
const DIST_DIR = join(ROOT, 'content-dist')
const ASSETS_DIR = join(DIST_DIR, 'assets')
const CATALOG_FILE = join(DIST_DIR, 'content-catalog.json')

const force = process.argv.includes('--force')

interface DistEntry {
  packageId: string
  version: string
  title: string
  sha256: string
  size: number
  /** 内容源目录（含 assets/ 的相对位置） */
  pkgDir: string
  /** V3.1.8 · 本包内容里实际引用到的资产文件名（assets/ 之后那段），用于精准打包 */
  assetRefs: string[]
  /** V3.1.8 · 离线资产归档（音频/图片），若有 */
  assets?: { file: string; sha256: string }
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
    pkgDir: dirname(file),
    assetRefs: collectReferencedAssets(raw),
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

/**
 * 收集一个包内容里**实际引用**的资产文件名（assets/ 之后的那一段）。
 *
 * 为什么按引用收集而不是把整个 assets/ 目录打包：同一个内容源目录（如
 * `content/chinese-4-up-rjb/`）下往往躺着好几个独立包（unit-u1…u8、base、daily…），
 * 它们共享一个 `assets/` 文件夹。若整目录打包，每个包都会背走别人的几百个文件、
 * 还产生一堆引用不到的孤儿资产。只有「本包真正引用到的」才该进本包的归档。
 *
 * 覆盖三处引用点：知识点 `metadata.audio`、知识点 `image`、题目 `image`。
 */
function collectReferencedAssets(raw: any): string[] {
  const refs = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('assets/')) refs.add(v.slice('assets/'.length))
  }
  for (const kp of raw?.knowledgePoints ?? []) {
    push(kp?.metadata?.audio)
    push(kp?.image)
  }
  const scanExercises = (list: any[]) => {
    for (const ex of list ?? []) push(ex?.image)
  }
  for (const u of raw?.units ?? []) {
    for (const t of u?.topics ?? []) scanExercises(t?.exercises)
  }
  scanExercises(raw?.exercises)
  return [...refs]
}

/**
 * V3.1.8 · 把某个学习包「实际引用到的」离线资产（音频/图片）打包成单个 assets.zip，
 * 落到 content-dist/assets/<packageId>/assets.zip。
 *
 * 查找策略：先在本包内容源目录的 `assets/` **直接子文件**里找（词汇包音频就在根下，
 * 如 `assets/<kpId>.mp3`）；找不到时**递归兜底**到 `assets/` 的二级子目录
 * （少数图片包把图错放在 `assets/<pkg>/x.svg`，而内容引用的是扁平的 `assets/x.svg`，
 * 递归兜底恰好能把路径对上，顺手修掉「图永远显示不出来」的旧问题）。
 * 无论哪种来源，归档里一律存成 `assets/<name>`，与内容引用路径严格一致。
 *
 * 返回归档相对分发目录的 relPath 与 sha256；没有可打包资产时返回 null。
 */
function bundleAssets(
  pkgDir: string,
  packageId: string,
  refs: string[],
): { file: string; sha256: string } | null {
  if (!refs || refs.length === 0) return null
  const assetsDir = join(pkgDir, 'assets')
  if (!existsSync(assetsDir)) return null

  // 平铺层：assets/ 直接子文件（name → 物理路径）
  const flat = new Map<string, string>()
  for (const name of readdirSync(assetsDir)) {
    const full = join(assetsDir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isFile()) flat.set(name, full)
  }
  // 递归层：assets/ 下所有子目录里的文件（name → 物理路径，取首个命中，去重）
  const nested = new Map<string, string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (!nested.has(name)) nested.set(name, full)
    }
  }
  for (const name of readdirSync(assetsDir)) {
    const full = join(assetsDir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full)
  }

  const files: Record<string, Uint8Array> = {}
  for (const ref of refs) {
    const name = ref.startsWith('assets/') ? ref.slice('assets/'.length) : ref
    const full = flat.get(name) ?? nested.get(name)
    if (!full) continue // 源里没有这个文件（如放错位置的图），跳过、不阻断其它资产
    try {
      files[`assets/${name}`] = new Uint8Array(readFileSync(full))
    } catch {
      continue
    }
  }
  if (Object.keys(files).length === 0) return null
  const zip = zipSync(files, { level: 6 })
  const outDir = join(ASSETS_DIR, packageId)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'assets.zip'), zip)
  return { file: `assets/${packageId}/assets.zip`, sha256: createHash('sha256').update(zip).digest('hex') }
}

mkdirSync(DIST_DIR, { recursive: true })
mkdirSync(ASSETS_DIR, { recursive: true })
const catalog = {
  updatedAt: localDate(),
  packages: entries.map((e) => {
    // 资产归档与包 JSON 同源同步：先打 zip 再写 catalog，保证 sha256 一致
    const assets = bundleAssets(e.pkgDir, e.packageId, e.assetRefs)
    if (assets) e.assets = assets
    return {
      packageId: e.packageId,
      version: e.version,
      title: e.title,
      sha256: e.sha256,
      ...(e.assets ? { assets: e.assets } : {}),
    }
  }),
}

for (const e of entries) {
  writeFileSync(join(DIST_DIR, `${e.packageId}.json`), (e as DistEntry & { _text: string })._text)
}
writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2) + '\n')

const assetPkgs = entries.filter((e) => e.assets).length
console.log(`✅ content-dist 生成完毕：${entries.length} 个包${skipped ? `（另跳过 ${skipped} 个非包文件）` : ''}`)
console.log(`   目录 updatedAt: ${catalog.updatedAt}${assetPkgs ? `，其中 ${assetPkgs} 个包带离线资产归档` : ''}`)
if (force && stale.length > 0) {
  console.warn(`⚠️ --force 越过了 ${stale.length} 个"内容变了版本没升"的包（本次不会推给家庭端）`)
}
