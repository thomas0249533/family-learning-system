import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'favicon.ico'],
      manifest: {
        name: '家庭学习系统',
        short_name: '学习系统',
        description: 'JSON 驱动的家庭学习系统框架',
        theme_color: '#2d6a4f',
        background_color: '#f6f8f5',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          {
            src: 'icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 静态资源预缓存（不含大数据 JSON，因为数据在 IndexedDB）
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // 单文件最大 3MB，超出的走运行时缓存
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // SPA 路由 fallback
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/__/],
        // 运行时缓存：图片、字体、第三方资源
        runtimeCaching: [
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|svg|gif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
              },
            },
          },
          {
            urlPattern: /\.(?:woff|woff2|ttf|otf|eot)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
        // 清理过期缓存
        cleanupOutdatedCaches: true,
        // 立即接管客户端
        clientsClaim: true,
        skipWaiting: false, // 配合 prompt 策略，由用户确认
      },
      devOptions: {
        enabled: false, // 开发环境不启用 SW，避免干扰调试
      },
    }),
  ],
  // ✅ 注入应用版本号（与 package.json 同步，避免硬编码 V1.9 这类陈旧徽标）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
// ✅ 新增这段
  server: {
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/dist/**',
        // 打包前 `mv dist .dist-prev` 的临时目录：不忽略会每次搬运触发一次整页 reload
        '**/.dist-prev/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/.vite/**',
        '**/node_modules/**',
      ],
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
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/core/styles/variables.scss";`,
        silenceDeprecations: ['import'],
      },
    },
  },
  build: {
    // 加大 chunk 警告阈值
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 拆包，避免首屏过大
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'naive-ui': ['naive-ui'],
          'echarts': ['echarts'],
          'markdown': ['markdown-it', 'katex'],
          'db': ['dexie'],
        },
      },
    },
  },
})