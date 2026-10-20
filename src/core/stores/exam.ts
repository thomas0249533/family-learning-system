import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, type ExamSessionRecord } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'

function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export const useExamStore = defineStore('exam', () => {
  const sessions = ref<ExamSessionRecord[]>([])

  /**
   * 加载当前档案在某学习包下的所有会话。
   *
   * V1.4 · B1：复合索引 `[profileId+packageId]` 取代原来的 `packageId` 单列索引。
   * 不分片的话老二在模考页能看到老大的历史成绩 —— 而成绩是最容易被拿来比较的东西，
   * 与"不做排行"的产品红线直接冲突。
   */
  async function loadSessions(packageId: string) {
    sessions.value = await db.examSessions
      .where('[profileId+packageId]').equals([currentProfileId(), packageId])
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

    const pid = currentProfileId()
    const existing = await db.examSessions
      .where('[profileId+packageId]').equals([pid, packageId]).toArray()
    // 序号按**档案内**计数：否则老二的第 1 次模考会因为老大做过两次而变成"第 3 次"
    const sessionIndex = existing.length + 1

    const rec: ExamSessionRecord = {
      profileId: pid,
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
      .where('[profileId+packageId]').equals([currentProfileId(), packageId])
      .filter(s => s.status === 'ongoing')
      .reverse()
      .sortBy('startedAt')
    return list[0] ?? null
  }

  /** 查询某包的所有已答题目 ID */
  async function getAllAnsweredIds(packageId: string): Promise<Set<string>> {
    const list = await db.examSessions
      .where('[profileId+packageId]').equals([currentProfileId(), packageId])
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