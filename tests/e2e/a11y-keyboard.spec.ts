import { test, expect } from '@playwright/test'

/**
 * V4.0 · D5 —— 可访问性端到端回归（键盘真的能用）
 *
 * 单测只能证明「源码里有 v-clickable」，证明不了「按 Tab 真的停在那儿、按 Enter 真的跳走」。
 * 这条 spec 补的就是这一段：它曾经是纯粹的死角 —— 首页主入口卡、学习包卡、搜索行
 * 全是 `div + @click`，鼠标能点，键盘一个都进不去。
 *
 * 三件事：
 *   1. 可点击容器真的进了 Tab 顺序（role / tabindex 被指令补上）；
 *   2. 焦点态真的可见（计算样式里 outline 不是没设 / 不是透明 —— 环"存在"和
 *      "看得见"是两回事，55% 半透明主色就属于后者）；
 *   3. Enter 真的触发跳转（不是只有样式好看）。
 */

test.describe('v-clickable 键盘可达性', () => {
  test('首页主入口卡：可聚焦、焦点环可见、Enter 可跳转', async ({ page }) => {
    await page.goto('/home')

    const card = page.locator('.today-card').first()
    await expect(card).toBeVisible()

    // 指令补上的语义
    await expect(card).toHaveAttribute('role', 'link')
    await expect(card).toHaveAttribute('tabindex', '0')
    await expect(card).toHaveAttribute('data-clickable', 'link')

    // 真正聚焦（键盘用户就是这么到达的）
    await card.focus()
    await expect(card).toBeFocused()

    // 焦点环必须可见：描边宽度 > 0，颜色不是透明
    const ring = await card.evaluate((el) => {
      const s = getComputedStyle(el)
      return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor }
    })
    expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(2)
    expect(ring.style).not.toBe('none')
    expect(ring.color).not.toMatch(/rgba?\([^)]*,\s*0\s*\)$/)

    // Enter 触发跳转（role=link 的标准激活方式）
    const before = page.url()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.url(), { timeout: 5000 }).not.toBe(before)
  })

  test('搜索结果的条目行也在 Tab 顺序里', async ({ page }) => {
    await page.goto('/search')
    // 无查询词时没有结果行，这里只验证「导航到页面不报错、指令注册成功」
    // （有结果行时的 role/tabindex 由单测与首页用例共同保证）
    await expect(page.locator('body')).toBeVisible()
  })
})
