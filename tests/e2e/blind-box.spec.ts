import { test, expect, type Page } from '@playwright/test'

/**
 * V2.8 · C3 · 盲盒入口与开箱动画（真机验证）
 * ------------------------------------------------------------------
 * 引擎（触发判定 / 保底抽取）已被 blind-box.test.ts 的 18 条单测钉死，
 * 这里只验**单测验不了的三件事**：
 *   1. 入口可见性跟着触发条件走：没触发就不出现，触发即出现；
 *   2. 开箱链路可操作：点击 → 动画 → 结果卡 → 收下 → 入口消失（每日防刷的可见面）；
 *   3. prefers-reduced-motion 降级后链路依然完整（动效是增强，不是依赖）。
 */

/** 本地"今天"（与生产同口径：浏览器本地时区下 Node 侧直接拼） */
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

/** 种 N 枚"今日解锁"的普通成就（直接写 achievements:default）→ 命中「单日 ≥3」触发条件 */
async function seedUnlocksToday(page: Page, ids: string[]): Promise<void> {
  const today = todayKey()
  await page.evaluate(
    async ({ ids, today }) => {
      const value = ids.map((id) => ({ id, unlockedAt: today, evidence: 'e2e 种子' }))
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('FamilyLearningDB')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('settings', 'readwrite')
          tx.objectStore('settings').put({ key: 'achievements:default', value })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      })
    },
    { ids, today },
  )
  await page.reload()
}

test.describe('盲盒入口', () => {
  test('无触发 → 入口不出现（空库首页不该有惊喜盒）', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await expect(page.locator('.blind-box-fab')).toHaveCount(0)
  })

  test('单日解锁 ≥3 → 入口出现 → 开箱出结果卡 → 收下后入口消失且刷新不复现', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await seedUnlocksToday(page, ['first-step', 'ten-kp', 'mistake-first'])

    const fab = page.locator('.blind-box-fab')
    await expect(fab).toBeVisible({ timeout: 15_000 })
    await expect(fab).toContainText('有惊喜')

    // 点悬浮盒 → 全屏遮罩 + 盒子待开
    await fab.click()
    const overlay = page.locator('.blind-box-overlay')
    await expect(overlay).toBeVisible()

    await page.locator('.blind-box-open-btn').click()

    // 动画完成后结果卡出现（标题必是 5 枚盲盒成就之一）
    const reward = page.locator('.blind-box-reward')
    await expect(reward).toBeVisible({ timeout: 8_000 })
    await expect(reward).toContainText('恭喜开出')
    const title = await reward.locator('.blind-box-reward__title').innerText()
    expect(['幸运星', '月夜奇遇', '彩虹瓶', '流星信使', '隐藏王冠']).toContain(title.trim())
    await expect(reward).toContainText(/盲盒收藏 1 \/ 5/)

    // 收下 → 遮罩关、入口消失（今天已抽，防刷）
    await reward.getByRole('button', { name: '收下了' }).click()
    await expect(overlay).toBeHidden()
    await expect(page.locator('.blind-box-fab')).toHaveCount(0)

    // 刷新后依然没有（防刷锚点落库了）
    await page.reload()
    await expect(page.locator('.blind-box-fab')).toHaveCount(0, { timeout: 15_000 })
  })

  test('prefers-reduced-motion：跳过动画直接出结果卡，链路完整', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/home')
    await resetDb(page)
    await seedUnlocksToday(page, ['streak-3', 'streak-7', 'daily-20'])

    const fab = page.locator('.blind-box-fab')
    await expect(fab).toBeVisible({ timeout: 15_000 })
    await fab.click()

    await page.locator('.blind-box-open-btn').click()
    const reward = page.locator('.blind-box-reward')
    // 降级无 1s 摇晃等待：结果卡应很快出现
    await expect(reward).toBeVisible({ timeout: 3_000 })
    await expect(reward).toContainText('恭喜开出')
    await reward.getByRole('button', { name: '收下了' }).click()
    await expect(page.locator('.blind-box-fab')).toHaveCount(0)
  })
})
