/**
 * 主观题（essay）与"标为主观的填空/拼写"判分内核（纯函数 · 可单测）。
 *
 * ## 为什么需要它
 *
 * 语文阅读主观题换种说法就与标准答案不一致，精确匹配永远判错——
 * 孩子 4 道题里主观题基本拿不到分。本模块把参考答案拆成"得分点/关键词"，
 * 按**覆盖度**判分：
 *
 * - 作者显式给 `keyPoints`（最准）→ 直接用作得分点；
 * - 否则从参考答案**自动抽取**得分点（按句/子句切分，过滤过短碎片）；
 * - 学生作答覆盖了足够比例的得分点 → 判✅；并高亮"漏了哪几个点"作为提示。
 *
 * 另加一条**整段语义相似度**回退（二元组 Jaccard），捕捉"大体内容一致但换了说法"
 * 的情况，让离线判分更贴近"关键词和大体内容一致就判对"。
 *
 * ## 与学习内核的边界
 *
 * 返回 `correct: boolean` —— `AnswerPayload.isCorrect` 只接受布尔，FSRS / BKT /
 * 错题三级 / 成就全部挂在它上面。本模块**不做部分分**（同 `@core/quiz/judge.ts`
 * 与 `@core/quiz/blank.ts` 的取舍）：覆盖达标即 true，否则 false。
 *
 * ## 可单测
 *
 * 本机 `vitest` 是 `environment: 'node'` 且无 jsdom / @vue/test-utils，SFC 内部
 * 函数测不到。判分内核抽到本文件，回归由 `tests/essay-grade.test.ts` 锁死。
 */

export interface EssayGradeResult {
  /** 是否判对（覆盖度达标 或 整段相似度达标） */
  correct: boolean
  /** 命中的得分点数量 */
  covered: number
  /** 得分点总数 */
  total: number
  /** 未命中的得分点（用于"你漏了哪几点"提示） */
  missing: string[]
  /** 实际参与判分的得分点列表（作者显式 or 自动抽取） */
  keyPoints: string[]
}

/** 句/子句切分：句号、感叹号、问号、分号、省略号、换行 */
const SENT_SPLIT_RE = /[。！？!?；;…\n]+/
/** 句内细分：顿号、逗号（如"比喻、拟人、排比"） */
const INNER_SPLIT_RE = /[、，,]+/
/** 归一化时删除的标点/空白（中英文通用） */
const PUNCT_RE = /[，。！？、；：,.;:!?（）()\s]/g

/** 前缀动词（"使用了/运用了/运用/用了…"）与后缀通用名词（"的修辞手法/修辞/手法…"） */
const LEAD_VERB_RE = /^(使用了|运用了?|用了|采用了?|通过|以|把|将)/
const TRAIL_GENERIC_RE = /(的修辞手法|修辞手法|修辞|手法|的写法|写法|方法|的修辞)$/

/** 小写 + 去标点空白，用于包含判断与相似度 */
function norm(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(PUNCT_RE, '')
}

/** 清理一个片段：去掉引导动词与后缀通用修辞名词，露出核心关键词 */
function cleanFragment(s: string): string {
  let t = String(s ?? '').trim()
  t = t.replace(LEAD_VERB_RE, '')
  t = t.replace(TRAIL_GENERIC_RE, '')
  return t.trim()
}

/**
 * 从参考答案抽取得分点。
 *
 * - 作者显式 `keyPoints` 优先（最准，且可带 `/` 同义备选，如 `"比喻/比拟"`）；
 * - 否则按句切分；句内若含顿号/逗号则再细分（"使用了比喻、拟人、排比的修辞手法"
 *   先拆成 3 段再各去掉"使用了"/"的修辞手法"前缀后缀 → `比喻`/`拟人`/`排比`）；
 * - 过滤掉归一化后 < 2 字符的碎片；去重（保留首次出现顺序）。
 */
export function extractKeyPoints(reference: string, explicit?: string[]): string[] {
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map((s) => String(s).trim()).filter(Boolean)
  }
  const text = String(reference ?? '').trim()
  if (!text) return []

  const sentences = text.split(SENT_SPLIT_RE).map((s) => s.trim()).filter(Boolean)
  const points: string[] = []
  for (const sent of sentences) {
    const sub = sent
      .split(INNER_SPLIT_RE)
      .map(cleanFragment)
      .map((x) => x.trim())
      .filter((x) => norm(x).length >= 2)
    if (sub.length >= 1) points.push(...sub)
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const p of points) {
    const n = norm(p)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(p)
  }
  return out
}

/**
 * 单个得分点是否被学生作答覆盖。
 * - 同义备选：`/` 或 `／` 分隔，命中其一即可（如 "比喻/比拟"）；
 * - 双向包含：学生作答含得分点（正常），或得分点含学生作答（学生只写了关键词，
 *   如得分点"使用了比喻" vs 学生"比喻"）均算命中。双方均要求 ≥2 字符，避免单字误判。
 */
function pointCovered(userNorm: string, point: string): boolean {
  const pn = norm(point)
  if (!pn) return false
  const alts = pn.split(/\s*[\/／]\s*/)
  return alts.some((a) => {
    if (a.length < 2) return false
    if (userNorm.includes(a)) return true
    if (userNorm.length >= 2 && a.includes(userNorm)) return true
    return false
  })
}

/** 字符二元组集合（中文语义相似度用） */
function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

/**
 * 整段语义相似度（二元组 Jaccard）。用于"大体内容一致但换了说法"的回退判分。
 * 返回 0~1；空串返回 0；完全相同返回 1。
 *
 * 注意：这里**不做** `includes` 短路——否则"要点一"这种片段答案会因被参考答案
 * 包含而误判为对（覆盖度已逐点处理包含关系）。子串判定只在 `gradeEssay` 的
 * "无得分点"分支单独保留。
 */
export function similarity(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const A = bigrams(na)
  const B = bigrams(nb)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}

/**
 * 主观题判分。
 *
 * @param userAnswer 学生作答
 * @param reference 参考答案（标准答案文本）
 * @param keyPoints 可选显式得分点；缺省从 reference 自动抽取
 * @param threshold 覆盖度阈值（0~1），默认 0.6
 * @param simThreshold 整段相似度回退阈值（0~1），默认 0.7
 */
export function gradeEssay(
  userAnswer: string,
  reference: string,
  keyPoints?: string[],
  threshold = 0.6,
  simThreshold = 0.7,
): EssayGradeResult {
  const points = extractKeyPoints(reference, keyPoints)
  const userNorm = norm(userAnswer)

  // 空作答直接判错
  if (userNorm.length === 0) {
    return { correct: false, covered: 0, total: points.length, missing: points, keyPoints: points }
  }

  // 无可用得分点（参考答案极短）→ 回退到整段包含 / 相似度
  if (points.length === 0) {
    const refNorm = norm(reference)
    const sim = similarity(userAnswer, reference)
    const correct =
      refNorm.length > 0 && (userNorm.includes(refNorm) || refNorm.includes(userNorm) || sim >= simThreshold)
    return {
      correct,
      covered: correct ? 1 : 0,
      total: 1,
      missing: correct ? [] : [reference],
      keyPoints: [reference],
    }
  }

  const missing: string[] = []
  let covered = 0
  for (const p of points) {
    if (pointCovered(userNorm, p)) covered++
    else missing.push(p)
  }

  const ratio = covered / points.length
  // 整段语义相似度回退：大体内容一致（换说法）也算对
  const sim = similarity(userAnswer, reference)

  const correct = (ratio >= threshold && covered > 0) || sim >= simThreshold
  return {
    correct,
    // covered 始终为真实命中数（用于"命中 X/total"展示，不虚高）
    covered,
    total: points.length,
    // 判对时不再标红漏掉的得分点（已达标）；判错时才列出 missing 供对照
    missing: correct ? [] : missing,
    keyPoints: points,
  }
}
