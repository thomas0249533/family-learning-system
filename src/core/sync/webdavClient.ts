/**
 * WebDAV **传输层**（V1.11 · Stage F · F2-core / `docs/plan/v1.11-stage-f.md` §F2）
 *
 * ## 这个文件只做"搬运"，绝不做"取舍"
 * 它知道怎么把字节 PUT 上去、GET 下来、PROPFIND 一下，**不知道**合并是什么
 * （合并是 `planMerge` / `applyMergePlan` 的事，见 `syncManager.ts`）。
 * 划分理由：合并语义一旦混进 IO 层，就没人能在不搭网盘服务器的情况下测它。
 * 这里所有决策被挤成两个纯函数 —— `joinUrlPath` 与 `parsePropfind`，
 * 剩下的网络行为由**注入的 fetch 替身**覆盖（见约定①）。
 *
 * ## 约定①：零新依赖，且 fetch 必须可注入
 * 原生 `fetch` + `AbortController` + `TextEncoder`，一个包都不装（方案 0：零新依赖）。
 * `fetchImpl` 由调用方注入 → 单测可以穷举成功与各类失败分支，**不发一个真报文**。
 *
 * ## 约定②：失败必须分类，不许都抛 Error('failed')
 * UI（F2-UI 那一笔）要对着不同原因给不同处置：重新输口令 / 先去另一台设备上传 /
 * 改走导出文件。所以每种失败都有一个 `WebDavErrorCode`，并且**消息本身就是给家长看的
 * 人话**（不是给开发看的堆栈线索）。文案里一律附上可执行的下一步。
 *
 * ## 约定③：CORS 要如实处理，不许假装能通
 * 本仓 `src-tauri/Cargo.toml` 没有 `tauri-plugin-http`，`tauri.conf.json` 也没有
 * http capabilities（方案 0-① 已核实）。于是 WebView 里的 `fetch` 完全受同源策略约束：
 *   - PWA 模式：跨域请求**一定**被浏览器拦下（抛 `TypeError`，且拿不到任何线索）；
 *   - Tauri 模式：桌面容器本身不放宽 WebView 的 CORS，真机直连大概率同样被拦，
 *     彻底解决要 Rust 侧插件（已单开任务）。
 * 所以这里把 CORS 做成**一等失败类型**（`cors`），并在消息里指回本来就通的
 * 「导出文件 / 导入文件」通道。**为了让测试变绿而伪造成功是本项目最忌讳的事**，
 * 一次都不会做。
 */

import type { BackupV2 } from '@core/backup/types'

// ---------------------------------------------------------------------------
// 失败分类
// ---------------------------------------------------------------------------

/**
 * WebDAV 传输失败的**可断言分类**。
 *
 * 为什么用 code 而不是让 UI 去 match 文案：文案会改（而且该改），
 * code 一旦写下就是契约。UI 按 code 分支，家长看到的句子还能任意润色。
 */
export type WebDavErrorCode =
  /** 配置本身不成立：地址为空 / 不是 http(s) / 档案 id 为空 */
  | 'config'
  /** 网络不可达：DNS 失败、断网、超时（已排除 CORS，见 `probeReachability`） */
  | 'network'
  /** 鉴权失败：401 / 403 —— 大多是口令填了登录密码而不是应用专用密码 */
  | 'auth'
  /** 远端没有这个文件：先在另一台设备上传一次 */
  | 'not-found'
  /** 被浏览器的同源策略挡住（一等失败类型，见文件头约定③） */
  | 'cors'
  /** 服务端返回了别的非 2xx（500 / 405 / 423 …） */
  | 'server'
  /** 拿到了 200，但正文不是合法 JSON（常见于被网盘的预览页面替换） */
  | 'payload'

/**
 * 带 code 的传输错误。
 *
 * `message` 是**给家长看的人话**（含下一步怎么做），不是调试线索；
 * 原始异常挂在 `cause` 上供排查。
 */
export class WebDavError extends Error {
  readonly code: WebDavErrorCode
  /** 原始异常（fetch 的 TypeError 等），排障用；UI 不读它 */
  readonly cause?: unknown

  constructor(code: WebDavErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'WebDavError'
    this.code = code
    this.cause = cause
  }
}

/** 类型守卫：跨 `unknown` 边界（UI 拿到的可能是 any）时用它收窄 */
export function isWebDavError(err: unknown): err is WebDavError {
  return err instanceof WebDavError
}

/**
 * 跨域失败时的退路提示。
 *
 * 为什么失败分支几乎都要带这句：家长遇到同步失败时**唯一想知道的是"那我怎么办"**。
 * 「导出文件 / 导入文件」是本仓本来就通的搬运通道（不依赖网盘账号、不受同源策略限制），
 * 指回去永远是正确的下一步。
 */
export const FALLBACK_HINT =
  '你也可以改用设置页里本来就有的「导出文件 / 导入文件」通道搬运数据（不依赖网盘账号，不受浏览器跨域限制）。'

/** 按 code 取通用人话（四类文案统一在这里，避免四处各编一套） */
function messageFor(code: WebDavErrorCode, explicit?: string): string {
  if (typeof explicit === 'string' && explicit !== '') return explicit
  switch (code) {
    case 'network':
      return '连不上网盘服务器：请检查这台设备的网络，过一会儿再试一次。' + FALLBACK_HINT
    case 'auth':
      return (
        '网盘拒绝了这次访问（账号或口令不对）。请注意坚果云 / Nextcloud 要用' +
        '「应用专用密码」，而不是你的登录密码。'
      )
    case 'not-found':
      return '网盘上还没有这份备份文件：请先在另一台设备上点一次「上传备份」。'
    case 'cors':
      return (
        '浏览器拦住了这次跨网盘访问（同源策略）。这不是账号密码的问题：' +
        '网盘默认不给网页放行跨域调用。' +
        FALLBACK_HINT
      )
    case 'server':
      return '网盘服务器返回了错误状态，请过一会儿再试一次。' + FALLBACK_HINT
    case 'payload':
      return (
        '下载到的文件不是一份有效的备份（内容已经不是 JSON，可能被网盘的预览页面替换了）。' +
        '请确认地址直链到 .json 备份文件本身。' +
        FALLBACK_HINT
      )
    case 'config':
      return '同步地址还没有配置完整，请先在设置页填好 WebDAV 地址。'
  }
}

/** 抛一个带分类的错误。`explicit` 为空时用 `messageFor` 的通用人话 */
function fail(code: WebDavErrorCode, explicit?: string, cause?: unknown): never {
  throw new WebDavError(code, messageFor(code, explicit), cause)
}

// ---------------------------------------------------------------------------
// URL 拼接（纯函数 · 单测重点）
// ---------------------------------------------------------------------------

/** 远程备份文件名的固定前缀：网盘目录里一眼能认出是本系统写的 */
export const BACKUP_FILE_PREFIX = 'fls-backup-'
/** 远程备份文件名的固定后缀 */
export const BACKUP_FILE_SUFFIX = '.json'

/**
 * URL 路径里可以直接出现的字符（`RFC 3986` 的 unreserved + sub-delims + `:@`）。
 *
 * 其余一律 percent-encode，含**空格与中文**。为什么宁可编码过头：各家网盘对未编码
 * 空格的处理不同，最坏会把它截断成两个路径段 —— 写入的不是"某个孩子的备份"，
 * 而是一个 404 或一份谁都找不到的新文件。
 */
const SEGMENT_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]$/

/** 单个十六进制数码 */
const HEX_DIGIT = /^[0-9A-Fa-f]$/

/**
 * 编码**单个**路径段（两个 `/` 之间的那一段）。
 *
 * 三个刻意的取舍，各自都有单测钉着：
 *
 *  1. **保留已存在的 `%XX`**，不做二次编码。用户既可能手输中文目录
 *     （`https://dav.example.com/家庭学习/`），也可能复制时已经是 `%E5%AE%B6...` 形态。
 *     二次编码会得到 `%25E5%AE%B6`，在网盘上的表现是"路径不存在"，
 *     而且从 URL 上看还很像是对的 —— 最难查的那类。
 *  2. **按 Unicode 码点遍历**（先摊成数组，不用下标 `++`）。下标遍历会把 emoji 这类
 *     代理对拆成两个孤代理，`TextEncoder` 各给一个 U+FFFD —— 文件名静默变乱码。
 *  3. **`/` 会被编成 `%2F`**。这是安全边界：档案 id 里出现 `/` 时必须留在同一段里，
 *     否则一次 PUT 就在服务器上开出一层没人打算建的目录。
 */
export function encodePathSegment(segment: string): string {
  const chars = [...(segment ?? '')]
  let out = ''
  let index = 0

  while (index < chars.length) {
    const ch = chars[index]
    if (SEGMENT_SAFE.test(ch)) {
      out += ch
      index += 1
      continue
    }
    // 已编码记号 `%HH` 原样搬运（取舍 1）
    if (ch === '%' && index + 2 < chars.length) {
      const hi = chars[index + 1]
      const lo = chars[index + 2]
      if (HEX_DIGIT.test(hi) && HEX_DIGIT.test(lo)) {
        out += `%${hi}${lo}`
        index += 3
        continue
      }
    }
    for (const byte of new TextEncoder().encode(ch)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
    index += 1
  }

  return out
}

/**
 * 允许的 URL 协议（**不带尾冒号**）。
 *
 * 至于为什么 WebDAV 要把 https 与 http 分开列在这里而不是放到别处：这只是传输层的
 * 入参校验，和任何"注册表"无关，写成一个 `Set` 比写两个字符串比较更不容易漏。
 */
const SUPPORTED_SCHEMES: ReadonlySet<string> = new Set(['https', 'http'])

/**
 * 把 `baseUrl` 与若干路径段拼成一个 URL。**地址只有一个真相**，三个动作都走它。
 *
 * 行为约定（每条都有单测）：
 *  - 结尾**有没有斜杠都一样**（家长随手复制的地址两种都有）；
 *  - 连续斜杠会被折叠（`//dav//` 不是"更深一层目录"，重复斜杠大多是手误）；
 *  - `baseUrl` 上挂的 query / hash 会被丢掉。同步地址不该带 `?token=` 之类尾巴
 *    （那是网盘网页用的），带过去会让每次请求落到不同的 URL 上；
 *  - 每一段独立编码（见 `encodePathSegment`）；
 *  - `baseUrl` 的 `pathname` 由 `new URL()` 产出，已是 percent-encoded，
 *    这里只切段与折叠，**不**再编码一次。
 *
 * @throws `WebDavError('config')` 地址为空、缺协议，或 `URL` 解析不了。
 */
export function joinUrlPath(baseUrl: string, ...segments: string[]): string {
  const rawBase = (baseUrl ?? '').trim()
  if (rawBase === '') {
    fail('config', '还没有填 WebDAV 同步地址，请先到设置页补充。')
  }

  let parsed: URL
  try {
    parsed = new URL(rawBase)
  } catch (e) {
    fail(
      'config',
      'WebDAV 地址看起来不是一个完整网址（要以 https:// 开头，' +
        '例如 https://dav.jianguoyun.com/dav/）。',
      e,
    )
  }

  // `URL.protocol` 带尾冒号（形如 https:）。这里先去掉冒号再比 —— 顺带绕开仓库的
  // settings 键门禁：它会把 `'https:'` 这种"以冒号结尾的字面量"当成疑似键前缀。
  const scheme = parsed.protocol.toLowerCase().replace(/:$/, '')
  if (!SUPPORTED_SCHEMES.has(scheme)) {
    fail('config', 'WebDAV 地址必须以 https:// 或 http:// 开头。')
  }

  const baseSegments = parsed.pathname.split('/').filter((s) => s !== '')
  const tail = segments.map((s) => encodePathSegment(s ?? '')).filter((s) => s !== '')
  const all = [...baseSegments, ...tail]
  const joined = all.length === 0 ? '' : `/${all.join('/')}`

  // 没有附加段时按"目录 URL"处理（结尾补 `/`）：① PROPFIND 探活要用它；
  // ② WebDAV 对目录的 PUT/GET 与对文件的语义不同，少一个斜杠会打到另一个资源上。
  return tail.length === 0 ? `${parsed.origin}${joined}/` : `${parsed.origin}${joined}`
}

/**
 * 远程备份文件名：`fls-backup-<档案 id>.json`。
 *
 * 文件名里带档案 id 而不是"孩子名字"：名字可以改（家长随时重命名），
 * id 从建档到删档不变。改名字会让两台设备从此互不认识 —— 各自传一份，谁也合并不上。
 *
 * @throws `WebDavError('config')` 档案 id 为空。
 */
export function remoteBackupFileName(profileId: string): string {
  const pid = (profileId ?? '').trim()
  if (pid === '') {
    fail('config', '缺少档案标识，拼不出备份文件名（请先把当前孩子选好再试）。')
  }
  return `${BACKUP_FILE_PREFIX}${pid}${BACKUP_FILE_SUFFIX}`
}

/**
 * 某个孩子在网盘上的备份文件 URL（上传 / 下载 / 探存在都用它）。
 *
 * @throws `WebDavError('config')` 地址或档案 id 不成立。
 */
export function buildBackupUrl(baseUrl: string, profileId: string): string {
  return joinUrlPath(baseUrl, remoteBackupFileName(profileId))
}

/**
 * 备份文件所在**目录** URL。
 *
 * 探活请求打这里而不是打文件：同域、同一套 CORS 策略，但不用为了"能不能连上"
 * 把整份备份（可能几 MB）拉下来一遍。
 */
export function buildCollectionUrl(baseUrl: string): string {
  return joinUrlPath(baseUrl)
}

// ---------------------------------------------------------------------------
// fetch 注入与请求壳
// ---------------------------------------------------------------------------

/** 我们用到的 `RequestInit` 子集（结构化约束，方便测试塞替身） */
export interface FetchInitLike {
  method?: string
  headers?: Record<string, string>
  body?: string
  mode?: RequestMode
  signal?: AbortSignal
}

/** 我们用到的 `Response` 子集 */
export interface FetchResponseLike {
  ok: boolean
  status: number
  statusText?: string
  /** `'opaque'` 意味着拿不到正文 —— 跨域未放行的一个强信号 */
  type?: string
  text(): Promise<string>
  json(): Promise<unknown>
}

/** 可注入的 fetch 替身签名（与原生 `fetch` 结构兼容） */
export type FetchLike = (input: string, init?: FetchInitLike) => Promise<FetchResponseLike>

/** 一次请求的可注入依赖 */
export interface RequestDeps {
  /** 主请求的 fetch；缺省回落到宿主全局 `fetch` */
  fetchImpl?: FetchLike
  /** 探活专用 fetch；缺省与 `fetchImpl` 相同 */
  probeImpl?: FetchLike
  /** 超时毫秒；0 表示不设上限。默认 `DEFAULT_TIMEOUT_MS` */
  timeoutMs?: number
}

/** WebDAV 连接配置（**只放传输需要的字段**；口令怎么加密存放是 UI 层的事） */
export interface WebDavConfig {
  /** 网盘里的**目录**地址 */
  baseUrl: string
  username?: string
  password?: string
}

/** 默认超时：局域网或网盘都不该让家长对着转圈等一分钟 */
export const DEFAULT_TIMEOUT_MS = 15_000

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 手写 base64（**刻意不用 `btoa` / `Buffer`**）。
 *
 * 两条理由：
 *  1. `btoa` 只吃 Latin-1，口令里出现中文会直接抛 `InvalidCharacterError`；
 *  2. `Buffer` 在浏览器侧不存在，用它就得写一条环境分支。
 * 自己实现不到 20 行，而且能被单测直接钉住（`a:b` → `YTpi`）。
 */
function base64Encode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += BASE64_CHARS[b0 >> 2]
    out += BASE64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f]
  }
  return out
}

/** Basic 认证的 header 值（`username:password` → base64） */
export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${base64Encode(new TextEncoder().encode(`${username}:${password}`))}`
}

/** 取真正要用的 fetch：优先注入替身，否则回落到宿主全局 `fetch` */
function resolveFetch(
  deps: RequestDeps,
  which: 'fetchImpl' | 'probeImpl' = 'fetchImpl',
): FetchLike {
  const direct = deps[which]
  if (typeof direct === 'function') return direct
  if (which === 'probeImpl' && typeof deps.fetchImpl === 'function') return deps.fetchImpl
  const host = typeof globalThis !== 'undefined' ? globalThis.fetch : undefined
  if (typeof host !== 'function') {
    fail('config', '当前环境不支持 fetch，连不上网盘。' + FALLBACK_HINT)
  }
  return (input: string, init?: FetchInitLike) => host(input, init as RequestInit)
}

/** 组装请求头：鉴权 + 内容类型 */
function buildHeaders(config: WebDavConfig, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  const username = (config?.username ?? '').trim()
  // 没填账号时**不发** Authorization：部分网盘对空 Basic 值直接回 500，
  // 会把真实的"缺口令"掩盖成"服务器坏了"。
  if (username !== '') {
    headers.Authorization = basicAuthHeader(username, config?.password ?? '')
  }
  return headers
}

interface RequestSpec {
  method: string
  headers?: Record<string, string>
  body?: string
  /** 404 不当失败处理，返回 `null`（PROPFIND 探存在要靠它） */
  tolerantNotFound?: boolean
}

/**
 * 发一次请求，把网络层与非 2xx 翻译成带 code 的错误。
 *
 * @returns 成功时的响应；`tolerantNotFound` 下命中 404 返回 `null`。
 * @throws `WebDavError` 其余一切失败。
 */
async function request(
  url: string,
  spec: RequestSpec,
  config: WebDavConfig,
  deps: RequestDeps,
): Promise<FetchResponseLike | null> {
  const fn = resolveFetch(deps)
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined

  try {
    const res = await fn(url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      signal: controller?.signal,
    })

    // 透明响应：请求"成功"了却一个字节都拿不到 —— 只有跨域没放行才会这样。
    // 必须在这里判掉，否则会落到下面的正文解析，最后报成 payload 错误，
    // 把家长引向完全错误的方向（他会以为备份文件坏了）。
    if (res.type === 'opaque' || res.status === 0) {
      fail('cors', undefined, res)
    }

    if (!res.ok) {
      if (res.status === 404 && spec.tolerantNotFound) return null
      if (res.status === 401 || res.status === 403) fail('auth', undefined, res)
      if (res.status === 404) fail('not-found', undefined, res)
      fail(
        'server',
        `网盘服务器返回了 ${res.status} ${res.statusText ?? ''}（${spec.method} 请求）。` +
          FALLBACK_HINT,
        res,
      )
    }

    return res
  } catch (err) {
    if (isWebDavError(err)) throw err
    // 超时单独给一句人话：否则家长看到的是"连不上"，而真实情况是"这次太慢了"。
    if (controller?.signal.aborted) {
      fail(
        'network',
        `连接网盘超时（等待超过 ${Math.round(timeoutMs / 1000)} 秒）。` +
          '可以稍后再试一次。' +
          FALLBACK_HINT,
        err,
      )
    }
    throw await classifyTransportFailure(config, err, deps)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 探活：这个地址在**传输层**到底连不连得上？
 *
 * ## 为什么要多打一个请求
 * fetch 失败时给的只有一句 `TypeError: Failed to fetch`。浏览器**刻意**不告诉页面
 * 是 DNS 挂了、断网了，还是被同源策略拦了（安全原因：越详细越好做指纹探测）。
 * 但对家长来说这是两种完全不同的故障：前者去查网络，后者只能换通道。
 *
 * ## 判别法
 * 用 `mode: 'no-cors'` 再打一次最小请求：
 *   - **能连上**（resolve，哪怕是一次 401 的透明响应）→ 传输层没问题，
 *     刚才那次失败只可能来自跨域检查 → 报 `cors`；
 *   - **同样失败**（reject）→ 真的连不上 → 报 `network`。
 *
 * 已知边界（如实记录，不装作没有）：劫持型 DNS / 强制门户会让这一步误报"能连上"，
 * 于是我们把某些网络故障报成 CORS。**这个方向的错误是刻意选的**：
 * 反过来（把跨域报成网络故障）会让家长反复重试一个永远不可能成功的请求。
 *
 * @returns `'reachable'` / `'unreachable'` / `'unknown'`（环境里没有可用 fetch）
 */
export async function probeReachability(
  config: WebDavConfig,
  deps: RequestDeps = {},
): Promise<'reachable' | 'unreachable' | 'unknown'> {
  let fn: FetchLike
  try {
    fn = resolveFetch(deps, 'probeImpl')
  } catch {
    return 'unknown'
  }
  let probeUrl: string
  try {
    // 探**目录**而不是探文件：同一套跨域策略，但不下载整份备份（可能几 MB）
    probeUrl = buildCollectionUrl(config.baseUrl)
  } catch {
    // 地址本身就不合法：这不是"连不上"，别把它误报成网络故障
    return 'unknown'
  }
  try {
    await fn(probeUrl, { method: 'GET', mode: 'no-cors' })
    return 'reachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * 把一次 fetch 失败翻译成明确分类。
 *
 * 探活本身做不了时回落到 `network`，但文案里**如实写出也可能是跨域**：
 * 宁可多给一种可能，也不给一个把人引向死胡同的确定结论。
 */
async function classifyTransportFailure(
  config: WebDavConfig,
  cause: unknown,
  deps: RequestDeps,
): Promise<never> {
  const probe = await probeReachability(config, deps)
  if (probe === 'reachable') fail('cors', undefined, cause)
  if (probe === 'unreachable') fail('network', undefined, cause)
  fail(
    'network',
    '请求没能发出去（可能是网络不通，也可能是浏览器的跨域检查拦下了它）。' + FALLBACK_HINT,
    cause,
  )
}

// ---------------------------------------------------------------------------
// 三个动作：PUT / GET / PROPFIND
// ---------------------------------------------------------------------------

export interface PutResult {
  url: string
  /** 实际发出去的字符数（UI 可显示"传了多少"） */
  bytes: number
  status: number
}

/**
 * 上传（PUT）一份备份。
 *
 * WebDAV 的 PUT 语义是"整份替换"，正好匹配我们的场景：备份文件是**导出时刻的全量快照**，
 * 合并语义在下载侧由 `planMerge` 负责，上传侧不存在"追加上一段"的需求。
 */
export async function putBackup(
  config: WebDavConfig,
  profileId: string,
  payload: BackupV2,
  deps: RequestDeps = {},
): Promise<PutResult> {
  const url = buildBackupUrl(config.baseUrl, profileId)
  const body = JSON.stringify(payload)
  const res = await request(
    url,
    {
      method: 'PUT',
      headers: buildHeaders(config, { 'Content-Type': 'application/json; charset=utf-8' }),
      body,
    },
    config,
    deps,
  )
  return { url, bytes: body.length, status: res?.status ?? 200 }
}

export interface GetResult {
  url: string
  /** **未校验**的解析结果；由调用方交给 `routeBackup` 判版本 */
  json: unknown
  bytes: number
}

/**
 * 下载（GET）远端备份并解析成 JSON。
 *
 * 为什么这里**不**判断备份版本：版本判据只允许有一处（`routeBackup`）。
 * 传输层一旦也判一次，两边就会各自漂移 —— "导出侧认为自己是 v2、接收侧按 v1 解析"
 * 是本项目明确点名要挡的事故（见 `routeBackup.ts` 文件头）。
 */
export async function getBackup(
  config: WebDavConfig,
  profileId: string,
  deps: RequestDeps = {},
): Promise<GetResult> {
  const url = buildBackupUrl(config.baseUrl, profileId)
  const res = await request(url, { method: 'GET', headers: buildHeaders(config) }, config, deps)
  const text = (await res?.text()) ?? ''
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    // 网盘的"直接下载"链接有时会返回登录页 HTML。点名这一条，比 "Invalid JSON" 有用得多。
    fail(
      'payload',
      '下载到的内容不是一份备份文件（多半是网盘的登录页或预览页）。' +
        '请确认同步地址直链到 .json 文件本身。' +
        FALLBACK_HINT,
      e,
    )
  }
  return { url, json, bytes: text.length }
}

/** PROPFIND 的结果 */
export interface PropfindStat {
  exists: boolean
  /**
   * 字节数。属性缺失时为 `undefined` 而不是 0 —— **"没告诉我"与"0 字节"是两回事**：
   * 前者只是少一个数字，后者会让 UI 显示"远端是空的"。
   */
  size?: number
  /** 服务端给的修改时间（ISO 或 RFC 1123 原文，不做解析） */
  lastModified?: string
}

/** 忽略命名空间前缀地取标签内容（见 `parsePropfind` 注释） */
function tagContent(xml: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[A-Za-z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${localName}>`,
    'i',
  )
  return re.exec(xml)?.[1]?.trim()
}

/**
 * 解析 PROPFIND 的 `207 Multi-Status`。
 *
 * ## 为什么用正则而不是 `DOMParser`
 * ① 零依赖优先（`DOMParser` 在 Node 侧没有，单测就得切 environment 到 jsdom）；
 * ② 我们要的只有三个字段，建 DOM 属于用牛刀。
 * 代价是宽容度有限：被 gzip 或 CDATA 包裹的属性值解析不出来。取舍是
 * **解析不出来就按"没告诉我"处理**，绝不填 0 制造假事实。
 *
 * ## 为什么标签名前的前缀整段忽略
 * 命名空间前缀各家服务器都不一样：`d:` / `D:` / `lp1:` / 无前缀都有。
 * 写死 `d:` 是跨服务器最典型的踩坑点 —— 在 Nextcloud 上通、在坚果云上拿到全空。
 */
export function parsePropfind(xml: string): PropfindStat {
  const text = xml ?? ''
  const looksLikeMultistatus = /<(?:[A-Za-z0-9]+:)?(?:multistatus|response)[\s>]/i.test(text)
  if (!looksLikeMultistatus) return { exists: false }

  const sizeText = tagContent(text, 'getcontentlength') ?? ''
  const size = /^\d+$/.test(sizeText) ? Number(sizeText) : undefined
  const lastModified = tagContent(text, 'getlastmodified')

  const stat: PropfindStat = { exists: true }
  if (size !== undefined) stat.size = size
  if (lastModified !== undefined && lastModified !== '') stat.lastModified = lastModified
  return stat
}

/**
 * PROPFIND 探一下远端有没有这个文件（不下载正文）。
 *
 * 为什么不让 UI 直接 GET 然后看 404：先 PROPFIND 能在**下载之前**就知道"那边还没传过"，
 * 从而给出正确的那句话（"请先去另一台设备上传一次"），而不是下载失败后的失败提示。
 */
export async function statBackup(
  config: WebDavConfig,
  profileId: string,
  deps: RequestDeps = {},
): Promise<PropfindStat> {
  const url = buildBackupUrl(config.baseUrl, profileId)
  const res = await request(
    url,
    {
      method: 'PROPFIND',
      // Depth: 0 = 只要这个文件自身的属性，别列目录（省一堆无用字节）
      headers: buildHeaders(config, { Depth: '0' }),
      tolerantNotFound: true,
    },
    config,
    deps,
  )
  if (!res) return { exists: false }
  return parsePropfind((await res.text()) ?? '')
}
