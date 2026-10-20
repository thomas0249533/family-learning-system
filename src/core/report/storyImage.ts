/**
 * 成就故事卡图片（V1.4 · B6）
 *
 * 一张竖版卡片（1000 × 1400，约 5:7，微信/相册里都不会被裁），
 * 内容是 `achievementStory.storyOf()` 算好的 `AchievementStory` —— **这里只负责画**。
 * 分工与 `exportImages` 完全一致：能测的文案逻辑在 core 模块，本文件只剩 canvas API。
 *
 * ## 为什么不用截图 / html2canvas
 * 同 `exportImages`：Tauri 下拿不到页面位图；且故事卡的版式是**印刷品版式**
 * （固定尺寸、固定留白、不跟随主题），用 DOM 复现一次反而要维护两套 CSS。
 *
 * ## 用字面色值，**不读 CSS 变量**
 * 与 `print.scss` 同一条理由：暗色主题下 `var(--text-main)` 是近白色，
 * 画到白底卡片上就是白字白底。图片一旦生成就脱离主题，必须自带固定配色。
 * 层级仍然不靠颜色（AC-P2-10）：星标数量 + 层级文字。
 */
import type { AchievementStory } from '@core/motivation/achievementStory'
import { storyFileName } from '@core/motivation/achievementStory'
import {
  CANVAS_FONT,
  canvasToPng,
  downloadBlob,
  roundRect,
  wrapText,
} from './canvasKit'

const CARD_W = 1000
const CARD_H = 1400
const PAD = 72

const C = {
  ink: '#1f2933',
  inkSoft: '#52606d',
  inkMuted: '#7b8794',
  line: '#d9e2ec',
  lineStrong: '#9aa5b1',
  paper: '#ffffff',
  tint: '#f5f7fa',
  accent: '#2d6a4f',
  accentSoft: '#e6f2ec',
  stamp: '#8a5a00',
  stampSoft: '#fdf1dc',
} as const

/**
 * 画一张故事卡。
 *
 * 版式自上而下：页眉（档案名 / 生成日期）→ 徽章（图标 + 标题 + 层级）→
 * 解锁（日期 + 第 N 次印记）→ 当时的证据 → 现在的记录 → 页脚。
 *
 * 每一段都是"**有数据才画**"：旧记录没有 evidence 就没有证据段，
 * 拿不到关联记录就没有记录段 —— 版式不会因此错位（所有 y 都是累加的）。
 */
export function drawStoryCard(story: AchievementStory): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas 2D，无法生成故事卡')

  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  const innerW = CARD_W - PAD * 2
  let y = PAD

  // ---------- 页眉：档案名（左）+ 生成日期（右） ----------
  ctx.fillStyle = C.inkMuted
  ctx.font = `24px ${CANVAS_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(story.profileName, PAD, y + 20)
  ctx.textAlign = 'right'
  ctx.fillText(story.today, CARD_W - PAD, y + 20)
  ctx.textAlign = 'left'
  y += 48

  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(CARD_W - PAD, y)
  ctx.stroke()
  y += 56

  // ---------- 徽章：图标 + 标题 + 层级 ----------
  ctx.font = `96px ${CANVAS_FONT}`
  ctx.fillStyle = C.ink
  ctx.fillText(story.icon, PAD, y + 84)

  const titleLeft = PAD + 132
  const titleW = innerW - 132
  ctx.font = `bold 52px ${CANVAS_FONT}`
  ctx.fillStyle = C.ink
  const titleLines = wrapText(ctx, story.title, titleW, 2)
  let ty = y + 56
  for (const line of titleLines) {
    ctx.fillText(line, titleLeft, ty)
    ty += 62
  }

  // 层级与小组：文字承担层级编码（星标在标题行尾），颜色不是唯一线索
  ctx.font = `26px ${CANVAS_FONT}`
  ctx.fillStyle = C.inkSoft
  const stars = story.tierLabel === '稀有' ? '★★ ' : story.tierLabel === '进阶' ? '★ ' : ''
  ctx.fillText(`${stars}${story.tierLabel} · ${story.categoryLabel}`, titleLeft, ty + 6)
  y = Math.max(y + 108, ty + 34) + 40

  // ---------- 解锁 ----------
  y = drawSectionLabel(ctx, '解锁', PAD, y)
  ctx.font = `bold 40px ${CANVAS_FONT}`
  ctx.fillStyle = C.ink
  const dateText = story.unlockedAt || '较早'
  ctx.fillText(dateText, PAD, y + 34)

  // 重复印记：方角小标签，安静地待在日期右边（只记录事实，不加分）
  if (story.repeatCount >= 2) {
    const label = `第 ${story.repeatCount} 次达成`
    ctx.font = `24px ${CANVAS_FONT}`
    const lw = ctx.measureText(label).width + 28
    const lx = PAD + ctx.measureText(dateText).width + 40
    roundRect(ctx, lx, y + 2, lw, 40, 8)
    ctx.fillStyle = C.stampSoft
    ctx.fill()
    ctx.strokeStyle = C.stamp
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = C.stamp
    ctx.fillText(label, lx + 14, y + 30)
  }
  y += 80

  // ---------- 当时的证据（旧记录没有就整段不画） ----------
  if (story.evidence !== '') {
    y = drawSectionLabel(ctx, '当时的证据', PAD, y)
    ctx.font = `32px ${CANVAS_FONT}`
    ctx.fillStyle = C.ink
    for (const line of wrapText(ctx, story.evidence, innerW, 3)) {
      ctx.fillText(line, PAD, y + 28)
      y += 44
    }
    y += 40
  }

  // ---------- 现在的记录（口径必须是"现在"，见 achievementStory 文件头） ----------
  if (story.related.length > 0) {
    y = drawSectionLabel(ctx, '现在的学习记录', PAD, y)

    // 一块浅色底衬托，让"这一段的数字会变"在视觉上就与上面两段（固化）区分开
    const blockH = story.related.length * 92 + 28
    roundRect(ctx, PAD, y, innerW, blockH, 12)
    ctx.fillStyle = C.tint
    ctx.fill()
    ctx.strokeStyle = C.line
    ctx.lineWidth = 1
    ctx.stroke()

    let ry = y + 20
    for (const row of story.related) {
      ctx.font = `24px ${CANVAS_FONT}`
      ctx.fillStyle = C.inkMuted
      ctx.fillText(row.label, PAD + 24, ry + 22)

      ctx.font = `30px ${CANVAS_FONT}`
      ctx.fillStyle = C.ink
      const lines = wrapText(ctx, row.value, innerW - 200, 2)
      let vy = ry + 24
      for (const line of lines) {
        ctx.fillText(line, PAD + 152, vy)
        vy += 36
      }
      ry += 92
    }
    y += blockH + 40
  }

  // ---------- 页脚 ----------
  const footTop = CARD_H - PAD - 60
  ctx.strokeStyle = C.lineStrong
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, footTop)
  ctx.lineTo(CARD_W - PAD, footTop)
  ctx.stroke()

  ctx.font = `24px ${CANVAS_FONT}`
  ctx.fillStyle = C.inkMuted
  ctx.fillText('成就只记录自己做过的事，不和别人比。', PAD, footTop + 42)

  ctx.textAlign = 'right'
  ctx.fillStyle = C.accent
  ctx.fillText('家庭学习系统', CARD_W - PAD, footTop + 42)
  ctx.textAlign = 'left'

  return canvas
}

/** 段标题：一条短横线 + 灰色小字，返回下一段的起始 y */
function drawSectionLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
): number {
  ctx.font = `24px ${CANVAS_FONT}`
  ctx.fillStyle = C.inkMuted
  ctx.fillText(label, x, y + 20)
  const w = ctx.measureText(label).width
  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x + w + 16, y + 12)
  ctx.lineTo(x + w + 76, y + 12)
  ctx.stroke()
  return y + 48
}

/**
 * 生成并下载故事卡图片。
 *
 * @returns 实际使用的文件名（UI 提示用）
 * @throws 未解锁（`canSave === false`）或浏览器拿不到位图时抛错 ——
 *   **不能静默返回**：用户点"保存故事卡"后什么都没有发生，比露出一句错误更糟。
 */
export async function exportStoryCard(story: AchievementStory): Promise<string> {
  if (!story.canSave) throw new Error(story.reason || '这枚成就还不能生成故事卡')

  const canvas = drawStoryCard(story)
  const blob = await canvasToPng(canvas)
  if (!blob) throw new Error('生成图片失败（浏览器没有返回图片数据）')

  const filename = storyFileName(story.id)
  downloadBlob(blob, filename)
  return filename
}

/** 仅供调试/预览：把卡片画成 dataURL（不在 UI 里用，避免大字符串进 DOM） */
export function storyCardDataUrl(story: AchievementStory): string {
  return drawStoryCard(story).toDataURL('image/png')
}
