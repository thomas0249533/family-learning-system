/**
 * catalogService.ts —— 联网校验与库同步（轨道 I · I2-a）。
 * =====================================================================
 * 纯前端、可插拔 transport。所有网络/跨域/解析异常都被捕获并转换为
 * **类型化错误对象**，绝不会向调用方抛未捕获异常导致白屏。
 *
 * 设计要点：
 *   · `CatalogTransport` 接口可插拔，默认实现用浏览器 `fetch`；
 *   · `fetchCatalog` 返回 `Catalog | CatalogError`，调用方用 `result.ok` 判别；
 *   · `compareVersions` 是真·semver 比较（正确处理 `1.10.0` > `1.9.0`、
 *     `1.2.3` < `1.2.4`、预发布号）；
 *   · `compareWithLocal` 按 packageId 比对 version / checksum。
 *
 * CORS 现实：纯前端 WebView 下 `fetch` 受 CORS 限制——`raw.githubusercontent.com`
 * 带 `Access-Control-Allow-Origin:*` 可直接取；坚果云/WebDAV 分享链接大概率被
 * 浏览器跨域拦截。fetch 失败时 `fetchCatalog` 返回 `kind:'cors'` 类型错误，
 * UI 据此展示清晰提示，不白屏。
 */

// ============================================================================
// 类型
// ============================================================================

export interface CatalogEntry {
  packageId: string
  version: string
  checksum?: string
  url: string
}

export interface Catalog {
  /** 鉴别字段：成功时为 true，与 CatalogError.ok=false 构成判别联合 */
  ok: true
  source: string
  fetchedAt: number
  packages: CatalogEntry[]
}

/** 类型化错误：fetchCatalog 失败时的返回，绝不抛异常 */
export interface CatalogError {
  ok: false
  kind: 'cors' | 'network' | 'http' | 'parse'
  message: string
  status?: number
}

export type CatalogResult = Catalog | CatalogError

/** 可插拔传输层；默认实现用浏览器 fetch，测试可注入 mock */
export interface CatalogTransportResponse {
  ok: boolean
  status: number
  statusText?: string
  /** 解析 JSON；失败时 reject（用于区分 http / parse 错误） */
  json(): Promise<any>
}

export interface CatalogTransport {
  fetch(url: string): Promise<CatalogTransportResponse>
}

export interface LocalPackageRef {
  packageId: string
  version: string
  checksum?: string
}

export interface UpdateCheck {
  packageId: string
  hasUpdate: boolean
  currentVersion: string | null
  remoteVersion: string | null
  url: string | null
}

// ============================================================================
// 默认 transport（浏览器 fetch）
// ============================================================================

function browserTransport(): CatalogTransport {
  return {
    async fetch(url: string): Promise<CatalogTransportResponse> {
      const resp = await fetch(url)
      return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        json: () => resp.json(),
      }
    },
  }
}

// ============================================================================
// fetchCatalog
// ============================================================================

/**
 * 拉取并解析 catalog JSON。
 * @param url catalog 文件地址（GitHub Raw / 坚果云 / WebDAV 分享链接等）
 * @param transport 可插拔；缺省用浏览器 fetch
 * @returns `Catalog` 或类型化的 `CatalogError`（**绝不抛异常**）
 */
export async function fetchCatalog(
  url: string,
  transport?: CatalogTransport,
): Promise<CatalogResult> {
  const t = transport ?? browserTransport()
  try {
    const resp = await t.fetch(url)

    if (!resp.ok) {
      return {
        ok: false,
        kind: 'http',
        status: resp.status,
        message: `服务器返回 ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`,
      }
    }

    let data: any
    try {
      data = await resp.json()
    } catch (e: any) {
      return {
        ok: false,
        kind: 'parse',
        status: resp.status,
        message: `catalog 不是合法 JSON：${e?.message ?? String(e)}`,
      }
    }

    // 字段归一化 + 轻量校验
    const packages: CatalogEntry[] = Array.isArray(data?.packages)
      ? data.packages
          .filter((e: any) => e && typeof e.packageId === 'string' && typeof e.url === 'string')
          .map((e: any) => ({
            packageId: e.packageId,
            version: typeof e.version === 'string' ? e.version : '0.0.0',
            checksum: typeof e.checksum === 'string' ? e.checksum : undefined,
            url: e.url,
          }))
      : []

    if (packages.length === 0) {
      return {
        ok: false,
        kind: 'parse',
        message: 'catalog 缺少有效的 packages 列表（每项需含 packageId 与 url）',
      }
    }

    return {
      ok: true,
      source: url,
      fetchedAt: Date.now(),
      packages,
    }
  } catch (e: any) {
    // fetch 抛异常：CORS 与离线在浏览器里都表现为 TypeError "Failed to fetch"。
    // 用 message 启发式分类——CORS 拦截通常带 CORS / cross-origin / blocked 字样。
    const msg = e?.message ?? String(e)
    const isCors = /cors|cross-origin|blocked by|not allowed|access-control/i.test(msg)
    return {
      ok: false,
      kind: isCors ? 'cors' : 'network',
      message: isCors
        ? `跨域被拦截（CORS）：${msg}。请改用带 CORS 头的链接（如 raw.githubusercontent.com）。`
        : `网络请求失败：${msg}`,
    }
  }
}

// ============================================================================
// compareVersions —— 真·semver
// ============================================================================

interface ParsedSemver {
  nums: number[]
  pre: string[] | null
}

function parseSemver(v: string): ParsedSemver {
  const clean = String(v ?? '').trim().replace(/^v/i, '')
  const [core, preRaw] = clean.split('-')
  const nums = core.split('.').map((p) => {
    const n = Number.parseInt(p, 10)
    return Number.isNaN(n) ? 0 : n
  })
  while (nums.length < 3) nums.push(0)
  const pre = preRaw && preRaw.length > 0 ? preRaw.split('.') : null
  return { nums, pre }
}

/**
 * 比较两版本号。返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相等。
 * 正确处理：1.10.0 > 1.9.0、1.2.3 < 1.2.4、预发布号（1.0.0-alpha < 1.0.0）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)

  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
  }

  // 主干相等 → 比预发布：无预发布 > 有预发布
  const aPre = pa.pre
  const bPre = pb.pre
  if (!aPre && !bPre) return 0
  if (!aPre) return 1
  if (!bPre) return -1

  const len = Math.max(aPre.length, bPre.length)
  for (let i = 0; i < len; i++) {
    const x = aPre[i] ?? ''
    const y = bPre[i] ?? ''
    const xn = Number.parseInt(x, 10)
    const yn = Number.parseInt(y, 10)
    const bothNum = !Number.isNaN(xn) && !Number.isNaN(yn)
    if (bothNum) {
      if (xn !== yn) return xn - yn
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

// ============================================================================
// compareWithLocal
// ============================================================================

/**
 * 把 catalog 与本地包比对，得出每项「有更新 / 已是最新 / 本地无此包」。
 * 判定口径：
 *   · 本地无此 packageId → remoteVersion 有值则视为可新增（hasUpdate = true，currentVersion=null）；
 *   · 本地有但版本更高 → 有更新；
 *   · 版本相同但 checksum 不同 → 有更新；
 *   · 否则已是最新。
 */
export function compareWithLocal(
  catalog: Catalog,
  localPackages: LocalPackageRef[],
): UpdateCheck[] {
  const localMap = new Map<string, LocalPackageRef>()
  for (const p of localPackages) localMap.set(p.packageId, p)

  return catalog.packages.map((entry) => {
    const local = localMap.get(entry.packageId)
    const remoteVersion = entry.version ?? '0.0.0'

    if (!local) {
      return {
        packageId: entry.packageId,
        hasUpdate: true,
        currentVersion: null,
        remoteVersion,
        url: entry.url,
      }
    }

    const currentVersion = local.version ?? '0.0.0'
    const versionNewer = compareVersions(remoteVersion, currentVersion) > 0
    const checksumDiff =
      !!entry.checksum && !!local.checksum && entry.checksum !== local.checksum

    const hasUpdate = versionNewer || checksumDiff

    return {
      packageId: entry.packageId,
      hasUpdate,
      currentVersion,
      remoteVersion,
      url: entry.url,
    }
  })
}
