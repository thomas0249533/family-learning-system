import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B1 · 档案隔离（真机验证）
 * ------------------------------------------------------------------
 * 单测已经把"键分片、迁移计划、合并规则"这类纯逻辑穷举过了，
 * 这里只验**单测结构上验不了的三件事**：
 *   1. 两个档案的数据在真 IndexedDB + 真 UI 上确实互不可见（不是靠 mock 假装的）；
 *   2. 切换档案后页面上的数字**当场**变（不刷新也能变），否则用户会以为切失败了；
 *   3. 档案上限 4 与"最后一个不可删"在**按钮层**就拦住，而不是点下去才报错。
 */

/** 等库真的就绪再种数据（裸开 IDB 抢在 Dexie 之前会造空库，V1.3 已踩过） */
async function waitDbReady(page: Page): Promise<void> {
  await page.locator('.hall-head-count, .ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
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

interface SeedOptions {
  /** 是否额外写入第二个档案 */
  withSecondProfile?: boolean
  /** 是否给 default 档案种 1 条"已掌握"进度 */
  withProgress?: boolean
}

/** 种子：一个学习包（1 个知识点）+ 可选进度行 + 可选第二个档案 */
async function seed(page: Page, opts: SeedOptions = {}): Promise<void> {
  const { withSecondProfile = true, withProgress = true } = opts
  await page.evaluate(
    async ({ withSecondProfile, withProgress }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('FamilyLearningDB')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        // 没挂 onblocked 会静默挂到超时
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      const now = new Date().toISOString()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['packages', 'progress', 'settings'], 'readwrite')

        tx.objectStore('packages').put({
          packageId: 'unit-iso-e2e',
          manifest: {
            packageId: 'unit-iso-e2e',
            type: 'unit',
            subject: 'math',
            grade: 4,
            term: 'up',
            title: '档案隔离测试单元',
          },
          knowledgePoints: [{ id: 'unit-iso-e2e::kp1', title: '三位数乘两位数' }],
          exercises: [],
          units: [],
        })

        if (withProgress) {
          tx.objectStore('progress').put({
            profileId: 'default',
            packageId: 'unit-iso-e2e',
            knowledgePointId: 'unit-iso-e2e::kp1',
            status: '已掌握',
            correctCount: 2,
            wrongCount: 0,
            correctStreak: 2,
            wrongStreak: 0,
            lastStudiedAt: now,
            studySeconds: 30,
          })
        }

        if (withSecondProfile) {
          tx.objectStore('settings').put({
            key: 'profiles',
            value: {
              activeId: 'default',
              list: [
                { id: 'default', name: '我', createdAt: now },
                { id: 'p_iso_sister', name: '妹妹', createdAt: now },
              ],
            },
          })
        }

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { withSecondProfile, withProgress }
  )
  await page.reload()
}

/** 读 /parent 第 n 张总览卡的数字（0=知识点总数 1=已掌握 2=学习中 3=需复习） */
async function statValue(page: Page, index: number): Promise<string> {
  const card = page.locator('.stat-card').nth(index)
  return ((await card.locator('.stat-card__value').innerText()) ?? '').trim()
}

/** 打开档案下拉并选一个名字 */
async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('.profile-chip').click()
  await page.locator('.n-dropdown-option', { hasText: name }).first().click()
}

test.describe('档案隔离（V1.4 · B1）', () => {
  test('两个档案的进度互不可见，切换后数字当场变', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)

    // 有 2 个档案时切换器才出现（单娃家庭不该看到"档案"这个概念）
    await expect(page.locator('.profile-chip')).toBeVisible()
    await expect(page.locator('.profile-chip')).toContainText('我')

    // default 档案：1 个知识点已掌握
    await page.goto('/parent')
    await expect.poll(() => statValue(page, 1), { timeout: 10_000 }).toBe('1')

    // 切到妹妹：什么都没学过 → 已掌握 0
    await switchTo(page, '妹妹')
    await expect(page.locator('.profile-chip')).toContainText('妹妹')
    // 不刷新页面，数字必须立刻变（switchProfileAndReload 里重读了 userData）
    await expect.poll(() => statValue(page, 1), { timeout: 10_000 }).toBe('0')

    // 切回来：数据还在（不是"切一次丢一次"）
    await switchTo(page, '我')
    await expect.poll(() => statValue(page, 1), { timeout: 10_000 }).toBe('1')
  })

  test('只有一个档案时不显示切换器，且删除按钮被禁用', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page, { withSecondProfile: false, withProgress: false })

    await expect(page.locator('.profile-chip')).toHaveCount(0)

    await page.goto('/parent')
    await expect(page.locator('.profile-row')).toHaveCount(1)
    // 删到 0 会让 currentProfileId 指向不存在的档案 → 按钮层就要拦住
    await expect(page.locator('.profile-btn--danger')).toBeDisabled()
  })

  test('档案上限 4：建到第 4 个后按钮禁用', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page, { withSecondProfile: false, withProgress: false })

    await page.goto('/parent')
    await expect(page.locator('.profile-row')).toHaveCount(1)

    // 现有 1 个，再建 3 个 → 4 / 4
    for (const name of ['老二', '老三', '老四']) {
      await page.getByRole('button', { name: /新建档案/ }).click()
      await page.locator('[aria-label="新档案名字"]').fill(name)
      await page.getByRole('button', { name: '创建' }).click()
      await expect(page.locator('.profile-row').filter({ hasText: name })).toHaveCount(1)
    }

    await expect(page.getByRole('button', { name: /新建档案（4 \/ 4）/ })).toBeDisabled()
    await expect(page.locator('.profile-row')).toHaveCount(4)
  })
})
