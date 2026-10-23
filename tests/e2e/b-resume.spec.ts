import { test, expect, type Page } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * V2.0 · 断点续传 + 答题卡（B 线端到端）
 * =====================================================================
 * 断言链：播种一个 20 题的专题包 → 进专题页答 10 题 → `page.reload()` →
 * 弹「检测到上次未完成的练习，当前进度 10 / 20」→ 点「继续」→ 停在第 11 题
 * → 答题卡里 10 对 / 10 未做。
 *
 * 为什么必须 reload：断点续传的价值全在"没有 graceful unmount"这条路径上。
 * QuizEngine 卸载时会补发一次 `save-progress`，只测"点返回再进来"会**绕过**
 * 去抖落库这一环 —— 那正是最容易写错的地方（去抖没触发、upsert 写成 add、
 * 复合索引少传 profileId 都会在这一步暴露）。
 *
 * 播种 / 主题冻结 / 清库姿势照抄 g1-graph-visual.spec.ts、g3-share-visual.spec.ts：
 *   - `addInitScript` 预置 `localStorage['fls:theme']` + 冻结时钟（首帧即目标主题）；
 *   - 清 IndexedDB 必须在 `goto` **之后**（先让应用把 schema 建到 v5，
 *     否则裸 `indexedDB.open(name)` 会建出一个没有 objectStore 的空库）；
 *   - 图片走 `page.screenshot()`，不用 `toHaveScreenshot()`。
 *
 * 确定性：
 *   1. 播种数据全字面量，无随机、无网络；
 *   2. 截图点在**续传弹窗**上 —— 此时练习区还没挂载，页面上没有计时器，
 *      所以不会出现"两次跑差 1 秒"的像素差；
 *   3. 题目 `knowledgePointIds` 为空 → 不写 progress / 错题本 → 不触发成就 toast
 *      （toast 是 fixed 浮层，出现与否取决于真实计时器，会毁掉基线）。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

const PKG = 'b-resume'
const TOTAL = 20
const ANSWERED = 10

function buildSeed(): {
  packages: Array<Record<string, unknown>>
  progress: Array<Record<string, unknown>>
} {
  const exercises = Array.from({ length: TOTAL }, (_, i) => ({
    id: `${PKG}::q${i + 1}`,
    type: 'single',
    question: `第 ${i + 1} 题：${i + 1} + 1 = ?`,
    options: ['A. 正确选项', 'B. 干扰项一', 'C. 干扰项二', 'D. 干扰项三'],
    answer: 'A',
    explanation: `第 ${i + 1} 题的解析`,
    // 刻意留空：本 spec 只测断点，不喂掌握度/错题本（见文件头"确定性"第 3 条）
    knowledgePointIds: [],
  }))

  return {
    packages: [
      {
        packageId: PKG,
        manifest: {
          schemaVersion: '1.0',
          packageId: PKG,
          type: 'unit',
          subject: 'math',
          grade: 4,
          term: 'up',
          edition: '人教版',
          title: 'B 线 · 断点续传包',
          examMode: false,
        },
        knowledgePoints: [],
        exercises: [],
        units: [
          {
            id: 'u1',
            title: '单元一',
            topics: [
              {
                id: 't1',
                title: '断点续传专题',
                knowledgePointIds: [],
                exercises,
              },
            ],
          },
        ],
      },
    ],
    progress: [],
  }
}

async function installDeterminismHooks(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    (cfg: { mode: string; fixedNow: number }) => {
      const { mode: m, fixedNow } = cfg

      const RealDate = Date
      const FrozenDate: any = function (...args: any[]) {
        if (args.length === 0) return new RealDate(fixedNow)
        // @ts-expect-error 透传参数
        return new RealDate(...args)
      }
      FrozenDate.now = () => fixedNow
      FrozenDate.parse = RealDate.parse
      FrozenDate.UTC = RealDate.UTC
      FrozenDate.prototype = RealDate.prototype
      ;(window as any).Date = FrozenDate

      localStorage.setItem(
        'fls:theme',
        JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false })
      )
    },
    { mode, fixedNow: FIXED_NOW }
  )
}

/** `.ach-head-count` 可见 = Dexie 已把 schema 建好（照抄 g1 / g3） */
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

async function seedAll(page: Page, seed: ReturnType<typeof buildSeed>): Promise<void> {
  await page.evaluate(
    async ({ dbName, packages, progress, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'progress'], 'readwrite')
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        for (const pkg of packages) tx.objectStore('packages').put(pkg)
        for (const row of progress) tx.objectStore('progress').put(row)
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
      progress: seed.progress,
      profileId: PROFILE_ID,
      createdAt: PROFILE_CREATED_AT,
    }
  )
}

const TOPIC_URL = `/learn/${PKG}/unit/u1/topic/t1`

/** 老老实实答一题：选项 A → 提交 → 下一题（走真实按钮，不注入事件） */
async function answerOne(page: Page, index: number): Promise<void> {
  await expect(page.locator('.progress-text').first()).toContainText(`第 ${index} / ${TOTAL} 题`)
  await page.locator('.opt-item').filter({ hasText: 'A.' }).first().click()

  const action = page.locator('.quiz-actions button').first()
  await action.click()
  await expect(page.locator('.feedback-box')).toBeVisible()
  await action.click()
}

for (const mode of ['light', 'dark'] as const) {
  test(`topic-resume-${mode}`, async ({ page }) => {
    await installDeterminismHooks(page, mode)

    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedAll(page, buildSeed())

    await page.goto(TOPIC_URL)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.quiz-engine').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.progress-text').first()).toContainText(`第 1 / ${TOTAL} 题`)

    for (let i = 1; i <= ANSWERED; i++) await answerOne(page, i)
    await expect(page.locator('.progress-text').first()).toContainText(
      `第 ${ANSWERED + 1} / ${TOTAL} 题`
    )

    // 去抖 ≥800ms 才落库；reload 不会有 graceful unmount，所以必须等它真的写完
    await page.waitForTimeout(1500)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // ---- 续传弹窗（截图点：此时练习区未挂载 → 没有计时器 → 像素确定）----
    const tip = page.locator('.resume-tip')
    await expect(tip).toBeVisible({ timeout: 20_000 })
    await expect(tip).toContainText('检测到上次未完成的练习')
    await expect(page.locator('.resume-progress')).toContainText(`${ANSWERED} / ${TOTAL}`)
    // 弹窗期间不该先渲染练习区（否则孩子可能边答边被弹窗盖住）
    await expect(page.locator('.quiz-engine')).toHaveCount(0)

    await page.waitForTimeout(600)
    await freezeSmil(page)
    await page.screenshot({
      path: `docs/screenshots/topic-resume-${mode}.png`,
      fullPage: true,
      animations: 'disabled',
    })

    // ---- 点「继续」→ 停在第 11 题 ----
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(page.locator('.quiz-engine').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.progress-text').first()).toContainText(
      `第 ${ANSWERED + 1} / ${TOTAL} 题`
    )

    // ---- 答题卡：10 对 / 0 错 / 10 未做 ----
    await page.locator('.sheet-btn').first().click()
    await expect(page.locator('.sheet-grid')).toBeVisible()
    await expect(page.locator('.sheet-cell.is-correct')).toHaveCount(ANSWERED)
    await expect(page.locator('.sheet-cell.is-wrong')).toHaveCount(0)
    await expect(page.locator('.sheet-cell.is-todo')).toHaveCount(TOTAL - ANSWERED)

    // 点已作答的第 1 题 → 回看解析（只读，不重复判分）
    await page.locator('.sheet-cell').first().click()
    await expect(page.locator('.feedback-box')).toBeVisible()
    await expect(page.locator('.progress-text').first()).toContainText(`第 1 / ${TOTAL} 题`)
  })
}
