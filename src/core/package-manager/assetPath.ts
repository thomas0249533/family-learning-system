// =====================================================================
// assetPath · 图片资产的**纯函数**规则（V2.12）
// ---------------------------------------------------------------------
// 为什么单独一个文件：
//   `normalizePackage` 在 **Node（scripts/validate-lpkgset.ts）** 和浏览器（导入器）
//   两侧都会被执行。如果它从 `packageAssetStore` 里拿路径规则，那一 import 就把
//   Dexie / IndexedDB 拉进 Node 进程 —— 校验脚本会在打开数据库时莫名其妙地炸。
//   所以「什么路径合法 / 什么扩展名放行 / 上限多少」这类**没有 IO 的判断**全放这里。
//
// 这里只许出现纯函数与常量，不许 import 任何东西。
// =====================================================================

/** 单张图上限：2MB（300dpi 的线框图形题通常 40~120KB，2MB 已足够宽容） */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024
/** 单包图片总量上限：8MB（超过这个量级说明该换压缩策略，而不是塞进导入包） */
export const MAX_ASSETS_TOTAL_BYTES = 8 * 1024 * 1024

/**
 * 允许的图片扩展名 → mime。
 *
 * **刻意不含 .bmp / .tiff**：体积大且 WebView 支持不一致，转成 png 更省事。
 * **含 .svg**：线框几何图用 SVG 体积小一个数量级，且 `<img src="blob:...">`
 * 加载 SVG 时脚本不执行（规范行为）。仍由 `sanitizeSvg` 兜一道底。
 */
export const ASSET_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/** 资产入库前的一道校验结果：拒绝原因；`null` 表示通过 */
export type AssetRejectReason = 'empty' | 'too-large' | 'unsupported-ext' | 'bad-path'

/**
 * 路径规范化。返回 `null` 表示**非法路径**，调用方必须拒绝这道题。
 *
 * 为什么需要：包 JSON 是外部输入。`../../etc/passwd` 在 IndexedDB 里不会造成
 * 文件系统写入，但会让"同一个文件"存在多种写法（`./a.png` / `a.png` / `assets\a.png`），
 * 导致重复导入时同一张图存成两行、或者取图时匹配不上。
 *
 * 规则：
 *   · 反斜杠统一成正斜杠；
 *   · 去掉开头的 `./` 与 `/`（`/assets/x.png` 与 `assets/x.png` 视为同一张）；
 *   · 折叠重复的 `/`；
 *   · **任何一段出现 `..` 或 `.` 一律拒绝**（不做"解析后仍安全"的宽容判断：
 *     允许越界写法只是给自己留一个想不清的边界）。
 */
export function normalizeAssetPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(/\\/g, '/')
  if (s.length === 0) return null
  s = s.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  s = s.replace(/\/{2,}/g, '/')
  if (s.length === 0) return null
  const segments = s.split('/')
  if (segments.some((seg) => seg === '..' || seg === '.')) return null
  // 结尾是目录（"assets/"）不是文件
  if (segments[segments.length - 1] === '') return null
  return s
}

/** 取扩展名（小写，含点）；无扩展名返回 `''` */
export function extOfPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i).toLowerCase()
}

/** 该路径是否是可接受的图片资产（扩展名白名单内） */
export function isSupportedAssetPath(path: string): boolean {
  return extOfPath(path) in ASSET_MIME_BY_EXT
}

/**
 * 按扩展名推断 mime。
 *
 * 只认扩展名，不看 `Content-Type`：zip 里拿不到可靠的 content-type，
 * 与 `validateAudioFile` 按扩展名兜底是同一条理由 —— 宁可相信文件名约定，
 * 也不要依赖一个可能缺失的字段。
 */
export function mimeOfPath(path: string): string {
  return ASSET_MIME_BY_EXT[extOfPath(path)] ?? 'application/octet-stream'
}

/**
 * SVG 兜底清洗。
 *
 * `<img>` 加载的 SVG 不执行脚本，但 `foreignObject` 可以嵌 HTML 并保留超链接，
 * 打印/导出时行为不可控。这里把它们整体剥掉 —— 图形题只需要 path/circle/line/text。
 * 非 SVG 不应调用本函数（不碰二进制）。
 */
export function sanitizeSvg(text: string): string {
  return String(text ?? '')
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, '')
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
}

/** 给人看的体积（导入结果里那行小字） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 校验一份待入库资产。
 *
 * 路径**应已由调用方 `normalizeAssetPath` 过一遍**；这里再判一次是防漏 ——
 * 包 JSON 里的 `image` 字段也可能绕过导入器直接进库（编辑器 / 脚本生成）。
 */
export function validateAsset(input: { path: string; size: number }): AssetRejectReason | null {
  if (normalizeAssetPath(input.path) === null) return 'bad-path'
  if (!isSupportedAssetPath(input.path)) return 'unsupported-ext'
  if (!Number.isFinite(input.size) || input.size <= 0) return 'empty'
  if (input.size > MAX_ASSET_BYTES) return 'too-large'
  return null
}

/**
 * 拒绝原因 → 一句人话。
 *
 * 放在这里而不是 UI 里，是因为导入器、校验脚本、将来的编辑器都要说同一句话；
 * 三处各写一份必然会走样（"图片太大" / "超出限制" / "文件超过 2MB"）。
 */
export const ASSET_REJECT_TEXT: Record<AssetRejectReason, string> = {
  empty: '文件是空的',
  'too-large': `单张超过 ${formatBytes(MAX_ASSET_BYTES)}`,
  'unsupported-ext': '格式不支持，只收 png / jpg / jpeg / webp / gif / svg',
  'bad-path': '路径不合法（不能含 .. 或指向目录）',
}

/**
 * 从 ZIP 条目路径解析出「哪个包的哪张图」。
 *
 * ## 为什么资产按包分目录
 * 包 JSON 里引用的是**包内相对路径**（`assets/shape-01.png`），不含 packageId ——
 * 这样一份包 JSON 换个 packageId 仍然自洽（与 `rewriteIdsInPackage` 重写 id 的意图一致）。
 * 于是 ZIP 里必须按包隔离，否则两个包都有 `assets/01.png` 时会互相覆盖：
 *
 * ```
 * packages/<packageId>/assets/shape-01.png   ← 标准结构
 * assets/shape-01.png                        ← 单包 zip 的兼容写法（仅当只有一个包）
 * ```
 *
 * @returns `{ packageId, path }`；`packageId` 为 `''` 表示是 ZIP 根级 `assets/`，
 *          由调用方在「只有一个包」时归属给它。非资产条目返回 `null`。
 */
export function parseAssetPath(raw: string): { packageId: string; path: string } | null {
  const p = String(raw ?? '').replace(/\\/g, '/')
  const m = /^packages\/([^/]+)\/assets\/(.+)$/.exec(p)
  if (m) return { packageId: m[1], path: `assets/${m[2]}` }
  const root = /^assets\/(.+)$/.exec(p)
  if (root) return { packageId: '', path: `assets/${root[1]}` }
  return null
}
