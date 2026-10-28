import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 学习卡片的「全部完成」· 端到端冒烟
 * ------------------------------------------------------------------
 * 单测（`tests/completion.test.ts`）已经钉死纯函数判定，但有三件事只有真机跑得出来：
 *
 *   1. **手动标记真的写进了 IndexedDB**：`cardCompletions` 是 db v8 新增的表，
 *      索引写错会在真库里报「未知索引」，而 fakeDexie 测不到；
 *   2. **卡片真的变色**：状态角标与底色由 `cardStatusClass` + `CARD_STATUS_MARK`
 *      两处合成，单测只验函数、不验渲染；
 *   3. **刷新后标记还在**：读的是 `db.cardCompletions`（不是内存态）。
 *
 * 场景取的是**每日一练**（45 天 = 45 张单元卡）—— 用户说的「每日打卡」就是这一屏。
 */

const DB_NAME = 'FamilyLearningDB'
const ZIP = 'content/math-4-up-rjb/math-4-up-rjb-set.lpkgset.zip'
const DAILY = 'daily-math-4-up-rjb-45d'

async function waitDbReady(page: Page): Promise<void> {
  await page.locator('.hall-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
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

async function seedProfiles(page: Page): Promise<void> {
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
      tx.objectStore('settings').put({
        key: 'profiles',
        value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: now }] },
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

test.describe('学习卡片「全部完成」', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedProfiles(page)
  })

  test('导入数学集合 → 每日打卡卡可手动标记为全部完成 → 刷新后仍在 → 可撤销', async ({ page }) => {
    await page.goto('/settings/import')
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
      name: 'math-4-up-rjb-set.lpkgset.zip',
      mimeType: 'application/zip',
      buffer: readFileSync(resolve(process.cwd(), ZIP)),
    })

    const modal = page.locator('.n-modal, .n-dialog').first()
    await expect(modal).toBeVisible({ timeout: 30_000 })

    // ---------- 每日打卡的单元卡 ----------
    await page.goto(`/learn/${DAILY}`)
    const card = page.locator('.unit-card').first()
    await expect(card).toBeVisible({ timeout: 20_000 })
    // 没练过 → 中性底 + 空心圆
    await expect(card).not.toHaveClass(/is-mastered/)
    await expect(card.locator('.unit-status-mark')).toHaveText('○')

    // ---------- 手动标记「全部完成」 ----------
    const flag = card.locator('.unit-card-flag')
    await expect(flag).toBeVisible()
    await flag.click()

    // 卡片变绿 + 角标变 ✓
    await expect(card).toHaveClass(/is-mastered/)
    await expect(card.locator('.unit-status-mark')).toHaveText('✓')
    await expect(card.locator('.unit-card-flag')).toContainText('已标记')

    // ---------- 刷新后仍在（真的写进了 IndexedDB） ----------
    await page.reload()
    const card2 = page.locator('.unit-card').first()
    await expect(card2).toHaveClass(/is-mastered/, { timeout: 20_000 })
    await expect(card2.locator('.unit-card-flag')).toContainText('已标记')

    // ---------- 可撤销 ----------
    await card2.locator('.unit-card-flag').click()
    await expect(card2).not.toHaveClass(/is-mastered/)
    await expect(card2.locator('.unit-status-mark')).toHaveText('○')
  })
})
