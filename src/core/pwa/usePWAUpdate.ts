import { ref, onMounted, onUnmounted } from 'vue'
import { isTauri } from './isTauri'
import { purgeDesktopServiceWorker, PURGED_FLAG } from './purgeServiceWorker'

export type PWAUpdateState = 'idle' | 'available' | 'updating' | 'error'

/**
 * PWA 更新提示组合式函数
 * 依赖 vite-plugin-pwa 的 prompt 模式（通过 virtual:pwa-register/vue 提供的 useRegisterSW）
 *
 * ⚠️ 桌面端（Tauri）**不注册 SW**，反过来把可能残留的摘掉，原因见
 * `purgeServiceWorker.ts` 顶部注释：SW 接管导航后，升级换了 exe 也照样跑旧前端。
 */
export function usePWAUpdate() {
  const state = ref<PWAUpdateState>('idle')
  const needRefresh = ref(false)
  const offlineReady = ref(false)
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null
  let offNeedRefresh: (() => void) | undefined
  let offOfflineReady: (() => void) | undefined

  onMounted(async () => {
    // 桌面端：不注册，只做清理（Rust 侧已先手删过目录，这里是兜底）
    if (isTauri()) {
      const purged = await purgeDesktopServiceWorker()
      if (purged > 0) {
        try {
          if (sessionStorage.getItem(PURGED_FLAG) !== '1') {
            sessionStorage.setItem(PURGED_FLAG, '1')
            location.reload()
          }
        } catch {
          // sessionStorage 不可用（极少见）就放弃这一步，不做无限刷新
        }
      }
      return
    }

    try {
      // @ts-ignore — virtual module provided by vite-plugin-pwa
      const mod = await import('virtual:pwa-register/vue')
      const result = mod.useRegisterSW({ immediate: true })

      needRefresh.value = result.needRefresh.value
      offlineReady.value = result.offlineReady.value
      updateSW = result.updateServiceWorker

      // 监听变化
      offNeedRefresh = result.onNeedRefresh(() => {
        needRefresh.value = true
        state.value = 'available'
      })
      offOfflineReady = result.onOfflineReady(() => {
        offlineReady.value = true
      })
    } catch (e) {
      // 开发环境或未启用 SW 时，静默跳过
      console.debug('[PWA] SW 未注册', e)
    }
  })

  // onUnmounted 必须在 setup 同步阶段注册。原来写在 onMounted 的 async 回调里，
  // Vue 会警告 "no active component instance"，卸载清理实际从未执行。
  onUnmounted(() => {
    offNeedRefresh?.()
    offOfflineReady?.()
  })

  async function applyUpdate() {
    if (!updateSW) return
    state.value = 'updating'
    try {
      await updateSW(true)
    } catch (e) {
      state.value = 'error'
      console.error('[PWA] 更新失败', e)
    }
  }

  function dismiss() {
    needRefresh.value = false
    offlineReady.value = false
    state.value = 'idle'
  }

  return {
    state,
    needRefresh,
    offlineReady,
    applyUpdate,
    dismiss,
  }
}
