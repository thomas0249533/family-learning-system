import { expect, test } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * B7 补 · 主题预设像素覆盖（V1.2 批 6b）
 * ------------------------------------------------------------------
 * `visual.spec.ts` 只盖了 **junior（初中·松绿）** 一套预设的浅/深。
 * 但主色是按学段分的：primary（小学·暖橙）/ junior（初中·松绿）/ senior（高中·蓝灰），
 * 浅深各一套，共 6 种组合。只截一套预设等于**另外两套从未被人眼看过**——
 * 配色跑偏（对比度、卡片底色、图表配色）在这两套里完全不会被发现。
 *
 * 为什么**不是**只丢截图：纯截图没有断言，永远不可能失败，也就永远不算测试。
 * 所以每条用例先断言主色真的落到了 `body[data-theme-preset]` 那一档
 * （值与 `src/core/styles/theme.scss` 一致），再落图。这样：
 *   · 预设没生效 → 断言红（而不是留下一张"其实还是初中绿"的假截图）；
 *   · 配色改了但没同步截图 → 人眼对比基线能发现。
 *
 * 只截 3 个页面：home（卡片+成就+图表）、report（图表最密，配色最敏感）、
 * learn（列表+标签+进度条）。全 8 页 × 4 组合会让 e2e 翻倍而收益递减。
 *
 * 输出：docs/screenshots/{preset}/{page}-{light|dark}.png
 */

const PAGES = [
  { key: 'home', path: '/home' },
  { key: 'report', path: '/report' },
  { key: 'learn', path: '/learn' },
] as const

/** 与 theme.scss 逐条核对的主色（`--primary-color`），浅/深各一档 */
const EXPECTED_PRIMARY: Record<string, { light: string; dark: string }> = {
  primary: { light: '#f2760c', dark: '#ffa447' }, // 小学·暖橙
  senior: { light: '#3b5b7a', dark: '#7fa3c4' }, // 高中·蓝灰
}

const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()

for (const preset of ['primary', 'senior'] as const) {
  for (const mode of ['light', 'dark'] as const) {
    for (const p of PAGES) {
      test(`${preset} · ${p.key}-${mode}`, async ({ page }) => {
        await page.addInitScript(
          (cfg: { preset: string; mode: string; fixedNow: number }) => {
            const RealDate = Date
            // 显式 `any`：造一个"形状像 Date"的替身再挂到 window 上（报告页有相对时间，
            // 不冻结则基线不稳定）。原来这里挂了 `@ts-expect-error`，但 `any` 本来就不报错，
            // 指令失效 → `vue-tsc` 报 TS2578（B1 打开 tests 类型检查时暴露）
            const FrozenDate: any = function (...args: any[]) {
              if (args.length === 0) return new RealDate(cfg.fixedNow)
              // @ts-expect-error 透传参数
              return new RealDate(...args)
            }
            FrozenDate.now = () => cfg.fixedNow
            FrozenDate.parse = RealDate.parse
            FrozenDate.UTC = RealDate.UTC
            FrozenDate.prototype = RealDate.prototype
            ;(window as any).Date = FrozenDate

            // presetManual 必须为 true：否则主题会按已导入包的年级自动推断回 junior，
            // 截出来还是初中绿，而断言会很诚实地把它判成失败。
            localStorage.setItem(
              'fls:theme',
              JSON.stringify({
                preset: cfg.preset,
                mode: cfg.mode,
                fontSize: 'medium',
                presetManual: true,
              }),
            )
          },
          { preset, mode, fixedNow: FIXED_NOW },
        )

        await page.goto(p.path)
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1200)

        // ---- 关键断言：预设真的生效了 ----
        await expect(page.locator('body')).toHaveAttribute('data-theme-preset', preset)
        const darkOn = await page.evaluate(() => document.body.classList.contains('dark-mode'))
        expect(darkOn).toBe(mode === 'dark')

        const actualPrimary = await page.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue('--primary-color').trim(),
        )
        expect(actualPrimary.toLowerCase()).toBe(EXPECTED_PRIMARY[preset][mode])

        await freezeSmil(page)
        await page.screenshot({
          path: `docs/screenshots/${preset}/${p.key}-${mode}.png`,
          fullPage: true,
          animations: 'disabled',
        })
      })
    }
  }
}
