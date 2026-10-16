// =====================================================================
// 设计 Token · 唯一源（Source of Truth）—— 手写，勿被误认为生成物
// ---------------------------------------------------------------------
// 三层 token：
//   · primitive（本文件 HUES / NEUTRALS / RADIUS / SPACE / FONT / LEADING /
//     MOTION / SUBJECTS）：最小不可再分；组件**永不直接引用**。
//   · semantic（buildSemantic 产出的「角色名 → 值」表；落盘为 theme.scss 的
//     --var 与 palette.ts 的真值）：组件用 var(--x) / SCSS 门面 $x。
//   · component（COMPONENT_TOKENS → components.scss）：组件级别名，纯 var()。
//
// ⚠️ 本文件是**唯一的颜色真相源**。theme.scss 与 palette.ts 均由本文件经
//    `npm run tokens:build` 生成（AUTO-GENERATED，勿手改）。
//
// 派生 vs 显式（§1.2「可证等价者派生，手工调校者显式」）：
//   · 派生：--{primary,success,warning,danger,info}-rgb（5）
//            --{…}-soft（5）、--primary-soft-strong（1） = 11 个/组。
//   · 显式：-light 五色、bg-color-hover、surface-2、text-on-primary、
//            border-light、gradient-primary、band-*×6、shadow-*、code-color、
//            on-strong、非主色 gradient（+ 其余全部）。
//   **禁止「全量派生」**——会把现有手调色值改成公式结果，破坏视觉零变化。
//
// 维度 A/B（§8.4 不变量 4）：
//   · A（preset · 换色相）：HUES[preset][mode] —— 品牌/语义/bg/text/border/主渐变。
//   · B（mode · 换明度 + 中性）：NEUTRALS[mode] —— shadow/band/code/非主色渐变。
// =====================================================================

/** 学段预设：primary=小学 / junior=初中(默认) / senior=高中 */
export type ThemePreset = 'primary' | 'junior' | 'senior'
/** 明暗模式 */
export type ThemeMode = 'light' | 'dark'

/** 三套学段预设（**注意顺序**：primary → junior → senior，与 palette 键顺序一致）。 */
export const PRESETS: ThemePreset[] = ['primary', 'junior', 'senior']
/** 明暗两档。 */
export const MODES: ThemeMode[] = ['light', 'dark']

/* =====================================================================
 * 第 1 层 · primitive
 * ===================================================================== */

/**
 * 维度 A · 随 preset 变（hero 色相 + 手调浅底 + 主渐变）；含 3 学段 × 2 明暗。
 * 每字段均为**最终值**（小写 hex / 复合值原样），逐字节抄录自现状 theme.scss。
 */
export interface HuePrimitives {
  /** --primary-color */
  brand: string
  /** --primary-hover */
  brandHover: string
  /** --primary-pressed */
  brandPressed: string
  /** --primary-light（手调浅底 · 显式） */
  brandLight: string
  /** --success-color */
  success: string
  /** --success-light */
  successLight: string
  /** --warning-color */
  warning: string
  /** --warning-light */
  warningLight: string
  /** --danger-color */
  danger: string
  /** --danger-light */
  dangerLight: string
  /** --info-color */
  info: string
  /** --info-light */
  infoLight: string
  /** --bg-color */
  bg: string
  /** --bg-color-hover */
  bgHover: string
  /** --card-bg */
  card: string
  /** --surface-2 */
  surface2: string
  /** --text-main */
  textMain: string
  /** --text-sub */
  textSub: string
  /** --text-muted */
  textMuted: string
  /** --text-on-primary */
  textOnPrimary: string
  /** --border-color */
  border: string
  /** --border-light */
  borderLight: string
  /** --gradient-primary（手挑 a/b · 显式） */
  gradientPrimary: string
}

/**
 * 维度 A · 6 组原始色。值逐字节抄录自现状 `theme.scss`。
 * 组合深色块（primary.dark / senior.dark）未覆写的语义色，此处填**生效值**
 * （= 初中深色，来自 body.dark-mode 继承），供 buildSemantic 派生与 palette 使用；
 * 但生成器对组合块**只 emit 其真正声明的子集**，不把这些继承值写进 combo 块。
 */
export const HUES: Record<ThemePreset, Record<ThemeMode, HuePrimitives>> = {
  primary: {
    light: {
      brand: '#f2760c', brandHover: '#d96706', brandPressed: '#bd5a05', brandLight: '#ffeede',
      success: '#16a34a', successLight: '#e7f8ee',
      warning: '#c9820a', warningLight: '#fbf1e0',
      danger: '#dc2626', dangerLight: '#fdeded',
      info: '#2563eb', infoLight: '#eaf1fe',
      bg: '#fff8f1', bgHover: '#f7ebdf', card: '#ffffff', surface2: '#fffcf9',
      textMain: '#2c1f12', textSub: '#5c4a38', textMuted: '#877665', textOnPrimary: '#ffffff',
      border: '#f0ddc8', borderLight: '#f7ecdd',
      gradientPrimary: 'linear-gradient(135deg, #f2760c 0%, #ffa447 100%)',
    },
    dark: {
      brand: '#ffa447', brandHover: '#ffb368', brandPressed: '#e58a2f', brandLight: '#3a2415',
      success: '#4ade80', successLight: '#14301f',
      warning: '#fbbf24', warningLight: '#3a2a12',
      danger: '#f87171', dangerLight: '#3a1a1a',
      info: '#60a5fa', infoLight: '#16243e',
      bg: '#1a130c', bgHover: '#2a1e12', card: '#241a11', surface2: '#2b2014',
      textMain: '#f6ede1', textSub: '#cdbcab', textMuted: '#9c8b79', textOnPrimary: '#1a1005',
      border: '#3d2e1f', borderLight: '#2b2013',
      gradientPrimary: 'linear-gradient(135deg, #e58a2f 0%, #ffa447 100%)',
    },
  },
  junior: {
    light: {
      brand: '#2d6a4f', brandHover: '#245741', brandPressed: '#1c4633', brandLight: '#e7f3ed',
      success: '#15803d', successLight: '#e9f8ef',
      warning: '#b45309', warningLight: '#fdf4e7',
      danger: '#dc2626', dangerLight: '#fdeded',
      info: '#2563eb', infoLight: '#eaf1fe',
      bg: '#f6f8f5', bgHover: '#ebf0ec', card: '#ffffff', surface2: '#f9fbf9',
      textMain: '#16261f', textSub: '#3f574c', textMuted: '#5f756a', textOnPrimary: '#ffffff',
      border: '#cfdcd5', borderLight: '#e5ede8',
      gradientPrimary: 'linear-gradient(135deg, #2d6a4f 0%, #4fa57f 100%)',
    },
    dark: {
      brand: '#4fa57f', brandHover: '#5fb88f', brandPressed: '#3f8a69', brandLight: '#1c3a2c',
      success: '#4ade80', successLight: '#14301f',
      warning: '#fbbf24', warningLight: '#3a2a12',
      danger: '#f87171', dangerLight: '#3a1a1a',
      info: '#60a5fa', infoLight: '#16243e',
      bg: '#0d1613', bgHover: '#1b2a24', card: '#15211c', surface2: '#1a2822',
      textMain: '#e8f1ec', textSub: '#b6c8bf', textMuted: '#8b9c93', textOnPrimary: '#08120e',
      border: '#2a3b34', borderLight: '#1f2e28',
      gradientPrimary: 'linear-gradient(135deg, #255c43 0%, #3f8a69 100%)',
    },
  },
  senior: {
    light: {
      brand: '#3b5b7a', brandHover: '#2f4a63', brandPressed: '#263c50', brandLight: '#e8eef4',
      success: '#15803d', successLight: '#e9f8ef',
      warning: '#b45309', warningLight: '#fdf4e7',
      danger: '#dc2626', dangerLight: '#fdeded',
      info: '#2563eb', infoLight: '#eaf1fe',
      bg: '#f4f6f9', bgHover: '#e9edf2', card: '#ffffff', surface2: '#fafbfd',
      textMain: '#1c2530', textSub: '#44515f', textMuted: '#66717d', textOnPrimary: '#ffffff',
      border: '#d3dbe3', borderLight: '#e6ebf0',
      gradientPrimary: 'linear-gradient(135deg, #3b5b7a 0%, #7fa3c4 100%)',
    },
    dark: {
      brand: '#7fa3c4', brandHover: '#93b3d0', brandPressed: '#6a8dae', brandLight: '#1e2a36',
      success: '#4ade80', successLight: '#14301f',
      warning: '#fbbf24', warningLight: '#3a2a12',
      danger: '#f87171', dangerLight: '#3a1a1a',
      info: '#60a5fa', infoLight: '#16243e',
      bg: '#0e1319', bgHover: '#1b232e', card: '#161e27', surface2: '#1c2530',
      textMain: '#e9eef4', textSub: '#b5c0cc', textMuted: '#8a95a1', textOnPrimary: '#0a0f14',
      border: '#28333f', borderLight: '#1a222b',
      gradientPrimary: 'linear-gradient(135deg, #5b7d9e 0%, #7fa3c4 100%)',
    },
  },
}

/** 维度 B · 跨学段恒定，只随明暗变（shadow / band / code / 非主色渐变）。 */
export interface ModeNeutrals {
  /** --shadow-xs */
  shadowXs: string
  /** --shadow-sm */
  shadowSm: string
  /** --shadow */
  shadow: string
  /** --shadow-md */
  shadowMd: string
  /** --shadow-lg */
  shadowLg: string
  /** --shadow-up */
  shadowUp: string
  /** --band-success-bg */
  bandSuccessBg: string
  /** --band-success-border */
  bandSuccessBorder: string
  /** --band-warning-bg */
  bandWarningBg: string
  /** --band-warning-border */
  bandWarningBorder: string
  /** --band-danger-bg */
  bandDangerBg: string
  /** --band-danger-border */
  bandDangerBorder: string
  /** --code-color */
  codeColor: string
  /** --gradient-warm */
  gradientWarm: string
  /** --gradient-cool */
  gradientCool: string
  /** --gradient-success */
  gradientSuccess: string
  /** --gradient-sunset */
  gradientSunset: string
}

/** 维度 B · 2 组中性值（逐字节抄录自现状 theme.scss）。 */
export const NEUTRALS: Record<ThemeMode, ModeNeutrals> = {
  light: {
    shadowXs: '0 1px 2px rgba(22, 38, 31, 0.06)',
    shadowSm: '0 1px 3px rgba(22, 38, 31, 0.08), 0 1px 2px rgba(22, 38, 31, 0.05)',
    shadow: '0 4px 12px rgba(22, 38, 31, 0.08)',
    shadowMd: '0 8px 24px rgba(22, 38, 31, 0.10)',
    shadowLg: '0 20px 40px rgba(22, 38, 31, 0.12)',
    shadowUp: '0 -4px 16px rgba(0, 0, 0, 0.06)',
    bandSuccessBg: '#effcf4', bandSuccessBorder: '#c8f0d8',
    bandWarningBg: '#fff9ec', bandWarningBorder: '#ffe4b0',
    bandDangerBg: '#fff0f0', bandDangerBorder: '#ffd4d4',
    codeColor: '#c7254e',
    gradientWarm: 'linear-gradient(135deg, #d97706 0%, #e05d4a 100%)',
    gradientCool: 'linear-gradient(135deg, #0e7490 0%, #2563eb 100%)',
    gradientSuccess: 'linear-gradient(135deg, #15803d 0%, #0ea5a0 100%)',
    gradientSunset: 'linear-gradient(135deg, #e8871e 0%, #d4537e 100%)',
  },
  dark: {
    shadowXs: '0 1px 2px rgba(0, 0, 0, 0.30)',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.40), 0 1px 2px rgba(0, 0, 0, 0.30)',
    shadow: '0 4px 12px rgba(0, 0, 0, 0.40)',
    shadowMd: '0 8px 24px rgba(0, 0, 0, 0.48)',
    shadowLg: '0 20px 40px rgba(0, 0, 0, 0.56)',
    shadowUp: '0 -4px 16px rgba(0, 0, 0, 0.30)',
    bandSuccessBg: '#14301f', bandSuccessBorder: '#1e4a2f',
    bandWarningBg: '#3a2a12', bandWarningBorder: '#563d13',
    bandDangerBg: '#3a1a1a', bandDangerBorder: '#542222',
    codeColor: '#f08aa8',
    gradientWarm: 'linear-gradient(135deg, #b45309 0%, #b8453a 100%)',
    gradientCool: 'linear-gradient(135deg, #0b5f75 0%, #1d4ed8 100%)',
    gradientSuccess: 'linear-gradient(135deg, #166534 0%, #0b8b87 100%)',
    gradientSunset: 'linear-gradient(135deg, #c26a15 0%, #b0436a 100%)',
  },
}

/** 恒白前景色（主题无关，仅 :root 定义一次，深色不覆盖）——饱和色块上的文字/图标。 */
export const ON_STRONG = { color: '#ffffff', rgb: '255, 255, 255' } as const

/** 圆角（不随主题变）。 */
export const RADIUS = {
  xs: '6px', sm: '8px', md: '12px', lg: '16px', xl: '20px', control: '10px', full: '999px',
} as const

/** 间距（8pt 网格，不随主题变）。 */
export const SPACE = {
  1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 7: '28px', 8: '32px',
  10: '40px', 12: '48px', 16: '64px',
} as const

/** 字号阶梯（不随主题变；naive 覆盖为唯一缩放源，勿引入 rem）。 */
export const FONT = {
  '2xs': '11px', xs: '12px', sm: '13px', base: '14px', md: '15px', lg: '16px',
  xl: '18px', '2xl': '20px', '3xl': '22px', '4xl': '24px', '5xl': '32px',
} as const

/** 行高（不随主题变）。 */
export const LEADING = { tight: '1.25', snug: '1.4', normal: '1.55', relaxed: '1.7' } as const

/** 动效（曲线 + 时长，不随主题变）。 */
export const MOTION = {
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeEmphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  easeDecelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  durationFast: '120ms',
  durationBase: '200ms',
  durationSlow: '300ms',
  durationSlower: '450ms',
} as const

/** 学科色（主题无关常量，与 variables.scss 一致）。 */
export const SUBJECTS = {
  chinese: '#8a6b4a',
  chineseDeep: '#5b4226',
  chineseAccent: '#b7791f',
  chineseSoft: '#d4b87a',
  english: '#1a5490',
  englishLight: '#4a90d9',
} as const

/* =====================================================================
 * 第 2 层 · semantic
 * ===================================================================== */

/** 派生柔光的 alpha（**字符串**，保证生成物与本现逐字节一致：0.10 / 0.14）。 */
export const SOFT_ALPHA = { light: '0.10', dark: '0.14' } as const
/** 派生强柔光的 alpha（0.18 / 0.24）。 */
export const SOFT_STRONG_ALPHA = { light: '0.18', dark: '0.24' } as const

/**
 * 把 3/6 位 hex 转成 `rgb()` 用的三元组字符串。
 * `'#2d6a4f'` → `'45, 106, 79'`（逗号 + 空格分隔，与 theme.scss 一致）。
 */
export function rgbTuple(hex: string): string {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

/** semantic 表：键 = CSS 变量名去掉 `--` 前缀；值 = 最终字符串。 */
export type SemanticTokens = Record<string, string>

/**
 * 由 primitive 派生某 (preset, mode) 的**完整生效 semantic 表**。
 * 派生规则集中于此：-rgb（5）、-soft（5）、-primary-soft-strong（1）= 11 个派生，
 * 其余全部显式取自 HUES / NEUTRALS / ON_STRONG。键顺序即生成器输出顺序参考。
 */
export function buildSemantic(preset: ThemePreset, mode: ThemeMode): SemanticTokens {
  const h = HUES[preset][mode]
  const n = NEUTRALS[mode]
  const soft = SOFT_ALPHA[mode]
  const softStrong = SOFT_STRONG_ALPHA[mode]
  const b = rgbTuple(h.brand)
  return {
    'primary-color': h.brand,
    'primary-hover': h.brandHover,
    'primary-pressed': h.brandPressed,
    'primary-light': h.brandLight,
    'primary-soft': `rgba(${b}, ${soft})`,
    'primary-soft-strong': `rgba(${b}, ${softStrong})`,

    'success-color': h.success,
    'success-light': h.successLight,
    'success-soft': `rgba(${rgbTuple(h.success)}, ${soft})`,
    'warning-color': h.warning,
    'warning-light': h.warningLight,
    'warning-soft': `rgba(${rgbTuple(h.warning)}, ${soft})`,
    'danger-color': h.danger,
    'danger-light': h.dangerLight,
    'danger-soft': `rgba(${rgbTuple(h.danger)}, ${soft})`,
    'info-color': h.info,
    'info-light': h.infoLight,
    'info-soft': `rgba(${rgbTuple(h.info)}, ${soft})`,

    'primary-rgb': b,
    'success-rgb': rgbTuple(h.success),
    'warning-rgb': rgbTuple(h.warning),
    'danger-rgb': rgbTuple(h.danger),
    'info-rgb': rgbTuple(h.info),

    'on-strong': ON_STRONG.color,
    'on-strong-rgb': ON_STRONG.rgb,

    'band-success-bg': n.bandSuccessBg,
    'band-success-border': n.bandSuccessBorder,
    'band-warning-bg': n.bandWarningBg,
    'band-warning-border': n.bandWarningBorder,
    'band-danger-bg': n.bandDangerBg,
    'band-danger-border': n.bandDangerBorder,

    'code-color': n.codeColor,

    'bg-color': h.bg,
    'bg-color-hover': h.bgHover,
    'card-bg': h.card,
    'surface-2': h.surface2,
    'text-main': h.textMain,
    'text-sub': h.textSub,
    'text-muted': h.textMuted,
    'text-on-primary': h.textOnPrimary,
    'border-color': h.border,
    'border-light': h.borderLight,

    'shadow-xs': n.shadowXs,
    'shadow-sm': n.shadowSm,
    'shadow': n.shadow,
    'shadow-md': n.shadowMd,
    'shadow-lg': n.shadowLg,
    'shadow-up': n.shadowUp,

    'gradient-primary': h.gradientPrimary,
    'gradient-warm': n.gradientWarm,
    'gradient-cool': n.gradientCool,
    'gradient-success': n.gradientSuccess,
    'gradient-sunset': n.gradientSunset,
  }
}

/* =====================================================================
 * 第 3 层 · component（组件级别名，落盘为 components.scss，纯 var() 引用）
 * ===================================================================== */

/**
 * 组件级 token（键 = CSS 变量名去 `--`）。值**只允许**引用 semantic（`var(--x)`）
 * 或常量尺寸；**禁止**字面量色。由 `components.scss`（手写）承载，本常量为其
 * 权威镜像，由 `tests/tokens-generation.test.ts` 锁定二者不漂移。
 */
export const COMPONENT_TOKENS: Record<string, string> = {
  // 按钮
  'btn-primary-bg': 'var(--primary-color)',
  'btn-primary-bg-hover': 'var(--primary-hover)',
  'btn-primary-fg': 'var(--on-strong)',
  'btn-focus-ring': 'var(--focus-ring)',
  // 卡片
  'card-header-bg': 'var(--bg-color-hover)',
  // 徽章（软色底）
  'badge-neutral-bg': 'var(--bg-color-hover)',
  'badge-primary-bg': 'var(--primary-light)',
  'badge-success-bg': 'var(--success-light)',
  'badge-warning-bg': 'var(--warning-light)',
  'badge-danger-bg': 'var(--danger-light)',
  'badge-info-bg': 'var(--info-light)',
  // 统计卡
  'stat-value-fg': 'var(--text-main)',
  // 进度条
  'progress-track-bg': 'var(--surface-2)',
  'progress-fill-bg': 'var(--gradient-primary)',
  // 空态
  'empty-icon-fg': 'var(--text-muted)',
  // 页头
  'page-header-border': 'var(--border-light)',
  // 焦点环（§6.4）
  'focus-ring': 'rgba(var(--primary-rgb), 0.55)',
  'focus-ring-w': '2px',
  'focus-ring-offset': '2px',
}
