/**
 * Canvas 绘制小工具（V1.4 · B6 从 `exportImages.ts` 抽出）
 *
 * 打印图（`exportImages`）与故事卡（`storyImage`）是同一种东西的两个尺寸：
 * 都把"一屏 DOM"重新画到 canvas 上、都下载成 PNG。抽出来的理由很实际 ——
 * `wrapText` 里那段"超出行数补省略号"的循环一旦有第二份拷贝，
 * 迟早只有一份被修（中文按字折行 + measureText 的边界问题已经在 B5 踩过一次）。
 *
 * ## 依赖 DOM，因此**不做单测**
 * 能测的逻辑（分页、文件名、故事卡文案）全部下沉到
 * `printLayout.ts` / `imageFileName()` / `achievementStory.ts`，
 * 本文件只剩"调 canvas API"这一件事。
 */

export const CANVAS_FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'

/** 圆角矩形路径（老 WebView 没有 `ctx.roundRect`，四段圆弧拼一个视觉一致的） */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * 按宽度折行，最多 `maxLines` 行，超出的部分在最后一行补省略号。
 *
 * 按**字符**遍历而不是按词：中文没有空格，按词折行等于不折行。
 * 代价是英文会在单词中间断开 —— 成就标题里出现英文短词（`KP` / `Level`）的概率
 * 远低于中文长句的概率，这个取舍是明确的。
 *
 * 调用前必须先设好 `ctx.font`：`measureText` 用的是**当前字体**，
 * 字体设晚了宽度就不对（这是本函数唯一的隐式前置条件）。
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (text === '') return []
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const next = line + ch
    if (ctx.measureText(next).width > maxWidth && line !== '') {
      lines.push(line)
      line = ch
      if (lines.length === maxLines) break
    } else {
      line = next
    }
  }
  if (lines.length < maxLines && line !== '') lines.push(line)
  if (lines.length === maxLines) {
    // 还有没画完的内容 → 最后一行加省略号
    const rest = text.slice(lines.join('').length)
    if (rest.length > 0) {
      let last = lines[maxLines - 1]
      while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1)
      }
      lines[maxLines - 1] = `${last}…`
    }
  }
  return lines
}

/** canvas → PNG Blob（`toBlob` 是回调式，包一层 promise；null = 浏览器拿不到位图） */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻 revoke 会让部分浏览器来不及取数据，延后一拍
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 本地日期键 `YYYY-MM-DD`。
 * **不能用 `toISOString()`**（UTC 口径）：东八区晚上 8 点之后会算成"明天"，
 * 打印件与故事卡上的日期就会比孩子实际做的那天晚一天。
 */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}
