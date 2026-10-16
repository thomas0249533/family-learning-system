import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * 单测专用配置。
 * 刻意独立于 vite.config.ts —— 后者挂着 PWA 插件，跑测试既慢又会干扰，
 * 而独立配置也保证 build 行为完全不受影响。
 */
export default defineConfig({
  // 默认缓存目录在 %TEMP%，本机安全策略会拦截写入导致模块加载失败。
  // 固定到项目内的目录，保证测试可重复运行。
  cacheDir: 'node_modules/.vitest-cache',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@templates': resolve(__dirname, 'src/templates'),
      '@modules': resolve(__dirname, 'src/modules'),
    },
  },
})
