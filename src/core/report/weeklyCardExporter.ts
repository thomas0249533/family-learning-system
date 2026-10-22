/**
 * E3 · 周报卡片导出 PNG（屏幕摘要截图线）
 * =====================================================================
 * 模式照 `pdfExporter.ts`（本仓 html2canvas 的唯一使用先例）：
 * `nextFrame` 等一帧、导出前临时摘 body 的 `dark-mode` 类 + `nextTick`、
 * `scale: 2`、`useCORS`、浅色背景。
 *
 * ## 两条线的分工（写给未来的自己，**别朝错误方向"统一"**）
 *   - **成就线**（`exportImages.ts` / `storyImage.ts`）是**印刷品**：
 *     固定尺寸、固定留白、不跟随主题，全部手绘 canvas。它们的文件头写着
 *     "为什么不用 html2canvas"（Tauri 下拿不到页面位图；印刷版式用 DOM
 *     复现反而要维护两套 CSS，且字面色值不随主题漂移）。
 *   - **周报线**（本文件）是**屏幕摘要**：家长要的就是"屏幕上这张卡"，
 *     跟随主题 token、行数封顶、随手截来发给家人。
 *   两条线服务不同产物（一件要打印、一张要发微信），**不要合并**。
 *
 * ## 与 pdfExporter 的两个差异（都是用户的硬性要求）
 *   1. **只截摘要卡片 DOM**（调用方传卡片元素），不截整个 parent-page ——
 *      整页截图随数据增长无上界，正是 OOM 预防要堵的那条路；
 *   2. **行数超上限拒绝生成**（`assertWithinRowLimits`）—— 照
 *      `storyImage.ts:221-223` 的"不能静默"纪律：宁可回一句明确的错，
 *      也不要产出一张没人敢发的巨图。
 *
 * ## 全屏 loading 遮罩为什么不在本文件里
 * 遮罩是 naive-ui 组件（`n-spin`），core 层不能命令式创建 Vue 组件；
 * 且它必须包住"点导出 → 截图 → 浏览器下载弹窗"整个**用户操作周期**
 * （`finally` 收起），那本来就是视图层的状态。所以由调用方
 * （Parent.vue 的 `exporting` ref + `v-if` 遮罩）持有，本文件只管截图。
 */

import html2canvas from 'html2canvas'
import { nextTick } from 'vue'
import { palette } from '@core/styles/palette'
import { useThemeStore } from '@core/stores/theme'
import { canvasToPng, downloadBlob, localDateKey } from './canvasKit'

/** 等待下一帧（保证 body 上的主题状态改动已被浏览器应用再做截图）。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * 卡片行数上限（DOM 侧防线）。
 *
 * 与 `weeklyCard.ts` 的装配封顶是**同一组数字**：装配时已 slice 截断，
 * 正常路径永远到不了这里；这道闸防的是"将来有人改了模板 / 拆了 slice"——
 * 行数悄悄涨回去，而截图要等到 `html2canvas` OOM 才发现就太晚了。
 */
const ROW_LIMITS: ReadonlyArray<{ selector: string; max: number; what: string }> = [
  { selector: '.weekly-top-item', max: 5, what: '高频错题' },
  { selector: '.weekly-subject-item', max: 4, what: '学科行' },
]

/** 行数超上限 → 抛错（不能静默：调用方会把它变成一句 message.error）。 */
function assertWithinRowLimits(root: HTMLElement): void {
  for (const limit of ROW_LIMITS) {
    const n = root.querySelectorAll(limit.selector).length
    if (n > limit.max) {
      throw new Error(
        `周报卡片行数超上限（${limit.what} ${n} 行，上限 ${limit.max} 行），已拒绝生成图片`,
      )
    }
  }
}

/**
 * 把周报卡片 DOM 导出为 PNG 并触发下载。
 *
 * 固定浅色输出（B3）：导出前后临时移除 body 的 dark-mode，截图后恢复；
 * 背景色取**当前激活 preset 的浅色** cardBg（与孩子主题一致）。
 *
 * @param element 卡片根元素（`.weekly-card`）—— **只截它**，不截整个页面
 * @returns 实际使用的文件名（UI 提示用）
 * @throws 行数超上限 / 浏览器拿不到位图时抛错 —— **不能静默返回**：
 *   用户点"导出图片"后什么都没有发生，比露出一句错误更糟
 */
export async function exportWeeklyCardPng(element: HTMLElement): Promise<string> {
  // 第一道闸：行数超上限 → 明确报错（此时还没动主题，无需恢复）
  assertWithinRowLimits(element)

  const themeStore = useThemeStore()
  const lightColors = palette.presets[themeStore.preset].light

  const body = document.body
  const wasDark = body.classList.contains('dark-mode')

  // 临时切浅色：去掉 dark-mode（:root 默认即初中浅，preset 属性仍生效）
  if (wasDark) body.classList.remove('dark-mode')

  try {
    // 切 style 后等一帧，确保浏览器重算样式，html2canvas 取到浅色
    await nextTick()
    await nextFrame()

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: lightColors.cardBg,
      logging: false,
    })

    const blob = await canvasToPng(canvas)
    if (!blob) throw new Error('生成图片失败（浏览器没有返回图片数据）')

    // 文件名带**本地**日期（localDateKey 内部禁 toISOString，见 canvasKit）
    const filename = `weekly-card-${localDateKey()}.png`
    downloadBlob(blob, filename)
    return filename
  } finally {
    // 恢复原主题
    if (wasDark) body.classList.add('dark-mode')
  }
}
