import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/**
 * V2.9 · R5 回归：报告页圆环/小贴士 + 考试结果页答题卡回放（借鉴参考图3）。
 * 报告页断言走空态（确定性强）；考试结果页走 mini-exam 真实答完整卷。
 */

const MINI_EXAM = join(process.cwd(), 'tests', 'fixtures', 'mini-exam.json')

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

async function importPackage(page: Page, file: string): Promise<void> {
  await page.goto('/settings/import')
  await expect(page.getByText('导入学习包').first()).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  await expect(page.getByText('确认学习包信息')).toBeVisible()
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('学习包导入成功')).toBeVisible({ timeout: 15_000 })
}

test('R5 出图：报告页 + 考试结果页', async ({ page }) => {
  await page.goto('/home')
  await resetDb(page)

  // 1. 报告页：圆环（0% 空弧 + track）+ 学习小贴士
  await page.goto('/report')
  await expect(page.locator('.report-hero__ring')).toBeVisible()
  await expect(page.locator('.ring-arc')).toBeVisible()
  await expect(page.locator('.study-tip')).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/report-r5.png', fullPage: false })

  // 2. 考试结果页：答完整卷 → 答题卡回放
  await importPackage(page, MINI_EXAM)
  await page.goto('/learn')
  await page.locator('.pkg-card', { hasText: /模拟|测验|冲刺/ }).first().click()
  await page.getByRole('button', { name: /开始新会话/ }).click()
  await expect(page.locator('.question-nav')).toBeVisible()

  // 老老实实答 6 题（考试模式无即时反馈，「下一题」一次点击即跳题）
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('.progress-text').first()).toContainText(`第 ${i + 1} / 6 题`)
    await page.locator('.opt-item').first().click()
    await page.getByRole('button', { name: /下一题/ }).click()
  }
  await expect(page.locator('.progress-text').first()).toContainText('第 6 / 6 题')
  await page.locator('.opt-item').first().click()
  await page.getByRole('button', { name: /提交试卷/ }).click()
  await expect(page.locator('.replay-card')).toBeVisible()
  await expect(page.locator('.replay-dot').first()).toBeVisible()
  // 点击题号 → 对应解析卡进入视口
  const firstWrongId = await page.locator('.detail-card.wrong').first().getAttribute('id')
  await page.locator('.replay-dot.is-wrong').first().click()
  await expect(page.locator(`#${firstWrongId}`)).toBeInViewport()
  await page.screenshot({ path: 'docs/screenshots/exam-replay-done.png', fullPage: true })
})
