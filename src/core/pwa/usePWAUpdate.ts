import { ref, onMounted, onUnmounted } from 'vue'

export type PWAUpdateState = 'idle' | 'available' | 'updating' | 'error'

/**
 * PWA 更新提示组合式函数
 * 依赖 vite-plugin-pwa 的 prompt 模式（通过 virtual:pwa-register/vue 提供的 useRegisterSW）
 */
export function usePWAUpdate() {
  const state = ref<PWAUpdateState>('idle')
  const needRefresh = ref(false)
  const offlineReady = ref(false)
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null

  onMounted(async () => {
    try {
      // @ts-ignore — virtual module provided by vite-plugin-pwa
      const mod = await import('virtual:pwa-register/vue')
      const result = mod.useRegisterSW({ immediate: true })

      needRefresh.value = result.needRefresh.value
      offlineReady.value = result.offlineReady.value
      updateSW = result.updateServiceWorker

      // 监听变化
      const unsub1 = result.onNeedRefresh(() => {
        needRefresh.value = true
        state.value = 'available'
      })
      const unsub2 = result.onOfflineReady(() => {
        offlineReady.value = true
      })

      onUnmounted(() => {
        unsub1?.()
        unsub2?.()
      })
    } catch (e) {
      // 开发环境或未启用 SW 时，静默跳过
      console.debug('[PWA] SW 未注册', e)
    }
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