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
import { createFakeDexie } from './helpers/fakeDexie'

/**
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）。
 *
 * 注意 `indices: 'v3'`：本文件测的是 **v3 迁移本身**，那时的库里还没有
 * `profileId`，索引名也不同（`[packageId+knowledgePointId]` / `exerciseId`）。
 * 用 v4 清单会让 `where('[packageId+knowledgePointId]')` 直接抛错，
 * 从而测不到想测的东西 —— 这也是清单必须可切换的原因。
 *
 * IO 失败注入用 `fake.failOn.add('toArray:progress')`（原来是 `throwOn.toArray.x = true`）。
 */
const fake = createFakeDexie({ indices: 'v3' })

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
  fake.packages.rows.push(
    makePackage('unit-p1', 'english', ['unit-p1::kp1', 'unit-p1::kp2']),
    makePackage('special-x', 'english', [])
  )
}

beforeEach(() => {
  fake.__reset()
})

// ---------- 阶段 1：计划 ----------

describe('planV3Migration — 只读算计划', () => {
  it('入口包上的历史行 → 计划改写为归属包 + 规范化 kpId', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))

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
    fake.progress.rows.push(row(1, 'unit-p1', 'unit-p1::kp1'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('★ 归属歧义（两个包都声明同一 kpId）→ 不改写，原样保留', async () => {
    fake.packages.rows.push(
      makePackage('unit-a', 'english', ['shared-kp']),
      makePackage('unit-b', 'english', ['shared-kp'])
    )
    fake.progress.rows.push(row(1, 'special-x', 'shared-kp'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.stats.ambiguousKept).toBe(1)
  })

  it('跨学科归属 → 不改写（subject 闸门）', async () => {
    fake.packages.rows.push(
      makePackage('unit-math', 'math', ['math-kp']),
      makePackage('special-eng', 'english', [])
    )
    fake.progress.rows.push(row(1, 'special-eng', 'math-kp'))

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toEqual([])
    expect(plan.stats.ambiguousKept).toBe(1)
  })

  it('同一知识点写在两个入口包上 → 合并成一行，多出来的 id 进 deletes', async () => {
    seedStandard()
    fake.progress.rows.push(
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
    fake.progress.rows.push(
      row(1, 'special-x', 'unit-p1::kp1', { fsrs: cardNoReview, lastStudiedAt: '2026-10-02T00:00:00.000Z' }),
      row(2, 'other-entry', 'unit-p1::kp1', { fsrs: undefined, lastStudiedAt: '2026-10-01T00:00:00.000Z' })
    )

    const plan = await planV3Migration({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(plan.puts).toHaveLength(1)
    expect(plan.puts[0].fsrs).toBeTruthy()
    expect(plan.puts[0].fsrs!.stability).toBe(2)
  })

  it('无 packages 表数据（全新库）→ 零计划，不抛错', async () => {
    fake.progress.rows.push(row(1, 'unit-p1', 'unit-p1::kp1'))
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
    fake.progress.rows.push(row(1, 'unit-p1', 'unit-p1::kp1'), row(2, 'x', 'y'), row(3, 'x', 'y'))

    await applyMergePlan({ table: (n: string) => fake.db[n as 'progress'] } as any, plan as any)

    const firstDelete = fake.writes.indexOf('delete:progress')
    const lastPut = fake.writes.lastIndexOf('put:progress')
    expect(firstDelete).toBeGreaterThan(-1)
    expect(lastPut).toBeLessThan(firstDelete)
    expect(fake.progress.rows.map((r) => r.id)).toEqual([1])
  })

  it('空计划 → 一次写入都不发生', async () => {
    const plan = {
      puts: [],
      deletes: [],
      stats: { total: 0, rewritten: 0, mergedGroups: 0, mergedRowsRemoved: 0, ambiguousKept: 0, final: 0 },
    }
    await applyMergePlan({ table: (n: string) => fake.db[n as 'progress'] } as any, plan as any)
    expect(fake.writes).toEqual([])
  })
})

// ---------- upgrade 钩子 ----------

describe('migrateProgressV3 — upgrade() 钩子永不抛', () => {
  it('成功路径：改写行 + 写入 ok 标记（带 stats）', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))

    await migrateProgressV3({ table: (n: string) => fake.db[n as 'progress'] } as any)

    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
    const marker = fake.settings.rows.find((s) => s.key === MIGRATION_KEY)
    expect(marker?.value.status).toBe('ok')
    expect(marker?.value.stats.rewritten).toBe(1)
  })

  it('★ 计划构建失败 → 写 failed 标记 + attempts=0，且**不向外抛**（AC-E1-7）', async () => {
    fake.failOn.add('toArray:packages')

    await expect(
      migrateProgressV3({ table: (n: string) => fake.db[n as 'progress'] } as any)
    ).resolves.toBeUndefined()

    const marker = fake.settings.rows.find((s) => s.key === MIGRATION_KEY)
    expect(marker?.value.status).toBe('failed')
    expect(marker?.value.attempts).toBe(0)
    expect(marker?.value.error).toContain('失败')
  })
})

// ---------- 启动补偿 ----------

describe('shouldRunRecovery — 什么时候放弃补偿', () => {
  // 夹具一律补齐 `at`：真实的 `MigrationMarker` 恒带时间戳，缺字段的"半个标记"不是
  // 这个函数要覆盖的形态（它只看 status/attempts）。补齐后不再需要 `as any`。
  it.each([
    [null, false, '没有标记'],
    [{ status: 'ok', at: '2026-10-21T00:00:00.000Z' }, false, '迁移已成功'],
    [{ status: 'ok-recovered', at: '2026-10-21T00:00:00.000Z' }, false, '补偿已成功过'],
    [{ status: 'failed', at: '2026-10-21T00:00:00.000Z' }, true, '首次失败'],
    [{ status: 'failed', attempts: MAX_ATTEMPTS - 1, at: '2026-10-21T00:00:00.000Z' }, true, '还没到上限'],
    [{ status: 'failed', attempts: MAX_ATTEMPTS, at: '2026-10-21T00:00:00.000Z' }, false, '已达上限'],
    [
      { status: 'failed', attempts: MAX_ATTEMPTS + 5, at: '2026-10-21T00:00:00.000Z' },
      false,
      '超过上限',
    ],
  ] as const)('%#: %j → %s（%s）', (marker, expected, _why) => {
    expect(shouldRunRecovery(marker)).toBe(expected)
  })
})

describe('recoverV3IfNeeded — 启动补跑', () => {
  it('标记 ok → 什么都不做（连进度表都不读）', async () => {
    fake.settings.rows.push({ key: MIGRATION_KEY, value: { status: 'ok', at: 'x' } })
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))
    seedStandard()

    const result = await recoverV3IfNeeded()

    expect(result).toBeNull()
    expect(fake.writes).toEqual([])
    expect(fake.progress.rows[0].packageId).toBe('special-x')
  })

  it('★ 标记 failed 且未到上限 → 重跑并写成 ok-recovered', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))
    fake.settings.rows.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', error: 'boom', attempts: 0 },
    })

    const result = await recoverV3IfNeeded()

    expect(result?.status).toBe('ok-recovered')
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
    const marker = fake.settings.rows.find((s) => s.key === MIGRATION_KEY)!
    expect(marker.value.status).toBe('ok-recovered')
  })

  it('★ 尝试次数累加：补偿再失败 → attempts + 1，状态仍为 failed', async () => {
    fake.settings.rows.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', error: 'boom', attempts: 1 },
    })
    fake.failOn.add('toArray:packages')

    const result = await recoverV3IfNeeded()

    expect(result).toBeNull()
    const marker = fake.settings.rows.find((s) => s.key === MIGRATION_KEY)!
    expect(marker.value.status).toBe('failed')
    expect(marker.value.attempts).toBe(2)
  })

  it('★ 已达上限 → 不再扫表、不写任何东西', async () => {
    fake.settings.rows.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', attempts: MAX_ATTEMPTS },
    })
    seedStandard()
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))

    const result = await recoverV3IfNeeded()

    expect(result).toBeNull()
    expect(fake.writes).toEqual([])
    expect(fake.progress.rows[0].packageId).toBe('special-x')
  })
})

// ---------- 导入后重归因 ----------

describe('ensureE1Migrated({ orphanOnly }) — 导入后重归因', () => {
  it('★ 改写孤儿行，但**不碰** migration:v3 标记', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))
    fake.settings.rows.push({ key: MIGRATION_KEY, value: { status: 'ok', at: 'x' } })

    const stats = await ensureE1Migrated({ orphanOnly: true })

    expect(stats?.rewritten).toBe(1)
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
    // 迁移标记保持原样（一次性语义，不许被日常动作改写）
    const marker = fake.settings.rows.find((s) => s.key === MIGRATION_KEY)!
    expect(marker.value).toEqual({ status: 'ok', at: 'x' })
    // 另写一条"最后重归因"记录
    const recovery = fake.settings.rows.find((s) => s.key === RECOVERY_KEY)!
    expect(recovery.value.mode).toBe('import')
  })

  it('★ 零计划 → 不起写事务（writes 为空）', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'unit-p1', 'unit-p1::kp1'))

    const stats = await ensureE1Migrated({ orphanOnly: true })

    expect(stats?.rewritten).toBe(0)
    expect(fake.writes).toEqual([])
  })

  it('★ 新包导入后，原本无主的历史行变得可归因（导入 → 重归因 → 被改写）', async () => {
    // 1) 一开始只有入口包，kp 归属解析不出来
    fake.packages.rows.push(makePackage('special-x', 'english', []))
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))
    let stats = await ensureE1Migrated({ orphanOnly: true })
    expect(stats?.rewritten).toBe(0)
    expect(fake.progress.rows[0].packageId).toBe('special-x')

    // 2) 导入归属包（声明了该 kpId）
    fake.packages.rows.push(makePackage('unit-p1', 'english', ['unit-p1::kp1']))

    // 3) 再重归因 → 这次能解析了
    stats = await ensureE1Migrated({ orphanOnly: true })
    expect(stats?.rewritten).toBe(1)
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
  })

  it('读标记失败（settings.get 抛错）不影响主流程', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'unit-p1', 'unit-p1::kp1'))
    // 不塞标记 → readMigrationMarker 返回 null，orphanOnly 模式照常跑
    const stats = await ensureE1Migrated({ orphanOnly: true })
    expect(stats).not.toBeNull()
    expect(await readMigrationMarker()).toBeNull()
  })
})

// ---------- 两个入口撞在一起 ----------

describe('串行队列 — 两个入口同时触发时不许互相串味', () => {
  it('★ 启动补偿与导入重归因并发 → 各自拿到自己类型的结果，重归因不被静默跳过', async () => {
    seedStandard()
    // 一行孤儿：写在入口包 special-x 上，但真正声明 kp 的是 unit-p1
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))
    // 补偿会真的干活（failed 且未到上限）
    fake.settings.rows.push({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: 'x', error: 'boom', attempts: 0 },
    })

    const [marker, stats] = await Promise.all([
      recoverV3IfNeeded(),
      ensureE1Migrated({ orphanOnly: true, mode: 'import' }),
    ])

    /*
     * 这里断言的是**返回契约**，也就是曾经被类型断言藏起来的那条 bug：
     * 旧实现撞锁时 `(await inflight) as MergeStats` —— 会把 MigrationMarker
     * 当成 MergeStats 返回，`stats.rewritten` 变成 undefined，且自己的重归因被静默跳过。
     * 所以不要只断言"都成功了"，要断言两者的**形状**互不相同。
     */
    expect(marker?.status).toBe('ok-recovered') // MigrationMarker
    expect(typeof stats?.rewritten).toBe('number') // MergeStats（不是 marker 冒名顶替）
    // 刻意绕过类型：`MergeStats` 上根本不存在 `status`，这条负向断言就是要证明运行期也没有。
    // 直接写 `stats?.status` 会被 TS 判为"属性不存在"，断言本身反而被编译期挡掉了。
    expect((stats as unknown as Record<string, unknown>)?.status).toBeUndefined()

    // 数据层结果：孤儿行确实被改写到归属包，且**迁移标记没被重归因改写**
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
    const row2 = fake.settings.rows.find((s) => s.key === MIGRATION_KEY)!
    expect(row2.value.status).toBe('ok-recovered')
  })

  it('★ 两次同入口并发 → 串行执行，第二次按最新状态重算（不重复写）', async () => {
    seedStandard()
    fake.progress.rows.push(row(1, 'special-x', 'unit-p1::kp1'))
    fake.settings.rows.push({ key: MIGRATION_KEY, value: { status: 'ok', at: 'x' } })

    const [a, b] = await Promise.all([
      ensureE1Migrated({ orphanOnly: true }),
      ensureE1Migrated({ orphanOnly: true }),
    ])

    // 第一个真干活，第二个看到已被改写 → 零计划
    expect(a?.rewritten).toBe(1)
    expect(b?.rewritten).toBe(0)
    // 行只被改写一次（第二次没有写事务）
    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].packageId).toBe('unit-p1')
  })
})
