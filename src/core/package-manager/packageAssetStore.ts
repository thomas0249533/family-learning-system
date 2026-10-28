// =====================================================================
// packageAssetStore · 学习包图片资产的**存储层**（V2.12）
// ---------------------------------------------------------------------
// 需求：思维训练里的「数图形」类题目，离开配图就是一个无法作答的句子。
// 本模块负责后半段：解压出来的字节 → IndexedDB Blob → 渲染组件取用。
// 前半段（路径合法吗、扩展名放行吗、多大算超限）在 `./assetPath`，那里零依赖。
//
// 四条铁律：
//   1. **Blob 只存一处**（IndexedDB）。不产生 objectURL、不做全局 URL 缓存 ——
//      任何"第二处引用"都意味着忘记 revoke 的风险。URL 由渲染组件临时创建、卸载即释放。
//   2. **资产是包级不是档案级**：兄弟档案共用同一份配图，不进备份、不按 profileId 分片
//      （与 `packages` 表同边界）。
//   3. **引用用路径不用 ID**：包 JSON 里写 `assets/shape-01.png`，导入不改写题目内容，
//      重复导入即按 `[packageId+path]` 覆盖，天然幂等。
//   4. **取不到图不抛错**：返回 `null`，由渲染层静默降级 —— 缺图是内容问题，不是程序故障。
//
// 可测性：`dao` 可注入（与 `customSoundStore` 同一种做法），
// 校验/替换/统计这些逻辑不需要真的开 IndexedDB。
// =====================================================================
import { db, type PackageAssetRecord } from '@/db'
import {
  extOfPath,
  mimeOfPath,
  normalizeAssetPath,
  sanitizeSvg,
  validateAsset,
  type AssetRejectReason,
} from './assetPath'

// 纯规则统一从 assetPath 转出：调用方只需要记住一个模块名
export {
  ASSET_MIME_BY_EXT,
  ASSET_REJECT_TEXT,
  MAX_ASSET_BYTES,
  MAX_ASSETS_TOTAL_BYTES,
  extOfPath,
  formatBytes,
  isSupportedAssetPath,
  mimeOfPath,
  normalizeAssetPath,
  parseAssetPath,
  sanitizeSvg,
  validateAsset,
} from './assetPath'
export type { AssetRejectReason } from './assetPath'

/** 资产列表用的轻量元信息（**不含 blob**，列表/统计不该把图片读进内存） */
export interface PackageAssetMeta {
  path: string
  mime: string
  size: number
}

export interface PackageAssetDao {
  listByPackage(packageId: string): Promise<PackageAssetRecord[]>
  get(packageId: string, path: string): Promise<PackageAssetRecord | undefined>
  put(row: PackageAssetRecord): Promise<void>
  removeByPackage(packageId: string): Promise<void>
}

/** 生产实现：Dexie（表见 db/index.ts 的 version(7)） */
export const dexieAssetDao: PackageAssetDao = {
  listByPackage: (packageId) =>
    db.packageAssets.where('packageId').equals(packageId).toArray(),
  get: (packageId, path) =>
    db.packageAssets.where('[packageId+path]').equals([packageId, path]).first(),
  put: async (row) => {
    await db.packageAssets.put(row)
  },
  removeByPackage: async (packageId) => {
    await db.packageAssets.where('packageId').equals(packageId).delete()
  },
}

/** 待入库的一份资产（导入器解压后产出） */
export interface IncomingAsset {
  path: string
  bytes: Uint8Array
}

export interface SaveAssetsResult {
  saved: number
  rejected: { path: string; reason: AssetRejectReason }[]
  totalBytes: number
}

/**
 * 把一份资产做成可写入的记录。
 *
 * SVG 走 `sanitizeSvg` 再转 UTF-8；其余格式原样存字节。
 * 这里不校验（校验在 `planPackageAssets` 里统一做），只负责构造。
 */
function toRecord(
  packageId: string,
  path: string,
  bytes: Uint8Array,
  createdAt: string,
): PackageAssetRecord {
  const mime = mimeOfPath(path)
  const isSvg = extOfPath(path) === '.svg'
  let blob: Blob
  if (isSvg) {
    const text = new TextDecoder('utf-8').decode(bytes)
    blob = new Blob([sanitizeSvg(text)], { type: mime })
  } else {
    blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  }
  return {
    packageId,
    path,
    mime,
    size: bytes.byteLength,
    blob,
    createdAt,
  }
}

/**
 * 计算「这次导入会写入哪些资产」——**纯逻辑，不落库**。
 *
 * 拆出来是为了让导入器能把「计划」放进 Dexie 事务里执行：
 * 事务内不能再做 await 之外的复杂判断，而这里的去重/校验/限额都是纯计算。
 */
export function planPackageAssets(
  packageId: string,
  assets: IncomingAsset[],
  now: Date = new Date(),
): { rows: PackageAssetRecord[]; rejected: { path: string; reason: AssetRejectReason }[]; totalBytes: number } {
  const createdAt = now.toISOString()
  const rejected: { path: string; reason: AssetRejectReason }[] = []
  const rows: PackageAssetRecord[] = []
  let totalBytes = 0

  // 包内去重：同一路径出现两次时保留后出现的那份
  const byPath = new Map<string, Uint8Array>()
  for (const a of assets) {
    const path = normalizeAssetPath(a.path)
    if (path === null) {
      rejected.push({ path: String(a.path), reason: 'bad-path' })
      continue
    }
    const reason = validateAsset({ path, size: a.bytes?.byteLength ?? 0 })
    if (reason) {
      rejected.push({ path, reason })
      continue
    }
    byPath.set(path, a.bytes)
  }

  for (const [path, bytes] of byPath) {
    rows.push(toRecord(packageId, path, bytes, createdAt))
    totalBytes += bytes.byteLength
  }

  return { rows, rejected, totalBytes }
}

/**
 * 整体替换某个包的资产。
 *
 * **先删后写**而不是逐条 upsert：重导入时应以 zip 为准，zip 里删掉的图必须消失，
 * 否则会留下一张永远没人引用的孤儿图（占配额且查不出问题）。
 *
 * 失败的条目只收集不抛错 —— 导入成功的包不该因为一张图超限而整体回滚，
 * 由调用方把 `rejected` 变成一条 warning 给用户看。
 */
export async function replacePackageAssets(
  packageId: string,
  assets: IncomingAsset[],
  opts: { dao?: PackageAssetDao; now?: Date } = {},
): Promise<SaveAssetsResult> {
  const dao = opts.dao ?? dexieAssetDao
  const plan = planPackageAssets(packageId, assets, opts.now ?? new Date())

  await dao.removeByPackage(packageId)
  for (const row of plan.rows) {
    await dao.put(row)
  }

  return { saved: plan.rows.length, rejected: plan.rejected, totalBytes: plan.totalBytes }
}

/** 某个包已存资产的总字节数（配额提示用；只读元信息，不碰 blob） */
export async function packageAssetBytes(
  packageId: string,
  opts: { dao?: PackageAssetDao } = {},
): Promise<number> {
  const dao = opts.dao ?? dexieAssetDao
  const rows = await dao.listByPackage(packageId)
  return rows.reduce((sum, r) => sum + (r.size ?? 0), 0)
}

/** 删除某个包的全部资产（删包 / 清空时调用） */
export async function deletePackageAssets(
  packageId: string,
  opts: { dao?: PackageAssetDao } = {},
): Promise<void> {
  const dao = opts.dao ?? dexieAssetDao
  await dao.removeByPackage(packageId)
}

/**
 * 取一张图的原始 Blob。**取不到返回 null，不抛错** —— 渲染层据此静默降级，
 * 而不是让一道题把整页打崩。
 */
export async function loadAssetBlob(
  packageId: string,
  path: string,
  opts: { dao?: PackageAssetDao } = {},
): Promise<Blob | null> {
  const normalized = normalizeAssetPath(path)
  if (normalized === null) return null
  const dao = opts.dao ?? dexieAssetDao
  const row = await dao.get(packageId, normalized)
  return row?.blob ?? null
}
