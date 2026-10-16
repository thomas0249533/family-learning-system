import type { Page } from '@playwright/test'

/**
 * 冻结 **SMIL**（SVG 动画），使截图可重现。
 *
 * ⚠️ 关键陷阱（实测得出）：naive-ui 的 loading 图标 `.n-base-loading__icon` 用的是
 * **SMIL**（`<animateTransform>` / `<animate>`），**不是 CSS 动画**。而 Playwright 的
 * `screenshot({ animations: 'disabled' })` 只覆盖 CSS 动画 / CSS 过渡 / Web Animations API，
 * **对 SMIL 完全无效** —— 实测同一页面加载内连拍两张 PNG 字节都不同。
 *
 * 故必须显式 `setCurrentTime(0)` 再 `pauseAnimations()`：
 * 只 `pauseAnimations()` 会停在当前时刻，而当前时刻本身就是不确定的。
 */
export async function freezeSmil(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('svg').forEach((s) => {
      const svg = s as unknown as SVGSVGElement
      try {
        if (typeof svg.setCurrentTime === 'function') svg.setCurrentTime(0)
        if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations()
      } catch {
        /* 非 SVGSVGElement 或不支持 SMIL 的浏览器，忽略 */
      }
    })
  })
}
