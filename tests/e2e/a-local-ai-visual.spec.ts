import { test, expect, type Page } from '@playwright/test'

/**
 * V2.0 · A2/A3 · 本地离线 AI 卡片（设置页端到端）
 * =====================================================================
 * 这个 spec 只证明一件在浏览器里**能**证明的事：
 *
 *   没有 Tauri 的环境里，设置页仍然能正常渲染「🧠 本地离线 AI」卡片，
 *   状态显示「未安装」，并给出"网页版没有本地模型能力、会自动降级"的说明 ——
 *   而不是一条红色异常、也不是一个点了没反应的按钮。
 *
 * 为什么这条断言值得单独写：
 *   `ipc.ts` 是全仓唯一会 `import('@tauri-apps/api/*')` 的地方。一旦有人图省事
 *   在组件里直接 import，浏览器打开设置页就会在模块求值阶段炸掉（`__TAURI_INTERNALS__`
 *   不存在），而**单测跑在 Node 里、构建不跑组件**，两边都发现不了。e2e 是唯一
 *   能抓住"Web 端打开就白屏"的那道门。
 *
 * 真实推理不在这里测：模型有 300MB+，e2e 不下载模型（方案修正四已把真实推理
 * 划给用户手动验收）。像素基线走进 `visual.spec.ts` 的 settings-{light,dark}，
 * 本文件只做行为断言，不产新 PNG。
 */

const TITLE = '本地离线 AI'

async function goto(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((m: string) => {
    localStorage.setItem(
      'fls:theme',
      JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false }),
    )
  }, mode)
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
}

for (const mode of ['light', 'dark'] as const) {
  test(`local-ai-card-${mode}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await goto(page, mode)

    const card = page.locator('.card', { hasText: TITLE }).first()
    await expect(card).toBeVisible()
    await expect(card.getByText(TITLE, { exact: false }).first()).toBeVisible()

    // 状态：浏览器里没有 Rust 侧 → 未安装（不是"已就绪"，也不是报错）
    await expect(card.getByText('未安装', { exact: true })).toBeVisible()

    // 降级说明必须出现：告诉家长"这里为什么没有"，而不是让按钮静默失效
    await expect(card.getByText(/网页版没有本地模型能力/)).toBeVisible()

    // 没有 Tauri 就不该出现"能点但没用"的按钮（避免假 affordance）
    await expect(card.getByRole('button', { name: '下载并校验' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '选择本地 .gguf 文件' })).toHaveCount(0)

    // 页面没有抛异常（ipc 短路生效）
    expect(errors).toEqual([])
  })
}
