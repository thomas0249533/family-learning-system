import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B4 · 家庭成就墙（真机验证）
 * ------------------------------------------------------------------
 * 单测守住了禁词与"按 pid 取值"的纯函数行为。这里验 **UI 上真的并排、且不串**：
 *   1. 两个档案各一列，列头是各自的名字（AC-P2-8 的可见面）；
 *   2. 老大有解锁记录、老二没有 → 两列内容**不同**。
 *      这条是墙的核心：`loadUnlocked(pid)` / `loadDailyStats` 任何一处漏传 pid，
 *      两列就会长得一模一样，而单测里 mock 的 db 无法证明"真实 IndexedDB 里也是分开的"。
 *   3. 页面文本里不出现比较级（禁词单测扫源码，这里扫**渲染结果** ——
 *      源码里的词可能来自另一个组件的插槽，静态扫描看不见）。
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

interface SeedOptions {
  profiles: Array<{ id: string; name: string }>
  activeId: string
  /** 每个档案各自的已解锁记录（`achievements:<pid>`） */
  unlocked?: Record<string, Array<{ id: string; unlockedAt: string }>>
  /** 每个档案各自今日题量（`dailyStats:<pid>`） */
  daily?: Record<string, number>
}

async function seed(page: Page, opts: SeedOptions): Promise<void> {
  await page.evaluate(
    async ({ dbName, opts }) => {
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
          value: {
            activeId: opts.activeId,
            list: opts.profiles.map((p) => ({ ...p, createdAt: now })),
          },
        })
        for (const [pid, records] of Object.entries(opts.unlocked ?? {})) {
          st.put({ key: `achievements:${pid}`, value: records })
        }
        for (const [pid, count] of Object.entries(opts.daily ?? {})) {
          st.put({
            key: `dailyStats:${pid}`,
            value: [
              {
                date: now.slice(0, 10),
                questionCount: count,
                firstStudyAt: now,
                lastStudyAt: now,
              },
            ],
          })
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, opts }
  )
  await page.reload()
}

test.describe('家庭成就墙（V1.4 · B4）', () => {
  test('两个档案并排，各看各的（不串数据）', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)

    await seed(page, {
      profiles: [
        { id: 'a', name: '老大' },
        { id: 'b', name: '老二' },
      ],
      activeId: 'a',
      unlocked: {
        a: [
          { id: 'first-step', unlockedAt: '2026-10-01' },
          { id: 'ten-kp', unlockedAt: '2026-10-02' },
        ],
      },
      // 只有老大今天有题量：用来证明 dailyStats 也是按档案取的
      daily: { a: 12 },
    })

    await page.goto('/family-wall')
    // 墙的加载是顺序 await（4 列各 28 枚），等列真的出来
    await expect(page.locator('.wall-col')).toHaveCount(2, { timeout: 20_000 })

    const first = page.locator('.wall-col').nth(0)
    const second = page.locator('.wall-col').nth(1)

    await expect(first.locator('.wall-col-name')).toHaveText('老大')
    await expect(second.locator('.wall-col-name')).toHaveText('老二')

    // 老大：已获得 2 / 28，且列表里有真实格子
    await expect(first.locator('.wall-col-count')).toContainText('已获得 2 / 28')
    await expect(first.locator('.wall-chip').first()).toBeVisible()

    // 老二：0 枚 → 引导态，不是"零分成绩单"
    await expect(second.locator('.wall-col-count')).toContainText('已获得 0 / 28')
    await expect(second).toContainText('还没有解锁成就')
    await expect(second.locator('.wall-chip')).toHaveCount(0)

    // 反过来：老大那列不能出现"还没有解锁成就"（串数据的另一面）
    await expect(first).not.toContainText('还没有解锁成就')
  })

  test('渲染结果里没有比较级用词（AC-P2-8 的可见面）', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page, {
      profiles: [
        { id: 'a', name: '老大' },
        { id: 'b', name: '老二' },
      ],
      activeId: 'a',
      unlocked: { a: [{ id: 'first-step', unlockedAt: '2026-10-01' }] },
    })

    await page.goto('/family-wall')
    await expect(page.locator('.wall-col')).toHaveCount(2, { timeout: 20_000 })

    const text = (await page.locator('.family-wall').innerText()) ?? ''
    for (const word of ['排名', '第 1 名', '第一名', '领先', '落后', '最高分', '完成率', '总分', '%']) {
      expect(text, `渲染结果里出现了「${word}」`).not.toContain(word)
    }
  })
})
