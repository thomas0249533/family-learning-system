import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { palette } from '@core/styles/palette'

/**
 * 把 DOM 元素渲染成 PDF（A4 尺寸，多页自动分页）
 */
export async function exportReportAsPDF(
  element: HTMLElement,
  filename: string
): Promise<void> {
  // 1. 截图
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: palette.light.cardBg,
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
}