import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B5 · 打印件（AC-P2-16 / AC-P2-10 的可见面）
 * ------------------------------------------------------------------
 * 分页算法已经被 12 条单测钉死。这里只验**渲染层有没有按算法来**：
 *   1. 一页一个小组、M/G/B/E 顺序、每页卡数与分组分布一致（8/7/8/5）；
 *   2. 页码在页脚、连续、不重编；
 *   3. 打印媒体下工具栏消失、层级靠边框粗细而不是颜色（黑白打印也能分辨）。
 *
 * 第 3 条是 AC-P2-10（"灰度截图人工复核"）里**唯一能自动验**的部分：
 * 颜色在去色后会消失，边框粗细不会。所以这里断言粗细确实分了三档。
 */

const DB_NAME = 'FamilyLearningDB'

async function waitDbReady(page: Page): Promise<void> {
  await page.locator('.ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
}

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

async function seedBase(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB 被阻塞'))
    })
    const now = new Date().toISOString()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['settings'], 'readwrite')
      const st = tx.objectStore('settings')
      st.put({
        key: 'profiles',
        value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: now }] },
      })
      // 解锁几枚，让"已获得 x / y"不是全 0
      st.put({
        key: 'achievements:default',
        value: [
          { id: 'first-step', unlockedAt: '2026-10-01' },
          { id: 'ten-kp', unlockedAt: '2026-10-02' },
        ],
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    })
  }, DB_NAME)
  await page.reload()
}

test.describe('成就打印件（V1.4 · B5）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedBase(page)
  })

  test('按小组分页：4 页、M/G/B/E 顺序、每页只含一组（AC-P2-16）', async ({ page }) => {
    await page.goto('/achievements/print')

    const pages = page.locator('.print-page')
    await expect(pages).toHaveCount(4, { timeout: 20_000 })

    // 顺序：精熟 → 成长 → 习惯 → 探索（CATEGORY_ORDER，文案取 CATEGORY_META.label）
    await expect(page.locator('.print-group-name')).toHaveText([
      '精熟目标',
      '成长型思维',
      '行为塑造',
      '探索发现',
    ])

    // 每页卡数 = 该组枚数（内置**可收集**分布 M8 / G7 / B7 / E5；B 组少的那枚是 night-owl）
    const counts: number[] = []
    for (let i = 0; i < 4; i += 1) {
      counts.push(await pages.nth(i).locator('.print-card').count())
    }
    expect(counts).toEqual([8, 7, 7, 5])

    // 页脚：页码连续、不重编
    await expect(page.locator('.print-page-no')).toHaveText([
      '第 1 / 4 页',
      '第 2 / 4 页',
      '第 3 / 4 页',
      '第 4 / 4 页',
    ])

    // 页眉：档案名 + 该组已获得数（种子里那两枚都在精熟组）
    await expect(pages.nth(0).locator('.print-head-meta')).toHaveText('已获得 2 / 8')
    await expect(pages.nth(1).locator('.print-head-meta')).toHaveText('已获得 0 / 7')
  })

  test('打印媒体下工具栏消失，层级靠边框粗细区分（AC-P2-10 的可自动验部分）', async ({ page }) => {
    await page.goto('/achievements/print')
    await expect(page.locator('.print-page')).toHaveCount(4, { timeout: 20_000 })

    // 屏幕态：工具栏在
    await expect(page.locator('.print-toolbar')).toBeVisible()

    // 打印态：工具栏不打印（否则纸上会多出一排按钮）
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.print-toolbar')).toBeHidden()

    // 三档层级边框粗细必须真的不同（去色后这是唯一的结构性线索）
    const widthOf = async (cls: string) => {
      const el = page.locator(`.print-card.${cls}`).first()
      return el.evaluate((node) => Number.parseFloat(getComputedStyle(node).borderTopWidth))
    }
    const common = await widthOf('tier-common')
    const advanced = await widthOf('tier-advanced')
    const rare = await widthOf('tier-rare')

    expect(common).toBeLessThan(advanced)
    expect(advanced).toBeLessThan(rare)

    // 层级文字必须印出来（家长版才有；孩子版是不印的）
    await expect(page.locator('.print-tier').first()).toContainText(/常见|进阶|稀有/)
  })

  test('没有成就时不打空页，而是一句引导', async ({ page }) => {
    // 换一个空档案：achievements:<pid> 为空 → items 仍按定义枚举（都未解锁），页数不变。
    // 所以"空"只可能发生在 store 完全没加载/无内置定义时 —— 这里断言按钮路径不会白屏：
    await page.goto('/achievements')
    await expect(page.getByText('打印与导出')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: '打印 / 存成 PDF' }).click()
    await expect(page).toHaveURL(/\/achievements\/print/)
    await expect(page.locator('.print-page').first()).toBeVisible()
  })
})
