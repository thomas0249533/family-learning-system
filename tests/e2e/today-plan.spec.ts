import { test, expect, type Page } from '@playwright/test'

/**
 * V3.0 · M1 · 今日任务闭环（真机验证）
 * ------------------------------------------------------------------
 * 单测（`tests/daily-plan.test.ts`，39 条）钉死了编排规则；这里只验**单测验不了的**：
 *
 *   1. **只有一个入口**：首页主卡是「今天的学习」，点进去是今日页（不是三个并列列表）；
 *   2. **队列真的来源于库里的进度**：种一条到期的复习进度 → 今日页出现 1 项复习任务；
 *   3. **点任务能进到答题**：跳转带上 `session` 与 `limit`，主题页练习区正常渲染；
 *   4. **口径可切**：按题量 / 按时长切换不重排队列（已完成项不能被清空）。
 *
 * 刻意**不在 e2e 里答题**：答题链路由 QuizEngine / 判分 20+ 个单测覆盖，
 * 在 e2e 里点填空输入框只会让这条用例跟着输入框样式一起碎。
 */

const PKG_ID = 'pkg-e2e-today'
const PID = 'default'

/** 种一个最小可用的学习包 + 一条"已到期"的复习进度 */
async function seedDueReview(page: Page): Promise<void> {
  const past = new Date(Date.now() - 3 * 86400000).toISOString()

  await page.evaluate(
    async ({ pkgId, pid, past }) => {
      const methods = [
        { id: 'ex-1', type: 'blank', question: '1+1=（____）', answer: '2', knowledgePointIds: ['kp-add'], metadata: { difficulty: '基础' } },
        { id: 'ex-2', type: 'blank', question: '2+2=（____）', answer: '4', knowledgePointIds: ['kp-add'], metadata: { difficulty: '基础' } },
        { id: 'ex-3', type: 'blank', question: '3+3=（____）', answer: '6', knowledgePointIds: ['kp-add'], metadata: { difficulty: '提高' } },
      ]
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
          title: 'E2E 今日任务包',
          dependencies: [],
        },
        knowledgePoints: [
          { id: 'kp-add', type: 'concept', title: '加法', content: '把两个数合起来', prerequisites: [], metadata: {} },
        ],
        exercises: methods,
        units: [
          {
            id: 'u1',
            name: '第一单元',
            title: '第一单元',
            topics: [
              {
                id: 't1',
                title: '加法练习',
                knowledgePointIds: ['kp-add'],
                modules: [],
                exercises: methods,
              },
            ],
          },
        ],
      }

      const progress = {
        profileId: pid,
        packageId: pkgId,
        knowledgePointId: 'kp-add',
        status: '需复习',
        correctCount: 2,
        wrongCount: 1,
        correctStreak: 0,
        wrongStreak: 1,
        lastStudiedAt: past,
        studySeconds: 60,
        nextReviewAt: past,
        masteryProbability: 0.42,
      }

      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('FamilyLearningDB')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['packages', 'progress'], 'readwrite')
          tx.objectStore('packages').put(pkg)
          tx.objectStore('progress').put(progress)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { pkgId: PKG_ID, pid: PID, past },
  )
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

/**
 * 种数据 → 进今日页 → 必要时点一次「再看看今天有什么」。
 *
 * 为什么要多点这一下：队列是**当天冻结**的（同日不重排，否则每做完一项顺序就变）。
 * 本用例绕过导入流程直接写库，所以冻结的空队列不会自动失效 ——
 * 而「再看看今天有什么」正是给这种场景准备的手动重排入口，顺带把它也测了。
 * （真实路径里导入完成会调 `invalidateDailyPlan()`，不需要用户点。）
 */
async function gotoTodayWithSeed(page: Page): Promise<void> {
  await page.goto('/home')
  await resetDb(page)
  await seedDueReview(page)
  await page.goto('/today')

  // 按**按钮文案**判断，而不是按"条目数为 0"：加载中条目数也是 0，
  // 那时候主按钮是「开始今天的学习」，盲点会直接跳走。
  const cta = page.locator('.head-actions button').first()
  await expect(cta).toBeVisible()
  if ((await cta.innerText()).includes('再看看')) {
    await cta.click()
  }
  await expect(page.locator('.item').first()).toBeVisible()
}

test.describe('今日任务', () => {
  test('首页只有一个主入口，点进去是今日页', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)

    const card = page.locator('.today-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('今天')

    // 三块并列的推荐默认收起来（"更多推荐"是折叠态）
    await expect(page.locator('.more-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.review-card')).toHaveCount(0)

    await card.click()
    await expect(page).toHaveURL(/\/today/)
    await expect(page.locator('.head-title')).toBeVisible()
  })

  test('库里有一条到期进度 → 今日页排出一项复习任务，并能进到答题', async ({ page }) => {
    await gotoTodayWithSeed(page)

    const first = page.locator('.item').first()
    await expect(first).toBeVisible()
    await expect(first).toContainText('复习')
    await expect(first).toContainText('加法')
    // 理由必须是可核对的事实（逾期 3 天），不是"系统推荐"
    await expect(first.locator('.item-reason')).toContainText('逾期')
    // 复习项标准题量 3 题
    await expect(first.locator('.item-cost')).toContainText('3 题')

    // 主按钮：第一项未做 → "开始今天的学习"
    const cta = page.locator('.head-actions button')
    await expect(cta).toContainText('开始今天的学习')

    await cta.click()
    await expect(page).toHaveURL(/session=/)
    await expect(page).toHaveURL(/limit=3/)
    // 主题页认这个 query：练习区渲染（题库只有 3 题，limit 不截断）
    await expect(page.getByText('同步练习')).toBeVisible()
  })

  test('切换目标口径不重排队列', async ({ page }) => {
    await gotoTodayWithSeed(page)

    const before = await page.locator('.item-title').allInnerTexts()
    expect(before.length).toBeGreaterThan(0)

    await page.getByRole('button', { name: '按时长' }).click()

    // 队列项不变（口径只影响进度分母），页面仍在今日页
    await expect(page).toHaveURL(/\/today/)
    const after = await page.locator('.item-title').allInnerTexts()
    expect(after).toEqual(before)
    // 目标文案切到分钟
    await expect(page.locator('.head-sub')).toContainText('分钟')
  })

  test('完整做完一项 → 回到今日页并结算（主闭环）', async ({ page }) => {
    await gotoTodayWithSeed(page)

    await expect(page.locator('.head-actions button')).toContainText('开始今天的学习')
    await page.locator('.head-actions button').click()
    await expect(page).toHaveURL(/session=/)

    // 3 道填空题（与种子题库一致）：答题 → 提交 → 下一题，最后一题点「完成练习」
    const answers = ['2', '4', '6']
    for (let i = 0; i < answers.length; i += 1) {
      const input = page.getByPlaceholder('请输入你的答案...')
      await expect(input).toBeVisible()
      await input.fill(answers[i])
      await page.getByRole('button', { name: '提交答案' }).click()

      const last = i === answers.length - 1
      await page.getByRole('button', { name: last ? '🏁 完成练习' : '下一题 ➡️' }).click()
    }

    // 队列记账 + 自动回到今日页（`finishSessionItem`）
    await expect(page).toHaveURL(/\/today/)
    await expect(page.locator('.head-title')).toContainText('全部完成')
    await expect(page.locator('.summary-grid')).toBeVisible()
    await expect(page.locator('.item').first()).toHaveClass(/done/)
  })

  test('空库不崩：给出"没有可排任务"而不是白屏', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await page.goto('/today')

    await expect(page.locator('.head-card')).toBeVisible()
    await expect(page.getByText('没有可排的任务')).toBeVisible()
    await expect(page.getByText('去导入 / 选学习包')).toBeVisible()
  })
})
