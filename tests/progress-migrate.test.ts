import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v3 迁移与启动补偿的测试（T02a）。
 *
 * 为什么能在 node 里跑：`migrateV3.ts` 的两个阶段都**接收 `tx` 参数**
 * （`planV3Migration(tx)` / `applyMergePlan(tx, plan)`），所以只要塞一个
 * 实现 `table(name) → { toArray, put, delete }` 的假事务，就能完整验证
 * 「算什么计划」和「按什么顺序写」—— 不需要 IndexedDB，也不需要 fake-indexeddb。
 *
 * 这里用假 `db`（而不是假 `tx`）覆盖 `recoverV3IfNeeded` / `ensureE1Migrated`，
 * 因为它们自己开事务、读写 `settings`，属于"编排层"，值得整条链路验一遍。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>

  const state = {
    packages: [] as Row[],
    progress: [] as Row[],
    settings: [] as Row[],
    /** 写入顺序日志：`put:progress` / `delete:progress` / `put:settings` … */
    writes: [] as string[],
  }

  const KEY: Record<string, (r: Row) => any> = {
    packages: (r) => r.packageId,
    progress: (r) => r.id,
    settings: (r) => r.key,
  }

  const throwOn: { toArray: Record<string, boolean>; put: Record<string, boolean> } = {
    toArray: {},
    put: {},
  }

  function api(name: 'packages' | 'progress' | 'settings') {
    return {
      async toArray() {
        if (throwOn.toArray[name]) throw new Error(`fake db: ${name}.toArray 失败`)
        return state[name].map((r) => ({ ...r }))
      },
      async get(k: any) {
        return state[name].find((r) => KEY[name](r) === k)
      },
      /** 未知索引名直接抛错：静默返回空结果会让测试"假通过" */
      where(field: string) {
        const KNOWN = new Set(['[packageId+knowledgePointId]', 'exerciseId', 'status'])
        if (!KNOWN.has(field)) throw new Error(`fake db: 未知索引 ${field}`)
        return {
          equals: (value: any) => ({
            async first() {
              if (field === '[packageId+knowledgePointId]') {
                const [p, k] = value as [string, string]
                return state[name].find((r) => r.packageId === p && r.knowledgePointId === k)
              }
              return state[name].find((r) => r[field] === value)
            },
            async toArray() {
              return state[name].filter((r) => r[field] === value).map((r) => ({ ...r }))
            },
          }),
        }
      },
      async put(v: Row) {
        state.writes.push(`put:${name}`)
        if (throwOn.put[name]) throw new Error(`fake db: ${name}.put 失败`)
        const k = KEY[name](v)
        const i = state[name].findIndex((r) => KEY[name](r) === k)
        if (i >= 0) state[name][i] = { ...v }
        else state[name].push({ ...v })
        return k
      },
      async delete(k: any) {
        state.writes.push(`delete:${name}`)
        const i = state[name].findIndex((r) => KEY[name](r) === k)
        if (i >= 0) state[name].splice(i, 1)
      },
    }
  }

  const db = {
    packages: api('packages'),
    progress: api('progress'),
    settings: api('settings'),
    /** 只支持本文件用到的两种调用形态；`fn` 永远是最后一个参数 */
    async transaction(_mode: any, ...args: any[]) {
      const fn = args[args.length - 1]
      return fn({ table: (n: any) => api(n) })
    },
  }

  return {
    db,
    state,
    throwOn,
    reset() {
      state.packages = []
      state.progress = []
      state.settings = []
      state.writes = []
      throwOn.toArray = {}
      throwOn.put = {}
    },
  }
})

vi.mock('@/db', () => ({ db: fake.db }))

const { planV3Migration, applyMergePlan, migrateProgressV3, MIGRATION_KEY, MAX_ATTEMPTS } =
  await import('@core/storage/migrateV3')
const { recoverV3IfNeeded, ensureE1Migrated, shouldRunRecovery, RECOVERY_KEY, readMigrationMarker } =
  await import('@core/storage/migrateV3Recovery')

// ---------- 夹具 ----------

function makePackage(packageId: string, subject: string, kpIds: string[]) {
  return {
    packageId,
    manifest: { packageId, subject, type: 'unit', title: packageId },
    knowledgePoints: kpIds.map((id) => ({ id, title: id })),
    exercises: [],
    units: [],
  }
}

/** 一行"写在入口包上"的进度；`entry` 与 kpId 前缀所在的包不同即为待归一化的历史行 */
function row(id: number, entryPackageId: string, kpId: string, extra: Record<string, any> = {}) {
  return {
    id,
    packageId: entryPackageId,
    knowledgePointId: kpId,
    status: '学习中',
    correctCount: 2,
    wrongCount: 0,
    correctStreak: 2,
    wrongStreak: 0,
    lastStudiedAt: '2026-10-01T00:00:00.000Z',
    studySeconds: 60,
    reviewStage: 0,
    nextReviewAt: '2026-10-03T00:00:00.000Z',
    lastReviewAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }
}

/** 标准场景：unit-p1 声明 kp1；special-x 是入口包（自己不声明任何 kp） */
function seedStandard() {
  fake.state.packages.push(
    makePackage('unit-p1', 'english', ['unit-p1::kp1', 'unit-p1::kp2']),
    makePackage('special-x', 'english', [])
  )
}

beforeEach(() => {
  fake.reset()
})

// ---------- 阶段 1：计划 ----------

describe('planV3Migration — 只读算计划', () => {
  it('入口包上的历史行 → 计划改写为归属包 + 规范化 kpId', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toHaveLength(1)
    expect(plan.puts[0].packageId).toBe('unit-p1')
    expect(plan.puts[0].knowledgePointId).toBe('unit-p1::kp1')
    // 单行改键 = 原地改写，不需要删行
    expect(plan.deletes).toEqual([])
    expect(plan.stats.rewritten).toBe(1)
  })

  it('已经是归属包的行 → 零计划（幂等）', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'unit-p1', 'unit-p1::kp1'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('★ 归属歧义（两个包都声明同一 kpId）→ 不改写，原样保留', async () => {
    fake.state.packages.push(
      makePackage('unit-a', 'english', ['shared-kp']),
      makePackage('unit-b', 'english', ['shared-kp'])
    )
    fake.state.progress.push(row(1, 'special-x', 'shared-kp'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.stats.ambiguousKept).toBe(1)
  })

  it('跨学科归属 → 不改写（subject 闸门）', async () => {
    fake.state.packages.push(
      makePackage('unit-math', 'math', ['math-kp']),
      makePackage('special-eng', 'english', [])
    )
    fake.state.progress.push(row(1, 'special-eng', 'math-kp'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toEqual([])
    expect(plan.stats.ambiguousKept).toBe(1)
  })

  it('同一知识点写在两个入口包上 → 合并成一行，多出来的 id 进 deletes', async () => {
    seedStandard()
    fake.state.progress.push(
      row(1, 'special-x', 'unit-p1::kp1', { lastStudiedAt: '2026-10-02T00:00:00.000Z' }),
      row(2, 'other-entry', 'unit-p1::kp1', { lastStudiedAt: '2026-10-01T00:00:00.000Z' })
    )

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toHaveLength(1)
    expect(plan.puts[0].id).toBe(1) // 承载体 = 组内 id 最小
    expect(plan.puts[0].correctCount).toBe(4) // 计数求和
    expect(plan.deletes).toEqual([2])
    expect(plan.stats.mergedGroups).toBe(1)
    expect(plan.stats.final).toBe(1)
  })

  it('★ 卡片存在但 last_review 缺失时，合并不会把卡片抹掉', async () => {
    seedStandard()
    const cardNoReview = { due: '2026-10-05T00:00:00.000Z', stability: 2, difficulty: 5, reps: 1 }
    fake.state.progress.push(
      row(1, 'special-x', 'unit-p1::kp1', { fsrs: cardNoReview, lastStudiedAt: '2026-10-02T00:00:00.000Z' }),
      row(2, 'other-entry', 'unit-p1::kp1', { fsrs: undefined, lastStudiedAt: '2026-10-01T00:00:00.000Z' })
    )

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toHaveLength(1)
    expect(plan.puts[0].fsrs).toBeTruthy()
    expect(plan.puts[0].fsrs!.stability).toBe(2)
  })

  it('无 packages 表数据（全新库）→ 零计划，不抛错', async () => {
    fake.state.progress.push(row(1, 'unit-p1', 'unit-p1::kp1'))
    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)
    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
  })
})

// ---------- 阶段 2：哑 IO ----------

describe('applyMergePlan — 哑 IO 的顺序契约', () => {
  it('★ put 必须在 delete 之前（先写后删，避免中途失败丢数据）', async () => {
    const plan = {
      puts: [row(1, 'unit-p1', 'unit-p1::kp1')],
      deletes: [2, 3],
      stats: { total: 3, rewritten: 0, mergedGroups: 1, mergedRowsRemoved: 2, ambiguousKept: 0, final: 1 },
    }
    fake.state.progress.push(row(1, 'unit-p1', 'unit-p1::kp1'), row(2, 'x', 'y'), row(3, 'x', 'y'))

    await applyMergePlan({ table: (n: string) => fake.db[n as 'progress'] } as any, plan as any)

    const firstDelete = fake.state.writes.indexOf('delete:progress')
    const lastPut = fake.state.writes.lastIndexOf('put:progress')
    expect(firstDelete).toBeGreaterThan(-1)
    expect(lastPut).toBeLessThan(firstDelete)
    expect(fake.state.progress.map((r) => r.id)).toEqual([1])
  })

  it('空计划 → 一次写入都不发生', async () => {
    const plan = {
      puts: [],
      deletes: [],
      stats: { total: 0, rewritten: 0, mergedGroups: 0, mergedRowsRemoved: 0, ambiguousKept: 0, final: 0 },
    }
    await applyMergePlan({ table: (n: string) => fake.db[n as 'progress'] } as any, plan as any)
    expect(fake.state.writes).toEqual([])
  })
})

// ---------- upgrade 钩子 ----------

describe('migrateProgressV3 — upgrade() 钩子永不抛', () => {
  it('成功路径：改写行 + 写入 ok 标记（带 stats）', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))

    await migrateProgressV3({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(fake.state.progress[0].packageId).toBe('unit-p1')
    const marker = fake.state.settings.find((s) => s.key === MIGRATION_KEY)
    expect(marker?.value.status).toBe('ok')
    expect(marker?.value.stats.rewritten).toBe(1)
  })

  it('★ 计划构建失败 → 写 failed 标记 + attempts=0，且**不向外抛**（AC-E1-7）', async () => {
    fake.throwOn.toArray.packages = true

    await expect(
      migrateProgressV3({ table: (n: string) => fake.db[n as 'progress'] } as any)
    ).resolves.toBeUndefined()

    const marker = fake.state.settings.find((s) => s.key === MIGRATION_KEY)
    expect(marker?.value.status).toBe('failed')
    expect(marker?.value.attempts).toBe(0)
    expect(marker?.value.error).toContain('失败')
  })
})

// ---------- 启动补偿 ----------

describe('shouldRunRecovery — 什么时候放弃补偿', () => {
  it.each([
    [null, false, '没有标记'],
    [{ status: 'ok' }, false, '迁移已成功'],
    [{ status: 'ok-recovered' }, false, '补偿已成功过'],
    [{ status: 'failed' }, true, '首次失败'],
    [{ status: 'failed', attempts: MAX_ATTEMPTS - 1 }, true, '还没到上限'],
    [{ status: 'failed', attempts: MAX_ATTEMPTS }, false, '已达上限'],
    [{ status: 'failed', attempts: MAX_ATTEMPTS + 5 }, false, '超过上限'],
  ] as const)('%#: %j → %s（%s）', (marker, expected) => {
    expect(shouldRunRecovery(marker as any)).toBe(expected)
  })
})

describe('recoverV3IfNeeded — 启动补跑', () => {
  it('标记 ok → 什么都不做（连进度表都不读）', async () => {
    fake.state.settings.push({ key: MIGRATION_KEY, value: { status: 'ok', at: 'x' } })
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))
    seedStandard()

    const result = await recoverV3IfNeeded()

    expect(result).toBeNull()
    expect(fake.state.writes).toEqual([])
    expect(fake.state.progress[0].packageId).toBe('special-x')
  })

  it('★ 标记 failed 且未到上限 → 重跑并写成 ok-recovered', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))
    fake.state.settings.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', error: 'boom', attempts: 0 },
    })

    const result = await recoverV3IfNeeded()

    expect(result?.status).toBe('ok-recovered')
    expect(fake.state.progress[0].packageId).toBe('unit-p1')
    const marker = fake.state.settings.find((s) => s.key === MIGRATION_KEY)!
    expect(marker.value.status).toBe('ok-recovered')
  })

  it('★ 尝试次数累加：补偿再失败 → attempts + 1，状态仍为 failed', async () => {
    fake.state.settings.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', error: 'boom', attempts: 1 },
    })
    fake.throwOn.toArray.packages = true

    const result = await recoverV3IfNeeded()

    expect(result).toBeNull()
    const marker = fake.state.settings.find((s) => s.key === MIGRATION_KEY)!
    expect(marker.value.status).toBe('failed')
    expect(marker.value.attempts).toBe(2)
  })

  it('★ 已达上限 → 不再扫表、不写任何东西', async () => {
    fake.state.settings.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', attempts: MAX_ATTEMPTS },
    })
    seedStandard()
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))

    const result = await recoverV3IfNeeded()

    expect(result).toBeNull()
    expect(fake.state.writes).toEqual([])
    expect(fake.state.progress[0].packageId).toBe('special-x')
  })
})

// ---------- 导入后重归因 ----------

describe('ensureE1Migrated({ orphanOnly }) — 导入后重归因', () => {
  it('★ 改写孤儿行，但**不碰** migration:v3 标记', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))
    fake.state.settings.push({ key: MIGRATION_KEY, value: { status: 'ok', at: 'x' } })

    const stats = await ensureE1Migrated({ orphanOnly: true })

    expect(stats?.rewritten).toBe(1)
    expect(fake.state.progress[0].packageId).toBe('unit-p1')
    // 迁移标记保持原样（一次性语义，不许被日常动作改写）
    const marker = fake.state.settings.find((s) => s.key === MIGRATION_KEY)!
    expect(marker.value).toEqual({ status: 'ok', at: 'x' })
    // 另写一条"最后重归因"记录
    const recovery = fake.state.settings.find((s) => s.key === RECOVERY_KEY)!
    expect(recovery.value.mode).toBe('import')
  })

  it('★ 零计划 → 不起写事务（writes 为空）', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'unit-p1', 'unit-p1::kp1'))

    const stats = await ensureE1Migrated({ orphanOnly: true })

    expect(stats?.rewritten).toBe(0)
    expect(fake.state.writes).toEqual([])
  })

  it('★ 新包导入后，原本无主的历史行变得可归因（导入 → 重归因 → 被改写）', async () => {
    // 1) 一开始只有入口包，kp 归属解析不出来
    fake.state.packages.push(makePackage('special-x', 'english', []))
    fake.state.progress.push(row(1, 'special-x', 'unit-p1::kp1'))
    let stats = await ensureE1Migrated({ orphanOnly: true })
    expect(stats?.rewritten).toBe(0)
    expect(fake.state.progress[0].packageId).toBe('special-x')

    // 2) 导入归属包（声明了该 kpId）
    fake.state.packages.push(makePackage('unit-p1', 'english', ['unit-p1::kp1']))

    // 3) 再重归因 → 这次能解析了
    stats = await ensureE1Migrated({ orphanOnly: true })
    expect(stats?.rewritten).toBe(1)
    expect(fake.state.progress[0].packageId).toBe('unit-p1')
  })

  it('读标记失败（settings.get 抛错）不影响主流程', async () => {
    seedStandard()
    fake.state.progress.push(row(1, 'unit-p1', 'unit-p1::kp1'))
    // 不塞标记 → readMigrationMarker 返回 null，orphanOnly 模式照常跑
    const stats = await ensureE1Migrated({ orphanOnly: true })
    expect(stats).not.toBeNull()
    expect(await readMigrationMarker()).toBeNull()
  })
})
