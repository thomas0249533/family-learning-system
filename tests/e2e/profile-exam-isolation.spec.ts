import { test, expect, type Page } from '@playwright/test'

/**
 * V1.6 · Stage A · A5 · 模考历史的档案隔离（真机验证）
 * ------------------------------------------------------------------
 * `exam.ts` 的注释里写着："不分片的话老二在模考页能看到老大的历史成绩 ——
 * 而成绩是最容易被拿来比较的东西，与『不做排行』的产品红线直接冲突。"
 * v4 给表加了 `profileId`、查询也都带了，但有一处**单测结构上验不了**的窗口：
 *
 *   `examStore.sessions` 是 store 级缓存，只在 ExamPanel `onMounted` 时读一次。
 *   档案切换（AppShell 顶栏，任何页面都在）**不重新路由**，页面不重挂载，
 *   于是"停在模考页 → 切到妹妹"之后，历史列表还显示着老大的卷子和分数。
 *
 * 这条用例就是堵这个窗口的：切过去必须当场变空，切回来必须还在。
 */

const PKG = 'unit-exam-iso-e2e'

/** 等库就绪（裸开 IDB 抢在 Dexie 之前会造空库，V1.3 已踩过） */
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

/** 种子：一个 examMode 包 + default 档案的一条已交卷模考 + 第二个档案 */
async function seed(page: Page): Promise<void> {
  await page.evaluate(
    async (packageId: string) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('FamilyLearningDB')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      const now = new Date().toISOString()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['packages', 'examSessions', 'settings'], 'readwrite')

        tx.objectStore('packages').put({
          packageId,
          manifest: {
            packageId,
            type: 'unit',
            subject: 'math',
            grade: 4,
            term: 'up',
            title: '模考隔离测试包',
            examMode: true,
          },
          knowledgePoints: [{ id: `${packageId}::kp1`, title: '测试知识点' }],
          exercises: [
            { id: 'q1', type: 'single', question: '1+1=?', answer: 'A', options: ['A. 2', 'B. 3'] },
            { id: 'q2', type: 'single', question: '2+2=?', answer: 'A', options: ['A. 4', 'B. 5'] },
          ],
          units: [],
        })

        tx.objectStore('examSessions').put({
          profileId: 'default',
          packageId,
          sessionIndex: 1,
          questionIds: ['q1', 'q2'],
          answers: { q1: { userAnswer: 'A', isCorrect: true }, q2: { userAnswer: 'B', isCorrect: false } },
          currentIndex: 2,
          elapsedSeconds: 90,
          totalCount: 2,
          timeLimit: 0,
          startedAt: now,
          status: 'finished',
          finishedAt: now,
          finalCorrect: 1,
          finalRate: 50,
        })

        tx.objectStore('settings').put({
          key: 'profiles',
          value: {
            activeId: 'default',
            list: [
              { id: 'default', name: '我', createdAt: now },
              { id: 'p_exam_sister', name: '妹妹', createdAt: now },
            ],
          },
        })

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    PKG
  )
  await page.reload()
}

async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('.profile-chip').click()
  await page.locator('.n-dropdown-option', { hasText: name }).first().click()
}

test.describe('模考历史 · 档案隔离（V1.6 · A5）', () => {
  test('停在模考页切档案：老大的历史成绩不许跟着出现在妹妹眼前', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)

    // 进模考页（examMode 包 → UnitList 直接渲染 ExamPanel）
    await page.goto(`/learn/${PKG}`)
    await expect(page.locator('.session-history')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.history-title')).toContainText('历史会话（1）')
    await expect(page.locator('.history-item')).toHaveCount(1)
    // 老大的成绩：2 题对 1 → 50%
    await expect(page.locator('.history-rate')).toHaveText('50%')
    await expect(page.locator('.history-index')).toHaveText('第 1 卷')

    // ---- 切到妹妹：历史必须当场变空（不刷新页面）----
    await switchTo(page, '妹妹')
    await expect(page.locator('.profile-chip')).toContainText('妹妹')
    // 组合条件：面板还在（不是页面挂了造成的空）且历史为空。
    // 只写 `toHaveCount(0)` 会**假绿** —— 会话是异步加载的，第一次轮询时
    // 列表本来就还没渲染出来（V1.6 · A5 实测踩到过，必须配就绪信号）。
    await expect
      .poll(
        async () => {
          const ready = await page.getByRole('button', { name: /开始新会话/ }).isVisible()
          const hasHistory = (await page.locator('.session-history').count()) > 0
          return ready && !hasHistory
        },
        { timeout: 10_000 }
      )
      .toBe(true)
    // 也没有"继续上次"——那是老大的未完成会话
    await expect(page.getByRole('button', { name: /继续上次/ })).toHaveCount(0)

    // ---- 切回来：数据还在（不是"切一次丢一次"）----
    await switchTo(page, '我')
    await expect(page.locator('.profile-chip')).toContainText('我')
    await expect(page.locator('.history-title')).toContainText('历史会话（1）', { timeout: 10_000 })
    await expect(page.locator('.history-rate')).toHaveText('50%')
  })

  test('直接以妹妹身份进模考页：看不到 default 的任何会话', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)

    await switchTo(page, '妹妹')
    // 必须等切换**落盘**再跳页：切档案是异步的（结算成就 + 重读 userData），
    // 芯片文字变了才代表 persist 完成。少了这一行，跳过去时应用可能还是
    // "我" —— 断言绿得没有任何意义（V1.6 · A5 实测踩到过）。
    await expect(page.locator('.profile-chip')).toContainText('妹妹')
    await page.goto(`/learn/${PKG}`)
    // 同上：面板就绪 + 历史为空，两个条件一起轮询
    await expect
      .poll(
        async () => {
          const ready = await page.getByRole('button', { name: /开始新会话/ }).isVisible()
          const hasHistory = (await page.locator('.session-history').count()) > 0
          return ready && !hasHistory
        },
        { timeout: 20_000 }
      )
      .toBe(true)
  })
})
