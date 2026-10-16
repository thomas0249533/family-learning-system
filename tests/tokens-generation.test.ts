// =====================================================================
// 生成物守卫（§2.3 三重防护之③）
// ---------------------------------------------------------------------
// a) 磁盘 theme.scss / palette.ts === 内存生成（同样经 EOL 规范化）；
// b) 两产物均含 §2.2 banner（`DO NOT EDIT`）；
// c) **内存变异法自证非空洞**：篡改值 / 删 banner / 生成器返回空 → 必须变红；
// d) components.scss（手写组件级 token）⇄ tokens.ts 的 COMPONENT_TOKENS 一致（防漂移）。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateThemeScss, generatePaletteTs, BANNER } from '../scripts/tokens/emit'
import { COMPONENT_TOKENS } from '../src/core/styles/tokens'
import { findLiteralColors } from './helpers/colorLiterals'

const ROOT = process.cwd()
const themePath = resolve(ROOT, 'src/core/styles/theme.scss')
const palettePath = resolve(ROOT, 'src/core/styles/palette.ts')
const componentsPath = resolve(ROOT, 'src/core/styles/components.scss')

const normalize = (s: string): string => s.replace(/\r\n/g, '\n')

const diskTheme = normalize(readFileSync(themePath, 'utf8'))
const diskPalette = normalize(readFileSync(palettePath, 'utf8'))
const componentsText = readFileSync(componentsPath, 'utf8')

/** 抽取一段文本里所有 `--x: value;`（含 :root 与选择器块，够本文件用）。 */
function collectCssVars(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) map[m[1]] = m[2].trim()
  return map
}

// 与 check.ts 相同的比对口径：内存生成（EOL 规范化后）⇄ 磁盘。
const diskEqualsTheme = (candidate: string): boolean => normalize(candidate) === diskTheme
const diskEqualsPalette = (candidate: string): boolean => normalize(candidate) === diskPalette

describe('生成物 ⇄ tokens.ts（磁盘 === 内存生成）', () => {
  it('theme.scss 与内存生成逐字节一致', () => {
    expect(diskEqualsTheme(generateThemeScss()), 'theme.scss 漂移：请运行 npm run tokens:build').toBe(true)
  })

  it('palette.ts 与内存生成逐字节一致', () => {
    expect(diskEqualsPalette(generatePaletteTs()), 'palette.ts 漂移：请运行 npm run tokens:build').toBe(true)
  })
})

describe('生成物 banner（防手改，§2.2）', () => {
  it('theme.scss 首行含 DO NOT EDIT banner', () => {
    expect(diskTheme.startsWith(BANNER)).toBe(true)
    expect(diskTheme).toContain('DO NOT EDIT')
  })

  it('palette.ts 首行含 DO NOT EDIT banner', () => {
    expect(diskPalette.startsWith(BANNER)).toBe(true)
    expect(diskPalette).toContain('DO NOT EDIT')
  })
})

describe('变异自证非空洞（防「假通过」）', () => {
  it('篡改一个值 → 磁盘比对必须失败', () => {
    const mutated = generateThemeScss().replace('#2d6a4f', '#2d6a50')
    expect(mutated).not.toBe(generateThemeScss()) // 确已变异
    expect(diskEqualsTheme(mutated)).toBe(false)
  })

  it('删掉 banner → 磁盘比对必须失败', () => {
    const stripped = generateThemeScss().replace(BANNER, '')
    expect(stripped.startsWith(BANNER)).toBe(false)
    expect(diskEqualsTheme(stripped)).toBe(false)
  })

  it('生成器返回空串 → 磁盘比对必须失败', () => {
    expect(diskEqualsTheme('')).toBe(false)
    expect(diskEqualsPalette('')).toBe(false)
  })
})

describe('components.scss ⇄ tokens.ts COMPONENT_TOKENS（第三层不漂移）', () => {
  const scssVars = collectCssVars(componentsText)

  for (const [name, value] of Object.entries(COMPONENT_TOKENS)) {
    it(`--${name} 与 tokens.COMPONENT_TOKENS 一致`, () => {
      expect(scssVars[`--${name}`], `components.scss 缺少 --${name}`).toBeDefined()
      expect(scssVars[`--${name}`]).toBe(value)
    })
  }

  // —— 零字面量色守卫（H2）——
  // scripts/check-hex.mjs 的 SCAN_DIRS 不含 src/core/styles/**，故本文件必须单独守卫。
  // 只扫「声明值」而非整文件，避免中文注释误伤；var() 引用（如 rgba(var(--primary-rgb), 0.55)，
  // `rgba(` 后是 `var` 非数字）为合法引用，必须放行。
  // 正则统一来自 tests/helpers/colorLiterals.ts（单一源；含「纯黑阴影」豁免）。

  it('components.scss 声明值零字面量色（hex / rgb / hsl / 命名色）', () => {
    const hits: string[] = []
    for (const [name, value] of Object.entries(scssVars)) {
      const kinds = findLiteralColors(value)
      if (kinds.length > 0) hits.push(`--${name}: ${value} [${kinds.join(',')}]`)
    }
    expect(
      hits,
      `components.scss 含字面量色（组件级 token 只允许 var()/尺寸）：${hits.join(' | ')}`,
    ).toEqual([])
  })

  it('check-hex.mjs 的正则与本地镜像一致（防第二套真相漂移）', () => {
    const src = readFileSync(resolve(ROOT, 'scripts/check-hex.mjs'), 'utf8')
    expect(src, 'check-hex.mjs 的 HEX 正则已变，请同步本测试镜像').toContain(
      'const HEX = /#([0-9a-fA-F]{3,8})\\b/',
    )
    expect(src, 'check-hex.mjs 的 RGB_NUM 正则已变，请同步本测试镜像').toContain(
      'const RGB_NUM = /rgba?\\(\\s*\\d/i',
    )
    expect(src, 'check-hex.mjs 的 HSL_NUM 正则已变，请同步本测试镜像').toContain(
      'const HSL_NUM = /hsla?\\(\\s*\\d/i',
    )
  })
})

// =====================================================================
// 组件级 token 声明「作用域」守卫（防 81841fc 那类缺陷复发）
// ---------------------------------------------------------------------
// 根因：自定义属性在**声明所在元素**的 computed-value 阶段就完成 `var()`
// 替换，子元素只继承替换后的结果。主题覆盖全部落在 `body[...]` / `body.dark-mode`
// （theme.scss）。若把 components.scss 的别名声明在 `:root`，别名会在 `:root`
// 处被**提前**求值为浅色值 → 深色 / 非默认预设下不再跟随覆盖 → 深色卡片上
// 深色字、徽章用浅色底、焦点环用错色相。声明在 `body` 上即与覆盖同元素。
// 该缺陷只有「深色渲染」能暴露（palette.ts 全等断言与浅色基线都抓不到），
// 故必须显式加静态守卫。断言前先剥离注释，避免文档里解释 `:root` 时误报。
// =====================================================================
describe('components.scss 声明作用域守卫（链式 var() 不得置于 :root）', () => {
  /** 剥离块注释与行注释，只留可执行代码。 */
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('components.scss 不得存在 :root 选择器块', () => {
    const code = stripComments(componentsText)
    expect(
      /:\s*root\b/.test(code),
      'components.scss 出现 :root 选择器。组件级 token 必须声明在 `body`：'
        + '自定义属性在「声明所在元素」的 computed-value 阶段就完成 var() 替换，'
        + '声明在 :root 会被提前求值为浅色值，深色 / 非默认预设下不跟随 '
        + 'body[...] / body.dark-mode 覆盖 → 表现为深色卡片上深色字、徽章浅色底、焦点环错色相。'
        + '请把别名块的选择器改为 `body`。',
    ).toBe(false)
  })

  it('作用域守卫非空洞：:root 块必命中、注释中的 :root 必放行', () => {
    // ① 非空洞：合成一个 :root 选择器块，同一检测必须命中（证明正则真的在把关）
    expect(/:\s*root\b/.test(stripComments(':root {\n  --x: var(--y);\n}'))).toBe(true)
    // ② 防误报：只出现在注释里的 :root 不得命中（本文件解释性注释会提到 :root）
    const commentedOnly = stripComments(
      '// 不要写在 :root\n/* :root 会被提前求值 */\nbody { --x: var(--y); }',
    )
    expect(/:\s*root\b/.test(commentedOnly)).toBe(false)
  })
})
