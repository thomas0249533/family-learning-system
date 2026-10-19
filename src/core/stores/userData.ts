import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, type MistakeRecord, type ProgressRecord } from '@/db'
import type { QuizQuestion } from '@modules/core/QuizEngine.vue'
import {
  legacyCardFromStage,
  rateFromOutcome,
  scheduleReview,
  shouldAdvanceSchedule,
} from '@core/review/reviewScheduler'
import { guessProbFor, initBkt, updateBkt, type BktState } from '@core/mastery/bkt'
import { applyDecay, nextStatus } from '@core/mastery/masteryRules'
import { touchStudyDay } from '@core/motivation/streak'
import { bumpDailyStats } from '@core/motivation/dailyStats'
import { addAttemptedType } from '@core/motivation/attemptedTypes'
import { applyMistakeReview, mistakeLevel, mistakeReviewCount } from '@core/mistake/mistakeRules'
import { canonicalKpId, resolveOwnerPackageId } from '@core/progress/ownerIndex'
import { ensureOwnerIndex } from '@core/progress/ownerIndexCache'
import { ensureFields } from '@core/progress/progressRecord'
import { awaitE1Settled } from '@core/storage/migrateV3Recovery'

function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export interface RecordProgressOptions {
  /** 题型：用于 BKT 蒙对率（判断题 50% vs 填空题 5%） */
  questionType?: string
  /** 选项个数：用于单选题蒙对率 */
  optionCount?: number
  /** 本次作答耗时（毫秒）：用于推断「轻松 / 记得」 */
  elapsedMs?: number
}

export const useUserDataStore = defineStore('userData', () => {
  const mistakes = ref<MistakeRecord[]>([])
  const progress = ref<ProgressRecord[]>([])

  async function loadUserData() {
    mistakes.value = await db.mistakes.toArray()
    const all = (await db.progress.toArray()).map(ensureFields)
    const decayed = all.map(r => {
      const status = applyDecay(r)
      return status === r.status ? r : { ...r, status }
    })
    const changed = decayed.some((d, i) => {
      const a = all[i]
      return (
        d.status !== a.status ||
        d.reviewStage !== a.reviewStage ||
        d.nextReviewAt !== a.nextReviewAt
      )
    })
    if (changed) await db.progress.bulkPut(decayed.map(toPlain))
    progress.value = decayed
  }

  /**
   * 添加错题
   * @param question 题目
   * @param packageId 学习包 ID
   * @param knowledgePointIds 知识点 ID 列表
   * @param userAnswer 本次用户答案（用于记录错误选项）
   */
  async function addMistake(
    question: QuizQuestion,
    packageId: string,
    knowledgePointIds: string[] = [],
    userAnswer: string = ''
  ) {
    if (!question?.id) {
      console.error('[addMistake] question.id 缺失，跳过')
      return
    }
    const plainQuestion = toPlain(question)
    const plainKpIds = Array.isArray(knowledgePointIds) ? [...knowledgePointIds] : []
    const plainUserAnswer = String(userAnswer ?? '').slice(0, 500)

    const existing = await db.mistakes.where('exerciseId').equals(question.id).first()

    if (existing) {
      await db.mistakes.update(existing.id!, toPlain({
        wrongCount: existing.wrongCount + 1,
        questionData: plainQuestion,
        wrongAt: new Date().toISOString(),
        // 又错了 → 无论之前是部分掌握还是已掌握，一律退回未掌握并清零复习连对
        mastered: false,
        masteryLevel: 'none',
        reviewCorrectCount: 0,
        knowledgePointIds: plainKpIds.length ? plainKpIds : [...(existing.knowledgePointIds ?? [])],
        lastUserAnswer: plainUserAnswer || existing.lastUserAnswer,
      }))
    } else {
      await db.mistakes.add(toPlain({
        packageId,
        exerciseId: question.id,
        knowledgePointIds: plainKpIds,
        wrongAt: new Date().toISOString(),
        wrongCount: 1,
        mastered: false,
        masteryLevel: 'none',
        reviewCorrectCount: 0,
        questionData: plainQuestion,
        lastUserAnswer: plainUserAnswer,
      }))
    }

    await loadUserData()
  }

  /**
   * P3 · 复习时又做对了同一道错题 → 推进错题的三级状态。
   * 连续答对 2 次才判定「已掌握」；中途答错由 addMistake 打回未掌握。
   */
  async function resolveMistake(exerciseId: string, isCorrect: boolean) {
    if (!exerciseId) return
    const existing = await db.mistakes.where('exerciseId').equals(exerciseId).first()
    if (!existing) return

    const curLevel = mistakeLevel(existing)
    // 已彻底掌握且这次又对了 → 不动
    if (curLevel === 'mastered' && isCorrect) return

    const next = applyMistakeReview(
      curLevel,
      mistakeReviewCount(existing),
      isCorrect
    )

    await db.mistakes.update(existing.id!, toPlain({
      masteryLevel: next.level,
      reviewCorrectCount: next.reviewCorrectCount,
      mastered: next.mastered,
    }))
    await loadUserData()
  }

  async function markAsMastered(mistakeId: number) {
    await db.mistakes.update(mistakeId, {
      mastered: true,
      masteryLevel: 'mastered',
    })
    await loadUserData()
  }

  /**
   * 记录一次知识点的作答：同时推进掌握状态机、BKT 概率、FSRS 排期。
   * 兼容旧签名（第 4 个参数可选，不传时退化为"只有对错信息"）。
   *
   * V1.3 · E-01：**归一化收口在这里**（D2）。第 1 个参数的语义已从「最终写入的包」
   * 变为「**入口包**」——真正落库的 `packageId` 由归属包解析决定：
   *   |own| == 1 且 subject 相容 → 归属包（kpId 也一并规范化）
   *   |own| == 0 / >= 2 / 跨学科 → 保留入口包（**不猜**）
   *
   * 四个调用点（TopicDetail ×2 / ExamPanel / VocabDrill）因此**不需要改传参语义**：
   * 任何新调用方也不可能再"自己猜错包"，缺陷结构性地消失了。
   */
  async function recordProgress(
    packageId: string,
    knowledgePointId: string,
    isCorrect: boolean,
    opts: RecordProgressOptions = {}
  ) {
    // 启动补偿可能正在重写全表：等它结束再写，否则两边各写一行、合并结果被覆盖。
    // 补偿永不 rethrow（AC-E1-7），这里的 catch 只是防御性兜底。
    await awaitE1Settled().catch(() => undefined)

    const index = await ensureOwnerIndex()
    const owner = resolveOwnerPackageId(knowledgePointId, packageId, index)
    const targetPackageId = owner ?? packageId
    const targetKpId = owner ? canonicalKpId(owner, knowledgePointId, index) : knowledgePointId

    const key = [targetPackageId, targetKpId]
    const raw = await db.progress
      .where('[packageId+knowledgePointId]').equals(key).first()

    const now = new Date()
    const nowIso = now.toISOString()

    const existing: ProgressRecord = raw
      ? ensureFields(raw)
      : {
          packageId: targetPackageId,
          knowledgePointId: targetKpId,
          status: '未学',
          correctCount: 0,
          wrongCount: 0,
          correctStreak: 0,
          wrongStreak: 0,
          lastStudiedAt: nowIso,
          studySeconds: 0,
          reviewStage: 0,
          nextReviewAt: nowIso,
          lastReviewAt: null,
        }

    const everWrong = (existing.wrongCount ?? 0) > 0

    const counts = {
      correctCount: (existing.correctCount ?? 0) + (isCorrect ? 1 : 0),
      wrongCount: (existing.wrongCount ?? 0) + (isCorrect ? 0 : 1),
      correctStreak: isCorrect ? (existing.correctStreak ?? 0) + 1 : 0,
      wrongStreak: isCorrect ? 0 : (existing.wrongStreak ?? 0) + 1,
    }

    // ---------- P1 · BKT 掌握概率 ----------
    const guessProb = guessProbFor(opts.questionType, opts.optionCount)
    const prevBkt: BktState = existing.bkt ?? initBkt()
    const bkt = updateBkt(prevBkt, isCorrect, guessProb)

    // ---------- P0 · FSRS 排期 ----------
    const baseCard =
      existing.fsrs ??
      ((existing.reviewStage ?? 0) > 0
        ? legacyCardFromStage(existing.reviewStage!, now)
        : null)

    // 同一天内对同一知识点只推进一次排期。
    // 否则一个 topic 里 10 道题全部答对，会在一节课内把间隔顶到几十天。
    // 答错是例外——必须立刻把复习时间拉回来。
    const lastReview = existing.fsrs?.last_review ?? existing.lastReviewAt ?? null
    const shouldAdvance = shouldAdvanceSchedule(lastReview, isCorrect, now)

    let fsrs = existing.fsrs
    let reviewStage = existing.reviewStage ?? 0
    let nextReviewAt = existing.nextReviewAt
    let lastReviewAt = existing.lastReviewAt ?? null

    if (shouldAdvance) {
      const rating = rateFromOutcome({
        isCorrect,
        everWrong,
        elapsedMs: opts.elapsedMs,
        correctStreak: counts.correctStreak,
      })
      const result = scheduleReview({ card: baseCard, rating, now })
      fsrs = result.card
      reviewStage = result.reviewStage
      nextReviewAt = result.nextReviewAt
      lastReviewAt = result.lastReviewAt
    }

    // ---------- 掌握状态机 ----------
    // 新记录首次答错 → 需复习（保持与旧版一致的行为）
    const status = !raw && !isCorrect
      ? '需复习'
      : nextStatus(existing.status, counts, bkt.pKnown)

    const updated: ProgressRecord = {
      ...existing,
      ...counts,
      status,
      lastStudiedAt: nowIso,
      studySeconds: (existing.studySeconds ?? 0) + 30,
      reviewStage,
      nextReviewAt,
      lastReviewAt,
      fsrs,
      bkt,
      masteryProbability: bkt.pKnown,
    }

    if (raw) await db.progress.put(toPlain(updated))
    else await db.progress.add(toPlain(updated))

    // 今日打卡（同一天只会写一次）
    await touchStudyDay(now)

    await loadUserData()
  }

  /**
   * 记录一次「答题事件」（题目级，每题一次）。
   *
   * ⚠️ 计量口径 = 「题」不是「知识点」：一次作答可能触达多个 KP
   * （recordProgress 内部有 for 循环），故本方法必须由调用方在**题目级点位**
   * 调用一次，绝不放 recordProgress 内（否则多 KP 会重复计数）。
   *
   * 副作用：每日题量 +1（防抖落盘）+ 记录题型（去重，防抖落盘）。
   */
  function recordAnswerEvent(
    payload: { exerciseId?: string; questionType?: string; at?: Date } = {},
  ): void {
    bumpDailyStats({ count: 1, at: payload.at })
    if (payload.questionType) addAttemptedType(payload.questionType)
  }

  return {
    mistakes,
    progress,
    loadUserData,
    addMistake,
    resolveMistake,
    markAsMastered,
    recordProgress,
    recordAnswerEvent,
  }
})
