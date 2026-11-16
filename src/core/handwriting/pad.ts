/**
 * 手写板（看拼音写词语）的**纯逻辑层** —— 零 DOM，可在 node 下直接单测。
 * ---------------------------------------------------------------------------
 * 为什么单独一个文件：
 * `InkCell.vue` / `HandwritingPad.vue` 里凡是"能算出来的东西"（几格、写完没有、
 * 序列化后的字符串长什么样）都不该埋在组件里 —— vitest 是 node 环境、没有 canvas，
 * 组件只能靠 e2e 验，而 e2e 这一轮不做。把这些判据抽出来，就能在本轮拿到真覆盖。
 *
 * ## 一格 = 一个字符串（team-lead 裁决，不新建序列化格式）
 * 笔迹的唯一合法序列化格式在 `core/reading/ink.ts` 里定死了：
 * 归一化坐标 + 4 位小数 + 脏条目剔除 + 反序列化零抛（45 条单测）。
 * 所以这里**不发明格式**，`serializeCell` 就是 `serializeStrokes` 的薄包装，
 * 一格的空态是 `'[]'`（`serializeStrokes([])` 的返回值），不是 `''`。
 *
 * ## 为什么要 `Array.from`
 * 汉字基本都在 BMP 内，但词里可能出现代理对（如带 emoji 的英文词、异体字扩展区）。
 * `'𠮷'.length === 2` 会多切一格 —— 孩子会看到 3 个格却只写 2 个字。
 */
import { deserializeStrokes, serializeStrokes } from '@core/reading/ink'
import type { InkStroke } from '@core/reading/ink'

/** 一格都没写时的序列化值（`serializeStrokes([])`） */
export const EMPTY_CELL = '[]'

/**
 * 该写几格 = 答案的字数（至少 1）。
 * 空答案也返回 1：宁可给一个空格让孩子试着写，也不要渲染出 0 格 ——
 * 0 格的板子是"没加载出来"的视觉语言，孩子会以为坏了。
 */
export function cellCountOf(answer: string): number {
  const chars = Array.from(String(answer ?? '').trim())
  return Math.max(1, chars.length)
}

/** 把答案切成**逐格的字**（用于 aria-label 与批改页对照） */
export function cellCharsOf(answer: string): string[] {
  const chars = Array.from(String(answer ?? '').trim())
  return chars.length > 0 ? chars : ['']
}

/** 归一化一格：非法输入一律退成空串，不让脏值流进组件 */
export function normalizeCell(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return EMPTY_CELL
  // 过一遍反序列化再序列化：坏条目被剔除，得到的一定是干净串
  const strokes = deserializeStrokes(raw)
  return strokes.length === 0 ? EMPTY_CELL : serializeStrokes(strokes)
}

/** 把 N 格的原始串整成"长度 = 期望格数"的数组（多的截掉，少的补空） */
export function normalizeCells(cells: readonly unknown[] | null | undefined, count: number): string[] {
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(normalizeCell(cells?.[i]))
  return out
}

/** 一格是否为空 */
export function isCellEmpty(raw: string): boolean {
  return deserializeStrokes(raw).length === 0
}

/** 整块板一个字都没写（提交按钮的 disabled 判据） */
export function isEmptyCells(cells: readonly unknown[] | null | undefined): boolean {
  if (!Array.isArray(cells) || cells.length === 0) return true
  return cells.every((c) => isCellEmpty(typeof c === 'string' ? c : ''))
}

/** 统计总笔画数（按需解析；几十个格子的 JSON.parse 在 0.05ms 量级） */
export function countStrokes(cells: readonly unknown[] | null | undefined): number {
  if (!Array.isArray(cells)) return 0
  let n = 0
  for (const c of cells) n += deserializeStrokes(typeof c === 'string' ? c : '').length
  return n
}

/** 统计总采样点数（用于"这题写了 812 个点"这类管理信息，不参与判分） */
export function countPoints(cells: readonly unknown[] | null | undefined): number {
  if (!Array.isArray(cells)) return 0
  let n = 0
  for (const c of cells) {
    for (const s of deserializeStrokes(typeof c === 'string' ? c : '')) n += s.points.length
  }
  return n
}

/** 序列化一格（组件只负责把 strokes 交出来） */
export function serializeCell(strokes: readonly InkStroke[] | null | undefined): string {
  if (!Array.isArray(strokes) || strokes.length === 0) return EMPTY_CELL
  const clean = serializeStrokes(strokes)
  return clean === '[]' ? EMPTY_CELL : clean
}

/** 反序列化一格（读批改页、读断点共用） */
export function deserializeCell(raw: unknown): InkStroke[] {
  return deserializeStrokes(typeof raw === 'string' ? raw : '')
}

/** 每格的读屏标签：「第 2 格，共 4 格，还有 1 笔」 */
export function cellAriaLabel(index: number, total: number, strokes: number): string {
  const i = Math.max(1, Math.floor(index) + 1)
  const t = Math.max(1, Math.floor(total))
  return strokes > 0
    ? `第 ${i} 格，共 ${t} 格，已写 ${strokes} 笔`
    : `第 ${i} 格，共 ${t} 格，还没写`
}

/**
 * 逐格拼音：把「qí guān」按空格切成两段给两个格。
 *
 * 音节数**不等于**字数时（"rén shān rén hǎi" 对 4 个字是相等的，
 * 但 "zhōng guó rén" 对 "中国人" 也相等；而 "nǚ'ér" 这种用隔音符的就对不上）
 * 一律返回全空 —— 宁可格子上没有拼音，也不要把 shān 挂到"人"下面。
 */
export function cellPinyinOf(pinyin: string | undefined | null, count: number): string[] {
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
  const parts = String(pinyin ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === n) return parts
  return new Array(n).fill('')
}

/**
 * 提交给批改页的题干快照。
 *
 * 为什么不用 `correctAnswer` 直接当题面：批改页左边是笔迹、右边是答案，
 * 题面要回答"孩子当时被要求写什么"。看拼音写词语的题面是拼音；
 * 没有拼音（英文词/纯汉字包）时才退回字数提示 —— 也**不要**把答案本身写进题面，
 * 那样家长一眼看到的是重复两遍的同一个词。
 */
export function inkPromptOf(pinyin: string | undefined | null, answer: string): string {
  const py = String(pinyin ?? '').trim()
  const count = Array.from(String(answer ?? '').trim()).length
  if (count === 0) return '手写作答'
  const countHint = `${count} 个字`
  return py ? `看拼音写词语：${py}（${countHint}）` : `手写作答（${countHint}）`
}
