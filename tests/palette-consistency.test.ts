// =====================================================================
// 一致性测试：锁定 palette.ts（JS 侧数值源）⇄ theme.scss（CSS 侧唯一源）
// ---------------------------------------------------------------------
// 背景：naive-ui 的 themeOverrides 必须用「最终数值」，不能写 var(--x)，
//       于是颜色存在两套真相。本测试是防止它们漂移的兜底网。
// 方案：读 theme.scss 文本 → 以首个 `body.dark-mode {` 为界切浅/深 →
//       正则收集 CSS 变量 → 归一化 → 对 palette 的共享字段逐一断言。
// 纪律：不引入 sass 运行时，仅用 Node 内置 fs + 手写解析。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { palette, buildThemeOverrides, type FontSizes } from '../src/core/styles/palette'

const themeScssPath = resolve(process.cwd(), 'src/core/styles/theme.scss')
const variablesScssPath = resolve(process.cwd(), 'src/core/styles/variables.scss')

const themeText = readFileSync(themeScssPath, 'utf8')
const variablesText = readFileSync(variablesScssPath, 'utf8')

/**
 * 归一化一个颜色 / 阴影 / 渐变字符串，便于跨源比较：
 * - hex：转小写，三位补齐为六位；
 * - rgba()/rgb()：去掉内部空白后重组为 `rgba(r, g, b, a)`，alpha 去尾零；
 * - 其余（渐变 / 阴影）：去掉全部空白后比较。
 */
export function normalizeColor(value: string): string {
  const v = String(value ?? '').trim()

  const rgbMatch = v.match(/^rgba?\(([^)]*)\)$/i)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    const [r, g, b, a] = parts
    if (a !== undefined) {
      return `rgba(${r}, ${g}, ${b}, ${String(parseFloat(a))})`
    }
    return `rgb(${r}, ${g}, ${b})`
  }

  if (v.startsWith('#')) {
    const hex = v.toLowerCase()
    if (hex.length === 4) {
      // #abc → #aabbcc
      return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    }
    return hex
  }

  // 渐变 / 阴影等复合值：去掉全部空白
  return v.replace(/\s+/g, '')
}

/** 抽取一段文本里所有 `--x: value;` 形式的 CSS 变量。 */
function collectCssVars(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    map[m[1]] = m[2].trim()
  }
  return map
}

/** 抽取一段文本里所有 `$x: value;` 形式的 SCSS 变量。 */
function collectScssVars(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  const re = /\$([\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    map[m[1]] = m[2].trim()
  }
  return map
}

/** 以首个 `body.dark-mode {` 为界，切出浅色 / 深色两段。 */
function splitThemed(text: string): { light: string; dark: string } {
  const idx = text.indexOf('body.dark-mode {')
  if (idx < 0) return { light: text, dark: '' }
  return { light: text.slice(0, idx), dark: text.slice(idx) }
}

const themed = splitThemed(themeText)
const scssLight = collectCssVars(themed.light)
const scssDark = collectCssVars(themed.dark)
const scssConstants = collectScssVars(variablesText)

/** palette 字段 → theme.scss 变量名（仅共享字段；primarySuppl 无对应变量，故不列入）。 */
const FIELD_TO_VAR: Record<keyof typeof palette.light, string> = {
  primary: '--primary-color',
  primaryHover: '--primary-hover',
  primaryPressed: '--primary-pressed',
  primarySuppl: '--primary-suppl', // 不存在 → 该字段跳过数值断言（见下）
  success: '--success-color',
  warning: '--warning-color',
  danger: '--danger-color',
  info: '--info-color',
  cardBg: '--card-bg',
  textMain: '--text-main',
  textSub: '--text-sub',
  textMuted: '--text-muted',
  border: '--border-color',
}

/** 学科色字段 → variables.scss 常量名。 */
const SUBJECT_TO_CONST: Record<keyof typeof palette.subjects, string> = {
  chinese: 'subject-chinese',
  chineseDeep: 'subject-chinese-deep',
  chineseAccent: 'subject-chinese-accent',
  chineseSoft: 'subject-chinese-soft',
  english: 'subject-english',
  englishLight: 'subject-english-light',
}

/** 圆角字段 → theme.scss 变量名。 */
const RADIUS_TO_VAR: Record<string, string> = {
  xs: '--radius-xs',
  sm: '--radius-sm',
  md: '--radius-md',
  lg: '--radius-lg',
  xl: '--radius-xl',
  control: '--radius-control',
  full: '--radius-full',
}

/** 渐变字段 → theme.scss 变量名。 */
const GRADIENT_TO_VAR: Record<string, string> = {
  primary: '--gradient-primary',
  warm: '--gradient-warm',
  cool: '--gradient-cool',
  success: '--gradient-success',
  sunset: '--gradient-sunset',
}

describe('palette ⇄ theme.scss 一致性', () => {
  const cases: Array<['light' | 'dark', Record<string, string>]> = [
    ['light', scssLight],
    ['dark', scssDark],
  ]

  for (const [theme, scssVars] of cases) {
    describe(`${theme} 主题`, () => {
      for (const [field, varName] of Object.entries(FIELD_TO_VAR)) {
        // primarySuppl 在 theme.scss 无对应变量，跳过（它取 hover 值）
        if (field === 'primarySuppl') continue

        it(`${field} 与 ${varName} 一致`, () => {
          const paletteValue = (palette[theme] as Record<string, string>)[field]
          const scssValue = scssVars[varName]
          expect(scssValue, `theme.scss ${theme} 段未找到 ${varName}`).toBeDefined()
          expect(
            normalizeColor(paletteValue),
            `${theme}.${field} 与 ${varName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
          ).toBe(normalizeColor(scssValue))
        })
      }
    })
  }
})

describe('palette.subjects ⇄ variables.scss 学科常量', () => {
  for (const [field, constName] of Object.entries(SUBJECT_TO_CONST)) {
    it(`${field} 与 $${constName} 一致`, () => {
      const paletteValue = (palette.subjects as Record<string, string>)[field]
      const scssValue = scssConstants[constName]
      expect(scssValue, `variables.scss 未找到 $${constName}`).toBeDefined()
      expect(
        normalizeColor(paletteValue),
        `subjects.${field} 与 $${constName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
      ).toBe(normalizeColor(scssValue))
    })
  }
})

describe('palette.radius ⇄ theme.scss --radius-*', () => {
  for (const [field, varName] of Object.entries(RADIUS_TO_VAR)) {
    it(`${field} 与 ${varName} 一致`, () => {
      const paletteValue = palette.radius[field]
      const scssValue = scssLight[varName]
      expect(scssValue, `theme.scss 未找到 ${varName}`).toBeDefined()
      expect(
        String(paletteValue).trim(),
        `radius.${field} 与 ${varName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
      ).toBe(String(scssValue).trim())
    })
  }
})

describe('palette.gradients ⇄ theme.scss --gradient-*', () => {
  for (const [field, varName] of Object.entries(GRADIENT_TO_VAR)) {
    it(`${field} 与 ${varName} 一致`, () => {
      const paletteValue = palette.gradients[field]
      const scssValue = scssLight[varName]
      expect(scssValue, `theme.scss 未找到 ${varName}`).toBeDefined()
      expect(
        normalizeColor(paletteValue),
        `gradients.${field} 与 ${varName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
      ).toBe(normalizeColor(scssValue))
    })
  }
})

describe('theme.scss 新增 token 白名单校验', () => {
  const REQUIRED_BOTH = [
    '--primary-rgb',
    '--success-rgb',
    '--warning-rgb',
    '--danger-rgb',
    '--info-rgb',
    '--band-success-bg',
    '--band-success-border',
    '--band-warning-bg',
    '--band-warning-border',
    '--band-danger-bg',
    '--band-danger-border',
    '--code-color',
    '--shadow-up',
  ]

  for (const name of REQUIRED_BOTH) {
    it(`${name} 在浅色段存在`, () => {
      expect(scssLight[name], `浅色段缺少 ${name}`).toBeDefined()
    })
    it(`${name} 在深色段存在`, () => {
      expect(scssDark[name], `深色段缺少 ${name}`).toBeDefined()
    })
  }

  it('--on-strong 仅定义于 :root（深色不覆盖）', () => {
    expect(scssLight['--on-strong']).toBeDefined()
    expect(scssDark['--on-strong']).toBeUndefined()
  })

  it('--on-strong-rgb 仅定义于 :root（深色不覆盖）', () => {
    expect(scssLight['--on-strong-rgb']).toBeDefined()
    expect(scssDark['--on-strong-rgb']).toBeUndefined()
  })

  it('--shadow-up 浅深成对且浅色值 = 固定底栏原值', () => {
    expect(scssLight['--shadow-up'], '浅色段缺少 --shadow-up').toBeDefined()
    expect(scssDark['--shadow-up'], '深色段缺少 --shadow-up').toBeDefined()
    expect(scssLight['--shadow-up']).toBe('0 -4px 16px rgba(0, 0, 0, 0.06)')
  })
})

/**
 * variables.scss 中新增的学科淡底常量（不在 palette.subjects 内）单独锁定。
 */
describe('variables.scss ⇄ 学科淡底常量', () => {
  it('$subject-english-soft 锁定为 rgba(74, 144, 217, 0.15)', () => {
    const scssValue = scssConstants['subject-english-soft']
    expect(scssValue, 'variables.scss 未找到 $subject-english-soft').toBeDefined()
    expect(normalizeColor(scssValue)).toBe('rgba(74, 144, 217, 0.15)')
  })
})

/**
 * buildThemeOverrides：由 palette 派生 naive-ui 覆盖的纯函数。
 * 架构师抽取它的目的就是「便于单测」，这里对 light / dark 双套断言。
 */
describe('buildThemeOverrides — palette 派生 naive-ui 覆盖', () => {
  const SIZES: FontSizes = {
    fontSizeTiny: '11px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    fontSizeHuge: '16px',
  }

  for (const theme of ['light', 'dark'] as const) {
    describe(`${theme} 主题`, () => {
      const c = palette[theme]
      const ov = buildThemeOverrides(palette, theme, SIZES)

      it('common 主色四态 = palette', () => {
        expect(ov.common?.primaryColor, `${theme} primaryColor`).toBe(c.primary)
        expect(ov.common?.primaryColorHover, `${theme} primaryColorHover`).toBe(c.primaryHover)
        expect(ov.common?.primaryColorPressed, `${theme} primaryColorPressed`).toBe(c.primaryPressed)
        expect(ov.common?.primaryColorSuppl, `${theme} primaryColorSuppl`).toBe(c.primarySuppl)
      })

      it('common 文字 / 边框色 = palette', () => {
        expect(ov.common?.textColorBase, `${theme} textColorBase`).toBe(c.textMain)
        expect(ov.common?.textColor1, `${theme} textColor1`).toBe(c.textMain)
        expect(ov.common?.textColor2, `${theme} textColor2`).toBe(c.textSub)
        expect(ov.common?.textColor3, `${theme} textColor3`).toBe(c.textMuted)
        expect(ov.common?.borderColor, `${theme} borderColor`).toBe(c.border)
      })

      it('Card.color = palette.cardBg；圆角正确透传', () => {
        expect(ov.Card?.color, `${theme} Card.color`).toBe(c.cardBg)
        expect(ov.common?.borderRadius, `${theme} common.borderRadius`).toBe('10px')
        expect(ov.Card?.borderRadius, `${theme} Card.borderRadius`).toBe('16px')
      })

      it('sizes(fontSizeMap) 被展开到 common', () => {
        expect(ov.common?.fontSizeTiny, 'fontSizeTiny').toBe(SIZES.fontSizeTiny)
        expect(ov.common?.fontSizeSmall, 'fontSizeSmall').toBe(SIZES.fontSizeSmall)
        expect(ov.common?.fontSizeMedium, 'fontSizeMedium').toBe(SIZES.fontSizeMedium)
        expect(ov.common?.fontSizeLarge, 'fontSizeLarge').toBe(SIZES.fontSizeLarge)
        expect(ov.common?.fontSizeHuge, 'fontSizeHuge').toBe(SIZES.fontSizeHuge)
      })
    })
  }
})
