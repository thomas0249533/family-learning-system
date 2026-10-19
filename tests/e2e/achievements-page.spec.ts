import { test, expect, type Page } from '@playwright/test'

/**
 * V1.3 P1 · 独立成就页 + 详情弹层（真机验证）
 * ------------------------------------------------------------------
 * 单测已经把 `detailOf` 的规则穷举过了（剪影不可开、三类形态、N≥1…），
 * 这里只验**单测验不了的三件事**：
 *   1. 入口通不通：Home 上的「查看全部」能不能真的进到 /achievements；
 *   2. 卡片是不是真的可操作：鼠标点、键盘 Enter 都要能开弹层（不能是死按钮）；
 *   3. 剪影卡是不是真的"点不动"：它必须是 `<div>`（不可聚焦），
 *      而且点击之后弹层**不能出现**（一旦能开就等于泄底）。
 */

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

test.describe('独立成就页', () => {
  test('Home 的「查看全部」进到 /achievements，页面有标题与整体进度', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)

    // 0 枚解锁的初始态：入口一定在
    await page.getByRole('link', { name: /查看全部/ }).click()
    await expect(page).toHaveURL(/\/achievements$/)
    await expect(page.getByRole('heading', { name: '我的成就' })).toBeVisible()

    // 图鉴本体照旧 28 张卡（剪影也在）
    await expect(page.locator('.ach-card')).toHaveCount(28)

    // 独立页上不再重复显示「查看全部 ->」（standalone）
    await expect(page.getByRole('link', { name: /查看全部/ })).toHaveCount(0)
  })

  test('点卡片开详情弹层，ESC 关闭（鼠标路径）', async ({ page }) => {
    await page.goto('/achievements')
    await resetDb(page)

    const card = page.locator('.ach-card').filter({ hasText: '小试牛刀' }).first()
    await card.click()

    const modal = page.locator('.ach-detail')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('小试牛刀')
    // 未解锁且可进度化 → 有进度文案（来自 progressText，唯一来源）
    await expect(modal).toContainText(/还差|目标/)

    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
  })

  test('键盘可达：聚焦卡片后按 Enter 能开弹层（键盘路径）', async ({ page }) => {
    await page.goto('/achievements')
    await resetDb(page)

    const card = page.locator('.ach-card').filter({ hasText: '小试牛刀' }).first()
    // 原生 button 才会被 focus 命中；这一步同时证明卡片不是 div 假装的
    await card.focus()
    await expect(card).toBeFocused()

    await page.keyboard.press('Enter')
    const modal = page.locator('.ach-detail')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('小试牛刀')
  })

  test('剪影（隐藏成就未解锁）不可聚焦、点击也不开弹层', async ({ page }) => {
    await page.goto('/achievements')
    await resetDb(page)

    // 3 枚隐藏成就都是剪影
    const silhouettes = page.locator('.ach-card.silhouette')
    await expect(silhouettes).toHaveCount(3)

    // 关键：每一枚都必须是 div —— 是 button 就会进 Tab 序列，等于给了键盘一条泄底路径
    for (let i = 0; i < 3; i++) {
      const tag = await silhouettes.nth(i).evaluate((el) => el.tagName)
      expect(tag).toBe('DIV')
    }

    const silhouette = silhouettes.first()

    await silhouette.click()
    await expect(page.locator('.ach-detail')).toHaveCount(0)

    // 页面源码里仍然搜不到任何一枚隐藏成就的真实描述
    const html = await page.content()
    for (const leak of [
      '某知识点曾答错 ≥3 次后转为「已掌握」',
      '在 07:00 前完成一次学习',
      '在 21:00 后完成一次学习',
    ]) {
      expect(html).not.toContain(leak)
    }
  })
})
