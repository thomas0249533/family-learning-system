/**
 * 成就图片导出（V1.4 · B5 / D4）
 *
 * ## 为什么用 Canvas 手绘而不是截图 / html2canvas
 * - 截图要先把 DOM 渲染出来再抓，跨主题、跨窗口尺寸都不稳定，且 Tauri 下拿不到页面位图；
 * - html2canvas 是又一个依赖，还要为它维护一份"能被它正确解析"的 DOM 子集。
 * - 而打印件和图片**共用同一套分页**（`paginateByCategory`），只是渲染目标不同：
 *   一个是浏览器打印，一个是 canvas。所以这里只写"怎么画"，不写"画什么"。
 *
 * ## 与打印件的对应关系
 * - 尺寸 A4 @150dpi（1240×1754），留白 12mm ≈ 71px；
 * - 3 列 × 4 行，一页一个小组；
 * - 层级不靠颜色：★ 数量 + 边框粗细 + 层级文字（AC-P2-10，去色后仍可辨）。
 *
 * ## 这个模块依赖 DOM（canvas / a[download]），因此**不做单测**
 * 能测的部分（分页、文件名规则）全部下沉到 `printLayout.ts` / `imageFileName()`；
 * 画布工具（圆角矩形 / 折行 / 下载）在 `canvasKit.ts`，与故事卡共用（V1.4 · B6）。
 */
import {
  CATEGORY_META,
  type AchievementItem,
} from '@core/motivation/achievementMeta'
import { TIER_META } from '@core/motivation/achievementTaxonomy'
import {
  CANVAS_FONT,
  canvasToPng,
  downloadBlob,
  localDateKey,
  roundRect,
  wrapText,
} from './canvasKit'
import { PRINT_PER_PAGE, paginateByCategory, pageLabel } from './printLayout'

/** A4 @150dpi */
const PAGE_W = 1240
const PAGE_H = 1754
const MARGIN = 71
const GAP = 18
const COLS = 3
const ROWS = 4

const C = {
  ink: '#1f2933',
  inkSoft: '#52606d',
  line: '#d9e2ec',
  lineStrong: '#9aa5b1',
  paper: '#ffffff',
  tint: '#f5f7fa',
} as const

const FONT = CANVAS_FONT

/**
 * 图片文件名。
 *
 * 单页 → `achievements-M.png`（PRD 里点名的四个文件名）；一组超过一页时加页序号
 * （`achievements-M-1.png`），否则两张图同名，浏览器会给第二张自动加 `(1)` ——
 * 用户手里就会出现 `achievements-M(1).png` 这种既不在 PRD 也不可预期的名字。
 */
export function imageFileName(category: string, pageIndex: number, pageCount: number): string {
  return pageCount > 1
    ? `achievements-${category}-${pageIndex + 1}.png`
    : `achievements-${category}.png`
}

export interface ExportedImage {
  category: string
  pageIndex: number
  pageCount: number
  filename: string
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  item: AchievementItem,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const borderWidth = item.tier === 'rare' ? 3 : item.tier === 'advanced' ? 2 : 1

  ctx.save()
  roundRect(ctx, x, y, w, h, 8)
  ctx.fillStyle = item.earned ? C.tint : C.paper
  ctx.fill()
  // 边框粗细 = 层级（去色后仍是唯一的层级线索之一）
  ctx.lineWidth = borderWidth
  ctx.strokeStyle = item.tier === 'rare' ? C.ink : C.lineStrong
  if (item.tier === 'hidden') ctx.setLineDash([8, 6])
  ctx.stroke()
  ctx.restore()

  const pad = 14
  let cy = y + pad

  // 图标 + 标题（最多两行）
  ctx.fillStyle = C.ink
  ctx.font = `28px ${FONT}`
  ctx.fillText(item.icon, x + pad, cy + 26)

  ctx.font = `bold 21px ${FONT}`
  const titleLines = wrapText(ctx, item.title, w - pad * 2 - 40, 2)
  let tx = x + pad + 38
  for (const line of titleLines) {
    ctx.fillText(line, tx, cy + 24)
    cy += 26
  }
  tx = x + pad
  cy = Math.max(cy, y + pad + 34)

  // 层级文字 + 星标（颜色的替代编码）
  ctx.font = `15px ${FONT}`
  ctx.fillStyle = C.inkSoft
  const stars = item.stars > 0 ? `${'★'.repeat(item.stars)} ` : ''
  ctx.fillText(`${stars}${TIER_META[item.tier].label}`, tx, cy + 18)
  cy += 26

  // 描述（两行）
  ctx.font = `15px ${FONT}`
  const descLines = wrapText(ctx, item.desc, w - pad * 2, 2)
  for (const line of descLines) {
    ctx.fillText(line, tx, cy + 14)
    cy += 21
  }

  // 底部：状态 + 日期 + 重复印记
  ctx.font = `15px ${FONT}`
  const footY = y + h - pad
  ctx.fillStyle = C.ink
  ctx.fillText(item.earned ? '已获得' : '未获得', tx, footY)
  const stateW = ctx.measureText(item.earned ? '已获得' : '未获得').width
  ctx.fillStyle = C.inkSoft
  if (item.earned) {
    ctx.fillText(item.unlockedAt || '较早', tx + stateW + 12, footY)
  }
  if (item.earned && item.repeatCount >= 2) {
    const label = `第 ${item.repeatCount} 次`
    ctx.font = `14px ${FONT}`
    const lw = ctx.measureText(label).width + 16
    roundRect(ctx, x + w - pad - lw, footY - 16, lw, 22, 5)
    ctx.strokeStyle = C.lineStrong
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillText(label, x + w - pad - lw + 8, footY)
  }
}

function drawPage(
  page: ReturnType<typeof paginateByCategory>[number],
  index: number,
  total: number,
  profileName: string,
  exportDate: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas 2D，无法导出图片')

  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  // ---- 页眉 ----
  ctx.fillStyle = C.inkSoft
  ctx.font = `19px ${FONT}`
  ctx.fillText(profileName, MARGIN, MARGIN + 8)

  ctx.fillStyle = C.ink
  ctx.font = `bold 40px ${FONT}`
  const groupName = `${CATEGORY_META[page.category].label}${page.continued ? '（续）' : ''}`
  ctx.fillText(groupName, MARGIN, MARGIN + 62)

  ctx.fillStyle = C.inkSoft
  ctx.font = `19px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(`已获得 ${page.groupEarned} / ${page.groupTotal}`, PAGE_W - MARGIN, MARGIN + 62)
  ctx.textAlign = 'left'

  const headBottom = MARGIN + 86
  ctx.strokeStyle = C.lineStrong
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGIN, headBottom)
  ctx.lineTo(PAGE_W - MARGIN, headBottom)
  ctx.stroke()

  // ---- 卡片网格 ----
  const gridTop = headBottom + 32
  const footTop = PAGE_H - MARGIN - 46
  const cardW = (PAGE_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS
  const cardH = Math.min((footTop - gridTop - GAP * (ROWS - 1)) / ROWS, 250)

  page.items.forEach((item, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    drawCard(ctx, item, MARGIN + col * (cardW + GAP), gridTop + row * (cardH + GAP), cardW, cardH)
  })

  // ---- 页脚 ----
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, footTop + 16)
  ctx.lineTo(PAGE_W - MARGIN, footTop + 16)
  ctx.stroke()

  ctx.fillStyle = C.inkSoft
  ctx.font = `17px ${FONT}`
  ctx.fillText(`导出于 ${exportDate}`, MARGIN, footTop + 42)
  ctx.textAlign = 'right'
  ctx.fillText(pageLabel(index, total), PAGE_W - MARGIN, footTop + 42)
  ctx.textAlign = 'left'

  return canvas
}

/**
 * 导出四张（或更多，若某组超容量）PNG。
 *
 * @returns 实际导出的文件清单（UI 据此提示"已导出 4 张"）
 */
export async function exportAchievementImages(
  items: AchievementItem[],
  profileName: string,
): Promise<ExportedImage[]> {
  const pages = paginateByCategory(items, PRINT_PER_PAGE)
  if (pages.length === 0) return []

  const exportDate = localDateKey()

  const perCategory = new Map<string, number>()
  for (const p of pages) perCategory.set(p.category, (perCategory.get(p.category) ?? 0) + 1)

  const out: ExportedImage[] = []
  const seen = new Map<string, number>()
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]
    const pageCount = perCategory.get(page.category) ?? 1
    const idxInCategory = seen.get(page.category) ?? 0
    seen.set(page.category, idxInCategory + 1)

    const canvas = drawPage(page, i, pages.length, profileName, exportDate)
    const blob = await canvasToPng(canvas)
    if (!blob) continue

    const filename = imageFileName(page.category, idxInCategory, pageCount)
    downloadBlob(blob, filename)
    out.push({ category: page.category, pageIndex: idxInCategory, pageCount, filename })
  }
  return out
}
