import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, type ExamSessionRecord } from '@/db'

function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export const useExamStore = defineStore('exam', () => {
  const sessions = ref<ExamSessionRecord[]>([])

  /** 加载某学习包的所有会话 */
  async function loadSessions(packageId: string) {
    sessions.value = await db.examSessions
      .where('packageId').equals(packageId)
      .reverse()
      .sortBy('startedAt')
  }

  /** 创建新会话 */
  async function createSession(params: {
    packageId: string
    questionIds: string[]
    timeLimit?: number
  }): Promise<number> {
    const { packageId, questionIds, timeLimit = 0 } = params

    const existing = await db.examSessions
      .where('packageId').equals(packageId).toArray()
    const sessionIndex = existing.length + 1

    const rec: ExamSessionRecord = {
      packageId,
      sessionIndex,
      questionIds: [...questionIds],
      answers: {},
      currentIndex: 0,
      elapsedSeconds: 0,
      totalCount: questionIds.length,
      timeLimit,
      startedAt: new Date().toISOString(),
      status: 'ongoing',
    }
    const id = await db.examSessions.add(toPlain(rec))
    await loadSessions(packageId)
    return id as number
  }

  /** 更新会话（部分字段） */
  async function updateSession(id: number, patch: Partial<ExamSessionRecord>) {
    await db.examSessions.update(id, toPlain(patch))
    if (sessions.value.length > 0) {
      await loadSessions(sessions.value[0].packageId)
    }
  }

  /** 记录一题的答案 */
  async function recordAnswer(
    sessionId: number,
    questionId: string,
    userAnswer: any,
    isCorrect: boolean,
    nextIndex: number
  ) {
    const s = await db.examSessions.get(sessionId)
    if (!s) return
    const answers = { ...s.answers, [questionId]: { userAnswer, isCorrect } }
    await db.examSessions.update(sessionId, toPlain({
      answers,
      currentIndex: nextIndex,
    }))
  }

  /** 累加耗时 */
  async function addElapsed(sessionId: number, seconds: number) {
    const s = await db.examSessions.get(sessionId)
    if (!s) return
    await db.examSessions.update(sessionId, {
      elapsedSeconds: s.elapsedSeconds + seconds,
    })
  }

  /** 结束会话 */
  async function finishSession(sessionId: number, correct: number) {
    const s = await db.examSessions.get(sessionId)
    if (!s) return
    const rate = s.totalCount > 0 ? Math.round((correct / s.totalCount) * 100) : 0
    await db.examSessions.update(sessionId, toPlain({
      status: 'finished',
      finishedAt: new Date().toISOString(),
      finalCorrect: correct,
      finalRate: rate,
    }))
  }

  /** 删除会话 */
  async function deleteSession(id: number) {
    await db.examSessions.delete(id)
    if (sessions.value.length > 0) {
      await loadSessions(sessions.value[0].packageId)
    }
  }

  /** 查询某包的未完成会话 */
  async function getOngoing(packageId: string): Promise<ExamSessionRecord | null> {
    const list = await db.examSessions
      .where('packageId').equals(packageId)
      .filter(s => s.status === 'ongoing')
      .reverse()
      .sortBy('startedAt')
    return list[0] ?? null
  }

  /** 查询某包的所有已答题目 ID */
  async function getAllAnsweredIds(packageId: string): Promise<Set<string>> {
    const list = await db.examSessions
      .where('packageId').equals(packageId)
      .toArray()
    const ids = new Set<string>()
    for (const s of list) {
      for (const qid of Object.keys(s.answers)) ids.add(qid)
    }
    return ids
  }

  return {
    sessions,
    loadSessions,
    createSession,
    updateSession,
    recordAnswer,
    addElapsed,
    finishSession,
    deleteSession,
    getOngoing,
    getAllAnsweredIds,
  }
})