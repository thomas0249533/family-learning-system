// =====================================================================
// 一致性测试：锁定 palette.ts（JS 侧数值源）⇄ theme.scss（CSS 侧唯一源）
// ---------------------------------------------------------------------
// 背景：naive-ui 的 themeOverrides 必须用「最终数值」，不能写 var(--x)，
//       于是颜色存在两套真相。本测试是防止它们漂移的兜底网。
//
// 本文件已从「2 组（浅/深）」扩展到「6 组（3 学段预设 × 浅/深）」：
//   1. 用 extractBlocks 抽出 6 个原始块（:root / 两个 preset 浅 / dark-mode /
//      两个 preset 深组合块）；
//   2. 模拟浏览器级联，合成 6 个「生效变量表」：
//        junior.light = :root
//        junior.dark  = { ...:root, ...dark-mode }
//        primary.light = { ...:root, ...primary }
//        primary.dark  = { ...:root, ...dark-mode, ...primary.dark }
//        senior.light / senior.dark 同理
//      （:root 恒命中 <html>，body 继承之，故所有组都并上 :root —— 这正是浏览器
//         「preset/深色只覆盖差异项」的等价语义，能捕获「漏了某覆盖」。）
//   3. 断言 A 数值 / B 数值源齐全 / C 结构性 / D buildThemeOverrides。
// 纪律：不引入 sass 运行时，仅用 Node 内置 fs + 手写解析。
//
// V1.2 批1 起（单源生成地基）：theme.scss 与 palette.ts 均由
//   src/core/styles/tokens.ts 生成（见 scripts/tokens/*）。本文件在原有
//   「palette ⇄ theme.scss」数值/结构断言之外，**新增**「生成物 ⇄ tokens.ts」
//   的直接校验（见文末 describe），把「双源漂移」升级为「生成物 ⇄ 唯一源」。
//   全部既有断言（含 6 组 × 14 hero、preset 子集、原始块级深色覆盖）**一条未删**。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  palette,
  buildThemeOverrides,
  FONT_SIZE_MAPS,
  type FontSizes,
  type ThemeMode,
  type ThemePreset,
} from '../src/core/styles/palette'
import {
  buildSemantic,
  PRESETS as TOKEN_PRESETS,
  MODES as TOKEN_MODES,
} from '../src/core/styles/tokens'

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
export function collectCssVars(text: string): Record<string, string> {
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

/**
 * 抽出某个选择器（行）对应的「所有」块内容（花括号配对）。
 * 同名选择器可出现多次（如两处 :root、两处 body.dark-mode），全部返回。
 */
export function extractBlocks(text: string, selectorLine: string): string[] {
  const out: string[] = []
  const escaped = selectorLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^[ \\t]*' + escaped + '[ \\t]*\\{', 'gm')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length - 1 // '{' 的位置
    let depth = 0
    let k = start
    for (; k < text.length; k++) {
      const ch = text[k]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) break
      }
    }
    out.push(text.slice(start + 1, k))
  }
  return out
}

/** 合并某选择器所有块里的 CSS 变量。 */
function mergeBlocks(text: string, selectorLine: string): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const block of extractBlocks(text, selectorLine)) Object.assign(merged, collectCssVars(block))
  return merged
}

// ---- 6 个原始块 ----
const rootVars = mergeBlocks(themeText, ':root')
const primaryLightBlock = mergeBlocks(themeText, 'body[data-theme-preset="primary"]')
const seniorLightBlock = mergeBlocks(themeText, 'body[data-theme-preset="senior"]')
const darkVars = mergeBlocks(themeText, 'body.dark-mode')
const primaryDarkBlock = mergeBlocks(themeText, 'body[data-theme-preset="primary"].dark-mode')
const seniorDarkBlock = mergeBlocks(themeText, 'body[data-theme-preset="senior"].dark-mode')

// ---- 模拟继承合成 6 个「生效变量表」----
const EFFECTIVE: Record<ThemePreset, Record<ThemeMode, Record<string, string>>> = {
  junior: {
    light: { ...rootVars },
    dark: { ...rootVars, ...darkVars },
  },
  primary: {
    light: { ...rootVars, ...primaryLightBlock },
    dark: { ...rootVars, ...darkVars, ...primaryDarkBlock },
  },
  senior: {
    light: { ...rootVars, ...seniorLightBlock },
    dark: { ...rootVars, ...darkVars, ...seniorDarkBlock },
  },
}

const PRESETS: ThemePreset[] = ['primary', 'junior', 'senior']
const MODES: ThemeMode[] = ['light', 'dark']

const variablesScssConstants = collectScssVars(variablesText)

/** palette 字段 → theme.scss 变量名（仅共享字段；primarySuppl 无对应变量，故不列入）。 */
const FIELD_TO_VAR: Record<Exclude<keyof typeof palette.presets.junior.light, 'primarySuppl'>, string> = {
  primary: '--primary-color',
  primaryHover: '--primary-hover',
  primaryPressed: '--primary-pressed',
  primaryText: '--primary-text',
  success: '--success-color',
  warning: '--warning-color',
  danger: '--danger-color',
  info: '--info-color',
  cardBg: '--card-bg',
  bgColor: '--bg-color',
  textMain: '--text-main',
  textSub: '--text-sub',
  textMuted: '--text-muted',
  textOnPrimary: '--text-on-primary',
  border: '--border-color',
  borderLight: '--border-light',
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

// =====================================================================
// 断言 A · 数值一致（防漂移）—— 6 × 14 ≈ 84 例
// =====================================================================
describe('palette ⇄ theme.scss 一致性（6 组）', () => {
  for (const preset of PRESETS) {
    for (const mode of MODES) {
      describe(`${preset}.${mode}`, () => {
        const vars = EFFECTIVE[preset][mode]
        /*
         * `Object.entries` 的键类型是 `string`，直接用它索引 `palette.presets[preset][mode]`
         * 就必须把这里断言成 `Record<string, string>` —— 那等于把字段名校验关掉了。
         * 断言回 `keyof typeof FIELD_TO_VAR`（= 真实字段联合）后，索引自然合法，
         * 字段名写错时这里就会报红。
         */
        for (const [field, varName] of Object.entries(FIELD_TO_VAR) as [
          keyof typeof FIELD_TO_VAR,
          string,
        ][]) {
          it(`${field} 与 ${varName} 一致`, () => {
            const paletteValue = palette.presets[preset][mode][field]
            const scssValue = vars[varName]
            expect(scssValue, `theme.scss ${preset}.${mode} 段未找到 ${varName}`).toBeDefined()
            expect(
              normalizeColor(paletteValue),
              `${preset}.${mode}.${field} 与 ${varName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
            ).toBe(normalizeColor(scssValue!))
          })
        }

        // primarySuppl 无独立 CSS 变量，取 hover 值 —— 单独锁定
        it(`primarySuppl === primaryHover（${preset}.${mode}）`, () => {
          const c = palette.presets[preset][mode]
          expect(c.primarySuppl, `${preset}.${mode}.primarySuppl`).toBe(c.primaryHover)
        })
      })
    }
  }
})

// =====================================================================
// 断言 B · 数值源齐全
// =====================================================================
describe('palette.subjects ⇄ variables.scss 学科常量', () => {
  // 同上：断言回 `keyof typeof SUBJECT_TO_CONST`，不把字段名擦成 `string`
  for (const [field, constName] of Object.entries(SUBJECT_TO_CONST) as [
    keyof typeof SUBJECT_TO_CONST,
    string,
  ][]) {
    it(`${field} 与 $${constName} 一致`, () => {
      const paletteValue = palette.subjects[field]
      const scssValue = variablesScssConstants[constName]
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
      const scssValue = rootVars[varName]
      expect(scssValue, `theme.scss 未找到 ${varName}`).toBeDefined()
      expect(
        String(paletteValue).trim(),
        `radius.${field} 与 ${varName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
      ).toBe(String(scssValue).trim())
    })
  }
})

describe('palette.gradients ⇄ theme.scss --gradient-*（6 组）', () => {
  for (const preset of PRESETS) {
    for (const mode of MODES) {
      const vars = EFFECTIVE[preset][mode]
      for (const [field, varName] of Object.entries(GRADIENT_TO_VAR)) {
        it(`${preset}.${mode} ${field} 与 ${varName} 一致`, () => {
          const paletteValue = palette.gradients[preset][mode][field]
          const scssValue = vars[varName]
          expect(scssValue, `theme.scss ${preset}.${mode} 未找到 ${varName}`).toBeDefined()
          expect(
            normalizeColor(paletteValue),
            `gradients.${preset}.${mode}.${field} 与 ${varName} 不一致：palette=${paletteValue} / scss=${scssValue}`,
          ).toBe(normalizeColor(scssValue!))
        })
      }
    }
  }
})

// =====================================================================
// 断言 C · 结构性（防「抄漏」「漏组合块」）
// =====================================================================
describe('theme.scss 结构完整性（6 组）', () => {
  it('非空洞：6 个原始块均非空', () => {
    expect(Object.keys(rootVars).length, ':root 变量数').toBeGreaterThan(20)
    expect(Object.keys(primaryLightBlock).length, 'primary 浅色覆盖块').toBeGreaterThan(5)
    expect(Object.keys(seniorLightBlock).length, 'senior 浅色覆盖块').toBeGreaterThan(5)
    expect(Object.keys(darkVars).length, 'body.dark-mode 变量数').toBeGreaterThan(20)
    expect(Object.keys(primaryDarkBlock).length, 'primary 深色组合块').toBeGreaterThan(5)
    expect(Object.keys(seniorDarkBlock).length, 'senior 深色组合块').toBeGreaterThan(5)
  })

  const keySets = PRESETS.map((p) =>
    MODES.map((m) => Object.keys(EFFECTIVE[p][m]).sort().join(',')),
  )

  it('6 组的「生效变量表」键集合完全相同', () => {
    const baseline = keySets[0][0]
    for (let i = 0; i < PRESETS.length; i++) {
      for (let j = 0; j < MODES.length; j++) {
        expect(
          keySets[i][j],
          `${PRESETS[i]}.${MODES[j]} 的键集合与 junior.light 不同（新增/改 token 时 6 组都要补）`,
        ).toBe(baseline)
      }
    }
  })

  it('两个 preset 浅色覆盖块键集合一致（防止只补一套）', () => {
    expect(Object.keys(primaryLightBlock).sort().join(','),
      'primary 与 senior 浅色覆盖块的键集合必须一致').toBe(Object.keys(seniorLightBlock).sort().join(','))
  })

  it('两个 preset 深色组合块键集合一致（防止只补一套）', () => {
    expect(Object.keys(primaryDarkBlock).sort().join(','),
      'primary 与 senior 深色组合块的键集合必须一致').toBe(Object.keys(seniorDarkBlock).sort().join(','))
  })

  // ⚠️ §2.1 不变量 2：深色 + 非默认学段必须命中 (0,2,1) 组合块，
  //    组合块必须覆盖「会串色」的关键变量，否则深色会串成学段浅色。
  const CRITICAL = ['--primary-color', '--bg-color', '--card-bg', '--text-main', '--border-color']
  for (const [name, block] of [
    ['primary.dark', primaryDarkBlock],
    ['senior.dark', seniorDarkBlock],
  ] as const) {
    for (const varName of CRITICAL) {
      it(`组合块 ${name} 覆盖关键变量 ${varName}`, () => {
        expect(block[varName], `${name} 缺少 ${varName} → 深色会串成学段浅色`).toBeDefined()
      })
    }
  }
})

// =====================================================================
// 白名单 token 校验（浅深成对；沿用现状断言，按新结构采用 :root / dark-mode）
// =====================================================================
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
      expect(rootVars[name], `浅色段缺少 ${name}`).toBeDefined()
    })
    it(`${name} 在深色段存在`, () => {
      expect(darkVars[name], `深色段缺少 ${name}`).toBeDefined()
    })
  }

  it('--on-strong 仅定义于 :root（深色不覆盖）', () => {
    expect(rootVars['--on-strong']).toBeDefined()
    expect(darkVars['--on-strong']).toBeUndefined()
  })

  it('--on-strong-rgb 仅定义于 :root（深色不覆盖）', () => {
    expect(rootVars['--on-strong-rgb']).toBeDefined()
    expect(darkVars['--on-strong-rgb']).toBeUndefined()
  })

  it('--shadow-up 浅深成对且浅色值 = 固定底栏原值', () => {
    expect(rootVars['--shadow-up'], '浅色段缺少 --shadow-up').toBeDefined()
    expect(darkVars['--shadow-up'], '深色段缺少 --shadow-up').toBeDefined()
    expect(rootVars['--shadow-up']).toBe('0 -4px 16px rgba(0, 0, 0, 0.06)')
  })
})

/**
 * variables.scss 中新增的学科淡底常量（不在 palette.subjects 内）单独锁定。
 */
describe('variables.scss ⇄ 学科淡底常量', () => {
  it('$subject-english-soft 锁定为 rgba(74, 144, 217, 0.15)', () => {
    const scssValue = variablesScssConstants['subject-english-soft']
    expect(scssValue, 'variables.scss 未找到 $subject-english-soft').toBeDefined()
    expect(normalizeColor(scssValue)).toBe('rgba(74, 144, 217, 0.15)')
  })
})

// =====================================================================
// 断言 D · buildThemeOverrides（6 × 4 = 24 例）
// =====================================================================
describe('buildThemeOverrides — palette 派生 naive-ui 覆盖（6 组）', () => {
  const SIZES: FontSizes = FONT_SIZE_MAPS.medium

  for (const preset of PRESETS) {
    for (const theme of MODES) {
      describe(`${preset}.${theme}`, () => {
        const c = palette.presets[preset][theme]
        const ov = buildThemeOverrides(palette, preset, theme, SIZES)

        it('common 主色四态 = palette', () => {
          expect(ov.common?.primaryColor, `${preset}.${theme} primaryColor`).toBe(c.primary)
          expect(ov.common?.primaryColorHover, `${preset}.${theme} primaryColorHover`).toBe(c.primaryHover)
          expect(ov.common?.primaryColorPressed, `${preset}.${theme} primaryColorPressed`).toBe(c.primaryPressed)
          expect(ov.common?.primaryColorSuppl, `${preset}.${theme} primaryColorSuppl`).toBe(c.primarySuppl)
        })

        it('common 文字 / 边框色 = palette', () => {
          expect(ov.common?.textColorBase, `${preset}.${theme} textColorBase`).toBe(c.textMain)
          expect(ov.common?.textColor1, `${preset}.${theme} textColor1`).toBe(c.textMain)
          expect(ov.common?.textColor2, `${preset}.${theme} textColor2`).toBe(c.textSub)
          expect(ov.common?.textColor3, `${preset}.${theme} textColor3`).toBe(c.textMuted)
          expect(ov.common?.borderColor, `${preset}.${theme} borderColor`).toBe(c.border)
        })

        it('Card.color = palette.cardBg；圆角正确透传', () => {
          expect(ov.Card?.color, `${preset}.${theme} Card.color`).toBe(c.cardBg)
          expect(ov.common?.borderRadius, `${preset}.${theme} common.borderRadius`).toBe('10px')
          expect(ov.Card?.borderRadius, `${preset}.${theme} Card.borderRadius`).toBe('16px')
        })

        it('sizes(FONT_SIZE_MAPS) 被展开到 common', () => {
          expect(ov.common?.fontSizeTiny, 'fontSizeTiny').toBe(SIZES.fontSizeTiny)
          expect(ov.common?.fontSizeSmall, 'fontSizeSmall').toBe(SIZES.fontSizeSmall)
          expect(ov.common?.fontSizeMedium, 'fontSizeMedium').toBe(SIZES.fontSizeMedium)
          expect(ov.common?.fontSizeLarge, 'fontSizeLarge').toBe(SIZES.fontSizeLarge)
          expect(ov.common?.fontSizeHuge, 'fontSizeHuge').toBe(SIZES.fontSizeHuge)
        })
      })
    }
  }

  it('三档 FONT_SIZE_MAPS 结构完整', () => {
    for (const key of ['small', 'medium', 'large'] as const) {
      const m = FONT_SIZE_MAPS[key]
      expect(m.fontSizeTiny).toMatch(/px$/)
      expect(m.fontSizeHuge).toMatch(/px$/)
    }
  })
})

// =====================================================================
// 原始块级「深色覆盖」与「子集」断言
// ---------------------------------------------------------------------
// 动机：合成模型 `{...:root, ...dark-mode}` 会用 :root 补齐键，导致
//   「从 body.dark-mode 误删某个非 hero 颜色 token（如 --surface-2 / --primary-light）」
//   无法被 6 组键集合断言捕获（它们又无数值断言）。此处直接在**原始块**上兜底：
//   1) 覆盖断言：:root 的每个颜色类 token 必须也出现在 body.dark-mode；
//   2) 子集断言：4 个 preset 块的键集合必须是 :root 键集合的子集（防拼写错变量名）。
// =====================================================================
describe('theme.scss 深色覆盖完整性（原始块级，未经合成模型）', () => {
  // 非颜色类 token（尺寸/字号/间距/圆角/行高/动效）：不随明暗变，不入覆盖断言
  const NON_COLOR_PREFIXES = ['--radius-', '--space-', '--font-', '--leading-', '--ease-', '--duration-']
  // 恒白前景色：仅 :root 定义、深色有意不覆盖
  const EXCLUDE = new Set(['--on-strong', '--on-strong-rgb'])
  const isColorToken = (name: string) => !NON_COLOR_PREFIXES.some((p) => name.startsWith(p))

  const colorTokensInRoot = Object.keys(rootVars).filter((n) => isColorToken(n) && !EXCLUDE.has(n))

  it(':root 颜色类 token 数量合理（非空洞）', () => {
    expect(colorTokensInRoot.length).toBeGreaterThan(30)
  })

  it('每个颜色类 token 必须也被 body.dark-mode 覆盖', () => {
    const missing = colorTokensInRoot.filter((n) => !(n in darkVars))
    expect(missing, `body.dark-mode 缺少覆盖（深色下会串用 :root 浅色值）：${missing.join(', ')}`).toEqual([])
  })

  const PRESET_BLOCKS: Array<[string, Record<string, string>]> = [
    ['primary.light', primaryLightBlock],
    ['senior.light', seniorLightBlock],
    ['primary.dark', primaryDarkBlock],
    ['senior.dark', seniorDarkBlock],
  ]

  for (const [name, block] of PRESET_BLOCKS) {
    it(`${name} 的键集合是 :root 的子集`, () => {
      const unknown = Object.keys(block).filter((k) => !(k in rootVars))
      expect(unknown, `${name} 含 :root 未定义的变量（拼写？）：${unknown.join(', ')}`).toEqual([])
    })
  }
})

// =====================================================================
// 生成校验 · tokens.ts（唯一源）⇄ theme.scss（生成物）
// ---------------------------------------------------------------------
// 逐 (preset,mode) 用 buildSemantic 派生**完整生效 semantic 表**，与浏览器级联
// 合成出的 EFFECTIVE 逐键比对。派生 token（-rgb/-soft/-soft-strong）若有公式
// 偏差、或显式 token 抄漏，这里必红（V1.2 单源生成地基的直接校验）。
// =====================================================================
describe('tokens.ts ⇄ theme.scss（生成校验）', () => {
  it('tokens.PRESETS / MODES 与本测试一致（单点未漂移）', () => {
    expect(TOKEN_PRESETS).toEqual(PRESETS)
    expect(TOKEN_MODES).toEqual(MODES)
  })

  for (const preset of PRESETS) {
    for (const mode of MODES) {
      describe(`${preset}.${mode}`, () => {
        const sem = buildSemantic(preset, mode)
        const effective = EFFECTIVE[preset][mode]
        for (const [key, value] of Object.entries(sem)) {
          it(`--${key} 与 tokens.ts 派生值一致`, () => {
            const scss = effective[`--${key}`]
            expect(scss, `theme.scss ${preset}.${mode} 缺少 --${key}`).toBeDefined()
            expect(normalizeColor(scss!), `--${key}：theme.scss=${scss} / tokens=${value}`).toBe(
              normalizeColor(value),
            )
          })
        }
      })
    }
  }
})
