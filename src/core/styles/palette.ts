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
//   - 仅收录 themeOverrides 需要的字段；
//   - 学科色为主题无关常量（与 variables.scss 一致）。
// =====================================================================

import type { GlobalThemeOverrides } from 'naive-ui'

/** 一套主题（浅或深）下，themeOverrides 需要的颜色字段。 */
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
  /** --text-main */
  textMain: string
  /** --text-sub */
  textSub: string
  /** --text-muted */
  textMuted: string
  /** --border-color */
  border: string
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

/** 完整调色板：App.vue 的唯一取值处。 */
export interface ThemePalette {
  light: ThemeColors
  dark: ThemeColors
  subjects: SubjectColors
  radius: Record<string, string>
  gradients: Record<string, string>
}

/** naive-ui 字号档位（由 App.vue 的 fontSizeMap 提供）。 */
export interface FontSizes {
  fontSizeTiny: string
  fontSizeSmall: string
  fontSizeMedium: string
  fontSizeLarge: string
  fontSizeHuge: string
}

/** JS 侧唯一色源。值均为小写 hex，与 theme.scss 一一对应。 */
export const palette: ThemePalette = {
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
    textMain: '#16261f',
    textSub: '#3f574c',
    textMuted: '#5f756a',
    border: '#cfdcd5',
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
    textMain: '#e8f1ec',
    textSub: '#b6c8bf',
    textMuted: '#8b9c93',
    border: '#2a3b34',
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
    primary: 'linear-gradient(135deg, #2d6a4f 0%, #4fa57f 100%)',
    warm: 'linear-gradient(135deg, #d97706 0%, #e05d4a 100%)',
    cool: 'linear-gradient(135deg, #0e7490 0%, #2563eb 100%)',
    success: 'linear-gradient(135deg, #15803d 0%, #0ea5a0 100%)',
    sunset: 'linear-gradient(135deg, #e8871e 0%, #d4537e 100%)',
  },
}

/**
 * 由调色板派生 naive-ui 的 themeOverrides（从 App.vue 抽取的纯函数，便于单测）。
 *
 * @param palette 调色板（JS 侧唯一色源）
 * @param theme   实际生效主题：'light' | 'dark'
 * @param sizes   当前字号档位
 * @returns naive-ui 的 GlobalThemeOverrides
 */
export function buildThemeOverrides(
  palette: ThemePalette,
  theme: string,
  sizes: FontSizes,
): GlobalThemeOverrides {
  const c: ThemeColors = theme === 'dark' ? palette.dark : palette.light

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
