#!/usr/bin/env node
// =====================================================================
// 动效纪律门禁（V4.0 · D3）
// ---------------------------------------------------------------------
// 规则：`transition*` / `animation*` 声明里
//   1) 禁止裸时长字面量（0.2s / 200ms）—— 必须用 var(--duration-*)；
//   2) 禁止裸缓动关键字（ease / ease-in / ease-out / ease-in-out）
//      —— 必须用 var(--ease-*)；`linear` 与 `steps()` 合法，不拦。
//
// 豁免：
//   · 文件级：theme.scss（token 定义处）/ print.scss（打印物理尺寸）/
//     motion.scss（无障碍降级必须把时长压到近零）。
//   · 行级：在**同一行**写 `check-motion-allow` 并说明理由。
//     用于 >600ms 的一次性编排（彩带、呼吸光晕）与串联延迟偏移。
//
// 用法：node scripts/check-motion.mjs   （违规 exit 1）
// =====================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const ROOT = 'src'
const EXEMPT_FILES = new Set(['theme.scss', 'print.scss', 'motion.scss'])
const DECL = /(?:^|[{;])\s*(transition(?:-[a-z]+)?|animation(?:-[a-z]+)?)\s*:\s*([^;{}]+);/g
const DURATION = /(\d*\.?\d+)(m?s)\b/g
const EASE_KW = /\b(ease-in-out|ease-in-out|ease-in|ease-out|ease)\b/

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|scss)$/.test(e.name)) out.push(p)
  }
  return out
}

const violations = []
let scanned = 0

for (const file of walk(ROOT)) {
  if (EXEMPT_FILES.has(basename(file))) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (line.includes('check-motion-allow')) return
    for (const m of line.matchAll(DECL)) {
      const [, prop, value] = m
      if (/^\s*none\s*$/.test(value)) continue
      scanned++

      // 去掉 var(--x) 与 SCSS 门面 $x 再判，避免 --ease-standard / $ease-standard 被误判
      const bare = value.replace(/var\([^)]*\)/g, ' ').replace(/\$[a-z-]+/g, ' ')
      if (EASE_KW.test(bare)) {
        const kw = bare.match(EASE_KW)[0]
        violations.push({ file, line: i + 1, prop, value: value.trim(), why: `裸缓动 \`${kw}\`，应使用 var(--ease-*)` })
        continue
      }

      // 时长：var() 已被剔除，剩下的数字只可能是字面量
      for (const md of bare.matchAll(DURATION)) {
        if (parseFloat(md[1]) === 0) continue // 0s / 0ms 合法
        violations.push({
          file, line: i + 1, prop, value: value.trim(),
          why: `裸时长 \`${md[1]}${md[2]}\`，应使用 var(--duration-*)`,
        })
        break
      }
    }
  })
}

if (violations.length) {
  console.error(`\n[motion] ✗ 发现 ${violations.length} 处动效未走 token：\n`)
  for (const v of violations) {
    console.error(`  ${relative(process.cwd(), v.file).replace(/\\/g, '/')}:${v.line}  ${v.why}`)
    console.error(`      ${v.prop}: ${v.value}`)
  }
  console.error('\n  刻度：--duration-fast 150ms / base 200 / slow 300 / slower 450 / slowest 600')
  console.error('  曲线：--ease-standard / emphasized / spring / decelerate（linear 可直接写）')
  console.error('  确属一次性编排或延迟偏移：同行加 /* check-motion-allow: 理由 */\n')
  process.exit(1)
}

console.log(`[motion] ✓ ${scanned} 条动效声明全部走 token`)
