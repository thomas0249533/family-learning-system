/**
 * checkUpdate.ts —— V2.3 轨道 D（方案 D-1）· 纯前端「检查更新」占位。
 * =====================================================================
 * 不做自动下载 / 自动重启（那是 D-2，需要 tauri-plugin-updater + Rust 重编 +
 * 签名密钥 + CI）。D-1 只做：拉一个带 CORS 头的 version.json，若远端更新则
 * 提示「去官网下载」，用户自己点链接。
 *
 * 设计纪律（与 V2.2 catalogService 同源）：
 *   · 所有网络 / 跨域 / 解析异常都被捕获，转换为**类型化结果**，绝不向调用方
 *     抛未捕获异常导致白屏（WebView 里 fetch 失败表现为 TypeError "Failed to fetch"）。
 *   · 版本比较复用 `compareVersions`（真·semver，正确处理 1.10.0 > 1.9.0）。
 *   · version.json 约定：`{ "version": "x.y.z", "downloadUrl": "https://..." }`。
 *
 * ⚠️ `UPDATE_CHECK_URL` 是部署期常量：V2.8.0 起接入 GitHub 发布管线 —— 仓库
 * thomas0249533/family-learning-system 的 main 分支根目录放置 version.json
 * （raw.githubusercontent.com 带 `ACAO:*`，CORS 可过）。每次发版随 main 更新此文件。
 */
import { compareVersions } from '@core/importer/catalogService'

/**
 * 多镜像候选源（按顺序尝试，任一成功即用）。
 *
 * 背景：`raw.githubusercontent.com` 在中国大陆常被墙 / TLS 超时，导致「检查更新」直接
 * 报 `Failed to fetch`。三个源都带 `access-control-allow-origin: *`，WebView 跨域可过：
 *   - ① raw.githubusercontent.com：官方主源，非大陆环境最快最稳；
 *   - ② cdn.jsdelivr.net/gh：jsDelivr 的 GitHub 镜像，带 CORS；
 *   - ③ raw.gitmirror.com：gitmirror 镜像，大陆可达性较好，带 CORS。
 * 任一能连通即用，最大化不同网络环境下「检查更新」可用。
 */
export const UPDATE_CHECK_URL =
  'https://raw.githubusercontent.com/thomas0249533/family-learning-system/main/version.json'

/** 更新检查候选源。`UPDATE_CHECK_URL` 恒为第一项（保持部署常量语义不变） */
export const UPDATE_CHECK_CANDIDATES: readonly string[] = [
  UPDATE_CHECK_URL,
  'https://cdn.jsdelivr.net/gh/thomas0249533/family-learning-system@main/version.json',
  'https://raw.gitmirror.com/thomas0249533/family-learning-system/main/version.json',
]

/** 单个候选源的网络超时（毫秒）。被墙的主机可能在 TLS 握手阶段挂起，超时后立刻尝试下一个镜像 */
const FETCH_TIMEOUT_MS = 8000

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  ctrl: AbortController
): Promise<Response> {
  return fetchImpl(url, { signal: ctrl.signal })
}

export interface UpdateInfo {
  ok: true
  hasUpdate: boolean
  currentVersion: string
  remoteVersion: string | null
  downloadUrl: string | null
}

export interface UpdateCheckError {
  ok: false
  kind: 'cors' | 'network' | 'http' | 'parse'
  message: string
}

export type UpdateCheckResult = UpdateInfo | UpdateCheckError

/**
 * 检查是否有新版本。
 *
 * 多镜像容错：依次尝试 `candidates`（默认 `UPDATE_CHECK_CANDIDATES`）每个源，
 * 任一成功即用；单个源网络 / 跨域 / HTTP / 解析失败都**不抛异常**，只是尝试下一个。
 * 只有全部候选都失败才返回类型化的 `network`/`cors` 错误（绝不向调用方抛未捕获异常）。
 *
 * @param currentVersion 当前应用版本（来自注入的 `__APP_VERSION__`）
 * @param fetchImpl 可注入的 fetch（默认全局 fetch；测试时注入假实现，无需污染全局）
 * @param candidates 更新源候选（默认内置多镜像；测试时可注入自定列表）
 * @returns `UpdateInfo` 或类型化的 `UpdateCheckError`（**绝不抛异常**）
 */
export async function checkUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
  candidates: readonly string[] = UPDATE_CHECK_CANDIDATES
): Promise<UpdateCheckResult> {
  let lastErr: { msg: string; kind: UpdateCheckError['kind'] } | null = null

  for (const url of candidates) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const resp = await fetchWithTimeout(url, fetchImpl, ctrl)
      if (!resp.ok) {
        // 主源返回 4xx/5xx：版本文件可能缺失/路径变更，记录后尝试下一个镜像
        lastErr = {
          msg: `服务器返回 ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`,
          kind: 'http',
        }
        continue
      }

      let data: any
      try {
        data = await resp.json()
      } catch {
        lastErr = { msg: 'version.json 不是合法 JSON', kind: 'parse' }
        continue
      }

      const remoteVersion = typeof data?.version === 'string' ? data.version : null
      const downloadUrl = typeof data?.downloadUrl === 'string' ? data.downloadUrl : null
      if (!remoteVersion) {
        lastErr = { msg: 'version.json 缺少 version 字段', kind: 'parse' }
        continue
      }

      const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0
      return { ok: true, hasUpdate, currentVersion, remoteVersion, downloadUrl }
    } catch (e: any) {
      // fetch 抛异常：CORS 与离线在浏览器里都表现为 TypeError "Failed to fetch"。
      const msg = e?.message ?? String(e)
      const isCors = /cors|cross-origin|blocked by|not allowed|access-control/i.test(msg)
      lastErr = {
        kind: isCors ? 'cors' : 'network',
        msg: isCors
          ? `跨域被拦截（CORS）：${msg}`
          : `网络请求失败：${msg}`,
      }
      // 该源失败：继续尝试下一个镜像
    } finally {
      clearTimeout(timer)
    }
  }

  // 全部候选失败：返回最后一次错误（类型化，绝不抛异常）。
  // 中国大陆用户常见场景：raw.githubusercontent.com 被墙，jsdelivr / gitmirror 也都不通
  // （或仅主源不通但镜像通——那种情况上面已提前返回，走不到这里）。
  const last = lastErr ?? { msg: '所有更新源均无法连接', kind: 'network' as const }
  if (last.kind === 'network') {
    return {
      ok: false,
      kind: 'network',
      message: `网络请求失败：${last.msg}。已尝试 ${candidates.length} 个更新源（raw.githubusercontent / jsdelivr / gitmirror）均失败，可能被当前网络环境拦截。`,
    }
  }
  return { ok: false, kind: last.kind, message: last.msg }
}
