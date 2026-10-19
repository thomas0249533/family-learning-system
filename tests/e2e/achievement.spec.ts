import { test, expect, type Page } from '@playwright/test'

/**
 * 成就链路端到端验证（V1.3 · T03/T04）。
 *
 * 覆盖用户明确要求验证的两件事：
 *   1. **折叠展示**：默认收起 → 一键展开 → 状态持久化（刷新后仍展开）；
 *   2. **解锁流程**：满足条件 → 徽章计入已获得 → 弹提示 → 刷新不重复弹。
 *
 * 做法：直接往 IndexedDB（`FamilyLearningDB`）种一条「已掌握」的进度与一个包，
 * 让真实的结算链路（AppShell 触发器 → store.settle → syncAchievements → toast）自己跑，
 * 不 mock 任何业务代码。
 */

/** 种数据：一个 unit 包 + 一条已掌握进度（= 满足「迈出第一步」） */
async function seedMasteredOne(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('FamilyLearningDB')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const names = Array.from(db.objectStoreNames)
        if (!names.includes('packages') || !names.includes('progress')) {
          reject(new Error(`DB 尚未建表：${names.join(',')}`))
          return
        }
        const tx = db.transaction(['packages', 'progress'], 'readwrite')
        tx.objectStore('packages').put({
          packageId: 'unit-math-e2e',
          manifest: {
            packageId: 'unit-math-e2e',
            type: 'unit',
            subject: 'math',
            grade: 4,
            term: 'up',
            title: 'E2E 测试单元',
          },
          knowledgePoints: [{ id: 'unit-math-e2e::kp1', title: '两位数乘法' }],
          exercises: [],
          units: [],
        })
        tx.objectStore('progress').put({
          packageId: 'unit-math-e2e',
          knowledgePointId: 'unit-math-e2e::kp1',
          status: '已掌握',
          correctCount: 3,
          wrongCount: 0,
          correctStreak: 3,
          wrongStreak: 0,
          lastStudiedAt: new Date().toISOString(),
          studySeconds: 60,
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
}

/**
 * 清掉库与成就 UI 偏好，保证用例之间互不影响。
 *
 * ⚠️ **必须在 `goto` 之后调用**：about:blank 下 IndexedDB 被浏览器禁用（SecurityError）。
 * 也**不能用 addInitScript 清 localStorage** —— 它每次导航都会跑，
 * 会把"刷新后折叠状态保持展开"这条断言直接清掉。
 */
async function resetAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      localStorage.removeItem('fls:achievementUi')
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('FamilyLearningDB')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })
  // 删库会让当前页面的 Dexie 连接失效，重新加载拿一个干净起点
  await page.reload()
}

test.describe('成就图鉴 · 折叠展示', () => {
  test('默认收起 → 一键展开 → 刷新后保持展开', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    const masterToggle = page.getByRole('button', { name: /全部展开|全部收起/ })

    // 默认收起：四个分组头都在，但组内卡片一个都不渲染
    await expect(page.locator('.ach-group')).toHaveCount(4)
    await expect(page.locator('.ach-card')).toHaveCount(0)
    await expect(masterToggle).toHaveText('全部展开')

    // 一键展开
    await masterToggle.click()
    await expect(masterToggle).toHaveText('全部收起')
    await expect(page.locator('.ach-card')).toHaveCount(28)

    // 持久化：刷新后仍是展开态
    await page.reload()
    await expect(page.getByRole('button', { name: '全部收起' })).toBeVisible()
    await expect(page.locator('.ach-card')).toHaveCount(28)
  })

  test('收起态也给出达成提示（未获得的成就可查看）', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    // 「正在接近」常驻：不展开也能看到进度提示
    await expect(page.locator('.ach-closest-item').first()).toContainText('当前')
    // 每个折叠组头都有一句「最接近：…」
    await expect(page.locator('.group-teaser')).toHaveCount(4)
  })
})

test.describe('成就链路 · 解锁', () => {
  test('满足条件 → 计入已获得 + 弹提示 + 刷新不重复弹', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    // 初始 0 / 28
    await expect(page.locator('.ach-head-count')).toHaveText('0 / 28')

    // 种一条已掌握 → 刷新让真实结算链路跑一遍
    await seedMasteredOne(page)
    await page.reload()

    // 解锁提示（toast）出现，标题是「迈出第一步」
    const toast = page.locator('.ach-toast')
    await expect(toast).toBeVisible({ timeout: 15_000 })
    await expect(toast).toContainText('解锁新成就')
    await expect(toast).toContainText('迈出第一步')

    // 计入已获得
    await expect(page.locator('.ach-head-count')).toHaveText('1 / 28')

    // 展开后能看到这一枚被标记为已获得
    await page.getByRole('button', { name: '全部展开' }).click()
    await expect(page.locator('.ach-card.earned')).toHaveCount(1)
    await expect(page.locator('.ach-card.earned').first()).toContainText('迈出第一步')
    await expect(page.locator('.ach-card.earned').first()).toContainText('已获得')

    // 持久化 + 不重复提示：再刷新一次，没有 toast，计数仍是 1
    await page.reload()
    await expect(page.locator('.ach-head-count')).toHaveText('1 / 28')
    await page.waitForTimeout(1500)
    await expect(page.locator('.ach-toast')).toHaveCount(0)
  })
})
