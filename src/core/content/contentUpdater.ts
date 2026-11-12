/**
 * content/contentUpdater.ts —— 题库「检查更新 + 应用更新」
 *
 * 契约（与 V1.3 进度模型对齐，一条都不能破）：
 *   1. 进度绑定在 (packageId, knowledgePointId) 上 —— 更新只是
 *      `db.packages.put()` 按 packageId 覆盖，**绝不碰 db.progress /
 *      db.mistakes**。作者改错别字、加题，孩子已产生的进度自动接续。
 *   2. 只更新**本地已安装**的包。目录里没装的包不偷偷拉进来 ——
 *      「发现新包」是另一个交互，混进更新流程等于替家长做决定。
 *      V3.1.6 起 `checkForUpdates` 会把未安装的包列进 `installable` 供 UI 展示，
 *      但**安装仍必须由家长显式勾选后调用 `installNewPackages`**，
 *      单测钉死「检查不会写入任何新包」。
 *   3. 下载内容必须过 `normalizePackage` 全量校验 + sha256 核对，
 *      校验失败拒写入 —— 宁可"更新失败"，不要"半套新题库"。
 *   4. 写入后走 `afterPackagesChanged()`（与手动导入同一个收尾：
 *      归属索引失效 + 进度重归因 + 今日队列失效），副作用只有一个实现。
 */

import { db } from '@/db'
import { normalizePackage } from '@core/importer/normalizePackage'
import { afterPackagesChanged } from '@core/importer/importService'
import { compareVersions, normalizeVersion } from './version'
import {
  CATALOG_FILE,
  fetchTextWithMirrors,
  fetchArrayBufferWithMirrors,
  sha256Hex,
  sha256HexBytes,
  type FetchLike,
} from './mirrors'
import { replacePackageAssets, type IncomingAsset } from '@core/package-manager/packageAssetStore'
import { unzipSync } from 'fflate'

export interface CatalogPackage {
  packageId: string
  version: string
  title: string
  sha256: string
  /** V3.1.8 · 该包的离线资产归档（音频/图片），随更新一并分发 */
  assets?: { file: string; sha256: string }
}

export interface ContentCatalog {
  updatedAt: string
  packages: CatalogPackage[]
}

export interface UpdatablePackage {
  packageId: string
  title: string
  localVersion: string
  remoteVersion: string
  sha256: string
  /** V3.1.8 · 随包分发的离线资产归档（若有） */
  assets?: { file: string; sha256: string }
}

export interface CheckOutcome {
  ok: boolean
  /** 目录里全部包数（含未安装） */
  total: number
  updatable: UpdatablePackage[]
  /** V3.1.6 · 目录里有、本地未安装的新包（只展示，不自动安装） */
  installable: CatalogPackage[]
  /** ok=false 时的可读原因（网络/目录格式） */
  error?: string
}

export interface ApplyOutcome {
  updated: string[]
  failed: { packageId: string; reason: string }[]
  /** V3.1.8 · 包本身更新成功、但离线资产未同步（网络/校验失败）的非阻断告警 */
  warnings?: { packageId: string; message: string }[]
}

/** 解析目录文本 → 结构化目录；形状不对一律抛错（拒收脏目录） */
export function parseCatalog(text: string): ContentCatalog {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('目录不是合法 JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('目录结构不对：顶层应为对象')
  }
  const { packages } = raw as { packages?: unknown }
  if (!Array.isArray(packages)) throw new Error('目录结构不对：packages 应为数组')
  const seen = new Set<string>()
  const list: CatalogPackage[] = packages.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`目录第 ${i} 项不是对象`)
    const pkg = p as Record<string, unknown>
    if (typeof pkg.packageId !== 'string' || !pkg.packageId) {
      throw new Error(`目录第 ${i} 项缺 packageId`)
    }
    if (typeof pkg.version !== 'string' || !pkg.version) {
      throw new Error(`目录第 ${i} 项（${pkg.packageId}）缺 version`)
    }
    if (typeof pkg.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pkg.sha256)) {
      throw new Error(`目录第 ${i} 项（${pkg.packageId}）sha256 不合法`)
    }
    if (seen.has(pkg.packageId)) throw new Error(`目录里 packageId 重复: ${pkg.packageId}`)
    seen.add(pkg.packageId)
    // V3.1.8 · 资产归档是可选字段：形状不对一律忽略，绝不把脏数据带进校验池
    const rawAssets = (pkg as Record<string, unknown>).assets
    const assets =
      rawAssets && typeof rawAssets === 'object' &&
      typeof (rawAssets as any).file === 'string' && typeof (rawAssets as any).sha256 === 'string'
        ? { file: (rawAssets as any).file as string, sha256: (rawAssets as any).sha256 as string }
        : undefined
    return {
      packageId: pkg.packageId,
      version: pkg.version,
      title: typeof pkg.title === 'string' ? pkg.title : pkg.packageId,
      sha256: pkg.sha256,
      assets,
    }
  })
  return { updatedAt: String((raw as { updatedAt?: unknown }).updatedAt ?? ''), packages: list }
}

/** 比对目录与本地包：返回**已安装且目录版本更新**的包列表 */
export async function checkForUpdates(fetcher: FetchLike): Promise<CheckOutcome> {
  let catalog: ContentCatalog
  try {
    catalog = parseCatalog(await fetchTextWithMirrors(CATALOG_FILE, fetcher))
  } catch (e) {
    return {
      ok: false, total: 0, updatable: [], installable: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const localRows = await db.packages.toArray()
  const byId = new Map(localRows.map((p) => [p.packageId, p]))

  const updatable: UpdatablePackage[] = []
  const installable: CatalogPackage[] = []
  for (const entry of catalog.packages) {
    const local = byId.get(entry.packageId)
    if (!local) {
      // V3.1.6：未安装的包单独列出，交给家长勾选；检查阶段绝不写入。
      installable.push(entry)
      continue
    }
    const localVersion = normalizeVersion(local.manifest?.version)
    if (compareVersions(entry.version, localVersion) > 0) {
      updatable.push({
        packageId: entry.packageId,
        title: entry.title,
        localVersion,
        remoteVersion: normalizeVersion(entry.version),
        sha256: entry.sha256,
        assets: entry.assets,
      })
    }
  }
  return { ok: true, total: catalog.packages.length, updatable, installable }
}

type WriteResult = { ok: true; packageId: string; warning?: string } | { ok: false; reason: string }

/** 下载 → sha256 核对 → JSON 解析（不写库）。单包更新与批量安装共用 */
async function fetchVerified(
  item: { packageId: string; sha256: string },
  fetcher: FetchLike
): Promise<{ ok: true; raw: unknown } | { ok: false; reason: string }> {
  let text: string
  try {
    text = await fetchTextWithMirrors(`${item.packageId}.json`, fetcher)
  } catch (e) {
    return { ok: false, reason: `下载失败：${e instanceof Error ? e.message : String(e)}` }
  }

  // 完整性：内容与目录登记的 sha256 不一致 → 拒收（目录与文件错位 / 被篡改）
  const actual = await sha256Hex(text)
  if (actual !== item.sha256) {
    return { ok: false, reason: `内容校验失败（sha256 不符），已放弃写入` }
  }

  try {
    return { ok: true, raw: JSON.parse(text) }
  } catch {
    return { ok: false, reason: '下载内容不是合法 JSON' }
  }
}

/** 收集一个原始包里声明的知识点 id（用于跨包引用校验池） */
function collectKpIds(raw: unknown, sink: Set<string>): void {
  const kps = (raw as any)?.knowledgePoints
  if (!Array.isArray(kps)) return
  for (const kp of kps) if (kp?.id) sink.add(kp.id)
}

/**
 * 校验 → 覆盖写入 → 统一收尾（不含下载）。
 *
 * 跨包知识点引用池：special/sprint/daily 包的题目会合法引用「已安装的 unit 包」
 * 里的知识点（如 `unit-math-4-up-rjb-p1::kp-num-001`）。ZIP 整批导入走
 * `externalKpIds` 批次池放行；在线更新是逐包校验，必须把「已安装全部包的 KP」
 * 喂进校验池，否则合法跨包引用会被 E009 误杀（见 normalizePackage.ts /
 * generateWeakpoints.ts 注释）。批量安装新包时还要把**本批其它待装包**的 KP
 * 一起喂进去（extraKpIds），否则先写入的包无法引用后写入包的知识点。
 * 注意：只用于校验 idExists，不写入，不影响进度。
 */
async function normalizeAndWrite(
  raw: unknown,
  expectedId: string,
  extraKpIds: Set<string> = new Set()
): Promise<WriteResult> {
  const installedRows = await db.packages.toArray()
  const externalKpIds = new Set<string>(extraKpIds)
  for (const row of installedRows) collectKpIds(row, externalKpIds)

  const { package: normalized, errors } = normalizePackage(raw, { externalKpIds })
  if (errors.length > 0 || !normalized) {
    return {
      ok: false,
      reason: `包校验未通过：${errors[0]?.code ?? 'E999'} ${errors[0]?.message ?? '规范化失败'}`,
    }
  }
  if (normalized.manifest.packageId !== expectedId) {
    return {
      ok: false,
      reason: `包身份不符：期望 ${expectedId}，实际 ${normalized.manifest.packageId}`,
    }
  }

  try {
    await db.packages.put(normalized)
  } catch (e) {
    return { ok: false, reason: `写入失败：${e instanceof Error ? e.message : String(e)}` }
  }
  await afterPackagesChanged()
  return { ok: true, packageId: expectedId }
}

/**
 * V3.1.8 · 把目录声明的离线资产归档（音频/图片）下载、校验、解压并写入 db.packageAssets。
 *
 * 为什么是「每包一个 zip」而不是把几百个 mp3 逐个放进分发目录：逐文件下载会产生
 * 600+ 次 HTTP 请求，任一抖动都难收敛；打成单归档后每包只下 1 个文件，镜像链重试
 * 也只针对这一个文件。解压复用 importService 已验证过的 fflate 路径；写入走
 * `replacePackageAssets`（先删后写，以目录为准，孤儿资产自动清除）。
 *
 * 资产是「加分项」：包 JSON 本身已写入成功，即使资产分发失败也只告警不回滚包更新
 * （孩子退化为机械 TTS，与 3.1.7 行为一致，不会比不更新更糟）。
 */
async function applyPackageAssets(
  item: { packageId: string; assets?: { file: string; sha256: string } },
  fetcher: FetchLike,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!item.assets) return { ok: true }
  let bytes: Uint8Array
  try {
    bytes = await fetchArrayBufferWithMirrors(item.assets.file, fetcher)
  } catch (e) {
    return { ok: false, reason: `离线资产下载失败：${e instanceof Error ? e.message : String(e)}` }
  }

  // 完整性：归档 sha256 与目录登记不符 → 拒写入（防损坏/被篡改）
  const actual = await sha256HexBytes(bytes)
  if (actual !== item.assets.sha256) {
    return { ok: false, reason: '离线资产校验失败（sha256 不符），已放弃写入' }
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (e) {
    return { ok: false, reason: `离线资产解压失败：${e instanceof Error ? e.message : String(e)}` }
  }

  const incoming: IncomingAsset[] = []
  for (const [path, data] of Object.entries(files)) {
    if (!path.startsWith('assets/')) continue // 只收 assets/ 前缀，归档里的目录条目等一律跳过
    if (!data || data.byteLength === 0) continue
    incoming.push({ path, bytes: data })
  }
  if (incoming.length === 0) return { ok: false, reason: '离线资产归档为空' }

  const result = await replacePackageAssets(item.packageId, incoming)
  if (result.rejected.length > 0) {
    return { ok: false, reason: `有 ${result.rejected.length} 个离线资产被拒（如超过单文件 8MB 上限）` }
  }
  return { ok: true }
}

/** 单包更新：下载 → sha256 核对 → 校验 → 覆盖写入 → 统一收尾 → V3.1.8 同步离线资产 */
export async function applyUpdate(
  item: UpdatablePackage,
  fetcher: FetchLike
): Promise<WriteResult> {
  const verified = await fetchVerified(item, fetcher)
  if (!verified.ok) return { ok: false, reason: verified.reason }
  const written = await normalizeAndWrite(verified.raw, item.packageId)
  if (!written.ok) return written
  // V3.1.8 · 包 JSON 已写入，再尝试把离线音频/图片资产一并分发下去
  if (item.assets) {
    const a = await applyPackageAssets(item, fetcher)
    if (!a.ok) {
      // 资产失败不回滚包更新（孩子退化为机械 TTS），但把原因带回，UI 可提示
      console.warn(`[content-updater] ${item.packageId} 包已更新，但离线资产未同步：${a.reason}`)
      return { ok: true, packageId: item.packageId, warning: `包已更新，但离线资产未同步：${a.reason}` }
    }
  }
  return { ok: true, packageId: item.packageId }
}

/**
 * V3.1.6 · 安装家长勾选的新包（目录里有、本地没有）。
 *
 * 两阶段：先把勾选的包**全部**下载并核对 sha256（任何一个坏了都不阻塞其余包），
 * 再从这批包里收集全部知识点 id 作为校验池，最后串行写入。
 * 这样新包之间合法的跨包引用不会被 E009 误杀，且不会写出「半套」新题库。
 */
export async function installNewPackages(
  items: CatalogPackage[],
  fetcher: FetchLike
): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { updated: [], failed: [] }
  const ready: { item: CatalogPackage; raw: unknown }[] = []
  const batchKpIds = new Set<string>()

  for (const item of items) {
    const verified = await fetchVerified(item, fetcher)
    if (!verified.ok) {
      out.failed.push({ packageId: item.packageId, reason: verified.reason })
      continue
    }
    ready.push({ item, raw: verified.raw })
    collectKpIds(verified.raw, batchKpIds)
  }

  for (const { item, raw } of ready) {
    const r = await normalizeAndWrite(raw, item.packageId, batchKpIds)
    if (!r.ok) {
      out.failed.push({ packageId: item.packageId, reason: r.reason })
      continue
    }
    // V3.1.8 · 新包也可能带离线资产（音频/图片），写入后一并分发
    if (item.assets) {
      const a = await applyPackageAssets(item, fetcher)
      if (!a.ok) {
        out.warnings = out.warnings ?? []
        out.warnings.push({ packageId: item.packageId, message: a.reason })
      }
    }
    out.updated.push(item.packageId)
  }
  return out
}

/** 批量更新：逐个串行执行（写库路径必须串行，见 importService 注释） */
export async function applyAllUpdates(
  items: UpdatablePackage[],
  fetcher: FetchLike
): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { updated: [], failed: [] }
  for (const item of items) {
    const r = await applyUpdate(item, fetcher)
    if (r.ok) {
      out.updated.push(r.packageId)
      if (r.warning) {
        out.warnings = out.warnings ?? []
        out.warnings.push({ packageId: item.packageId, message: r.warning })
      }
    } else {
      out.failed.push({ packageId: item.packageId, reason: r.reason })
    }
  }
  return out
}

/**
 * V3.1.7 · 列出「可强制重拉」的已装包。
 *
 * 背景：本地包内容与目录不一致但**版本号相同**时，`checkForUpdates` 的
 * 版本比较会静默跳过，家长点多少次"检查更新"都修不好（残留 `\times` 就是这么来的）。
 * 这里只按 packageId 取交集，不看版本，供家长显式勾选后重下覆盖。
 */
export async function checkRefreshCandidates(
  fetcher: FetchLike
): Promise<{ ok: boolean; items: CatalogPackage[]; error?: string }> {
  let catalog: ContentCatalog
  try {
    catalog = parseCatalog(await fetchTextWithMirrors(CATALOG_FILE, fetcher))
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
  }
  const localRows = await db.packages.toArray()
  const installed = new Set(localRows.map(p => p.packageId))
  return { ok: true, items: catalog.packages.filter(e => installed.has(e.packageId)) }
}

/**
 * 强制重拉：无条件重新下载并覆盖家长勾选的已装包。
 * 复用 `applyUpdate` 的完整链路（sha256 + normalizePackage + afterPackagesChanged），
 * 只是不经过版本比较 —— 这正是"修复"与"更新"的唯一区别。
 */
export async function refreshInstalledPackages(
  items: CatalogPackage[],
  fetcher: FetchLike
): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { updated: [], failed: [] }
  for (const item of items) {
    const r = await applyUpdate({
      packageId: item.packageId,
      title: item.title,
      localVersion: '',
      remoteVersion: normalizeVersion(item.version),
      sha256: item.sha256,
      assets: item.assets,
    }, fetcher)
    if (r.ok) {
      out.updated.push(r.packageId)
      if (r.warning) {
        out.warnings = out.warnings ?? []
        out.warnings.push({ packageId: item.packageId, message: r.warning })
      }
    } else {
      out.failed.push({ packageId: item.packageId, reason: r.reason })
    }
  }
  return out
}
