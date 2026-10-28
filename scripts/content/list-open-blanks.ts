/**
 * 列出「开放式填空题」候选（答案不是可直接填的短答案）。
 *
 * 判定：blank 题 + 答案里出现 `＝` / `=` / `答：` / `。` / `；` / 说明性文字，
 * 且答案归一化后不是「多空列举」形态。
 * 这类题孩子永远填不对 → 那一���（每日打卡）永远不可能「全部掌握」。
 */
import fs from 'node:fs'
import path from 'node:path'

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
const targets = process.argv.slice(2)
const dirs = targets.length
  ? targets.map((d) => path.join(ROOT, 'content', d))
  : fs.readdirSync(path.join(ROOT, 'content')).map((d) => path.join(ROOT, 'content', d))

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue
  for (const file of walk(dir)) {
    let pkg: any
    try {
      pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const exercises: any[] = []
    for (const u of pkg.units ?? []) for (const t of u.topics ?? []) for (const e of t.exercises ?? []) exercises.push(e)
    for (const e of pkg.exercises ?? []) exercises.push(e)

    for (const ex of exercises) {
      if (ex.type !== 'blank') continue
      const ans = Array.isArray(ex.answer) ? ex.answer.join(' | ') : String(ex.answer ?? '')
      const isOpen = /[＝=]/.test(ans) || ans.includes('答：') || /[。；]/.test(ans)
      if (!isOpen) continue
      // 排除纯列举（全是短片段，用顿号/逗号分隔且每段都很短）
      const parts = ans.split(/[、,，；;]/).map((s) => s.trim()).filter(Boolean)
      const allShort = parts.length > 1 && parts.every((p) => p.length <= 8 && !/[＝=答]/.test(p))
      if (allShort) continue
      console.log(`### ${rel} :: ${ex.id}`)
      console.log(`Q: ${String(ex.question).replace(/\n/g, ' ⏎ ')}`)
      console.log(`A: ${ans.replace(/\n/g, ' ⏎ ')}`)
      console.log(`EX: ${String(ex.explanation ?? '').slice(0, 80)}`)
      console.log('')
    }
  }
}
