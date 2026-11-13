import { test, expect, type Page } from '@playwright/test'

/**
 * 批量弹窗的「全选」
 * ---------------------------------------------------------------
 * 背景：一次内容修复常同时动 5~10 个包，逐个勾太麻烦。两个弹窗各加了一个全选
 * 复选框，但**默认仍是一个都不勾**——安全语义不变，只是把「逐个点」变成「一次点」。
 *
 * 这里只验「发现新学习包」（空库即可触发，不需要预装任何东西）。
 * 「修复题库」用的是同一份 toggleAll 逻辑，且需要预装包 + 目录 sha 不一致才能
 * 让候选出现，造的假数据比被测行为多得多 —— 收益不划算，不重复第二轮。
 */

const CATALOG = {
  updatedAt: '2026-11-13',
  packages: [
    { packageId: 'e2e-bulk-a', version: '1.0.0', title: 'E2E 批量包 A', sha256: 'a'.repeat(64) },
    { packageId: 'e2e-bulk-b', version: '1.0.0', title: 'E2E 批量包 B', sha256: 'b'.repeat(64) },
    { packageId: 'e2e-bulk-c', version: '1.0.0', title: 'E2E 批量包 C', sha256: 'c'.repeat(64) },
  ],
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

test('发现新学习包：默认不勾，一键全选后可选全部', async ({ page }) => {
  await page.goto('/learn')
  await resetDb(page)

  // 题库目录走镜像链（raw / ghproxy），用正则一网打尽，避免依赖真实网络
  await page.route(/content-catalog\.json/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CATALOG),
    }),
  )

  await page.goto('/learn')
  await page.getByRole('button', { name: '检查题库更新' }).click()

  // 弹窗标题 + 3 个候选（naive-ui 的 checkbox 不是原生 input，用 role 定位）
  await expect(page.getByText('发现新学习包')).toBeVisible({ timeout: 15_000 })
  const boxes = page.locator('.new-pkg-item').getByRole('checkbox')
  await expect(boxes).toHaveCount(3)

  // 默认一个都不勾：按钮禁用、计数为 0
  const installBtn = page.getByRole('button', { name: /安装选中（\d+）/ })
  await expect(installBtn).toHaveText('安装选中（0）')
  await expect(installBtn).toBeDisabled()

  // 全选 → 计数变 3、按钮可用
  const selectAll = page.getByRole('checkbox', { name: /全选（3 个）/ })
  await expect(selectAll).toBeVisible()
  await selectAll.click()
  await expect(installBtn).toHaveText('安装选中（3）')
  await expect(installBtn).toBeEnabled()
  for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).toBeChecked()

  // 再点一次 → 全清（全选是开关，不是单向）
  await selectAll.click()
  await expect(installBtn).toHaveText('安装选中（0）')
  await expect(installBtn).toBeDisabled()
  for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).not.toBeChecked()
})
