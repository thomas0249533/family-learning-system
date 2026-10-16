import { test } from '@playwright/test'

/**
 * B7 · 视觉回归截图矩阵（浅/深 × 8 类页面）。
 * · 通过 addInitScript 预置 localStorage['fls:theme']，使首帧即目标主题（同时验证防 FOUC）。
 * · **冻结时钟**：报告页含「生成于 <日期 时间>」以及「近 7 天」等相对时间，若用真实时间
 *   两次运行必然不同 → 截图基线无意义且脏工作区。故覆写 Date / Date.now 到固定时刻，
 *   使渲染确定（连跑两次 git status 干净）。
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

/** 固定时刻（本地时间 2025-01-15 10:00:00） */
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()

for (const mode of ['light', 'dark'] as const) {
  for (const p of PAGES) {
    test(`${p.key}-${mode}`, async ({ page }) => {
      await page.addInitScript(
        (cfg: { mode: string; fixedNow: number }) => {
          const { mode: m, fixedNow } = cfg

          // ---- 冻结时钟（确定化截图）----
          const RealDate = Date
          // @ts-expect-error 覆写全局 Date
          const FrozenDate: any = function (...args: any[]) {
            if (args.length === 0) return new RealDate(fixedNow)
            // @ts-expect-error 透传参数
            return new RealDate(...args)
          }
          FrozenDate.now = () => fixedNow
          FrozenDate.parse = RealDate.parse
          FrozenDate.UTC = RealDate.UTC
          FrozenDate.prototype = RealDate.prototype
          ;(window as any).Date = FrozenDate

          // ---- 预置主题 ----
          localStorage.setItem(
            'fls:theme',
            JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false }),
          )
        },
        { mode, fixedNow: FIXED_NOW },
      )

      await page.goto(p.path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `docs/screenshots/${p.key}-${mode}.png`, fullPage: true })
    })
  }
}
