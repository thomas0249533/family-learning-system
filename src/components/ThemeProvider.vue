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
import { computed, onMounted, onUnmounted } from 'vue'
import { darkTheme, NConfigProvider } from 'naive-ui'
import { useThemeStore } from '@core/stores/theme'
import { palette, buildThemeOverrides, FONT_SIZE_MAPS } from '@core/styles/palette'

const themeStore = useThemeStore()

const themeOverrides = computed(() =>
  buildThemeOverrides(
    palette,
    themeStore.preset,
    themeStore.actualTheme,
    FONT_SIZE_MAPS[themeStore.fontSize] ?? FONT_SIZE_MAPS.medium,
  ),
)

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
