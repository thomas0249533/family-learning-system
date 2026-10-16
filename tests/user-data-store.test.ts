import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * store 层的集成测试。
 *
 * 用内存版 Dexie 替身替代 IndexedDB，把 recordProgress 的完整链路
 * （计数 → BKT → FSRS 排期 → 掌握状态机 → 落库 → 打卡）真实跑一遍。
 * 这是本次改动最核心、最容易出错的一段，必须有回归网。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>

  function makeTable(keyOf: (r: Row) => any, autoId = false) {
    const rows: Row[] = []
    let seq = 1

    const table = {
      rows,
      __reset() {
        rows.length = 0
        seq = 1
      },
      async toArray() {
        return rows.map(r => ({ ...r }))
      },
      async get(k: any) {
        return rows.find(r => keyOf(r) === k)
      },
      async put(r: Row) {
        const key = keyOf(r)
        const i = rows.findIndex(x => keyOf(x) === key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return key
      },
      async add(r: Row) {
        const row = { ...r }
        if (autoId && row.id === undefined) row.id = seq++
        rows.push(row)
        return keyOf(row)
      },
      async bulkPut(rs: Row[]) {
        for (const r of rs) await table.put(r)
      },
      async update(id: any, patch: Row) {
        const i = rows.findIndex(r => keyOf(r) === id)
        if (i >= 0) rows[i] = { ...rows[i], ...patch }
      },
      where(field: string) {
        return {
          equals: (value: any) => ({
            async first() {
              if (field === '[packageId+knowledgePointId]') {
                const [p, k] = value as [string, string]
                return rows.find(r => r.packageId === p && r.knowledgePointId === k)
              }
              return rows.find(r => r[field] === value)
            },
            async toArray() {
              return rows.filter(r => r[field] === value).map(r => ({ ...r }))
            },
          }),
        }
      },
    }
    return table
  }

  const progress = makeTable(r => r.id, true)
  const mistakes = makeTable(r => r.id, true)
  const settings = makeTable(r => r.key, false)

  return {
    progress,
    mistakes,
    settings,
    __reset() {
      progress.__reset()
      mistakes.__reset()
      settings.__reset()
    },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const { useUserDataStore } = await import('@core/stores/userData')

const PKG = 'unit-math-4-up-rjb-p1'
const KP = 'kp-num-001'

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

beforeEach(() => {
  fake.__reset()
})

describe('recordProgress — 新建进度记录', () => {
  it('首次答对：建记录、状态「学习中」、掌握度与 FSRS 卡片都落库', async () => {
    const s = store()
    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    const rec = fake.progress.rows[0]
    expect(rec.status).toBe('学习中')
    expect(rec.correctCount).toBe(1)
    expect(rec.correctStreak).toBe(1)
    expect(typeof rec.masteryProbability).toBe('number')
    expect(rec.bkt.observed).toBe(1)
    expect(rec.fsrs).toBeTruthy()
    expect(new Date(rec.nextReviewAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('首次答错：状态「需复习」，且复习时间被拉到很近（错误要立刻回补）', async () => {
    const s = store()
    await s.recordProgress(PKG, KP, false, { questionType: 'blank' })

    const rec = fake.progress.rows[0]
    expect(rec.status).toBe('需复习')
    expect(rec.wrongCount).toBe(1)
    const days = (new Date(rec.nextReviewAt).getTime() - Date.now()) / 86400000
    expect(days).toBeLessThan(2)
  })

  it('★ 一节课里同一知识点连答对 10 次，复习间隔不会被顶爆', async () => {
    const s = store()
    for (let i = 0; i < 10; i++) {
      await s.recordProgress(PKG, KP, true, { questionType: 'blank' })
    }

    const rec = fake.progress.rows[0]
    expect(rec.correctCount).toBe(10)
    // 计数和掌握度照常累积
    expect(rec.bkt.observed).toBe(10)
    // 但排期只推进了一次
    expect(rec.fsrs.reps).toBe(1)
    expect(rec.fsrs.scheduled_days).toBeLessThan(30)
  })

  it('★ 抗蒙题：填空题连对 2 次即达「已掌握」，判断题连对 2 次还不到', async () => {
    const s = store()
    await s.recordProgress(PKG, 'kp-blank', true, { questionType: 'blank' })
    await s.recordProgress(PKG, 'kp-blank', true, { questionType: 'blank' })
    const blank = fake.progress.rows.find(r => r.knowledgePointId === 'kp-blank')

    await s.recordProgress(PKG, 'kp-judge', true, { questionType: 'judge' })
    await s.recordProgress(PKG, 'kp-judge', true, { questionType: 'judge' })
    const judge = fake.progress.rows.find(r => r.knowledgePointId === 'kp-judge')

    expect(blank.status).toBe('已掌握')
    expect(judge.status).not.toBe('已掌握')
    expect(blank.masteryProbability).toBeGreaterThan(judge.masteryProbability)
  })

  it('答错会立刻把状态打回「需复习」并重置连对', async () => {
    const s = store()
    for (let i = 0; i < 4; i++) {
      await s.recordProgress(PKG, KP, true, { questionType: 'blank' })
    }
    expect(fake.progress.rows[0].status).toBe('已掌握')

    await s.recordProgress(PKG, KP, false, { questionType: 'blank' })
    const rec = fake.progress.rows[0]
    expect(rec.status).toBe('需复习')
    expect(rec.correctStreak).toBe(0)
    expect(rec.wrongStreak).toBe(1)
  })

  it('答题会记录今日打卡（同一天不重复累加）', async () => {
    const s = store()
    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })
    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    const streakRow = await fake.settings.get('studyStreak')
    expect(streakRow).toBeTruthy()
    expect(streakRow!.value.current).toBe(1)
    expect(streakRow!.value.lastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('★ 老数据（只有 reviewStage、没有 fsrs）能平滑接管而不报错', async () => {
    // 模拟升级前遗留的进度记录
    await fake.progress.add({
      id: 99,
      packageId: PKG,
      knowledgePointId: KP,
      status: '学习中',
      correctCount: 3,
      wrongCount: 1,
      correctStreak: 1,
      wrongStreak: 0,
      lastStudiedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      studySeconds: 120,
      reviewStage: 3,
      nextReviewAt: new Date(Date.now() - 86400000).toISOString(),
      lastReviewAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    })

    const s = store()
    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    const rec = fake.progress.rows[0]
    expect(rec.fsrs).toBeTruthy() // 已补上 FSRS 卡片
    expect(rec.bkt).toBeTruthy()
    expect(rec.correctCount).toBe(4)
    expect(new Date(rec.nextReviewAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('不传题型也能工作（退化为旧行为，不会崩）', async () => {
    const s = store()
    await s.recordProgress(PKG, KP, true)
    expect(fake.progress.rows[0].fsrs).toBeTruthy()
    expect(fake.progress.rows[0].bkt).toBeTruthy()
  })
})

describe('错题三级状态 — 通过 store 走完整链路', () => {
  const question: any = { id: 'ex-1', type: 'blank', question: '1+1=?', answer: '2', explanation: '' }

  it('答错入本 → 未掌握；复习答对 → 部分掌握；再答对 → 已掌握', async () => {
    const s = store()
    await s.recordProgress(PKG, KP, false, { questionType: 'blank' })
    await s.addMistake(question, PKG, [KP], '3')
    expect(fake.mistakes.rows[0].masteryLevel).toBe('none')
    expect(fake.mistakes.rows[0].mastered).toBe(false)

    await s.resolveMistake('ex-1', true)
    expect(fake.mistakes.rows[0].masteryLevel).toBe('partial')
    expect(fake.mistakes.rows[0].mastered).toBe(false)

    await s.resolveMistake('ex-1', true)
    expect(fake.mistakes.rows[0].masteryLevel).toBe('mastered')
    expect(fake.mistakes.rows[0].mastered).toBe(true)
  })

  it('★ 部分掌握后又答错 → 退回未掌握并清零（不接受"错-对-错-对"算掌握）', async () => {
    const s = store()
    await s.addMistake(question, PKG, [KP], '3')
    await s.resolveMistake('ex-1', true) // partial
    await s.addMistake(question, PKG, [KP], '4') // 又错
    expect(fake.mistakes.rows[0].masteryLevel).toBe('none')
    expect(fake.mistakes.rows[0].reviewCorrectCount).toBe(0)
    expect(fake.mistakes.rows[0].mastered).toBe(false)
  })

  it('已在错题本里的题，答对才会推进；不在错题本里的不受影响', async () => {
    const s = store()
    await s.resolveMistake('not-in-book', true)
    expect(fake.mistakes.rows).toHaveLength(0)
  })

  it('手动标记已掌握 → 三级状态同步为 mastered', async () => {
    const s = store()
    await s.addMistake(question, PKG, [KP], '3')
    await s.markAsMastered(fake.mistakes.rows[0].id)
    expect(fake.mistakes.rows[0].masteryLevel).toBe('mastered')
    expect(fake.mistakes.rows[0].mastered).toBe(true)
  })

  it('老错题（只有 mastered=false）能被三级规则正确识别', async () => {
    await fake.mistakes.add({
      id: 7,
      packageId: PKG,
      exerciseId: 'legacy-ex',
      knowledgePointIds: [KP],
      wrongAt: new Date().toISOString(),
      wrongCount: 2,
      mastered: false,
      questionData: question,
    })
    const s = store()
    await s.loadUserData()
    const m = s.mistakes[0]
    // 缺 masteryLevel 字段也要能被 store 正常读出（不报错）
    expect(m.masteryLevel).toBeUndefined()
    // 复习一次 → 被规则判定为部分掌握
    await s.resolveMistake('legacy-ex', true)
    expect(fake.mistakes.rows[0].masteryLevel).toBe('partial')
  })
})
