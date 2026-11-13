#!/usr/bin/env node
// =====================================================================
// D7 · 设计系统收口门禁（零依赖）
// ---------------------------------------------------------------------
// 拦住两类「绕过基元、自己在视图里重写一遍」的写法。两条都是**可机器判定**的，
// 不是"风格建议"——判据写死在这，误报就是要改判据，而不是加豁免。
//
// R1 · 卡片外观自绘
//   同一个叶子规则块里同时出现：`background: card-bg` + `border-radius` + `box-shadow`
//   —— 这三件套就是 `AppCard` 的全部外观。视图里自绘一套 = 出现"第二种卡片"，
//   换圆角/阴影/描边时要改 N 个地方，而且必然走样（D7 审计时 `.empty-card`
//   在三个 learn 视图里被复制了三份，连 `border` 都各写各的）。
//
// R2 · 绕过包装直接引 naive 原语
//   `src/{views,modules}` 里出现 `NCard` / `NBadge` / `NEmpty` / `NSkeleton`（import 或模板标签）。
//   这四个基元（AppCard / AppBadge / EmptyState / Skeleton）就是它们的等价替换，
//   直引等于把 token 与 a11y 处置权让渡回 naive 的默认值。
//
//   **`NButton` 刻意不在此列**：`AppButton` 不是 n-button 的 drop-in ——
//   naive 的 `type` 取值（`tertiary`/`quartiary`）、`loading`、`bordered` 都没有对应物，
//   硬禁只会逼人写 `AppButton + !important` 这种更糟的东西。这是一条**明确的边界**，
//   不是遗漏。
//
// 豁免：
//   · `src/components/ui/**` 整层跳过——基元就是视觉语言的作者，它当然"自绘"；
//   · 行内 `/* check-primitives-allow: 理由 */`（写在块内/行内），且**必须带 12 字以上理由**，
//     防止写成空豁免。理由里请说清"为什么基元表达不了"。
//
// 验收：现有代码 exit 0；把任一处 `AppCard` 换回自绘 `div` 后 exit 1。
// =====================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src/views', 'src/modules', 'src/components']
const EXT = /\.(vue|scss)$/
const SKIP_SEGMENT = /(^|[/\\])(node_modules|dist|\.git|\.vitest-cache|coverage)([/\\]|$)/
/** 基元层：视觉语言的作者，允许自绘 */
const PRIMITIVE_DIR = 'src/components/ui/'

const CARD_BG = /background(?:-color)?\s*:\s*(?:var\(--|\$)card-bg/
const RADIUS = /border-radius\s*:/
const SHADOW = /box-shadow\s*:/
const ALLOW = /check-primitives-allow\s*[:：]?\s*(.{0,200})/
/**
 * 选择器归一：抽出的 "选择器" 会带上前面的注释块与换行，直接比对永远对不上。
 * 去注释 → 取最后一段选择器（ 这种 SCSS 嵌套原样保留）。
 */
const normSel = (sel) => sel.replace(/\/\*[\s\S]*?\*\//g, ' ').trim().split(/\s+/).filter(Boolean).pop() ?? ''
const MIN_REASON = 12

/** 被基元等价替换的 naive 原语（不含 NButton，理由见文件头） */
const WRAPPED = ['NCard', 'NBadge', 'NEmpty', 'NSkeleton']

/**
 * 显式豁免：只允许"基元表达不了"的，且要写清为什么。
 * 每条都必须**仍然命中一个真实的叶子规则块**（`tests/primitives-adoption.test.ts` 有陈旧检查），
 * 所以「改了类名忘了删豁免」也会红。
 *
 * ⚠️ 这 6 条的共同病根只有一个：**`AppCard` 目前只有一种圆角/内边距**（`--radius-2xl` + 固定 padding），
 * 于是任何"想用 16px 圆角、或需要把 flex/gap 放在卡片根节点上"的容器都只能自绘。
 * 要把这批收干净，不是加豁免，而是先给 `AppCard` 加 `radius` / `padding` 变体 ——
 * 那是一次**视觉变更**，得单独一批做（见 tokens.md §12 结尾同款取舍）。
 */
const ALLOWLIST = [
  {
    file: 'src/components/reading/InkOverlay.vue',
    selector: '.ink-toolbar',
    reason: '浮层工具条：脱离卡片层级的悬浮控件，套 AppCard 会带来多余的层级与内边距',
  },
  {
    file: 'src/views/Home.vue',
    selector: '.weak-list',
    reason: '紧凑清单容器：该处注释已写明刻意不用 170px 大卡，套 AppCard 的 24px 圆角会与相邻推荐大卡打架',
  },
  {
    file: 'src/views/Parent.vue',
    selector: '.ach-overview-card',
    reason: 'flex/gap 列容器：AppCard 的内容会被 n-card__content 包一层，gap 会落到错误层级',
  },
  {
    file: 'src/views/Parent.vue',
    selector: '.subject-list',
    reason: 'flex/gap 列容器：同上，布局声明必须落在卡片根节点上',
  },
  {
    file: 'src/views/Parent.vue',
    selector: '.top-list',
    reason: 'flex/gap 列容器：同上，列表项间距由根节点的 gap 控制',
  },
  {
    file: 'src/views/Parent.vue',
    selector: '.profile-panel',
    reason: '档案面板用 16px 圆角与同页其它块对齐，而 AppCard 固定 24px（缺 radius 变体）',
  },
  {
    file: 'src/components/StrokeOrderTrace.vue',
    selector: '&__board',
    reason: '笔顺绘制板：需要 1px 描边 + 内阴影表达"纸面"，AppCard 无内阴影也不该有',
  },
  {
    file: 'src/components/WeeklyReportCard.vue',
    selector: '.weekly-card',
    reason: '周报截图源：宽度、圆角、阴影共同决定导出 PNG 的可预期尺寸，不能被基元统一',
  },
]

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
const scanned = files.filter((f) => !relative(ROOT, f).replace(/\\/g, '/').startsWith(PRIMITIVE_DIR))

/** 叶子规则块：`sel { 声明 }`，块内无嵌套 `{`（SCSS 嵌套会把子规则带进父块 → 误报） */
function leafBlocks(src) {
  const out = []
  const stack = []
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '{') stack.push(i)
    else if (src[i] === '}') {
      const open = stack.pop()
      if (open === undefined) continue
      const body = src.slice(open + 1, i)
      if (body.includes('{')) continue
      let s = open - 1
      while (s >= 0 && !'};'.includes(src[s]) && !(src[s] === '{' && s !== open)) s -= 1
      out.push({ selector: src.slice(s + 1, open).trim(), body, line: src.slice(0, open).split('\n').length })
    }
  }
  return out
}

const violations = []
let blockCount = 0

for (const abs of scanned) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  const src = readFileSync(abs, 'utf8')

  /* ---- R1：卡片外观自绘 ---- */
  const styleAt = src.indexOf('<style')
  const style = styleAt >= 0 ? src.slice(styleAt) : src
  if (style.includes('card-bg')) {
    for (const block of leafBlocks(style)) {
      blockCount += 1
      if (!CARD_BG.test(block.body)) continue
      if (!RADIUS.test(block.body) || !SHADOW.test(block.body)) continue
      if (ALLOW.test(block.body)) {
        const m = block.body.match(ALLOW)
        if ((m?.[1] ?? '').trim().length < MIN_REASON) {
          violations.push({ rule: 'R1', rel, line: block.line, selector: block.selector, why: '豁免理由太短（<12 字），等于空豁免' })
        }
        continue
      }
      const ok = ALLOWLIST.some(
        (a) => a.file === rel && a.selector === normSel(block.selector),
      )
      if (ok) continue
      violations.push({
        rule: 'R1',
        rel,
        line: block.line,
        selector: normSel(block.selector),
        why: '自绘卡片外观（card-bg + border-radius + box-shadow）→ 请改用 AppCard',
      })
    }
  }

  /* ---- R2：绕过包装直引 naive 原语 ---- */
  for (const name of WRAPPED) {
    // import { NCard, ... } from 'naive-ui'
    const importRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]naive-ui['"]`)
    // 模板里直接用作标签（防全局注册）
    const kebab = name.replace(/^N/, '').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    const tagRe = new RegExp(`<${kebab}[\\s>]`)
    if (importRe.test(src) || tagRe.test(src)) {
      violations.push({
        rule: 'R2',
        rel,
        line: (src.slice(0, src.search(importRe.test(src) ? importRe : tagRe)).split('\n').length) || 1,
        selector: name,
        why: `直引 naive ${name} → 请改用对应基元（AppCard / AppBadge / EmptyState / Skeleton）`,
      })
    }
  }
}

if (violations.length === 0) {
  console.log(
    `[check:primitives] OK — 已扫描 ${scanned.length} 个视图/模块文件（${blockCount} 个叶子规则块），`
      + `无自绘卡片外观、无绕过基元直引 naive 原语。`,
  )
  process.exit(0)
}

console.error(`[check:primitives] 发现 ${violations.length} 处绕过基元的写法：`)
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.rel}:${v.line}  ${v.selector}  —— ${v.why}`)
}
console.error('  说明：基元（AppCard / AppBadge / EmptyState / Skeleton）存在就是为了让外观只有一处定义。')
console.error('  确属基元表达不了的，块内加 `/* check-primitives-allow: 为什么基元表达不了 */`（≥12 字）。')
process.exit(1)
