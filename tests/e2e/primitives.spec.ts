import { test } from '@playwright/test'

/**
 * 8 UI 基元 · 截图矩阵（浅/深 × 基元 × 状态）。
 * · 沿用 visual.spec.ts 的「冻结时钟 + 预置 localStorage['fls:theme']」范式（防 FOUC + 确定化）。
 * · 目标：`.ds-block[data-ds=...]`（展示页 src/views/DesignSystem.vue，仅 DEV 注册）。
 * · 截图前把区块滚到视口居中，避开 sticky 顶栏（z-index 50）遮挡。
 * 输出：docs/screenshots/ds/{block}-{light|dark}.png  —— 16 张
 *       docs/screenshots/ds/{block}-hover-{light|dark}.png —— 3×2 = 6 张
 * 合计 22 张（≤ 任务书 40 张上限）。
 */
const BLOCKS = [
  'app-button',
  'app-card',
  'app-badge',
  'stat-card',
  'section-title',
  'progress-bar',
  'empty-state',
  'page-header',
] as const

/** 需额外补 hover 态截图的基元（可交互）：选择块内 hover 目标 */
const HOVER = [
  { key: 'app-button', target: '.app-button' },
  { key: 'app-card', target: '.app-card--hoverable' },
  { key: 'stat-card', target: '.stat-card--interactive' },
] as const

/** 固定时刻（本地时间 2025-01-15 10:00:00）；口径与 visual.spec.ts 一致 */
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()

for (const mode of ['light', 'dark'] as const) {
  test.describe(`design-system · ${mode}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (cfg: { mode: string; fixedNow: number }) => {
          const { mode: m, fixedNow } = cfg

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

          localStorage.setItem(
            'fls:theme',
            JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false }),
          )
        },
        { mode, fixedNow: FIXED_NOW },
      )

      await page.goto('/design-system')
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(800)
    })

    for (const key of BLOCKS) {
      test(`${key}-${mode}`, async ({ page }) => {
        const block = page.locator(`.ds-block[data-ds="${key}"]`)
        await block.scrollIntoViewIfNeeded()
        await block.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(250)
        await block.screenshot({ path: `docs/screenshots/ds/${key}-${mode}.png` })
      })
    }

    for (const h of HOVER) {
      test(`${h.key}-hover-${mode}`, async ({ page }) => {
        const block = page.locator(`.ds-block[data-ds="${h.key}"]`)
        await block.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(250)
        await block.locator(h.target).first().hover()
        await page.waitForTimeout(250)
        await block.screenshot({ path: `docs/screenshots/ds/${h.key}-hover-${mode}.png` })
      })
    }
  })
}
