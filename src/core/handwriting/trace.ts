/**
 * 描红（`StrokeOrderTrace.vue`）的**纯函数层**：格子几何 + 覆盖度分档 + 提示文案。
 *
 * ## 为什么这些判断要住在 `core` 而不是 SFC 里
 * 本仓 vitest 是 node 环境（无 jsdom、无 canvas），`getImageData` 一类的东西
 * 一行都测不到。但"孩子这一遍描到什么程度、该给他什么话"恰恰是**产品判断**，
 * 比绘制细节更值得钉住 —— 放在 SFC 里等于让它永远是"跑起来看着还行"。
 * 所以这里只留三段纯算术：点在不在格子里、百分比落在哪一档、这一档说什么话。
 *
 * ## 刻意不做的事
 * - **不引入笔顺数据**：逐笔提示需要"第几笔从哪起笔"的矢量数据，本仓题库里没有，
 *   硬编码一套等于给 220 个词各写一份手写体，代价远超收益。这里只做
 *   「田字格 + 覆盖度 + 溢出」三件不需要新数据的事。
 * - **不做判分**：描红是练习不是测验，覆盖度低只提示"再描一点"，
 *   绝不说"错了"。孩子在这个页面上的正反馈比准确率重要。
 */

/**
 * 田字格内框的留白比例（相对边长）。
 *
 * 取 0.026 而不是一个固定的 8px：画布尺寸是 `size` 传入的（320 / 240 / 全屏），
 * 固定像素会让小画布上的内框显得又粗又挤。
 */
export const TRACE_FRAME_RATIO = 0.026

/** 内框留白（像素）；非法 size 返回 0，保证不产生 NaN 坐标 */
export function traceFrameInset(size: number): number {
  const s = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0
  return s * TRACE_FRAME_RATIO
}

/**
 * 这个点是不是**写出了田字格**（落在内框之外）。
 *
 * 判据用"内框"而不是整个画布：画布本身比田字格大一圈，笔尖拖到画布边缘时
 * 线上其实已经出格了，按画布判会漏报 —— 而这正是"写到一半横画拖太长"的形态。
 * 少给一个容差（`<` 而非 `<=`）：正好压线的点不算出格。
 */
export function isOutsideFrame(x: number, y: number, size: number): boolean {
  if (![x, y, size].every((v) => typeof v === 'number' && Number.isFinite(v))) return false
  if (size <= 0) return false
  const inset = traceFrameInset(size)
  if (x < inset || y < inset) return true
  return x > size - inset || y > size - inset
}

/** 覆盖度档位（`key` 供样式与埋点用，`label` 给人看） */
export type CoverageTierKey = 'empty' | 'light' | 'half' | 'good' | 'full'

export interface CoverageTier {
  key: CoverageTierKey
  /** 徽标上的文案（含百分号），`empty` 时为空串（不显示徽标） */
  label: string
  /** 一句可执行的建议，**只说下一步做什么，不说"错了"** */
  hint: string
}

/**
 * 覆盖度分档。
 *
 * 分界点的依据是"孩子看到这句话后能做什么"，不是统计学的分位数：
 * - `< 20%`：笔都还没走完一圈，说"注意收笔"毫无意义，只能让他再描一遍；
 * - `20–49%`：有轮廓了，缺的是沿虚线走完（最常见的形态：只描了上半部分）；
 * - `50–79%`：大部分在线上，剩下的是起收笔的收放；
 * - `>= 80%`：已经描满，给肯定，别再提要求（再提就是打击）。
 *
 * `NaN` / 负数 / 非数字一律当 0：徽标上出现 `NaN%` 比不显示更糟。
 */
export function coverageTier(percent: number): CoverageTier {
  const p = typeof percent === 'number' && Number.isFinite(percent) ? percent : 0
  const clamped = p < 0 ? 0 : p > 100 ? 100 : p
  const rounded = Math.round(clamped)

  if (rounded <= 0) return { key: 'empty', label: '', hint: '' }
  if (rounded < 20) {
    return { key: 'light', label: `${rounded}%`, hint: '把虚线大字整个描一圈，先不管准不准' }
  }
  if (rounded < 50) {
    return { key: 'half', label: `${rounded}%`, hint: '沿着虚线的走向走完，横画和竖画别停太早' }
  }
  if (rounded < 80) {
    return { key: 'good', label: `${rounded}%`, hint: '笔画都在线上了，注意起笔和收笔别拖长' }
  }
  return { key: 'full', label: `${rounded}%`, hint: '这一遍描满了，收笔也干净' }
}

/**
 * 底部那一句提示的最终文案（覆盖度建议 + 溢出提醒）。
 *
 * 两条信息同时成立时**溢出优先**：写出格是当下的动作问题（笔还按在板上，
 * 能马上改），覆盖度是复盘结论（这一遍已经画完了，说了也改不了）。
 * 把能立刻改的那条放前面，孩子才有机会在下一次落笔时用上。
 */
export function traceHintOf(input: { coverage: number; overflow: boolean }): string {
  if (input?.overflow === true) return '有笔画写出了田字格，收在格子里横竖才匀'
  return coverageTier(input?.coverage ?? 0).hint
}
