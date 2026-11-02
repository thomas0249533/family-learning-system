// 一次性内容审计：扫描所有学习包 JSON，找出"答案与解析自相矛盾 / 结构非法"的硬伤。
// 用法：node scripts/audit-content.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'content'
const skip = new Set(['_set.json', 'manifest.json', 'all_exercises.json'])

// 递归收集所有 exercise
function collectExercises(node, out, loc) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n, i) => collectExercises(n, out, `${loc}[${i}]`)); return }
  if (node.exercises && Array.isArray(node.exercises)) {
    node.exercises.forEach((e, i) => out.push({ ex: e, loc: `${loc}.exercises[${i}]` }))
  }
  for (const k of ['units', 'topics', 'modules', 'knowledgePoints']) {
    if (Array.isArray(node[k])) node[k].forEach((c, i) => collectExercises(c, out, `${loc}.${k}[${i}]`))
  }
}

function letterOf(s) { const m = String(s).trim().match(/^\s*([A-Za-z])[.．、)）(（]?\s*/); return m ? m[1].toUpperCase() : null }

const issues = []
function add(sev, file, loc, ex, msg) { issues.push({ sev, file, loc, id: ex?.id ?? '', q: ex?.question?.slice(0, 40), msg }) }

function walk(dir, acc) {
  if (path.basename(dir) === 'packages') return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.json') && !skip.has(e.name)) acc.push(p)
  }
}

const files = []
walk(ROOT, files)
let total = 0
for (const f of files) {
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { add('ERR', f, '-', null, 'JSON 解析失败'); continue }
  const exs = []
  collectExercises(pkg, exs, f)
  for (const { ex, loc } of exs) {
    if (!ex || !ex.type) continue
    total++
    const a = ex.answer
    if (ex.type === 'single' || ex.type === 'multiple') {
      const opts = ex.options || []
      const letters = opts.map(letterOf).filter(Boolean)
      if (!opts.length) { add('WARN', f, loc, ex, 'single/multiple 无 options'); continue }
      if (letters.length !== opts.length) add('WARN', f, loc, ex, `option 前缀缺失/${letters.length}/${opts.length}`)
      const ansLetters = String(a).split(/[,，]/).map(s => s.trim().toUpperCase()).filter(Boolean)
      for (const L of ansLetters) if (!letters.includes(L)) add('ERR', f, loc, ex, `answer 字母 ${L} 不在 options(${letters.join('')})`)
      // 解析里显式给出"选X/答案为X/只有X"时与 answer 比对
      const expl = ex.explanation || ''
      const pats = [
        /选\s*([A-D])\b/, /答案为?\s*([A-D])\b/, /答案[是为:：]?\s*([A-D])\b/,
        /(?:只有|故|因此|所以)[^。]{0,12}?([A-D])\s*(?:是|为)?正确/,
        /正确(?:的)?(?:答案)?[是为:：]?\s*([A-D])\b/,
        /只有\s*([A-D])\b/, /(?:应选|该选|选)\s*([A-D])\b/,
      ]
      for (const p of pats) { const m = expl.match(p); if (m) { const c = m[1].toUpperCase(); if (!ansLetters.includes(c)) add('ERR', f, loc, ex, `解析暗示正确=${c}，但 answer=${ansLetters.join(',')}`) ; break } }
    } else if (ex.type === 'judge') {
      const valid = ['对', '错', '正确', '错误', 'T', 'F', 'True', 'False', 'true', 'false']
      if (Array.isArray(a)) {
        for (const el of a) if (!valid.includes(String(el).trim())) add('ERR', f, loc, ex, `judge 数组元素非法: ${JSON.stringify(el)}`)
      } else if (!valid.includes(String(a).trim())) {
        add('ERR', f, loc, ex, `judge answer 非法: ${JSON.stringify(a)}`)
      }
    } else if (ex.type === 'blank') {
      if (a == null || String(a).trim() === '') add('ERR', f, loc, ex, 'blank answer 为空')
    }
  }
}

const bySev = { ERR: issues.filter(i => i.sev === 'ERR'), WARN: issues.filter(i => i.sev === 'WARN') }
console.log(`扫描文件 ${files.length} 个，题目 ${total} 道`)
console.log(`硬伤(ERR) ${bySev.ERR.length} 处，告警(WARN) ${bySev.WARN.length} 处\n`)
for (const i of bySev.ERR) console.log(`[ERR] ${i.file}\n      ${i.loc} ${i.id}\n      题: ${i.q}\n      问题: ${i.msg}\n`)
for (const i of bySev.WARN) console.log(`[WARN] ${i.file} ${i.loc} ${i.id}: ${i.msg}`)
