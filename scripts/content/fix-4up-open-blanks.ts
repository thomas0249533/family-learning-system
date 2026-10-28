/**
 * V2.12.3 · 四年级学习包「开放式填空题」修正
 *
 * ## 为什么要改
 *
 * 每日一练 45 天里有 **30 多道「思维拓展」题被做成了 blank 填空题**，答案却是一整段
 * 带推导的文字，例如：
 *
 * ```
 * Q: 某水果批发市场运来30 箱高档苹果，每箱售价140 元，这批苹果一共可以卖出多少元？
 * A: 140×30＝4200（元）。答：一共可以卖出4200 元
 * ```
 *
 * 孩子写「4200」→ 判**错**（答案串里有算式和单位）；写整段 → 也判错（精确匹配）。
 * **这道题无论怎么答都是错的** —— 于是：
 *
 * 1. 那一整天的打卡**永远不可能变成「全部掌握」**（掌握度要求每个知识点都到「已掌握」）；
 * 2. 家长只能让孩子**把那一天从头再做一遍** —— 这正是用户说的「很费时」；
 * 3. 错题本里还会堆满这种「根本没法用填空答」的题。
 *
 * ## 改法（两类）
 *
 * - **A 类 · 有确定数值的应用题** → 答案改成**短答案**（`4200元`），推导过程移进
 *   `explanation`。判分仍是精确填空，但有了「答案带单位、孩子只写数字」的兼容
 *   （见 `@core/quiz/blank` 的单位通道），孩子写 `4200` 或 `4200元` 都对。
 * - **B 类 · 真正开放的题（多问 / 说明理由 / 预测 / 画图）** → 改成 `essay`
 *   主观题，带显式 `keyPoints` 得分点。主观题按得分点覆盖度判分，且**孩子/家长可以
 *   手动纠正判定结果** —— 这正是语文主观题已有的机制，用户明确要的就是这个。
 *
 * 另有一类 **C 类 · 答案顺序与题干问的顺序不一致**（`d45-13-x02` 题干问「∠1 和∠2」，
 * 答案却写「∠2＝50°，∠1＝130°」）：多空是**位置敏感**的，孩子按题干顺序写就判错。
 * 改成与题干同序即可。
 *
 * ## 幂等
 *
 * 脚本可重复运行：已改过的题会再次写入同样的内容，输出「已一致」提示。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())

interface Edit {
  /** 目标题型（缺省不改） */
  type?: 'blank' | 'essay'
  /** 新的答案（缺省不改） */
  answer?: string | string[]
  /** 新的解析（缺省不改） */
  explanation?: string
  /** 主观题得分点 */
  keyPoints?: string[]
}

/**
 * 修正表：`相对路径` → `题目 id` → 修正内容。
 *
 * `daily-math-4-up-rjb-45d.json` 与 `packages/daily-...json` 是同一份内容的两个副本
 * （根目录那份是 `_set.json` 指向的权威源，`packages/` 那份是历史留档），两份一起改，
 * 避免将来出现「两份不一致」。
 */
const EDITS: Record<string, Record<string, Edit>> = {
  'math-4-up-rjb/daily-math-4-up-rjb-45d.json': {
    // ---- A 类：单一数值答案 → 短答案 ----
    'd45-15-x02': { answer: '4200元' },
    'd45-16-x02': { answer: '3808个' },
    'd45-18-x02': { answer: '2912千米' },
    'd45-19-x02': { answer: '1080平方米' },
    'd45-22-x02': { answer: '5625' },
    'd45-23-x02': { answer: '2500册' },
    'd45-24-x02': { answer: '880米' },
    'd45-25-x02': { answer: '360元' },
    'd45-26-x02': { answer: '1360米' },
    'd45-27-x02': { answer: '300元' },
    'd45-28-x02': { answer: '15天' },
    'd45-32-x02': { answer: '10厘米' },
    'd45-38-x02': { answer: '360册' },
    'd45-42-x02': { answer: '4900' },
    'd45-44-x02': { answer: '1920元' },
    'd45-45-x02': { answer: '42厘米' },

    // ---- C 类：答案顺序对齐题干问的顺序 ----
    'd45-13-x02': { answer: '130°,50°' },

    // ---- B 类：真正开放的题 → essay 主观题 ----
    'd45-01-x02': { type: 'essay', keyPoints: ['60407050', '六千零四十万七千零五十'] },
    'd45-02-x01': { type: 'essay', keyPoints: ['四千零八万零六十'] },
    'd45-02-x02': { type: 'essay', keyPoints: ['7777000', '7070770'] },
    'd45-04-x02': { type: 'essay', keyPoints: ['404999', '395000', '9999'] },
    'd45-05-x01': { type: 'essay', keyPoints: ['五千万', '八千零三万零四十'] },
    'd45-05-x02': { type: 'essay', keyPoints: ['90060500008', '数级'] },
    'd45-06-x02': { type: 'essay', keyPoints: ['2049999999', '1950000000'] },
    'd45-17-x02': { type: 'essay', keyPoints: ['6300', '6千米300米'] },
    'd45-20-x02': { type: 'essay', keyPoints: ['1064', '不够坐'] },
    'd45-21-x02': { type: 'essay', keyPoints: ['3864', '够了'] },
    'd45-33-x02': { type: 'essay', keyPoints: ['平行四边形', '三角形'] },
    'd45-35-x02': { type: 'essay', keyPoints: ['12厘米', '18厘米'] },
    'd45-39-x02': { type: 'essay', keyPoints: ['增加', '1000'] },
    'd45-41-x02': { type: 'essay', keyPoints: ['东北', '向南', '向西'] },
    'd45-43-x02': { type: 'essay', keyPoints: ['平行', '垂直'] },
    // 「一个空写 4 个值」的多值列举：改成主观题 + 得分点，写对 3 个即可（阈值 0.6）
    'd45-12-x02': { type: 'essay', keyPoints: ['105°', '120°', '135°', '150°'] },
    'd45-14-x02': { type: 'essay', keyPoints: ['直角', '钝角'] },
  },

  'math-4-up-rjb/special-math-4-up-u3.json': {
    'm4-u3-ex-010': { answer: '8枚' },
    'm4-u3-ex-006': { type: 'essay', keyPoints: ['460'] },
    'm4-u3-ex-007': { type: 'essay', keyPoints: ['60', '169'] },
    'm4-u3-ex-011': { type: 'essay', keyPoints: ['11900'] },
    'm4-u3-ex-013': { type: 'essay', keyPoints: ['68', '44', '20'] },
    'm4-u3-ex-014': { type: 'essay', keyPoints: ['8125', '865'] },
  },

  'math-4-up-rjb/special-math-4-up-kaodian.json': {
    // 「乘或者除以几」→ 标准表述；题干问的是「商也会怎样」
    'kd4-40-1': { answer: '乘或除以相同的数' },
  },

  'chinese-4-up-rjb/unit-chinese-4-up-rjb-u4.json': {
    // 「淹没、淹死」是**同义并列**（一个空），不是两个空 —— 顿号被当成多空分隔符，
    // 孩子只写「淹没」会被判错。改成括号形式后，主干与括号内任一项都算对。
    'u4-ex-002': { answer: '淹没（淹死）' },
    // 题干两个空、答案只有一个元素 —— 两个空填的是同一个词
    'u4-ex-005': { answer: ['想象', '想象'] },
  },

  'chinese-4-up-rjb/special-chinese-4-up-reading.json': {
    // 题干问「两层含义」、答案却给了三段 —— 第三段（眼前的困难与障碍）挪进解析
    'read-ex-058': {
      answer: '在山间浮动的云雾,奸邪小人',
      explanation:
        '“浮云”本义指在山间浮动的云雾，比喻奸邪小人，也比喻眼前的困难与障碍。题干问的是前两层：云雾与奸邪小人。',
    },
  },

  'chinese-4-up-rjb/unit-chinese-4-up-rjb-u7.json': {
    // 同上：「无能、怯懦」是同义并列
    'u7-ex-002': { answer: ['无能（怯懦）', '失落与困惑'] },
  },
}

/** `packages/` 目录下的同名副本也要一起改 */
const MIRROR_DIRS = ['math-4-up-rjb/packages', 'chinese-4-up-rjb/packages']

function collectTargets(): Map<string, string> {
  const map = new Map<string, string>()
  for (const rel of Object.keys(EDITS)) {
    map.set(path.join(ROOT, 'content', rel), rel)
    const dir = rel.split('/')[0]
    const base = rel.split('/').slice(1).join('/')
    for (const mirror of MIRROR_DIRS) {
      if (dir !== mirror.split('/')[0]) continue
      map.set(path.join(ROOT, 'content', mirror, base), `${mirror}/${base}`)
    }
  }
  return map
}

/**
 * 查某个相对路径对应的修正表。
 *
 * 根目录那份是 `_set.json` 指向的权威源；`packages/` 下同名文件是历史留档副本，
 * 两者都要改（避免将来出现「两份不一致」）。镜像路径 → 权威路径的映射在这里做。
 */
function findEdits(rel: string): Record<string, Edit> | undefined {
  if (EDITS[rel]) return EDITS[rel]
  const m = /^([^/]+)\/packages\/(.+)$/.exec(rel)
  if (m) {
    const canonical = `${m[1]}/${m[2]}`
    if (EDITS[canonical]) return EDITS[canonical]
  }
  return undefined
}

let changed = 0
let same = 0
const missing: string[] = []

for (const [absPath, rel] of collectTargets()) {
  if (!fs.existsSync(absPath)) continue
  const pkg = JSON.parse(fs.readFileSync(absPath, 'utf-8'))
  const edits = findEdits(rel)

  let touched = false
  for (const unit of pkg.units ?? []) {
    for (const topic of unit.topics ?? []) {
      for (const ex of topic.exercises ?? []) {
        const edit = edits?.[ex.id]
        if (!edit) continue
        const before = JSON.stringify({ t: ex.type, a: ex.answer, e: ex.explanation, k: ex.keyPoints })
        if (edit.type) ex.type = edit.type
        if (edit.answer !== undefined) ex.answer = edit.answer
        if (edit.explanation !== undefined) ex.explanation = edit.explanation
        if (edit.keyPoints) ex.keyPoints = edit.keyPoints
        const after = JSON.stringify({ t: ex.type, a: ex.answer, e: ex.explanation, k: ex.keyPoints })
        if (before !== after) touched = true
      }
    }
  }
  for (const ex of pkg.exercises ?? []) {
    const edit = edits?.[ex.id]
    if (!edit) continue
    const before = JSON.stringify({ t: ex.type, a: ex.answer, e: ex.explanation, k: ex.keyPoints })
    if (edit.type) ex.type = edit.type
    if (edit.answer !== undefined) ex.answer = edit.answer
    if (edit.explanation !== undefined) ex.explanation = edit.explanation
    if (edit.keyPoints) ex.keyPoints = edit.keyPoints
    const after = JSON.stringify({ t: ex.type, a: ex.answer, e: ex.explanation, k: ex.keyPoints })
    if (before !== after) touched = true
  }

  if (touched) {
    fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    changed++
    console.log(`✏️  ${rel}`)
  } else {
    same++
    console.log(`·  ${rel}（已一致）`)
  }
}

// ---- 校验：修正表里的每一条都要在文件里找到 ----
for (const [rel, edits] of Object.entries(EDITS)) {
  const abs = path.join(ROOT, 'content', rel)
  if (!fs.existsSync(abs)) {
    missing.push(`${rel}（文件不存在）`)
    continue
  }
  const pkg = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  const found = new Set<string>()
  for (const unit of pkg.units ?? []) {
    for (const topic of unit.topics ?? []) {
      for (const ex of topic.exercises ?? []) if (edits[ex.id]) found.add(ex.id)
    }
  }
  for (const ex of pkg.exercises ?? []) if (edits[ex.id]) found.add(ex.id)
  for (const id of Object.keys(edits)) {
    if (!found.has(id)) missing.push(`${rel} :: ${id}（未找到该题）`)
  }
}

console.log(`\n改动 ${changed} 个文件，${same} 个已一致`)
if (missing.length) {
  console.log('⚠️ 未命中的修正项：')
  missing.forEach((m) => console.log('  ', m))
  process.exitCode = 1
}
