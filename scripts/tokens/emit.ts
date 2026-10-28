// =====================================================================
// Token 生成器 · 纯函数（无副作用）
// ---------------------------------------------------------------------
// 单一出口：generate.ts（写盘）与 check.ts（漂移校验）共用本模块。
// 说明：架构设计把「唯一源」定为 src/core/styles/tokens.ts，本文件只负责把
//   tokens.ts 的 primitive/semantic 渲染成两个产物字符串：
//     · theme.scss  —— CSS 变量（6 组选择器；纯变量文件，无 body/print）
//     · palette.ts  —— JS 数值（naive themeOverrides 用）
//   两者均带 §2.2 banner。产物由 generate.ts 写盘、check.ts 逐字节校验。
//   `import.meta` 主模块判定在 vite-node 下不可靠，故独立成本模块避免
//   「import 即写盘」的副作用（便于 check/测试安全复用）。
// =====================================================================

import {
  HUES,
  NEUTRALS,
  ON_STRONG,
  RADIUS,
  SPACE,
  FONT,
  LEADING,
  MOTION,
  SUBJECTS,
  buildSemantic,
  type SemanticTokens,
  type ThemePreset,
  type ThemeMode,
} from '../../src/core/styles/tokens'

/** §2.2 生成文件头 banner（SCSS / TS 同款文案，用 `//` 注释）。 */
export const BANNER = [
  '// ⚠️ AUTO-GENERATED FILE — DO NOT EDIT.',
  '// Source of truth : src/core/styles/tokens.ts',
  '// Regenerate      : npm run tokens:build',
  '// Drift is caught by: npm run tokens:check  AND  tests/tokens-generation.test.ts',
].join('\n')

/** 统一换行：产物一律以 `\n` 落盘（配合 .gitattributes eol=lf 防 CRLF 漂移）。 */
const NL = '\n'

/** 输出 `  --name: value;`（2 空格缩进）。 */
function vline(name: string, value: string): string {
  return `  --${name}: ${value};`
}

/* =====================================================================
 * theme.scss —— 与 v1.9.0 变量部分逐字节等价（仅前置 banner）
 * ===================================================================== */

/** theme.scss 头部说明（承袭 v1.9.0 源文件，含 §2.1 特异性不变量）。 */
function themeHeader(): string[] {
  return [
    '// =====================================================================',
    '// 主题变量（唯一来源）',
    '// ---------------------------------------------------------------------',
    '// 本文件是本项目「颜色」的唯一 CSS 源。变量分两轴：',
    '//   · 维度 A（preset · 换色相）：--primary-*、语义色族、--bg-color/-hover、',
    '//     --card-bg、--surface-2、--text-*、--text-on-primary、--border-*、',
    '//     --gradient-primary。',
    '//   · 维度 B（mode · 换明度 + 中性）：--shadow-*、--band-*、--code-color、',
    '//     --gradient-warm/cool/success/sunset、--on-strong(-rgb)。',
    '// 决策：维度 B 跨学段恒定（与色相无关的语义/中性值），只随明暗变；',
    '//       仅 --gradient-primary 随学段变。',
    '//',
    '// 六组选择器与特异性（严格按下表，勿改）：',
    '//   :root                                            (0,1,0)  恒        初中·浅全量 + 维度 B 浅',
    '//   body[data-theme-preset="primary"]                (0,1,1)  primary    小学·浅（preset 覆盖）',
    '//   body[data-theme-preset="senior"]                 (0,1,1)  senior     高中·浅（preset 覆盖）',
    '//   body.dark-mode                                   (0,1,1)  有 class   初中·深全量 + 维度 B 深',
    '//   body[data-theme-preset="primary"].dark-mode      (0,2,1)  both       小学·深（组合覆盖）',
    '//   body[data-theme-preset="senior"].dark-mode       (0,2,1)  both       高中·深（组合覆盖）',
    '//',
    '// ⚠️ 关键不变量（防历史「特异性 bug」复发）：',
    '//   1. --bg-color / --card-bg / 所有主题色变量只在本文件定义；',
    '//      index.scss 不得再引入任何定义主题变量的选择器。',
    '//   2. 深色 + 非默认学段必须命中 (0,2,1) 组合选择器（比单维 (0,1,1) 高），',
    '//      因此两个组合块「必须存在且非空」——漏写 → 深色串成学段浅色。',
    '//   3. 属性=junior/缺失时不命中任何 preset 规则，body 直接继承 :root。',
    '//   4. 组件侧一律 var(--x)，不得写死色值。',
    '// =====================================================================',
  ]
}

/** `:root {}` · 尺寸 / 字号 / 动效（不随主题变）。 */
function themeRootPrimitives(): string[] {
  const L: string[] = []
  L.push('/* ==================== 尺寸 / 字号 / 动效（不随主题变）==================== */')
  L.push(':root {')
  L.push('  /* 圆角 */')
  L.push(vline('radius-xs', RADIUS.xs))
  L.push(vline('radius-sm', RADIUS.sm))
  L.push(vline('radius-md', RADIUS.md))
  L.push(vline('radius-lg', RADIUS.lg))
  L.push(vline('radius-xl', RADIUS.xl))
  L.push(vline('radius-2xl', RADIUS['2xl']))
  L.push(`  --radius-control: ${RADIUS.control};   /* 按钮 / 输入框统一圆角 */`)
  L.push(vline('radius-full', RADIUS.full))
  L.push('')
  L.push('  /* 间距（8pt 网格） */')
  for (const [k, v] of Object.entries(SPACE)) L.push(vline(`space-${k}`, v))
  L.push('')
  L.push('  /* 字号阶梯 */')
  for (const [k, v] of Object.entries(FONT)) L.push(vline(`font-${k}`, v))
  L.push('')
  L.push('  /* 行高 */')
  for (const [k, v] of Object.entries(LEADING)) L.push(vline(`leading-${k}`, v))
  L.push('')
  L.push('  /* 动效曲线 */')
  L.push(vline('ease-standard', MOTION.easeStandard))
  L.push(vline('ease-emphasized', MOTION.easeEmphasized))
  L.push(vline('ease-spring', MOTION.easeSpring))
  L.push(vline('ease-decelerate', MOTION.easeDecelerate))
  L.push('')
  L.push('  /* 动效时长 */')
  L.push(vline('duration-fast', MOTION.durationFast))
  L.push(vline('duration-base', MOTION.durationBase))
  L.push(vline('duration-slow', MOTION.durationSlow))
  L.push(vline('duration-slower', MOTION.durationSlower))
  L.push('}')
  return L
}

/** 四个语义色族（success / warning / danger / info）的 color/light/text/soft 四连。 */
function semanticColorTriples(sem: SemanticTokens): string[] {
  const L: string[] = []
  for (const g of ['success', 'warning', 'danger', 'info']) {
    L.push(vline(`${g}-color`, sem[`${g}-color`]))
    L.push(vline(`${g}-light`, sem[`${g}-light`]))
    L.push(vline(`${g}-text`, sem[`${g}-text`]))
    L.push(vline(`${g}-soft`, sem[`${g}-soft`]))
    L.push('')
  }
  return L
}

/** 品牌色 7 连（color/hover/pressed/light/text/soft/soft-strong）。 */
function primarySix(sem: SemanticTokens): string[] {
  return [
    vline('primary-color', sem['primary-color']),
    vline('primary-hover', sem['primary-hover']),
    vline('primary-pressed', sem['primary-pressed']),
    vline('primary-light', sem['primary-light']),
    vline('primary-text', sem['primary-text']),
    vline('primary-soft', sem['primary-soft']),
    vline('primary-soft-strong', sem['primary-soft-strong']),
  ]
}

/** bg/text/border 10 连。 */
function surfaceTen(sem: SemanticTokens): string[] {
  return [
    vline('bg-color', sem['bg-color']),
    vline('bg-color-hover', sem['bg-color-hover']),
    vline('card-bg', sem['card-bg']),
    vline('surface-2', sem['surface-2']),
    vline('text-main', sem['text-main']),
    vline('text-sub', sem['text-sub']),
    vline('text-muted', sem['text-muted']),
    vline('text-on-primary', sem['text-on-primary']),
    vline('border-color', sem['border-color']),
    vline('border-light', sem['border-light']),
  ]
}

/** `:root {}` · 初中·浅（默认 · 现状原值 · 零回归）——全量含维度 B。 */
function themeRootJuniorLight(): string[] {
  const sem = buildSemantic('junior', 'light')
  const L: string[] = []
  L.push('/* ==================== 初中·浅（默认 · 现状原值 · 零回归）==================== */')
  L.push(':root {')
  L.push('  /* 品牌色：深松绿 */')
  L.push(...primarySix(sem))
  L.push('')
  L.push('  /* 语义色 */')
  L.push(...semanticColorTriples(sem))
  L.push('  /* 语义色 RGB 三元组（供 rgba(var(--x-rgb), a) 使用；浅深各一套） */')
  L.push(vline('primary-rgb', sem['primary-rgb']))
  L.push(vline('success-rgb', sem['success-rgb']))
  L.push(vline('warning-rgb', sem['warning-rgb']))
  L.push(vline('danger-rgb', sem['danger-rgb']))
  L.push(`  --info-rgb: ${sem['info-rgb']};   /* 预留：供 info 半透明叠加使用（当前无调用点） */`)
  L.push('')
  L.push('  /* 恒白前景色（主题无关，仅 :root 定义一次，深色不覆盖）——用于饱和色块上的文字/图标 */')
  L.push(vline('on-strong', ON_STRONG.color))
  L.push(vline('on-strong-rgb', ON_STRONG.rgb))
  L.push('')
  L.push('  /* Report 分数档位浅底（浅色值精确搬运，未做色相调整） */')
  for (const k of ['band-success-bg', 'band-success-border', 'band-warning-bg', 'band-warning-border', 'band-danger-bg', 'band-danger-border']) {
    L.push(vline(k, sem[k]))
  }
  L.push('')
  L.push('  /* 行内代码文字色（英文 code / TopicDetail code 通用） */')
  L.push(vline('code-color', sem['code-color']))
  L.push('')
  L.push('  /* 底层与文字 */')
  L.push(...surfaceTen(sem))
  L.push('')
  L.push('  /* 阴影（墨绿基调，非纯黑） */')
  for (const k of ['shadow-xs', 'shadow-sm', 'shadow', 'shadow-md', 'shadow-lg']) L.push(vline(k, sem[k]))
  L.push('  /* 上向阴影：固定底部横条抬升层次（精确搬运自 .app-nav / .quiz-actions）*/')
  L.push(vline('shadow-up', sem['shadow-up']))
  L.push('  /* V2.11 · 积木厚度：y 偏移必须与按压位移一致，否则「穿模」 */')
  for (const k of ['shadow-3d', 'shadow-badge']) L.push(vline(k, sem[k]))
  L.push(vline('progress-gloss', sem['progress-gloss']))
  L.push('')
  L.push('  /* 渐变 */')
  for (const k of ['gradient-primary', 'gradient-warm', 'gradient-cool', 'gradient-success', 'gradient-sunset']) L.push(vline(k, sem[k]))
  L.push('}')
  return L
}

/** preset 浅色覆盖块（小学 / 高中）——仅维度 A 子集。 */
function themePresetLight(preset: ThemePreset, title: string): string[] {
  const sem = buildSemantic(preset, 'light')
  const L: string[] = []
  L.push(title)
  L.push(`body[data-theme-preset="${preset}"] {`)
  L.push(...primarySix(sem))
  L.push('')
  L.push(...semanticColorTriples(sem))
  L.push(vline('primary-rgb', sem['primary-rgb']))
  L.push(vline('success-rgb', sem['success-rgb']))
  L.push(vline('warning-rgb', sem['warning-rgb']))
  L.push(vline('danger-rgb', sem['danger-rgb']))
  L.push(vline('info-rgb', sem['info-rgb']))
  L.push('')
  L.push(...surfaceTen(sem))
  L.push('')
  L.push(vline('gradient-primary', sem['gradient-primary']))
  L.push('}')
  return L
}

/** `body.dark-mode {}` · 初中·深（默认深色 · 现状原值 · 零回归）——全量含维度 B。 */
function themeBodyDark(): string[] {
  const sem = buildSemantic('junior', 'dark')
  const L: string[] = []
  L.push('/* ==================== 初中·深（默认深色 · 现状原值 · 零回归）==================== */')
  L.push('body.dark-mode {')
  L.push(...primarySix(sem))
  L.push('')
  L.push(...semanticColorTriples(sem))
  L.push('  /* 语义色 RGB 三元组（深色一套） */')
  L.push(vline('primary-rgb', sem['primary-rgb']))
  L.push(vline('success-rgb', sem['success-rgb']))
  L.push(vline('warning-rgb', sem['warning-rgb']))
  L.push(vline('danger-rgb', sem['danger-rgb']))
  L.push(`  --info-rgb: ${sem['info-rgb']};   /* 预留：供 info 半透明叠加使用（当前无调用点） */`)
  L.push('')
  L.push('  /* Report 分数档位深色浅底 */')
  for (const k of ['band-success-bg', 'band-success-border', 'band-warning-bg', 'band-warning-border', 'band-danger-bg', 'band-danger-border']) {
    L.push(vline(k, sem[k]))
  }
  L.push('')
  L.push('  /* 行内代码文字色（深色） */')
  L.push(vline('code-color', sem['code-color']))
  L.push('')
  L.push(...surfaceTen(sem))
  L.push('')
  for (const k of ['shadow-xs', 'shadow-sm', 'shadow', 'shadow-md', 'shadow-lg']) L.push(vline(k, sem[k]))
  L.push(vline('shadow-up', sem['shadow-up']))
  for (const k of ['shadow-3d', 'shadow-badge', 'progress-gloss']) L.push(vline(k, sem[k]))
  L.push('')
  for (const k of ['gradient-primary', 'gradient-warm', 'gradient-cool', 'gradient-success', 'gradient-sunset']) L.push(vline(k, sem[k]))
  L.push('}')
  return L
}

/** 组合深色块（小学/高中 深 · (0,2,1) · 必须存在且非空）——仅声明子集。 */
function themeComboDark(preset: ThemePreset, title: string): string[] {
  const sem = buildSemantic(preset, 'dark')
  const L: string[] = []
  L.push(title)
  L.push(`body[data-theme-preset="${preset}"].dark-mode {`)
  L.push(...primarySix(sem))
  L.push('')
  L.push(vline('primary-rgb', sem['primary-rgb']))
  L.push('')
  L.push(...surfaceTen(sem))
  L.push('')
  L.push(vline('gradient-primary', sem['gradient-primary']))
  L.push('}')
  return L
}

const LIGHT_TITLE: Record<'primary' | 'senior', string> = {
  primary: '/* ==================== 小学·浅（阳光橙 · preset 覆盖）==================== */',
  senior: '/* ==================== 高中·浅（沉静蓝灰 · preset 覆盖）==================== */',
}
const DARK_COMBO_TITLE: Record<'primary' | 'senior', string> = {
  primary: '/* ==================== 小学·深（组合 (0,2,1) · 必须存在且非空）==================== */',
  senior: '/* ==================== 高中·深（组合 (0,2,1) · 必须存在且非空）==================== */',
}

/** 生成 theme.scss 全文。 */
export function generateThemeScss(): string {
  const body: string[] = [
    ...themeHeader(),
    '',
    ...themeRootPrimitives(),
    '',
    ...themeRootJuniorLight(),
    '',
    ...themePresetLight('primary', LIGHT_TITLE.primary),
    '',
    ...themePresetLight('senior', LIGHT_TITLE.senior),
    '',
    ...themeBodyDark(),
    '',
    ...themeComboDark('primary', DARK_COMBO_TITLE.primary),
    '',
    ...themeComboDark('senior', DARK_COMBO_TITLE.senior),
  ]
  return [BANNER, '', ...body, ''].join(NL)
}

/* =====================================================================
 * palette.ts —— 与 v1.9.0 数据逐字节等价（类型改 re-export，见 §9-4）
 * ===================================================================== */

/** 某 (preset,mode) 的 ThemeColors 字段（顺序 = 现状）。 */
function themeColorFields(preset: ThemePreset, mode: ThemeMode): Array<[string, string]> {
  const h = HUES[preset][mode]
  return [
    ['primary', h.brand],
    ['primaryHover', h.brandHover],
    ['primaryPressed', h.brandPressed],
    ['primarySuppl', h.brandHover],
    ['primaryText', h.brandText],
    ['success', h.success],
    ['warning', h.warning],
    ['danger', h.danger],
    ['info', h.info],
    ['cardBg', h.card],
    ['bgColor', h.bg],
    ['textMain', h.textMain],
    ['textSub', h.textSub],
    ['textMuted', h.textMuted],
    ['textOnPrimary', h.textOnPrimary],
    ['border', h.border],
    ['borderLight', h.borderLight],
  ]
}

/** ThemeColors 对象体（8 空格缩进）。 */
function themeColorsBody(preset: ThemePreset, mode: ThemeMode, indent: string): string {
  return themeColorFields(preset, mode).map(([k, v]) => `${indent}${k}: '${v}',`).join(NL)
}

/** gradients[preset][mode] 单行体（用 GRADIENT_LIGHT/DARK 展开）。 */
function gradientsLine(preset: ThemePreset): (mode: ThemeMode, indent: string) => string {
  return (mode, indent) => {
    const spread = mode === 'light' ? '...GRADIENT_LIGHT' : '...GRADIENT_DARK'
    return `${indent}${mode}: { primary: '${HUES[preset][mode].gradientPrimary}', ${spread} },`
  }
}

/** 非主色渐变常量块（维度 B）：浅深各一套，供 gradients 展开复用。 */
function gradientConsts(): string {
  return [
    '/** 非主色渐变（维度 B，跨学段恒定）：浅色一套 / 深色一套。 */',
    'const GRADIENT_LIGHT = {',
    `  warm: '${NEUTRALS.light.gradientWarm}',`,
    `  cool: '${NEUTRALS.light.gradientCool}',`,
    `  success: '${NEUTRALS.light.gradientSuccess}',`,
    `  sunset: '${NEUTRALS.light.gradientSunset}',`,
    '}',
    'const GRADIENT_DARK = {',
    `  warm: '${NEUTRALS.dark.gradientWarm}',`,
    `  cool: '${NEUTRALS.dark.gradientCool}',`,
    `  success: '${NEUTRALS.dark.gradientSuccess}',`,
    `  sunset: '${NEUTRALS.dark.gradientSunset}',`,
    '}',
  ].join(NL)
}

/** 生成 palette.ts 全文。 */
export function generatePaletteTs(): string {
  const header = [
    '// =====================================================================',
    '// JS 侧唯一色源（naive-ui themeOverrides 的数值来源）',
    '// ---------------------------------------------------------------------',
    '// 为什么需要这份文件：',
    '//   naive-ui 会对 primaryColor 做运算派生 hover / pressed，因此',
    '//   themeOverrides 里「不能写 var(--x)」，必须是最终数值。',
    '//   于是颜色出现两套真相：CSS 侧 theme.scss（var(--x)）与 JS 侧 palette。',
    '//   本文件即 JS 侧唯一数值源；tests/palette-consistency.test.ts 负责',
    '//   锁定它与 theme.scss 数值一致，避免「双源漂移」。',
    '//',
    '// 约定：',
    '//   - 值为**最终数值**（一律小写 hex），字段名 camelCase 对应 theme.scss 的 kebab-case；',
    '//   - 仅收录 themeOverrides 需要的字段（14 hero + 本轮新增 bgColor / borderLight）；',
    '//   - 学科色为主题无关常量（与 variables.scss 一致）；',
    '//   - 三套学段预设 × {浅, 深} = 6 组，见 presets。',
    '// =====================================================================',
  ].join(NL)

  const interfaces = [
    '/** 学段预设与明暗模式：单点定义于 tokens.ts，此处 re-export 以保持既有导入面（§9-4）。 */',
    'export type { ThemePreset, ThemeMode }',
    '',
    '/** 一套主题（某 preset 的浅或深）下，themeOverrides 需要的颜色字段。 */',
    'export interface ThemeColors {',
    '  /** --primary-color */',
    '  primary: string',
    '  /** --primary-hover */',
    '  primaryHover: string',
    '  /** --primary-pressed */',
    '  primaryPressed: string',
    '  /** naive-ui primaryColorSuppl（无独立 CSS 变量，取 hover 值） */',
    '  primarySuppl: string',
    '  /** --primary-text（AA 文字色 / 主按钮底色） */',
    '  primaryText: string',
    '  /** --success-color */',
    '  success: string',
    '  /** --warning-color */',
    '  warning: string',
    '  /** --danger-color */',
    '  danger: string',
    '  /** --info-color */',
    '  info: string',
    '  /** --card-bg */',
    '  cardBg: string',
    '  /** --bg-color（★ 本轮新增：图表背景需要） */',
    '  bgColor: string',
    '  /** --text-main */',
    '  textMain: string',
    '  /** --text-sub */',
    '  textSub: string',
    '  /** --text-muted */',
    '  textMuted: string',
    '  /** --text-on-primary（主色实心底上的文字色） */',
    '  textOnPrimary: string',
    '  /** --border-color */',
    '  border: string',
    '  /** --border-light（★ 本轮新增：图表轴需要） */',
    '  borderLight: string',
    '}',
    '',
    '/** 学科专属色（主题无关，保留学科辨识度）。 */',
    'export interface SubjectColors {',
    '  /** $subject-chinese */',
    '  chinese: string',
    '  /** $subject-chinese-deep */',
    '  chineseDeep: string',
    '  /** $subject-chinese-accent */',
    '  chineseAccent: string',
    '  /** $subject-chinese-soft */',
    '  chineseSoft: string',
    '  /** $subject-english */',
    '  english: string',
    '  /** $subject-english-light */',
    '  englishLight: string',
    '}',
    '',
    '/** 完整调色板：呈现层的唯一取值处。 */',
    'export interface ThemePalette {',
    '  /** ★ 2 组 → 6 组：三套学段预设 × {浅, 深} */',
    '  presets: Record<ThemePreset, Record<ThemeMode, ThemeColors>>',
    '  subjects: SubjectColors',
    '  radius: Record<string, string>',
    '  /** ★ 按 (preset,mode)；仅 primary 随学段变，其余四个跨学段恒定 */',
    '  gradients: Record<ThemePreset, Record<ThemeMode, Record<string, string>>>',
    '}',
    '',
    '/** naive-ui 字号档位（B1 单一缩放源）。 */',
    'export interface FontSizes {',
    '  fontSizeTiny: string',
    '  fontSizeSmall: string',
    '  fontSizeMedium: string',
    '  fontSizeLarge: string',
    '  fontSizeHuge: string',
    '}',
    '',
    '/** 字号档位常量（从 App.vue 的 fontSizeMap 迁入，JS 唯一源）。 */',
    'export const FONT_SIZE_MAPS: Record<\'small\' | \'medium\' | \'large\', FontSizes> = {',
    "  small: { fontSizeTiny: '11px', fontSizeSmall: '12px', fontSizeMedium: '13px', fontSizeLarge: '14px', fontSizeHuge: '16px' },",
    "  medium: { fontSizeTiny: '12px', fontSizeSmall: '13px', fontSizeMedium: '14px', fontSizeLarge: '15px', fontSizeHuge: '17px' },",
    "  large: { fontSizeTiny: '13px', fontSizeSmall: '14px', fontSizeMedium: '16px', fontSizeLarge: '18px', fontSizeHuge: '20px' },",
    '}',
  ].join(NL)

  const paletteObj = [
    '/** JS 侧唯一色源。值均为小写 hex，与 theme.scss 一一对应。 */',
    'export const palette: ThemePalette = {',
    '  presets: {',
    '    // ---------------- 小学（阳光橙） ----------------',
    '    primary: {',
    '      light: {',
    themeColorsBody('primary', 'light', '        '),
    '      },',
    '      dark: {',
    themeColorsBody('primary', 'dark', '        '),
    '      },',
    '    },',
    '    // ---------------- 初中（深松绿 · 现状原值 · 零回归） ----------------',
    '    junior: {',
    '      light: {',
    themeColorsBody('junior', 'light', '        '),
    '      },',
    '      dark: {',
    themeColorsBody('junior', 'dark', '        '),
    '      },',
    '    },',
    '    // ---------------- 高中（沉静蓝灰） ----------------',
    '    senior: {',
    '      light: {',
    themeColorsBody('senior', 'light', '        '),
    '      },',
    '      dark: {',
    themeColorsBody('senior', 'dark', '        '),
    '      },',
    '    },',
    '  },',
    '  subjects: {',
    `    chinese: '${SUBJECTS.chinese}',`,
    `    chineseDeep: '${SUBJECTS.chineseDeep}',`,
    `    chineseAccent: '${SUBJECTS.chineseAccent}',`,
    `    chineseSoft: '${SUBJECTS.chineseSoft}',`,
    `    english: '${SUBJECTS.english}',`,
    `    englishLight: '${SUBJECTS.englishLight}',`,
    '  },',
    '  radius: {',
    `    xs: '${RADIUS.xs}',`,
    `    sm: '${RADIUS.sm}',`,
    `    md: '${RADIUS.md}',`,
    `    lg: '${RADIUS.lg}',`,
    `    xl: '${RADIUS.xl}',`,
    `    '2xl': '${RADIUS['2xl']}',`,
    `    control: '${RADIUS.control}',`,
    `    full: '${RADIUS.full}',`,
    '  },',
    '  gradients: {',
    '    primary: {',
    gradientsLine('primary')('light', '      '),
    gradientsLine('primary')('dark', '      '),
    '    },',
    '    junior: {',
    gradientsLine('junior')('light', '      '),
    gradientsLine('junior')('dark', '      '),
    '    },',
    '    senior: {',
    gradientsLine('senior')('light', '      '),
    gradientsLine('senior')('dark', '      '),
    '    },',
    '  },',
    '}',
  ].join(NL)

  const overrides = [
    '/**',
    ' * 由调色板派生 naive-ui 的 themeOverrides（纯函数，便于单测）。',
    ' *',
    ' * @param palette 调色板（JS 侧唯一色源）',
    " * @param preset  学段预设：'primary' | 'junior' | 'senior'",
    " * @param theme   实际生效明暗：'light' | 'dark'",
    ' * @param sizes   当前字号档位',
    ' * @returns naive-ui 的 GlobalThemeOverrides',
    ' */',
    'export function buildThemeOverrides(',
    '  palette: ThemePalette,',
    '  preset: ThemePreset,',
    '  theme: ThemeMode,',
    '  sizes: FontSizes,',
    '): GlobalThemeOverrides {',
    '  const c: ThemeColors = palette.presets[preset][theme]',
    '',
    '  return {',
    '    common: {',
    '      // 主色（naive-ui 会据此派生 hover / pressed，故必须是数值而非 var()）',
    '      primaryColor: c.primary,',
    '      primaryColorHover: c.primaryHover,',
    '      primaryColorPressed: c.primaryPressed,',
    '      primaryColorSuppl: c.primarySuppl,',
    "      borderRadius: '10px',",
    "      borderRadiusSmall: '8px',",
    '      fontFamily: `-apple-system, BlinkMacSystemFont, \'PingFang SC\', \'Microsoft YaHei\', \'Segoe UI\', system-ui, sans-serif`,',
    "      fontWeight: '500',",
    "      fontWeightStrong: '700',",
    '      textColorBase: c.textMain,',
    '      textColor1: c.textMain,',
    '      textColor2: c.textSub,',
    '      textColor3: c.textMuted,',
    '      borderColor: c.border,',
    '      ...sizes,',
    '    },',
    '    Card: {',
    "      borderRadius: '16px',",
    '      color: c.cardBg,',
    "      titleFontWeight: '700',",
    '      titleFontSizeMedium: sizes.fontSizeMedium,',
    '      titleFontSizeLarge: sizes.fontSizeLarge,',
    '    },',
    '    Button: {',
    "      borderRadiusMedium: '10px',",
    "      fontWeight: '600',",
    "      fontWeightStrong: '700',",
    '      // 主按钮前景/背景：底色取 --primary-text、文字取 --text-on-primary，',
    '      // 使 6 组（3 学段 × 浅深）的主按钮文字对比度全部 ≥ 4.5（AA）。',
    '      // 本应用用 body.dark-mode + 自定义覆盖而非 naive darkTheme，故 naive',
    '      // 会误判为浅色、给深色主题的 primary 按钮配白字（对比度不足），需显式指定。',
    '      colorPrimary: c.primaryText,',
    '      colorHoverPrimary: c.primaryText,',
    '      colorPressedPrimary: c.primaryText,',
    '      colorFocusPrimary: c.primaryText,',
    '      textColorPrimary: c.textOnPrimary,',
    '      textColorHoverPrimary: c.textOnPrimary,',
    '      textColorPressedPrimary: c.textOnPrimary,',
    '      textColorFocusPrimary: c.textOnPrimary,',
    '    },',
    '    Input: {',
    "      borderRadius: '10px',",
    '    },',
    '    Tag: {',
    "      fontWeightStrong: '600',",
    '    },',
    '    Menu: {',
    '      fontSize: `${sizes.fontSizeMedium}px`,',
    '    },',
    '  }',
    '}',
  ].join(NL)

  const imports = [
    "import type { GlobalThemeOverrides } from 'naive-ui'",
    "import type { ThemePreset, ThemeMode } from './tokens'",
  ].join(NL)

  return [BANNER, '', header, '', imports, '', interfaces, '', gradientConsts(), '', paletteObj, '', overrides, ''].join(NL)
}
