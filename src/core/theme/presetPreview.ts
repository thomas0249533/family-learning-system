// =====================================================================
// 服务层 · 学段预设元数据与色带预览
// ---------------------------------------------------------------------
// 设置页需要同时展示「三套预设」的配色预览，而 useThemeTokens 只能读到
// 当前生效的一套。故这里提供按 preset 直读 palette 的服务层封装，
// 使组件（Settings.vue）无需直接 import palette（§8.5）。
// =====================================================================

import { palette, type ThemePreset } from '@core/styles/palette'

/** 三套预设的展示元数据。 */
export interface PresetMeta {
  value: ThemePreset
  /** 名称：小学 / 初中 / 高中 */
  name: string
  /** 一句话定位 */
  tagline: string
  /** 图标 */
  icon: string
}

export const PRESET_META: PresetMeta[] = [
  { value: 'primary', name: '小学', tagline: '暖亮活泼', icon: '🌞' },
  { value: 'junior', name: '初中', tagline: '清新松绿', icon: '🌿' },
  { value: 'senior', name: '高中', tagline: '沉静蓝灰', icon: '🏔️' },
]

export interface PresetPreview {
  /** 主色 */
  primary: string
  /** 页面底色 */
  bg: string
  /** 卡片底色 */
  card: string
}

/** 取某预设「浅色」下的三色预览（顶部色带）。 */
export function presetPreview(preset: ThemePreset): PresetPreview {
  const c = palette.presets[preset].light
  return { primary: c.primary, bg: c.bgColor, card: c.cardBg }
}
