import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * store 层的集成测试。
 *
 * 用内存版 Dexie 替身替代 IndexedDB，把 recordProgress 的完整链路
 * （计数 → BKT → FSRS 排期 → 掌握状态机 → 落库 → 打卡）真实跑一遍。
 * 这是本次改动最核心、最容易出错的一段，必须有回归网。
 */
import { createFakeDexie } from './helpers/fakeDexie'

/**
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）。
 *
 * 索引清单只有那一份，与 `src/db/index.ts` 的 `version(4)` 逐字对应；
 * 未知索引抛错，因此"漏改索引名"会让测试炸，而不是安静地换一条语义。
 * A6 起的形参校验 / 行级 profileId 断言及其回归证明见 `fakeDexie-guard.test.ts`。
 */
const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const { useUserDataStore } = await import('@core/stores/userData')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const { streakKey } = await import('@core/motivation/streak')
const { scheduleReview } = await import('@core/review/reviewScheduler')
const { Rating } = await import('@core/review/fsrs')

const PKG = 'unit-math-4-up-rjb-p1'
const KP = 'kp-num-001'

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

beforeEach(() => {
  fake.__reset()
  // 归属索引是进程内缓存，测试之间必须清掉，否则上一个用例的包数组会漏到下一个
  invalidateOwnerIndex()
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

    // `.find()` 的结果可能是 undefined（表里没有该行）；先钉"行确实写进去了"，
    // 再往下断言具体字段 —— 否则断言失败时只会看到 "cannot read property of undefined"
    expect(blank).toBeTruthy()
    expect(judge).toBeTruthy()
    expect(blank!.status).toBe('已掌握')
    expect(judge!.status).not.toBe('已掌握')
    // BKT 概率是 `masteryProbability?`（可选，老数据没有）—— 本用例刚写过两行，必须都在
    expect(typeof blank!.masteryProbability).toBe('number')
    expect(typeof judge!.masteryProbability).toBe('number')
    expect(blank!.masteryProbability!).toBeGreaterThan(judge!.masteryProbability!)
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

    // V1.4 · B1：打卡也按档案分片（键带 `:default` 后缀），写成基名会让两个孩子共用一条连续天数
    expect(streakKey()).toBe('studyStreak:default')
    const streakRow = await fake.settings.get(streakKey())
    expect(streakRow).toBeTruthy()
    expect(streakRow!.value.current).toBe(1)
    expect(streakRow!.value.lastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('★ 老数据（只有 reviewStage、没有 fsrs）能平滑接管而不报错', async () => {
    // 模拟升级前遗留的进度记录
    await fake.progress.add({
      id: 99,
      profileId: 'default',
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
      profileId: 'default',
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

// ---------------------------------------------------------------------------
// V1.3 · E-01 · D2：写入端归一化（入口包 → 归属包）
// ---------------------------------------------------------------------------

function seedPackage(packageId: string, subject: string, kpIds: string[]) {
  fake.packages.add({
    packageId,
    manifest: { packageId, subject, type: 'unit', title: packageId },
    knowledgePoints: kpIds.map(id => ({ id, title: id })),
    exercises: [],
    units: [],
  })
}

describe('recordProgress — 写入端归一化（归属包解析）', () => {
  it('★ 从专项包作答、知识点属于单元包 → 记到单元包上（不再写进入口包）', async () => {
    seedPackage('unit-p1', 'english', ['unit-p1::kp1'])
    seedPackage('special-x', 'english', [])

    const s = store()
    await s.recordProgress('special-x', 'unit-p1::kp1', true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
    expect(fake.progress.rows[0].knowledgePointId).toBe('unit-p1::kp1')
  })

  it('★★ 同一知识点从两个入口包各答一次 → 只有一行、计数累加（掌握率不再被稀释）', async () => {
    seedPackage('unit-p1', 'english', ['unit-p1::kp1'])
    seedPackage('special-x', 'english', [])
    seedPackage('sprint-y', 'english', [])

    const s = store()
    await s.recordProgress('special-x', 'unit-p1::kp1', true, { questionType: 'blank' })
    await s.recordProgress('sprint-y', 'unit-p1::kp1', true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(2)
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
  })

  it('短 id（缺包前缀）且全库唯一声明者 → 归到归属包并把 kpId 补成完整 id', async () => {
    seedPackage('unit-p1', 'english', ['unit-p1::kp-abc'])
    seedPackage('special-x', 'english', [])

    const s = store()
    await s.recordProgress('special-x', 'kp-abc', true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
    expect(fake.progress.rows[0].knowledgePointId).toBe('unit-p1::kp-abc')
  })

  it('★ 归属歧义（两个包都声明同一 kpId）→ 保留入口包，绝不猜', async () => {
    seedPackage('unit-a', 'english', ['shared-kp'])
    seedPackage('unit-b', 'english', ['shared-kp'])
    seedPackage('special-x', 'english', [])

    const s = store()
    await s.recordProgress('special-x', 'shared-kp', true, { questionType: 'blank' })

    expect(fake.progress.rows[0].packageId).toBe('special-x')
  })

  it('★ 跨学科归属 → 保留入口包（不把语文知识点记到数学包上）', async () => {
    seedPackage('unit-math', 'math', ['math-kp'])
    seedPackage('special-eng', 'english', [])

    const s = store()
    await s.recordProgress('special-eng', 'math-kp', true, { questionType: 'blank' })

    expect(fake.progress.rows[0].packageId).toBe('special-eng')
  })

  it('包里没声明任何知识点（裸 JSON 导入 / 包已删除）→ 保留入口包，不崩', async () => {
    const s = store()
    await s.recordProgress('unknown-pkg', 'unknown-kp', true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].packageId).toBe('unknown-pkg')
  })
})

// ---------------------------------------------------------------------------
// V2.4 · 任务1 · 方案C · 虚拟「已复习」标记（markReviewedVirtual）
// ---------------------------------------------------------------------------

describe('markReviewedVirtual — 虚拟「已复习」标记（V2.4 任务1 方案C）', () => {
  function seedDueProgress(overrides: Partial<any> = {}) {
    return fake.progress.add({
      id: 1,
      profileId: 'default',
      packageId: PKG,
      knowledgePointId: KP,
      status: '学习中',
      correctCount: 2,
      wrongCount: 1,
      correctStreak: 2,
      wrongStreak: 0,
      lastStudiedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      studySeconds: 60,
      reviewStage: 1,
      nextReviewAt: new Date(Date.now() - 3600000).toISOString(), // 1 小时前 → 已到期
      lastReviewAt: new Date(Date.now() - 2 * 86400000).toISOString(), // 两天前
      ...overrides,
    })
  }

  it('首次标记：推进 FSRS 四字段（due 推后），但绝不改 status/correctCount/wrongCount', async () => {
    seedPackage(PKG, 'math', [KP])
    await seedDueProgress()
    const before = fake.progress.rows[0]

    const s = store()
    await s.markReviewedVirtual(PKG, KP)

    const rec = fake.progress.rows[0]
    expect(rec.fsrs).toBeTruthy()
    expect(new Date(rec.nextReviewAt).getTime()).toBeGreaterThan(new Date(before.nextReviewAt).getTime())
    // ★ 红线：掌握度统计口径不被污染（成就不读 fsrs，但掌握度统计必须干净）
    expect(rec.status).toBe('学习中')
    expect(rec.correctCount).toBe(2)
    expect(rec.wrongCount).toBe(1)
    expect(rec.bkt).toBe(before.bkt) // 不新增 BKT 推断
  })

  it('★ 反向验证（闸门）：同一天重复点「标记已复习」不再推进，due 不飞', async () => {
    seedPackage(PKG, 'math', [KP])
    await seedDueProgress()
    const s = store()
    await s.markReviewedVirtual(PKG, KP)
    const afterFirst = { ...fake.progress.rows[0] }

    // 立刻再点一次（同一天）→ shouldAdvanceSchedule 闸门拦截
    await s.markReviewedVirtual(PKG, KP)
    const afterSecond = fake.progress.rows[0]

    expect(afterSecond.nextReviewAt).toBe(afterFirst.nextReviewAt)
    expect(afterSecond.fsrs!.reps).toBe(afterFirst.fsrs!.reps)
  })

  it('★ 反向验证（无闸门会怎样）：若去掉 shouldAdvanceSchedule，同一天狂点会把排期一路顶爆', async () => {
    // 复刻"无闸门"路径：每次都直接 scheduleReview(Good)。reps 会累积、间隔被顶爆。
    let card: any = null
    let nr = new Date().toISOString()
    for (let i = 0; i < 10; i++) {
      const r = scheduleReview({ card, rating: Rating.Good, now: new Date() })
      card = r.card
      nr = r.nextReviewAt
    }
    // 无闸门：10 次后 reps=10，远超"有闸门"同场景下的 1 次 —— 证明闸门不可或缺
    expect(card.reps).toBe(10)
    // 对照：有闸门时一天最多只推进一次（= 单次 Good）。无闸门的排期必须明显更远
    const single = scheduleReview({ card: null, rating: Rating.Good, now: new Date() })
    const daysNoGate = (new Date(nr).getTime() - Date.now()) / 86400000
    const daysSingle = (new Date(single.nextReviewAt).getTime() - Date.now()) / 86400000
    expect(daysNoGate).toBeGreaterThan(daysSingle)
  })

  it('没有进度行时不造行、不抛错（防御性 early-return）', async () => {
    seedPackage(PKG, 'math', [KP])
    const s = store()
    await s.markReviewedVirtual(PKG, KP)
    expect(fake.progress.rows).toHaveLength(0)
  })

  it('★ 红线：绝不调用 markAsMastered（标记已复习 ≠ 把错题判掌握）', async () => {
    seedPackage(PKG, 'math', [KP])
    await seedDueProgress({ status: '需复习' })
    const s = store()
    await s.markReviewedVirtual(PKG, KP)
    // 进度行的掌握态保持原值，不被偷偷改成已掌握
    expect(fake.progress.rows[0].status).toBe('需复习')
  })
})
