import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/**
 * 学习主流程端到端回归网（V1.3 · E-03，对应 PRD §7.3）
 *
 * 为什么补这一条：`tests/e2e/` 之前只有路由截图、UI 基元、多陈述判断题三套，
 * **QuizEngine 与学习主流程完全没有端到端覆盖** —— 判题反馈、模拟考交卷、
 * 成就链路全靠手测。一旦重构碰到答题模板，只有人工点一遍才发现坏了。
 *
 * 链路（7 个节点，每个节点都有可见性断言，不用固定 waitForTimeout）：
 *   导入学习包 → 选包 → 选单元 → 选专题 → 答题 → 判题反馈 → 模拟考交卷
 *
 * 数据全部来自 `tests/fixtures/`（两个 ≤8KB 的迷你包），不依赖网络、不依赖 content/ 大包。
 */

const MINI_UNIT = join(process.cwd(), 'tests', 'fixtures', 'mini-unit.json')
const MINI_EXAM = join(process.cwd(), 'tests', 'fixtures', 'mini-exam.json')

/**
 * 清库：保证用例之间零残留。
 * ⚠️ 必须在 `goto` 之后调用 —— about:blank 下访问 IndexedDB 会抛 SecurityError。
 */
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

/** 通过导入向导导入一个 JSON 学习包（走真实 UI，不塞库） */
async function importPackage(page: Page, file: string): Promise<void> {
  await page.goto('/settings/import')
  await expect(page.getByText('导入学习包').first()).toBeVisible()

  // 第一个 n-upload 是「选择单个 JSON 学习包」
  await page.locator('input[type="file"]').first().setInputFiles(file)

  // 确认弹窗：标题写在卡片 title 上，按钮是「确认导入」
  await expect(page.getByText('确认学习包信息')).toBeVisible()
  await page.getByRole('button', { name: '确认导入' }).click()

  // 成功提示（naive-ui message）—— 说明包已过校验并入库
  await expect(page.getByText('学习包导入成功')).toBeVisible({ timeout: 15_000 })
}

/** 在 QuizEngine 里选中某个选项（选项文案形如 `A. 36`） */
async function chooseOption(page: Page, letter: string): Promise<void> {
  await page.locator('.opt-item').filter({ hasText: `${letter}.` }).first().click()
}

test.describe('学习主流程（导入 → 做题 → 判题 → 模拟考）', () => {
  test('7 个节点全部走通', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)

    // ---------- ① 导入学习包 ----------
    await importPackage(page, MINI_UNIT)

    // ---------- ② 选包 ----------
    await page.goto('/learn')
    const pkgCard = page.locator('.pkg-card').filter({ hasText: 'E2E 迷你单元' })
    await expect(pkgCard).toBeVisible()
    await pkgCard.click()

    // ---------- ③ 选单元 ----------
    const unitCard = page.locator('.unit-card').filter({ hasText: '第一单元 乘法' })
    await expect(unitCard).toBeVisible()
    await expect(page.locator('.unit-card-title')).toHaveCount(1)
    await unitCard.click()

    // ---------- ④ 选专题 ----------
    await expect(page.locator('.unit-header-title')).toHaveText('第一单元 乘法')
    const topicCard = page.locator('.topic-card').filter({ hasText: '主题一：口算' })
    await expect(topicCard).toBeVisible()
    await expect(page.locator('.topic-card')).toHaveCount(2)
    await topicCard.click()

    // ---------- ⑤ 答题 + ⑥ 判题反馈 ----------
    await expect(page.locator('.question-text')).toContainText('12 × 3')
    await chooseOption(page, 'A')
    await page.getByRole('button', { name: '提交答案' }).click()

    const feedback = page.locator('.feedback-box')
    await expect(feedback).toBeVisible()
    await expect(feedback.locator('.correct-answer')).toContainText('正确答案：A')
    await expect(feedback.locator('.explanation')).toContainText('12 × 3 = 36')

    // 第二题做错 → 反馈里必须出现「你的答案」，并给出正确答案
    await page.getByRole('button', { name: /下一题/ }).click()
    await expect(page.locator('.question-text')).toContainText('23 × 2')
    await chooseOption(page, 'A') // 故意选错，正确答案是 B
    await page.getByRole('button', { name: '提交答案' }).click()
    await expect(feedback.locator('.feedback-title')).toBeVisible()
    await expect(feedback.locator('.user-answer')).toContainText('你的答案')
    await expect(feedback.locator('.correct-answer')).toContainText('正确答案：B')

    // ---------- ⑦ 模拟考：导入 examMode 包 → 交卷 → 成绩 ----------
    await importPackage(page, MINI_EXAM)

    await page.goto('/learn')
    await page.locator('.pkg-card').filter({ hasText: 'E2E 迷你模拟卷' }).click()

    // examMode → UnitList 直接渲染 ExamPanel 入口屏
    await expect(page.locator('.exam-title')).toHaveText('E2E 迷你模拟卷')
    await expect(page.locator('.exam-meta')).toContainText('总题数')
    await page.getByRole('button', { name: /开始新会话/ }).click()

    // 6 道全选对 → 交卷后正确率应为 100%
    const answers = ['A', 'B', 'B', 'A', 'A', 'A']
    for (let i = 0; i < answers.length; i++) {
      // 进度提示形如「已作答 0 / 6 题」，斜杠两侧有空格，所以用正则
      await expect(page.locator('.exam-progress-hint')).toContainText(
        new RegExp(`/\\s*${answers.length}`),
      )
      await chooseOption(page, answers[i])
      const isLast = i === answers.length - 1
      await page
        .getByRole('button', { name: isLast ? '🏁 提交试卷' : /下一题/ })
        .click()
    }

    // 成绩页
    const result = page.locator('.exam-result')
    await expect(result).toBeVisible({ timeout: 15_000 })
    await expect(result.locator('.score-num')).toHaveText('6')
    await expect(result.locator('.result-rate')).toContainText('正确率 100%')
  })

  test('答题过程中不弹成就提示，交卷后才结算（AC-06）', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await importPackage(page, MINI_EXAM)

    await page.goto('/learn')
    await page.locator('.pkg-card').filter({ hasText: 'E2E 迷你模拟卷' }).click()
    await page.getByRole('button', { name: /开始新会话/ }).click()

    const answers = ['A', 'B', 'B', 'A', 'A', 'A']
    for (let i = 0; i < answers.length; i++) {
      await chooseOption(page, answers[i])
      await page
        .getByRole('button', { name: i === answers.length - 1 ? '🏁 提交试卷' : /下一题/ })
        .click()
      // 作答过程中不该弹任何成就提示（PRD §6.1 / AC-06）
      await expect(page.locator('.ach-toast')).toHaveCount(0)
    }

    await expect(page.locator('.exam-result')).toBeVisible({ timeout: 15_000 })
    // 交卷后应当有进度落库（此包 1 个知识点）
    const progressCount = await page.evaluate(async () => {
      const req = indexedDB.open('FamilyLearningDB')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const count = await new Promise<number>((resolve) => {
        const tx = db.transaction(['progress'], 'readonly')
        const all = tx.objectStore('progress').getAll()
        all.onsuccess = () => resolve((all.result ?? []).length)
        all.onerror = () => resolve(0)
      })
      db.close()
      return count
    })
    expect(progressCount).toBeGreaterThan(0)
  })
})
