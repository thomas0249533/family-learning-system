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

  /**
   * @param keyOf   主键取值（get / put / update 用）
   * @param autoId  add 时是否补自增 id
   * @param indices 该表在 v4 schema 里**真实存在**的索引名（单列如 `profileId`，
   *                复合如 `[profileId+packageId]`）。按索引名拆字段比较即可，
   *                不需要为每个索引写特判。
   */
  function makeTable(keyOf: (r: Row) => any, autoId = false, indices: string[] = []) {
    const rows: Row[] = []
    let seq = 1

    /** 索引名 → 字段列表；未登记的索引名一律抛错（见 where 的注释） */
    function fieldsOf(index: string): string[] {
      if (!indices.includes(index)) throw new Error(`fake db: 未知索引 ${index}`)
      return index.startsWith('[') && index.endsWith(']')
        ? index.slice(1, -1).split('+')
        : [index]
    }

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
        // ★ 未知索引名必须抛错：静默返回空结果会让"归一化根本没生效"这类缺陷假通过。
        // v4 删掉了 `[packageId+knowledgePointId]` / 单列 `exerciseId`，
        // 漏改的查询在这里会直接炸，而不是安静地跨档案串数据。
        const fields = fieldsOf(field)
        const matches = (r: Row, value: any) =>
          Array.isArray(value)
            ? fields.every((f, i) => r[f] === value[i])
            : r[fields[0]] === value
        return {
          equals: (value: any) => ({
            async first() {
              return rows.find(r => matches(r, value))
            },
            async toArray() {
              return rows.filter(r => matches(r, value)).map(r => ({ ...r }))
            },
          }),
        }
      },
    }
    return table
  }

  const progress = makeTable(
    r => r.id,
    true,
    ['[profileId+packageId+knowledgePointId]', '[profileId+packageId]', 'profileId', 'status'],
  )
  const mistakes = makeTable(
    r => r.id,
    true,
    ['[profileId+exerciseId]', 'packageId', 'profileId', 'mastered'],
  )
  const settings = makeTable(r => r.key, false, ['key'])
  /** V1.3 · E-01 起 recordProgress 会读 packages 建归属索引，替身必须提供这张表 */
  const packages = makeTable(r => r.packageId, false, ['packageId'])

  return {
    progress,
    mistakes,
    settings,
    packages,
    __reset() {
      progress.__reset()
      mistakes.__reset()
      settings.__reset()
      packages.__reset()
    },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const { useUserDataStore } = await import('@core/stores/userData')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const { streakKey } = await import('@core/motivation/streak')

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
