import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const themeMode = ref<'light' | 'dark' | 'system'>('light')
  const fontSize = ref<'small' | 'medium' | 'large'>('medium')

  // 计算实际生效的主题（处理 system 模式）
  const actualTheme = computed(() => {
    if (themeMode.value === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return themeMode.value
  })

  // 同步类名到 body，用于触发全局 SCSS 变量
  watchEffect(() => {
    document.body.classList.toggle('dark-mode', actualTheme.value === 'dark')
    // 设置字号
    const sizeMap = { small: '14px', medium: '16px', large: '18px' }
    document.documentElement.style.fontSize = sizeMap[fontSize.value]
  })

  function setTheme(mode: 'light' | 'dark' | 'system') { themeMode.value = mode }
  function setFontSize(size: 'small' | 'medium' | 'large') { fontSize.value = size }

  return { themeMode, fontSize, actualTheme, setTheme, setFontSize }
})