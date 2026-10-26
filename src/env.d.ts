/// <reference types="vite/client" />

// Vite `define` 注入的应用版本号（见 vite.config.ts）。
// 构建期替换为 package.json 的 version 字符串，运行期可直接引用。
declare const __APP_VERSION__: string
