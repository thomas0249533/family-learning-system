/**
 * 语文阅读理解「划线辅助」的**纯函数层**（V1.6 · Stage D · D4）
 * ---------------------------------------------------------------------------
 * ## 为什么坐标要归一化到 0..1
 * 画笔层是一个覆盖正文的 `<svg viewBox="0 0 1 1">`。归一化坐标的含义是
 * **「这个点在正文盒子里的相对位置」**，于是：
 *   - 窗口 resize / 侧栏折叠 / 字号调整 → 路径不用重算，只要盒子跟着变，笔画自己贴合；
 *   - 存 sessionStorage 时与设备像素比、屏幕宽度无关，同一份痕迹在手机上打开也不会跑位；
 *   - 单测可以在 node 下跑（纯算术，不需要 DOM）。
 *
 * 归一化的代价是**各向异性**：`viewBox` 是 0..1 正方形被 `preserveAspectRatio="none"`
 * 拉伸成矩形，所以 user unit 在 x / y 方向的物理长度不同。两个应对：
 *   1. 渲染必须带 `vector-effect="non-scaling-stroke"`（否则线宽被拉成椭圆）；
 *   2. 橡皮命中半径只能取一个折中值（见 `InkOverlay.vue` 注释），这是刻意的取舍。
 *
 * ## 为什么反序列化必须"零抛异常"
 * 数据来自 sessionStorage —— 可能是上个版本写的、被别的标签页截断的、被用户手改的。
 * 抛异常会让整篇课文白屏（渲染在 `setup` 里）；静默丢弃坏条目最多是"少两笔"。
 * 所以本模块所有入口对脏输入都返回安全值，不抛。
 */

/** 语义色名（全仓唯一的色调词表；**不出现任何 hex**，渲染时映射 `var(--{tone}-color)`） */
export type ToneName = 'primary' | 'warning' | 'danger' | 'success'

/** 一个笔迹点，归一化到画笔层盒子内的 0..1 */
export interface InkPoint {
  x: number
  y: number
}

/** 一条笔画 */
export interface InkStroke {
  color: ToneName
  /** 线宽，单位是**屏幕像素**（配合 `non-scaling-stroke`） */
  width: number
  points: InkPoint[]
}

/** 默认每种笔画的抽稀上限：240 点 ≈ 高速划线 2~3 秒的采样量，视觉已足够平滑 */
export const INK_MAX_POINTS = 240

/** 工具栏色板（顺序即排列顺序：高亮黄 → 批注红 → 重点绿）。3 个够用，再多会让小屏工具栏挤爆 */
export const INK_TONES: readonly ToneName[] = ['warning', 'danger', 'success']

/**
 * 合法色调**全集**（含 `primary`）。
 *
 * 与 `INK_TONES` 分开是刻意的：色板只给 3 个（产品口径），但**合法性校验**要放宽到
 * 全部 4 个语义色 —— 否则以后色板一改，之前存下的 `primary` 笔迹会被判成脏数据
 * 静默丢掉（用户看到的是"我的划线自己消失了"）。
 */
const TONE_NAMES: readonly ToneName[] = ['primary', 'warning', 'danger', 'success']

/** 落 sessionStorage 的键前缀：`fls:ink:<profileId>:<docKey>` */
export const INK_STORAGE_PREFIX = 'fls:ink'

/** 非法/缺失 width 时的兜底值（渲染侧也只接受 0 < width <= 48） */
export const INK_DEFAULT_WIDTH = 3

/** 坐标超过这个范围视为脏数据（序列化会四舍五入到 4 位小数，1 仍在界内） */
const OVERSHOOT_EPSILON = 1e-9

/** 保留 4 位小数：0..1 区间下 4 位 ≈ 千像素宽容器上的 0.1px，肉眼无差 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** 有限数判定（`NaN` / `Infinity` 都不是数，虽然 `typeof` 说它是） */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 夹到 [0,1]；非有限数一律返回 0（**不抛**，也不产生 NaN） */
export function clamp01(value: unknown): number {
  if (!isFiniteNumber(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** 判断一个字符串是不是合法色调 */
export function isToneName(value: unknown): value is ToneName {
  return typeof value === 'string' && (TONE_NAMES as readonly string[]).includes(value)
}

/**
 * 把指针事件的**像素坐标**转成归一化坐标，并 clamp 到 [0,1]。
 *
 * 为什么要 clamp：手指/鼠标拖到卡片外时，`clientX` 会跑出盒子。不 clamp 的话
 * 收笔那一刻的点会落在 1.4 之类的值上 —— 视觉上没差别（被裁掉了），
 * 但下次在更窄的容器里读出来时，这段"越界"会被放大成一条怪异的尾巴。
 *
 * 宽或高为 0（还没布局 / `display:none`）时返回 0：除法会得到 `NaN` 或 `Infinity`，
 * 而 `path` 的 `d` 里一旦混进 `NaN`，整个 `<path>` 会被浏览器**静默丢弃**（整篇笔记消失），
 * 这种"不报错的丢数据"必须在这里就掐掉。
 */
export function toNormalized(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): InkPoint {
  const width = isFiniteNumber(rect?.width) ? rect.width : 0
  const height = isFiniteNumber(rect?.height) ? rect.height : 0
  const left = isFiniteNumber(rect?.left) ? rect.left : 0
  const top = isFiniteNumber(rect?.top) ? rect.top : 0

  const x = width > 0 ? (clientX - left) / width : 0
  const y = height > 0 ? (clientY - top) / height : 0

  return { x: clamp01(x), y: clamp01(y) }
}

/**
 * 抽稀：等距取样，**首尾点必然保留**（否则笔画会缩水、末笔会消失）。
 * 输入已 <= 上限时原样返回副本。
 */
function decimate(points: readonly InkPoint[], maxPoints: number): InkPoint[] {
  const limit = isFiniteNumber(maxPoints) ? Math.floor(maxPoints) : INK_MAX_POINTS
  const safeLimit = limit < 2 ? 2 : limit
  if (points.length <= safeLimit) return points.map((p) => ({ x: p.x, y: p.y }))

  const step = (points.length - 1) / (safeLimit - 1)
  const out: InkPoint[] = []
  for (let i = 0; i < safeLimit; i++) {
    const idx = i === safeLimit - 1 ? points.length - 1 : Math.round(i * step)
    const p = points[idx]
    const prev = out[out.length - 1]
    // 等距取整可能取到同一点（step < 1 时），连续重复点没有任何信息，丢掉
    if (prev && prev.x === p.x && prev.y === p.y) continue
    out.push({ x: p.x, y: p.y })
  }
  return out
}

/**
 * 生成 SVG `path` 的 `d` 属性。
 *
 * 折线（`M` + 多个 `L`）而非贝塞尔：点数够密时肉眼无差，而折线的
 * **首尾点与真实手指轨迹严格重合**（曲线拟合会往外鼓），孩子描"关键词下方"时更准。
 *
 * 少于 2 个点返回 `''`（单点画不出线；返回 `M x y` 会产生一个看不见的空 path，
 * 白白多一层 DOM）。坐标先 `round4`，避免 `d` 字符串里塞满 `0.3333333333333333`。
 */
export function toPathD(points: readonly InkPoint[], maxPoints: number = INK_MAX_POINTS): string {
  if (!Array.isArray(points) || points.length < 2) return ''

  const sampled = decimate(points, maxPoints)
  if (sampled.length < 2) return ''

  let d = ''
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i]
    // 脏点（NaN / 越过 0..1）会让整条 path 被浏览器丢弃，这里直接清成 0 保证可见
    const x = round4(clamp01(p?.x))
    const y = round4(clamp01(p?.y))
    d += `${i === 0 ? 'M' : 'L'}${x} ${y}`
    if (i < sampled.length - 1) d += ' '
  }
  return d
}

/** 两点间距离（归一化单位） */
function distance(a: InkPoint, b: InkPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** 点到**线段**的最短距离（归一化单位）；退化线段按点处理 */
function distanceToSegment(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 0) return distance(point, a)

  // 把 point 投影到 ab 上，t 夹到 [0,1] 保证落在线段内而不是无限直线上
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq
  if (t < 0) t = 0
  else if (t > 1) t = 1

  return distance(point, { x: a.x + t * dx, y: a.y + t * dy })
}

/**
 * 橡皮命中：目标点到折线的最近距离 < radius（半径也是归一化单位）。
 *
 * 退化 stroke（0 点 / 1 点 / 脏点）不抛异常：0 点返回 false，1 点按"点"比距离。
 * 橡皮要能擦掉一个小圆点（手指点一下就会产生 1 点草稿），所以 1 点不能直接 false。
 */
export function hitTestStroke(stroke: InkStroke, point: InkPoint, radius: number): boolean {
  const points = stroke?.points
  if (!Array.isArray(points) || points.length === 0) return false
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return false

  const r = isFiniteNumber(radius) && radius > 0 ? radius : 0

  if (points.length === 1) {
    const only = points[0]
    if (!only || !isFiniteNumber(only.x) || !isFiniteNumber(only.y)) return false
    return distance(point, only) <= r
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (!a || !b) continue
    if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) continue
    if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y)) continue
    if (distanceToSegment(point, a, b) <= r) return true
  }
  return false
}

/**
 * 把任意输入整成一条**干净**的 stroke；不合法返回 `null`（调用方丢弃该条）。
 *
 * 判据（与 PRD「脏数据宁可少一笔，也不要白屏」一致）：
 *   - 不是对象 / 缺 `color` / `color` 不在词表 → null
 *   - `width` 非有限数或不在 (0, 48] → null（0 宽的线画不出来；48 是防呆上限）
 *   - `points` 不是数组 / 为空 / 任一点缺坐标或坐标越界 → null（**整条丢**，
 *     不是丢那个点 —— 丢掉中间点会让笔画从"两字之间"连起来，比没画更误导）
 */
function normalizeStroke(raw: unknown): InkStroke | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Partial<InkStroke> & { points?: unknown }

  if (!isToneName(candidate.color)) return null

  const width = candidate.width
  if (!isFiniteNumber(width) || width <= 0 || width > 48) return null

  const rawPoints = candidate.points
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) return null

  const points: InkPoint[] = []
  for (const rawPoint of rawPoints) {
    if (typeof rawPoint !== 'object' || rawPoint === null) return null
    const p = rawPoint as Partial<InkPoint>
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null
    if (p.x < -OVERSHOOT_EPSILON || p.x > 1 + OVERSHOOT_EPSILON) return null
    if (p.y < -OVERSHOOT_EPSILON || p.y > 1 + OVERSHOOT_EPSILON) return null
    points.push({ x: round4(clamp01(p.x)), y: round4(clamp01(p.y)) })
  }

  return { color: candidate.color, width: round4(width), points }
}

/**
 * 序列化：先过一遍 `normalizeStroke`，所以**写进去的一定是干净的**，
 * 读取端即使不做校验也不会读到坏数据（双保险，但读取端仍然校验）。
 */
export function serializeStrokes(strokes: readonly InkStroke[]): string {
  if (!Array.isArray(strokes) || strokes.length === 0) return '[]'
  const clean: InkStroke[] = []
  for (const stroke of strokes) {
    const normalized = normalizeStroke(stroke)
    if (normalized) clean.push(normalized)
  }
  return JSON.stringify(clean)
}

/**
 * 反序列化：**任何输入都不抛异常**。
 * `null` / `''` / `'not json'` / `'{}'` / `'[{坏条目}]'` / 坐标 `NaN`、`Infinity`、越界
 * → 一律返回 `[]` 或"剔除坏条目后的安全数组"。
 */
export function deserializeStrokes(raw: string | null | undefined): InkStroke[] {
  if (typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (trimmed === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // 上个版本写的旧格式 / 被截断 / 用户手改过 —— 都走这里。
    return []
  }

  if (!Array.isArray(parsed)) return []

  const out: InkStroke[] = []
  for (const item of parsed) {
    const normalized = normalizeStroke(item)
    if (normalized) out.push(normalized)
  }
  return out
}

/**
 * 存储键：`fls:ink:<profileId>:<docKey>`。
 *
 * 按档案隔离是硬要求：不隔离的话老二打开同一篇课文会看到老大画的花。
 * 这里**不用** `settingsScope.scopedKey()` —— 那张登记表管的是 Dexie `settings` 表
 * （决定迁移/合并/导出怎么搬），而画笔痕迹刻意只活在 sessionStorage（关掉标签页即弃），
 * 两者生命周期不同，混进登记表反而会让"痕迹"被备份带进别的设备。
 */
export function inkStorageKey(profileId: string, docKey: string): string {
  const pid = typeof profileId === 'string' && profileId.trim() !== '' ? profileId.trim() : 'default'
  const doc = typeof docKey === 'string' && docKey.trim() !== '' ? docKey.trim() : 'unknown'
  return `${INK_STORAGE_PREFIX}:${pid}:${doc}`
}
