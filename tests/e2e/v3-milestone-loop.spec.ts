import { writeFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'

/**
 * V3.0 里程碑 · 主闭环（真机验证 / M5）
 * ------------------------------------------------------------------
 * 这是整个里程碑唯一一条**跨模块**的 e2e：把 M1（今日队列）、M3（结算）、
 * M4（导入 + 迁移自检）串成家长实际会走的一遍路径：
 *
 *   导入备份 → 今日页排出复习任务 → 做完 → 结算 → 家长页有数
 *
 * 为什么必须端到端跑一遍：每一段都有自己的单测（`daily-plan` 39 条 /
 * `adaptive` 27 条 / `migration-check` 13 条 / `auto-snapshot` 15 条），
 * 但"导入之后今日页会不会重排"这件事只发生在**两个模块的交界处** ——
 * 导入写库 → `invalidateDailyPlan()` → 今日页 `ensureDailyPlan()` 重算。
 * 任何一端改了接口，单测都不会红，家长看到的是"导入了但今天没任务"。
 *
 * 刻意不做的：不在 e2e 里点填空输入框之外的东西（题型渲染由 `learning-flow` 覆盖），
 * 也不断言具体分数（判分内核由 20+ 单测覆盖）。
 */

const DB_NAME = 'FamilyLearningDB'
const PKG_ID = 'pkg-v3-loop'
const PID = 'default'
const KP = 'kp-add'

const EXERCISES = [
  { id: 'ex-1', type: 'blank', question: '1+1=（____）', answer: '2', knowledgePointIds: [KP], metadata: { difficulty: '基础' } },
  { id: 'ex-2', type: 'blank', question: '2+2=（____）', answer: '4', knowledgePointIds: [KP], metadata: { difficulty: '基础' } },
  { id: 'ex-3', type: 'blank', question: '3+3=（____）', answer: '6', knowledgePointIds: [KP], metadata: { difficulty: '基础' } },
]

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
  // 首页主卡出现 = 库已就绪且 `ensureDailyPlan()` 跑过一轮（此时队列是空的）
  await expect(page.locator('.today-card')).toBeVisible({ timeout: 20_000 })
}

/**
 * 种一个最小学习包（**不种进度**）。
 *
 * 进度要靠导入进来，所以这里只放"教材"——这正是真实的换机场景：
 * 新设备先装包，再从备份里恢复学习记录。
 */
async function seedPackage(page: Page, exercises: unknown[]): Promise<void> {
  await page.evaluate(
    async ({ dbName, pkgId, exercises }) => {
      const pkg = {
        packageId: pkgId,
        manifest: {
          schemaVersion: '1.0',
          packageId: pkgId,
          packageType: 'unit',
          subject: 'math',
          templateId: 'math-default',
          grade: 4,
          term: 'up',
          title: 'V3 闭环包',
          dependencies: [],
        },
        knowledgePoints: [
          { id: 'kp-add', type: 'concept', title: '加法', content: '把两个数合起来', prerequisites: [], metadata: {} },
        ],
        exercises,
        units: [
          {
            id: 'u1',
            name: '第一单元',
            title: '第一单元',
            topics: [{ id: 't1', title: '加法练习', knowledgePointIds: ['kp-add'], modules: [], exercises }],
          },
        ],
      }

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['packages'], 'readwrite')
        tx.objectStore('packages').put(pkg)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { dbName: DB_NAME, pkgId: PKG_ID, exercises },
  )
  await page.reload()
  await expect(page.locator('.today-card')).toBeVisible({ timeout: 20_000 })
}

/** 读进度行（断言"真的写进库了"比只看 UI 数字更直接） */
async function readProgress(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const tx = db.transaction(['progress'], 'readonly')
      const req = tx.objectStore('progress').getAll()
      req.onsuccess = () => resolve((req.result as Array<Record<string, unknown>>) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rows
  }, DB_NAME)
}

/** /parent 第 n 张总览卡：0=知识点总数 1=已掌握 2=学习中 3=需复习 */
async function statValue(page: Page, index: number): Promise<number> {
  const text = await page.locator('.stat-card').nth(index).locator('.stat-card__value').innerText()
  const n = Number((text ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * 一份"另一台设备"的备份：只有一条**已到期**的复习进度。
 *
 * 手写 JSON 而不是走导出 UI：这条用例要验的是"导入之后会怎样"，
 * 导出链路已由 `backup-roundtrip.spec.ts` 用真实 download 覆盖过。
 */
function buildBackup(): string {
  const past = new Date(Date.now() - 3 * 86400000).toISOString()
  return JSON.stringify({
    formatVersion: 2,
    exportedAt: past,
    appVersion: 'e2e',
    activeProfileId: PID,
    profiles: [
      {
        profileId: PID,
        name: '老大',
        createdAt: '2024-01-01T00:00:00.000Z',
        progress: [
          {
            profileId: PID,
            packageId: PKG_ID,
            knowledgePointId: KP,
            status: '需复习',
            correctCount: 2,
            wrongCount: 1,
            correctStreak: 0,
            wrongStreak: 1,
            lastStudiedAt: past,
            studySeconds: 60,
            nextReviewAt: past,
            masteryProbability: 0.42,
          },
        ],
        mistakes: [],
        examSessions: [],
        // V3.0 · M4 起进契约；这里给一条真的，顺带验证它过了 routeBackup 与合并
        cardCompletions: [
          { profileId: PID, kind: 'unit', packageId: PKG_ID, targetId: 'u1', createdAt: past },
        ],
        settings: [],
      },
    ],
    globalSettings: [],
  })
}

test.describe('V3.0 主闭环', () => {
  test('导入 → 今日任务 → 做完 → 结算 → 家长页有数', async ({ page }, testInfo) => {
    // ---- 1. 新设备：清库 + 只装教材（没有学习记录）----
    await page.goto('/home')
    await resetDb(page)
    await seedPackage(page, EXERCISES)
    expect(await readProgress(page)).toHaveLength(0)

    // ---- 2. 导入一份别的设备的备份 ----
    const backupPath = testInfo.outputPath('v3-loop-backup.json')
    await writeFile(backupPath, buildBackup(), 'utf8')

    await page.goto('/settings')
    await page.locator('.import-pick input[type="file"]').setInputFiles(backupPath)
    await expect(page.locator('.import-ready')).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('.import-stat').filter({ hasText: '新增进度' }).locator('.import-stat-value'),
    ).toContainText('1')
    // M4：标记也要在预览里能看到（否则家长不知道它会不会过来）
    await expect(
      page.locator('.import-stat').filter({ hasText: '新增完成标记' }).locator('.import-stat-value'),
    ).toContainText('1')

    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('.import-preview')).toContainText('已导入', { timeout: 15_000 })

    // ---- 3. M4 迁移自检：五项里"少了"一项都不该出现 ----
    const check = page.locator('.migration-check')
    await expect(check).toBeVisible({ timeout: 10_000 })
    await expect(check).toContainText('数据自检通过')
    await expect(check.locator('.is-less')).toHaveCount(0)
    // 包那一项是 n/a（备份不含包），但仍然要摆出来让家长看到本机装了几个
    await expect(check.locator('.is-na')).toHaveCount(1)

    expect(await readProgress(page)).toHaveLength(1)

    // ---- 4. 今日页：导入后队列**必须自动重排**（本用例存在的主要理由）----
    await page.goto('/today')
    const first = page.locator('.item').first()
    await expect(first).toBeVisible({ timeout: 15_000 })
    await expect(first).toContainText('复习')
    await expect(first).toContainText('加法')

    // ---- 5. 做完（3 道填空）----
    await expect(page.locator('.head-actions button')).toContainText('开始今天的学习')
    await page.locator('.head-actions button').click()
    await expect(page).toHaveURL(/session=/)

    for (const [i, answer] of ['2', '4', '6'].entries()) {
      const input = page.getByPlaceholder('请输入你的答案...')
      await expect(input).toBeVisible()
      await input.fill(answer)
      await page.getByRole('button', { name: '提交答案' }).click()
      const last = i === 2
      await page
        .getByRole('button', { name: last ? '🏁 完成练习' : '下一题 ➡️' })
        .click()
    }

    // ---- 6. 结算：回今日页，队列项变绿，结算卡出现 ----
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 })
    await expect(page.locator('.head-title')).toContainText('全部完成')
    await expect(page.locator('.summary-grid')).toBeVisible()
    await expect(page.locator('.item').first()).toHaveClass(/done/)

    // 库里的账也真的记了（没有这一条，UI 全绿也可能是假的）
    const rows = await readProgress(page)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].correctCount)).toBeGreaterThan(2)
    expect(String(rows[0].lastStudiedAt ?? '')).not.toBe('')

    // ---- 7. 家长页：数字必须反映刚才那一次练习 ----
    await page.goto('/parent')
    await expect.poll(() => statValue(page, 0), { timeout: 15_000 }).toBe(1)
    const known = (await statValue(page, 1)) + (await statValue(page, 2)) + (await statValue(page, 3))
    expect(known, '家长页四项统计里至少有一项非零').toBeGreaterThan(0)
  })
})
