import { test, expect, type Page } from '@playwright/test'

/**
 * 页面切换不能白屏（V3.0 · M5 回归）
 * ------------------------------------------------------------------
 * ## 这条用例守的是一个真实事故
 * 路由出口原本是 `<transition name="fade" mode="out-in">`。`out-in` 的语义是
 * "等旧页面离场动画结束，再挂新页面"，于是"离场何时结束"成了页面能否显示的前置条件。
 * 实测：**从设置页点侧边栏去任何一页，新页面永远不挂载** ——
 *   · 路由已经切换（URL 变、顶栏标题变）
 *   · 外壳正常（侧栏、页头都在）
 *   · `<main>` 里只剩一个注释节点（`<!---->`），等 8 秒也不变
 *   · 控制台**没有任何报错**
 * 用户的观感就是"点一下侧边栏，整页白掉，只能刷新"。
 *
 * ## 为什么单测抓不到
 * 这是"两个组件 + 框架过渡状态机"的交界问题，没有任何纯函数参与。
 * 组件测试（本项目没有 jsdom）和截图回归（截图前会等稳定，但白屏也是"稳定"的）都看不见它。
 * 只有真的点一次导航、再读一次 DOM 才能发现。
 *
 * ## 断言为什么选 `main` 的文本长度
 * 不绑具体选择器：只要能渲染出内容，说明路由出口活着。绑 `.page-container` 之类的类名
 * 会在下次改版时变成"选择器失配"的假红，而我们要守的是"有没有内容"这件事本身。
 */

const DB_NAME = 'FamilyLearningDB'

async function resetDb(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  }, DB_NAME)
  await page.reload()
}

/** `<main>` 里有多少非空白文本（空白页 ≈ 0） */
async function mainTextLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    return (main?.textContent ?? '').replace(/\s+/g, '').length
  })
}

test.describe('页面切换', () => {
  test('★ 从设置页点导航去任何一页都必须渲染出内容（不留白屏）', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await page.waitForSelector('.hall-head-count, .ach-head-count', { timeout: 20_000 })

    // 设置页是"事故页"：它的卸载会卡住 out-in 的离场状态机
    await page.locator('a[href="/settings"]').first().click()
    await expect
      .poll(() => mainTextLength(page), { timeout: 15_000 })
      .toBeGreaterThan(200)

    for (const [href, keyword] of [
      ['/home', '今天'],
      ['/learn', ''],
      ['/mistakes', ''],
      ['/parent', ''],
    ] as const) {
      // 先回设置页（每次都从"事故页"出发，覆盖所有出边）
      if (!page.url().endsWith('/settings')) {
        await page.locator('a[href="/settings"]').first().click()
        await expect.poll(() => mainTextLength(page), { timeout: 15_000 }).toBeGreaterThan(200)
      }

      await page.locator(`a[href="${href}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 10_000 })

      // 核心断言：内容真的渲染了（不是只剩 `<!---->`）
      await expect
        .poll(() => mainTextLength(page), { timeout: 10_000 })
        .toBeGreaterThan(20)

      if (keyword) await expect(page.locator('main')).toContainText(keyword)
    }
  })
})
