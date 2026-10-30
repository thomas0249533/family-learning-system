/**
 * 错因**建议**（V3.0 · M3）—— 给证据，不替人下结论
 * ---------------------------------------------------------------------
 * ## 为什么是"建议"而不是"自动归因"
 * `core/mistake/mistakeCause.ts` 的文件头写明了一条裁决：
 * **系统看得出对错，看不出为什么错；任何自动猜测都是把不确定性强加给家长。**
 * 这条裁决是对的，本文件**不推翻它**：
 *
 *   - 本文件只在**能拿出可核对证据**时才给建议（"答案带单位「克」，你只写了数字"）；
 *   - 建议永远**不写库**，界面上是一个「采纳」按钮，家长点了才落 `mistakeCause`；
 *   - 拿不出证据就返回 `null`（"不知道"比"编一个"好，见 mistakeCause.ts 的注释）。
 *
 * 这与"AI 诊断"（`core/ai/diagnosis.ts`，需要配置 Key、且可能离线不可用）互补：
 * 本文件**纯本地、零依赖、可断言**，覆盖最常见的四类机械错误。
 *
 * ## 为什么只认"机械错误"
 * 「粗心大意」这一类（抄错数、漏单位、拼错一个字母、顺序颠倒）能从**答案的差异**
 * 上被证明；「知识盲区」不能 —— 一道题答错且答案毫无相似性，既可能是没学会，
 * 也可能是完全看错题。所以本文件对「知识盲区」**不出建议**（除多空部分正确这种
 * 有明确证据的情形）。
 */

import type { MistakeCause } from './mistakeCause'

/** 具体证据类型（比 `MistakeCause` 细一层，用于文案与测试断言） */
export type CauseSignal =
  | 'empty'
  | 'unit-missing'
  | 'numeric-shift'
  | 'spelling'
  | 'order-swap'
  | 'partial'
  | 'unrelated'

export interface SuggestInput {
  /** 题型（`blank` / `single` / `judge` / `spelling` / `multiple` / `matching` / `essay`） */
  type?: string
  /** 标准答案（string 或多空数组） */
  correctAnswer?: unknown
  /** 孩子当时的作答 */
  userAnswer?: unknown
}

export interface CauseSuggestion {
  cause: MistakeCause
  signal: CauseSignal
  /** 给家长看的一句话证据（必须可核对：指出"哪里不一样"） */
  evidence: string
}

/** 常见单位后缀（长的排前面：先匹配「平方厘米」再匹配「厘米」） */
const UNITS = [
  '平方厘米',
  '平方分米',
  '平方米',
  '立方米',
  '千米',
  '千克',
  '毫米',
  '厘米',
  '分米',
  '毫升',
  '分钟',
  '小时',
  '吨',
  '克',
  '米',
  '升',
  '元',
  '角',
  '分',
  '个',
  '只',
  '条',
  '本',
  '页',
  '天',
  '秒',
  '位',
  '人',
  '棵',
  '朵',
].sort((a, b) => b.length - a.length)

function norm(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => String(x)).join(',')
  return String(v).trim()
}

/** 去掉空白与"纯格式"标点（判"是不是同一个东西"时不该被格式干扰）。
 *  **保留 ASCII 小数点 `.`** —— `4.8` 与 `48` 是不同答案，不能在归一化阶段被抹平。 */
function squash(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[，,。；;：:、!！?？"'“”‘’]/g, '')
    .toLowerCase()
}

/** 从答案里剥出单位（返回 [数值部分, 单位]，没有单位则单位为空） */
export function splitUnit(s: string): [string, string] {
  const t = s.trim()
  for (const u of UNITS) {
    if (t.length > u.length && t.endsWith(u)) {
      return [t.slice(0, t.length - u.length).trim(), u]
    }
  }
  return [t, '']
}

/** 数字串（只留 0-9 与小数点），非数字返回 null */
function digitsOf(s: string): string | null {
  const t = s.replace(/[\s,，]/g, '')
  if (!t) return null
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return t
}

/** 编辑距离 ≤ 1（英文拼写错误的最常见形态：漏/多/错一个字母） */
export function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return false
  const [s, t] = a.length <= b.length ? [a, b] : [b, a]
  if (t.length - s.length > 1) return false
  if (t.length === s.length) {
    let diff = 0
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] !== t[i]) diff += 1
      if (diff > 1) return false
    }
    return diff === 1
  }
  // 长度差 1：短串能否通过插入一个字符变成长串
  let i = 0
  let j = 0
  let skipped = false
  while (i < s.length && j < t.length) {
    if (s[i] === t[j]) {
      i += 1
      j += 1
      continue
    }
    if (skipped) return false
    skipped = true
    j += 1
  }
  return true
}

/**
 * 给出错因**建议**。拿不出证据时返回 `null`。
 *
 * 判定顺序即优先级：先排除"没做"，再看"格式差"（单位 / 数字 / 拼写 / 顺序），
 * 最后才看"多空部分正确"。顺序反过来会让"漏写单位"被误判成"部分正确"。
 */
export function suggestCause(input: SuggestInput): CauseSuggestion | null {
  const user = norm(input.userAnswer)
  const correctRaw = input.correctAnswer
  const type = (input.type ?? 'blank').toLowerCase()

  // ① 完全没作答：这是"没写完/漏做"，与会不会无关
  if (!squash(user)) {
    return { cause: 'careless', signal: 'empty', evidence: '这道题空着没写就交了' }
  }

  // ② 多空题：拆开逐空比对
  const correctParts = Array.isArray(correctRaw) ? correctRaw.map((x) => String(x)) : null
  const userParts = user.includes(',') || user.includes('，') ? user.split(/[,，]/).map((x) => x.trim()) : null

  if (correctParts && correctParts.length > 1) {
    const uParts = userParts ?? [user]
    let hit = 0
    for (let i = 0; i < correctParts.length; i += 1) {
      // **严格相等**才算命中：旧写法用 `includes` 会把「被减数」判成等于「减数」，
      // 于是"3 个空只对 2 个"被算成全对，部分正确的证据就消失了。
      const c = squash(correctParts[i] ?? '')
      const u = squash(uParts[i] ?? '')
      if (c && u && c === u) hit += 1
    }
    if (hit > 0 && hit < correctParts.length) {
      return {
        cause: 'knowledge',
        signal: 'partial',
        evidence: `${correctParts.length} 个空对了 ${hit} 个，其余几空没填对`,
      }
    }
  }

  const correct = norm(correctRaw)
  if (!correct) return null

  const uSquashed = squash(user)
  const cSquashed = squash(correct)
  if (uSquashed === cSquashed) return null // 判分口径不同导致的"错"，不建议归因

  // ③ 漏单位（答案带单位，孩子只写了数字）—— 数学填空题最高频的粗心
  const [cNum, cUnit] = splitUnit(correct)
  const [uNum, uUnit] = splitUnit(user)
  if (cUnit && !uUnit && squash(uNum) === squash(cNum)) {
    return {
      cause: 'careless',
      signal: 'unit-missing',
      evidence: `数值算对了，漏了单位「${cUnit}」`,
    }
  }

  // ④ 数字错位（小数点 / 抄错一位）。**必须早于"顺序颠倒"**：
  //    15174 写成 15147 的字符集合完全相同，先判顺序会得出"顺序颠倒"这个错结论。
  const cDigits = digitsOf(cNum)
  const uDigits = digitsOf(uNum)
  if (cDigits && uDigits && cDigits !== uDigits) {
    const cNoDot = cDigits.replace(/[.-]/g, '')
    const uNoDot = uDigits.replace(/[.-]/g, '')
    if (cNoDot === uNoDot) {
      return {
        cause: 'careless',
        signal: 'numeric-shift',
        evidence: `数字都对，但位数/小数点错了（你写 ${uNum}，正确是 ${cNum}）`,
      }
    }
    // 数字全都用上了但顺序/位置不对（15174 写成 15147）→ 抄错位，可证明
    if ([...cNoDot].sort().join('') === [...uNoDot].sort().join('')) {
      return {
        cause: 'careless',
        signal: 'numeric-shift',
        evidence: `数字都对，但抄错了位置（你写 ${uNum}，正确是 ${cNum}）`,
      }
    }
    // 位数相同、只有一个数字不同（如 15174 → 15194）
    if (cNoDot.length === uNoDot.length && cNoDot.length >= 3) {
      let diff = 0
      for (let i = 0; i < cNoDot.length; i += 1) if (cNoDot[i] !== uNoDot[i]) diff += 1
      if (diff === 1) {
        return {
          cause: 'careless',
          signal: 'numeric-shift',
          evidence: `只错了一个数字（你写 ${uNum}，正确是 ${cNum}）`,
        }
      }
    }
  }

  // ⑤ 顺序颠倒（如「加数」写成「数和」之外的排列）—— 只对**非纯数字**成立
  const sortChars = (s: string) => [...s].sort().join('')
  if (
    !cDigits &&
    !uDigits &&
    uSquashed.length > 1 &&
    sortChars(uSquashed) === sortChars(cSquashed)
  ) {
    return { cause: 'careless', signal: 'order-swap', evidence: '内容都写对了，但顺序颠倒了' }
  }

  // ⑥ 英文拼写差一个字母（只对拼写题 / 长度 ≥3 的英文答案；`A` vs `C` 这种不算拼写）
  const latin = /^[a-z][a-z\s'-]{2,}$/
  const isSpellType = type === 'spelling'
  if (isSpellType || (latin.test(cSquashed) && latin.test(uSquashed))) {
    if (latin.test(cSquashed) && latin.test(uSquashed) && isEditDistanceOne(uSquashed, cSquashed)) {
      return { cause: 'careless', signal: 'spelling', evidence: '拼写只差一个字母' }
    }
  }

  // ⑦ 判断 / 选择选错：答案只有两个/四个选项，判不出原因
  if (type === 'judge' || type === 'single' || type === 'multiple') {
    return null
  }

  // ⑧ 剩下的既不是格式差也没有明显相似性：不猜
  return null
}
