#!/usr/bin/env node
// =====================================================================
// 可访问性门禁（V4.0 · D5）
// ---------------------------------------------------------------------
// 三条规则，只查「机器能可靠判定」的部分（判断不了的交给人工评审，不硬凑）：
//
//   1) 焦点环只准走 token
//      `outline` 的颜色/宽度必须是 var(--focus-ring*) / var(--btn-focus-ring)，
//      `outline-offset` 只能是 var(--focus-ring-offset) / var(--focus-ring-offset-inset)。
//      写死 `2px solid $primary-color` 的后果：换预设/换暗色时不跟随 —— 环还在，
//      但颜色跟背景撞了，等于没有。
//
//   2) 纯图标按钮必须有可读名字
//      <button> 里去掉标签后没有任何文字、只有图标时，必须有
//      aria-label / :aria-label / aria-labelledby / title。
//      否则读屏只说「按钮」，用户不知道按了会发生什么。
//
//   3) 可点击容器必须能 Tab 到
//      带 @click 的 div/span/li/section，必须满足其中之一：
//        · 用了 v-clickable（全局指令，自动补 role + tabindex + 键盘激活）
//        · 自己写了 role + tabindex + @keydown/@keyup
//      灰色地带（比如整块区域只有一个委托监听）用 `check-a11y-allow` 显式豁免。
//
// 豁免：
//   · 文件级：components.scss / theme.scss / variables.scss（token 定义处）。
//   · 行级：同一行写 `check-a11y-allow` 并说明理由。
//
// 用法：node scripts/check-a11y.mjs   （违规 exit 1）
// =====================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const ROOT = 'src'
const EXEMPT_FILES = new Set(['components.scss', 'theme.scss', 'variables.scss', 'print.scss'])

const RING_OK = /var\(--(?:focus-ring|focus-ring-on-strong|btn-focus-ring)\)/
const RING_W_OK = /var\(--focus-ring-w\)/
const OFFSET_OK = /var\(--focus-ring-offset(?:-inset)?\)/

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|scss)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 去掉 CSS 注释后按行保留（保住行号，注释里的示例才不会误报） */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 取出模板区内容 + 它在原文中的起始下标（定位行号用） */
function templateSection(text) {
  const start = text.indexOf('<template>')
  const end = text.lastIndexOf('</template>')
  if (start < 0 || end < 0) return { body: '', start: 0 }
  const bodyStart = start + '<template>'.length
  return { body: text.slice(bodyStart, end), start: bodyStart }
}

const violations = []
let scannedRing = 0
let scannedBtn = 0
let scannedClick = 0

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ')
const hasText = (s) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(stripTags(s).replace(/\s+/g, ' '))

for (const file of walk(ROOT)) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/')
  const raw = readFileSync(file, 'utf8')

  /* ---------- 规则 1：焦点环 token 化 ---------- */
  if (!EXEMPT_FILES.has(basename(file))) {
    const lines = stripCssComments(raw).split('\n')
    lines.forEach((line, i) => {
      if (line.includes('check-a11y-allow')) return

      const om = line.match(/(?:^|[^-\w])outline:\s*([^;{}]+);/)
      if (om) {
        const v = om[1].trim()
        if (!/^(none|0)$/.test(v)) {
          scannedRing++
          // 只认「宽 + 线型 + 色」的完整写法；宽度和颜色都必须 token 化
          const hasShape = /\bsolid\b|\bdashed\b|\bdotted\b/.test(v)
          if (hasShape && (!RING_W_OK.test(v) || !RING_OK.test(v))) {
            violations.push({
              rel, line: i + 1, rule: '1', why: '焦点环未 token 化', detail: `outline: ${v}`,
            })
          } else if (!hasShape && !RING_OK.test(v)) {
            violations.push({
              rel, line: i + 1, rule: '1', why: 'outline 颜色未 token 化', detail: `outline: ${v}`,
            })
          }
        }
      }

      const oo = line.match(/outline-offset:\s*([^;{}]+);/)
      if (oo) {
        const v = oo[1].trim()
        if (!OFFSET_OK.test(v)) {
          violations.push({
            rel, line: i + 1, rule: '1', why: 'outline-offset 未 token 化', detail: `outline-offset: ${v}`,
          })
        }
      }
    })
  }

  if (!file.endsWith('.vue')) continue

  /* ---------- 模板区：先剥注释，再查 2 / 3 ---------- */
  const section = templateSection(raw)
  const tpl = section.body.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const tplOffset = section.start
  const lineOf = (idx) => raw.slice(0, tplOffset + idx).split('\n').length
  const allowAt = (idx) => {
    const lineStart = raw.lastIndexOf('\n', tplOffset + idx) + 1
    const lineEnd = raw.indexOf('\n', tplOffset + idx)
    return raw.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).includes('check-a11y-allow')
  }

  /* ---------- 规则 2：纯图标按钮要有名字 ---------- */
  for (const m of tpl.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = m[1]
    const inner = m[2]
    if (!/<IconBase\b|<svg\b|<img\b/.test(inner)) continue
    if (hasText(inner)) continue
    scannedBtn++
    // 只认 aria-label / aria-labelledby：`title` 虽然在 ARIA 映射里能兜底成名字，
    // 但触屏不显示、部分读屏对「只在 title 里」的名字处理不一致，不能当唯一来源。
    if (/aria-label|aria-labelledby/.test(attrs)) continue
    if (allowAt(m.index)) continue
    violations.push({
      rel,
      line: lineOf(m.index),
      rule: '2',
      why: '纯图标按钮没有可读名字（读屏只会念「按钮」）',
      detail: `<button ${attrs.replace(/\s+/g, ' ').trim().slice(0, 60)}>`,
    })
  }

  /* ---------- 规则 3：可点击容器要能 Tab 到 ---------- */
  for (const m of tpl.matchAll(/<(div|span|li|section|article)\b([^>]*?)>/g)) {
    const attrs = m[2]
    if (!/@click/.test(attrs)) continue
    scannedClick++
    // 遮罩 / 弹层：`@click.self` 是「点空白处关闭」，它不是控件，聚焦它没有意义
    // （键盘出口是 Esc，由各弹层自己监听）。`role="dialog"` 同理。
    if (/@click\.self/.test(attrs) || /role="(?:dialog|alertdialog)"/.test(attrs)) continue
    if (/v-clickable/.test(attrs)) continue
    // 允许动态绑定：`:role="x ? 'button' : undefined"` 这类按 props 决定是否可交互
    const hasRole = /(?:^|\s):?role=/.test(attrs)
    const hasTab = /(?:^|\s):?tabindex=/.test(attrs)
    const hasKey = /@keydown|@keyup/.test(attrs)
    if (hasRole && hasTab && hasKey) continue
    if (allowAt(m.index)) continue
    violations.push({
      rel,
      line: lineOf(m.index),
      rule: '3',
      why: `可点击的 <${m[1]}> 键盘进不去（缺 ${[!hasRole && 'role', !hasTab && 'tabindex', !hasKey && '@keydown'].filter(Boolean).join(' / ')}）`,
      detail: `<${m[1]} ${attrs.replace(/\s+/g, ' ').trim().slice(0, 60)}>`,
    })
  }
}

/** 保留标签、只把文本留空：用来判断「里面到底有没有图标」 */
function stripTagsKeepTags(s) {
  return s
}

if (violations.length) {
  console.error(`\n[a11y] ✗ 发现 ${violations.length} 处可访问性问题：\n`)
  const titles = {
    1: '焦点环未 token 化（换预设/暗色时会跟背景撞色）',
    2: '纯图标按钮缺 aria-label',
    3: '可点击容器键盘不可达',
  }
  for (const rule of ['1', '2', '3']) {
    const list = violations.filter((v) => v.rule === rule)
    if (!list.length) continue
    console.error(`  ── 规则 ${rule} · ${titles[rule]}  (${list.length}) ──`)
    for (const v of list) {
      console.error(`  ${v.rel}:${v.line}  ${v.why}`)
      console.error(`      ${v.detail}`)
    }
    console.error('')
  }
  console.error('  修法：')
  console.error('    规则 1 → outline: var(--focus-ring-w) solid var(--focus-ring);')
  console.error('             （主色/深色面用 var(--focus-ring-on-strong)；内嵌环用 var(--focus-ring-offset-inset)）')
  console.error('    规则 2 → 加 aria-label="朗读译文" 之类，说清「按了会发生什么」')
  console.error('    规则 3 → 加 v-clickable（跳转用 v-clickable:link）')
  console.error('    确属刻意例外：同行加 /* check-a11y-allow: 理由 */\n')
  process.exit(1)
}

console.log(
  `[a11y] ✓ 焦点环 ${scannedRing} 处全走 token；` +
    `图标按钮 ${scannedBtn} 个均有名字；可点击容器 ${scannedClick} 个均可 Tab`,
)
