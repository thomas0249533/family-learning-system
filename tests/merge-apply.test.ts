import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamSessionRecord, MistakeRecord, ProgressRecord } from '@/db'
import { emptyPlan, type MergePlan } from '@core/backup/types'

/**
 * `applyMergePlan`（§6.4）—— 哑 IO 层。
 *
 * 这里守的是三条**只在 apply 才会犯**的错：
 *   1. 计划里带 id 却用 `add` 写 → 同一个知识点多出一行（统计翻倍）；
 *   2. `noop` 或 `reject` 时仍然开了事务 / 写了半截；
 *   3. 中途抛错没有整笔回滚 → 库里留下"有进度没有档案"的无主数据。
 *
 * 假 db 的语义与仓库既有做法一致（见 `tests/user-data-store.test.ts`）：
 * 未知索引名**必须抛错**，否则"漏改索引"这类缺陷会静默假通过。
 * 事务用一个很笨但足够的手写快照实现：提交前备份三张表，抛错时整张还原。
 */

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>

  const hooks = { failOnSettingsPutKey: '', txSessions: 0 }

  function makeTable(opts: {
    keyOf: (r: Row) => unknown
    autoId?: boolean
    indices: string[]
  }) {
    const rows: Row[] = []
    let seq = 1

    function fieldsOf(index: string): string[] {
      if (!opts.indices.includes(index)) throw new Error(`fake db: 未知索引 ${index}`)
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
        return rows.map((r) => ({ ...r }))
      },
      async get(k: unknown) {
        return rows.find((r) => opts.keyOf(r) === k)
      },
      async put(r: Row) {
        const key = opts.keyOf(r)
        const i = rows.findIndex((x) => opts.keyOf(x) === key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return key
      },
      async add(r: Row) {
        const row = { ...r }
        if (opts.autoId && row.id === undefined) row.id = seq++
        rows.push(row)
        return opts.keyOf(row)
      },
      async update(id: unknown, patch: Row) {
        const i = rows.findIndex((r) => opts.keyOf(r) === id)
        if (i >= 0) rows[i] = { ...rows[i], ...patch }
      },
      where(index: string) {
        const fields = fieldsOf(index)
        const matches = (r: Row, value: unknown) =>
          Array.isArray(value)
            ? fields.every((f, i) => r[f] === value[i])
            : r[fields[0]] === value
        return {
          equals: (value: unknown) => ({
            async first() {
              return rows.find((r) => matches(r, value))
            },
            async toArray() {
              return rows.filter((r) => matches(r, value)).map((r) => ({ ...r }))
            },
          }),
        }
      },
    }
    return table
  }

  const progress = makeTable({
    keyOf: (r) => r.id,
    autoId: true,
    indices: ['[profileId+packageId+knowledgePointId]', '[profileId+packageId]', 'profileId', 'status'],
  })
  const mistakes = makeTable({
    keyOf: (r) => r.id,
    autoId: true,
    indices: ['[profileId+exerciseId]', 'packageId', 'profileId', 'mastered'],
  })
  const examSessions = makeTable({
    keyOf: (r) => r.id,
    autoId: true,
    indices: ['[profileId+packageId]', 'profileId', 'status', 'startedAt'],
  })
  const settings = makeTable({ keyOf: (r) => r.key, indices: ['key'] })

  const rawPut = settings.put.bind(settings)
  settings.put = async (rec: Row) => {
    if (hooks.failOnSettingsPutKey && rec.key === hooks.failOnSettingsPutKey) {
      throw new Error('模拟写盘失败')
    }
    return rawPut(rec)
  }

  /** 手写事务：提交前快照，抛错整张还原（Dexie 的真实语义这里只需近似） */
  async function transaction(_mode: string, ...args: unknown[]) {
    const fn = args[args.length - 1] as () => Promise<unknown>
    const tables = args.slice(0, -1) as Array<{ rows: Row[] }>
    const snapshot = tables.map((t) => t.rows.map((r) => ({ ...r })))
    hooks.txSessions++
    try {
      return await fn()
    } catch (err) {
      tables.forEach((t, i) => {
        t.rows.length = 0
        snapshot[i].forEach((r) => t.rows.push({ ...r }))
      })
      throw err
    }
  }

  return {
    progress,
    mistakes,
    examSessions,
    settings,
    transaction,
    hooks,
    __reset() {
      progress.__reset()
      mistakes.__reset()
      examSessions.__reset()
      settings.__reset()
      hooks.txSessions = 0
      hooks.failOnSettingsPutKey = ''
    },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const { applyMergePlan } = await import('@core/merge/applyMergePlan')

const PID = 'default'

function progressRow(over: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    profileId: PID,
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '学习中',
    correctCount: 1,
    wrongCount: 0,
    correctStreak: 0,
    wrongStreak: 0,
    lastStudiedAt: '2026-01-01T00:00:00.000Z',
    studySeconds: 10,
    ...over,
  }
}

function mistakeRow(over: Partial<MistakeRecord> = {}): MistakeRecord {
  return {
    profileId: PID,
    packageId: 'pkg-a',
    exerciseId: 'ex-1',
    knowledgePointIds: ['kp-1'],
    wrongAt: '2026-01-01T00:00:00.000Z',
    wrongCount: 1,
    mastered: false,
    masteryLevel: 'none',
    ...over,
  }
}

function sessionRow(over: Partial<ExamSessionRecord> = {}): ExamSessionRecord {
  return {
    profileId: PID,
    packageId: 'pkg-a',
    sessionIndex: 1,
    questionIds: ['q1'],
    answers: {},
    currentIndex: 1,
    elapsedSeconds: 10,
    totalCount: 1,
    timeLimit: 60,
    startedAt: '2026-01-01T10:00:00.000Z',
    status: 'finished',
    finalRate: 1,
    ...over,
  }
}

function plan(over: Partial<MergePlan> = {}): MergePlan {
  return { ...emptyPlan(), ...over }
}

beforeEach(() => {
  fake.__reset()
})

describe('applyMergePlan — 不写库的两条短路', () => {
  it('★ noop 计划：返回全 0，且**不开启事务**', async () => {
    const result = await applyMergePlan(emptyPlan())
    expect(result).toEqual({ progress: 0, mistakes: 0, sessions: 0, settings: 0, profiles: 0 })
    expect(fake.hooks.txSessions).toBe(0)
    expect(fake.progress.rows).toHaveLength(0)
    expect(fake.settings.rows).toHaveLength(0)
  })

  it('★ reject 计划：抛出 detail，且一行都不写、不开事务（AC-P2-14）', async () => {
    const rejectPlan = plan({
      reject: { reason: 'profile-limit', detail: '超过档案上限，已整笔取消' },
      progressUpserts: [progressRow()],
    })

    await expect(applyMergePlan(rejectPlan)).rejects.toThrow('超过档案上限，已整笔取消')
    expect(fake.hooks.txSessions).toBe(0)
    expect(fake.progress.rows).toHaveLength(0)
  })
})

describe('applyMergePlan — 正常写入', () => {
  it('进度：按复合索引找既有行 update，不新增行', async () => {
    await fake.progress.add(progressRow({ correctCount: 1 }))
    expect(fake.progress.rows).toHaveLength(1)

    const result = await applyMergePlan(
      plan({ progressUpserts: [progressRow({ correctCount: 9 })] }),
    )

    expect(result.progress).toBe(1)
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(9)
    expect(fake.progress.rows[0].id).toBe(1)
  })

  it('进度：本机没有 → add 并自动分配 id', async () => {
    await applyMergePlan(
      plan({ progressUpserts: [progressRow({ knowledgePointId: 'kp-2' })] }),
    )
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].knowledgePointId).toBe('kp-2')
    expect(typeof fake.progress.rows[0].id).toBe('number')
  })

  it('错题：按 [profileId+exerciseId] 更新既有行', async () => {
    await fake.mistakes.add(mistakeRow({ wrongCount: 1 }))
    const result = await applyMergePlan(
      plan({ mistakeUpserts: [mistakeRow({ wrongCount: 5, masteryLevel: 'partial' })] }),
    )
    expect(result.mistakes).toBe(1)
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].wrongCount).toBe(5)
  })

  it('★ 模考：同 package + sessionIndex 但 startedAt 不同 → 两场都留下、不互相覆盖', async () => {
    await fake.examSessions.add(sessionRow({ startedAt: '2026-01-01T10:00:00.000Z', finalRate: 0.5 }))
    const result = await applyMergePlan(
      plan({
        sessionUpserts: [
          sessionRow({ startedAt: '2026-01-02T10:00:00.000Z', finalRate: 1 }),
        ],
      }),
    )
    expect(result.sessions).toBe(1)
    expect(fake.examSessions.rows).toHaveLength(2)
    expect(fake.examSessions.rows.map((r) => r.finalRate)).toEqual([0.5, 1])
  })

  it('模考：同场（同 startedAt）→ 更新既有行，不新增', async () => {
    await fake.examSessions.add(sessionRow({ startedAt: '2026-01-01T10:00:00.000Z', finalRate: 0.5 }))
    await applyMergePlan(
      plan({ sessionUpserts: [sessionRow({ startedAt: '2026-01-01T10:00:00.000Z', finalRate: 1 })] }),
    )
    expect(fake.examSessions.rows).toHaveLength(1)
    expect(fake.examSessions.rows[0].finalRate).toBe(1)
  })

  it('settings：分片键与全局键都按整条记录 put', async () => {
    await fake.settings.put({ key: 'fls:theme', value: 'light' })
    const result = await applyMergePlan(
      plan({
        settingUpserts: [
          { key: 'dailyStats:default', value: [{ date: '2026-01-01', questionCount: 3 }] },
          { key: 'fls:theme', value: 'dark' },
        ],
      }),
    )
    expect(result.settings).toBe(2)
    expect(await fake.settings.get('dailyStats:default')).toBeTruthy()
    expect((await fake.settings.get('fls:theme'))?.value).toBe('dark')
  })

  it('★ 新档案：追加进 list，activeId 保持不变（导入不打断本机使用者）', async () => {
    await fake.settings.put({
      key: 'profiles',
      value: {
        activeId: 'default',
        list: [{ id: 'default', name: '我', createdAt: '2025-01-01T00:00:00.000Z' }],
      },
    })

    const result = await applyMergePlan(
      plan({
        newProfiles: [{ id: 'p_new', name: '老二', createdAt: '2024-06-01T00:00:00.000Z' }],
      }),
    )

    expect(result.profiles).toBe(1)
    const rec = await fake.settings.get('profiles')
    const value = rec?.value as { activeId: string; list: Array<{ id: string; name: string }> }
    expect(value.activeId).toBe('default')
    expect(value.list.map((p) => p.id)).toEqual(['default', 'p_new'])
    expect(value.list[1].name).toBe('老二')
  })

  it('新档案：库里已有该 id → 不重复追加', async () => {
    await fake.settings.put({
      key: 'profiles',
      value: {
        activeId: 'default',
        list: [
          { id: 'default', name: '我', createdAt: '2025-01-01T00:00:00.000Z' },
          { id: 'p_x', name: '老二', createdAt: '2025-02-01T00:00:00.000Z' },
        ],
      },
    })

    const result = await applyMergePlan(
      plan({ newProfiles: [{ id: 'p_x', name: '改了名', createdAt: '2024-06-01T00:00:00.000Z' }] }),
    )
    expect(result.profiles).toBe(0)
    const value = (await fake.settings.get('profiles'))?.value as { list: unknown[] }
    expect(value.list).toHaveLength(2)
  })

  it('本机没有 profiles 记录 → 归一化出默认档案后再追加', async () => {
    const result = await applyMergePlan(
      plan({ newProfiles: [{ id: 'p_new', name: '老二', createdAt: '2024-06-01T00:00:00.000Z' }] }),
    )
    expect(result.profiles).toBe(1)
    const value = (await fake.settings.get('profiles'))?.value as { activeId: string; list: unknown[] }
    expect(value.list).toHaveLength(2)
    expect(value.activeId).toBe('default')
  })
})

describe('applyMergePlan — 原子性（AC-P2-15）', () => {
  it('★ 中途写 settings 失败 → 已写的三张表整笔回滚', async () => {
    await fake.progress.add(progressRow({ knowledgePointId: 'kp-1', correctCount: 1 }))
    const before = fake.progress.rows.map((r) => ({ ...r }))

    fake.hooks.failOnSettingsPutKey = 'dailyStats:default'

    await expect(
      applyMergePlan(
        plan({
          // 先写一行新进度（会成功），再写 settings（会失败）
          progressUpserts: [progressRow({ knowledgePointId: 'kp-2', correctCount: 3 })],
          mistakeUpserts: [mistakeRow({ exerciseId: 'ex-9' })],
          settingUpserts: [{ key: 'dailyStats:default', value: [] }],
        }),
      ),
    ).rejects.toThrow('模拟写盘失败')

    // 回滚后与事务前逐行一致
    expect(fake.progress.rows).toEqual(before)
    expect(fake.mistakes.rows).toHaveLength(0)
    expect(await fake.settings.get('dailyStats:default')).toBeUndefined()
    expect(fake.hooks.txSessions).toBe(1)
  })

  it('回滚也覆盖"新建档案"这一步写进去的 profiles 记录', async () => {
    await fake.settings.put({
      key: 'profiles',
      value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: '2025-01-01T00:00:00.000Z' }] },
    })
    await fake.settings.put({ key: 'zzz:fail', value: 1 })
    const failRec = await fake.settings.get('zzz:fail')
    expect(failRec).toBeTruthy()

    fake.hooks.failOnSettingsPutKey = 'zzz:fail'

    await expect(
      applyMergePlan(
        plan({
          newProfiles: [{ id: 'p_new', name: '老二', createdAt: '2024-06-01T00:00:00.000Z' }],
          settingUpserts: [{ key: 'zzz:fail', value: 2 }],
        }),
      ),
    ).rejects.toThrow('模拟写盘失败')

    const value = (await fake.settings.get('profiles'))?.value as { list: unknown[] }
    expect(value.list).toHaveLength(1)
  })
})
