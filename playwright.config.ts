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
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
