import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDexie, type TableName } from './helpers/fakeDexie'

/**
 * V1.6 · Stage A · A1 跳版迁移推演（v1→v4 / v2→v4 / v3→v4）
 *
 * ## 为什么这份测试是 Stage A 的最高优先
 * "用户从老版本直接装最新版"是最常见的升级路径，而它要按顺序跑 **v3、v4 两个 upgrade()**。
 * v3 钩子永不 rethrow、失败只写标记；v4 会继续给"尚未归一化"的行补 `profileId`；
 * 启动补偿再跑一次 v3。这条时序此前没有逐行推演过 —— 而它一旦错，
 * 症状正是 Stage A 要堵的那两类：**静默串数据 / 静默丢数据**。
 *
 * ## 怎么在没有 IndexedDB 的前提下推演
 * 两个 upgrade 回调都**接收 `tx` 参数**（`migrateProgressV3(tx)` / `migrateProfileV4(tx)`），
 * 所以塞一个实现 `table(name) → { toArray/get/put/update/delete/add/bulkPut/where }`
 * 的假事务就能完整跑真代码。补偿入口 `recoverV3IfNeeded()` 自己开事务，
 * 由假 `db.transaction` 提供同一个 `tx` 工厂。
 *
 * V1.6 · A6：假事务从内联替身换成共享的 `tests/helpers/fakeDexie.ts` ——
 * 本文件曾是最后一份"自带索引清单"的假 db（schema bump 时改漏它就静默
 * fallback），迁过来之后未知索引抛错、复合索引形参校验、add 撞主键抛错
 * 全部随单一真相一起生效。
 *
 * ## 三条路径 × 三种 v3 结局
 * | 结局 | 语义 |  Dexie 行为 |
 * |---|---|---|
 * | E1 成功 | 计划算出、写入成功 | 版本推进 |
 * | E2 计划失败 | 老数据形状意外 → 写 `failed` 标记后**正常返回** | 版本**照常推进**，靠 `recoverV3IfNeeded()` 补跑 |
 * | E3 写失败 | `put` 抛错 → versionchange 事务 aborted | 版本**不推进**，下次 `open()` 从头重跑 upgrade |
 *
 * E3 在替身里的模拟方式：先把状态快照存下来，写失败后**恢复快照**（等价于事务回滚），
 * 再从头跑一遍 v3。这正是"下次打开"会发生的事。
 *
 * ## 每条路径的六条断言（方案的验收清单）
 *   ① 三张表所有行 `profileId` 非空且 === 'default'
 *   ② 可唯一归属的行已归一化，歧义行原样保留
 *   ③ Σ correctCount / Σ wrongCount / Σ studySeconds 前后严格相等（守恒）
 *   ④ settings 旧键保留 + 9 个 per-profile 分片键齐全
 *   ⑤ achievements 解锁 id 集合前后完全相同（迁移不碰成就语义）
 *   ⑥ 第二次跑 plan 为零（幂等）
 */

const DEFAULT_PID = 'default'

/**
 * 假库 = 共享单一真相（A2 抽取，A6 收编本文件 —— 最后一份内联替身）。
 *
 * `progress` 关掉行级 profileId 断言：本文件的主角就是**迁移前的**老数据，
 * 夹具与 v3 upgrade 的写入都还没有 profileId，要等 v4 upgrade 才补上。
 * "所有行最终都补上 profileId"由断言 ① 自己查 —— 那正是本文件存在的意义。
 */
const fake = createFakeDexie({
  overrides: { progress: { requireProfileId: false } },
})

vi.mock('@/db', () => ({ db: fake.db }))

const { migrateProgressV3, MIGRATION_KEY } = await import('@core/storage/migrateV3')
const { migrateProfileV4, planV4Migration, V4_MARKER_KEY } = await import('@core/storage/migrateV4')
const { recoverV3IfNeeded, readMigrationMarker } = await import('@core/storage/migrateV3Recovery')

/** 假 tx：迁移模块只认 `tx.table(name)` */
const tx = { table: (n: string) => (fake.db as any)[n] } as any

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makePackage(packageId: string, subject: string, kpIds: string[]) {
  return {
    packageId,
    manifest: { packageId, subject, type: 'unit', title: packageId },
    knowledgePoints: kpIds.map((id) => ({ id, title: id })),
    exercises: [],
    units: [],
  }
}

/** v1/v2 形状的进度行：**没有 profileId**，packageId 是入口包 */
function progRow(
  id: number,
  entryPackageId: string,
  kpId: string,
  over: Record<string, any> = {},
) {
  return {
    id,
    packageId: entryPackageId,
    knowledgePointId: kpId,
    status: '学习中',
    correctCount: 2,
    wrongCount: 1,
    correctStreak: 2,
    wrongStreak: 0,
    lastStudiedAt: '2026-10-01T00:00:00.000Z',
    studySeconds: 60,
    reviewStage: 0,
    nextReviewAt: '2026-10-03T00:00:00.000Z',
    lastReviewAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

/** v1/v2 形状的错题行：没有 profileId，packageId 是入口包 */
function mistakeRow(id: number, entryPackageId: string, exerciseId: string) {
  return {
    id,
    packageId: entryPackageId,
    exerciseId,
    knowledgePointIds: [],
    wrongAt: '2026-10-02T00:00:00.000Z',
    wrongCount: 1,
    mastered: false,
    masteryLevel: 'none',
    reviewCorrectCount: 0,
    questionData: { id: exerciseId, question: 'q', answer: 'A' },
    lastUserAnswer: 'B',
  }
}

/** v2 起才有的模考行：没有 profileId */
function sessionRow(id: number, entryPackageId: string) {
  return {
    id,
    packageId: entryPackageId,
    sessionIndex: 1,
    questionIds: ['q1'],
    answers: {},
    currentIndex: 0,
    elapsedSeconds: 30,
    totalCount: 1,
    timeLimit: 0,
    startedAt: '2026-10-05T00:00:00.000Z',
    status: 'finished',
  }
}

/** per-profile 的 9 个键，全部以 **v1/v2 的无后缀形态**种下去（v4 要搬的就是它们） */
const LEGACY_PER_PROFILE_KEYS = [
  'achievements',
  'achievementUi',
  'achievement:collectionSeen',
  'achievement:discovery',
  'achievement:discoveryEnabled',
  'dailyStats',
  'studyStreak',
  'attemptedTypes',
  'customChecks',
] as const

const ACHIEVEMENT_IDS = ['first-step', 'streak-7', 'ten-kp']

/** 九个 per-profile 键的合法值（形状不参与迁移判断，但要能原样搬过去） */
function legacyValue(base: string): unknown {
  switch (base) {
    case 'achievements':
      // V1.5 形状：带重复计数 / 幂等锚点 / grow 游标。打过 V1.5 补丁的库
      // 完全可能是这个形状，迁移必须原样保留（断言 ⑦）。
      return ACHIEVEMENT_IDS.map((id) => ({
        id,
        unlockedAt: '2026-03-01',
        repeatCount: 2,
        lastRepeatPeriod: 'W2026-09-28',
        repeatBase: 12,
      }))
    case 'achievementUi':
      return { v: 1, collapsed: false }
    case 'achievement:collectionSeen':
      return true
    case 'achievement:discovery':
      return { lastShownAt: '2026-09-01', seenIds: ['streak-7'] }
    case 'achievement:discoveryEnabled':
      return true
    case 'dailyStats':
      return [{ day: '2026-09-01', questionCount: 10, firstStudyAt: 0, lastStudyAt: 0 }]
    case 'studyStreak':
      return { current: 5, longest: 9, lastDate: '2026-09-30' }
    case 'attemptedTypes':
      return ['single', 'blank']
    case 'customChecks':
      return { 'home-1::custom::tidy': { at: '2026-09-02T00:00:00.000Z' } }
    default:
      return null
  }
}

/**
 * 包的四种归属形态，对应验收断言 ②：
 *   - `unit-p1::kp1` / `unit-p1::kp2`：唯一归属 → 归一化到 unit-p1
 *   - `shared-kp`：两个包都声明 → 歧义，原样保留
 *   - `orphan::kp`：谁都没声明 → 零候选，原样保留
 *   - `cross-kp`：归属 unit-m1（math），入口包 special-x 是 english → 跨学科，原样保留
 */
function seedPackages() {
  fake.packages.rows.push(
    makePackage('unit-p1', 'english', ['unit-p1::kp1', 'unit-p1::kp2']),
    makePackage('unit-a', 'english', ['shared-kp']),
    makePackage('unit-b', 'english', ['shared-kp']),
    makePackage('unit-m1', 'math', ['cross-kp']),
    makePackage('special-x', 'english', []),
  )
}

/** 进度行：含一组**同键重复**（id 4/5），用来验守恒（漏 delete 就会双算） */
function seedProgress() {
  fake.progress.rows.push(
    progRow(1, 'special-x', 'unit-p1::kp1', { correctCount: 3, wrongCount: 0, studySeconds: 100 }),
    progRow(2, 'special-x', 'unit-p1::kp2', { correctCount: 1, wrongCount: 2, studySeconds: 40 }),
    progRow(3, 'special-x', 'shared-kp', { correctCount: 5, wrongCount: 5, studySeconds: 200 }),
    progRow(4, 'special-x', 'unit-p1::kp1', { correctCount: 2, wrongCount: 0, studySeconds: 60 }),
    progRow(5, 'special-x', 'unit-p1::kp1', { correctCount: 1, wrongCount: 1, studySeconds: 20 }),
    progRow(6, 'special-x', 'orphan::kp', { correctCount: 7, wrongCount: 0, studySeconds: 10 }),
    progRow(7, 'special-x', 'cross-kp', { correctCount: 0, wrongCount: 3, studySeconds: 30 }),
  )
}

/** v1 状态：没有 examSessions 表（v1 schema 里就没这张表） */
function seedV1() {
  seedPackages()
  seedProgress()
  fake.mistakes.rows.push(
    mistakeRow(1, 'special-x', 'ex-1'),
    mistakeRow(2, 'special-x', 'ex-2'),
  )
  for (const base of LEGACY_PER_PROFILE_KEYS) {
    fake.settings.rows.push({ key: base, value: legacyValue(base) })
  }
  // 一个未登记键：v4 会按 per-profile 复制一份并告警（`partial` 语义的来源）
  fake.settings.rows.push({ key: 'weird:thing', value: { note: '未知键' } })
  // `profiles` 故意不种：v4 必须自己建
}

/** v2 状态 = v1 + examSessions 行 */
function seedV2() {
  seedV1()
  fake.examSessions.rows.push(sessionRow(1, 'special-x'), sessionRow(2, 'special-x'))
}

// ---------------------------------------------------------------------------
// 断言助手
// ---------------------------------------------------------------------------

function sums(table: TableName) {
  let correct = 0
  let wrong = 0
  let seconds = 0
  for (const r of fake[table].rows) {
    correct += r.correctCount ?? 0
    wrong += r.wrongCount ?? 0
    seconds += r.studySeconds ?? 0
  }
  return { correct, wrong, seconds }
}

function progressSums(): { correct: number; wrong: number; seconds: number } {
  return sums('progress')
}

function settingsMap(): Map<string, unknown> {
  const m = new Map<string, unknown>()
  for (const r of fake.settings.rows) m.set(r.key, r.value)
  return m
}

/** 断言 ①：三张表所有行 profileId 非空且是 default */
function assertAllRowsScoped() {
  for (const table of ['progress', 'mistakes', 'examSessions'] as const) {
    for (const r of fake[table].rows) {
      expect(r.profileId, `${table}#${r.id} 的 profileId`).toBe(DEFAULT_PID)
    }
  }
}

/** 断言 ②：唯一归属的归一化了，歧义/零候选/跨学科的原样保留 */
function assertOwnerNormalized() {
  const byKey = new Map<string, any>()
  for (const r of fake.progress.rows) {
    byKey.set(`${r.packageId}\u0000${r.knowledgePointId}`, r)
  }
  // 归一化：id 4/5 与 id 1 合并成一行（同键），承载体的字段是合并后的
  const merged = byKey.get(`unit-p1\u0000unit-p1::kp1`)
  expect(merged, 'unit-p1::kp1 应该已归并成一行').toBeDefined()
  expect(merged.correctCount).toBe(6) // 3 + 2 + 1
  expect(merged.wrongCount).toBe(1)
  expect(merged.studySeconds).toBe(180) // 100 + 60 + 20
  expect(byKey.get(`unit-p1\u0000unit-p1::kp2`), 'kp2 也应归一化').toBeDefined()
  // 原样保留的三个形态
  expect(byKey.has(`special-x\u0000shared-kp`), '歧义行应保留入口包').toBe(true)
  expect(byKey.has(`special-x\u0000orphan::kp`), '零候选行应保留入口包').toBe(true)
  expect(byKey.has(`special-x\u0000cross-kp`), '跨学科行应保留入口包').toBe(true)
  // 归一化之后不该再有挂在入口包上的、可唯一归属的行
  expect(byKey.has(`special-x\u0000unit-p1::kp1`)).toBe(false)
  expect(byKey.has(`special-x\u0000unit-p1::kp2`)).toBe(false)
}

/** 断言 ④：旧键保留 + 9 个分片键齐全 */
function assertSettingsSharded() {
  const keys = settingsMap()
  for (const base of LEGACY_PER_PROFILE_KEYS) {
    expect(keys.has(base), `旧键 ${base} 应保留`).toBe(true)
    expect(keys.has(`${base}:${DEFAULT_PID}`), `分片键 ${base}:${DEFAULT_PID} 应存在`).toBe(true)
    // 值是原样搬过去的（迁移不改语义）
    expect(keys.get(`${base}:${DEFAULT_PID}`)).toEqual(keys.get(base))
  }
  // 未知键同样按 per-profile 复制，原键不删
  expect(keys.has('weird:thing')).toBe(true)
  expect(keys.has(`weird:thing:${DEFAULT_PID}`)).toBe(true)
  // v4 自己补的 profiles
  expect(keys.has('profiles')).toBe(true)
}

/** 断言 ⑤：成就解锁 id 集合不变 */
function assertAchievementIdsUnchanged(before: string[]) {
  const after = ((settingsMap().get(`achievements:${DEFAULT_PID}`) ?? []) as Array<{ id: string }>).map(
    (r) => r.id,
  )
  expect([...after].sort()).toEqual([...before].sort())
}

/**
 * 断言 ⑦（V1.6 · 方案增补）：V1.5 重复字段**原样过迁移**。
 *
 * v1/v2 没有 `repeatCount` / `lastRepeatPeriod` / `repeatBase`，但打过
 * V1.5 `repeat: weekly` 补丁的库有 —— 跳版用户完全可能带着它们升 v4。
 * 迁移只搬键、不改值：游标被改一个字节，下一次结算就按错误基线算增量
 * （`repeatBase` 是"本机看到过的最后一个指标值"，不是可重算的事实）。
 */
function assertRepeatCursorIntact() {
  for (const key of ['achievements', `achievements:${DEFAULT_PID}`]) {
    const rows = (settingsMap().get(key) ?? []) as Array<Record<string, unknown>>
    expect(rows, `${key} 应存在`).toHaveLength(ACHIEVEMENT_IDS.length)
    for (const r of rows) {
      expect(r.repeatCount, `${key} · ${r.id} 的 repeatCount`).toBe(2)
      expect(r.lastRepeatPeriod, `${key} · ${r.id} 的 lastRepeatPeriod`).toBe('W2026-09-28')
      expect(r.repeatBase, `${key} · ${r.id} 的 repeatBase`).toBe(12)
    }
  }
}

/** 断言 ⑥：第二次跑 plan 为零 */
async function assertPlansAreIdempotent() {
  const v3 = await import('@core/storage/migrateV3')
  const v3Plan = await v3.planV3Migration(tx)
  expect(v3Plan.puts, 'v3 第二次计划应为零').toEqual([])
  expect(v3Plan.deletes, 'v3 第二次删除应为零').toEqual([])

  const v4Plan = await planV4Migration(tx)
  expect(v4Plan.progressPatches, 'v4 第二次 progress 补列应为零').toEqual([])
  expect(v4Plan.mistakePatches, 'v4 第二次 mistakes 补列应为零').toEqual([])
  expect(v4Plan.sessionPatches, 'v4 第二次 examSessions 补列应为零').toEqual([])
  expect(v4Plan.settingPuts, 'v4 第二次 settings 写入应为零').toEqual([])
  // 未知键每轮都会被报出来（家长端的核对提示不该消失），但**不能膨胀**
  expect(v4Plan.stats.unknownKeys).toEqual(['weird:thing'])
}

beforeEach(() => {
  fake.__reset()
})

// ---------------------------------------------------------------------------
// 三条路径 × 三种 v3 结局
//
// 组织方式：每条路径的六条断言**各自成例**（方案的验收清单 ①~⑥）。
// 合成一条大用例时，第一条断言失败就会把后面五条全部藏起来 ——
// 而跳版迁移的失败恰恰是"哪里红了就去查哪里"，必须能精确定位。
// ---------------------------------------------------------------------------

/** 跑完 v1→v4，返回迁移前的守恒基线 */
async function runV1ToV4(): Promise<Sums> {
  seedV1()
  const before = progressSums()
  await migrateProgressV3(tx)
  await migrateProfileV4(tx)
  return before
}

/** 跑完 v2→v4（= v1 + examSessions 表） */
async function runV2ToV4(): Promise<Sums> {
  seedV2()
  const before = progressSums()
  await migrateProgressV3(tx)
  await migrateProfileV4(tx)
  return before
}

/** 跑完 v3→v4：v3 已在上一版跑过，这次只升 v4 */
async function runV3ToV4(): Promise<Sums> {
  seedV2()
  await migrateProgressV3(tx)
  const before = progressSums()
  await migrateProfileV4(tx)
  return before
}

type Sums = { correct: number; wrong: number; seconds: number }

describe('A1 · v1→v4（老版本直接装最新版）', () => {
  it('① 三张表所有行都补上 profileId=default', async () => {
    await runV1ToV4()
    assertAllRowsScoped()
  })

  it('② 唯一归属的行归一化，歧义/零候选/跨学科原样保留', async () => {
    await runV1ToV4()
    assertOwnerNormalized()
  })

  it('③ Σ correct/wrong/studySeconds 前后严格相等（守恒）', async () => {
    const before = await runV1ToV4()
    expect(progressSums()).toEqual(before)
  })

  it('④ settings 旧键保留 + 9 个 per-profile 分片键齐全', async () => {
    await runV1ToV4()
    assertSettingsSharded()
  })

  it('⑤ achievements 解锁 id 集合前后完全相同', async () => {
    await runV1ToV4()
    assertAchievementIdsUnchanged(ACHIEVEMENT_IDS)
    assertRepeatCursorIntact()
  })

  it('⑥ 第二次跑 plan 为零（幂等）', async () => {
    await runV1ToV4()
    await assertPlansAreIdempotent()
  })

  it('两个标记都落成成功；有未知键 → v4 是 partial 而不是 ok', async () => {
    await runV1ToV4()
    expect((await readMigrationMarker())?.status).toBe('ok')
    const v4Row = await fake.db.settings.get(V4_MARKER_KEY)
    expect((v4Row?.value as any).status).toBe('partial')
    expect((v4Row?.value as any).stats.unknownKeys).toEqual(['weird:thing'])
  })

  it('★ 写入顺序：v3 先 put 后 delete（反过来会让合并丢行）', async () => {
    await runV1ToV4()
    expect(fake.writes).toContain('put:progress')
    expect(fake.writes).toContain('delete:progress')
    expect(fake.writes.indexOf('put:progress')).toBeLessThan(fake.writes.indexOf('delete:progress'))
  })
})

describe('A1 · v2→v4（带 examSessions 的老版本）', () => {
  it('① 三张表所有行都补上 profileId=default', async () => {
    await runV2ToV4()
    assertAllRowsScoped()
  })

  it('② 唯一归属的行归一化，歧义/零候选/跨学科原样保留', async () => {
    await runV2ToV4()
    assertOwnerNormalized()
  })

  it('③ Σ correct/wrong/studySeconds 前后严格相等（守恒）', async () => {
    const before = await runV2ToV4()
    expect(progressSums()).toEqual(before)
  })

  it('④ settings 旧键保留 + 9 个 per-profile 分片键齐全', async () => {
    await runV2ToV4()
    assertSettingsSharded()
  })

  it('⑤ achievements 解锁 id 集合前后完全相同', async () => {
    await runV2ToV4()
    assertAchievementIdsUnchanged(ACHIEVEMENT_IDS)
    assertRepeatCursorIntact()
  })

  it('⑥ 第二次跑 plan 为零（幂等）', async () => {
    await runV2ToV4()
    await assertPlansAreIdempotent()
  })

  it('v2 才有的 examSessions 同样被补上 profileId（不是只补 progress）', async () => {
    await runV2ToV4()
    expect(fake.examSessions.rows.map((s) => s.profileId)).toEqual([DEFAULT_PID, DEFAULT_PID])
  })
})

describe('A1 · v3→v4（v3 已在上一版跑过，直接升）', () => {
  it('① 三张表所有行都补上 profileId=default', async () => {
    await runV3ToV4()
    assertAllRowsScoped()
  })

  it('② 唯一归属的行归一化，歧义/零候选/跨学科原样保留', async () => {
    await runV3ToV4()
    assertOwnerNormalized()
  })

  it('③ Σ correct/wrong/studySeconds 前后严格相等（守恒）', async () => {
    const before = await runV3ToV4()
    expect(progressSums()).toEqual(before)
  })

  it('④ settings 旧键保留 + 9 个 per-profile 分片键齐全', async () => {
    await runV3ToV4()
    assertSettingsSharded()
  })

  it('⑤ achievements 解锁 id 集合前后完全相同', async () => {
    await runV3ToV4()
    assertAchievementIdsUnchanged(ACHIEVEMENT_IDS)
    assertRepeatCursorIntact()
  })

  it('⑥ 第二次跑 plan 为零（幂等）', async () => {
    await runV3ToV4()
    await assertPlansAreIdempotent()
  })

  it('v4 不改写 v3 的标记（两个标记互不覆盖）', async () => {
    await runV3ToV4()
    expect((await readMigrationMarker())?.status).toBe('ok')
    const v4Row = await fake.db.settings.get(V4_MARKER_KEY)
    expect((v4Row?.value as any).status).toBe('partial')
  })
})

describe('A1 · v3 的三种结局', () => {
  it('★ E2 计划失败 → 写 failed、v4 照跑、启动补偿补跑 v3 → ok-recovered', async () => {
    seedV1()
    const before = progressSums()

    // plan 阶段炸：`progress.toArray` 抛错 → planV3Migration 的 catch 命中
    fake.failOn.add('toArray:progress')
    await migrateProgressV3(tx)

    // v3 什么都没改，只写了 failed 标记
    expect((await readMigrationMarker())?.status).toBe('failed')
    expect(progressSums()).toEqual(before)
    expect(fake.progress.rows.every((r) => r.profileId === undefined)).toBe(true)

    // v4 照常跑（版本号已推进，Dexie 不会回头重跑 v3 的 upgrade）
    fake.failOn.delete('toArray:progress')
    await migrateProfileV4(tx)

    // v4 只补了列、搬了键；progress 的归属归一化还没做（那是 v3 的活）
    assertAllRowsScoped()
    assertSettingsSharded()
    expect(await runV3Recovery()).toBe('ok-recovered')
    expect((await readMigrationMarker())?.status).toBe('ok-recovered')

    // 补偿跑完之后，六条断言与"一次成功"完全一致
    assertOwnerNormalized()
    expect(progressSums()).toEqual(before)
    assertAchievementIdsUnchanged(ACHIEVEMENT_IDS)
    assertRepeatCursorIntact()
    await assertPlansAreIdempotent()
  })

  it('★ E2 补偿之后成就键没被复制成两份（v4 搬键与补偿不打架）', async () => {
    seedV1()
    fake.failOn.add('toArray:progress')
    await migrateProgressV3(tx)
    fake.failOn.delete('toArray:progress')
    await migrateProfileV4(tx)
    await runV3Recovery()

    const keys = [...settingsMap().keys()].filter((k) => k.startsWith('achievements'))
    expect(keys.sort()).toEqual(['achievements', 'achievements:default'])
  })

  it('★ E3 写失败 → 事务 abort → 版本不推进 → 下次打开从头重跑，数据不丢', async () => {
    seedV2()
    const before = progressSums()
    const snap = fake.snapshot()

    // 让 apply 阶段炸：第一个 `put:progress` 就抛
    fake.failOn.add('put:progress')
    await migrateProgressV3(tx)

    // 真实 Dexie 行为：versionchange 事务 aborted → **整个事务回滚**、版本号不推进。
    // 替身里等价于恢复快照（连失败时写的 failed 标记也一起回滚）。
    fake.restore(snap)
    fake.failOn.delete('put:progress')
    expect(await readMigrationMarker()).toBeNull()
    expect(progressSums()).toEqual(before)

    // 下次 open()：从头重跑 upgrade（v3 → v4）
    await migrateProgressV3(tx)
    await migrateProfileV4(tx)

    assertAllRowsScoped()
    assertOwnerNormalized()
    expect(progressSums()).toEqual(before)
    assertSettingsSharded()
    assertAchievementIdsUnchanged(ACHIEVEMENT_IDS)
    assertRepeatCursorIntact()
    await assertPlansAreIdempotent()
  })

  it('标记是 ok 时补偿一律不动（一次性语义，不是每次启动都扫全表）', async () => {
    seedV2()
    await migrateProgressV3(tx)
    const before = progressSums()

    expect(await runV3Recovery()).toBeNull()
    expect(progressSums()).toEqual(before)
  })

  it('补偿自己失败一次 → attempts +1、保持 failed；恢复后再补 → ok-recovered', async () => {
    // 真库里 id 是主键、不可能重复；重复 id 会让替身的 update 只命中第一行
    fake.__reset()
    seedV2()
    await fake.db.settings.put({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: '2026-10-01T00:00:00.000Z', attempts: 0, error: 'x' },
    })

    fake.failOn.add('put:progress')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runV3Recovery()).toBeNull()
    warn.mockRestore()

    // 失败也把 attempts 记下来（否则上限形同虚设）
    expect((await readMigrationMarker())?.attempts).toBe(1)
    expect((await readMigrationMarker())?.status).toBe('failed')

    fake.failOn.delete('put:progress')
    expect(await runV3Recovery()).toBe('ok-recovered')
  })

  it('补偿已达上限 → 不再扫全表，保持原样', async () => {
    seedV2()
    await migrateProgressV3(tx)
    const before = progressSums()

    await fake.db.settings.put({
      key: MIGRATION_KEY,
      value: { status: 'failed', at: '2026-10-01T00:00:00.000Z', attempts: 3, error: 'x' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runV3Recovery()).toBeNull()
    warn.mockRestore()

    expect(progressSums()).toEqual(before)
  })
})

/** 跑一次启动补偿，返回标记状态（null = 没跑） */
async function runV3Recovery(): Promise<string | null> {
  const marker = await recoverV3IfNeeded()
  return marker?.status ?? null
}
