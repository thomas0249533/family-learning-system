#!/usr/bin/env node
// =====================================================================
// 批 6a-2 · 语义色分工守卫（零依赖）
// ---------------------------------------------------------------------
// 不变量（§6a-2）：`--{tone}-color` 是**图形色**（边框 / 描边 / 背景 /
//   渐变 / 图形填充）；`--{tone}-text` 是**文字色**。
//   → 组件层（src/views、src/modules、src/components）里 **`color:` 属性
//     一律不得引用 `-color`，必须用 `-text`**。
// 命中：`color:` 的**值**中出现 `$x-color` / `var(--x-color)`
//   （x ∈ primary/success/warning/danger/info）。
// 排除（图形用途，合法）：`border-color:` / `background-color:` /
//   `border-*-color:` / `background:` / `fill:` / `stroke:` 等——
//   由于只在**裸 `color:` 属性**上锚定（负向环视 `(?<![\w-])`），
//   这些 `*-color:` 前缀天然不命中。
// 白名单：行内显式豁免注释 `// check-text-color-allow`（可附原因）。
// 自证非空洞：注入 `color: $primary-color;` → exit 1；还原 → exit 0。
// =====================================================================

import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src/views', 'src/modules', 'src/components']
const EXT = /\.(vue|ts|scss)$/
const SKIP_SEGMENT = /(^|[/\\])(node_modules|dist|\.git|\.vitest-cache|coverage)([/\\]|$)/

// 裸 `color:` 属性（负向环视排除 border-color / background-color / …）；
// 值捕获到 `;`、`}`、`{` 或行尾。
const BARE_COLOR = /(?<![\w-])color\s*:([^;{}\n]*)/g
// 值里引用语义色 -color（$x-color 或 var(--x-color)）。
const TONE_COLOR = /(?:\$|--)(?:primary|success|warning|danger|info)-color\b/
const ALLOW_COMMENT = /check-text-color-allow/

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
    if (ALLOW_COMMENT.test(line)) return
    BARE_COLOR.lastIndex = 0
    let m
    while ((m = BARE_COLOR.exec(line)) !== null) {
      if (TONE_COLOR.test(m[1])) {
        violations.push({
          file: relative(ROOT, file).replace(/\\/g, '/'),
          line: i + 1,
          text: line.trim(),
        })
        break
      }
    }
  })
}

if (violations.length === 0) {
  console.log(`[check:text-color] OK — 已扫描 ${files.length} 个组件层文件，color: 未引用语义 -color。`)
  process.exit(0)
} else {
  console.error(`[check:text-color] 发现 ${violations.length} 处 color: 引用语义 -color（应用 -text）：`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`)
  }
  console.error('  规则：--{tone}-color 仅作图形色（边框/背景/渐变）；文字一律用 --{tone}-text。')
  console.error('  如确为文字且无法改（须给数值依据）：加注释 // check-text-color-allow: <原因>。')
  process.exit(1)
}
