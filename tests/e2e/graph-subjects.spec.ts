// V2.9 · 技能树回归：多学科包 → 学科切换 chips + 高度自适应 + 虚拟根完整渲染。
// 场景：math + english 两个学科包 → chips 出现、点击切换、canvas 重渲染、零页面错误。
// 背景：echarts tree 对多根 data 只画第一棵树（用户报「只显示一个学科」），
//       且 notMerge 替换 data 会抛 __edge null —— 修复为虚拟根 + clear 后重设。
import { test, expect, type Page } from '@playwright/test'

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'

function buildMultiSeed(): { packages: Array<Record<string, unknown>>; progress: Array<Record<string, unknown>> } {
  const kp = (id: string, title: string) => ({ id, type: 'concept', title, content: '' })
  return {
    packages: [
      {
        packageId: 'tmp-graph-math',
        manifest: { schemaVersion: '1.0', packageId: 'tmp-graph-math', type: 'unit', subject: 'math', grade: 4, term: 'up', edition: '人教版', title: '数学包', examMode: false },
        knowledgePoints: Array.from({ length: 14 }, (_, i) => kp(`tmp-graph-math::m${i + 1}`, `数学知识点${i + 1}`)),
        exercises: [],
        units: [
          { id: 'u1', title: '上单元', topics: [{ id: 'u1t1', title: '上半', knowledgePointIds: Array.from({ length: 7 }, (_, i) => `tmp-graph-math::m${i + 1}`), exercises: [] }] },
          { id: 'u2', title: '下单元', topics: [{ id: 'u2t1', title: '下半', knowledgePointIds: Array.from({ length: 7 }, (_, i) => `tmp-graph-math::m${i + 8}`), exercises: [] }] },
        ],
      },
      {
        packageId: 'tmp-graph-eng',
        manifest: { schemaVersion: '1.0', packageId: 'tmp-graph-eng', type: 'unit', subject: 'english', grade: 4, term: 'up', edition: '人教版', title: '英语包', examMode: false },
        knowledgePoints: Array.from({ length: 10 }, (_, i) => kp(`tmp-graph-eng::e${i + 1}`, `单词${i + 1}`)),
        exercises: [],
        units: [
          { id: 'ue1', title: '水果单词', topics: [{ id: 'ue1t1', title: '水果', knowledgePointIds: Array.from({ length: 10 }, (_, i) => `tmp-graph-eng::e${i + 1}`), exercises: [] }] },
        ],
      },
    ],
    progress: [
      { profileId: PROFILE_ID, packageId: 'tmp-graph-math', knowledgePointId: 'tmp-graph-math::m1', status: '已掌握', wrongCount: 0, lastStudiedAt: '2025-01-10T09:00:00' },
      { profileId: PROFILE_ID, packageId: 'tmp-graph-math', knowledgePointId: 'tmp-graph-math::m2', status: '学习中', wrongCount: 2, lastStudiedAt: '2025-01-11T09:00:00' },
      { profileId: PROFILE_ID, packageId: 'tmp-graph-eng', knowledgePointId: 'tmp-graph-eng::e1', status: '已掌握', wrongCount: 0, lastStudiedAt: '2025-01-12T09:00:00' },
    ],
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

async function seedAll(page: Page, seed: ReturnType<typeof buildMultiSeed>): Promise<void> {
  await page.evaluate(
    async ({ dbName, packages, progress, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      const tx = db.transaction(['packages', 'progress'], 'readwrite')
      const pkgStore = tx.objectStore('packages')
      for (const p of packages) pkgStore.put({ ...(p as object), createdAt } as never)
      const progStore = tx.objectStore('progress')
      let id = 1
      for (const r of progress) progStore.put({ ...(r as object), id: id++ } as never)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { dbName: DB_NAME, packages: seed.packages, progress: seed.progress, profileId: PROFILE_ID, createdAt: '2025-01-10T00:00:00' },
  )
  await page.reload()
}

test('技能树 · 学科切换 + 高度自适应', async ({ page }) => {
  await page.goto('/home')
  await resetDb(page)
  await seedAll(page, buildMultiSeed())

  await page.goto('/graph')
  await expect(page.locator('.graph-chart canvas').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.graph-legend')).toBeVisible()

  // 多学科 → chips 出现：全部 / 数学 / 英语
  const chips = page.locator('.graph-subjects .subject-chip')
  await expect(chips).toHaveCount(3)
  await expect(chips.filter({ hasText: '全部' })).toBeVisible()
  await expect(chips.filter({ hasText: '数学' })).toBeVisible()
  await expect(chips.filter({ hasText: '英语' })).toBeVisible()
  await expect(chips.first()).toHaveClass(/active/) // 默认「全部」

  // 「全部」视图高度应大于单科（叶子 7 > 3）
  const allH = await page.locator('.graph-chart').evaluate((el) => el.getBoundingClientRect().height)
  await page.screenshot({ path: 'docs/screenshots/graph-subjects-all.png', fullPage: true })

  // 抓页面错误（回归 __edge null 崩溃：切换重绘必须零错误）
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`error: ${m.text()}`) })

  // 切到英语 → chip 高亮、canvas 仍在
  await chips.filter({ hasText: '英语' }).click()
  await expect(chips.filter({ hasText: '英语' })).toHaveClass(/active/)
  await page.waitForTimeout(800) // 等 watchEffect → setOption 完成重绘
  await expect(page.locator('.graph-chart canvas').first()).toBeVisible()
  const engH = await page.locator('.graph-chart').evaluate((el) => el.getBoundingClientRect().height)
  await page.screenshot({ path: 'docs/screenshots/graph-subjects-eng.png', fullPage: true })

  // 高度自适应：全部 > 英语
  expect(allH).toBeGreaterThan(engH)
  expect(errors).toEqual([]) // __edge 崩溃回归锁
  await page.screenshot({ path: 'docs/screenshots/graph-subjects.png', fullPage: true })
  console.log('GRAPH_SWITCH_OK allH=', allH, 'engH=', engH)
})
