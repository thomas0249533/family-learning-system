import { test, expect, type Page } from '@playwright/test'

/**
 * V2.7 · 轨道 A（UI 深度优化）端到端验收
 * =====================================================================
 * 三条线各一组，都落在**用户可感知的行为**上，不去断言内部实现：
 *
 *   A1 设置页 · 左侧分区菜单
 *      · 8 个分区都在菜单里；点分区 → 对应面板滚进视口 + 菜单高亮跟随
 *      · `#family-backup` 深链仍能落到导出卡（B4「导出并删除旧档案」靠它）
 *      · **关键回归**：所有面板始终在 DOM 里（不因切 Tab 被卸载），
 *        否则 AI / 同步 / 备份预检这些自治卡片的内部状态会被反复清空
 *
 *   A2 首页 · 荣誉勋章墙
 *      · 大图标网格默认最多 8 枚；分类 Tab 可切换
 *      · 点勋章打开详情弹层；隐藏成就（剪影）点不开、也不泄底
 *
 *   A3 学习页 · 搜索 + 分组折叠 + 按周分组
 *      · 顶部搜索按标题/学科过滤，带命中计数与清除
 *      · 分组可折叠（aria-expanded 同步）；搜索时强制展开
 *      · 每日一练声明了周号时按周分桶
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'

/** 等 Dexie 真的把表建出来再种数据（裸 open 抢版本会造出空库） */
async function waitDbReady(page: Page): Promise<void> {
  await expect(page.locator('.welcome-hi')).toBeVisible({ timeout: 20_000 })
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

interface SeedPkg {
  packageId: string
  manifest: Record<string, unknown>
}

async function seedPackages(page: Page, packages: SeedPkg[]): Promise<void> {
  await page.evaluate(
    async ({ dbName, pkgs, profileId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages'], 'readwrite')
        tx.objectStore('settings').put({
          key: 'profiles',
          value: {
            activeId: profileId,
            list: [{ id: profileId, name: '我', createdAt: '2025-03-01T00:00:00.000Z' }],
          },
        })
        for (const pkg of pkgs) {
          tx.objectStore('packages').put({
            packageId: pkg.packageId,
            manifest: pkg.manifest,
            knowledgePoints: [],
            exercises: [],
            units: [],
          })
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, pkgs: packages, profileId: PROFILE_ID },
  )
}

// =====================================================================
// A1 · 设置页左侧分区菜单
// =====================================================================

test.describe('A1 · 设置页左菜单', () => {
  test('8 个分区可点、滚动进视口、菜单高亮跟随', async ({ page }) => {
    await page.goto('/settings')

    const nav = page.locator('.settings-nav')
    await expect(nav).toBeVisible()
    await expect(nav.locator('.nav-item')).toHaveCount(8)

    // 所有面板都在 DOM 里（不是"只渲染当前 Tab"）
    await expect(page.locator('.settings-panel')).toHaveCount(8)

    // 点最后一个分区 → 该面板进入视口，且菜单只有它处于高亮
    await nav.locator('.nav-item', { hasText: '危险操作' }).click()
    const danger = page.locator('.settings-panel[data-section="danger"]')
    await expect(danger).toBeInViewport()
    await expect(nav.locator('.nav-item.active')).toHaveCount(1)
    await expect(nav.locator('.nav-item.active')).toContainText('危险操作')
  })

  test('`#family-backup` 深链落到导出卡，菜单高亮同步到「导出」', async ({ page }) => {
    await page.goto('/settings#family-backup')

    // 平滑滚动有动画，用轮询式断言等它到位
    await expect(page.locator('#family-backup')).toBeInViewport({ ratio: 0.3 })
    await expect(page.locator('.settings-nav .nav-item.active')).toContainText('导出')
  })
})

// =====================================================================
// A2 · 首页荣誉勋章墙
// =====================================================================

test.describe('A2 · 荣誉勋章墙', () => {
  test('大图标网格 + 分类 Tab + 点击开详情', async ({ page }) => {
    await page.goto('/')
    await resetDb(page)
    await waitDbReady(page)

    const hall = page.locator('.hall')
    await expect(hall).toBeVisible()

    // 全未解锁时也能摆满一屏（8 枚），而不是一片空白
    await expect(hall.locator('.hall-tile')).toHaveCount(8)
    // 默认「全部」Tab 被选中
    await expect(hall.locator('.hall-tab.active')).toContainText('全部')

    // 切到「行为塑造」：只剩该类勋章，且数量不大于该类总数
    await hall.locator('.hall-tab', { hasText: '行为塑造' }).click()
    await expect(hall.locator('.hall-tab.active')).toContainText('行为塑造')
    const behaviorTiles = hall.locator('.hall-tile')
    const n = await behaviorTiles.count()
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(8)

    // 未解锁（非剪影）可点开详情
    const firstEnabled = behaviorTiles.filter({ hasNot: page.locator('.silhouette') }).first()
    await firstEnabled.click()
    await expect(page.locator('.ach-detail')).toBeVisible()
  })
})

// =====================================================================
// A3 · 学习页搜索 / 折叠 / 按周分组
// =====================================================================

const seedForSearch: SeedPkg[] = [
  {
    packageId: 'daily-w1',
    manifest: {
      schemaVersion: '1.0',
      packageId: 'daily-w1',
      packageType: 'daily',
      subject: 'math',
      grade: 4,
      term: 'up',
      edition: '人教版',
      title: '每日一练 · 第 1 周',
      week: 1,
    },
  },
  {
    packageId: 'daily-w2',
    manifest: {
      schemaVersion: '1.0',
      packageId: 'daily-w2',
      packageType: 'daily',
      subject: 'math',
      grade: 4,
      term: 'up',
      edition: '人教版',
      title: '每日一练 · 第 2 周',
      week: 2,
    },
  },
  {
    packageId: 'unit-math-4',
    manifest: {
      schemaVersion: '1.0',
      packageId: 'unit-math-4',
      packageType: 'unit',
      subject: 'chinese',
      grade: 4,
      term: 'up',
      edition: '人教版',
      title: '语文四年级上册 第一单元',
    },
  },
]

test.describe('A3 · 学习页搜索与折叠', () => {
  test('搜索过滤 + 计数 + 清除', async ({ page }) => {
    await page.goto('/')
    await resetDb(page)
    await waitDbReady(page)
    await seedPackages(page, seedForSearch)
    await page.goto('/learn')

    // 3 个包全在
    await expect(page.locator('.pkg-card')).toHaveCount(3)

    // 搜「语文」→ 只剩 1 个，计数显示
    await page.locator('.search-input').fill('语文')
    await expect(page.locator('.pkg-card')).toHaveCount(1)
    await expect(page.locator('.search-count')).toHaveText('找到 1 个')

    // 搜不到 → 空态文案带上关键词
    await page.locator('.search-input').fill('不存在的学科')
    await expect(page.locator('.pkg-card')).toHaveCount(0)
    await expect(page.locator('.empty-card')).toContainText('没有匹配')

    // 清除 → 全部回来
    await page.getByRole('button', { name: '清除' }).click()
    await expect(page.locator('.pkg-card')).toHaveCount(3)
  })

  test('每日一练按周分桶 + 分组可折叠', async ({ page }) => {
    await page.goto('/')
    await resetDb(page)
    await waitDbReady(page)
    await seedPackages(page, seedForSearch)
    await page.goto('/learn')

    // 两个包都声明了 week → 出现两个周头
    const weekHeads = page.locator('.week-head')
    await expect(weekHeads).toHaveCount(2)
    await expect(weekHeads.first()).toContainText('第 1 周')

    // 折叠「教材」分组：卡片隐藏，aria-expanded 同步
    const toggle = page.locator('.group-toggle[aria-controls="pkg-panel-textbook"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.locator('#pkg-panel-textbook .pkg-card').first().waitFor({ state: 'visible' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#pkg-panel-textbook')).toBeHidden()

    // 搜索时强制展开（命中的内容不能藏在折叠里）
    await page.locator('.search-input').fill('语文')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#pkg-panel-textbook .pkg-card')).toHaveCount(1)
  })
})
