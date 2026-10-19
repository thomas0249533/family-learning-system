import { defineConfig } from '@playwright/test'

/**
 * B7 视觉回归（首选方案）。
 * 通过 dev server 起服务，对 8 类页面 × 浅/深 截图，留档到 docs/screenshots/。
 * 若环境无法安装浏览器内核，则以 docs/视觉回归清单.md 的人工基线为准。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 900 },
    // 失败时留证据（PRD §7.3 AC-E3-6）：trace 只在失败用例上保留，不占空间。
    // 本机安全软件会拦 `test-results/**` 的写入，导致 browserContext.close 抛 EPERM、
    // 把一个正常的用例记成失败。可用 `PW_TRACE=off npx playwright test` 关掉取证后复跑。
    trace: process.env.PW_TRACE === 'off' ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
