/**
 * 专题练习断点（`topicSessions`）的**纯函数层**（V2.0 · 轨道 B）
 *
 * ## 为什么单独成文件、且不 import db
 * 断点续传最容易出错的地方不是"存不进去"，而是**恢复时把一段对不上的进度当真**：
 * 题库更新了、题目顺序变了、行是半截写入的 —— 这些在页面上只会表现为
 * "继续上次之后题号错位 / 判分全错"，而且不会报错。
 * 所以恢复判据必须能单测、必须能把腐坏行**判成 null**，而不是在
 * `TopicDetail.vue` 里写一堆 `if`（SFC 在本仓不可单测，vitest 是 node 环境）。
 *
 * 三条纪律：
 * 1. **不碰 db**：本文件只做形状与不变量，不 import `@/db` 的运行时（只 import 类型）。
 * 2. **不读时钟**：`Date.now()` 一律由调用方以 `now` 传入 —— 否则快照不可复现，
 *    测试只能断言"updatedAt 是个字符串"这种废话。
 * 3. **腐坏一律返回 `null`，绝不 throw**：调用方的兜底是"静默从头开始"，
 *    它不能被一个畸形行打成白屏。
 */

import type { TopicSessionRecord } from '@/db'

/** 单题作答：与 `QuizEngine` 的 `initialAnswers` 逐字段同形（少一次转换就少一处漂移） */
export interface TopicAnswer {
  userAnswer: any
  isCorrect: boolean
}

export type TopicAnswers = Record<string, TopicAnswer>

export interface SnapshotInput {
  /** 归属档案：唯一来源 `currentProfileId()` */
  profileId: string
  packageId: string
  topicId: string
  /** 当前这一次练习的题目 id，**顺序即题号** */
  questionIds: string[]
  answers?: TopicAnswers
  currentIndex?: number
  /** 已有行沿用它的开始时间（"从头开始"时不要传） */
  startedAt?: string
  status?: TopicSessionRecord['status']
  /** 已有行的主键（upsert 时带上，避免出现第二行 ongoing） */
  id?: number
  /** 由调用方传入的"现在"（ISO 串），本文件不读时钟 */
  now: string
}

/** 是不是"普通对象"（排除 null / 数组 / Date 之类） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== ''
}

/** 把任意数字夹到 `[0, max]`；非有限数按 0 处理。`max < 0`（空题库）时给 0 */
function clampIndex(v: unknown, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
  if (max < 0) return 0
  if (n < 0) return 0
  return n > max ? max : n
}

/**
 * 组装一条可落库的快照（写路径）。
 *
 * 这里也做最小归一（题号数组去重、`currentIndex` 夹取），因为它同时被
 * "首次写入"和"去抖更新"调用 —— 让两条路径共用一份形状，比在两个调用点
 * 各写一遍 `totalCount: questions.length` 可靠。
 */
export function buildSnapshot(input: SnapshotInput): TopicSessionRecord {
  const questionIds: string[] = []
  for (const id of input.questionIds ?? []) {
    if (isNonEmptyString(id) && !questionIds.includes(id)) questionIds.push(id)
  }

  const answers: TopicAnswers = {}
  if (isPlainObject(input.answers)) {
    for (const [qid, ans] of Object.entries(input.answers)) {
      if (!questionIds.includes(qid) || !isPlainObject(ans)) continue
      answers[qid] = { userAnswer: ans.userAnswer, isCorrect: ans.isCorrect === true }
    }
  }

  const snapshot: TopicSessionRecord = {
    profileId: input.profileId,
    packageId: input.packageId,
    topicId: input.topicId,
    questionIds,
    answers,
    currentIndex: clampIndex(input.currentIndex, questionIds.length - 1),
    totalCount: questionIds.length,
    startedAt: isNonEmptyString(input.startedAt) ? input.startedAt : input.now,
    updatedAt: input.now,
    status: input.status === 'finished' ? 'finished' : 'ongoing',
  }
  if (typeof input.id === 'number') snapshot.id = input.id
  return snapshot
}

/**
 * 校验一条从库里读出来的行**能不能用来续传**（读路径的闸门）。
 *
 * 判据（任一不满足 → `null`，调用方静默从头开始）：
 *   - 行的基本字段齐全且类型正确（`profileId` 非空、`questionIds` 是字符串数组…）
 *   - `questionIds` 与当前题库**逐位一致**（长度 + 每个 id）。顺序也必须一致：
 *     题号 = 下标，重排过的题库会让"第 7 题"指向另一道题，续上比不续更糟。
 *   - `totalCount === questionIds.length`
 *   - `currentIndex` 是整数且在 `[0, totalCount - 1]` 内
 *   - `answers` 是对象，且每一项都带布尔 `isCorrect`
 */
export function validateSnapshot(
  row: unknown,
  currentQuestionIds: string[]
): TopicSessionRecord | null {
  if (!isPlainObject(row)) return null

  const { profileId, packageId, topicId, questionIds, answers, currentIndex, totalCount } = row
  if (!isNonEmptyString(profileId)) return null
  if (!isNonEmptyString(packageId)) return null
  if (!isNonEmptyString(topicId)) return null

  if (!Array.isArray(questionIds) || questionIds.length === 0) return null
  if (!questionIds.every((id) => isNonEmptyString(id))) return null
  if (!Array.isArray(currentQuestionIds) || currentQuestionIds.length !== questionIds.length) {
    return null
  }
  for (let i = 0; i < questionIds.length; i++) {
    if (questionIds[i] !== currentQuestionIds[i]) return null
  }

  if (typeof totalCount !== 'number' || totalCount !== questionIds.length) return null
  if (typeof currentIndex !== 'number' || !Number.isInteger(currentIndex)) return null
  if (currentIndex < 0 || currentIndex > questionIds.length - 1) return null

  if (!isPlainObject(answers)) return null
  const cleanAnswers: TopicAnswers = {}
  for (const [qid, ans] of Object.entries(answers)) {
    if (!isPlainObject(ans)) return null
    if (typeof ans.isCorrect !== 'boolean') return null
    // 题库里没有的题号是"上一次题库的残留"，不是腐坏 —— 丢掉即可（不影响题号）
    if (!questionIds.includes(qid)) continue
    cleanAnswers[qid] = { userAnswer: ans.userAnswer, isCorrect: ans.isCorrect }
  }

  const status = row.status
  if (status !== 'ongoing' && status !== 'finished') return null
  if (!isNonEmptyString(row.startedAt) || !isNonEmptyString(row.updatedAt)) return null

  const out: TopicSessionRecord = {
    profileId,
    packageId,
    topicId,
    questionIds: [...questionIds],
    answers: cleanAnswers,
    currentIndex,
    totalCount,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    status,
  }
  if (typeof row.id === 'number') out.id = row.id
  return out
}

/**
 * 把一次作答并进答案表（**纯函数，返回新对象**）。
 *
 * 为什么不做原地修改：调用方是 Vue 的 `ref`，原地 `answers[qid] = …` 不会触发
 * 依赖更新（同一个对象引用），页面上"已作答 x 题"就会停在旧数字上。
 * 空的 `qid` 直接忽略 —— 宁可少记一题，也不要在答案表里塞一个空键。
 */
export function accumulateAnswer(
  answers: TopicAnswers | null | undefined,
  qid: string,
  payload: TopicAnswer
): TopicAnswers {
  const base: TopicAnswers = isPlainObject(answers) ? { ...(answers as TopicAnswers) } : {}
  if (!isNonEmptyString(qid) || !isPlainObject(payload)) return base
  base[qid] = { userAnswer: payload.userAnswer, isCorrect: payload.isCorrect === true }
  return base
}

export interface TopicProgress {
  /** 已作答题数 */
  answered: number
  /** 总题数 */
  total: number
  /** 已作答占比（0~100 的整数，用于进度条宽度） */
  percent: number
  /** 上次停在第几题（0 基） */
  currentIndex: number
}

/**
 * 进度读数（弹窗文案"当前进度 x/y"与进度条共用）。
 *
 * `answered` 数的是**答案表里有几条**，而不是 `currentIndex + 1` ——
 * 孩子可以跳着做，题号不等于"做了几题"。
 */
export function progressOf(row: TopicSessionRecord | null | undefined): TopicProgress {
  if (!row || !isPlainObject(row)) return { answered: 0, total: 0, percent: 0, currentIndex: 0 }
  const total =
    typeof row.totalCount === 'number' && row.totalCount > 0
      ? row.totalCount
      : Array.isArray(row.questionIds)
        ? row.questionIds.length
        : 0
  const answered = isPlainObject(row.answers) ? Object.keys(row.answers).length : 0
  const currentIndex = clampIndex(row.currentIndex, total - 1)
  return {
    answered,
    total,
    percent: total > 0 ? Math.round((answered / total) * 100) : 0,
    currentIndex,
  }
}
