#!/usr/bin/env node
// =====================================================================
// D2 · 字号 token 门禁（零依赖）
// ---------------------------------------------------------------------
// 目标：禁止在组件层写死 `font-size: <数字>px`，一律走字号阶梯 token
//   `var(--font-3xs … --font-9xl)`（源：src/core/styles/tokens.ts 的 FONT）。
//   理由：硬编码字号是「各页字号漂移」的根因；阶梯外的新值应先加 token 再用。
//
// 命中：`font-size:` 后接数字 + px（含 `!important`、含小数如 `12.5px`）。
// 白名单：
//   · src/core/styles/theme.scss —— 生成物，token 本身就在这里定义
//   · src/core/styles/print.scss —— 打印件按物理尺寸排版，px 是正确单位
//   · 行内显式豁免：`// check-font-size-allow` 或 `/* check-font-size-allow */`
//
// 验收：对现存代码 exit 0；注入 `font-size: 13px;` 时 exit ≠ 0。
// =====================================================================

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src']
const EXT = /\.(vue|scss)$/
const SKIP_SEGMENT = /(^|[/\\])(node_modules|dist|\.git|\.vitest-cache|coverage)([/\\]|$)/
const SKIP_FILES = new Set(['src/core/styles/theme.scss', 'src/core/styles/print.scss'])

const HARDCODED = /font-size\s*:\s*[\d.]+px/
const ALLOW_COMMENT = /check-font-size-allow/

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (SKIP_SEGMENT.test(p)) continue
    if (e.isDirectory()) walk(p, out)
    else if (EXT.test(e.name)) out.push(p)
  }
}

const files = []
for (const d of SCAN_DIRS) walk(join(ROOT, d), files)

const hits = []
for (const f of files) {
  if (!existsSync(f)) continue
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (SKIP_FILES.has(rel)) continue
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!HARDCODED.test(line)) return
    if (ALLOW_COMMENT.test(line)) return
    hits.push(`${rel}:${i + 1}  ${line.trim()}`)
  })
}

if (hits.length === 0) {
  console.log(`[check:font-size] ✓ ${files.length} 个文件无硬编码字号（全部走 --font-* token）`)
  process.exit(0)
}

console.error(`[check:font-size] ✗ 发现 ${hits.length} 处硬编码 font-size（应改用 var(--font-*)）`)
for (const h of hits) console.error('   ' + h)
console.error('\n可用刻度：--font-3xs(10) 2xs(11) xs(12) sm(13) base(14) md(15) lg(16)')
console.error('          xl(18) 2xl(20) 3xl(22) 4xl(24) 5xl(28) 6xl(32) 7xl(40) 8xl(48) 9xl(56)')
console.error('确需一次性尺寸：在该行加 `/* check-font-size-allow */` 并写明理由。')
process.exit(1)
