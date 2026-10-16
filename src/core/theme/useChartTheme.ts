// =====================================================================
// 服务层 · echarts 主题（随明暗 / 学段即时变化）
// ---------------------------------------------------------------------
// 供 Home.vue 的饼图使用：轴 / 文字 / tooltip / 色块全部来自当前生效 token，
// 组件不再直接 import palette（§8.5）。
// =====================================================================

import { computed, type ComputedRef } from 'vue'
import { useThemeTokens, type ThemeTokens } from '@core/theme/useThemeTokens'

export interface ChartTheme {
  /** 轴线颜色 */
  axisLine: string
  /** 分割线颜色 */
  splitLine: string
  /** 次级文字（轴标签等） */
  textSub: string
  /** tooltip 背景 */
  tooltipBg: string
  /** tooltip 文字 */
  tooltipText: string
  /** 主色块 */
  primary: string
  /** 成功色块 */
  success: string
  /** 警告色块 */
  warning: string
  /** 中性 / 未学色块 */
  border: string
  /** 卡片背景（饼图扇区间隙描边用） */
  cardBg: string
}

/** 由 token 派生出 echarts 主题（纯函数，便于复用/测试）。 */
export function buildChartTheme(t: ThemeTokens): ChartTheme {
  return {
    axisLine: t.borderLight || t.border,
    splitLine: t.border,
    textSub: t.textSub,
    tooltipBg: t.cardBg,
    tooltipText: t.textMain,
    primary: t.primary,
    success: t.success,
    warning: t.warning,
    border: t.border,
    cardBg: t.cardBg,
  }
}

/** 响应式 echarts 主题。 */
export function useChartTheme(): ComputedRef<ChartTheme> {
  const tokens = useThemeTokens()
  return computed(() => buildChartTheme(tokens.value))
}
