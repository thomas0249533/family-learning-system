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

  it('components.scss 未夹带字面量 hex（纯 var() 别名约束）', () => {
    expect(componentsText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
