/**
 * 二维码分发 · 防御性解析（V1.12 Stage G · G3）
 * =====================================================================
 * 与 `qrcode.ts` 同一套白名单口径的解析端。设计立场：
 *
 * - **输入是敌意的**：二维码可能来自任何地方（拍照外传、伪造、篡改），
 *   所以协议白名单（`FamilyLearning://import`）、字段白名单
 *   （`type` / `pkgId` / `checksum` / `url`）、每字段长度上限、charset 白名单、
 *   checksum 复核，五层全过才返回 payload。
 * - **绝不抛裸异常**：一切失败都收敛成 `ParseResult` 的结构化错误对象
 *   （`{ ok: false, error: { code, message } }`），UI 层拿 `code` 分支渲染，
 *   `message` 只进 `{{ }}` 插值 —— **绝不适合 `v-html` / `eval`**。
 * - **字段白名单里没有口令的位置**：就算攻击者构造了带 `password` 字段的
 *   二维码，也会在「未知字段」一层被拒绝；本模块不读取任何密钥源。
 */

import { SHARE_TYPE, SHARE_URI_PREFIX, checksumOf, type SharePayload } from './qrcode'
export type { SharePayload } from './qrcode'

/** 协议白名单（scheme 层）：主协议之外只认 http(s)，作为 `url` 字段值的合法性前提 */
const ALLOWED_URL_SCHEMES = ['http://', 'https://'] as const

/** 各字段长度上限（字符数）。总长上限覆盖一切字段叠加。 */
const LIMITS = {
  total: 1024,
  pkgId: 128,
  url: 512,
} as const

/** pkgId 字符白名单：字母数字与 `.` `_` `:` `-`（与 buildShareString 同一口径） */
const PKG_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/** checksum 形态：8 位小写 hex */
const CHECKSUM_PATTERN = /^[0-9a-f]{8}$/

/** 结构化错误码（UI 按 code 分支渲染文案） */
export type ParseErrorCode =
  | 'empty-input' // 空串 / 空白
  | 'too-long' // 超过总长上限
  | 'bad-protocol' // 协议白名单外（伪协议、大小写变体、javascript: 等）
  | 'unknown-field' // 字段白名单外
  | 'duplicate-field' // 重复字段
  | 'missing-field' // 缺必填字段
  | 'bad-type' // type 不在白名单
  | 'bad-pkg-id' // pkgId 形态非法（charset / 超长）
  | 'bad-checksum-format' // checksum 不是 8 位 hex
  | 'checksum-mismatch' // checksum 与重算值不符（篡改 / 手输错）
  | 'bad-url' // url 形态非法（scheme / 凭据 / 控制字符 / 超长）

export interface ParseError {
  code: ParseErrorCode
  /** 人类可读说明。只进文本插值，绝不进 v-html。 */
  message: string
}

export type ParseResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; error: ParseError }

function fail(code: ParseErrorCode, message: string): ParseResult {
  return { ok: false, error: { code, message } }
}

/**
 * 解析分享串（完整 URI 或「后缀码」）。
 *
 * 接受两种输入（扫码得到的是前者，BarcodeDetector 不可用时家长手输的是后者）：
 *   1. `FamilyLearning://import?type=pkg&pkgId=...&checksum=...[&url=...]`
 *   2. `type=pkg&pkgId=...&checksum=...[&url=...]`（后缀码，即 `?` 之后的 query 部分）
 *
 * query 解析刻意**手写**而非 `new URL()`：URL API 会做静默归一化（补端口、
 * 丢弃重复键取首个等），会掩盖「重复字段」「伪协议」这类必须报错的形态。
 */
export function parseShareString(raw: unknown): ParseResult {
  try {
    // ---- 第 0 层：输入形态 ----
    if (typeof raw !== 'string') return fail('empty-input', '分享码为空')
    const input = raw.trim()
    if (input.length === 0) return fail('empty-input', '分享码为空')
    if (input.length > LIMITS.total) {
      return fail('too-long', `分享码超过 ${LIMITS.total} 字符上限`)
    }

    // ---- 第 1 层：协议白名单 ----
    let query: string
    if (input.startsWith(SHARE_URI_PREFIX)) {
      query = input.slice(SHARE_URI_PREFIX.length)
    } else if (/^[A-Za-z0-9_-]+=/.test(input) && !input.includes('://')) {
      // 后缀码手输（不含协议头的 key=value 串；带 '://' 的一律走协议白名单拒绝）
      query = input
    } else {
      // 大小写变体 / 伪协议 / javascript: / data: 等一律在此拒绝
      // （先识别"就差一个大小写"给出更准的文案，但结果同样是拒绝）
      const lowered = input.toLowerCase()
      const loweredPrefix = SHARE_URI_PREFIX.toLowerCase()
      if (lowered.startsWith(loweredPrefix) || lowered.startsWith('type=')) {
        return fail('bad-protocol', '协议头大小写不符（分享码可能被手抄错）')
      }
      return fail('bad-protocol', `不是本应用生成的分享码（协议白名单外）`)
    }
    if (query.length === 0) return fail('missing-field', '缺少字段：type / pkgId / checksum')
    if (/[#\s]/.test(query)) return fail('bad-protocol', '分享码含有非法的分隔或空白字符')

    // ---- 第 2~3 层：字段白名单 + 重复检测（手写切分，不信 URL API 的静默归一化）----
    const seen = new Map<string, string[]>()
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      if (key === '') return fail('unknown-field', '存在空字段名')
      const list = seen.get(key) ?? []
      list.push(value)
      seen.set(key, list)
    }

    const ALLOWED_FIELDS = new Set(['type', 'pkgId', 'checksum', 'url'])
    for (const key of seen.keys()) {
      if (!ALLOWED_FIELDS.has(key)) {
        return fail('unknown-field', `未知字段：${key}（字段白名单外，已拒绝）`)
      }
      if (seen.get(key)!.length > 1) {
        return fail('duplicate-field', `重复字段：${key}`)
      }
    }

    // ---- 第 4 层：必填字段 + 解码 ----
    // 只做 %XX 解码（非法序列由 decodeURIComponent 抛错、外层收敛）；
    // 字符合法性交给各字段自己的白名单（pkgId charset / url 规则）把关。
    const decode = (v: string): string => decodeURIComponent(v)

    const typeRaw = seen.get('type')?.[0]
    const pkgIdRaw = seen.get('pkgId')?.[0]
    const checksumRaw = seen.get('checksum')?.[0]
    const urlRaw = seen.get('url')?.[0]
    if (typeRaw === undefined || pkgIdRaw === undefined || checksumRaw === undefined) {
      return fail('missing-field', '缺少字段：type / pkgId / checksum')
    }

    let pkgId: string
    let url = ''
    try {
      if (typeRaw !== SHARE_TYPE) return fail('bad-type', `类型不在白名单：${typeRaw}`)
      pkgId = decode(pkgIdRaw)
      if (urlRaw !== undefined) url = decode(urlRaw)
    } catch {
      return fail('bad-protocol', '字段值含有无法解码的字符序列')
    }

    // ---- 第 5 层：逐字段形态校验 ----
    if (!PKG_ID_PATTERN.test(pkgId)) {
      return fail('bad-pkg-id', `包 id 形态非法（限 1~${LIMITS.pkgId} 位字母数字与 . _ : -）`)
    }

    const checksum = decode(checksumRaw)
    if (!CHECKSUM_PATTERN.test(checksum)) {
      return fail('bad-checksum-format', '校验和应为 8 位十六进制')
    }

    if (urlRaw !== undefined) {
      if (url.length > LIMITS.url) {
        return fail('bad-url', `url 超过 ${LIMITS.url} 字符上限`)
      }
      const loweredUrl = url.toLowerCase()
      if (!ALLOWED_URL_SCHEMES.some((s) => loweredUrl.startsWith(s))) {
        return fail('bad-url', 'url 只允许 http(s) 协议')
      }
      // 控制字符（含 URL API 会静默剥离的换行制表符）一律拒绝；
      // 空格放行（new URL 会归一成 %20，不影响安全与解析）
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(url)) {
        return fail('bad-url', 'url 含有控制字符')
      }
      try {
        const parsed = new URL(url)
        if (parsed.username !== '' || parsed.password !== '' || url.includes('@')) {
          // 凭据哪怕只有账号也不从二维码带：二维码会被拍照外传，
          // 账号+口令形态的 userinfo 更是绝对禁止
          return fail('bad-url', 'url 不得携带任何凭据（userinfo）')
        }
      } catch {
        return fail('bad-url', 'url 不是合法的绝对地址')
      }
    }

    // ---- 第 6 层：checksum 复核（与 qrcode.ts 同一函数，口径唯一）----
    const expected = checksumOf(SHARE_TYPE, pkgId, url)
    if (checksum !== expected) {
      return fail('checksum-mismatch', '校验和不符：分享码可能被篡改或手输有误')
    }

    const payload: SharePayload = { type: SHARE_TYPE, packageId: pkgId, checksum }
    if (url) payload.url = url
    return { ok: true, payload }
  } catch {
    // decodeURIComponent 的非法 % 序列等一切意外，都收敛成结构化错误
    return fail('bad-protocol', '分享码格式无法解析')
  }
}
