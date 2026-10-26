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

/** 部署期常量：version.json 地址（raw.githubusercontent.com 自带 CORS 头）。 */
export const UPDATE_CHECK_URL =
  'https://raw.githubusercontent.com/thomas0249533/family-learning-system/main/version.json'

/**
 * 检查是否有新版本。
 * @param currentVersion 当前应用版本（来自注入的 `__APP_VERSION__`）
 * @param fetchImpl 可注入的 fetch（默认全局 fetch；测试时注入假实现，无需污染全局）
 * @returns `UpdateInfo` 或类型化的 `UpdateCheckError`（**绝不抛异常**）
 */
export async function checkUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCheckResult> {
  try {
    const resp = await fetchImpl(UPDATE_CHECK_URL)
    if (!resp.ok) {
      return {
        ok: false,
        kind: 'http',
        message: `服务器返回 ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`,
      }
    }

    let data: any
    try {
      data = await resp.json()
    } catch {
      return { ok: false, kind: 'parse', message: 'version.json 不是合法 JSON' }
    }

    const remoteVersion = typeof data?.version === 'string' ? data.version : null
    const downloadUrl = typeof data?.downloadUrl === 'string' ? data.downloadUrl : null
    if (!remoteVersion) {
      return { ok: false, kind: 'parse', message: 'version.json 缺少 version 字段' }
    }

    const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0
    return { ok: true, hasUpdate, currentVersion, remoteVersion, downloadUrl }
  } catch (e: any) {
    // fetch 抛异常：CORS 与离线在浏览器里都表现为 TypeError "Failed to fetch"。
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
