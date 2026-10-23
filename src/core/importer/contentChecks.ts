/**
 * contentChecks.ts —— 浏览器侧内容写法校验（V2.2 轨道 I · Creator 预览）。
 * =====================================================================
 * 移植自 `scripts/lib/qualityChecks.ts` 的 W021 / W022 / W023 三条内容写法
 * 警告，使之能在浏览器（Creator 实时预览）里直接跑，无需 Node 环境。
 *
 * 铁律：
 *   · 错误码与文案必须与 Node 版**逐字一致**（主代理的门禁会跨端比对）；
 *   · 本模块**只引入类型**、不引入任何 Node / 浏览器独有 API（纯函数），
 *     因此可被 `src/**`（vue-tsc）和 `tests/**` 同时引用；
 *   · 新增校验码务必避开 W021–W023 与 W030–W033 区间（见 qualityChecks.ts 头）。
 *
 * 注意：importService.ts 里另有一个含义不同的 W021（"依赖包未在本地找到"，
 * path = `manifest.dependencies`），那是导入警告，不要与这里的"内容写法警告"混淆。
 * 本模块产出的 W021 path 形如 `units[u].topics[t].exercises[i]`。
 */

import type { NormalizeIssue } from './normalizePackage'

// ============================================================================
// 判定常量（与 @core/importer 的判分内核 / qualityChecks 同口径）
// ============================================================================

/** 答案段分隔符：半/全角逗号、顿号、分号（空格不是段分隔符） */
export const SEGMENT_SPLIT_RE = /[,，、;；]+/

/** 单个并列分隔符字符（用于 W021 判断「元素里塞了分隔符」） */
export const SEPARATOR_CHAR_RE = /[,，、;；]/

/** 斜杠备选：斜杠两侧必须有空白（如 `aren't / are not`），单位/音标不算 */
export const SLASH_ALT_RE = /\s+\/\s+/

/** 空白（含全角空格 \u3000）—— 用于「每空一词」复核时的词数统计 */
export const WHITESPACE_SPLIT_RE = /[\s\u3000]+/

/** 空位标记长度区间：连续下划线 3~24 个算一个空 */
export const BLANK_MIN_UNDERSCORES = 3
export const BLANK_MAX_UNDERSCORES = 24

/** W021 的短语长度上限（字符数）—— 超过视为自由作答，逗号是句读不是分隔符 */
export const W021_MAX_PHRASE_LEN = 24

/** 参与文本答案检查的题型（judge/matching 的 answer 是结构化数据，跳过） */
export const TEXT_ANSWER_TYPES: readonly string[] = ['blank', 'spelling']

// ============================================================================
// 纯判定函数（可单测，无 IO）
// ============================================================================

export interface CheckHit {
  hit: boolean
  evidence: string[]
}

export interface BlankCountHit {
  applicable: boolean
  hit: boolean
  blanks: number
  segments: number
  words: number
}

/** 把答案切成「段」—— 与判分内核同一口径 */
export function splitAnswerSegments(answer: unknown): string[] {
  if (Array.isArray(answer)) {
    return answer.map((el) => String(el ?? '').trim()).filter((s) => s !== '')
  }
  return String(answer ?? '')
    .split(SEGMENT_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function countAnswerSegments(answer: unknown): number {
  return splitAnswerSegments(answer).length
}

export function countAnswerWords(answer: unknown): number {
  return splitAnswerSegments(answer).reduce((n, seg) => {
    return n + seg.split(WHITESPACE_SPLIT_RE).filter((w) => w !== '').length
  }, 0)
}

/** 数题干里有几个空位（只认长度在 [3,24] 的连续下划线） */
export function countStemBlanks(stem: unknown): number {
  const runs = String(stem ?? '').match(/_+/g) ?? []
  return runs.filter(
    (r) => r.length >= BLANK_MIN_UNDERSCORES && r.length <= BLANK_MAX_UNDERSCORES,
  ).length
}

/**
 * **W021** 数组答案的元素内含分隔符。
 * 命中例：`["全面、客观", "全貌"]`；不命中：`["甲","乙"]`、标量 `"甲,乙"`、超长/换行文本。
 */
export function checkArrayElementSeparator(answer: unknown): CheckHit {
  if (!Array.isArray(answer)) return { hit: false, evidence: [] }
  const evidence: string[] = []
  for (const el of answer) {
    const s = String(el ?? '')
    if (!SEPARATOR_CHAR_RE.test(s)) continue
    if (s.includes('\n')) continue
    if (s.length > W021_MAX_PHRASE_LEN) continue
    evidence.push(s)
  }
  return { hit: evidence.length > 0, evidence }
}

/**
 * **W022** 斜杠备选答案（`aren't / are not`）。仅「两侧都有空白」才算。
 */
export function checkSlashAlternatives(answer: unknown): CheckHit {
  const evidence = splitAnswerSegments(answer).filter((seg) => SLASH_ALT_RE.test(seg))
  return { hit: evidence.length > 0, evidence }
}

/**
 * **W023** 题干空位数与答案段数不一致。
 * 豁免：题干无空位标记，或「每空一词」写法（词数 == 空位数）。
 */
export function checkBlankCountMismatch(ex: {
  type?: unknown
  question?: unknown
  answer?: unknown
}): BlankCountHit {
  const blanks = countStemBlanks(ex?.question)
  const segments = countAnswerSegments(ex?.answer)
  const words = countAnswerWords(ex?.answer)
  const base: BlankCountHit = { applicable: true, hit: false, blanks, segments, words }

  if (!TEXT_ANSWER_TYPES.includes(String(ex?.type ?? ''))) {
    return { ...base, applicable: false }
  }
  if (blanks === 0) return { ...base, applicable: false }
  if (segments === blanks) return base
  if (words === blanks) return base

  return { ...base, hit: true }
}

// ============================================================================
// 遍历与报告（产出 NormalizeIssue 供 Creator 预览展示）
// ============================================================================

export interface LocatedExercise {
  ex: any
  path: string
}

/** 收集一个包里所有题目：topic.exercises（Creator 只产这种结构） */
export function collectExercises(raw: any): LocatedExercise[] {
  const out: LocatedExercise[] = []
  const units = Array.isArray(raw?.units) ? raw.units : []
  units.forEach((u: any, ui: number) => {
    const topics = Array.isArray(u?.topics) ? u.topics : []
    topics.forEach((t: any, ti: number) => {
      const list = Array.isArray(t?.exercises) ? t.exercises : []
      list.forEach((ex: any, ei: number) => {
        if (ex && typeof ex === 'object') {
          out.push({ ex, path: `units[${ui}].topics[${ti}].exercises[${ei}]` })
        }
      })
    })
  })
  return out
}

/**
 * 跑 W021/W022/W023，返回 NormalizeIssue[]（仅 warning 级别）。
 * 文案与 scripts/lib/qualityChecks.ts 逐字一致。
 */
export function runContentChecks(raw: any): NormalizeIssue[] {
  const warnings: NormalizeIssue[] = []
  const pkgId = raw?.manifest?.packageId ?? '?'

  for (const { ex, path } of collectExercises(raw)) {
    const type = typeof ex?.type === 'string' ? ex.type : ''
    if (!TEXT_ANSWER_TYPES.includes(type)) continue
    const exLabel = typeof ex?.id === 'string' && ex.id ? ex.id : path

    const w021 = checkArrayElementSeparator(ex.answer)
    if (w021.hit) {
      warnings.push({
        level: 'warning',
        code: 'W021',
        path,
        message: `题目 ${exLabel} 的数组答案里有元素自带分隔符：${w021.evidence.map((s) => `「${s}」`).join('、')}`,
        hint: '一个元素应当只填一个空；并列写法请用斜杠备选（全面 / 客观），或拆成数组的两个元素',
      })
    }

    const w022 = checkSlashAlternatives(ex.answer)
    if (w022.hit) {
      warnings.push({
        level: 'warning',
        code: 'W022',
        path,
        message: `题目 ${exLabel} 的答案用了斜杠备选：${w022.evidence.map((s) => `「${s}」`).join('、')}`,
        hint: '判分内核允许任写一个，但建议二选一定稿；确需保留时请在题干注明「写出一种即可」',
      })
    }

    const w023 = checkBlankCountMismatch(ex)
    if (w023.hit) {
      warnings.push({
        level: 'warning',
        code: 'W023',
        path,
        message: `题目 ${exLabel} 的题干有 ${w023.blanks} 个空，答案却是 ${w023.segments} 段`,
        hint: '标准写法：几个空就写几段，用逗号分隔或写成数组；「每空一词」的英文短语请确认空位数与词数一致',
      })
    }
  }

  // 避免未使用变量告警（pkgId 预留给未来路径精化）
  void pkgId
  return warnings
}
