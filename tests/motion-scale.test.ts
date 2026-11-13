import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MOTION } from '../src/core/styles/tokens'

// =====================================================================
// D3 · 动效刻度不变量（零依赖，environment: 'node'）
// ---------------------------------------------------------------------
// 守四件事：
//   a) 时长刻度单调递增、落在「交互反馈」区间（≤600ms）；
//   b) 四类曲线互不重复（防伪 token：两个名字同一个曲线）；
//   c) theme.scss / variables.scss 与 MOTION 一致（防手改生成物）；
//   d) 全局无障碍降级存在，且 check:motion 已接进 verify 链。
// =====================================================================

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const durations = ['durationFast', 'durationBase', 'durationSlow', 'durationSlower', 'durationSlowest']
  .map((k) => ({ key: k, ms: Number.parseInt((MOTION as Record<string, string>)[k], 10) }))

const eases = ['easeStandard', 'easeEmphasized', 'easeSpring', 'easeDecelerate']
  .map((k) => ({ key: k, value: (MOTION as Record<string, string>)[k] }))

/** camelCase 键 → CSS 名：durationFast → duration-fast / easeStandard → ease-standard */
const cssName = (key: string) => key.replace(/^([a-z]+)([A-Z])/, '$1-$2').replace(/[A-Z]/g, (c) => c.toLowerCase())

describe('动效刻度 · 结构与语义', () => {
  it('a) 时长单调递增，且每档 ≤ 600ms（更久的属一次性编排）', () => {
    const values = durations.map((d) => d.ms)
    expect(values, 'duration 顺序必须严格递增').toEqual([...values].sort((x, y) => x - y))
    expect(Math.max(...values), '交互反馈不应超过 600ms').toBeLessThanOrEqual(600)
    expect(Math.min(...values), '最快一档不应低于 100ms（否则无过渡感）').toBeGreaterThanOrEqual(100)
  })

  it('a) 相邻档位间隔 ≥ 40ms（否则肉眼分不出两档的差别）', () => {
    for (let i = 1; i < durations.length; i++) {
      const gap = durations[i].ms - durations[i - 1].ms
      expect(gap, `${durations[i - 1].key} → ${durations[i].key} 间隔 ${gap}ms 过小`).toBeGreaterThanOrEqual(40)
    }
  })

  it('b) 四类缓动曲线互不重复（禁止两个 token 同一个曲线）', () => {
    const values = eases.map((e) => e.value)
    expect(new Set(values).size, `缓动曲线存在重复：${JSON.stringify(values)}`).toBe(values.length)
  })

  it('b) 缓动值都是合法 cubic-bezier', () => {
    for (const e of eases) {
      expect(e.value, `${e.key} 必须是 cubic-bezier(...)`).toMatch(/^cubic-bezier\(\s*[-\d.]+,\s*[-\d.]+,\s*[-\d.]+,\s*[-\d.]+\s*\)$/)
    }
  })
})

describe('动效刻度 · 生成物一致', () => {
  it('c) theme.scss 的 --duration-* / --ease-* 与 MOTION 一致', () => {
    const text = read('src/core/styles/theme.scss')
    const declared = new Map<string, string>()
    for (const m of text.matchAll(/--(duration-[a-z]+|ease-[a-z]+):\s*([^;]+);/g)) {
      declared.set(m[1], m[2].trim())
    }
    for (const d of durations) {
      const name = cssName(d.key)
      expect(declared.get(name), `theme.scss 缺少或错值 ${name}`).toBe(`${d.ms}ms`)
    }
    for (const e of eases) {
      const name = cssName(e.key)
      expect(declared.get(name), `theme.scss 缺少或错值 ${name}`).toBe(e.value)
    }
  })

  it('c) SCSS 门面 variables.scss 覆盖每个动效档位', () => {
    const text = read('src/core/styles/variables.scss')
    const missing = [
      ...durations.map((d) => `$${cssName(d.key)}`),
      ...eases.map((e) => `$${cssName(e.key)}`),
    ].filter((name) => !text.includes(`${name}:`))
    expect(missing, `variables.scss 缺少：${missing.join(', ')}`).toEqual([])
  })
})

describe('动效刻度 · 无障碍与门禁', () => {
  it('d) 存在全局 prefers-reduced-motion 降级，并被 index.scss 引入', () => {
    const motion = read('src/core/styles/motion.scss')
    expect(motion).toContain('prefers-reduced-motion: reduce')
    expect(motion).toContain('transition-duration')
    expect(motion).toContain('animation-duration')
    expect(read('src/core/styles/index.scss'), 'index.scss 必须 @import motion.scss').toContain("'./motion.scss'")
  })

  it('d) check:motion 脚本存在且接进 verify 链', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['check:motion'], 'package.json 应有 check:motion 脚本').toBeTruthy()
    expect(pkg.scripts.verify, 'verify 链必须包含 check:motion').toContain('check:motion')
    expect(() => read('scripts/check-motion.mjs')).not.toThrow()
  })

  it('d) 组件里的动效声明不写裸时长/裸缓动（门禁的抽样复核）', () => {
    const dir = join(ROOT, 'src')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(vue|scss)$/.test(e.name)) continue
        if (['theme.scss', 'print.scss', 'motion.scss'].includes(e.name)) continue
        for (const [i, line] of readFileSync(p, 'utf8').split('\n').entries()) {
          if (line.includes('check-motion-allow')) continue
          for (const m of line.matchAll(/(?:^|[{;])\s*(?:transition|animation)(?:-[a-z]+)?\s*:\s*([^;{}]+);/g)) {
            const bare = m[1].replace(/var\([^)]*\)/g, ' ').replace(/\$[a-z-]+/g, ' ')
            if (/\b(ease|ease-in|ease-out|ease-in-out)\b/.test(bare)) hits.push(`${p}:${i + 1} 裸缓动`)
            else if (/(\d*\.?\d+)(m?s)\b/.test(bare) && !/\b0(m?s)\b/.test(bare)) hits.push(`${p}:${i + 1} 裸时长`)
          }
        }
      }
    }
    walk(dir)
    expect(hits, `发现未走 token 的动效：\n${hits.join('\n')}`).toEqual([])
  })
})
