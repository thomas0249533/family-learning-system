import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * V1.5 · 自定义包的 `"repeat": "weekly"` —— counter 卡也能"再来一次"
 *
 * ## 这个文件守的三件事（按重要性）
 * 1. **增量是相对"上次计数"，不是相对"本周期开始"**。
 *    只在周末打开一次应用的家庭，如果按周期开始记基线，差值恒为 0 → 永远不涨。
 *    游标（`repeatBase`）保证增长会累计到够一份 `target` 为止。
 * 2. **一周最多 +1**，哪怕指标一次涨了十倍。否则「第 N 次」等于「进度条走了多远」，
 *    孩子瞬间看到「第 9 次」，这个数字就没有任何激励含义了。
 * 3. **不够一份就不动游标**。前移游标 = 把这一周攒的零头丢掉，下周又从头算，
 *    于是"每周都进步一点点"的家庭永远拿不到第二次。
 *
 * 另外守住校验层的两条拒收（`E_REPEAT_PERIOD` / `E_REPEAT_MANUAL`）：
 * 猜/降级都会让家长以为配好了、实际没生效。
 *
 * 用内存版 Dexie 替身替代 IndexedDB（`syncAchievements` 只需要 settings 表）。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const rows: Row[] = []
  return {
    rows,
    settings: {
      async get(k: any) {
        return rows.find((r) => r.key === k)
      },
      async put(r: Row) {
        const i = rows.findIndex((x) => x.key === r.key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return r.key
      },
    },
    __reset() {
      rows.length = 0
    },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const {
  achievementsKey,
  dedupeUnlocked,
  loadUnlocked,
  normalizeUnlocked,
  syncAchievements,
} = await import('@core/motivation/achievements')
const { parseCustomPack, previewCustomPack } = await import('@core/motivation/customPack')
const { packToDefs } = await import('@core/motivation/customPackDefs')
const { CUSTOM_PACK_SCHEMA_VERSION, CUSTOM_REPEAT_PERIODS } = await import(
  '@core/motivation/customPackTypes'
)
const { localWeekKey } = await import('@core/motivation/streak')
const { mergeSettings } = await import('@core/merge/mergeSettings')

type AnyRecord = Record<string, unknown>
type AchievementDef = import('@core/motivation/achievements').AchievementDef
type Ctx = import('@core/motivation/achievements').AchievementContext
type Rec = import('@core/motivation/achievements').UnlockedRecord
type CustomAchievement = import('@core/motivation/customPackTypes').CustomAchievement
type CustomRule = import('@core/motivation/customPackTypes').CustomRule

/** 本地日期（**不要用 `new Date('2026-10-20')`**：那按 UTC 解析，东八区会差一天） */
const at = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h)

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 一枚 counter 卡：累计掌握 10 个知识点（`target` = 10） */
function counterAch(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'custom::read-10',
    icon: '📖',
    title: '掌握 10 个',
    desc: '累计掌握 10 个知识点',
    category: 'B',
    source: 'habit',
    rule: { kind: 'counter', metric: 'masteredKp', target: 10 },
    ...over,
  }
}

function pack(over: AnyRecord = {}): AnyRecord {
  return {
    schemaVersion: CUSTOM_PACK_SCHEMA_VERSION,
    packId: 'home-repeat',
    achievements: [counterAch()],
    ...over,
  }
}

/** 已归一化的 counter 卡（吃 `CustomAchievement` 的地方用） */
function ca(over: Partial<CustomAchievement> = {}): CustomAchievement {
  return {
    id: 'custom::read-10',
    icon: '📖',
    title: '掌握 10 个',
    desc: '累计掌握 10 个知识点',
    category: 'B',
    source: 'habit',
    repeat: 'weekly',
    rule: { kind: 'counter', metric: 'masteredKp', target: 10 },
    ...over,
  }
}

/** 掌握 n 个知识点的上下文（`masteredKp` 口径 = `status === '已掌握'` 的行数） */
function ctxMastered(n: number): Ctx {
  return {
    progress: Array.from({ length: n }, (_, i) => ({
      profileId: 'default',
      packageId: 'unit-math',
      knowledgePointId: `unit-math::kp${i}`,
      status: '已掌握',
      correctCount: 1,
      wrongCount: 0,
      correctStreak: 1,
      wrongStreak: 0,
      lastStudiedAt: '2026-10-01T00:00:00.000Z',
      studySeconds: 0,
    })) as Ctx['progress'],
    mistakes: [],
    streak: { current: 0, longest: 0, lastDate: '' },
    packages: [],
    dailyStats: [],
    attemptedTypes: [],
  }
}

/** 一枚只有 `repeat` 没有真实自定义卡的定义（直接测结算逻辑本身的边界） */
function syntheticDef(repeat: AchievementDef['repeat']): AchievementDef {
  return {
    id: 'custom::synthetic',
    icon: '🧪',
    title: '合成卡',
    desc: '测试用',
    category: 'B',
    check: () => true,
    repeat,
  }
}

async function seed(records: Rec[]): Promise<void> {
  await fake.settings.put({ key: achievementsKey(), value: records })
}

async function record(id: string): Promise<Rec | undefined> {
  return (await loadUnlocked()).find((r) => r.id === id)
}

beforeEach(() => {
  fake.__reset()
})

// ---------------------------------------------------------------------------
// 校验层
// ---------------------------------------------------------------------------
describe('parseCustomPack · repeat 白名单', () => {
  it('counter 卡写 "weekly" → 收下，且归一化产物带上 repeat', () => {
    const r = parseCustomPack(pack({ achievements: [counterAch({ repeat: 'weekly' })] }), {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pack.achievements[0].repeat).toBe('weekly')
  })

  it('★ 没写 repeat → 产物里**没有这个键**（不是 undefined）', () => {
    const r = parseCustomPack(pack(), {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 下游一律用 `'repeat' in a` / `a.repeat !== undefined` 判断，两者必须等价
    expect(r.pack.achievements[0]).not.toHaveProperty('repeat')
  })

  it('白名单当前只有 weekly（多一个周期值就是一次产品裁决，得先改这里）', () => {
    expect(CUSTOM_REPEAT_PERIODS).toEqual(['weekly'])
  })

  it.each([
    ['daily', 'daily'],
    ['大写', 'Weekly'],
    ['带空格的近似值', ' weekly'],
    ['数字', 1],
    ['布尔', true],
    ['null', null],
    ['对象', { period: 'weekly' }],
    ['数组', ['weekly']],
    ['空串', ''],
  ])('%s → E_REPEAT_PERIOD（不猜、不降级）', (_label, value) => {
    const r = parseCustomPack(pack({ achievements: [counterAch({ repeat: value })] }), {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('E_REPEAT_PERIOD')
    // 报错要指到 repeat 这个字段上，家长才知道改哪儿
    expect(r.errors.some((e) => e.code === 'E_REPEAT_PERIOD' && e.path.endsWith('.repeat'))).toBe(
      true,
    )
  })

  it('★ manual-check 带 repeat → E_REPEAT_MANUAL（勾选态是 0/1，没有可累计的量）', () => {
    const r = parseCustomPack(
      pack({
        achievements: [counterAch({ rule: { kind: 'manual-check', prompt: '做到了吗' }, repeat: 'weekly' })],
      }),
      {},
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('E_REPEAT_MANUAL')
    // 同一条错误不该再被报成"周期值不支持"（码要能指向真正的原因）
    expect(codes).not.toContain('E_REPEAT_PERIOD')
  })

  it('manual-check 不写 repeat 照常通过（这是绝大多数包的样子）', () => {
    const r = parseCustomPack(
      pack({ achievements: [counterAch({ rule: { kind: 'manual-check', prompt: '做到了吗' } })] }),
      {},
    )
    expect(r.ok).toBe(true)
  })

  it('source=hidden 的 counter 卡照样能 repeat（隐藏的是展示，不是计数）', () => {
    const r = parseCustomPack(
      pack({ achievements: [counterAch({ source: 'hidden', repeat: 'weekly' })] }),
      {},
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pack.achievements[0].repeat).toBe('weekly')
  })

  it('报错信息里带出当前值，家长能看懂自己写了什么', () => {
    const r = parseCustomPack(pack({ achievements: [counterAch({ repeat: 'monthly' })] }), {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.find((e) => e.code === 'E_REPEAT_PERIOD')?.message).toContain('monthly')
  })
})

// ---------------------------------------------------------------------------
// 翻译成 RepeatRule
// ---------------------------------------------------------------------------
describe('packToDefs · repeat → mode:"grow"', () => {
  const def = packToDefs({ ...(pack() as any), achievements: [ca()] }, {})[0]

  it('周期 weekly、模式 grow', () => {
    expect(def.repeat?.period).toBe('weekly')
    expect(def.repeat?.mode).toBe('grow')
  })

  it('★ step 就是这张卡的 target —— 不给家长单独配（"再完成一遍同样的量"）', () => {
    const rule = def.repeat
    expect(rule?.mode === 'grow' ? rule.step : null).toBe(10)
  })

  it('valueOf 与 check / measure 同源：进度条满了 ⇔ check 为真', () => {
    const got = ctxMastered(10)
    const rule = def.repeat
    expect(rule?.mode === 'grow' ? rule.valueOf(got) : -1).toBe(10)
    expect(def.check(got)).toBe(true)
    expect(def.measure!(got).current).toBe(10)
  })

  it('没声明 repeat 的 counter 卡 → def 上没有 repeat 键', () => {
    const plain = packToDefs({ ...(pack() as any), achievements: [ca({ repeat: undefined })] }, {})[0]
    expect(plain).not.toHaveProperty('repeat')
  })

  it('manual-check 卡永远没有 repeat（校验层已经拦住，这里再守一次类型侧）', () => {
    const manual = packToDefs(
      {
        ...(pack() as any),
        achievements: [
          {
            id: 'custom::tidy',
            icon: '🧹',
            title: '整理书桌',
            desc: '',
            category: 'M',
            source: 'core',
            rule: { kind: 'manual-check', prompt: '整理好了吗' },
          } satisfies CustomAchievement,
        ],
      },
      {},
    )[0]
    expect(manual).not.toHaveProperty('repeat')
  })
})

// ---------------------------------------------------------------------------
// 结算：grow 的语义
// ---------------------------------------------------------------------------
describe('syncAchievements · grow 增量', () => {
  /** 一份"掌握 10 个"的可重复卡定义（每次重新构建，保证闭包干净） */
  function defs(): AchievementDef[] {
    return packToDefs({ ...(pack() as any), achievements: [ca()] }, {})
  }

  it('★ 首次解锁当周：只落游标，不计数（同一周里不可能已经又攒够一份）', async () => {
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxMastered(10), now, defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatBase).toBe(10)
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec?.lastRepeatPeriod).toBe(localWeekKey(now))
  })

  it('★ 同一周结算三次 → 仍是 1 次（幂等）', async () => {
    await syncAchievements(ctxMastered(10), at(2026, 10, 21), defs())
    await syncAchievements(ctxMastered(15), at(2026, 10, 22), defs())
    const r = await syncAchievements(ctxMastered(20), at(2026, 10, 25), defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec).not.toHaveProperty('repeatCount')
    // 游标也不该在同一周里被推上去（推上去就等于把本周的增量吃掉）
    expect(rec?.repeatBase).toBe(10)
  })

  it('★ 下一周又推进一份 target（+10）→ 第 2 次，游标前移', async () => {
    await syncAchievements(ctxMastered(10), at(2026, 10, 21), defs())
    const r = await syncAchievements(ctxMastered(20), at(2026, 10, 28), defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.repeatBase).toBe(20)
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-26')
  })

  it('★ 只涨了 9 个（差 1 份）→ 不涨，且游标**不前移**（零头留着下周接着算）', async () => {
    await syncAchievements(ctxMastered(10), at(2026, 10, 21), defs())
    const w2 = at(2026, 10, 28)
    const r2 = await syncAchievements(ctxMastered(19), w2, defs())

    const rec2 = r2.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec2).not.toHaveProperty('repeatCount')
    expect(rec2?.repeatBase).toBe(10)

    // 再涨 1 个（累计刚好到 20）→ 第 2 次。这就是"零头不丢"的可观测证据
    const r3 = await syncAchievements(ctxMastered(20), at(2026, 11, 4), defs())
    const rec3 = r3.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec3?.repeatCount).toBe(2)
    expect(rec3?.repeatBase).toBe(20)
  })

  it('★ 一周暴涨十倍（10 → 100）→ 只 +1，不是 +9', async () => {
    await syncAchievements(ctxMastered(10), at(2026, 10, 21), defs())
    const r = await syncAchievements(ctxMastered(100), at(2026, 10, 28), defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatCount).toBe(2)
    // 游标跳到 100：下一份目标从 110 起算，不能把这次暴涨反复换算成"次数"
    expect(rec?.repeatBase).toBe(100)
  })

  it('★ 指标往下掉（换档案 / 清进度）→ 不涨，游标不动', async () => {
    await syncAchievements(ctxMastered(10), at(2026, 10, 21), defs())
    await syncAchievements(ctxMastered(20), at(2026, 10, 28), defs())
    const r = await syncAchievements(ctxMastered(3), at(2026, 11, 4), defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.repeatBase).toBe(20)
  })

  it('★ 系统时间被调回过去（锚点更晚）→ 什么都不做', async () => {
    await seed([
      {
        id: 'custom::read-10',
        unlockedAt: '2026-10-01',
        repeatCount: 3,
        lastRepeatPeriod: 'W2026-11-02',
        repeatBase: 40,
      },
    ])
    const past = at(2026, 10, 21)
    const r = await syncAchievements(ctxMastered(90), past, defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatCount).toBe(3)
    expect(rec?.repeatBase).toBe(40)
    expect(rec?.lastRepeatPeriod).toBe('W2026-11-02')
  })

  it('★ 升级路径：旧记录没有游标 → 首次只落游标，不计数（哪怕指标早已远超 target）', async () => {
    await seed([{ id: 'custom::read-10', unlockedAt: '2026-03-01' }])
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxMastered(57), now, defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec?.repeatBase).toBe(57)
  })

  it('旧记录带 repeatCount=2 升级 → 仍是 2，只补游标', async () => {
    await seed([{ id: 'custom::read-10', unlockedAt: '2026-03-01', repeatCount: 2 }])
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxMastered(57), now, defs())

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.repeatBase).toBe(57)
  })

  it('valueOf 抛错 → 按 0 处理：不涨、不崩、游标不动', async () => {
    const boom = syntheticDef({
      period: 'weekly',
      mode: 'grow',
      step: 1,
      valueOf: () => {
        throw new Error('boom')
      },
    })
    await seed([
      {
        id: 'custom::synthetic',
        unlockedAt: '2026-10-01',
        lastRepeatPeriod: 'W2026-10-12',
        repeatBase: 5,
      },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxMastered(500), now, [boom])
    warn.mockRestore()

    const rec = r.unlockedRecords.find((x) => x.id === 'custom::synthetic')
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec?.repeatBase).toBe(5)
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-12')
  })

  it('valueOf 返回 NaN / Infinity → 当 0（不涨）', async () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      fake.__reset()
      const def = syntheticDef({ period: 'weekly', mode: 'grow', step: 1, valueOf: () => bad })
      await seed([
        {
          id: 'custom::synthetic',
          unlockedAt: '2026-10-01',
          lastRepeatPeriod: 'W2026-10-12',
          repeatBase: 5,
        },
      ])
      const now = at(2026, 10, 21)
      const r = await syncAchievements(ctxMastered(0), now, [def])
      const rec = r.unlockedRecords.find((x) => x.id === 'custom::synthetic')
      expect(rec).not.toHaveProperty('repeatCount')
      expect(rec?.repeatBase).toBe(5)
    }
  })

  it('连涨四周 → 5 次（含首次）', async () => {
    const weeks = [at(2026, 10, 21), at(2026, 10, 28), at(2026, 11, 4), at(2026, 11, 11)]
    let last: Rec | undefined
    for (let i = 0; i < weeks.length; i += 1) {
      const r = await syncAchievements(ctxMastered(10 + i * 10), weeks[i], defs())
      last = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    }
    expect(last?.repeatCount).toBe(4)
    expect(last?.repeatBase).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// 存储 / 合并
// ---------------------------------------------------------------------------
describe('normalizeUnlocked · 游标归一化', () => {
  it('合法游标（含 0）原样保留', () => {
    expect(normalizeUnlocked([{ id: 'a', unlockedAt: '', repeatBase: 0 }])[0]).toHaveProperty(
      'repeatBase',
      0,
    )
    expect(normalizeUnlocked([{ id: 'a', unlockedAt: '', repeatBase: 12.5 }])[0]).toHaveProperty(
      'repeatBase',
      12.5,
    )
  })

  it.each([-1, NaN, Infinity, '5', null, {}])('脏游标 %s 被丢掉（下次结算重新落基线）', (bad) => {
    expect(normalizeUnlocked([{ id: 'a', unlockedAt: '', repeatBase: bad }])[0]).not.toHaveProperty(
      'repeatBase',
    )
  })
})

describe('dedupeUnlocked · 游标取较大', () => {
  const rec = (over: Partial<Rec> = {}): Rec => ({ id: 'a', unlockedAt: '2026-03-01', ...over })

  it('两条同 id → 取较大游标（宁可少记一次，不能虚涨）', () => {
    expect(dedupeUnlocked([rec({ repeatBase: 5 }), rec({ repeatBase: 9 })])[0].repeatBase).toBe(9)
    expect(dedupeUnlocked([rec({ repeatBase: 9 }), rec({ repeatBase: 5 })])[0].repeatBase).toBe(9)
  })

  it('一侧没有游标 → 用另一侧的', () => {
    expect(dedupeUnlocked([rec(), rec({ repeatBase: 9 })])[0].repeatBase).toBe(9)
  })

  it('都没有 → 结果不带这个字段', () => {
    expect(dedupeUnlocked([rec(), rec()])[0]).not.toHaveProperty('repeatBase')
  })
})

describe('mergeSettings · 游标**有意不合并**', () => {
  function merged(local: Rec[], remote: Rec[]): Rec[] {
    const out = mergeSettings({ achievements: local }, { achievements: remote }, 'p1')
    const row = out.upserts.find((u) => u.key.startsWith('achievements'))
    return (row?.value ?? local) as Rec[]
  }

  it('远端带游标、本机没有 → 合并结果**不搬运**远端的游标', () => {
    const out = merged(
      [{ id: 'a', unlockedAt: '2026-03-01', repeatCount: 2, lastRepeatPeriod: 'W2026-10-19' }],
      [
        {
          id: 'a',
          unlockedAt: '2026-03-01',
          repeatCount: 3,
          lastRepeatPeriod: 'W2026-10-19',
          repeatBase: 40,
        },
      ],
    )
    // repeatCount 取 max（次数是事实），游标不搬（游标是"本机看到过的值"）
    expect(out[0].repeatCount).toBe(3)
    expect(out[0]).not.toHaveProperty('repeatBase')
  })

  it('★ 两边都有游标 → 远端的游标不得变成本机基线（防"明明没做到却又 +1"）', () => {
    const out = merged(
      [
        {
          id: 'a',
          unlockedAt: '2026-03-01',
          repeatCount: 3,
          lastRepeatPeriod: 'W2026-10-19',
          repeatBase: 20,
        },
      ],
      [
        {
          id: 'a',
          unlockedAt: '2026-03-01',
          repeatCount: 2,
          lastRepeatPeriod: 'W2026-10-12',
          repeatBase: 40,
        },
      ],
    )
    // 次数取较大、锚点取较晚（两个字段必须同向，否则合并后第一次结算就双算）
    expect(out[0].repeatCount).toBe(3)
    expect(out[0].lastRepeatPeriod).toBe('W2026-10-19')
    // 游标是"本机看到过的值"：远端的 40 搬过来，下次结算 50-40=10 ≥ step → 凭空 +1。
    // 安全降级 = 两边游标都不落盘，本机首次结算重新基线（最多丢一周增量，绝不虚涨）。
    expect(out[0]).not.toHaveProperty('repeatBase')
  })

  it('★ 端到端：合并后同一周再结算，不会凭空 +1', async () => {
    const out = merged(
      [
        {
          id: 'custom::read-10',
          unlockedAt: '2026-10-01',
          repeatCount: 2,
          lastRepeatPeriod: 'W2026-10-19',
          repeatBase: 20,
        },
      ],
      [
        {
          id: 'custom::read-10',
          unlockedAt: '2026-10-01',
          repeatCount: 1,
          lastRepeatPeriod: 'W2026-10-12',
          repeatBase: 10,
        },
      ],
    )
    await fake.settings.put({ key: achievementsKey(), value: out })

    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxMastered(20), now, packToDefs({ ...(pack() as any), achievements: [ca()] }, {}))
    const rec = r.unlockedRecords.find((x) => x.id === 'custom::read-10')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.repeatBase).toBe(20)
  })
})
