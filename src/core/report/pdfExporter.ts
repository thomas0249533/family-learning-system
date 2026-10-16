import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { nextTick } from 'vue'
import { palette } from '@core/styles/palette'
import { useThemeStore } from '@core/stores/theme'

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
 * 把 DOM 元素渲染成 PDF（A4 尺寸，多页自动分页）。
 *
 * 固定浅色输出（B3）：导出前后临时移除 body 的 dark-mode，截图后恢复；
 * 背景色取**当前激活 preset 的浅色** cardBg（与孩子主题一致）。
 */
export async function exportReportAsPDF(
  element: HTMLElement,
  filename: string
): Promise<void> {
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

    // 1. 截图
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: lightColors.cardBg,
      logging: false,
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.92)

    // 2. A4 尺寸（mm）
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    // 3. 内容按 A4 宽等比缩放
    const imgWidth = pageWidth - 20       // 左右各留 10mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 10                     // 顶部留 10mm

    pdf.addImage(imgData, 'JPEG', 10, position, imgWidth, imgHeight)
    heightLeft -= (pageHeight - 20)

    // 4. 多页
    while (heightLeft > 0) {
      pdf.addPage()
      position = heightLeft - imgHeight + 10
      pdf.addImage(imgData, 'JPEG', 10, position, imgWidth, imgHeight)
      heightLeft -= (pageHeight - 20)
    }

    // 5. 保存
    pdf.save(`${filename}.pdf`)
  } finally {
    // 恢复原主题
    if (wasDark) body.classList.add('dark-mode')
  }
}
