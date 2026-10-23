// =====================================================================
// 自定义主题色（V2.1 附加）· 纯函数、零依赖
// ---------------------------------------------------------------------
// 用户要在设置里自选一个强调色（"淡紫色"等），取代写死的预设主色相。
// 约束：不碰 tokens.ts / palette.ts / theme.scss（生成物禁改），只在运行时
// 用这一份派生结果去覆盖 CSS 变量 + naive-ui themeOverrides。
//
// 派生目标（对照 §8.4 不变量 + AA）：
//   · primary        = 用户选的基色（装饰：软底 / 渐变 / 图标底）
//   · primaryText    = AA 安全色（同时作主按钮底色与品牌文字，对比度 ≥ 4.5）
//   · primaryHover/Pressed = 在 primaryText 基础上微调（保证按钮 hover 仍 AA）
//   · primaryLight   = 极浅 tint（软底）
//   · soft / soft-strong = rgba(primaryRgb, α)，α 随明暗
//   · gradientPrimary = 装饰渐变
//   · onPrimary      = primaryText 底上的文字色（浅色白 / 深色近黑）
// =====================================================================

export interface AccentColors {
  primary: string
  primaryHover: string
  primaryPressed: string
  primaryLight: string
  primaryText: string
  primaryRgb: string
  primarySoft: string
  primarySoftStrong: string
  gradientPrimary: string
  onPrimary: string
}

type RGB = [number, number, number]
type Mode = 'light' | 'dark'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function hexToRgb(hex: string): RGB | null {
  const h = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** 把 a 朝 b 方向混合 t（0..1）。 */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

function relativeLuminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: RGB = [255, 255, 255]
// 深色主题的"近黑"背景（与 junior.dark bg #0d1613 同族），用于文字对比基准
const DARK_BG: RGB = [13, 22, 19]

/**
 * 把基色推到「在背景 bg 上对比度 ≥ 4.5（AA 正文）」。
 * 若基色已达标则原样返回；否则朝 black（浅色）/ white（深色）微调。
 */
function aaSafeText(base: RGB, bg: RGB, mode: Mode): RGB {
  if (contrast(base, bg) >= 4.5) return base
  const toward: RGB = mode === 'light' ? [0, 0, 0] : [255, 255, 255]
  let cur = base
  for (let i = 0; i < 32; i++) {
    const cand = mix(cur, toward, 0.06)
    if (contrast(cand, bg) >= 4.5) return cand
    cur = cand
  }
  return cur
}

const SOFT_ALPHA: Record<Mode, { soft: string; strong: string }> = {
  light: { soft: '0.10', strong: '0.18' },
  dark: { soft: '0.14', strong: '0.24' },
}

function rgbTuple([r, g, b]: RGB): string {
  return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`
}

/**
 * 由用户基色派生完整强调色覆盖。
 * @param hex   6 位 hex（含 #）；非法返回 null（调用方据此跳过覆盖）。
 * @param mode  当前明暗，决定软色 alpha 与「朝哪边推 AA」。
 */
export function deriveAccent(hex: string, mode: Mode): AccentColors | null {
  if (!HEX_RE.test(hex)) return null
  const base = hexToRgb(hex)
  if (!base) return null

  const bg = mode === 'light' ? WHITE : DARK_BG
  const onPrimary = mode === 'light' ? '#ffffff' : '#08120e'

  const primaryText = aaSafeText(base, bg, mode)
  const primaryHover = rgbToHex(mix(primaryText, mode === 'light' ? [0, 0, 0] : [255, 255, 255], 0.1))
  const primaryPressed = rgbToHex(mix(primaryText, mode === 'light' ? [0, 0, 0] : [255, 255, 255], 0.2))
  const primaryLight = rgbToHex(mix(base, mode === 'light' ? WHITE : DARK_BG, mode === 'light' ? 0.86 : 0.78))
  const primaryRgb = rgbTuple(base)
  const { soft, strong } = SOFT_ALPHA[mode]
  const primarySoft = `rgba(${primaryRgb}, ${soft})`
  const primarySoftStrong = `rgba(${primaryRgb}, ${strong})`

  const lighten = rgbToHex(mix(base, WHITE, 0.35))
  const darken = rgbToHex(mix(base, [0, 0, 0], 0.12))
  const gradientPrimary =
    mode === 'light'
      ? `linear-gradient(135deg, ${hex} 0%, ${lighten} 100%)`
      : `linear-gradient(135deg, ${darken} 0%, ${hex} 100%)`

  return {
    primary: hex,
    primaryHover,
    primaryPressed,
    primaryLight,
    primaryText: rgbToHex(primaryText),
    primaryRgb,
    primarySoft,
    primarySoftStrong,
    gradientPrimary,
    onPrimary,
  }
}

/** 设置面板里给的「预设强调色」候选（含一个淡紫）。 */
export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: '淡紫', hex: '#b9a3e3' },
  { name: '樱粉', hex: '#f2a9c4' },
  { name: '天蓝', hex: '#6db3e8' },
  { name: '薄荷', hex: '#6fcf97' },
  { name: '暖橙', hex: '#f2760c' },
]
