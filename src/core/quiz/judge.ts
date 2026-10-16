/**
 * 判断题内核（纯函数 · 可单测）
 *
 * 放在 `src/core/` 而非 SFC 内部的原因：本机无 `@vue/test-utils` / jsdom，
 * `vitest.config.ts` 是 `environment: 'node'` 且不可改 → **SFC 内部函数根本测不到**。
 * 项目已有 `@core/review/fsrs.ts`、`@core/mistake/mistakeRules.ts` 同型先例。
 *
 * 关键背景：内容里存在「多陈述判断题」——一道题的 `answer` 是数组（如 `["F","T","F","T"]`），
 * 题干是「阅读材料 + (1)(2)(3)(4) 若干陈述句」，要求逐句判断。
 * 引擎旧实现只渲染一对 ✅/❌ 且对数组做 `String(a)` 降级 → 恒不相等，**永远判错**。
 */

/** 归一化后的判断值 */
export type JudgeToken = '对' | '错'

/**
 * 单个值归一化成 `对` / `错`；无法识别返回 `null`。
 * 覆盖内容中真实出现的写法：布尔、`'true'/'false'`、`'T'/'F'`、`'对'/'错'`、`'正确'/'错误'`。
 */
export function judgeToken(v: unknown): JudgeToken | null {
  if (v === true) return '对'
  if (v === false) return '错'
  if (typeof v === 'string') {
    switch (v.trim().toLowerCase()) {
      case 'true':
      case 't':
      case '对':
      case '正确':
        return '对'
      case 'false':
      case 'f':
      case '错':
      case '错误':
        return '错'
      default:
        return null
    }
  }
  return null
}

/** 归一化为 token 列表。标量 → 长度 0 或 1 的数组；数组 → 逐元素归一化（丢弃无法识别项）。 */
export function normalizeJudgeList(a: unknown): JudgeToken[] {
  if (Array.isArray(a)) {
    return a.map(judgeToken).filter((t): t is JudgeToken => t !== null)
  }
  const t = judgeToken(a)
  return t ? [t] : []
}

/** 多陈述判断题（一次问 ≥2 句） */
export function isMultiJudge(answer: unknown): boolean {
  return normalizeJudgeList(answer).length > 1
}

/**
 * 判分：**全对才算对**（与 `multiple` 多选题一致）。
 *
 * 刻意不做部分给分：`AnswerPayload.isCorrect` 是 boolean，FSRS / BKT / 错题三级规则
 * 全部挂在它上面；改成部分分要一路穿透学习内核，收益远小于风险。
 */
export function gradeJudge(userAnswer: unknown, correctAnswer: unknown): boolean {
  const correct = normalizeJudgeList(correctAnswer)
  const given = normalizeJudgeList(userAnswer)
  if (correct.length === 0) return false
  if (given.length !== correct.length) return false
  return correct.every((v, i) => v === given[i])
}

/**
 * 按钮/展示文案取自题目自己的标签域。
 * `options: ["T","F"]` → 显示 `T`/`F`；否则显示 `对`/`错`。
 *
 * 修的是一个真实缺陷：英语阅读判断题要求「正确写 T，错误写 F」、答案也是 `"T"`/`"F"`，
 * 但界面硬编码显示中文 `对`/`错` —— 文案与题型域不匹配。
 */
export function judgeLabels(options?: string[] | null): { t: string; f: string } {
  const isTF =
    Array.isArray(options) &&
    options.some((o) => String(o).trim().toUpperCase() === 'T') &&
    options.some((o) => String(o).trim().toUpperCase() === 'F')
  return isTF ? { t: 'T', f: 'F' } : { t: '对', f: '错' }
}

/** 按题目标签域把 token 列表渲染成展示串（提交记录 / 错题本 / 正确答案展示用） */
export function formatJudgeTokens(tokens: JudgeToken[], options?: string[] | null): string {
  const L = judgeLabels(options)
  return tokens.map((t) => (t === '对' ? L.t : L.f)).join(' ')
}

export interface JudgeParts {
  /** 引导语 + 阅读材料（题干在第一个编号标记之前的部分） */
  material: string
  /** 逐条陈述句（已剥离 `(1)` 等编号标记） */
  statements: string[]
}

/** 编号标记：`(1)` / `（1）` / `( 1 )` 均可 */
const MARKER_RE = /[（(]\s*(\d+)\s*[)）]/g

/**
 * 把题干切成「引导语 + 阅读材料」与「陈述句列表」。
 *
 * **解析失败一律返回 `null`，由调用方降级为「题干整块 + N 行 T/F」** —— 绝不让
 * 解析器把内容切坏。
 *
 * 失败条件：编号标记 <2 个 / 编号不是连续 `1..N` / 传入 `expected` 且标记数不等 /
 * 任一句切出来为空。
 */
export function splitJudgeStatements(question: unknown, expected?: number): JudgeParts | null {
  const text = String(question ?? '')
  if (!text) return null

  const marks: { index: number; len: number; n: number }[] = []
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(text)) !== null) {
    marks.push({ index: m.index, len: m[0].length, n: Number(m[1]) })
  }

  if (marks.length < 2) return null
  // 编号必须连续 1..N（内容里若出现 `(2)` 之类正文引用，这里会判失败并降级 —— 安全优先）
  if (marks.some((mk, i) => mk.n !== i + 1)) return null
  if (typeof expected === 'number' && expected > 0 && marks.length !== expected) return null

  const material = text.slice(0, marks[0].index).trim()
  const statements: string[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i].len
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const s = text.slice(start, end).trim()
    if (!s) return null
    statements.push(s)
  }
  return { material, statements }
}
