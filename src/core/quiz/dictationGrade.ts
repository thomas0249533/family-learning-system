/**
 * 听写判分（P1）。
 *
 * 与 `blank.ts` 的六通道判分是**两套不同语义**，不要合并：
 * - `gradeBlank` 服务的是「填空/默写题」，答案侧可能带单位、括号并列、斜杠备选，
 *   需要宽松通道去兜住命题时的书写差异；
 * - 听写服务的是「老师说一个词、孩子写下来」，判分对象是**孩子的手写产物**，
 *   只该容忍"不影响辨识"的差异：大小写、首尾空白、词间多余空格、句末标点。
 *
 * 刻意**不**放宽的三件事（放宽会掩盖真实错误）：
 * 1. 词中间缺空格（`getup` vs `get up`）——这是真的听漏了；
 * 2. 拼写近似（`recieve` vs `receive`）——听写就是要抓这个；
 * 3. 词内标点（`P.E.` vs `PE`）——保持严格，由命题侧在答案里写全称。
 *
 * 纯函数，无副作用，便于单测（本项目 vitest 无 jsdom，组件层只做静态校验）。
 */

/** 句末标点：只剥末尾，中间标点有语义（如 `What's` 的撇号）不动 */
const TRAILING_PUNCT = /[.,!?;:。，！？；：、]+$/u

/**
 * 归一化：去首尾空白 → 转小写 → 合并连续空白 → 剥句末标点。
 *
 * 空白合并要把全角空格（U+3000）也算作空白：中文输入法在词间常打全角空格，
 * 那属于输入习惯而非知识错误。`\s` 在 JS 正则里已包含 U+3000。
 */
export function normalizeDictation(text: string): string {
  if (typeof text !== 'string') return ''
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(TRAILING_PUNCT, '')
    .trim()
}

/**
 * 听写判定。
 *
 * 空答案一律判错（`''` 与 `''` 相等，但"没写"不该算对）。
 */
export function gradeDictation(input: string, expected: string): boolean {
  const a = normalizeDictation(input)
  const b = normalizeDictation(expected)
  if (!a || !b) return false
  return a === b
}
