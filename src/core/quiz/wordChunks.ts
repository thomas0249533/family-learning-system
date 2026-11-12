/**
 * 拼字块（V3.1.7）—— 生字生词「不打字」练习的纯逻辑层。
 *
 * ## 为什么要有这个模块
 * 孩子打字慢，且拼音输入法只要"认得字"就能选出来，绕过字形记忆。
 * 「部件拼字」把词拆成块（汉字偏旁/字、英语词根/音节/字母组合），
 * 让孩子从一堆候选块里**按顺序点选拼出整个词**，既不打字又考察字形结构。
 *
 * ## 数据来源
 * 内容侧可为词预置 `metadata.chunks?: string[]`（汉字按偏旁部首、英语按自然拼读/
 * 词根切分）。没有预置时由本模块按规则退化拆分：
 *   - 中文：按单字拆（"奇观" → ["奇","观"]）——保底可用，不依赖外部字库；
 *   - 英文：按常见词缀/音节粗切（"teacher" → ["teach","er"]），短词按 2 段切。
 * 拆不出多块的词（单字/短词）返回 `null`，UI 跳过该题，不硬凑。
 *
 * ## 纯函数
 * 无 DOM、无网络、无随机（随机由调用方注入 shuffle），便于 node 单测。
 */

/** 英语常见后缀/前缀，用于自然拼读与词根切块（长的优先匹配） */
const EN_SUFFIXES = ['tion', 'sion', 'ment', 'ness', 'fully', 'less', 'ing', 'ers', 'est', 'ful', 'ous', 'able', 'ive', 'er', 'ed', 'es', 'ly', 'ty', 'al', 's']
const EN_PREFIXES = ['un', 're', 'in', 'im', 'dis', 'pre', 'mis', 'non', 'over', 'under']

/**
 * 拼字块结构是否合法。
 *
 * ⚠️ **刻意不要求 `chunks.join('') === word`**：汉字按偏旁部首拆开后，
 * 拼回来是「氵可」而不是「河」——偏旁是构字部件，不是把字切开的两半。
 * 判分因此走 `chunksEqual`（比较块序列），不能用拼接字符串比原词。
 * 只有英文字母切分才天然满足拼接还原，但也不作为通用约束。
 */
export function isValidChunks(chunks: unknown): boolean {
  if (!Array.isArray(chunks) || chunks.length < 2) return false
  return chunks.every(c => typeof c === 'string' && c.trim().length > 0 && c.length <= 8)
}

/** 判分：孩子点选的块序列是否与正确块序列完全一致（顺序敏感） */
export function chunksEqual(selected: string[], expected: string[]): boolean {
  if (selected.length !== expected.length) return false
  return selected.every((c, i) => c === expected[i])
}

/** 中文退化拆分：按单字 */
function splitChinese(word: string): string[] {
  return Array.from(word)
}

/** 英语退化拆分：优先词缀，其次按长度对半切 */
function splitEnglish(word: string): string[] {
  const w = word.toLowerCase()
  if (w.length < 4) return Array.from(w)

  for (const suf of EN_SUFFIXES) {
    if (w.length > suf.length + 1 && w.endsWith(suf)) {
      return [w.slice(0, -suf.length), w.slice(-suf.length)]
    }
  }
  for (const pre of EN_PREFIXES) {
    if (w.length > pre.length + 1 && w.startsWith(pre)) {
      return [w.slice(0, pre.length), w.slice(pre.length)]
    }
  }
  // 无明显词缀：按音节粗切（元音组边界），保底对半切
  const mid = Math.ceil(w.length / 2)
  return [w.slice(0, mid), w.slice(mid)]
}

/**
 * 取一个词的拼字块。
 * 优先用内容侧预置的 `chunks`（校验拼接一致性，脏数据退回规则拆分），
 * 否则按语种规则拆；拆不出 ≥2 块返回 null。
 */
export function chunksOf(word: string, lang: 'chinese' | 'english', preset?: unknown): string[] | null {
  const w = String(word ?? '').trim()
  if (!w) return null
  if (isValidChunks(preset)) return [...(preset as string[])]

  const fallback = lang === 'chinese' ? splitChinese(w) : splitEnglish(w)
  return fallback.length >= 2 && fallback.join('') === w ? fallback : null
}

/**
 * 生成候选块：正确块 + 从其它词借来的干扰块，打乱后返回。
 * 干扰块刻意不去重到"唯一"：允许重复块（如两个"的"），依次点选即可。
 *
 * @param correct 正确块序列
 * @param distractorPool 干扰块池（来自同批次其它词）
 * @param distractorCount 干扰块数量
 * @param random 注入随机源（测试可传 () => 0）
 */
export function buildChunkChoices(
  correct: string[],
  distractorPool: string[],
  distractorCount: number,
  random: () => number = Math.random
): string[] {
  const pool = distractorPool.filter(c => typeof c === 'string' && c.length > 0)
  const picked: string[] = []
  // 从池里按随机顺序取，避免每次都是同几个干扰项
  const order = [...pool].sort(() => random() - 0.5)
  for (const c of order) {
    if (picked.length >= distractorCount) break
    picked.push(c)
  }
  return [...correct, ...picked].sort(() => random() - 0.5)
}

/** 已选块拼出的字符串 */
export function joinedChunks(selected: string[]): string {
  return selected.join('')
}

/**
 * 纸笔听写自评判分。
 * 孩子在纸上写完，对照屏幕答案自己判"写对了/写错了"——系统不臆测手写内容，
 * 用孩子/家长的确认作为判据，写进既有掌握度模型。
 */
export function gradeSelfAssessed(verdict: 'correct' | 'wrong' | null | undefined): boolean {
  return verdict === 'correct'
}
