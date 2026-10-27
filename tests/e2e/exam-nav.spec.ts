import { join } from 'node:path'
import { test, expect } from '@playwright/test'

const MINI_EXAM = join(process.cwd(), 'tests', 'fixtures', 'mini-exam.json')

async function resetDb(page: import('@playwright/test').Page): Promise<void> {
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

test('V2.8 · 考试答题卡题号条：图例数字与绿色格子同口径', async ({ page }) => {
  await page.goto('/home')
  await resetDb(page)
  await page.goto('/settings/import')
  await page.locator('input[type="file"]').first().setInputFiles(MINI_EXAM)
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.goto('/learn')
  const examCard = page.locator('.pkg-card', { hasText: /模拟|测验|冲刺/ }).first()
  await examCard.click()
  await page.getByRole('button', { name: /开始新会话/ }).click()
  await expect(page.locator('.question-nav')).toBeVisible()
  // 初始：已答 0
  await expect(page.locator('.nav-legend')).toContainText('已答 0')
  // 答第 1 题 → 图例应为 已答 1
  await page.locator('.opt-item').first().click()
  await page.getByRole('button', { name: /下一题|提交/ }).first().click()
  await expect(page.locator('.nav-legend')).toContainText('已答 1')
  await expect(page.locator('.nav-dot.answered')).toHaveCount(1)
  await page.screenshot({ path: 'docs/screenshots/exam-nav.png', fullPage: false })
  console.log('LEGEND_OK')
})
