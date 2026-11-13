// =====================================================================
// D6 · 图标对比度护栏（WCAG 1.4.11 ≥ 3:1）
// ---------------------------------------------------------------------
// 这一份测试守四件事，缺一件登记表就会慢慢变假：
//   ① **测量**：39 处登记 × 6 组主题，must 档逐格 ≥3.0、brand 档不得比下限更差；
//   ② **契约**：`IconBase` 必须仍是 `stroke="currentColor"` —— 一旦有人把它改成
//      自带 fill，整张表算的就不再是实际渲染的颜色（表继续绿、界面已经不对）；
//   ③ **发现**：扫模板里 `<IconBase>` 的直接包裹元素，凡是「彩色底」的类名都必须
//      登记过。没有这一条，新增一个 chip 就能绕开全部测量；
//   ④ **回潮**：内嵌一份 `check-icon-contrast` 的门禁逻辑，脚本被删/被改坏时测试自己红。
//
// 为什么不用快照/截图来守：截图只能证明「此刻长这样」，证明不了「下一版还看得见」；
// 而这里算的是**颜色本身**，改 token 就立刻反映出来。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { buildSemantic, PRESETS, MODES, type ThemePreset, type ThemeMode } from '../src/core/styles/tokens'
import { ICON_SPOTS, spotKeys, type Sem } from '../src/core/a11y/icon-spots'

const ROOT = process.cwd()
const GROUPS: Array<[ThemePreset, ThemeMode, string]> = PRESETS.flatMap((p) =>
  MODES.map((m) => [p, m, `${p}.${m}`] as [ThemePreset, ThemeMode, string]),
)

/** 与 contrasts 报告同一套公式（WCAG 相对亮度 + 对比度） */
function parse(input: string): { r: number; g: number; b: number; a: number } | null {
  const s = String(input ?? '').trim()
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    if (h.length !== 6) return null
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const p = m[1].split(',').map((x) => x.trim())
  const [r, g, b] = p.slice(0, 3).map((x) => parseFloat(x))
  const a = p[3] !== undefined ? parseFloat(p[3]) : 1
  return { r, g, b, a: Number.isFinite(a) ? a : 1 }
}
function lum(c: { r: number; g: number; b: number }): number {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
function ratio(fgRaw: string, bgRaw: string): number | null {
  const fg = parse(fgRaw)
  const bg = parse(bgRaw)
  if (!fg || !bg) return null
  const hi = Math.max(lum(fg), lum(bg))
  const lo = Math.min(lum(fg), lum(bg))
  return (hi + 0.05) / (lo + 0.05)
}

/** 每处登记在 6 组里的最差实测值 */
function worstOf(index: number): { value: number; group: string } {
  const spot = ICON_SPOTS[index]
  let worst = { value: Number.POSITIVE_INFINITY, group: '' }
  for (const [preset, mode, label] of GROUPS) {
    const sem = buildSemantic(preset, mode) as unknown as Sem
    const fgVal = spot.fg(sem, mode)
    const bgVals = spot.bg(sem, mode)
    expect(bgVals.length, `${spot.where} 的底解析不出颜色`).toBeGreaterThan(0)
    const v = Math.min(...bgVals.map((b) => ratio(fgVal, b) ?? 0))
    if (v < worst.value) worst = { value: v, group: label }
  }
  return worst
}

/* ---------------------- ② 契约 ---------------------- */

describe('IconBase 契约', () => {
  const src = readFileSync(resolve(ROOT, 'src/components/ui/IconBase.vue'), 'utf8')

  it('用 currentColor 染色（否则整张图标对比度表算的不是实际颜色）', () => {
    expect(src).toContain('stroke="currentColor"')
    expect(src).toMatch(/fill="none"/)
  })

  it('不写死任何颜色（只允许 currentColor / none）', () => {
    const template = src.slice(0, src.indexOf('<style'))
    const hits = template.match(/#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d/gi) ?? []
    expect(hits).toEqual([])
  })

  it('默认对读屏隐藏，传 label 才当 img（图标不重复朗读旁边已有的文字）', () => {
    expect(src).toContain(":role=\"label ? 'img' : 'presentation'\"")
    expect(src).toContain(":aria-hidden=\"label ? undefined : 'true'\"")
  })
})

/* ---------------------- ① 测量 ---------------------- */

describe('图标对比度矩阵（6 组 × 39 处登记）', () => {
  it('must 档：每一处、每一组都 ≥ 3.0', () => {
    const fails = ICON_SPOTS.flatMap((spot, i) => {
      if (spot.kind !== 'must') return []
      const { value, group } = worstOf(i)
      return value + 0.005 >= 3.0 ? [] : [`${spot.where} [${group}] = ${value.toFixed(2)}`]
    })
    expect(fails).toEqual([])
  })

  it('brand 档：不得比登记下限更差（品牌渐变豁免只保「不变差」）', () => {
    const fails = ICON_SPOTS.flatMap((spot, i) => {
      if (spot.kind !== 'brand') return []
      const { value, group } = worstOf(i)
      const floor = spot.floor ?? 0
      return value + 0.005 >= floor ? [] : [`${spot.where} [${group}] = ${value.toFixed(2)} < ${floor}`]
    })
    expect(fails).toEqual([])
  })

  it('brand 档必须写明下限与理由（否则「豁免」就是没账可查）', () => {
    for (const spot of ICON_SPOTS.filter((s) => s.kind === 'brand')) {
      expect(spot.floor, spot.where).toBeGreaterThan(0)
      expect((spot.note ?? '').length, spot.where).toBeGreaterThan(8)
    }
  })

  it('反证：`-color` 当实心底 + 白前景确实过不了 3:1（防止有人「审美上」改回去）', () => {
    // D6 修掉的写法：background: --{tone}-color + color: --text-on-primary
    // 它曾经在 primary.light 上是 2.85:1 —— 连非文本的 3.0 都不到。
    let worst = Number.POSITIVE_INFINITY
    for (const [preset, mode] of GROUPS) {
      const sem = buildSemantic(preset, mode) as unknown as Sem
      for (const tone of ['primary', 'success', 'warning', 'danger', 'info']) {
        worst = Math.min(worst, ratio(sem['text-on-primary'], sem[`${tone}-color`]) ?? 0)
      }
    }
    expect(worst).toBeLessThan(3.0)
    // 换成 -text 底之后同一组前景全部 ≥4.5
    for (const [preset, mode] of GROUPS) {
      const sem = buildSemantic(preset, mode) as unknown as Sem
      for (const tone of ['primary', 'success', 'warning', 'danger', 'info']) {
        expect(ratio(sem['text-on-primary'], sem[`${tone}-text`]) ?? 0).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('登记表自身完整：文件存在、where 不重复、cls 合法', () => {
    const wheres = new Set<string>()
    for (const spot of ICON_SPOTS) {
      expect(existsSync(resolve(ROOT, spot.file)), `登记指向不存在的文件：${spot.file}`).toBe(true)
      expect(wheres.has(spot.where), `where 重复：${spot.where}`).toBe(false)
      wheres.add(spot.where)
      expect(spot.cls).toMatch(/^[a-z][\w-]*$/)
      expect(spot.file).toMatch(/^src\/.*\.vue$/)
    }
  })
})

/* ---------------------- ③ 发现 ---------------------- */

const COLORED_BG =
  /(gradient|badge-(?!neutral)|-(?:primary|success|warning|danger|info)-light|-(?:primary|success|warning|danger|info)-color|rgba\(var\(--(?:primary|success|warning|danger|info|on-strong)-rgb)/

function walkVue(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkVue(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
}

/** 抽某个类名的规则体（`&`-嵌套也算），用于判断它有没有彩色底 */
function bodiesOf(style: string, cls: string): string[] {
  const bodies: string[] = []
  const re = new RegExp(`[.&]${cls.replace(/[-_/]/g, '[-_/]')}(?![\\w-])[^{]*\\{`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(style)) !== null) {
    let depth = 0
    const start = m.index + m[0].length - 1
    let j = start
    for (; j < style.length; j += 1) {
      if (style[j] === '{') depth += 1
      else if (style[j] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    bodies.push(style.slice(start + 1, j))
  }
  return bodies
}

/**
 * 扫出「`<IconBase>` 的直接包裹元素带彩色底」的所有 `文件#类名`。
 *
 * ⚠️ **已知盲区（必须知道，否则会误以为门禁是全覆盖）**：只认「**包裹元素自己的**规则里
 * 有彩色底」。若底色来自**父级修饰类**（`AppBadge` 的 `.app-badge--primary` 给
 * `.app-badge__icon` 提供底），这里扫不到 —— 那类靠人工登记补（`AppBadge` 就是）。
 * 宁可承认盲区，也不要为了让扫描"看起来更全"去猜祖先链：猜错会制造假的必过项。
 */
function discoverColoredIconWrappers(): string[] {  const files: string[] = []
  walkVue(resolve(ROOT, 'src'), files)
  const found: string[] = []
  for (const abs of files) {
    const src = readFileSync(abs, 'utf8')
    if (!src.includes('<IconBase')) continue
    const styleAt = src.indexOf('<style')
    const tpl = styleAt > 0 ? src.slice(0, styleAt) : src
    const style = styleAt > 0 ? src.slice(styleAt) : ''
    if (style === '') continue
    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    const lines = tpl.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const pos = line.indexOf('<IconBase')
      if (pos < 0) continue
      // 直接包裹元素：同行前缀最后一个 class，否则向上 3 行内最近的 class
      let raw: string | undefined
      const pre = [...line.slice(0, pos).matchAll(/class="([^"]+)"/g)]
      if (pre.length > 0) raw = pre[pre.length - 1][1]
      else {
        for (let k = i - 1; k >= Math.max(0, i - 3); k -= 1) {
          if (lines[k].includes('<IconBase')) continue
          const m = lines[k].match(/class="([^"]+)"/)
          if (m) {
            raw = m[1]
            break
          }
        }
      }
      if (!raw) continue
      const tokens = raw.split(/\s+/).filter((c) => /^[a-z][\w-]*$/i.test(c))
      const cls = tokens[tokens.length - 1]
      if (!cls) continue
      const colored = bodiesOf(style, cls).some((b) => {
        for (const m of b.matchAll(/background(?:-color)?\s*:\s*([^;]+);/g)) {
          if (COLORED_BG.test(m[1])) return true
        }
        return false
      })
      if (colored) found.push(`${rel}#${cls}`)
    }
  }
  return [...new Set(found)]
}

describe('发现门禁：新增彩色图标 chip 必须登记', () => {
  it('模板里每个「带彩色底的 IconBase 包裹元素」都在登记表里', () => {
    const registered = spotKeys()
    const missing = discoverColoredIconWrappers().filter((k) => !registered.has(k))
    expect(
      missing,
      `以下位置把 <IconBase> 放进了彩色底容器，却没有登记进 src/core/a11y/icon-spots.ts：\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('扫描器不是空转（确实扫到了已知的彩色 chip）', () => {
    const found = discoverColoredIconWrappers()
    expect(found.length).toBeGreaterThanOrEqual(8)
    expect(found).toContain('src/components/ui/StatCard.vue#stat-card__icon')
    expect(found).toContain('src/views/learn/UnitList.vue#unit-card-source')
  })
})

/* ---------------------- ④ 回潮 ---------------------- */

describe('check:icon-contrast 门禁在位且有效', () => {
  const scriptPath = resolve(ROOT, 'scripts/check-icon-contrast.mjs')

  it('脚本存在，且接在 verify 链里（就在 check:a11y 之后）', () => {
    expect(existsSync(scriptPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:icon-contrast']).toContain('check-icon-contrast.mjs')
    expect(pkg.scripts.verify).toContain('npm run check:icon-contrast')
    expect(pkg.scripts.verify.indexOf('check:icon-contrast')).toBeGreaterThan(
      pkg.scripts.verify.indexOf('check:a11y'),
    )
  })

  /**
   * 内嵌一份门禁逻辑：`-color` 当实心底 + `text-on-primary`/`on-strong` 前景 = 违规。
   * 只查**叶子块**（块内没有嵌套 `{`），否则 SCSS 嵌套会把子规则的 color 带进父块 → 误报。
   */
  it('全仓没有「-color 当实心底 + 亮前景」的写法', () => {
    const files: string[] = []
    const walkStyle = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walkStyle(full)
        else if (/\.(vue|scss)$/.test(name)) files.push(full)
      }
    }
    walkStyle(resolve(ROOT, 'src'))

    const offenders: string[] = []
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8')
      if (!src.includes('-color')) continue
      const stack: number[] = []
      for (let i = 0; i < src.length; i += 1) {
        if (src[i] === '{') stack.push(i)
        else if (src[i] === '}') {
          const open = stack.pop()
          if (open === undefined) continue
          const body = src.slice(open + 1, i)
          if (body.includes('{')) continue
          if (/check-icon-contrast-allow/.test(body)) continue
          const graphic = /background(?:-color)?\s*:\s*(?:\$|var\(--)?(?:primary|success|warning|danger|info)-color\b/.test(body)
          const foreground = /(?:^|[;{\s])color\s*:\s*(?:var\(--)?(?:text-on-primary|on-strong)\b/.test(body)
          if (graphic && foreground) {
            offenders.push(`${relative(ROOT, abs).replace(/\\/g, '/')}:${src.slice(0, open).split('\n').length}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
