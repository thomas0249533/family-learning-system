/**
 * 二维码分发 · 载荷组装与渲染（V1.12 Stage G · G3）
 * =====================================================================
 * 职责链：`SharePayload` → `buildShareString()` 生成
 * `FamilyLearning://import?...` 字符串 → vendor `QrCode.encodeText` 出矩阵
 * → `drawQrToCanvas()` 画到 Canvas。解析端在 `parser.ts`（同一套白名单口径）。
 *
 * ## 安全红线（docs/plan/v1.12-stage-g.md §0）
 * 二维码会被**拍照外传**，所以载荷字段白名单里**没有口令 / API Key 的位置**：
 * 只有 `type`（类型，当前仅 `pkg`）、`pkgId`（包 id）、`checksum`（校验和）、
 * `url`（可选，局域网 / WebDAV **地址**，不含任何凭据）。本模块不接触
 * `secretCipher` / WebDAV 口令等任何密钥源。
 *
 * ## 校验和口径
 * 仓库既有代码没有通用校验和（backup 的 `mismatch` 是结构校验，不是值校验），
 * 这里定为 **FNV-1a 32 位**：纯函数、无依赖、确定性、跨语言可复刻，
 * 对 `type|pkgId|url` 规范串计算，输出 8 位小写 hex。`parser.ts` 复用同一函数，
 * 两端口径唯一。
 */

import { QrCode } from './vendor/qrcodegen'

/** 协议头（解析端做严格大小写匹配 —— 伪协议 / 大小写变体一律拒绝） */
export const SHARE_SCHEME = 'FamilyLearning'

/** 协议路径（当前只有 import 一个动作） */
export const SHARE_PATH = 'import'

/** 载荷类型白名单：当前只有「学习包分享」一种 */
export const SHARE_TYPE = 'pkg' as const

/** 完整 URI 前缀：`FamilyLearning://import?` */
export const SHARE_URI_PREFIX = `${SHARE_SCHEME}://${SHARE_PATH}?`

/**
 * 校验和覆盖的字段规范串。三个字段用 `|` 连接，`url` 缺省参与计算的是空串 ——
 * 「没有 url」和「url 为空串」在载荷里不可区分，校验和自然也不区分。
 */
function canonicalString(type: string, packageId: string, url: string): string {
  return `${type}|${packageId}|${url}`
}

/**
 * FNV-1a 32 位哈希（小写 8 位 hex）。
 * 纯函数；只用于防「扫错包 / 手输错码」的意外损坏检测，
 * **不是**密码学校验（二维码本来就会拍照外传，没有秘密可保护）。
 */
export function checksumOf(type: string, packageId: string, url = ''): string {
  const text = canonicalString(type, packageId, url)
  // 2166136261 = 0x811c9dc5（FNV offset basis）；16777619 = 0x01000193（FNV prime）
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    // Math.imul 保证 32 位乘法不丢精度，>>>0 归一成无符号
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 二维码载荷（只含白名单字段，结构上就放不进口令） */
export interface SharePayload {
  type: typeof SHARE_TYPE
  /** 学习包 id（导入端用它核对本地是否已有该包） */
  packageId: string
  /** FNV-1a 校验和（8 位 hex），见 `checksumOf` */
  checksum: string
  /** 可选：包文件的局域网 / WebDAV 地址（仅地址，无凭据） */
  url?: string
}

/** 组装入参：只有调用方真正掌握的两个字段，checksum 由本模块计算 */
export interface ShareInput {
  packageId: string
  url?: string
}

/**
 * 组装 `FamilyLearning://import?...` 分享串。
 *
 * 参数值经 `encodeURIComponent` 编码，`&` `=` `%` 等结构字符不会从值里漏出来 ——
 * 这是解析端「按 & 切分」能安全工作的前提。packageId 不合法时直接抛
 * `RangeError`（组装端是自家 UI 传参，属于编程错误而非用户输入）。
 */
export function buildShareString(input: ShareInput): string {
  const packageId = input.packageId
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(packageId)) {
    throw new RangeError(`packageId 不合法：${packageId.slice(0, 32)}`)
  }
  const url = input.url ?? ''
  if (url.length > 512) {
    throw new RangeError('url 超过 512 字符上限')
  }
  // 刻意不用 URLSearchParams（它把空格编成 '+'，解析端就得带 form-urlencoded 口径）；
  // 手动拼接 + encodeURIComponent（空格 → %20），组装/解析只依赖一个编码口径。
  const parts: string[] = [
    `type=${encodeURIComponent(SHARE_TYPE)}`,
    `pkgId=${encodeURIComponent(packageId)}`,
    `checksum=${checksumOf(SHARE_TYPE, packageId, url)}`,
  ]
  if (url) parts.push(`url=${encodeURIComponent(url)}`)
  return SHARE_URI_PREFIX + parts.join('&')
}

/**
 * 把任意文本画成二维码 Canvas。
 *
 * - `size`：Canvas 的 CSS 边长（正方形），内部按设备像素比放大保证清晰；
 * - 白底黑块是**扫码对比度**要求（相机 + 反差对焦的需要），与主题无关，
 *   固有色写在 canvas 像素里，不进 DOM 样式（不适用 check:hex —— 它不扫 src/core）；
 * - `getContext('2d')` 返回 null（如 jsdom 无 canvas 后端）时抛 `Error`，
 *   调用方（UI 层）负责兜底提示，解析正确性不依赖本函数。
 */
export function drawQrToCanvas(canvas: HTMLCanvasElement, text: string, size: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D 上下文不可用，无法渲染二维码')

  const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM)
  const quietZone = 4 // QR 规范建议的静区（模块数）
  const moduleCount = qr.size + quietZone * 2

  // 按设备像素比放大，保证高分屏下模块边缘锐利（拍照扫描的最低要求）
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const pxSize = Math.max(1, Math.round(size * dpr))
  canvas.width = pxSize
  canvas.height = pxSize
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pxSize, pxSize)
  ctx.fillStyle = '#000000'

  const scale = pxSize / moduleCount
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.getModule(x, y)) continue
      // 静区偏移 + 向下取整避免模块间漏缝；最右/最下一列延伸到画布边缘
      const px = Math.floor((x + quietZone) * scale)
      const py = Math.floor((y + quietZone) * scale)
      const pw = x === qr.size - 1 ? pxSize - px : Math.ceil(scale)
      const ph = y === qr.size - 1 ? pxSize - py : Math.ceil(scale)
      ctx.fillRect(px, py, pw, ph)
    }
  }
}
