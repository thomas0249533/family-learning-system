import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/**
 * 窄屏（375px）回归网（V1.3 · AC-17 / AC-E2-5）
 *
 * 两件在桌面截图里永远看不出来的事：
 *   1. 成就图鉴在 375px 下会不会撑破卡片（28 张卡的网格 + 长文案）；
 *   2. 题干里的 GFM 表格会不会把整页顶出横向滚动条 ——
 *      正确行为是**表格容器自己横向滚动**，页面本身不动。
 *
 * 判定口径：`documentElement.scrollWidth <= clientWidth + 1`（+1 容忍亚像素舍入）。
 */

const MINI_UNIT = join(process.cwd(), 'tests', 'fixtures', 'mini-unit.json')

async function resetDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('FamilyLearningDB')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })
  await page.reload()
}

/** 页面是否出现横向滚动条 */
async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.documentElement
    return el.scrollWidth > el.clientWidth + 1
  })
}

test.describe('375px 窄屏', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('成就图鉴全部展开后不出现页面级横向滚动（AC-17）', async ({ page }) => {
    // 图鉴在独立页 `/achievements`（V2.7 起首页只陈列 `AchievementHall`，
    // 两级折叠 + 证据的 `AchievementSection` 搬到了独立页）。
    await page.goto('/achievements')
    await resetDb(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    // 0 枚解锁 → 待解锁区默认展开，37 张卡都在。
    // 27 是 V1.6 时代的数（C6 可收集口径）；V2.8 · C1 加了 10 枚习惯成就 → 37，
    // 与 `achievement.spec.ts` 里的 `x / 37` 同源。
    await expect(page.locator('.ach-card')).toHaveCount(37)
    expect(await hasHorizontalScroll(page)).toBe(false)

    // 全部展开（含组）后仍然不横向溢出
    const toggle = page.getByRole('button', { name: /全部展开|全部收起/ })
    if ((await toggle.textContent())?.includes('全部展开')) await toggle.click()
    await expect(page.locator('.ach-card')).toHaveCount(37)

    await expect(page.locator('.ach-card').first()).toBeVisible()
    expect(await hasHorizontalScroll(page)).toBe(false)

    // 卡片本身也不该越界（宽度不超过视口）
    const overflow = await page.locator('.ach-card').first().evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right }
    })
    expect(overflow.left).toBeGreaterThanOrEqual(0)
    expect(overflow.right).toBeLessThanOrEqual(375)
  })

  test('题干表格在窄屏下由容器横向滚动，页面不动（AC-E2-5）', async ({ page }) => {
    await page.goto('/settings/import')
    await resetDb(page)
    await page.locator('input[type="file"]').first().setInputFiles(MINI_UNIT)
    await expect(page.getByText('确认学习包信息')).toBeVisible()
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.getByText('学习包导入成功')).toBeVisible({ timeout: 15_000 })

    await page.goto('/learn')
    await page.locator('.pkg-card').filter({ hasText: 'E2E 迷你单元' }).click()
    await page.locator('.unit-card').filter({ hasText: '第一单元 乘法' }).click()
    await page.locator('.topic-card').filter({ hasText: '主题三：看表答题' }).click()

    // 表格确实被解析成了 <table>，而不是一行竖线
    const wrap = page.locator('.q-table-wrap').first()
    await expect(wrap).toBeVisible()
    await expect(wrap.locator('table.q-table th').first()).toHaveText('节次')
    await expect(wrap.locator('table.q-table thead th')).toHaveCount(6)
    await expect(wrap.locator('table.q-table tbody tr')).toHaveCount(2)

    // 关键断言 1：表格容器自己可横向滚动（内容比容器宽）
    // 注意：`canScroll` 成立的前提是表格内容真的比容器宽 —— 所以夹具用的是
    // 真实的「整周课程表」（6 列），3 列短文本在 375px 下会被 `min-width:100%`
    // 撑满而无需滚动，测出来的 false 是夹具问题，不是样式问题。
    const scrollable = await wrap.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      canScroll: el.scrollWidth > el.clientWidth,
    }))
    expect(scrollable.overflowX).toBe('auto')
    expect(scrollable.canScroll).toBe(true)

    // 关键断言 2：页面本身没有横向滚动条
    expect(await hasHorizontalScroll(page)).toBe(false)
  })
})
