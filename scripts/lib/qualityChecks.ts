/**
 * 质量检查：只报警告，不阻断导入。
 * 用于引导内容生产遵循推荐写法。
 *
 * ## 码表约定（沿用既有）
 *
 * - `E0xx` = 错误，阻断导入，定义在 `@core/importer/normalizePackage`；
 * - `W0xx` = 警告，`W001`–`W020` 也在 normalizePackage 里（依赖去重等结构问题）；
 * - `W030`+ = **内容写法**警告，只在本文件产生，不进错误通道。
 *
 * ## W021 / W022 / W023（V1.11 Stage F · F3）
 *
 * 这三条是 V1.6 Stage D「多答案填空兼容空格与标点」的内容侧收口：App 判分内核
 * （`@core/quiz/blank`）已经能**判对**这些写法，但题库内容本身仍有异味 —— 异味
 * 只能靠生产工具扫出来，不能靠改判分内核（那会误伤正常答案）。
 *
 * **判定口径必须与判分内核一致**，否则会出现「校验说没问题、学生却答不对」：
 *
 * | 概念 | 本文件 | 判分内核对应物 |
 * |---|---|---|
 * | 答案段分隔符 | `SEGMENT_SPLIT_RE` | `ALT_SEGMENT_SPLIT_RE` |
 * | 斜杠备选 | `SLASH_ALT_RE`（两侧必须有空白） | `SLASH_ALT_RE` |
 *
 * 三条都是**纯判定函数**（输入一道题 / 一个答案，输出命中与否 + 证据字符串），
 * IO 与报告由 `scripts/validate*.ts` 负责 —— 便于在 `tests/` 里直接单测。
 */

import type { NormalizeIssue } from '../../src/core/importer/normalizePackage'

// ============================================================================
// 判定常量（改动前请先读文件头「判定口径必须与判分内核一致」）
// ============================================================================

/**
 * 答案段分隔符：半/全角逗号、顿号、分号。
 * 与 `@core/quiz/blank` 的 `ALT_SEGMENT_SPLIT_RE` 同口径 —— 空格**不是**段分隔符
 * （38 条「每空一词」的英文短语答案依赖这条，如 `When is` / `on weekends`）。
 */
export const SEGMENT_SPLIT_RE = /[,，、;；]+/

/** 单个并列分隔符字符（用于 W021 判断「元素里塞了分隔符」） */
export const SEPARATOR_CHAR_RE = /[,，、;；]/

/**
 * 斜杠备选：斜杠**两侧必须有空白**（`aren't / are not`）。
 * 与 `@core/quiz/blank` 的 `SLASH_ALT_RE` 同口径 —— 否则 `85 千米/时` 这类
 * 单位写法会被误切成两截。
 */
export const SLASH_ALT_RE = /\s+\/\s+/

/** 空白（含全角空格 \u3000）—— 用于「每空一词」复核时的词数统计 */
export const WHITESPACE_SPLIT_RE = /[\s\u3000]+/

/**
 * 空位标记的长度区间：连续下划线 3~24 个算一个空。
 *
 * - 下限 3：`__` 常出现在变量名 / 网址里，不算空位；
 * - 上限 24：书面表达题里那条 72 个下划线的**作文格**不是空位
 *   （`sprint-english-7-up-final` 的 `sprint-ex-090` 就是这种）。
 */
export const BLANK_MIN_UNDERSCORES = 3
export const BLANK_MAX_UNDERSCORES = 24

/**
 * W021 的短语长度上限（字符数）。
 *
 * 数组答案里塞了逗号的**长文本**是「解答题自由作答」，逗号是句读不是分隔符；
 * 只有短到像一个空的答案时，逗号才可能是「本该拆成两个元素」。实测全库 7 条
 * 命中里，4 条是 52~189 字的解答题，3 条是 5 字的并列短语（如 `全面、客观`），
 * 24 是这两簇之间的空档。
 */
export const W021_MAX_PHRASE_LEN = 24

/**
 * 参与文本答案检查的题型。
 * `judge`（T/F 数组）、`matching`（索引数组）的 answer 是结构化数据，
 * 不适用「分隔符 / 空位数」这套语义，一律跳过。
 */
export const TEXT_ANSWER_TYPES: readonly string[] = ['blank', 'spelling']

// ============================================================================
// 纯判定函数（可单测，无 IO）
// ============================================================================

/** 一次判定的结果：是否命中 + 人话证据 */
export interface CheckHit {
  hit: boolean
  evidence: string[]
}

/** W023 的判定结果 */
export interface BlankCountHit {
  /** 是否参与判定（题型不符 / 题干没有空位标记时 false） */
  applicable: boolean
  /** 是否命中（空位数 ≠ 答案段数，且不是「每空一词」写法） */
  hit: boolean
  /** 题干里的空位数 */
  blanks: number
  /** 答案段数（数组 = 元素个数；标量 = 按分隔符切出的段数） */
  segments: number
  /** 答案词数（按空白切分，用于「每空一词」复核） */
  words: number
}

/**
 * 把答案切成「段」—— 与判分内核同一口径。
 *
 * - 数组：每个元素就是一段（元素内部的 `，；、` 属于答案文本，见内核路径 A）；
 * - 标量：按 `SEGMENT_SPLIT_RE` 切，去首尾空白，丢空段。
 *
 * @param answer 任意答案值（string / string[] / number / null 都能吃下，不抛异常）
 */
export function splitAnswerSegments(answer: unknown): string[] {
  if (Array.isArray(answer)) {
    return answer.map((el) => String(el ?? '').trim()).filter((s) => s !== '')
  }
  return splitTopLevelSegments(String(answer ?? ''))
}

/**
 * 按 `SEGMENT_SPLIT_RE` 的分隔符切段，但**括号内的分隔符不算**。
 *
 * ## 为什么
 *
 * 判分内核（`@core/quiz/blank` 的 `splitCommaParts`）已经改成「括号保护」切段：
 * 答案 `6,省（直辖市、自治区）` 的**第 2 段**是 `省(直辖市,自治区)`，
 * 括号里的顿号是「同一空的并列备选之间」的分隔符，不是「第二个空」的分隔符。
 *
 * 校验脚本若还用无脑切，就会把这段数成 3 段 → 对一个**2 空**的题报 W023，
 * 制造噪音。**两处口径必须一致**，否则「校验说有问题、判分说没问题」。
 */
export function splitTopLevelSegments(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let buf = ''
  for (const ch of text) {
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1)
    if (depth === 0 && SEPARATOR_CHAR_RE.test(ch)) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf)
  return parts.map((s) => s.trim()).filter((s) => s !== '')
}

/** 答案段数 */
export function countAnswerSegments(answer: unknown): number {
  return splitAnswerSegments(answer).length
}

/** 答案词数（每段再按空白切一次）—— 用于「每空一词」复核 */
export function countAnswerWords(answer: unknown): number {
  return splitAnswerSegments(answer).reduce((n, seg) => {
    return n + seg.split(WHITESPACE_SPLIT_RE).filter((w) => w !== '').length
  }, 0)
}

/**
 * 数题干里有几个空位。
 *
 * 只认连续下划线，长度在 `[BLANK_MIN_UNDERSCORES, BLANK_MAX_UNDERSCORES]` 之间。
 * 超长的下划线串（作文格 / 书写线）不算空位。
 */
export function countStemBlanks(stem: unknown): number {
  const runs = String(stem ?? '').match(/_+/g) ?? []
  return runs.filter(
    (r) => r.length >= BLANK_MIN_UNDERSCORES && r.length <= BLANK_MAX_UNDERSCORES,
  ).length
}

/**
 * **W021** 数组答案的元素内含分隔符。
 *
 * 命中例：`["全面、客观", "全貌"]` —— 顿号把两个并列写法塞进了一个元素。
 * 不命中：`["甲", "乙"]`、标量 `"甲,乙"`（标量多段是本项目标准写法，不是异味）、
 * 长度超过 `W021_MAX_PHRASE_LEN` 或含换行的自由作答文本。
 */
export function checkArrayElementSeparator(answer: unknown): CheckHit {
  if (!Array.isArray(answer)) return { hit: false, evidence: [] }
  const evidence: string[] = []
  for (const el of answer) {
    const s = String(el ?? '')
    if (!SEPARATOR_CHAR_RE.test(s)) continue
    // 自由作答 / 解答题：换行与超长文本里的逗号是句读，不是分隔符
    if (s.includes('\n')) continue
    if (s.length > W021_MAX_PHRASE_LEN) continue
    evidence.push(s)
  }
  return { hit: evidence.length > 0, evidence }
}

/**
 * **W022** 斜杠备选答案（`aren't / are not`）。
 *
 * 判分内核支持这种写法（任写一个即判对），所以它只是**内容异味**：一道题有两个
 * 标准答案，而题干没说明「写出一种即可」。
 *
 * 只有「斜杠两侧都有空白」才算 —— `85 千米/时`、`/kæt/` 这类单位与音标不算。
 */
export function checkSlashAlternatives(answer: unknown): CheckHit {
  const evidence = splitAnswerSegments(answer).filter((seg) => SLASH_ALT_RE.test(seg))
  return { hit: evidence.length > 0, evidence }
}

/**
 * **W023** 题干空位数与答案段数不一致。
 *
 * 唯一「从题干真值出发」的检查 —— 题干写了几个空是硬事实，答案必须给出同样多段。
 *
 * 两条豁免（都是**无法判定就放行**，避免噪音淹没真问题）：
 * 1. 题干里没有空位标记（0 个）→ 无从比对，跳过；
 * 2. 段数 ≠ 空位数，但**按空白切出的词数 == 空位数** → 判为英语「每空一词」写法
 *    （`7:15 is ______ ______ seven.` + `"a quarter past"`），放行。
 *
 * @param ex 一道题（只看 type / question / answer 三个字段）
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
  // 题干没有空位标记 → 无从比对
  if (blanks === 0) return { ...base, applicable: false }
  // 段数对齐 —— 正常
  if (segments === blanks) return base
  // 「每空一词」：一个短语跨多个空
  if (words === blanks) return base

  return { ...base, hit: true }
}

// ============================================================================
// 遍历与报告（IO 无关，但产出 NormalizeIssue 供脚本打印）
// ============================================================================

/** 带路径的一道题（路径用于报告定位） */
export interface LocatedExercise {
  ex: any
  path: string
}

/**
 * 收集一个包里所有题目：顶层 `exercises` 池 + `units[].topics[].exercises`。
 * 两处都要扫 —— 现有内容两种写法并存。
 */
export function collectExercises(raw: any): LocatedExercise[] {
  const out: LocatedExercise[] = []
  const label = (ex: any, i: number): string =>
    typeof ex?.id === 'string' && ex.id ? ex.id : String(i)

  const topLevel = Array.isArray(raw?.exercises) ? raw.exercises : []
  topLevel.forEach((ex: any, i: number) => {
    if (ex && typeof ex === 'object') out.push({ ex, path: `exercises[${label(ex, i)}]` })
  })

  for (const u of Array.isArray(raw?.units) ? raw.units : []) {
    const uid = typeof u?.id === 'string' && u.id ? u.id : '?'
    for (const t of Array.isArray(u?.topics) ? u.topics : []) {
      const tid = typeof t?.id === 'string' && t.id ? t.id : '?'
      const list = Array.isArray(t?.exercises) ? t.exercises : []
      list.forEach((ex: any, i: number) => {
        if (ex && typeof ex === 'object') {
          out.push({ ex, path: `units[${uid}].topics[${tid}].exercises[${label(ex, i)}]` })
        }
      })
    }
  }
  return out
}

export function qualityChecks(raw: any): NormalizeIssue[] {
  const warnings: NormalizeIssue[] = []
  const pkgId = raw?.manifest?.packageId ?? '?'

  // ---------- W030：题目写在顶层 exercises 池 ----------
  if (Array.isArray(raw.exercises) && raw.exercises.length > 0) {
    warnings.push({
      level: 'warning',
      code: 'W030',
      path: 'exercises',
      message: `包 ${pkgId} 有 ${raw.exercises.length} 道题写在顶层 exercises，建议移到对应 topic.exercises`,
      hint: '推荐写法：题目放在 topic.exercises 里，让打包脚本和渲染逻辑更清晰',
    })
  }

  // ---------- W031：topic 没有 modules ----------
  for (const u of raw.units ?? []) {
    for (const t of u.topics ?? []) {
      if (!Array.isArray(t.modules) || t.modules.length === 0) {
        warnings.push({
          level: 'warning',
          code: 'W031',
          path: `units[${u.id}].topics[${t.id}].modules`,
          message: `topic ${t.id} 没有 modules，将依赖知识点类型自动渲染`,
          hint: '推荐写法：每个 topic 至少声明 1 个 module.type',
        })
      }
    }
  }

  // ---------- W032：知识点 ID 已带 :: 前缀 ----------
  for (const kp of raw.knowledgePoints ?? []) {
    if (typeof kp.id === 'string' && kp.id.includes('::')) {
      warnings.push({
        level: 'warning',
        code: 'W032',
        path: `knowledgePoints`,
        message: `知识点 ID 已带 :: 前缀（如 ${kp.id}），引擎一应输出裸 ID`,
        hint: '前缀由打包脚本自动加，引擎一不要手写',
      })
      break
    }
  }

  // ---------- W033：题目 ID 已带 :: 前缀 ----------
  outer:
  for (const u of raw.units ?? []) {
    for (const t of u.topics ?? []) {
      for (const ex of t.exercises ?? []) {
        if (typeof ex.id === 'string' && ex.id.includes('::')) {
          warnings.push({
            level: 'warning',
            code: 'W033',
            path: `units[${u.id}].topics[${t.id}].exercises`,
            message: `题目 ID 已带 :: 前缀（如 ${ex.id}），引擎一应输出裸 ID`,
            hint: '前缀由打包脚本自动加，引擎一不要手写',
          })
          break outer
        }
      }
    }
  }

  // ---------- W021 / W022 / W023：答案写法与空位数（V1.11 Stage F · F3） ----------
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

  return warnings
}
