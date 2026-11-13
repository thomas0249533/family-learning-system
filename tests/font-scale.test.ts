import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONT, FONT_ROLES } from '../src/core/styles/tokens'

// =====================================================================
// D2 · 字号阶梯不变量（零依赖，environment: 'node'）
// ---------------------------------------------------------------------
// 守三件事：
//   a) 阶梯必须是**单调递增**且首尾覆盖 UI 场景（10 → 56）；
//   b) 产物 theme.scss 与 tokens.ts 一致（防手改生成物后忘记 build）；
//   c) `check:font-size` 门禁真实存在且已接进 verify 链（防「有脚本没人跑」）。
// =====================================================================

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const entries = Object.entries(FONT).map(([name, px]) => ({ name, px: Number.parseInt(px, 10) }))

describe('字号阶梯 · 结构与语义', () => {
  it('a) 阶梯单调递增，且每个档位都是整数像素', () => {
    const values = entries.map((e) => e.px)
    expect(values, 'FONT 顺序必须严格递增（token 名本身带序数语义）').toEqual(
      [...values].sort((x, y) => x - y),
    )
    for (const e of entries) {
      expect(Number.isInteger(e.px), `${e.name} 应为整数像素`).toBe(true)
    }
  })

  it('a) 覆盖正文与展示两端（≤10 起点、≥48 终点）', () => {
    const values = entries.map((e) => e.px)
    expect(Math.min(...values)).toBeLessThanOrEqual(10)
    expect(Math.max(...values)).toBeGreaterThanOrEqual(48)
  })

  it('a) 字号角色都落在阶梯刻度上（防止角色自造数值）', () => {
    const scale = new Set(entries.map((e) => e.px))
    for (const [role, px] of Object.entries(FONT_ROLES)) {
      expect(scale.has(Number.parseInt(px, 10)), `--font-${role}=${px} 不在阶梯上`).toBe(true)
    }
  })
})

describe('字号阶梯 · 生成物一致', () => {
  it('b) theme.scss 的 --font-* 声明与 FONT 完全一致', () => {
    const text = read('src/core/styles/theme.scss')
    const declared = new Map<string, string>()
    // 只取「字号阶梯」注释块内的声明，避免命中 --font-display 之类的角色 token
    const block = text.slice(text.indexOf('/* 字号阶梯 */'), text.indexOf('/* 排版角色'))
    for (const m of block.matchAll(/--font-([a-z0-9]+):\s*([^;]+);/g)) declared.set(m[1], m[2].trim())

    const expected = new Map(entries.map((e) => [e.name, `${e.px}px`]))
    expect(Object.fromEntries(declared)).toEqual(Object.fromEntries(expected))
  })

  it('b) SCSS 门面 variables.scss 覆盖每个阶梯档位', () => {
    const text = read('src/core/styles/variables.scss')
    const missing = entries.filter((e) => !text.includes(`$font-${e.name}:`)).map((e) => e.name)
    expect(missing, `variables.scss 缺少 $font-*：${missing.join(', ')}`).toEqual([])
  })
})

describe('字号阶梯 · 门禁本身', () => {
  it('c) check:font-size 脚本存在且接进 verify 链', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:font-size'], 'package.json 应有 check:font-size 脚本').toBeTruthy()
    expect(
      pkg.scripts.verify,
      'verify 链必须包含 check:font-size（否则门禁形同虚设）',
    ).toContain('check:font-size')
    expect(() => read('scripts/check-font-size.mjs')).not.toThrow()
  })
})
