import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B4 · 家庭成就墙（真机验证）→ V1.6 · C7「去比较化」
 * ------------------------------------------------------------------
 * 单测守住了禁词与"按 pid 取值"的纯函数行为。这里验 **UI 上真的并排、且不串**：
 *   1. 两个档案各一列，列头是各自的名字（AC-P2-8 的可见面）；
 *   2. 老大有解锁记录、老二没有 → 两列内容**不同**。
 *      这条是墙的核心：`loadUnlocked(pid)` / `loadDailyStats` 任何一处漏传 pid，
 *      两列就会长得一模一样，而单测里 mock 的 db 无法证明"真实 IndexedDB 里也是分开的"。
 *   3. 页面文本里不出现比较级（禁词单测扫源码，这里扫**渲染结果** ——
 *      源码里的词可能来自另一个组件的插槽，静态扫描看不见）。
 * C7 起新增/调整的断言：
 *   4. 默认视野**不渲染数字**（`.wall-col-numbers` 隐藏），只有最近徽章 + 鼓励语；
 *   5. 点开各自列里的"查看数字"后才出现已解锁数 / 连续天数 / 掌握数 ——
 *      数字只在本列内，不排成跨孩子的一行。
 */

const DB_NAME = 'FamilyLearningDB'

async function waitDbReady(page: Page): Promise<void> {
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
    // 墙的加载是顺序 await（每列各几十枚定义），等列真的出来
    await expect(page.locator('.wall-col')).toHaveCount(2, { timeout: 20_000 })

    const first = page.locator('.wall-col').nth(0)
    const second = page.locator('.wall-col').nth(1)

    await expect(first.locator('.wall-col-name')).toHaveText('老大')
    await expect(second.locator('.wall-col-name')).toHaveText('老二')

    // C7：默认视野只有"最近解锁的徽章 + 中性鼓励语"，数字汇总是折叠的
    await expect(first.locator('.wall-col-encourage')).toBeVisible()
    await expect(first.locator('.wall-col-numbers')).toBeHidden()

    // 老大：2 枚已解锁 → 默认视图就是这 2 枚（且不超过 3 枚的最近集）
    await expect(first.locator('.wall-chip')).toHaveCount(2)
    await expect(first.locator('.wall-chip').first()).toBeVisible()

    // 老二：0 枚 → 引导态，不是"零分成绩单"
    await expect(second).toContainText('还没有解锁成就')
    await expect(second.locator('.wall-chip')).toHaveCount(0)

    // 反过来：老大那列不能出现"还没有解锁成就"（串数据的另一面）
    await expect(first).not.toContainText('还没有解锁成就')

    // 按需展开：数字只在本列内出现（各点各的，不排成跨孩子的一行）
    await first.locator('.wall-col-summary').click()
    await second.locator('.wall-col-summary').click()
    // 分母是**可收集** 27 枚（night-owl 不参与收集，V1.6 · C6）
    await expect(first.locator('.wall-col-count')).toContainText('已获得 2 / 37')
    await expect(second.locator('.wall-col-count')).toContainText('已获得 0 / 37')
    // 展开后是三项：已解锁数 / 连续天数 / 掌握数
    await expect(first.locator('.wall-col-num')).toHaveCount(2)
    await expect(first.locator('.wall-col-numbers')).toContainText('已掌握')
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

    // C7：默认视野里的鼓励语是叙事，不含任何数字（"又解锁 2 枚"这种不行）
    for (const col of await page.locator('.wall-col').all()) {
      const line = (await col.locator('.wall-col-encourage').innerText()) ?? ''
      expect(line.trim().length, '鼓励语为空').toBeGreaterThan(0)
      expect(line, `鼓励语里出现了数字：「${line}」`).not.toMatch(/\d/)
    }
  })
})
