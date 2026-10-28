/**
 * 填空题判分全库回归（一次性审计脚本 · 可重复运行）
 *
 * 目的：给 `@core/quiz/blank` 的宽容通道做**全库兜底**——
 *  1. 每道 blank 题的**标准答案本身**必须判对（否则孩子照抄答案都错）；
 *  2. 明显错误的作答（乱码 / 空）必须判错（宽容通道不能把错答案放进来）。
 *
 * 单测只能覆盖手挑的样本；题库一改就可能有别的题被通道误伤，这里全量扫一遍。
 */
import fs from 'node:fs'
import path from 'node:path'
import { gradeBlank } from '../../src/core/quiz/blank'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.json') && name !== '_set.json' && name !== 'manifest.json') out.push(p)
  }
  return out
}

const ROOT = path.resolve(process.cwd())
const files = walk(path.join(ROOT, 'content'))

let total = 0
const selfFail: string[] = []
const wrongAccepted: string[] = []
let skipped = 0

for (const file of files) {
  let pkg: any
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    skipped++
    continue
  }
  const exercises: any[] = []
  for (const u of pkg.units ?? []) for (const t of u.topics ?? []) for (const e of t.exercises ?? []) exercises.push(e)
  for (const e of pkg.exercises ?? []) exercises.push(e)

  for (const ex of exercises) {
    if (ex.type !== 'blank') continue
    total++
    const ans = ex.answer
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    if (!gradeBlank(ans, ans)) selfFail.push(`${rel} | ${ex.id} | ${JSON.stringify(ans).slice(0, 70)}`)
    if (gradeBlank('ZZZQQQ', ans)) wrongAccepted.push(`${rel} | ${ex.id} | 乱码被接受`)
    if (gradeBlank('', ans)) wrongAccepted.push(`${rel} | ${ex.id} | 空答案被接受`)
  }
}

console.log(`blank 题总数 ${total}（跳过 ${skipped} 个非标准 JSON）`)
console.log(`标准答案自身判错：${selfFail.length} 条`)
selfFail.slice(0, 30).forEach((x) => console.log('  ', x))
console.log(`明显错答案被接受：${wrongAccepted.length} 条`)
wrongAccepted.slice(0, 30).forEach((x) => console.log('  ', x))
if (selfFail.length || wrongAccepted.length) process.exitCode = 1
