// =====================================================================
// JS 侧唯一色源（naive-ui themeOverrides 的数值来源）
// ---------------------------------------------------------------------
// 为什么需要这份文件：
//   naive-ui 会对 primaryColor 做运算派生 hover / pressed，因此
//   themeOverrides 里「不能写 var(--x)」，必须是最终数值。
//   于是颜色出现两套真相：CSS 侧 theme.scss（var(--x)）与 JS 侧 palette。
//   本文件即 JS 侧唯一数值源；tests/palette-consistency.test.ts 负责
//   锁定它与 theme.scss 数值一致，避免「双源漂移」。
//
// 约定：
//   - 值为**最终数值**（一律小写 hex），字段名 camelCase 对应 theme.scss 的 kebab-case；
//   - 仅收录 themeOverrides 需要的字段（14 hero + 本轮新增 bgColor / borderLight）；
//   - 学科色为主题无关常量（与 variables.scss 一致）；
//   - 三套学段预设 × {浅, 深} = 6 组，见 presets。
// =====================================================================

import type { GlobalThemeOverrides } from 'naive-ui'

/** 学段预设：primary=小学 / junior=初中(默认) / senior=高中 */
export type ThemePreset = 'primary' | 'junior' | 'senior'
/** 明暗模式 */
export type ThemeMode = 'light' | 'dark'

/** 一套主题（某 preset 的浅或深）下，themeOverrides 需要的颜色字段。 */
export interface ThemeColors {
  /** --primary-color */
  primary: string
  /** --primary-hover */
  primaryHover: string
  /** --primary-pressed */
  primaryPressed: string
  /** naive-ui primaryColorSuppl（无独立 CSS 变量，取 hover 值） */
  primarySuppl: string
  /** --success-color */
  success: string
  /** --warning-color */
  warning: string
  /** --danger-color */
  danger: string
  /** --info-color */
  info: string
  /** --card-bg */
  cardBg: string
  /** --bg-color（★ 本轮新增：图表背景需要） */
  bgColor: string
  /** --text-main */
  textMain: string
  /** --text-sub */
  textSub: string
  /** --text-muted */
  textMuted: string
  /** --border-color */
  border: string
  /** --border-light（★ 本轮新增：图表轴需要） */
  borderLight: string
}

/** 学科专属色（主题无关，保留学科辨识度）。 */
export interface SubjectColors {
  /** $subject-chinese */
  chinese: string
  /** $subject-chinese-deep */
  chineseDeep: string
  /** $subject-chinese-accent */
  chineseAccent: string
  /** $subject-chinese-soft */
  chineseSoft: string
  /** $subject-english */
  english: string
  /** $subject-english-light */
  englishLight: string
}

/** 完整调色板：呈现层的唯一取值处。 */
export interface ThemePalette {
  /** ★ 2 组 → 6 组：三套学段预设 × {浅, 深} */
  presets: Record<ThemePreset, Record<ThemeMode, ThemeColors>>
  subjects: SubjectColors
  radius: Record<string, string>
  /** ★ 按 (preset,mode)；仅 primary 随学段变，其余四个跨学段恒定 */
  gradients: Record<ThemePreset, Record<ThemeMode, Record<string, string>>>
}

/** naive-ui 字号档位（B1 单一缩放源）。 */
export interface FontSizes {
  fontSizeTiny: string
  fontSizeSmall: string
  fontSizeMedium: string
  fontSizeLarge: string
  fontSizeHuge: string
}

/** 字号档位常量（从 App.vue 的 fontSizeMap 迁入，JS 唯一源）。 */
export const FONT_SIZE_MAPS: Record<'small' | 'medium' | 'large', FontSizes> = {
  small: { fontSizeTiny: '11px', fontSizeSmall: '12px', fontSizeMedium: '13px', fontSizeLarge: '14px', fontSizeHuge: '16px' },
  medium: { fontSizeTiny: '12px', fontSizeSmall: '13px', fontSizeMedium: '14px', fontSizeLarge: '15px', fontSizeHuge: '17px' },
  large: { fontSizeTiny: '13px', fontSizeSmall: '14px', fontSizeMedium: '16px', fontSizeLarge: '18px', fontSizeHuge: '20px' },
}

/** 非主色渐变（维度 B，跨学段恒定）：浅色一套 / 深色一套。 */
const GRADIENT_LIGHT = {
  warm: 'linear-gradient(135deg, #d97706 0%, #e05d4a 100%)',
  cool: 'linear-gradient(135deg, #0e7490 0%, #2563eb 100%)',
  success: 'linear-gradient(135deg, #15803d 0%, #0ea5a0 100%)',
  sunset: 'linear-gradient(135deg, #e8871e 0%, #d4537e 100%)',
}
const GRADIENT_DARK = {
  warm: 'linear-gradient(135deg, #b45309 0%, #b8453a 100%)',
  cool: 'linear-gradient(135deg, #0b5f75 0%, #1d4ed8 100%)',
  success: 'linear-gradient(135deg, #166534 0%, #0b8b87 100%)',
  sunset: 'linear-gradient(135deg, #c26a15 0%, #b0436a 100%)',
}

/** JS 侧唯一色源。值均为小写 hex，与 theme.scss 一一对应。 */
export const palette: ThemePalette = {
  presets: {
    // ---------------- 小学（阳光橙） ----------------
    primary: {
      light: {
        primary: '#f2760c',
        primaryHover: '#d96706',
        primaryPressed: '#bd5a05',
        primarySuppl: '#d96706',
        success: '#16a34a',
        warning: '#c9820a',
        danger: '#dc2626',
        info: '#2563eb',
        cardBg: '#ffffff',
        bgColor: '#fff8f1',
        textMain: '#2c1f12',
        textSub: '#5c4a38',
        textMuted: '#877665',
        border: '#f0ddc8',
        borderLight: '#f7ecdd',
      },
      dark: {
        primary: '#ffa447',
        primaryHover: '#ffb368',
        primaryPressed: '#e58a2f',
        primarySuppl: '#ffb368',
        success: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
        info: '#60a5fa',
        cardBg: '#241a11',
        bgColor: '#1a130c',
        textMain: '#f6ede1',
        textSub: '#cdbcab',
        textMuted: '#9c8b79',
        border: '#3d2e1f',
        borderLight: '#2b2013',
      },
    },
    // ---------------- 初中（深松绿 · 现状原值 · 零回归） ----------------
    junior: {
      light: {
        primary: '#2d6a4f',
        primaryHover: '#245741',
        primaryPressed: '#1c4633',
        primarySuppl: '#245741',
        success: '#15803d',
        warning: '#b45309',
        danger: '#dc2626',
        info: '#2563eb',
        cardBg: '#ffffff',
        bgColor: '#f6f8f5',
        textMain: '#16261f',
        textSub: '#3f574c',
        textMuted: '#5f756a',
        border: '#cfdcd5',
        borderLight: '#e5ede8',
      },
      dark: {
        primary: '#4fa57f',
        primaryHover: '#5fb88f',
        primaryPressed: '#3f8a69',
        primarySuppl: '#5fb88f',
        success: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
        info: '#60a5fa',
        cardBg: '#15211c',
        bgColor: '#0d1613',
        textMain: '#e8f1ec',
        textSub: '#b6c8bf',
        textMuted: '#8b9c93',
        border: '#2a3b34',
        borderLight: '#1f2e28',
      },
    },
    // ---------------- 高中（沉静蓝灰） ----------------
    senior: {
      light: {
        primary: '#3b5b7a',
        primaryHover: '#2f4a63',
        primaryPressed: '#263c50',
        primarySuppl: '#2f4a63',
        success: '#15803d',
        warning: '#b45309',
        danger: '#dc2626',
        info: '#2563eb',
        cardBg: '#ffffff',
        bgColor: '#f4f6f9',
        textMain: '#1c2530',
        textSub: '#44515f',
        textMuted: '#66717d',
        border: '#d3dbe3',
        borderLight: '#e6ebf0',
      },
      dark: {
        primary: '#7fa3c4',
        primaryHover: '#93b3d0',
        primaryPressed: '#6a8dae',
        primarySuppl: '#93b3d0',
        success: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
        info: '#60a5fa',
        cardBg: '#161e27',
        bgColor: '#0e1319',
        textMain: '#e9eef4',
        textSub: '#b5c0cc',
        textMuted: '#8a95a1',
        border: '#28333f',
        borderLight: '#1a222b',
      },
    },
  },
  subjects: {
    chinese: '#8a6b4a',
    chineseDeep: '#5b4226',
    chineseAccent: '#b7791f',
    chineseSoft: '#d4b87a',
    english: '#1a5490',
    englishLight: '#4a90d9',
  },
  radius: {
    xs: '6px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    control: '10px',
    full: '999px',
  },
  gradients: {
    primary: {
      light: { primary: 'linear-gradient(135deg, #f2760c 0%, #ffa447 100%)', ...GRADIENT_LIGHT },
      dark: { primary: 'linear-gradient(135deg, #e58a2f 0%, #ffa447 100%)', ...GRADIENT_DARK },
    },
    junior: {
      light: { primary: 'linear-gradient(135deg, #2d6a4f 0%, #4fa57f 100%)', ...GRADIENT_LIGHT },
      dark: { primary: 'linear-gradient(135deg, #255c43 0%, #3f8a69 100%)', ...GRADIENT_DARK },
    },
    senior: {
      light: { primary: 'linear-gradient(135deg, #3b5b7a 0%, #7fa3c4 100%)', ...GRADIENT_LIGHT },
      dark: { primary: 'linear-gradient(135deg, #5b7d9e 0%, #7fa3c4 100%)', ...GRADIENT_DARK },
    },
  },
}

/**
 * 由调色板派生 naive-ui 的 themeOverrides（纯函数，便于单测）。
 *
 * @param palette 调色板（JS 侧唯一色源）
 * @param preset  学段预设：'primary' | 'junior' | 'senior'
 * @param theme   实际生效明暗：'light' | 'dark'
 * @param sizes   当前字号档位
 * @returns naive-ui 的 GlobalThemeOverrides
 */
export function buildThemeOverrides(
  palette: ThemePalette,
  preset: ThemePreset,
  theme: ThemeMode,
  sizes: FontSizes,
): GlobalThemeOverrides {
  const c: ThemeColors = palette.presets[preset][theme]

  return {
    common: {
      // 主色（naive-ui 会据此派生 hover / pressed，故必须是数值而非 var()）
      primaryColor: c.primary,
      primaryColorHover: c.primaryHover,
      primaryColorPressed: c.primaryPressed,
      primaryColorSuppl: c.primarySuppl,
      borderRadius: '10px',
      borderRadiusSmall: '8px',
      fontFamily: `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif`,
      fontWeight: '500',
      fontWeightStrong: '700',
      textColorBase: c.textMain,
      textColor1: c.textMain,
      textColor2: c.textSub,
      textColor3: c.textMuted,
      borderColor: c.border,
      ...sizes,
    },
    Card: {
      borderRadius: '16px',
      color: c.cardBg,
      titleFontWeight: '700',
      titleFontSizeMedium: sizes.fontSizeMedium,
      titleFontSizeLarge: sizes.fontSizeLarge,
    },
    Button: {
      borderRadiusMedium: '10px',
      fontWeight: '600',
      fontWeightStrong: '700',
    },
    Input: {
      borderRadius: '10px',
    },
    Tag: {
      fontWeightStrong: '600',
    },
    Menu: {
      fontSize: `${sizes.fontSizeMedium}px`,
    },
  }
}
