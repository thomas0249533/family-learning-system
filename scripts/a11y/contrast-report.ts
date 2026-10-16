// =====================================================================
// 对比度审计（WCAG AA）· 零依赖（vite-node 运行）
// ---------------------------------------------------------------------
// 数据源：src/core/styles/tokens.ts 的 buildSemantic（6 组 = 3 学段 × 浅/深）。
// 策略：**仅报告 + 小型「必须 PASS」白名单门禁**。
//   · 全表输出到 docs/design-system/a11y.md（人看）；
//   · 只对 MUST_PASS 明确列举的关键对 `exit 1`（CI 卡口）。
//   理由：一刀切 fail 会成枷锁——装饰性叠色、--code-color、遮罩本就不该受
//   文字阈值约束，硬套会逼出大量豁免注释、门禁形同虚设。
//
// 局限（诚实登记）：本脚本只审 token 值本身，**审不到 naive-ui 派生出来的
//   颜色**（例如 type="error"/"warning" 按钮的文字色由 naive 依据 common
//   变量计算）。这类已在本轮通过 buildThemeOverrides 显式覆盖的项，见文末
//   「主按钮」一节与 docs/design-system/a11y.md。
// =====================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildSemantic, PRESETS, MODES, type ThemePreset, type ThemeMode } from '../../src/core/styles/tokens'

/* ---------------------- 颜色工具 ---------------------- */

interface RGBA { r: number; g: number; b: number; a: number }

/** 解析 `#rgb` / `#rrggbb` / `rgb()` / `rgba()`。 */
function parseColor(input: string): RGBA | null {
  const s = String(input ?? '').trim()
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    if (h.length !== 6) return null
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(',').map((x) => x.trim())
  const [r, g, b] = parts.slice(0, 3).map((x) => parseFloat(x))
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1
  return { r, g, b, a: Number.isFinite(a) ? a : 1 }
}

/** 把一个（可能半透明）前景色合成到不透明背景上。 */
function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  }
}

/** 相对亮度（WCAG 定义）。 */
function relLum(c: RGBA): number {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

/** 两色对比度（前景若半透明，先合成到背景）。 */
function contrast(fgRaw: string, bgRaw: string): number | null {
  const fg = parseColor(fgRaw)
  const bg = parseColor(bgRaw)
  if (!fg || !bg) return null
  const bgOpaque = bg.a >= 1 ? bg : composite(bg, { r: 255, g: 255, b: 255, a: 1 })
  const fgOpaque = fg.a >= 1 ? fg : composite(fg, bgOpaque)
  const l1 = relLum(fgOpaque)
  const l2 = relLum(bgOpaque)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------------------- 背景 / 前景解析 ---------------------- */

type Sem = Record<string, string>

/** 解析一个「表面」token → 不透明 RGB 字符串（软色底合成到 card 上）。 */
function surface(sem: Sem, name: string): string {
  const raw = sem[name]
  if (raw === undefined) return '#000000'
  const c = parseColor(raw)
  if (!c) return '#000000'
  if (c.a >= 1) return raw
  // 半透明 → 合成到 card-bg
  const card = parseColor(sem['card-bg']) ?? { r: 255, g: 255, b: 255, a: 1 }
  const over = composite(c, card)
  return `rgb(${over.r}, ${over.g}, ${over.b})`
}

/** 取梯度两个端点（16 进制）。 */
function gradientEnds(value: string): string[] {
  return (value.match(/#[0-9a-fA-F]{3,6}/g) ?? []).slice(0, 2)
}

/* ---------------------- 配对清单 ---------------------- */

interface Pair {
  /** 稳定标识（跨组一致，用于白名单）：`fg ↔ bg` 模板 */
  key: string
  label: string
  fg: string        // 原始值
  bg: string        // 原始值
  threshold: number
}

const TONES = ['primary', 'success', 'warning', 'danger', 'info'] as const
const BG_BODY = 4.5
const BG_LARGE = 3.0

/** 每组的「必须 PASS」白名单（key）。本批修完 / 既有达标的关键对。 */
const MUST_PASS = new Set<string>([
  // 正文对三表面
  'text-main ↔ card-bg',
  'text-main ↔ bg-color',
  'text-sub ↔ card-bg',
  'text-sub ↔ bg-color',
  'text-sub ↔ surface-2',
  'text-sub ↔ bg-color-hover',
  'text-muted ↔ card-bg',
  'text-muted ↔ bg-color',
  // 软底徽章：tone-text on tone-light
  ...TONES.map((t) => `${t}-text ↔ ${t}-light`),
  // 实心徽章 / 实心块：text-on-primary on tone-text（含 neutral=text-sub）
  ...TONES.map((t) => `text-on-primary ↔ ${t}-text`),
  'text-on-primary ↔ text-sub',
  // StatCard primary 数值（大号 3.0）
  'primary-text ↔ card-bg',
])

function buildPairs(sem: Sem): Pair[] {
  const pairs: Pair[] = []
  const add = (fgName: string, bgName: string, threshold = BG_BODY, label?: string, fgOverride?: string): void => {
    const fgVal = fgOverride ?? sem[fgName]
    const bgVal = surface(sem, bgName)
    if (fgVal === undefined) return
    pairs.push({
      key: `${fgName} ↔ ${bgName}`,
      label: label ?? `${fgName} on ${bgName}`,
      fg: fgVal,
      bg: bgVal,
      threshold,
    })
  }

  // ① 正文 × 表面
  for (const t of ['text-main', 'text-sub', 'text-muted']) {
    for (const b of ['bg-color', 'card-bg', 'surface-2', 'bg-color-hover']) add(t, b)
  }

  // ② tone-color / tone-text × bg / card / 自身 -light
  for (const g of TONES) {
    for (const f of [`${g}-color`, `${g}-text`]) {
      for (const b of ['bg-color', 'card-bg', `${g}-light`]) add(f, b)
    }
  }

  // ③ on-strong / text-on-primary × 语义实心底 / text-sub
  for (const g of TONES) {
    for (const f of ['on-strong', 'text-on-primary']) {
      for (const b of [`${g}-color`, `${g}-text`]) add(f, b)
    }
  }
  for (const f of ['on-strong', 'text-on-primary']) add(f, 'text-sub')

  // ④ primary 专项 × bg / card
  for (const f of ['primary-color', 'primary-text']) {
    for (const b of ['bg-color', 'card-bg']) {
      add(f, b, f === 'primary-text' && b === 'card-bg' ? BG_LARGE : BG_BODY)
    }
  }

  // ⑤ code-color × card / bg
  for (const b of ['card-bg', 'bg-color']) add('code-color', b)

  // ⑥ text-main/-sub × tone-light
  for (const g of TONES) {
    for (const f of ['text-main', 'text-sub']) add(f, `${g}-light`)
  }

  return pairs
}

/* ---------------------- 渲染 ---------------------- */

interface Row extends Pair { group: string; groupLabel: string; value: number | null; pass: boolean; must: boolean }

const GROUPS: Array<[ThemePreset, ThemeMode, string]> = PRESETS.flatMap((p) =>
  MODES.map((m) => [p, m, `${p}.${m}`] as [ThemePreset, ThemeMode, string]),
)

const allRows: Row[] = []
for (const [preset, mode, label] of GROUPS) {
  const sem = buildSemantic(preset, mode)
  for (const p of buildPairs(sem)) {
    const value = contrast(p.fg, p.bg)
    const pass = value !== null && value >= p.threshold
    allRows.push({ ...p, group: label, groupLabel: label, value, pass, must: MUST_PASS.has(p.key) })
  }
}

/* ---------------------- 报告 ---------------------- */

const md: string[] = []
md.push('# 对比度审计（WCAG AA）')
md.push('')
md.push('> 自动生成：`npm run a11y:contrast`（`scripts/a11y/contrast-report.ts`，vite-node，零依赖）')
md.push('> 数据源：`src/core/styles/tokens.ts` 的 `buildSemantic`（6 组 = 3 学段 × 浅/深）')
md.push('> 阈值：正文 **4.5** / 大号 **3.0**')
md.push('')
md.push('## 大号文本判据')
md.push('')
md.push('仅两处算大号（≥20px 且 ≥700）：')
md.push('- `PageHeader.vue` 标题（`--font-2xl` 20px + 700）')
md.push('- `StatCard.vue` 数值（26px + 800）')
md.push('')
md.push('其余**全部按正文 4.5**。')
md.push('')
md.push('## 脚本局限（诚实登记）')
md.push('')
md.push('- 本脚本只审 **token 值本身**，**审不到 naive-ui 派生出来的颜色**（如 `type="error"/"warning"` 按钮文字色由 naive 依据 common 变量计算）。')
md.push('- 主按钮（primary 实心）已由 `buildThemeOverrides` 的 `Button.colorPrimary / textColorPrimary` 显式覆盖；其 6 组实测见下节。')
md.push('')
md.push('## 主按钮实测（浏览器 computed，非推导）')
md.push('')
md.push('| group | 前景 | 背景 | 对比度 | 结果 |')
md.push('|---|---|---|---|---|')
for (const line of [
  '| primary.light | #ffffff | #ae5509 | 5.12 | ✅ |',
  '| junior.light | #ffffff | #2d6a4f | 6.39 | ✅ |',
  '| senior.light | #ffffff | #3b5b7a | 7.09 | ✅ |',
  '| primary.dark | #1a1005 | #ffa447 | 9.51 | ✅ |',
  '| junior.dark | #08120e | #53ad85 | 6.97 | ✅ |',
  '| senior.dark | #0a0f14 | #7fa3c4 | 7.27 | ✅ |',
]) md.push(line)
md.push('')

for (const [preset, mode, label] of GROUPS) {
  md.push(`## ${label}`)
  md.push('')
  md.push('| 前景 | 背景 | 对比度 | 阈值 | 结果 |')
  md.push('|---|---|---|---|---|')
  for (const r of allRows.filter((x) => x.group === label)) {
    const v = r.value === null ? 'n/a' : r.value.toFixed(2)
    const ok = r.pass ? '✅' : '❌'
    md.push(`| \`${r.fg}\` | \`${r.bg}\` | ${v} | ${r.threshold} | ${ok} |`)
  }
  md.push('')
}

/* ---------------------- §可见变化登记 ---------------------- */
md.push('## §可见变化登记')
md.push('')
md.push('| group | token | 改前 | 改后 | 实测新比值 | 为什么必须改 | 类别 |')
md.push('|---|---|---|---|---|---|---|')
const CHANGES: string[][] = [
  ['全部 6 组', '--{tone}-text（新增）', '（无）', '手调 AA 值', '见上表', '软底色字 / 实心底 / 自身软底字统一取 AA 值', '(c) 修 bug'],
  ['primary.light', '--text-muted', '#877665', '#807060', '4.60 / 4.74', '原值对 bg/card 低于 4.5', '(c) 修 bug'],
  ['primary/junior/senior .light', 'danger 文字（改走 --danger-text）', '#dc2626', '#d42525', '4.51（对 danger-light）', '原 danger 文字对软色底 4.26 ✗', '(a) 用户已授权'],
  ['全部 6 组', '主按钮 fg/bg（Button 覆盖）', 'naive 派生', 'text-on-primary / primary-text', '5.12–9.51', 'naive 误判浅色 → 深色三组 2.99/1.97/2.65 ✗', '(c) 修 bug'],
  ['全部 6 组', '页面级 5 处实心块（bg + 文字）', 'bg=$primary/$danger/$success-color + 白字', 'bg=var(--{tone}-text) + color=var(--text-on-primary)', '≥4.5', '深色下白字对语义/主色底不足；primary.light 白字对 #f2760c 仅 2.85', '(b) 新授权'],
]
for (const c of CHANGES) md.push('| ' + c.join(' | ') + ' |')
md.push('')
md.push('类别：(a) 用户已授权 / (b) 本批新授权 / (c) 修 bug')
md.push('')

const outPath = resolve(process.cwd(), 'docs/design-system/a11y.md')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, md.join('\n'), 'utf8')

/* ---------------------- 门禁 ---------------------- */

const mustFails = allRows.filter((r) => r.must && !r.pass)
const totalFails = allRows.filter((r) => !r.pass).length

console.log(`[a11y:contrast] 报告已写入 ${outPath}`)
console.log(`[a11y:contrast] 配对总数 ${allRows.length}；非通过（仅报告）${totalFails}；必须 PASS 清单失败 ${mustFails.length}`)
if (mustFails.length > 0) {
  console.error('[a11y:contrast] ✗ 必须 PASS 清单出现不达标：')
  for (const r of mustFails) {
    console.error(`  - [${r.group}] ${r.label} = ${r.value?.toFixed(2)} (< ${r.threshold})`)
  }
  process.exit(1)
}
console.log('[a11y:contrast] ✓ 必须 PASS 清单全部达标')
