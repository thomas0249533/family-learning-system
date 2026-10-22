// =====================================================================
// 对比度审计（WCAG AA）· 零依赖（vite-node 运行）
// ---------------------------------------------------------------------
// 数据源：src/core/styles/tokens.ts 的 buildSemantic（6 组 = 3 学段 × 浅/深）。
// 策略（批 6a-2 收口）：
//   · 全表输出到 docs/design-system/a11y.md（人看）；
//   · **三类门禁**，任一红即 exit 1：
//       (1) MUST_PASS：覆盖**所有真实会被渲染的文字/背景对**；
//       (2) 例外表：真实但接受低于 AA 的组合，逐行带「不得变差」下限断言；
//       (3) 无未分类失败项：每个 ❌ 必须是 例外 / 已由「语义色分工」判定为
//           不适用（图形色 / 非真实渲染），否则视为未登记 → 失败。
//   理由：只做「小型白名单」会让门禁沦为装饰（见批 6a 复盘）。
// =====================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildSemantic, FONT, PRESETS, MODES, type ThemePreset, type ThemeMode } from '../../src/core/styles/tokens'

/* ---------------------- 颜色工具 ---------------------- */

interface RGBA { r: number; g: number; b: number; a: number }

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

function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  }
}

function relLum(c: RGBA): number {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

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
  const card = parseColor(sem['card-bg']) ?? { r: 255, g: 255, b: 255, a: 1 }
  const over = composite(c, card)
  return `rgb(${over.r}, ${over.g}, ${over.b})`
}

function gradientEnds(value: string): string[] {
  return (value.match(/#[0-9a-fA-F]{3,6}/g) ?? []).slice(0, 2)
}

/* ---------------------- 配对清单 ---------------------- */

interface Pair {
  key: string
  label: string
  fg: string
  bg: string
  threshold: number
}

const TONES = ['primary', 'success', 'warning', 'danger', 'info'] as const
const BG_BODY = 4.5
const BG_LARGE = 3.0

/**
 * 「必须 PASS」白名单：覆盖**真实会渲染的文字/背景对**。
 * 仅供报告判定的组合（图形色 / 软底 reference / on-strong on gradient）不进此表。
 */
const MUST_PASS = new Set<string>([
  // 正文 × 三表面（bg-color-hover 上只有 text-sub 为真实正文）
  ...['text-main', 'text-sub', 'text-muted'].flatMap((t) =>
    ['bg-color', 'card-bg', 'surface-2'].map((b) => `${t} ↔ ${b}`),
  ),
  'text-sub ↔ bg-color-hover',
  // 语义文字色 × 表面 / 自身浅底
  ...TONES.flatMap((t) => ['bg-color', 'card-bg', 'surface-2', `${t}-light`].map((b) => `${t}-text ↔ ${b}`)),
  /**
   * V1.6 · Stage D · D1 —— 状态卡片上的「文字 × 状态底色」三类组合。
   *
   * 卡片底色统一取 `--badge-{tone}-bg`（= `-light`），压在它上面的文字只有三种：
   * 标题 `text-main`、脚注/元信息 `text-sub`、CTA 与来源链接 `primary-text`。
   * 这三类此前**从未被约束过**：`text-main/-sub × -light` 在 `buildPairs` ⑥ 里算得出
   * 但没进 MUST_PASS（只有失败时才会红），`primary-text × -light` 则连配对都没生成。
   * 不登记就等于这批新 UI 的对比度靠人肉保证 —— 而「人肉保证」正是本仓反复踩过的坑
   * （见批 6a 复盘：小小白名单会让门禁沦为装饰）。故逐条纳入，并由 ⑥ 同步生成配对。
   *
   * ⚠️ `text-muted × {tone}-light` **刻意不登记，且禁止使用**：四个预设实测 4.20–4.56，
   * junior 三个 tone 底全部低于 AA 4.5（比它自己在 `bg-color-hover` 上的 4.30 例外下限
   * 还低）。卡片上有状态底色时，脚注一律用 `text-sub`（6.91–7.65）。
   * 详见 `src/core/styles/_card-status.scss` 的「禁止 text-muted」注释。
   */
  ...['text-main', 'text-sub', 'primary-text'].flatMap((t) => TONES.map((g) => `${t} ↔ ${g}-light`)),
  // 实心块：text-on-primary 压在语义 -text 底 / neutral(text-sub) 底
  ...TONES.map((t) => `text-on-primary ↔ ${t}-text`),
  'text-on-primary ↔ text-sub',
  // StatCard primary 数值
  'primary-text ↔ card-bg',
  /**
   * `--bg-color` 作「凹槽底」：导入向导第 1 步的帮助面板（V1.6 · B4）用它当折叠行底色，
   * 行标题是 `--primary-text`。原来是"能过但没登记"，登记进来才算门禁覆盖 ——
   * 没登记的失败项会被判"未分类"直接红，这是本项目比"小小白名单"更强的地方。
   */
  'primary-text ↔ bg-color',
])

/** 例外表：真实但接受低于 AA；`floor` = 「不得变差」下限（复算不得低于此值）。 */
interface Exception { key: string; group: string; floor: number; reason: string }
const EXCEPTIONS: Exception[] = [
  {
    key: 'text-muted ↔ bg-color-hover',
    group: 'primary.light',
    floor: 4.06,
    reason: 'bg-color-hover 作底的次要文字（版本徽章 / 内嵌块）最弱组合；非正文、层级弱化有意为之。6a 已把 text-muted 由 #877665 加深到 #807060（比值回升）。',
  },
  { key: 'text-muted ↔ bg-color-hover', group: 'junior.light', floor: 4.30, reason: '同上（junior.light）' },
  { key: 'text-muted ↔ bg-color-hover', group: 'senior.light', floor: 4.23, reason: '同上（senior.light）' },
]
const EXCEPTION_KEYS = new Set(EXCEPTIONS.map((e) => e.key))

/**
 * 「不适用」判定：❌ 若命中以下任一条，说明它**不是真实渲染的文字/背景对**，
 * 无需在例外表登记；返回非 null 即视为已分类。
 */
function notApplicable(key: string): string | null {
  const [fg, bg] = key.split(' ↔ ')
  if (/-color$/.test(fg)) return '图形色（-color）不作文字；本批已统一改用 -text'
  if (fg === 'code-color') return '内联代码色，非本「语义色分工」不变量范围'
  if (fg === 'on-strong') return 'on-strong 仅用于品牌渐变 / hero（未压在实心语义底上）'
  if (/-color$/.test(bg)) return '实心语义底（-color）上不再有白 / 深字（已改 -text 底 + text-on-primary）'
  if (/-soft$/.test(bg)) return '软底已统一为 --badge-{tone}-bg（= -light），-soft 不再承载 tone 文字'
  if (bg === 'bg-color-hover' && /-text$/.test(fg)) return 'bg-color-hover 上承载 text-main / -sub，无 tone 文字'
  return null
}

function buildPairs(sem: Sem): Pair[] {
  const pairs: Pair[] = []
  const add = (fgName: string, bgName: string, threshold = BG_BODY, label?: string, fgOverride?: string): void => {
    const fgVal = fgOverride ?? sem[fgName]
    const bgVal = surface(sem, bgName)
    if (fgVal === undefined) return
    pairs.push({ key: `${fgName} ↔ ${bgName}`, label: label ?? `${fgName} on ${bgName}`, fg: fgVal, bg: bgVal, threshold })
  }

  // ① 正文 × 表面
  for (const t of ['text-main', 'text-sub', 'text-muted']) {
    for (const b of ['bg-color', 'card-bg', 'surface-2', 'bg-color-hover']) add(t, b)
  }

  // ② tone 前景（-color 图形 / -text 文字）× 表面 + 自身 -light / -soft
  for (const g of TONES) {
    for (const f of [`${g}-color`, `${g}-text`]) {
      for (const b of ['bg-color', 'card-bg', 'surface-2', 'bg-color-hover', `${g}-light`, `${g}-soft`]) add(f, b)
    }
  }

  // ③ on-strong / text-on-primary × 语义实心底（-color / -text）/ text-sub
  for (const g of TONES) {
    for (const f of ['on-strong', 'text-on-primary']) {
      for (const b of [`${g}-color`, `${g}-text`]) add(f, b)
    }
  }
  for (const f of ['on-strong', 'text-on-primary']) add(f, 'text-sub')

  // ④ primary 专项 × bg / card（text 按大号 3.0）
  for (const f of ['primary-color', 'primary-text']) {
    for (const b of ['bg-color', 'card-bg']) {
      add(f, b, f === 'primary-text' && b === 'card-bg' ? BG_LARGE : BG_BODY)
    }
  }

  // ⑤ code-color × card / bg
  for (const b of ['card-bg', 'bg-color']) add('code-color', b)

  // ⑥ text-main / -sub / primary-text × tone-light（D1 状态卡片：标题 / 脚注 / CTA）
  //    `primary-text` 这一档是随 MUST_PASS 同批新增的：缺了它，MUST_PASS 里那几条
  //    就成了"永远命中不到配对"的死键（本脚本没有死键守卫，静默即可通过）。
  for (const g of TONES) {
    for (const f of ['text-main', 'text-sub', 'primary-text']) add(f, `${g}-light`)
  }

  return pairs
}

/* ---------------------- 计算 ---------------------- */

interface Row extends Pair { group: string; value: number | null; pass: boolean; must: boolean; class: string }

const GROUPS: Array<[ThemePreset, ThemeMode, string]> = PRESETS.flatMap((p) =>
  MODES.map((m) => [p, m, `${p}.${m}`] as [ThemePreset, ThemeMode, string]),
)

const allRows: Row[] = []
for (const [preset, mode, label] of GROUPS) {
  const sem = buildSemantic(preset, mode)
  for (const p of buildPairs(sem)) {
    const value = contrast(p.fg, p.bg)
    const pass = value !== null && value >= p.threshold
    const must = MUST_PASS.has(p.key)
    let cls = '✅'
    if (!pass) {
      if (EXCEPTION_KEYS.has(p.key)) cls = '例外'
      else if (notApplicable(p.key)) cls = '不适用'
      else cls = '未分类'
    }
    allRows.push({ ...p, group: label, value, pass, must, class: cls })
  }
}

/* ---------------------- §--on-strong 消费者实测 ---------------------- */

/**
 * `--on-strong` 的保留消费者（品牌渐变 / hero）。
 *
 * ⚠️ **这里刻意不带行号**：上一版写死 `Home.vue:823` 等具体行号，而该文件早就没那么长了
 * （QA 查到 `.action-pill.primary` 实际在 416/567 一带）—— 行号必然漂移，写进去就是把陈旧埋下一次。
 * 改用「文件 + 选择器/用途名」做标识，既能定位也不会随时间失真。
 */
interface OnStrongSpot { file: string; name: string; gradient: 'gradient-primary' | 'gradient-warm'; changed: boolean }
const ON_STRONG_SPOTS: OnStrongSpot[] = [
  { file: 'Home.vue', name: '.welcome-hi（欢迎区问候语）', gradient: 'gradient-primary', changed: false },
  { file: 'Home.vue', name: '.streak-pill .streak-text', gradient: 'gradient-primary', changed: false },
  { file: 'Home.vue', name: '.action-pill.primary（快捷入口主按钮）', gradient: 'gradient-primary', changed: false },
  { file: 'Parent.vue', name: '.top-rank:first-child（排行榜第一名）', gradient: 'gradient-warm', changed: false },
  { file: 'VocabDrill.vue', name: '.listen-btn（听写/朗读按钮）', gradient: 'gradient-primary', changed: false },
]

/* ---------------------- 渲染 ---------------------- */

const md: string[] = []
md.push('# 对比度审计（WCAG AA）')
md.push('')
md.push('> 自动生成：`npm run a11y:contrast`（`scripts/a11y/contrast-report.ts`，vite-node，零依赖）')
md.push('> 数据源：`src/core/styles/tokens.ts` 的 `buildSemantic`（6 组 = 3 学段 × 浅/深）')
md.push('> 阈值：正文 **4.5** / 大号 **3.0**')
md.push('')
/**
 * 大号文本判据（WCAG 1.4.3：粗体 ≥14pt ≈ 18.66px 即算大号，阈值 3.0 而非 4.5）。
 *
 * 字号**从 tokens 推导**，不再手写 px：这里曾经写死 20px/700（`--font-2xl`），
 * 而 `PageHeader.vue` 实际用的是 `--font-3xl` + 800 —— 判据与源码漂移了也没人发现。
 * 从 `FONT['3xl']` 取之后，改 token 就是改判据，`--font-3xl` 一旦变更这里立刻跟着变。
 */
const PAGE_HEADER_STEP = '3xl' // PageHeader.vue .page-header__title → var(--font-3xl)
const PAGE_HEADER_WEIGHT = 800 // PageHeader.vue .page-header__title → font-weight: 800（非 token，故字面量）
// 组件内的字面量，不是 token —— 无法推导，只能照抄并注明来源
const STATCARD_VALUE = { px: 26, weight: 800 }

md.push('## 大号文本判据')
md.push('')
md.push('仅两处算大号（粗体且 ≥18.66px，即 WCAG 大号文本 → 阈值 3.0）：')
md.push(
  `- \`PageHeader.vue\` 标题（\`var(--font-${PAGE_HEADER_STEP})\` = ${FONT[PAGE_HEADER_STEP]} + ${PAGE_HEADER_WEIGHT}`
  + `；字号由本脚本从 \`tokens.FONT\` 推导）`
)
md.push(`- \`StatCard.vue\` 数值（${STATCARD_VALUE.px}px + ${STATCARD_VALUE.weight}，组件内字面量，非 token）`)
md.push('')
md.push('其余**全部按正文 4.5**。')
md.push('')
md.push('## 脚本局限（诚实登记）')
md.push('')
md.push('- 本脚本只审 **token 值本身**，**审不到 naive-ui 派生出来的颜色**（如 `type="error"/"warning"` 按钮文字色由 naive 依据 common 变量计算）。')
md.push('- **渐变上的文字**（hero / 品牌渐变白字）按两端点分别计算，见 §--on-strong 消费者实测。')
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
md.push('## §语义色分工（不变量，批 6a-2）')
md.push('')
md.push('- `--{primary,success,warning,danger,info}-color` = **图形色**（边框 / 描边 / 背景 / 渐变 / 图形填充）')
md.push('- `--{primary,…,info}-text` = **文字色**（正文；对自身 `-light` 亦 ≥4.5，6 组全过）')
md.push('- **组件层 `color:` 一律用 `-text`，禁止 `-color`**；由 `npm run check:text-color` 强制。')
md.push('- 软底徽章统一走 `--badge-{tone}-bg`（= `-light`），不再用裸 `rgba({tone}-rgb, α)`。')
md.push('')
md.push('## §MUST_PASS 清单（' + MUST_PASS.size + ' 对 × 6 组）')
md.push('')
md.push('```')
for (const k of [...MUST_PASS].sort()) md.push(k)
md.push('```')
md.push('')
md.push('### §维护须知：登记一个 MUST_PASS 键 = 两步，缺一不可')
md.push('')
md.push('`mustFails` 是 `allRows.filter((r) => r.must && !r.pass)` —— **从不存在的配对里筛不出任何行**。')
md.push('所以「只在 `MUST_PASS` 里写键、却不在 `buildPairs` 里 `add()` 出配对」等于**什么都没校验**，而且**永远绿**。')
md.push('这不是假想：V1.6 · Stage D · D1 登记 `primary-text × {tone}-light` 时就踩了 —— 真值表加了 15 个键，')
md.push('`buildPairs` ⑥ 却只生成 `text-main / text-sub`，其中 5 条登记是假的（后来补了 ⑥ 的 `primary-text` 才生效）。')
md.push('')
md.push('正确姿势（现在有**死键守卫**兜底，逐组判定，缺任何一组都会红）：')
md.push('')
md.push('1. `buildPairs` 里 `add(fg, bg)` 生成配对 —— 注意 `add()` 在 fg/bg 于某预设下取不到值时会**静默 return**，')
md.push('   造成「半死键」（只在前几组有配对）；守卫按组比对，能抓到这种。')
md.push('2. `MUST_PASS` 里加法同样的键字符串，格式 `` `${fg} ↔ ${bg}` ``（分隔符是**全角 `↔` 两侧各一个空格**，照抄）。')
md.push('')
md.push('> 守卫只在 `npm run a11y:contrast` 时生效；`npm run verify` 的门禁链里**不含**该脚本（现状如此）。')
md.push('')
md.push('## §例外表（真实但接受低于 AA；含「不得变差」下限）')
md.push('')
md.push('| 组合 | group | 实测 | 阈值 | 差 | 为什么接受 |')
md.push('|---|---|---|---|---|---|')
for (const ex of EXCEPTIONS) {
  const row = allRows.find((r) => r.key === ex.key && r.group === ex.group)
  const v = row?.value?.toFixed(2) ?? 'n/a'
  const diff = row?.value != null ? (row.value - BG_BODY).toFixed(2) : 'n/a'
  md.push(`| \`${ex.key}\` | ${ex.group} | ${v} | 4.5 | ${diff} | ${ex.reason} |`)
}
md.push('')
md.push('> 「不得变差」断言：上表每行的实测值复算不得低于其 `floor`（' + EXCEPTIONS.map((e) => `${e.group}=${e.floor}`).join(' / ') + '）。')
md.push('')
md.push('## §58 项分类结论（批 6a 报告的「仅报告」失败项）')
md.push('')
md.push('| 模式 | 数量 | 分类 | 依据 |')
md.push('|---|---|---|---|')
md.push('| `{tone}-color` 作前景 × 各表面 / 自身 -light | 40 | **实修** | R1：100 处 `color:` 一律改 `-text`，浅色组（primary.light 2.43–3.30 → ≥4.5） |')
md.push('| `on-strong` / `text-on-primary` × `{tone}-color`（浅组白字） | 2 | **实修** | R2-⑤：5 处实心底 bg 改 `-text` + 字 `text-on-primary` |')
md.push('| `on-strong` / `text-on-primary` × `{tone}-color`（深组白字） | 10 | **实修** | 同上（深组实心底改 `-text`，白字问题消解） |')
md.push('| `on-strong` × `{tone}-text`（深组） | 10 | **不适用** | `on-strong` 仅用于品牌渐变/hero，未压在实心语义底上 |')
md.push('| `on-strong` × `text-sub`（深组） | 3 | **不适用** | 实心 neutral 徽章用 `text-on-primary`（非 on-strong） |')
md.push('| `text-muted` × `bg-color-hover`（浅组 ×3） | 3 | **例外表** | 见 §例外表 |')
md.push('')
md.push('> 合计 40 + 2 + 10 + 10 + 3 + 3 = 68。其中属**原 58 项**者为：`{tone}-color` 前景 40 + 浅组白字 2 + 深组白字 10 + `on-strong`×`text-sub` 3 + `text-muted`×`bg-color-hover` 3 = 58；另 `on-strong × {tone}-text`（深组 10）为**新增报告行**（6a-2 报告中新出现），一并分类，**无未分类项**。')
md.push('')
md.push('## §--on-strong 消费者实测（渐变两端点分别计）')
md.push('')
md.push('**已改（实心 `$primary-color` 底，`on-strong → var(--text-on-primary)`）**：`ChinesePoem.vue:139`、`EnglishVocab.vue:201`、`QuizEngine.vue:755`、`QuizEngine.vue:952`、`VocabDrill.vue:492`。')
md.push('')
md.push('**保留（品牌渐变 / hero，未改）**：')
md.push('')
md.push('| 位置 | 背景 | 浅端对比度（白字） | 深端对比度 | 合规 |')
md.push('|---|---|---|---|---|')
for (const [preset, mode, label] of GROUPS) {
  const sem = buildSemantic(preset, mode)
  for (const spot of ON_STRONG_SPOTS) {
    const ends = gradientEnds(sem[spot.gradient])
    if (ends.length < 2) continue
    const c0 = contrast('#ffffff', ends[0])
    const c1 = contrast('#ffffff', ends[1])
    const worst = Math.min(c0 ?? 99, c1 ?? 99)
    md.push(
      `| ${label} · ${spot.file} · ${spot.name} | ${spot.gradient} | ${c0?.toFixed(2)} | ${c1?.toFixed(2)} | ${worst >= 3.0 ? '✅(≥3.0)' : '⚠️ 浅端 <3.0'} |`,
    )
  }
}
md.push('')
md.push('> 说明：hero / 品牌渐变白字为**品牌视觉**，team-lead 明确「不要动」；此处如实给出实测（浅端 primary.light 最低 1.97），供记录。')
md.push('')

/* ---------------------- 各组全表 ---------------------- */
for (const [preset, mode, label] of GROUPS) {
  md.push(`## ${label}`)
  md.push('')
  md.push('| 前景 | 背景 | 对比度 | 阈值 | 结果 | 分类 |')
  md.push('|---|---|---|---|---|---|')
  for (const r of allRows.filter((x) => x.group === label)) {
    const v = r.value === null ? 'n/a' : r.value.toFixed(2)
    const ok = r.pass ? '✅' : '❌'
    md.push(`| \`${r.fg}\` | \`${r.bg}\` | ${v} | ${r.threshold} | ${ok} | ${r.class} |`)
  }
  md.push('')
}

/* ---------------------- §可见变化登记 ---------------------- */
md.push('## §可见变化登记')
md.push('')
md.push('| group | token | 改前 | 改后 | 实测新比值 | 为什么必须改 | 类别 |')
md.push('|---|---|---|---|---|---|---|')
const CHANGES: string[][] = [
  ['全部 6 组', '--{tone}-text（6a 新增）', '（无）', '手调 AA 值', '见上表', '软底色字 / 实心底 / 自身软底字统一取 AA 值', '(c) 修 bug'],
  ['primary.light', '--text-muted（6a）', '#877665', '#807060', '对 bg 4.53 / card 4.77', '原值对 bg/card 低于 4.5', '(c) 修 bug'],
  ['全部 6 组', '`color:`（100 处）', '$x-color / var(--x-color)', '$x-text / var(--x-text)', '浅组 2.43–3.30 → ≥4.5', '文字色不得用图形色（§语义色分工）', '(b) 本批新授权'],
  ['全部 6 组', '软底徽章 bg（24 处）', 'rgba(var(--{tone}-rgb), .12/.14)', 'var(--badge-{tone}-bg)', '对 -light ≥4.51', '统一软底实现（= -light），达 AA', '(b) 本批新授权'],
  ['全部 6 组', '5 处实心底字', '$on-strong', 'var(--text-on-primary)', '5.12–9.51', '深色组白字对主色底不足（1.97–2.99）', '(c) 修 bug'],
]
for (const c of CHANGES) md.push('| ' + c.join(' | ') + ' |')
md.push('')
md.push('类别：(a) 用户已授权 / (b) 本批新授权 / (c) 修 bug')
md.push('')

const outPath = resolve(process.cwd(), 'docs/design-system/a11y.md')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, md.join('\n'), 'utf8')

/* ---------------------- 门禁 ---------------------- */

/**
 * **死键守卫**：`MUST_PASS` 里登记了、但 `buildPairs` 从未生成的键 = 静默失效。
 *
 * 为什么必须守：`mustFails` 是 `allRows.filter((r) => r.must && !r.pass)` —— 从不存在的
 * 配对里筛不出任何行，于是「键写了等于没写」，而且**永远绿**。这不是假想：
 * V1.6 · D1 登记 `primary-text × {tone}-light` 时，真值表加了键、`buildPairs` ⑥ 却只生成
 * `text-main / text-sub`，那 14 条登记一条都没被校验（是补了 ⑥ 之后才变成真校验的）。
 *
 * 逐组判定（不是「全局命中即算活」）：`add()` 在某个 token 于某预设下取不到值时会静默
 * `return`，配对就只在部分组里生成 —— 这种「半死键」同样是漏检，一并红。
 *
 * ⚠️ 本守卫只在 `npm run a11y:contrast` 时生效，`npm run verify` 不含该脚本（现状）。
 */
const mustKeysByGroup = new Map<string, Set<string>>()
for (const r of allRows) {
  const seen = mustKeysByGroup.get(r.key) ?? new Set<string>()
  seen.add(r.group)
  mustKeysByGroup.set(r.key, seen)
}
const deadKeys: string[] = []
for (const key of [...MUST_PASS].sort()) {
  const seen = mustKeysByGroup.get(key)
  const missing = GROUPS.filter(([, , label]) => !seen?.has(label)).map(([, , label]) => label)
  if (missing.length > 0) deadKeys.push(`${key} 缺配对：${missing.join(', ')}`)
}

const mustFails = allRows.filter((r) => r.must && !r.pass)
const exceptionFails: string[] = []
for (const ex of EXCEPTIONS) {
  const row = allRows.find((r) => r.key === ex.key && r.group === ex.group)
  if (!row || row.value === null) exceptionFails.push(`[${ex.group}] ${ex.key} 无法复算`)
  else if (row.value + 0.005 < ex.floor) {
    exceptionFails.push(`[${ex.group}] ${ex.key} = ${row.value.toFixed(2)} < 下限 ${ex.floor}（变差！）`)
  }
}
const unclassified = allRows.filter((r) => !r.pass && r.class === '未分类')
const totalFails = allRows.filter((r) => !r.pass).length

console.log(`[a11y:contrast] 报告已写入 ${outPath}`)
console.log(`[a11y:contrast] 配对总数 ${allRows.length}；非通过 ${totalFails}（例外 ${EXCEPTIONS.length}；其余均已判不适用）`)
console.log(`[a11y:contrast] MUST_PASS 失败 ${mustFails.length}；例外「不得变差」失败 ${exceptionFails.length}；未分类失败 ${unclassified.length}；死键 ${deadKeys.length}`)

let bad = false
if (deadKeys.length > 0) {
  bad = true
  console.error('[a11y:contrast] ✗ MUST_PASS 存在死键（登记了但配对从未生成 → 该登记静默失效）：')
  for (const s of deadKeys) console.error(`  - ${s}`)
  console.error('  修法：在 buildPairs 里 add(fg, bg) 生成配对（键格式 `${fg} ↔ ${bg}`，全角 ↔ 两侧带空格）')
}
if (mustFails.length > 0) {
  bad = true
  console.error('[a11y:contrast] ✗ MUST_PASS 出现不达标：')
  for (const r of mustFails) console.error(`  - [${r.group}] ${r.label} = ${r.value?.toFixed(2)} (< ${r.threshold})`)
}
if (exceptionFails.length > 0) {
  bad = true
  console.error('[a11y:contrast] ✗ 例外表「不得变差」断言失败：')
  for (const s of exceptionFails) console.error(`  - ${s}`)
}
if (unclassified.length > 0) {
  bad = true
  console.error('[a11y:contrast] ✗ 存在未分类的失败项（须登记例外或判定不适用）：')
  for (const r of unclassified) console.error(`  - [${r.group}] ${r.key} = ${r.value?.toFixed(2)}`)
}
if (bad) process.exit(1)
console.log('[a11y:contrast] ✓ MUST_PASS 全达标 + 例外表未变差 + 无未分类失败项')
