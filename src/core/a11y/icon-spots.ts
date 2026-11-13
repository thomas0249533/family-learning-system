// =====================================================================
// 图标对比度登记表（V4.0 · D6）—— WCAG 1.4.11 非文本对比度 ≥ 3:1
// ---------------------------------------------------------------------
// 为什么需要这张表：
//   `scripts/a11y/contrast-report.ts` 只审**文字**（正文 4.5 / 大号 3.0）。图标不是文字，
//   但 1.4.11 同样管它 —— 而图标是 `currentColor` 染色的，它「落在什么底上」这件事
//   在 token 层完全不可见：`.stat-card__icon` 只写了 `background: var(--badge-primary-bg)`，
//   颜色是继承来的。于是同一份 token 表可以既「全绿」又让某处的箭头、喇叭、关闭 ×
//   低到看不见。D6 就是把「图标 × 彩色面」这一维补进矩阵。
//
// 三种登记原因（**没有第四种**，没登记就等于没人保证）：
//   1. `must`   —— 真实渲染、且图标承载信息或就是控件本身 → 6 组 × 3:1 必过。
//   2. `brand`  —— 品牌渐变 hero 上的白字/白图标。渐变两端跨度大到**不存在**一个前景色
//                  能同时压过两端（白压浅端 1.97、深字压深端 1.70），而渐变已定为
//                  品牌视觉不动。故按「不得变差」的 `floor` 守住，不假装达标。
//   3. 不进表  —— 中性底（card / bg-color / bg-color-hover）上的图标：那一维已由
//                  正文配对（text-main/-sub/-muted ↔ 三种表面）覆盖，且都 ≥4.5，
//                  重复登记只会让表变长、判断变弱。
//
// ⚠️ 这张表有**发现门禁**（`tests/icon-contrast.test.ts`）：扫描所有 `.vue` 里
//    `<IconBase>` 的直接包裹元素，只要该元素的类名下出现了彩色底
//   （`badge-*` / `-light` / `-color` / `gradient*` / `rgba(var(--*-rgb)`），
//   就必须在下面以 `file + cls` 出现过，否则测试红。
//   **新增一个彩色图标 chip = 必须在这里登记一行**，这是 D6 唯一的「必须做」。
// =====================================================================

import { COMPONENT_TOKENS, type ThemeMode } from '../styles/tokens'

export type Sem = Record<string, string>

/**
 * 背景解析器返回**候选底面**（渐变/玻璃底会给两端点，取其中最差的一处判定）。
 *  是必须的：同一个类在浅/深下可能用不同 alpha（如 QuizEngine 的 .explanation
 * 浅色 65% 白、深色 6% 白）——只按一个 alpha 算会产出**伪造的红灯**。
 */
export type BgResolver = (sem: Sem, mode: ThemeMode) => string[]

export interface IconSpot {
  /** 仓库内相对路径，用于「文件不存在 = 陈旧登记」守卫 */
  file: string
  /** 模板里**直接包裹 `<IconBase>`** 的类名（不含 `.`）——发现门禁按它匹配 */
  cls: string
  /** 人读的位置描述（写选择器/用途，不写行号：行号必然漂移） */
  where: string
  fgLabel: string
  fg: (sem: Sem, mode: ThemeMode) => string
  bgLabel: string
  bg: BgResolver
  kind: 'must' | 'brand'
  /** `brand` 专用：「不得变差」下限 */
  floor?: number
  note?: string
}

/* ---------------------- 解析工具 ---------------------- */

/**
 * 组件级别名 → 语义值。`badge-primary-bg` 这类名字**不在** `buildSemantic` 里
 * （它们是 `COMPONENT_TOKENS` 的一层 `var(--x)` 别名），必须先解一层再取色。
 * 之前手写脚本忘了这步，`sem['badge-primary-bg']` 拿到 undefined → 当纯黑算，
 * 于是「text-main 压在 primary-light 上」被算成 1.31:1 —— 一个纯属虚构的红灯。
 */
export function deref(sem: Sem, name: string): string | undefined {
  const direct = sem[name]
  if (direct !== undefined) return direct
  const alias = COMPONENT_TOKENS[name]
  if (alias === undefined) return undefined
  const m = alias.match(/^var\(--([\w-]+)\)$/)
  return m ? sem[m[1]] : alias
}

/** 语义底色 → 可参与对比度计算的字符串（半透明底合成到 card 上）。 */
export function surfaceOf(sem: Sem, name: string): string[] {
  const raw = deref(sem, name)
  if (raw === undefined) return []
  const c = parseRgba(raw)
  if (!c) return []
  if (c.a >= 1) return [raw]
  const card = parseRgba(sem['card-bg']) ?? { r: 255, g: 255, b: 255, a: 1 }
  return [rgbOf(composite(c, card))]
}

/** 品牌渐变的两端点（`gradientEnds` 同款取法：取前两个 hex 停靠点）。 */
export function gradientStops(sem: Sem, name: string): string[] {
  const raw = deref(sem, name) ?? ''
  return (raw.match(/#[0-9a-fA-F]{3,6}/g) ?? []).slice(0, 2)
}

/** 「玻璃底」：半透明白压在渐变两端点上（hero 里所有 rgba(on-strong, α) 徽章）。 */
export function glassStops(sem: Sem, gradient: string, alpha: number): string[] {
  const white = { r: 255, g: 255, b: 255, a: alpha }
  return gradientStops(sem, gradient).map((stop) => rgbOf(composite(white, parseRgba(stop)!)))
}

/* ---------------------- 最小颜色工具（不引第三方） ---------------------- */

export interface Rgba { r: number; g: number; b: number; a: number }

export function parseRgba(input: string): Rgba | null {
  const s = String(input ?? '').trim()
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    if (h.length !== 6) return null
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    }
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(',').map((x) => x.trim())
  const [r, g, b] = parts.slice(0, 3).map((x) => parseFloat(x))
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1
  return { r, g, b, a: Number.isFinite(a) ? a : 1 }
}

export function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  }
}

export function rgbOf(c: Rgba): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`
}

/* ---------------------- 登记表 ---------------------- */

const TONES = ['primary', 'success', 'warning', 'danger', 'info'] as const

/** 语义前景：写 token 名的快捷方式 */
const fgOf = (name: string) => (sem: Sem): string => deref(sem, name) ?? 'rgb(0, 0, 0)'
/** 语义底色：写 token 名的快捷方式 */
const bgOf = (name: string) => (sem: Sem): string[] => surfaceOf(sem, name)

export const ICON_SPOTS: IconSpot[] = [
  /* —— 软色 chip（`--badge-{tone}-bg` = `-light`）—— */
  ...TONES.flatMap((t): IconSpot[] => [
    {
      file: 'src/components/ui/StatCard.vue',
      cls: 'stat-card__icon',
      where: `StatCard 图标 chip（.stat-card--${t}）`,
      fgLabel: 'text-main（继承自卡片）',
      fg: fgOf('text-main'),
      bgLabel: `badge-${t}-bg`,
      bg: bgOf(`badge-${t}-bg`),
      kind: 'must',
      note: 'tone 只染底、不染图标：图标统一 text-main，避免图标再当一次状态信号',
    },
    {
      file: 'src/components/ui/AppBadge.vue',
      cls: 'app-badge__icon',
      where: `AppBadge 图标（tone=${t}）`,
      fgLabel: `${t}-text`,
      fg: fgOf(`${t}-text`),
      bgLabel: `badge-${t}-bg`,
      bg: bgOf(`badge-${t}-bg`),
      kind: 'must',
      note: '徽章底色与字色同源，图标随字色',
    },
  ]),
  {
    file: 'src/components/ui/StatCard.vue',
    cls: 'stat-card__icon',
    where: 'StatCard 图标 chip（默认中性）',
    fgLabel: 'text-main',
    fg: fgOf('text-main'),
    bgLabel: 'badge-neutral-bg',
    bg: bgOf('badge-neutral-bg'),
    kind: 'must',
  },
  {
    file: 'src/components/ui/AppBadge.vue',
    cls: 'app-badge__icon',
    where: 'AppBadge 图标（tone=neutral）',
    fgLabel: 'text-sub',
    fg: fgOf('text-sub'),
    bgLabel: 'badge-neutral-bg',
    bg: bgOf('badge-neutral-bg'),
    kind: 'must',
  },

  /* —— 实心主色面（`-text` 底 + text-on-primary）—— */
  {
    file: 'src/components/AppShell.vue',
    cls: 'sidebar-icon',
    where: '侧栏导航图标（router-link-active 激活态）',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'primary-text',
    bg: bgOf('primary-text'),
    kind: 'must',
  },
  {
    file: 'src/components/AppShell.vue',
    cls: 'sidebar-icon',
    where: '侧栏导航图标（hover 态）',
    fgLabel: 'text-main',
    fg: fgOf('text-main'),
    bgLabel: 'primary-light',
    bg: bgOf('primary-light'),
    kind: 'must',
    note: 'hover 只染浅底、不改字色（字色由 .sidebar-item:hover 给 text-main）',
  },
  {
    file: 'src/views/Settings.vue',
    cls: 'preset-check',
    where: '主题预设卡右上角选中勾',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'primary-text',
    bg: bgOf('primary-text'),
    kind: 'must',
  },
  {
    file: 'src/components/QuestionImage.vue',
    cls: 'qimage-lb__close',
    where: '大图预览关闭按钮（× 是唯一信息载体）',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'primary-text',
    bg: bgOf('primary-text'),
    kind: 'must',
    note: 'D6 修复：原为 `-color` 底，2.85:1',
  },
  {
    file: 'src/modules/chinese/ChinesePoem.vue',
    cls: 'speak-btn',
    where: '古诗朗读按钮（.speaking 播放中）',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'primary-text',
    bg: bgOf('primary-text'),
    kind: 'must',
    note: 'D6 修复：原为 `-color` 底，2.85:1',
  },
  {
    file: 'src/modules/english/EnglishVocab.vue',
    cls: 'speak-btn',
    where: '英语单词朗读按钮（.speaking 播放中）',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'primary-text',
    bg: bgOf('primary-text'),
    kind: 'must',
    note: 'D6 修复：原为 `-color` 底，2.85:1',
  },
  {
    file: 'src/modules/core/VocabDrill.vue',
    cls: 'mode',
    where: '词语背记模式切换（.active 选中态）',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'primary-text',
    bg: bgOf('primary-text'),
    kind: 'must',
    note: 'D6 修复：原为 `-color` 底，2.85:1',
  },

  /* —— 软底 + 语义字（状态反馈块）—— */
  ...TONES.map((t): IconSpot => ({
    file: 'src/views/TodayPlan.vue',
    cls: 'item-index',
    where: `今日任务序号/完成勾（${t}）`,
    fgLabel: `${t}-text`,
    fg: fgOf(`${t}-text`),
    bgLabel: `${t}-light`,
    bg: bgOf(`${t}-light`),
    kind: 'must',
  })),
  {
    file: 'src/modules/core/VocabDrill.vue',
    cls: 'drill-feedback',
    where: '拼读反馈块（.ok 正确）',
    fgLabel: 'success-text',
    fg: fgOf('success-text'),
    bgLabel: 'badge-success-bg',
    bg: bgOf('badge-success-bg'),
    kind: 'must',
  },
  {
    file: 'src/modules/core/VocabDrill.vue',
    cls: 'drill-feedback',
    where: '拼读反馈块（.no 答错）',
    fgLabel: 'danger-text',
    fg: fgOf('danger-text'),
    bgLabel: 'badge-danger-bg',
    bg: bgOf('badge-danger-bg'),
    kind: 'must',
  },
  {
    file: 'src/views/learn/UnitList.vue',
    cls: 'unit-card-source',
    where: '单元卡「来源包」徽标',
    fgLabel: 'primary-text',
    fg: fgOf('primary-text'),
    bgLabel: 'badge-primary-bg',
    bg: bgOf('badge-primary-bg'),
    kind: 'must',
  },
  {
    file: 'src/views/learn/UnitList.vue',
    cls: 'unit-card-suggest',
    where: '单元卡「建议优先」角标',
    fgLabel: 'warning-text',
    fg: fgOf('warning-text'),
    bgLabel: 'badge-warning-bg',
    bg: bgOf('badge-warning-bg'),
    kind: 'must',
  },
  {
    file: 'src/views/learn/ExamPanel.vue',
    cls: 'exam-badge',
    where: '考试类型徽标（target 图标）',
    fgLabel: 'warning-text',
    fg: fgOf('warning-text'),
    bgLabel: 'warning-light',
    bg: bgOf('warning-light'),
    kind: 'must',
  },
  {
    file: 'src/components/AchievementCard.vue',
    cls: 'ach-seal',
    where: '成就卡「已获得」打勾印章',
    fgLabel: 'success-text',
    fg: fgOf('success-text'),
    bgLabel: 'success-light',
    bg: bgOf('success-light'),
    kind: 'must',
  },
  {
    file: 'src/components/AchievementHall.vue',
    cls: 'tile-seal',
    where: '成就墙「已收集」印章',
    fgLabel: 'text-on-primary',
    fg: fgOf('text-on-primary'),
    bgLabel: 'success-text',
    bg: bgOf('success-text'),
    kind: 'must',
    note: 'D6 修复：原为 `$success-color` 底，3.30:1（过 3.0 未过 4.5）',
  },
  {
    file: 'src/components/AutoSnapshotPanel.vue',
    cls: 'is-protected',
    where: '「清空前恢复点」分组标题（shield 图标）',
    fgLabel: 'danger-text',
    fg: fgOf('danger-text'),
    bgLabel: 'card-bg',
    bg: bgOf('card-bg'),
    kind: 'must',
    note: '同类名也用在 .snap-row 上（那里有 danger-light 底），但行内没有图标',
  },
  {
    file: 'src/views/Home.vue',
    cls: 'review-icon',
    where: '首页「今日待复习」图标（无待复习态）',
    fgLabel: 'text-main',
    fg: fgOf('text-main'),
    bgLabel: 'bg-color-hover',
    bg: bgOf('bg-color-hover'),
    kind: 'must',
  },
  {
    file: 'src/views/Home.vue',
    cls: 'review-icon',
    where: '首页「今日待复习」图标（有待复习：warning 15% 软底）',
    fgLabel: 'text-main',
    fg: fgOf('text-main'),
    bgLabel: 'rgba(warning-rgb, 0.15) over card',
    bg: (sem) => {
      const base = parseRgba(deref(sem, 'card-bg') ?? 'rgb(255, 255, 255)')!
      const soft = parseRgba(`rgba(${deref(sem, 'warning-rgb')}, 0.15)`)
      return soft ? [rgbOf(composite(soft, base))] : []
    },
    kind: 'must',
    note: '未走 `-soft`（= 10%）：这处从 6a 起就是 15%，底色不承载 tone 文字，故保留',
  },

  {
    file: 'src/modules/core/QuizEngine.vue',
    cls: 'explanation',
    where: '答题解析块（bulb 图标，白色蒙层压在反馈块软底上）',
    fgLabel: 'text-main',
    fg: fgOf('text-main'),
    bgLabel: 'rgba(on-strong, .65 浅 / .06 深) over {success,danger}-light / card',
    bg: (sem, mode) => {
      // 浅色 65% 白、深色 6% 白（深色覆盖在 `body.dark-mode` 块里）。
      // 拿单一 alpha 套两套主题会算出「浅色主题的深字压在近白蒙层上」这种不存在的组合 ——
      // 所以 mode 必须进来。
      const white = { r: 255, g: 255, b: 255, a: mode === 'light' ? 0.65 : 0.06 }
      return ['success-light', 'danger-light', 'card-bg']
        .map((n) => parseRgba(deref(sem, n) ?? ''))
        .filter((c): c is Rgba => c !== null)
        .map((b) => rgbOf(composite(white, b)))
    },
    kind: 'must',
    note: '蒙层把反馈块的软底冲淡，实际对比度远高于 3:1；登记是为了让发现门禁有话可说',
  },

  /* —— 品牌渐变 hero：**不达标但已定档**，用 floor 守「不得变差」—— */  {
    file: 'src/views/Home.vue',
    cls: 'decor-emoji',
    where: '首页欢迎横幅右侧装饰徽章（books，aria-hidden）',
    fgLabel: 'text-main（继承）',
    fg: fgOf('text-main'),
    bgLabel: 'rgba(on-strong, .14) over gradient-primary',
    bg: (sem) => glassStops(sem, 'gradient-primary', 0.14),
    kind: 'brand',
    floor: 1.55,
    note: '装饰件（aria-hidden）；白色玻璃底反而把浅端再抬亮，实测 1.55（primary.dark）',
  },
  {
    file: 'src/views/Home.vue',
    cls: 'streak-flame',
    where: '首页连续天数胶囊的火焰图标',
    fgLabel: 'text-main（继承）',
    fg: fgOf('text-main'),
    bgLabel: 'rgba(on-strong, .18) over gradient-primary',
    bg: (sem) => glassStops(sem, 'gradient-primary', 0.18),
    kind: 'brand',
    floor: 1.51,
    note: '装饰件：含义由同排文字「连续 N 天」承载；白色玻璃底抬亮浅端，实测 1.51（primary.dark）',
  },
  {
    file: 'src/views/Report.vue',
    cls: 'report-hero__grade',
    where: '报告 hero 掌握等级徽标',
    fgLabel: 'on-strong（继承自 .report-hero__score）',
    fg: fgOf('on-strong'),
    bgLabel: 'rgba(on-strong, .18) over gradient-primary',
    bg: (sem) => glassStops(sem, 'gradient-primary', 0.18),
    kind: 'brand',
    floor: 1.70,
    note: '与 hero 白字同一豁免依据（品牌渐变）',
  },
  {
    file: 'src/views/Report.vue',
    cls: 'report-hero__pill',
    where: '报告 hero 四枚统计胶囊',
    fgLabel: 'on-strong',
    fg: fgOf('on-strong'),
    bgLabel: 'rgba(on-strong, .14) over gradient-primary',
    bg: (sem) => glassStops(sem, 'gradient-primary', 0.14),
    kind: 'brand',
    floor: 1.70,
    note: '与 hero 白字同一豁免依据（品牌渐变）',
  },
  {
    file: 'src/modules/core/VocabDrill.vue',
    cls: 'listen-btn',
    where: '听写块的「点击播放 / 再听一遍」（speaker 图标）',
    fgLabel: 'on-strong',
    fg: fgOf('on-strong'),
    bgLabel: 'gradient-primary',
    bg: (sem) => gradientStops(sem, 'gradient-primary'),
    kind: 'brand',
    floor: 1.97,
    note: '品牌渐变实心按钮；图标旁有文字标签，含义不靠图标单独承载',
  },
]

/** 发现门禁的匹配键：`文件 + 类名`（同一类名可有多条登记，去重后比对）。 */
export function spotKeys(): Set<string> {
  return new Set(ICON_SPOTS.map((s) => `${s.file}#${s.cls}`))
}
