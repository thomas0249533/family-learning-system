import { test, expect, type Page } from '@playwright/test'

/**
 * V1.5 · 重复印记的**可见面**（`repeatCount ≥ 2` → 卡面「第 N 次」）
 *
 * 数据侧已有 32 条单测（`tests/repeat-weekly.test.ts` + `tests/unlocked-repeat.test.ts`），
 * 这里只补最后一段：记录 → 视图项 → DOM 的这条链是不是真的接上了。
 *
 * 两件事必须同时成立，缺一个都算没实现：
 *   1. **看得见** —— 卡片上有一个「第 3 次」的印记；
 *   2. **听得到** —— `aria-label` 里带「第 3 次达成」。
 *      卡面的印记是纯视觉的，只做 ① 等于把这条信息对读屏用户藏起来。
 */

const DB_NAME = 'FamilyLearningDB'

async function waitDbReady(page: Page): Promise<void> {
  // 首页是 AchievementHall（.hall-head-count），/achievements 页是 AchievementSection
  // （.ach-head-count）—— 二者其一可见即代表 app 挂载 + Dexie schema 就绪。
  await page.locator('.hall-head-count, .ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
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

async function seed(page: Page, records: Array<Record<string, unknown>>): Promise<void> {
  await page.evaluate(
    async ({ dbName, rows }) => {
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
        st.put({ key: 'achievements:default', value: rows })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, rows: records },
  )
  await page.reload()
}

async function openAchievements(page: Page): Promise<void> {
  await page.goto('/achievements')
  await waitDbReady(page)
  const toggle = page.locator('.ach-head-toggle')
  if (await toggle.count()) await toggle.first().click()
}

test.describe('重复印记（V1.5）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
  })

  test('第 3 次：卡面有印记，aria-label 也说了', async ({ page }) => {
    await seed(page, [
      {
        id: 'streak-7',
        unlockedAt: '2026-09-01',
        evidence: '连续学习 7 天',
        repeatCount: 3,
        lastRepeatPeriod: 'W2026-10-19',
      },
    ])
    await openAchievements(page)

    const card = page.locator('.ach-card.earned', { hasText: '一周不断' })
    await expect(card).toBeVisible()

    // ① 看得见
    await expect(card.locator('.ach-repeat')).toHaveText('第 3 次')

    // ② 听得到（这条比 ① 重要：印记是纯视觉的）
    await expect(card).toHaveAttribute(
      'aria-label',
      /一周不断，已解锁，2026-09-01.*第 3 次达成/,
    )
  })

  test('只达成过一次 → 没有印记，aria-label 也不提次数', async ({ page }) => {
    await seed(page, [{ id: 'streak-7', unlockedAt: '2026-09-01' }])
    await openAchievements(page)

    const card = page.locator('.ach-card.earned', { hasText: '一周不断' })
    await expect(card).toBeVisible()
    await expect(card.locator('.ach-repeat')).toHaveCount(0)
    await expect(card).not.toHaveAttribute('aria-label', /第 \d+ 次达成/)
  })
})
