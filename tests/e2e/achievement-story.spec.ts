import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B6 · 故事卡（PRD §P2「重复纪念印记 / 故事卡」的可见面）
 * ------------------------------------------------------------------
 * 纯逻辑（三段口径 / 拿不到就不写 / 剪影不泄底 / 文件名）已由
 * `tests/achievement-story.test.ts` 的 27 条钉死。这里只验**接得上**：
 *
 *   1. 已解锁的卡点开后，弹层里有「现在的记录」段与保存按钮，
 *      并且那一行真的是从**实时数据**算出来的（不是硬编码文案）；
 *   2. 未解锁的卡点开后没有保存按钮（不可保存时不该出现半个功能）；
 *   3. 点保存确实产出一个名为 `achievement-story-<id>.png` 的下载。
 *
 * 第 3 条最容易假绿：`exportStoryCard` 里任何一步抛错都会被
 * `saveStory` 吞成一句 message.error，而"按钮点了有反馈"本身看起来是对的。
 * 所以这里断言的是 **download 事件 + 文件名**，不是"按钮不报错"。
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

/**
 * 造一份"有一枚已解锁 + 一条已掌握进度"的最小数据。
 *
 * 进度行是关键：`related` 里的「掌握概况」只从 `progress` 算，
 * 不 seed 就永远是"还读不到关联的学习记录"，那测出来的只是空态。
 * 刻意**不 seed packages** —— 顺便验证"包缺失时少一行、但不报错"这条降级路径。
 */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB 被阻塞'))
    })
    const now = new Date().toISOString()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['settings', 'progress'], 'readwrite')
      const st = tx.objectStore('settings')
      st.put({
        key: 'profiles',
        value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: now }] },
      })
      st.put({
        key: 'achievements:default',
        value: [
          { id: 'first-step', unlockedAt: '2026-10-01', evidence: '已掌握 1 个知识点' },
          { id: 'ten-kp', unlockedAt: '2026-10-02', evidence: '已掌握 10 个知识点' },
        ],
      })
      const pr = tx.objectStore('progress')
      pr.put({
        profileId: 'default',
        packageId: 'unit-math',
        knowledgePointId: 'unit-math::kp0',
        status: '已掌握',
        correctCount: 6,
        wrongCount: 1,
        correctStreak: 5,
        wrongStreak: 0,
        // ★ 必须是"刚刚"，不能写死一个过去的日期：`loadUserData()` 会跑 `applyDecay`，
        //   已掌握超过 reviewDecayDays 没复习就被降成「需复习」—— 用固定日期种数据，
        //   跑测试的那天离它越远，这条进度就越会被判成未掌握（一个会随时间腐坏的种子）。
        lastStudiedAt: now,
        studySeconds: 120,
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

/** 图鉴页：先把「已获得」区展开，否则拿不到已解锁的卡 */
async function openAchievements(page: Page): Promise<void> {
  await page.goto('/achievements')
  await waitDbReady(page)
  const toggle = page.locator('.ach-head-toggle')
  if (await toggle.count()) {
    // 默认「已获得」收起；点一次「全部展开」把两组都摊开
    await toggle.first().click()
  }
}

test.describe('成就故事卡（V1.4 · B6）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)
  })

  test('已解锁：弹层里有现在的记录（实时算的）+ 保存按钮', async ({ page }) => {
    await openAchievements(page)

    await page.locator('.ach-card.earned', { hasText: '小试牛刀' }).click()

    const modal = page.locator('.ach-detail')
    await expect(modal).toBeVisible()

    // 解锁日期与证据在 rows 里（固化事实）
    await expect(modal).toContainText('解锁日期')
    await expect(modal).toContainText('2026-10-02')
    await expect(modal).toContainText('已掌握 10 个知识点')

    // 故事卡段：标题必须是「现在的记录」—— 它和上面两行不是同一个时间口径
    const story = modal.locator('.ach-detail__story')
    await expect(story).toBeVisible()
    await expect(story).toContainText('现在的记录')

    // 这一行来自 seed 的 progress（1 个已掌握、0 个学科信息）
    await expect(story.locator('.ach-detail__row').first()).toContainText('掌握概况')
    await expect(story).toContainText('已掌握 1 个知识点')

    await expect(story.getByRole('button', { name: '保存故事卡' })).toBeVisible()
  })

  test('保存故事卡产出 achievement-story-ten-kp.png', async ({ page }) => {
    await openAchievements(page)
    await page.locator('.ach-card.earned', { hasText: '小试牛刀' }).click()
    await expect(page.locator('.ach-detail__story')).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: '保存故事卡' }).click(),
    ])

    // 文件名用 id 而不是中文标题（见 storyFileName 的注释）
    expect(download.suggestedFilename()).toBe('achievement-story-ten-kp.png')
  })

  test('未解锁：没有故事卡段，也就没有保存按钮', async ({ page }) => {
    await openAchievements(page)

    // 「融会贯通」= fifty-kp，seed 里没解锁
    await page.locator('.ach-card:not(.earned)', { hasText: '融会贯通' }).click()
    await expect(page.locator('.ach-detail')).toBeVisible()

    await expect(page.locator('.ach-detail__story')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存故事卡' })).toHaveCount(0)
  })
})
