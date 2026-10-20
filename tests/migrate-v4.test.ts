import { describe, expect, it } from 'vitest'
import type { Transaction } from 'dexie'
import {
  V4_MARKER_KEY,
  applyV4Plan,
  migrateProfileV4,
  planColumnPatch,
  planV4Migration,
  type V4Marker,
} from '@core/storage/migrateV4'
import { DEFAULT_PROFILE_ID, PROFILES_KEY } from '@core/profile/profileTypes'

/**
 * DB v4 迁移（加列 + 搬键）。
 *
 * 用一个只实现 `toArray / put / update` 的假事务替代 Dexie：迁移铁律之一是
 * **只用 `tx.table(...)`**，假事务里出现别的调用本身就是缺陷信号。
 * 这里守三件事：
 *   1. 只补缺的行（幂等的前提）；
 *   2. settings 搬迁不覆盖已有目标键、不碰 global、unknown 原键保留 + 复制一份；
 *   3. 失败**永不 rethrow**（rethrow 会让 db.open() 失败，整个应用变砖）。
 */

type Row = Record<string, any>

interface FakeTable {
  rows: Row[]
  toArray(): Promise<Row[]>
  put(r: Row): Promise<unknown>
  update(id: any, patch: Row): Promise<number>
  /** 注入读失败（验证"计划构建抛错不向外抛"） */
  failToArray?: Error
  /** 注入写失败（验证"写库失败也不向外抛"） */
  failPut?: Error
}

function makeTable(name: string, rows: Row[], keyOf: (r: Row) => any, log: string[]): FakeTable {
  const table: FakeTable = {
    rows,
    async toArray() {
      if (table.failToArray) throw table.failToArray
      return rows.map((r) => ({ ...r }))
    },
    async put(r: Row) {
      if (table.failPut) throw table.failPut
      const k = keyOf(r)
      log.push(`put:${name}:${String(k)}`)
      const i = rows.findIndex((x) => keyOf(x) === k)
      if (i >= 0) rows[i] = { ...r }
      else rows.push({ ...r })
      return k
    },
    async update(id: any, patch: Row) {
      log.push(`update:${name}:${String(id)}`)
      const i = rows.findIndex((r) => keyOf(r) === id)
      if (i >= 0) rows[i] = { ...rows[i], ...patch }
      return i >= 0 ? 1 : 0
    },
  }
  return table
}

function makeTx(seed: {
  progress?: Row[]
  mistakes?: Row[]
  examSessions?: Row[]
  settings?: Row[]
}) {
  const log: string[] = []
  const progress = makeTable('progress', seed.progress ?? [], (r) => r.id, log)
  const mistakes = makeTable('mistakes', seed.mistakes ?? [], (r) => r.id, log)
  const examSessions = makeTable('examSessions', seed.examSessions ?? [], (r) => r.id, log)
  const settings = makeTable('settings', seed.settings ?? [], (r) => r.key, log)
  const tables: Record<string, FakeTable> = { progress, mistakes, examSessions, settings }
  const tx = {
    table(name: string) {
      const t = tables[name]
      // 未知表必须抛错：静默返回空表会让"根本没搬这张表"的缺陷假通过
      if (!t) throw new Error(`fake tx: 未知表 ${name}`)
      return t
    },
  } as unknown as Transaction
  return { tx, progress, mistakes, examSessions, settings, log }
}

function settingValue(settings: FakeTable, key: string): unknown {
  return settings.rows.find((r) => r.key === key)?.value
}

function marker(settings: FakeTable): V4Marker | undefined {
  return settingValue(settings, V4_MARKER_KEY) as V4Marker | undefined
}

describe('planColumnPatch — 只挑缺 profileId 的行', () => {
  it('缺字段 / 空串 / 纯空白 都要补；已有值的行不能被动（否则会覆盖归属）', () => {
    const patches = planColumnPatch([
      { id: 1 },
      { id: 2, profileId: '' },
      { id: 3, profileId: '   ' },
      { id: 4, profileId: 'p1' },
      { id: 5, profileId: ' default ' },
    ])
    expect(patches).toEqual([
      { id: 1, profileId: DEFAULT_PROFILE_ID },
      { id: 2, profileId: DEFAULT_PROFILE_ID },
      { id: 3, profileId: DEFAULT_PROFILE_ID },
    ])
  })

  it('没有数字 id 的行跳过（update(id) 需要一个可寻址主键）', () => {
    expect(planColumnPatch([{ profileId: '' } as Row, { id: 'x' } as Row])).toEqual([])
  })

  it('空数组 → 空计划', () => {
    expect(planColumnPatch([])).toEqual([])
  })
})

describe('planV4Migration — 三张表补列', () => {
  it('★ 三张表各自只补缺的行，stats 记的是总行数（用于事后核对）', async () => {
    const { tx } = makeTx({
      progress: [{ id: 1 }, { id: 2, profileId: 'p1' }],
      mistakes: [{ id: 3, profileId: '' }],
      examSessions: [{ id: 4 }, { id: 5 }],
    })
    const plan = await planV4Migration(tx)

    expect(plan.progressPatches).toEqual([{ id: 1, profileId: DEFAULT_PROFILE_ID }])
    expect(plan.mistakePatches).toEqual([{ id: 3, profileId: DEFAULT_PROFILE_ID }])
    expect(plan.sessionPatches).toEqual([
      { id: 4, profileId: DEFAULT_PROFILE_ID },
      { id: 5, profileId: DEFAULT_PROFILE_ID },
    ])
    expect(plan.stats).toMatchObject({ progress: 2, mistakes: 1, sessions: 2 })
  })

  it('★ 计划阶段只读不写（写操作混进 plan 会让"失败可回滚"失效）', async () => {
    const { tx, log } = makeTx({ progress: [{ id: 1 }], settings: [{ key: 'dailyStats', value: 1 }] })
    await planV4Migration(tx)
    expect(log).toEqual([])
  })
})

describe('planV4Migration — settings 搬迁', () => {
  it('legacy 键复制成 `:default`，值保持不变', async () => {
    const stats = { total: 7 }
    const { tx } = makeTx({ settings: [{ key: 'dailyStats', value: stats }] })
    const plan = await planV4Migration(tx)

    expect(plan.settingPuts).toContainEqual({ key: 'dailyStats:default', value: stats })
    expect(plan.stats.settingsCopied).toBe(1)
    expect(plan.stats.unknownKeys).toEqual([])
  })

  it('★ `achievement:discovery` 搬成 `achievement:discovery:default`（不能多也不能少一层）', async () => {
    const { tx } = makeTx({ settings: [{ key: 'achievement:discovery', value: ['a'] }] })
    const plan = await planV4Migration(tx)
    const keys = plan.settingPuts.map((p) => p.key)
    expect(keys).toContain('achievement:discovery:default')
    expect(keys).not.toContain('achievement:default')
  })

  it('★ 目标键已存在 → 不覆盖（第二次迁移不能把新档案的数据刷回旧值）', async () => {
    const { tx } = makeTx({
      settings: [
        { key: 'dailyStats', value: { from: 'legacy' } },
        { key: 'dailyStats:default', value: { from: 'new' } },
      ],
    })
    const plan = await planV4Migration(tx)

    expect(plan.settingPuts.filter((p) => p.key === 'dailyStats:default')).toEqual([])
    expect(plan.stats.settingsCopied).toBe(0)
  })

  it('已经是新形态（`base:pid`）的键不动，也不计入 copied', async () => {
    const { tx } = makeTx({ settings: [{ key: 'dailyStats:p1', value: 1 }] })
    const plan = await planV4Migration(tx)
    // `profiles` 的初始化是另一条职责，这里只关心"没有多搬一份"
    expect(plan.settingPuts.filter((p) => p.key !== PROFILES_KEY)).toEqual([])
    expect(plan.stats.settingsCopied).toBe(0)
  })

  it('global 键一律跳过（主题/迁移标记与孩子无关，复制一份只会误导）', async () => {
    const { tx } = makeTx({
      settings: [
        { key: 'fls:theme', value: 'dark' },
        { key: 'migration:v3', value: { status: 'ok' } },
        { key: 'achievement:customPacks', value: [] },
      ],
    })
    const plan = await planV4Migration(tx)
    expect(plan.settingPuts.filter((p) => p.key !== PROFILES_KEY)).toEqual([])
    expect(plan.stats.unknownKeys).toEqual([])
  })

  it('★ unknown 键：原键保留 + 额外复制一份 `:default` + 进入 unknownKeys', async () => {
    const { tx } = makeTx({ settings: [{ key: 'weird:thing', value: 'v' }] })
    const plan = await planV4Migration(tx)

    const keys = plan.settingPuts.map((p) => p.key)
    expect(keys).toContain('weird:thing:default')
    // 原键**不在** put 列表里（计划里根本没有删除动作，等于保留）
    expect(keys).not.toContain('weird:thing')
    expect(plan.stats.unknownKeys).toEqual(['weird:thing'])
    expect(plan.stats.settingsCopied).toBe(1)
  })

  it('★ 脏键 `dailyStats:`（空后缀）走 unknown 分支，不能被搬成 `dailyStats:default`', async () => {
    const { tx } = makeTx({ settings: [{ key: 'dailyStats:', value: 'x' }] })
    const plan = await planV4Migration(tx)
    expect(plan.settingPuts.map((p) => p.key)).toEqual(['dailyStats::default', PROFILES_KEY])
    expect(plan.stats.unknownKeys).toEqual(['dailyStats:'])
  })
})

describe('planV4Migration — profiles 键', () => {
  it('★ 缺失时写入单个 default 档案（activeId/list 都要对，否则 UI 读出来是空列表）', async () => {
    const { tx } = makeTx({})
    const plan = await planV4Migration(tx)

    const put = plan.settingPuts.find((p) => p.key === PROFILES_KEY)
    expect(put).toBeTruthy()
    const value = put!.value as { activeId: string; list: Array<{ id: string; name: string }> }
    expect(value.activeId).toBe(DEFAULT_PROFILE_ID)
    expect(value.list).toHaveLength(1)
    expect(value.list[0].id).toBe(DEFAULT_PROFILE_ID)
    expect(typeof value.list[0].name).toBe('string')
  })

  it('已存在时不重写（否则每次迁移都会把家长改过的档案名刷回默认）', async () => {
    const existing = { activeId: 'p1', list: [{ id: 'p1', name: '老大', createdAt: 'c' }] }
    const { tx } = makeTx({ settings: [{ key: PROFILES_KEY, value: existing }] })
    const plan = await planV4Migration(tx)
    expect(plan.settingPuts.find((p) => p.key === PROFILES_KEY)).toBeUndefined()
  })
})

describe('幂等 —— 跑第二遍必须是空计划', () => {
  it('★ apply 之后再 plan：三个补丁数组与 settingPuts 全空，且不产生 `:default:default`', async () => {
    const harness = makeTx({
      progress: [{ id: 1 }],
      mistakes: [{ id: 2 }],
      examSessions: [{ id: 3 }],
      settings: [
        { key: 'dailyStats', value: 1 },
        { key: 'achievement:discovery', value: 2 },
        { key: 'fls:theme', value: 'dark' },
      ],
    })

    const first = await planV4Migration(harness.tx)
    await applyV4Plan(harness.tx, first)

    const second = await planV4Migration(harness.tx)
    expect(second.progressPatches).toEqual([])
    expect(second.mistakePatches).toEqual([])
    expect(second.sessionPatches).toEqual([])
    expect(second.settingPuts).toEqual([])
    expect(second.stats.settingsCopied).toBe(0)

    const keys = harness.settings.rows.map((r) => r.key)
    expect(keys).toContain('dailyStats:default')
    expect(keys).toContain('achievement:discovery:default')
    expect(keys.filter((k) => k.includes(':default:default'))).toEqual([])
  })

  /**
   * 【原为已知缺陷，已修：migrateV4.ts unknown 分支加了后缀闸门】
   *
   * 第一轮把 `weird:thing` 复制成 `weird:thing:default`（原键保留，这本身是对的）。
   * 修复前：第二轮时 `weird:thing:default` 自己也不在任何清单里 → 又被当成 unknown 再复制一层，
   * 于是每跑一次迁移/补偿就多一层 `:default`，`unknownKeys` 也跟着膨胀；
   * 补偿最多跑 `V4_MAX_ATTEMPTS` 次，一条脏键会长成 4 层后缀。
   *
   * 现在两个面都要锁死：**不产生新写入** 且 **告警列表不膨胀**（副本不是新信息，
   * 原键每轮仍会被报出来，家长端的核对提示不会因此消失）。
   */
  it('★ unknown 键第二轮不再追加 `:default`（不写 + 告警不膨胀）', async () => {
    const harness = makeTx({ settings: [{ key: 'weird:thing', value: 3 }] })
    const first = await planV4Migration(harness.tx)
    await applyV4Plan(harness.tx, first)
    expect(first.stats.unknownKeys).toEqual(['weird:thing'])

    const second = await planV4Migration(harness.tx)
    expect(second.settingPuts).toEqual([])
    expect(second.stats.unknownKeys).toEqual(['weird:thing'])
    // `profiles` 由同一份计划补出（v4 必需键），除此之外只该有原键 + 一层副本
    expect(harness.settings.rows.map((r) => r.key).sort()).toEqual([
      'profiles',
      'weird:thing',
      'weird:thing:default',
    ])
  })

  it('★ 补偿跑满 V4_MAX_ATTEMPTS 轮也只有一层后缀（脏键不滚雪球）', async () => {
    const harness = makeTx({ settings: [{ key: 'weird:thing', value: 3 }] })
    // 手写循环而不是调 ensureV4Migrated：本用例只验"计划多次应用"的幂等性
    for (let i = 0; i < 4; i++) {
      await applyV4Plan(harness.tx, await planV4Migration(harness.tx))
    }
    const keys = harness.settings.rows.map((r) => r.key)
    expect(keys.filter((k) => k.includes(':default:default'))).toEqual([])
    expect(keys.filter((k) => k === 'weird:thing:default')).toHaveLength(1)
  })

  /**
   * 后缀闸门的**反面**：不能把"以 :default 结尾"当成"这行是副本"的充分证据。
   * 第三方键本来就可能叫 `vendor:flag:default`，若一刀切跳过，它就既不被搬也不被告警
   * —— 正好撞上 v4 最怕的"漏搬且无告警"。闸门要求「父键在场」才认副本。
   */
  it('★ 第三方键本来就叫 `vendor:flag:default`（父键不在库）→ 照常搬 + 照常告警', async () => {
    const harness = makeTx({ settings: [{ key: 'vendor:flag:default', value: 7 }] })
    const plan = await planV4Migration(harness.tx)
    expect(plan.stats.unknownKeys).toEqual(['vendor:flag:default'])
    expect(plan.settingPuts).toContainEqual({ key: 'vendor:flag:default:default', value: 7 })

    await applyV4Plan(harness.tx, plan)
    // 副本的父键此时已在场 → 第二轮既不再套第三层，也没有新的告警项
    const second = await planV4Migration(harness.tx)
    expect(second.settingPuts).toEqual([])
    expect(second.stats.unknownKeys).toEqual(['vendor:flag:default'])
  })

  it('★ apply 同样跑两遍不重复插行（put 按 key 覆盖）', async () => {
    const harness = makeTx({ settings: [{ key: 'dailyStats', value: 1 }] })
    const plan = await planV4Migration(harness.tx)
    await applyV4Plan(harness.tx, plan)
    await applyV4Plan(harness.tx, plan)

    expect(harness.settings.rows.filter((r) => r.key === 'dailyStats:default')).toHaveLength(1)
  })
})

describe('applyV4Plan — 哑 IO 的顺序', () => {
  it('★ 按 progress → mistakes → examSessions → settings 的顺序写，且不做任何读取', async () => {
    const harness = makeTx({
      progress: [{ id: 1 }],
      mistakes: [{ id: 3 }],
      examSessions: [{ id: 4 }],
      settings: [{ key: 'dailyStats', value: 1 }],
    })
    const plan = await planV4Migration(harness.tx)
    harness.log.length = 0
    await applyV4Plan(harness.tx, plan)

    expect(harness.log).toEqual([
      'update:progress:1',
      'update:mistakes:3',
      'update:examSessions:4',
      'put:settings:dailyStats:default',
      `put:settings:${PROFILES_KEY}`,
    ])
  })

  it('★ 实际落库后行上真的多了 profileId，且原有字段没被删', async () => {
    const harness = makeTx({ progress: [{ id: 1, packageId: 'pkg', correctCount: 3 }] })
    const plan = await planV4Migration(harness.tx)
    await applyV4Plan(harness.tx, plan)

    expect(harness.progress.rows[0]).toMatchObject({
      id: 1,
      packageId: 'pkg',
      correctCount: 3,
      profileId: DEFAULT_PROFILE_ID,
    })
  })
})

describe('migrateProfileV4 — 标记与失败路径', () => {
  it('正常路径：数据搬完 + 写 status=ok 且带 stats', async () => {
    const harness = makeTx({
      progress: [{ id: 1 }],
      settings: [{ key: 'dailyStats', value: 1 }],
    })
    await migrateProfileV4(harness.tx)

    expect(harness.progress.rows[0].profileId).toBe(DEFAULT_PROFILE_ID)
    expect(settingValue(harness.settings, 'dailyStats:default')).toBe(1)
    const m = marker(harness.settings)!
    expect(m.status).toBe('ok')
    expect(m.stats).toMatchObject({ progress: 1, settingsCopied: 1, unknownKeys: [] })
    expect(typeof m.at).toBe('string')
  })

  it('★ 有 unknown 键 → status=partial（不能报 ok，否则家长端不会提示核对）', async () => {
    const harness = makeTx({ settings: [{ key: 'weird:thing', value: 1 }] })
    await migrateProfileV4(harness.tx)

    const m = marker(harness.settings)!
    expect(m.status).toBe('partial')
    expect(m.stats!.unknownKeys).toEqual(['weird:thing'])
  })

  it('★ 计划构建抛错 → 不 rethrow，写 status=failed / attempts=0，且一条数据都不改', async () => {
    const harness = makeTx({
      progress: [{ id: 1 }],
      settings: [{ key: 'dailyStats', value: 1 }],
    })
    harness.progress.failToArray = new Error('boom')

    await expect(migrateProfileV4(harness.tx)).resolves.toBeUndefined()

    const m = marker(harness.settings)!
    expect(m.status).toBe('failed')
    expect(m.attempts).toBe(0)
    expect(m.error).toContain('boom')
    // 计划失败就不该有半成品：补丁与搬键都没发生
    expect(harness.settings.rows.map((r) => r.key)).toEqual(['dailyStats', V4_MARKER_KEY])
  })

  it('★ 写库抛错 → 同样不 rethrow（rethrow 会让 db.open() 失败，应用变砖）', async () => {
    const harness = makeTx({ progress: [{ id: 1 }] })
    harness.progress.update = (async () => {
      throw new Error('disk full')
    }) as FakeTable['update']

    await expect(migrateProfileV4(harness.tx)).resolves.toBeUndefined()
    expect(marker(harness.settings)!.status).toBe('failed')
  })

  it('连 failed 标记都写不进去时也必须静默返回（版本号照常推进，靠补偿兜底）', async () => {
    const harness = makeTx({ progress: [{ id: 1 }] })
    harness.progress.failToArray = new Error('boom')
    harness.settings.failPut = new Error('settings broken')

    await expect(migrateProfileV4(harness.tx)).resolves.toBeUndefined()
  })
})
