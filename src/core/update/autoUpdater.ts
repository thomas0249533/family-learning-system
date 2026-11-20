/**
 * autoUpdater.ts —— D-2 真实自动更新。
 * ---------------------------------------------------------------------
 * 优先走 Tauri 官方 `tauri-plugin-updater`（@tauri-apps/plugin-updater）：
 *   check() → downloadAndInstall(进度回调) → relaunch()。
 * 若当前不在 Tauri 运行时（纯网页 / dev / 插件未注册），`check()` 会抛错，
 * 此时**优雅降级**到 D-1 通知式（fetch version.json，渲染「前往官网下载」链接），
 * 绝不向调用方抛未捕获异常（避免白屏）。
 *
 * 进度回调把每个阶段透传给 UI：checking / available / downloading / installing /
 * done / latest / fallback / error。UI 据此显示下载百分比与安装态。
 */
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { checkUpdate, UPDATE_CHECK_CANDIDATES, type UpdateCheckResult } from './checkUpdate'
import { manualDownloadUrls, type DownloadSource } from './downloadSources'

export interface AutoUpdateProgress {
  downloaded: number
  total: number | null
}

export type AutoUpdatePhase =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'done'
  | 'latest'
  | 'fallback'
  | 'error'

export interface AutoUpdateState {
  phase: AutoUpdatePhase
  version?: string
  notes?: string
  progress?: AutoUpdateProgress
  /** D-1 兜底结果（plugin 不可用时），UI 据此渲染「前往官网下载」链接 */
  fallback?: UpdateCheckResult
  error?: string
  /**
   * 下载失败时的手动兜底地址（V2.12.3）。
   * 清单里每个平台只有一个安装包 URL，没有多源容错；那个 host 一旦被墙，
   * 自动更新就只能失败。此时把同一份安装包的可达地址摆出来，让用户自己点。
   */
  manualDownloads?: DownloadSource[]
}

/**
 * 插件 check() 报「没有更新」时的裁定逻辑 —— 纯函数，便于单测。
 * ---------------------------------------------------------------------
 * tauri-plugin-updater 的 check() 读 `releases/latest/download/latest.json`，
 * 插件内部带 HTTP 缓存：刚发版几分钟内仍可能读到上一版清单 → 返回 null →
 * 误报「已是最新版本」。此处用无插件缓存的 D-1 路径（version.json）结果交叉验证：
 *   · fallback.ok && hasUpdate  → 缓存骗了我们：透传 fallback，UI 显示下载链接；
 *   · fallback.ok && !hasUpdate → 确认真最新，与旧行为一致；
 *   · fallback 失败（离线等）   → 仍报 latest（保持离线可用），不卡用户、不白屏。
 *
 * @param fallback 交叉验证结果（类型化，绝不抛异常）
 * @param appVersion 当前应用版本（latest 分支回显用）
 */
export function resolveLatestVerdict(
  fallback: UpdateCheckResult,
  appVersion: string
): AutoUpdateState {
  if (fallback.ok && fallback.hasUpdate) {
    return { phase: 'fallback', fallback }
  }
  return { phase: 'latest', version: appVersion }
}

/**
 * 执行一次「检查 + 下载 + 安装 + 重启」全流程。
 * @param appVersion 当前应用版本（来自 __APP_VERSION__）
 * @param onState 每个阶段的状态回调（用于 UI 实时刷新）
 */
export async function runAutoUpdate(
  appVersion: string,
  onState: (s: AutoUpdateState) => void
): Promise<void> {
  onState({ phase: 'checking' })

  let update
  try {
    update = await check()
  } catch {
    // 不在 Tauri 运行时或插件不可用：回退 D-1 通知式
    const fallback = await checkUpdate(appVersion)
    onState({ phase: 'fallback', fallback })
    return
  }

  if (!update) {
    // 插件 check() 返回 null 不等于真最新：它的 latest.json 带 HTTP 缓存，
    // 刚发版时可能仍读到旧清单（用户 4.1.1 发版 7 分钟后被误报 4.1.0 已最新）。
    // 用无插件缓存的 D-1 主源交叉验证；只请求 1 个 candidate（动态重定向、
    // 无 CDN 长缓存），正常 ~1s、最坏 8s，不走 4 源 × 8s 的慢路径。
    // checkUpdate 契约上不抛异常；这里再兜一层，确保交叉验证绝不影响主流程。
    let fallback: UpdateCheckResult
    try {
      fallback = await checkUpdate(appVersion, fetch, [UPDATE_CHECK_CANDIDATES[0]])
    } catch {
      fallback = { ok: false, kind: 'network', message: '交叉验证失败' }
    }
    onState(resolveLatestVerdict(fallback, appVersion))
    return
  }

  onState({
    phase: 'available',
    version: update.version,
    notes: typeof update.body === 'string' ? update.body : undefined,
  })

  let downloaded = 0
  let total: number | null = null
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? null
        onState({
          phase: 'downloading',
          version: update!.version,
          progress: { downloaded, total },
        })
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        onState({
          phase: 'downloading',
          version: update!.version,
          progress: { downloaded, total },
        })
      } else if (event.event === 'Finished') {
        onState({
          phase: 'installing',
          version: update!.version,
          progress: { downloaded, total },
        })
      }
    })
  } catch (e: any) {
    onState({
      phase: 'error',
      version: update.version,
      error: String(e?.message ?? e),
      // 失败不能只留一句「更新失败」：清单里的下载 URL 是单点（无多源容错），
      // 这里给出同一份安装包的两条直达链接，用户点一下即可手动安装。
      manualDownloads: manualDownloadUrls(update.version),
    })
    return
  }

  onState({ phase: 'done', version: update.version })
  // 安装完成后由 updater 触发 Windows 退出；这里再显式 relaunch 以拉起新版本
  await relaunch()
}
