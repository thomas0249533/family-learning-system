#!/usr/bin/env node
// =====================================================================
// D6 · 图标/图形对比度门禁（零依赖）
// ---------------------------------------------------------------------
// 拦住**一条具体写法**，不是抽象原则：
//
//   同一个规则体里同时出现
//     background: {tone}-color     ← 图形色当实心底
//     color: text-on-primary / on-strong   ← 亮或暗的前景
//
// 为什么必须拦：`-color` 是**图形色**（边框 / 描边 / 装饰填充 / 渐变），它不保证
// 能承载前景。实测 `text-on-primary` 压在 `--primary-color` 上，`primary.light`
// 只有 **2.85:1** —— 连 WCAG 1.4.11 给非文字的 3.0 都不到，更不用说 13px 正文要的 4.5。
// 正确写法是 `background: var(--{tone}-text)`（同组实测 5.12:1）。
//
// 这条约定以前只写在 `scripts/a11y/contrast-report.ts` 的说明里，**没有任何机器门禁**，
// 于是 D6 审计时又翻出 7 处（关闭 ×、两处朗读按钮、模式选中态、盲盒「？」、
// 首页快捷胶囊、成就墙印章）—— 报告里那句「-color 上不再有白字」早就不成立了。
//
// 设计取舍：
//   · **只查叶子规则块**（`sel { 声明 }`，块内没有嵌套 `{`）。SCSS 嵌套会把子规则的
//     `color` 带进父块，按大括号配对整块扫一定误报 —— 手工核对过 3 次全红都是这个原因。
//   · **不查 `-light` / `badge-*` 软底**：那一维由对比度报告（≥4.5）与图标登记表覆盖，
//     软底 + `-text` 本来就是达标的合法搭配。
//   · **不查 `gradient-*`**：品牌渐变已定档不动，其白字/白图标走 `brand` 档「不得变差」。
//
// 豁免：行内 `/* check-icon-contrast-allow */`（整行，写在**同一条声明所在行**）。
//
// 验收：现有代码 exit 0；把任一处 `-text` 底改回 `-color` 后 exit 1。
// =====================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src']
const EXT = /\.(vue|scss)$/
const SKIP_SEGMENT = /(^|[/\\])(node_modules|dist|\.git|\.vitest-cache|coverage)([/\\]|$)/

/** 图形色当底：`$primary-color` / `var(--primary-color)` / `{tone}-color` */
const GRAPHIC_BG = /background(?:-color)?\s*:\s*(?:\$|var\(--)?(primary|success|warning|danger|info)-color\b/
/** 需要正对比度的前景（亮底用深字、深底用亮字，两者都要 ≥3:1） */
const FOREGROUND = /(?:^|[;{\s])color\s*:\s*(?:var\(--)?(?:text-on-primary|on-strong)\b/

const ALLOW = /check-icon-contrast-allow/

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

/**
 * 抽出**叶子规则块**：返回 `{ selector, body, startLine }`。
 * 逐字符跟踪大括号栈；遇到 `}` 时若块内没有 `{`，说明它是叶子。
 */
function leafBlocks(src) {
  const out = []
  const stack = []
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') stack.push(i)
    else if (ch === '}') {
      const open = stack.pop()
      if (open === undefined) continue
      const body = src.slice(open + 1, i)
      if (body.includes('{')) continue
      // 选择器：从上一个 `}` / `;` / 块开始处 到 `{`
      let s = open - 1
      while (s >= 0 && !'};'.includes(src[s]) && !(src[s] === '{' && s !== open)) s -= 1
      if (src[s] === '{') {
        // 上一个字符是 `{`：说明是嵌套块的第一条子规则，选择器从 `{` 之后开始
      }
      const selector = src.slice(s + 1, open).trim()
      const startLine = src.slice(0, open).split('\n').length
      out.push({ selector, body, startLine })
    }
  }
  return out
}

const violations = []
let leafCount = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('-color')) continue
  for (const block of leafBlocks(src)) {
    leafCount += 1
    if (!GRAPHIC_BG.test(block.body)) continue
    if (!FOREGROUND.test(block.body)) continue
    // 豁免注释写在块内任一行即可（块内声明通常 1~6 行）
    if (ALLOW.test(block.body)) continue
    violations.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      line: block.startLine,
      selector: block.selector,
    })
  }
}

if (violations.length === 0) {
  console.log(
    `[check:icon-contrast] OK — 已扫描 ${files.length} 个样式文件 / ${leafCount} 个叶子规则块，未发现「图形色当实心底 + 亮前景」。`,
  )
  process.exit(0)
}

console.error(`[check:icon-contrast] 发现 ${violations.length} 处「-color 当实心底 + text-on-primary/on-strong 前景」：`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.selector}`)
}
console.error('  为什么不行：-color 是图形色，压 text-on-primary 实测 primary.light 仅 2.85:1（< 3.0）。')
console.error('  修法：background 改 var(--{tone}-text)，前景保持 var(--text-on-primary) → 5.12:1。')
console.error('  确属装饰且已登记进 src/core/a11y/icon-spots.ts 的，行内加 /* check-icon-contrast-allow */。')
process.exit(1)
