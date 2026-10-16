#!/usr/bin/env node
// =====================================================================
// B6 · 防回潮门禁（降级版 · 零依赖）
// ---------------------------------------------------------------------
// 目标：禁止组件层（src/views、src/modules、src/components）出现硬编码颜色。
//   命中：`#hex`（3~8 位）/ `rgba(数字` / `rgb(数字` / `hsl(数字` / `hsla(数字`。
//   白名单：
//     · src/core/styles/**（唯一色源，不在扫描目录内）
//     · 行内显式豁免注释 `// check-hex-allow` / `/* check-hex-allow */`（整行）
//     · 纯黑阴影 `rgba(0, 0, 0, ...)`（任意 alpha）——**仅剔除该片段后**再扫剩余文本，
//       故同一行里另外写的真值色（如 `#000000`）仍会被命中，不会整行漏放。
// 验收：对现存代码 exit 0；注入 `#123456` / `hsl(120,50%,50%)` / 一行同时含
//       纯黑 rgba 与 `#000000` 时 exit ≠ 0。
// =====================================================================

import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src/views', 'src/modules', 'src/components']
const EXT = /\.(vue|ts|scss)$/
const SKIP_SEGMENT = /(^|[/\\])(node_modules|dist|\.git|\.vitest-cache|coverage)([/\\]|$)/

const HEX = /#([0-9a-fA-F]{3,8})\b/
const RGB_NUM = /rgba?\(\s*\d/
const HSL_NUM = /hsla?\(\s*\d/
// 纯黑阴影片段（整段剔除，而非整行跳过）——避免「同行夹带真值色」被整行放过
const BLACK_RGBA = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,[^)]*\)/g
const ALLOW_COMMENT = /check-hex-allow/

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (SKIP_SEGMENT.test(full)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
}

const files = []
for (const d of SCAN_DIRS) walk(join(ROOT, d), files)

const violations = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    // 显式整行豁免（有意注释）
    if (ALLOW_COMMENT.test(line)) return
    // 只剔除纯黑阴影片段，再扫剩余文本
    const scanned = line.replace(BLACK_RGBA, '')
    if (HEX.test(scanned) || RGB_NUM.test(scanned) || HSL_NUM.test(scanned)) {
      violations.push({
        file: relative(ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        text: line.trim(),
      })
    }
  })
}

if (violations.length === 0) {
  console.log(`[check:hex] OK — 已扫描 ${files.length} 个组件层文件，未发现硬编码颜色。`)
  process.exit(0)
} else {
  console.error(`[check:hex] 发现 ${violations.length} 处组件层硬编码颜色：`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`)
  }
  console.error('  建议：改用 var(--token) / $scss-var，或加注释 // check-hex-allow 豁免。')
  process.exit(1)
}
