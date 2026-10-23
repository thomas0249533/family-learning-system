<template>
  <n-config-provider
    :theme="themeStore.actualTheme === 'dark' ? darkTheme : null"
    :theme-overrides="themeOverrides"
  >
    <slot />
  </n-config-provider>
</template>

<script setup lang="ts">
// =====================================================================
// ThemeProvider · 主题覆盖 + 字号（B1 单一缩放源）的唯一承载组件
// ---------------------------------------------------------------------
// 承载 B5 的 themeOverrides 计算与 B1 的字号源：
//   buildThemeOverrides(palette, preset, actualTheme, FONT_SIZE_MAPS[fontSize])
// fontSizeMap 已迁入 palette.ts 的 FONT_SIZE_MAPS（JS 唯一源），
// theme.ts 不再写 documentElement.style.fontSize。
// =====================================================================
import { computed, onMounted, onUnmounted, watchEffect } from 'vue'
import { darkTheme, NConfigProvider } from 'naive-ui'
import { useThemeStore } from '@core/stores/theme'
import { palette, buildThemeOverrides, FONT_SIZE_MAPS } from '@core/styles/palette'
import { deriveAccent } from '@core/theme/accent'

const themeStore = useThemeStore()

/** V2.1 · 自定义主题色派生（null = 关闭，走学段预设） */
const accent = computed(() =>
  themeStore.customAccent ? deriveAccent(themeStore.customAccent, themeStore.actualTheme) : null,
)

const themeOverrides = computed(() => {
  const base = buildThemeOverrides(
    palette,
    themeStore.preset,
    themeStore.actualTheme,
    FONT_SIZE_MAPS[themeStore.fontSize] ?? FONT_SIZE_MAPS.medium,
  )
  const a = accent.value
  if (!a) return base
  return {
    ...base,
    common: {
      ...base.common,
      primaryColor: a.primaryText,
      primaryColorHover: a.primaryHover,
      primaryColorPressed: a.primaryPressed,
      primaryColorSuppl: a.primaryHover,
    },
    Button: {
      ...base.Button,
      colorPrimary: a.primaryText,
      colorHoverPrimary: a.primaryText,
      colorPressedPrimary: a.primaryText,
      colorFocusPrimary: a.primaryText,
      textColorPrimary: a.onPrimary,
      textColorHoverPrimary: a.onPrimary,
      textColorPressedPrimary: a.onPrimary,
      textColorFocusPrimary: a.onPrimary,
    },
  }
})

// V2.1 · 自定义主题色：运行时覆盖 CSS 变量（覆盖生成物 theme.scss 的静态值，
// 不动 tokens.ts / palette.ts / theme.scss 源码）。customAccent 为空则清除内联
// 覆盖，让静态主题重新生效。内联样式挂在 body 上，优先级高于 body[data-theme-preset]。
const ACCENT_VARS = [
  '--primary-color', '--primary-hover', '--primary-pressed', '--primary-light',
  '--primary-text', '--primary-rgb', '--primary-soft', '--primary-soft-strong',
  '--gradient-primary',
] as const

watchEffect(() => {
  if (typeof document === 'undefined') return
  const style = document.body.style
  const a = accent.value
  if (!a) {
    for (const v of ACCENT_VARS) style.removeProperty(v)
    return
  }
  style.setProperty('--primary-color', a.primary)
  style.setProperty('--primary-hover', a.primaryHover)
  style.setProperty('--primary-pressed', a.primaryPressed)
  style.setProperty('--primary-light', a.primaryLight)
  style.setProperty('--primary-text', a.primaryText)
  style.setProperty('--primary-rgb', a.primaryRgb)
  style.setProperty('--primary-soft', a.primarySoft)
  style.setProperty('--primary-soft-strong', a.primarySoftStrong)
  style.setProperty('--gradient-primary', a.gradientPrimary)
})

// B3 · 打印固定浅色：JS 为主（临时移除 dark-mode），@media print 为 CSS 兜底。
let wasDarkBeforePrint = false
function beforePrint() {
  wasDarkBeforePrint = document.body.classList.contains('dark-mode')
  document.body.classList.remove('dark-mode')
}
function afterPrint() {
  if (wasDarkBeforePrint) document.body.classList.add('dark-mode')
}

onMounted(() => {
  window.addEventListener('beforeprint', beforePrint)
  window.addEventListener('afterprint', afterPrint)
})
onUnmounted(() => {
  window.removeEventListener('beforeprint', beforePrint)
  window.removeEventListener('afterprint', afterPrint)
})
</script>
