// =====================================================================
// Token 生成物 · 漂移校验（不写盘）
// ---------------------------------------------------------------------
// 用法：npm run tokens:check   （或 vite-node scripts/tokens/check.ts）
// 内存生成两产物 → 与磁盘文件逐字节比对（比对前 `\r\n → \n` 规范化）。
// 任何差异：打印首个不等位置的上下文并 `exit 1`。
// 与 predev/prebuild/pretest 自动再生成 + tests/tokens-generation.test.ts
// 共同构成 §2.3 三重防漂移。
// =====================================================================

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateThemeScss, generatePaletteTs } from './emit'

const ROOT = process.cwd()
const normalize = (s: string): string => s.replace(/\r\n/g, '\n')

const targets: Array<{ rel: string; expected: string }> = [
  { rel: 'src/core/styles/theme.scss', expected: generateThemeScss() },
  { rel: 'src/core/styles/palette.ts', expected: generatePaletteTs() },
]

let failed = false

for (const { rel, expected } of targets) {
  const abs = resolve(ROOT, rel)
  if (!existsSync(abs)) {
    console.error(`[tokens:check] ✗ 缺失文件：${rel}（请运行 npm run tokens:build）`)
    failed = true
    continue
  }
  const actual = normalize(readFileSync(abs, 'utf8'))
  const want = normalize(expected)
  if (actual === want) {
    console.log(`[tokens:check] ✓ ${rel}`)
    continue
  }
  failed = true
  let i = 0
  const n = Math.min(actual.length, want.length)
  while (i < n && actual[i] === want[i]) i++
  const ctx = (s: string): string => s.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, '⏎')
  console.error(`[tokens:check] ✗ 漂移：${rel}`)
  console.error(`   首个不等 offset=${i}`)
  console.error(`   磁盘 : …${ctx(actual)}…`)
  console.error(`   生成 : …${ctx(want)}…`)
}

if (failed) {
  console.error('[tokens:check] FAILED — 生成物与 tokens.ts 不一致，请运行 npm run tokens:build')
  process.exit(1)
} else {
  console.log('[tokens:check] OK — 2 产物均与 tokens.ts 逐字节一致')
}
