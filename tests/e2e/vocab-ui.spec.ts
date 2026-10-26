import { test, expect, type Page } from '@playwright/test'

/**
 * V2.6 · 任务1 · 词汇表交互回归
 * =====================================================================
 * 断言：
 *   1. 进入词汇主题，第一屏（不滚动）就能看到「开始背记」。
 *   2. 「查看全部 N 个词语」折叠面板默认收起；点开后词条出现。
 *   3. 顶部「词语表」下拉可切换单元，词条随切换刷新。
 *
 * 种子包刻意复刻真实词汇包的关键形态：
 *   unit.knowledgePointIds = []（空），词挂在 unit.topics[].modules[].knowledgePointIds。
 * 这正是旧代码切换失效的根因，回归它可防止再次退化。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const PKG = 'vocab-ui-test'

function kp(id: string, word: string, pinyin: string) {
  return {
    id,
    title: word,
    type: 'word',
    metadata: { word, pinyin },
    content: `${word}的释义`,
  }
}

function unit(id: string, topicId: string, title: string, kpIds: string[]) {
  return {
    id,
    title,
    knowledgePointIds: [], // ← 真实词汇包就是这个形态（空），词在 module 里
    topics: [
      {
        id: topicId,
        title,
        knowledgePointIds: kpIds,
        modules: [{ type: 'chinese.words', knowledgePointIds: kpIds }],
      },
    ],
  }
}

function buildSeed() {
  return {
    packages: [
      {
        packageId: PKG,
        manifest: {
          schemaVersion: '1.0',
          packageId: PKG,
          type: 'special',
          subject: 'chinese',
          grade: 4,
          term: 'up',
          edition: '人教版',
          title: '词汇交互测试包',
        },
        knowledgePoints: [
          kp('w1', '奇观', 'qí guān'),
          kp('w2', '据说', 'jù shuō'),
          kp('w3', '浩浩荡荡', 'hào hào dàng dàng'),
          kp('w5', '霎时', 'shà shí'),
          kp('w6', '犹如', 'yóu rú'),
          kp('w7', '屹立', 'yì lì'),
        ],
        exercises: [],
        units: [
          unit('u1', 't1', '词语表 1', ['w1', 'w2', 'w3']),
          unit('u2', 't2', '词语表 2', ['w5', 'w6']),
          unit('u3', 't3', '词语表 3', ['w7']),
        ],
      },
    ],
    progress: [],
  }
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

async function seedAll(page: Page, seed: ReturnType<typeof buildSeed>): Promise<void> {
  await page.evaluate(
    async ({ dbName, packages, profileId, createdAt }) => {
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
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        for (const pkg of packages) tx.objectStore('packages').put(pkg)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
    {
      dbName: DB_NAME,
      packages: seed.packages,
      profileId: PROFILE_ID,
      createdAt: '2025-03-01T00:00:00.000Z',
    },
  )
}

test('词汇主题：开始背记第一屏可见 + 明细折叠 + 词语表切换', async ({ page }) => {
  await page.goto('/')
  await resetDb(page)
  await seedAll(page, buildSeed())
  await page.goto(`/learn/${PKG}/unit/u1/topic/t1`)

  // 1. 「开始背记」无需滚动即可见
  const startBtn = page.getByRole('button', { name: /开始背记/ })
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toBeInViewport()

  // 2. 词语明细默认收起（details 未 open → 词条不可见）
  const firstWord = page.locator('.words-details .word-item').first()
  await expect(firstWord).toBeHidden()

  // 展开后可见，且为 u1 的 3 个词
  await page.locator('.words-summary').click()
  await expect(firstWord).toBeVisible()
  await expect(page.locator('.words-details .word-item')).toHaveCount(3)

  // 3. 切换词语表 → 词条刷新为 u2 的 2 个词
  await page.locator('#vocab-unit-select').selectOption('u2')
  await expect(page.locator('.words-details .word-item')).toHaveCount(2)
  await expect(page.getByText('霎时', { exact: true })).toBeVisible()

  // 「开始背记」仍在（切换不打断首屏入口）
  await expect(startBtn).toBeInViewport()
})
