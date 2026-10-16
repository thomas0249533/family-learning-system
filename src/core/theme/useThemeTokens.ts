// =====================================================================
// 服务层 · 读取「当前生效」的主题 CSS 变量（供模板内联样式取真值）
// ---------------------------------------------------------------------
// 边界规则（§8.5）：src/views/**、src/modules/**、src/components/** 禁止直接
//   `import { palette }`；JS 取色一律经本服务层 / useChartTheme / pdfExporter。
//
// 本模块从 body 的 computedStyle 读取 CSS 变量「最终数值」，因此天然反映
//   6 组选择器命中后的真实颜色，无需感知 preset/mode 细节。
// =====================================================================

import { computed, type ComputedRef } from 'vue'
import { useThemeStore } from '@core/stores/theme'

/** 常用主题 token（camelCase → --kebab-case）。 */
export interface ThemeTokens {
  primary: string
  primaryHover: string
  primaryPressed: string
  success: string
  warning: string
  danger: string
  info: string
  bgColor: string
  bgColorHover: string
  cardBg: string
  surface2: string
  textMain: string
  textSub: string
  textMuted: string
  border: string
  borderLight: string
  primaryRgb: string
  onStrong: string
}

/** token 名 → CSS 变量名。 */
export const TOKEN_TO_VAR: Record<keyof ThemeTokens, string> = {
  primary: '--primary-color',
  primaryHover: '--primary-hover',
  primaryPressed: '--primary-pressed',
  success: '--success-color',
  warning: '--warning-color',
  danger: '--danger-color',
  info: '--info-color',
  bgColor: '--bg-color',
  bgColorHover: '--bg-color-hover',
  cardBg: '--card-bg',
  surface2: '--surface-2',
  textMain: '--text-main',
  textSub: '--text-sub',
  textMuted: '--text-muted',
  border: '--border-color',
  borderLight: '--border-light',
  primaryRgb: '--primary-rgb',
  onStrong: '--on-strong',
}

/** 一次性读取单个 CSS 变量（非响应式）。 */
export function resolveToken(name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

/** 一次性读取全部主题 token 数值（非响应式）。 */
export function resolveTokens(): ThemeTokens {
  const out = {} as ThemeTokens
  for (const k of Object.keys(TOKEN_TO_VAR) as (keyof ThemeTokens)[]) {
    out[k] = resolveToken(TOKEN_TO_VAR[k])
  }
  return out
}

/**
 * 响应式读取当前生效 token。
 * 依赖 themeStore.preset / actualTheme：二者变化时 computed 失效并重算，
 * 而 body 上的 class / data-* 已由 store 的 watchEffect 同步，故取到新值。
 */
export function useThemeTokens(): ComputedRef<ThemeTokens> {
  const themeStore = useThemeStore()
  return computed(() => {
    // 建立响应式依赖（值本身不用，仅用于触发重算）
    void themeStore.preset
    void themeStore.actualTheme
    return resolveTokens()
  })
}
