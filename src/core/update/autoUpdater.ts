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
import { checkUpdate, type UpdateCheckResult } from './checkUpdate'
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
    onState({ phase: 'latest', version: appVersion })
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
