import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 自定义成就包 · **存储层**（V1.4 · B3）
 *
 * 这一层守的是四个"用户看得见"的后果，而不是"函数被调用了"：
 *   1. 导入完就能用（`enabled: true`）—— 否则家长导入了却看不到卡；
 *   2. 重新导入 = 升版 + 可回滚，但**不该顺手把停用的包打开**；
 *   3. 停用 / 回滚**一个字都不动** `customChecks:<pid>` 与 `achievements:<pid>`
 *      （AC-P2-3 / AC-P2-4：停用是"不想要这张卡"，不是"销毁证据"）；
 *   4. 审计是旁路：写失败不能让已成功的启用变成异常。
 *
 * 用内存版 Dexie 替身（只需 settings 表），写法参考 `tests/profile-store.test.ts`。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const flags = { failGet: false, failPut: false, failPutKeys: [] as string[] }
  const rows: Row[] = []

  const settings: any = {
    rows,
    /** 写入次数：用来断言"校验失败一个字节都没写" */
    puts: 0,
    __reset() {
      rows.length = 0
      settings.puts = 0
      flags.failGet = false
      flags.failPut = false
      flags.failPutKeys = []
    },
    async get(k: any) {
      if (flags.failGet) throw new Error('settings get failed')
      return rows.find((r) => r.key === k)
    },
    async put(r: Row) {
      if (flags.failPut || flags.failPutKeys.includes(r.key)) throw new Error('settings put failed')
      settings.puts++
      const i = rows.findIndex((x) => x.key === r.key)
      if (i >= 0) rows[i] = { ...r }
      else rows.push({ ...r })
      return r.key
    },
    async delete(k: any) {
      const i = rows.findIndex((x) => x.key === k)
      if (i >= 0) rows.splice(i, 1)
    },
    async toArray() {
      return rows.map((r) => ({ ...r }))
    },
  }

  return { settings, flags, __reset: () => settings.__reset() }
})

vi.mock('@/db', () => ({ db: fake }))

const {
  AUDIT_LIMIT,
  disablePack,
  enablePack,
  enabledPacks,
  importPack,
  loadChecks,
  loadPackState,
  normalizeAudit,
  normalizeChecks,
  normalizePackState,
  readAudit,
  rollbackPack,
  savePackState,
  setCheck,
} = await import('@core/motivation/customPackStore')
const {
  AUDIT_KEY,
  CUSTOM_CHECKS_BASE,
  CUSTOM_PACKS_KEY,
  checkKey,
} = await import('@core/motivation/customPackTypes')

const PID = 'default' // 未 initProfile 时 currentProfileId() 的惰性默认值
const CHECKS_KEY = `${CUSTOM_CHECKS_BASE}:${PID}`
const ACHIEVEMENTS_KEY = `achievements:${PID}`

/** 一份结构合法的包（v1：两张卡，一张 counter、一张 manual-check） */
function packV1() {
  return {
    schemaVersion: 1,
    packId: 'pack-alpha',
    name: '家庭自定',
    achievements: [
      {
        id: 'custom::read-3',
        icon: '📖',
        title: '阅读三天',
        desc: '连续三天阅读',
        category: 'B',
        source: 'habit',
        metered: true,
        target: 3,
        rule: { kind: 'counter', metric: 'streak', target: 3 },
      },
      {
        id: 'custom::tidy-desk',
        icon: '🧹',
        title: '整理书桌',
        desc: '家长确认书桌整理好了',
        category: 'B',
        source: 'core',
        metered: false,
        rule: { kind: 'manual-check', prompt: '书桌整理好了吗' },
      },
    ],
  }
}

/** 同名升版：第一张卡的门槛提到 5 */
function packV2() {
  const p = packV1()
  p.achievements[0].target = 5
  p.achievements[0].rule = { kind: 'counter', metric: 'streak', target: 5 }
  p.achievements[0].desc = '连续五天阅读'
  return p
}

function rowValue(key: string): any {
  // `fake.settings` 在夹具里显式声明成 `any`（只需 settings 表），在 any 上调
  // `.find()` 回调形参会被推成隐式 any → 必须自己标注（B1 打开 tests 类型检查时暴露）
  return fake.settings.rows.find((r: { key: string; value?: unknown }) => r.key === key)?.value
}

function stored(packId = 'pack-alpha') {
  const state = rowValue(CUSTOM_PACKS_KEY)
  return state.packs.find((p: any) => p.packId === packId)
}

beforeEach(() => {
  fake.__reset()
})

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

describe('归一化：脏数据一律降级，绝不抛', () => {
  it('包清单：非对象 / packs 不是数组 / 空 → 空集合', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { packs: 'x' }, { packs: [] }]) {
      expect(normalizePackState(raw)).toEqual({ packs: [] })
    }
  })

  it('★ 丢掉结构不完整的条目（半个包比没有包更危险），有效条目原样保留', () => {
    const good = {
      packId: 'p-ok',
      enabled: true,
      version: 2,
      pack: { schemaVersion: 1, packId: 'p-ok', achievements: [] },
      previous: null,
      importedAt: '2026-01-01T00:00:00.000Z',
      enabledAt: '2026-01-01T00:00:00.000Z',
    }
    const state = normalizePackState({
      packs: [
        null,
        'nope',
        { packId: 'p-no-pack' },
        // 内外 packId 不一致：被人工改过，不可信
        {
          packId: 'p-a',
          pack: { schemaVersion: 1, packId: 'p-b', achievements: [] },
          version: 1,
        },
        good,
      ],
    })

    expect(state.packs.map((p) => p.packId)).toEqual(['p-ok'])
    expect(state.packs[0].version).toBe(2)
    expect(state.packs[0].enabled).toBe(true)
  })

  it('★ 同一个 packId 出现两次 → 保留第一条（后出现的多半是半失败的重复写入）', () => {
    const mk = (version: number) => ({
      packId: 'dup',
      enabled: true,
      version,
      pack: { schemaVersion: 1, packId: 'dup', achievements: [] },
      previous: null,
      importedAt: 't',
    })
    const state = normalizePackState({ packs: [mk(1), mk(9)] })
    expect(state.packs).toHaveLength(1)
    expect(state.packs[0].version).toBe(1)
  })

  it('enabled 只有明确的 true 才算启用（读不清就当停用，少显示一张假卡）', () => {
    const state = normalizePackState({
      packs: [
        {
          packId: 'p',
          enabled: 'yes',
          version: 1,
          pack: { schemaVersion: 1, packId: 'p', achievements: [] },
          previous: null,
          importedAt: 't',
        },
      ],
    })
    expect(state.packs[0].enabled).toBe(false)
  })

  it('版本号脏值（NaN / 0 / 负数）一律按 1', () => {
    for (const version of [Number.NaN, 0, -3, '2', null]) {
      const state = normalizePackState({
        packs: [
          {
            packId: 'p',
            enabled: true,
            version,
            pack: { schemaVersion: 1, packId: 'p', achievements: [] },
            previous: null,
            importedAt: 't',
          },
        ],
      })
      expect(state.packs[0].version).toBe(1)
    }
  })

  it('勾选：at 不是字符串 → 留空串但**不丢这条勾选**（丢勾选=抹掉已确认的事实）', () => {
    expect(normalizeChecks(null)).toEqual({})
    expect(normalizeChecks([1, 2])).toEqual({})
    expect(normalizeChecks({ 'p::a': { at: 123 }, 'p::b': { at: 'T' }, bad: 1 })).toEqual({
      'p::a': { at: '' },
      'p::b': { at: 'T' },
    })
  })

  it('审计：坏条目丢弃，合法条目保留', () => {
    expect(normalizeAudit('x')).toEqual([])
    expect(
      normalizeAudit([
        { at: 'T', action: 'import', packId: 'p', affected: 2 },
        { at: 'T', action: 'unknown-action', packId: 'p', affected: 1 },
        { at: '', action: 'enable', packId: 'p', affected: 1 },
        { at: 'T', action: 'disable', packId: '', affected: 1 },
      ])
    ).toEqual([{ at: 'T', action: 'import', packId: 'p', affected: 2 }])
  })
})

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

describe('importPack — 导入即启用', () => {
  it('★ 首次导入：enabled=true + enabledAt，version=1，previous=null', async () => {
    const res = await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.version).toBe(1)
    expect(res.pack.packId).toBe('pack-alpha')
    expect(res.preview.packId).toBe('pack-alpha')
    expect(res.preview.replaces).toBeNull()

    const s = stored()
    expect(s.enabled).toBe(true)
    expect(s.enabledAt).toBe('2026-10-20T08:00:00.000Z')
    expect(s.version).toBe(1)
    expect(s.previous).toBeNull()
    expect(s.pack.achievements).toHaveLength(2)

    // 导入完就能拿到（不需要再点一次启用）
    expect((await enabledPacks()).map((p) => p.packId)).toEqual(['pack-alpha'])
  })

  it('★ 首次导入写一条 import 审计：affected = 新增枚数，detail 可读', async () => {
    await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))
    const audit = await readAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      at: '2026-10-20T08:00:00.000Z',
      action: 'import',
      packId: 'pack-alpha',
      affected: 2,
    })
    expect(audit[0].detail).toContain('新装')
  })

  it('★ 校验不过：一个字节都不写（puts 保持 0），错误原样返回', async () => {
    const res = await importPack({ schemaVersion: 1, packId: '', achievements: [] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors.every((e) => typeof e.path === 'string' && typeof e.code === 'string')).toBe(true)

    expect(fake.settings.puts).toBe(0)
    expect(rowValue(CUSTOM_PACKS_KEY)).toBeUndefined()
    expect(rowValue(AUDIT_KEY)).toBeUndefined()
  })

  it('★ 同 packId 再导入：version+1、previous 指向旧版、审计 v1 → v2', async () => {
    await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))
    const res = await importPack(packV2(), new Date('2026-10-21T08:00:00.000Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.version).toBe(2)

    const s = stored()
    expect(s.version).toBe(2)
    expect(s.pack.achievements[0].target).toBe(5)
    expect(s.previous).not.toBeNull()
    expect(s.previous.version).toBe(1)
    expect(s.previous.pack.achievements[0].target).toBe(3)

    const audit = await readAudit()
    expect(audit).toHaveLength(2)
    // 新的在前
    expect(audit[0].action).toBe('import')
    expect(audit[0].detail).toBe('v1 → v2')
    expect(audit[0].affected).toBe(2) // 升版口径 = 本版枚数
  })

  it('★ 重新导入**不**顺手启用：停用过的包升版后仍然是停用的', async () => {
    await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))
    await disablePack('pack-alpha', new Date('2026-10-20T09:00:00.000Z'))
    expect(stored().enabled).toBe(false)

    const res = await importPack(packV2(), new Date('2026-10-21T08:00:00.000Z'))
    expect(res.ok).toBe(true)

    const s = stored()
    expect(s.enabled).toBe(false)
    expect(s.enabledAt).toBeUndefined()
    expect(s.version).toBe(2)
    expect((await enabledPacks())).toEqual([])
  })

  it('两个不同的包可以共存，enabledPacks 按安装顺序返回', async () => {
    const other = packV1()
    other.packId = 'pack-beta'
    other.achievements = [other.achievements[1]]
    other.achievements[0].id = 'custom::wash-hands'

    await importPack(packV1())
    await importPack(other)

    expect((await loadPackState()).packs.map((p) => p.packId)).toEqual(['pack-alpha', 'pack-beta'])
    expect((await enabledPacks()).map((p) => p.packId)).toEqual(['pack-alpha', 'pack-beta'])
  })
})

// ---------------------------------------------------------------------------
// 跨包同 id 闸门（E_ID_OTHER_PACK）
// ---------------------------------------------------------------------------

/** 另一个包，但复用了 `pack-alpha` 里的同一枚 id */
function rivalPack(packId: string) {
  const p = packV1()
  p.packId = packId
  p.achievements = [
    {
      ...p.achievements[0],
      // 与 pack-alpha 的 'custom::read-3' 撞 id
      id: 'custom::read-3',
      title: '别人的阅读卡',
    },
  ]
  return p
}

describe('跨包同 id 闸门（E_ID_OTHER_PACK）', () => {
  it('★ 另一个包已占用同一 id → 拒绝，且不落库、不写审计（被拒的导入不留痕迹）', async () => {
    await importPack(packV1())
    const putsBefore = fake.settings.puts
    const stateBefore = rowValue(CUSTOM_PACKS_KEY)
    const auditBefore = await readAudit()

    const res = await importPack(rivalPack('pack-beta'))

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0]).toMatchObject({ path: 'achievements[0].id', code: 'E_ID_OTHER_PACK' })
    // 报错文案要告诉家长"被谁占了"，否则他没法改
    expect(res.errors[0].message).toContain('pack-alpha')

    expect(fake.settings.puts).toBe(putsBefore)
    expect(rowValue(CUSTOM_PACKS_KEY)).toEqual(stateBefore)
    expect(await readAudit()).toEqual(auditBefore)
  })

  it('★ 停用包占用的 id 同样算冲突（解锁记录还在，重新启用就会串卡）', async () => {
    await importPack(packV1())
    await disablePack('pack-alpha')

    const res = await importPack(rivalPack('pack-beta'))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0].code).toBe('E_ID_OTHER_PACK')
  })

  it('★ 同 packId 的旧版本里有同一个 id **不算**冲突（那是升版，别误伤）', async () => {
    await importPack(packV1())
    const res = await importPack(packV2())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.preview.conflicts).toEqual([])
    expect(res.version).toBe(2)
  })

  it('多个冲突一次性全部报出来（不让孩子改一个再撞一个）', async () => {
    await importPack(packV1())

    const rival = packV2()
    rival.packId = 'pack-gamma'
    // 两张卡的 id 都与 pack-alpha 相撞
    rival.achievements[0].id = 'custom::read-3'
    rival.achievements[1].id = 'custom::tidy-desk'

    const res = await importPack(rival)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors).toHaveLength(2)
    expect(res.errors.map((e) => e.path)).toEqual(['achievements[0].id', 'achievements[1].id'])
    expect(res.errors.every((e) => e.code === 'E_ID_OTHER_PACK')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 启用 / 停用
// ---------------------------------------------------------------------------
describe('enable / disable', () => {
  beforeEach(async () => {
    await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))
  })

  it('★ 停用：只关开关，enabledAt 清空', async () => {
    await disablePack('pack-alpha', new Date('2026-10-20T09:00:00.000Z'))
    const s = stored()
    expect(s.enabled).toBe(false)
    expect('enabledAt' in s).toBe(false)
    expect(await enabledPacks()).toEqual([])
  })

  it('★ 停用不动 customChecks 与 achievements（AC-P2-3 / AC-P2-4 的核心判据）', async () => {
    const checks = { [checkKey('pack-alpha', 'custom::tidy-desk')]: { at: 'T1' } }
    const unlocked = [{ id: 'custom::tidy-desk', unlockedAt: '2026-10-20' }]
    await fake.settings.put({ key: CHECKS_KEY, value: checks })
    await fake.settings.put({ key: ACHIEVEMENTS_KEY, value: unlocked })

    await disablePack('pack-alpha')

    expect(rowValue(CHECKS_KEY)).toEqual(checks)
    expect(rowValue(ACHIEVEMENTS_KEY)).toEqual(unlocked)
  })

  it('★ 回滚同样不动这两个键（解锁记录一条不少）', async () => {
    const checks = { [checkKey('pack-alpha', 'custom::tidy-desk')]: { at: 'T1' } }
    const unlocked = [{ id: 'custom::read-3', unlockedAt: '2026-10-20' }]
    await fake.settings.put({ key: CHECKS_KEY, value: checks })
    await fake.settings.put({ key: ACHIEVEMENTS_KEY, value: unlocked })

    await importPack(packV2())
    await rollbackPack('pack-alpha')

    expect(rowValue(CHECKS_KEY)).toEqual(checks)
    expect(rowValue(ACHIEVEMENTS_KEY)).toEqual(unlocked)
  })

  it('停用后重新启用：enabledAt 用这次的时间（不是历史的）', async () => {
    await disablePack('pack-alpha', new Date('2026-10-20T09:00:00.000Z'))
    await enablePack('pack-alpha', new Date('2026-10-22T10:00:00.000Z'))
    const s = stored()
    expect(s.enabled).toBe(true)
    expect(s.enabledAt).toBe('2026-10-22T10:00:00.000Z')
  })

  it('★ 重复启用不改 enabledAt（那是"最早启用时间"，重写等于伪造历史），但仍留审计', async () => {
    await enablePack('pack-alpha', new Date('2026-10-25T10:00:00.000Z'))
    expect(stored().enabledAt).toBe('2026-10-20T08:00:00.000Z')

    const audit = await readAudit()
    expect(audit[0].action).toBe('enable')
    expect(audit[0].detail).toContain('重复启用')
  })

  it('对不存在的包启用 / 停用 / 回滚都抛错（写路径不接受"悄悄什么都没发生"）', async () => {
    await expect(enablePack('ghost')).rejects.toThrow(/包不存在/)
    await expect(disablePack('ghost')).rejects.toThrow(/包不存在/)
    await expect(rollbackPack('ghost')).rejects.toThrow(/包不存在/)
  })
})

// ---------------------------------------------------------------------------
// 回滚
// ---------------------------------------------------------------------------

describe('rollbackPack', () => {
  it('★ 回滚后 pack/version 回到上一版，previous 清空，enabled 不变', async () => {
    await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))
    await importPack(packV2(), new Date('2026-10-21T08:00:00.000Z'))
    expect(stored().version).toBe(2)

    const res = await rollbackPack('pack-alpha', new Date('2026-10-22T08:00:00.000Z'))
    expect(res).toEqual({ fromVersion: 2, toVersion: 1 })

    const s = stored()
    expect(s.version).toBe(1)
    expect(s.pack.achievements[0].target).toBe(3)
    expect(s.previous).toBeNull()
    // 回滚是"内容退版"，不是"状态退版"
    expect(s.enabled).toBe(true)
    expect(s.enabledAt).toBe('2026-10-20T08:00:00.000Z')

    const audit = await readAudit()
    expect(audit[0]).toMatchObject({ action: 'rollback', packId: 'pack-alpha', detail: 'v2 → v1' })
    // 版本差枚数：两版都是 2 枚 → 0
    expect(audit[0].affected).toBe(0)
  })

  it('★ 只退一版：回滚第二次报"没有可回滚的版本"', async () => {
    await importPack(packV1())
    await importPack(packV2())
    await rollbackPack('pack-alpha')

    await expect(rollbackPack('pack-alpha')).rejects.toThrow('没有可回滚的版本')
  })

  it('首次导入（previous=null）直接回滚 → 抛错', async () => {
    await importPack(packV1())
    await expect(rollbackPack('pack-alpha')).rejects.toThrow('没有可回滚的版本')
  })

  it('回滚后仍可再导入升版（previous 重新指向刚回滚到的那一版）', async () => {
    await importPack(packV1())
    await importPack(packV2())
    await rollbackPack('pack-alpha')
    await importPack(packV2())

    const s = stored()
    expect(s.version).toBe(2)
    expect(s.previous.version).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

describe('审计日志', () => {
  it('★ 上限 200 条，新的在前，超出丢最旧的', async () => {
    const seed = Array.from({ length: AUDIT_LIMIT }, (_, i) => ({
      at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      action: 'import' as const,
      packId: `old-${i}`,
      affected: 1,
    }))
    await fake.settings.put({ key: AUDIT_KEY, value: seed })
    expect(await readAudit()).toHaveLength(AUDIT_LIMIT)

    await importPack(packV1(), new Date('2026-10-20T08:00:00.000Z'))

    const audit = await readAudit()
    expect(audit).toHaveLength(AUDIT_LIMIT)
    expect(audit[0]).toMatchObject({ action: 'import', packId: 'pack-alpha' })
    // 最旧的那条（数组尾部）被挤掉；最靠前的那条（原本最新的）留下来
    expect(audit.some((e) => e.packId === 'old-199')).toBe(false)
    expect(audit.some((e) => e.packId === 'old-0')).toBe(true)
  })

  it('★ 审计写失败只告警，不否定已成功的操作（enable 仍然生效）', async () => {
    await importPack(packV1())
    const before = await readAudit()
    fake.flags.failPutKeys = [AUDIT_KEY]

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(enablePack('pack-alpha')).resolves.toBeUndefined()
    warn.mockRestore()

    expect(await readAudit()).toEqual(before)
    expect(stored().enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 勾选
// ---------------------------------------------------------------------------

describe('setCheck', () => {
  it('★ checked=false 是**删键**（留下 { at, checked: false } 会让读侧出现第二套判据）', async () => {
    await setCheck('pack-alpha', 'custom::tidy-desk', true, new Date('2026-10-20T10:00:00.000Z'))
    const checks = rowValue(CHECKS_KEY)
    expect(checks[checkKey('pack-alpha', 'custom::tidy-desk')]).toEqual({
      at: '2026-10-20T10:00:00.000Z',
    })

    await setCheck('pack-alpha', 'custom::tidy-desk', false)
    const after = rowValue(CHECKS_KEY)
    expect(Object.keys(after)).not.toContain(checkKey('pack-alpha', 'custom::tidy-desk'))
    expect(after).toEqual({})
  })

  it('取消一条勾选不影响同一档案的其它勾选', async () => {
    await setCheck('pack-alpha', 'custom::a', true)
    await setCheck('pack-alpha', 'custom::b', true)
    await setCheck('pack-alpha', 'custom::a', false)

    expect(Object.keys(rowValue(CHECKS_KEY))).toEqual([checkKey('pack-alpha', 'custom::b')])
  })

  it('按档案取键（显式 profileId 时不走 currentProfileId）', async () => {
    await fake.settings.put({ key: 'customChecks:p2', value: { 'pack-alpha::custom::x': { at: 'T' } } })
    expect(await loadChecks('p2')).toEqual({ 'pack-alpha::custom::x': { at: 'T' } })
    // 另一个档案看不到
    expect(await loadChecks(PID)).toEqual({})
  })

  it('★ 写前读失败 → 抛（继续写会用空对象覆盖掉孩子的全部勾选）', async () => {
    fake.flags.failGet = true
    await expect(setCheck('pack-alpha', 'custom::x', true)).rejects.toThrow()
    expect(fake.settings.puts).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 读失败 / 写失败
// ---------------------------------------------------------------------------

describe('db 异常的处理口径', () => {
  it('★ 读失败 → 返回空值 + 告警（一个读不出来的包清单不该让成就页白屏）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fake.flags.failGet = true

    expect(await loadPackState()).toEqual({ packs: [] })
    expect(await loadChecks()).toEqual({})
    expect(await readAudit()).toEqual([])
    expect(await enabledPacks()).toEqual([])

    // 先断言再 restore：`mockRestore()` 会连调用记录一起清掉
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('★ 写失败 → 抛（用户点了启用却没生效必须让他知道）', async () => {
    fake.flags.failPut = true
    await expect(savePackState({ packs: [] })).rejects.toThrow()
    await expect(importPack(packV1())).rejects.toThrow()
  })
})
