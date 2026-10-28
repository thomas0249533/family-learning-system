/**
 * 主观题（essay）得分点体检：验证「典型学生作答」能否命中得分点。
 *
 * 背景：四年级数学包里有 20+ 道开放式题被改成 `essay`，判分走
 * `gradeEssay` 的**得分点覆盖度**（阈值 0.6）。得分点选得不好 → 孩子明明写对了
 * 却被判错，比原来的填空还糟。
 *
 * 本脚本对每道 essay 题做三件事：
 *  1. 用**参考答案原文**作答 → 必须判对；
 *  2. 用**明显错误的作答**作答 → 必须判错；
 *  3. 用**人工写的典型学生作答**作答 → 打印判定结果（供人工核对）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { gradeEssay } from '../../src/core/quiz/essayGrade'

/** 人工写的「典型学生作答」：key = 题目 id，value = 学生会怎么写 */
const TYPICAL: Record<string, string> = {
  'd45-01-x02': '60407050，六千零四十万七千零五十',
  'd45-02-x01': '不对，应该读作四千零八万零六十',
  'd45-02-x02': '①7777000 ②7070770',
  'd45-04-x02': '最大404999，最小395000，相差9999',
  'd45-05-x01': '四百亿五千万，八千零三万零四十',
  'd45-05-x02': '90060500008，一共有3个数级',
  'd45-06-x02': '最大2049999999，最小1950000000',
  'd45-12-x02': '105°、120°、135°、150°',
  'd45-14-x02': '另一个一定是锐角；也可能是锐角、直角或钝角',
  'd45-17-x02': '180×35=6300米，合6千米300米',
  'd45-20-x02': '28×38=1064<1100，座位不够坐',
  'd45-21-x02': '28×138=3864元<4000元，还剩136元，够了',
  'd45-33-x02': '①一个平行四边形和一个三角形；②两个梯形',
  'd45-35-x02': '上底12厘米，高18厘米',
  'd45-39-x02': '销量会继续增加，可能超过1000箱，因为天气越来越热',
  'd45-41-x02': '图书馆在学校的东北方向，回去先向南走300米再向西走400米',
  'd45-43-x02': '折痕之间互相平行或互相垂直',
  'm4-u3-ex-006': '20×23=460',
  'm4-u3-ex-007': '(1)漏算了10×3和3×10，即30+30=60 (2)169',
  'm4-u3-ex-011': '够，119×98≈11900<12000',
  'm4-u3-ex-013': '方案2剩68张，方案3剩44张，方案4剩20张',
  'm4-u3-ex-014': '(1)8125元 (2)赚865元',
}

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
let checked = 0
let bad = 0

for (const file of walk(path.join(ROOT, 'content'))) {
  let pkg: any
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    continue
  }
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const exercises: any[] = []
  for (const u of pkg.units ?? []) for (const t of u.topics ?? []) for (const e of t.exercises ?? []) exercises.push(e)
  for (const e of pkg.exercises ?? []) exercises.push(e)

  for (const ex of exercises) {
    if (ex.type !== 'essay') continue
    const ref = String(ex.answer ?? '')
    const kps = Array.isArray(ex.keyPoints) ? ex.keyPoints : undefined

    // ① 参考答案原文 → 必须对
    const r1 = gradeEssay(ref, ref, kps)
    if (!r1.correct) {
      bad++
      console.log(`❌ 参考答案自身判错：${rel} :: ${ex.id}（命中 ${r1.covered}/${r1.total}）`)
    }

    // ② 明显错误 → 必须错
    const r2 = gradeEssay('zzzqqq', ref, kps)
    if (r2.correct) {
      bad++
      console.log(`❌ 乱码被判对：${rel} :: ${ex.id}`)
    }

    // ③ 典型学生作答
    const typical = TYPICAL[ex.id]
    if (typical) {
      checked++
      const r3 = gradeEssay(typical, ref, kps)
      const flag = r3.correct ? '✅' : '❌'
      if (!r3.correct) bad++
      console.log(
        `${flag} ${ex.id}（命中 ${r3.covered}/${r3.total}）得分点=${JSON.stringify(kps)}`,
      )
      if (!r3.correct) console.log(`    作答：${typical}`)
    } else {
      console.log(`⚠️  ${ex.id} 没有人工典型作答，未验证（得分点=${JSON.stringify(kps)}）`)
    }
  }
}

console.log(`\n典型作答已验证 ${checked} 条，异常 ${bad} 条`)
if (bad > 0) process.exitCode = 1
