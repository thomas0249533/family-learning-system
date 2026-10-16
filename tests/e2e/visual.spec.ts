import { test } from '@playwright/test'

/**
 * B7 · 视觉回归截图矩阵（浅/深 × 8 类页面）。
 * 通过 addInitScript 预置 localStorage['fls:theme']，使首帧即目标主题（同时验证防 FOUC）。
 * 输出：docs/screenshots/{页面}-{light|dark}.png
 */
const PAGES = [
  { key: 'home', path: '/home' },
  { key: 'report', path: '/report' },
  { key: 'search', path: '/search' },
  { key: 'review', path: '/review' },
  { key: 'mistakes', path: '/mistakes' },
  { key: 'parent', path: '/parent' },
  { key: 'learn', path: '/learn' },
  { key: 'settings', path: '/settings' },
] as const

for (const mode of ['light', 'dark'] as const) {
  for (const p of PAGES) {
    test(`${p.key}-${mode}`, async ({ page }) => {
      await page.addInitScript((m: string) => {
        localStorage.setItem(
          'fls:theme',
          JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false }),
        )
      }, mode)

      await page.goto(p.path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `docs/screenshots/${p.key}-${mode}.png`, fullPage: true })
    })
  }
}
