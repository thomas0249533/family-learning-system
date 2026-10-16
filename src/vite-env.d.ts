// Vite 环境变量类型（最小声明，避免引入整个 `vite/client` 全局面）。
// 首个消费者：src/core/router/index.ts 用 `import.meta.env.DEV` 条件注册
// 设计系统预览路由（生产构建由 Vite define 替换为 false → 分支 DCE）。
interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
