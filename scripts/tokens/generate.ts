// =====================================================================
// Token 生成器 · 写盘
// ---------------------------------------------------------------------
// 用法：npm run tokens:build   （或 vite-node scripts/tokens/generate.ts）
// 由 src/core/styles/tokens.ts 单源生成：
//   · src/core/styles/theme.scss （CSS 变量 6 组；纯变量文件）
//   · src/core/styles/palette.ts （JS 数值 + buildThemeOverrides）
// 产物一律以 `\n` 落盘。头 banner 见 §2.2。**勿手改产物**。
// =====================================================================

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateThemeScss, generatePaletteTs } from './emit'

const ROOT = process.cwd()

const outputs: Array<{ rel: string; content: string }> = [
  { rel: 'src/core/styles/theme.scss', content: generateThemeScss() },
  { rel: 'src/core/styles/palette.ts', content: generatePaletteTs() },
]

for (const { rel, content } of outputs) {
  const abs = resolve(ROOT, rel)
  writeFileSync(abs, content, 'utf8')
  console.log(`[tokens:build] wrote ${rel}  (${content.length} bytes)`)
}

console.log(`[tokens:build] done — 2 产物已由 tokens.ts 生成`)
