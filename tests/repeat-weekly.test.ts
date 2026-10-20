import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * V1.5 · `repeatable: 'weekly'`（周一起算）—— 重复达成真的会涨了这一版
 *
 * ## 本文件要守的东西，按重要性排序
 * 1. **`holds` 必须非单调**：`streak-7` 用的是"当前连续天数"而不是"历史最长"。
 *    用后者的话，孩子躺平也每周 +1，卡面会变成「第 37 次」的纯噪声。
 * 2. **同周期幂等**：结算每次路由跳转都跑，没有锚点一天就能 +2。
 * 3. **升级不惊吓**：旧记录没有锚点 → 第一周只落基线，不计数。
 *    否则升级当天所有老用户凭空多一次「第 2 次」。
 * 4. **周从周一开始**（用户裁决），周日的键属于**上一周**。
 *
 * 用内存版 Dexie 替身替代 IndexedDB（只需 settings 表）。
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
  ACHIEVEMENTS,
  achievementsKey,
  dedupeUnlocked,
  loadUnlocked,
  normalizeRepeatPeriod,
  normalizeUnlocked,
  syncAchievements,
} = await import('@core/motivation/achievements')
const { localDayKey, localWeekKey, mondayOf } = await import('@core/motivation/streak')
const { mergeSettings } = await import('@core/merge/mergeSettings')
type Ctx = import('@core/motivation/achievements').AchievementContext
type Rec = import('@core/motivation/achievements').UnlockedRecord

/** 本地日期（**不要用 `new Date('2026-10-20')`**：那按 UTC 解析，东八区会差一天） */
const at = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h)

/** 一周不断的上下文：今天打过卡、当前连续 7 天 */
function ctxStreak7(now: Date): Ctx {
  return {
    progress: [],
    mistakes: [],
    streak: { current: 7, longest: 7, lastDate: localDayKey(now) },
  }
}

/** 当前连续只有 3 天（历史最长 9 天）→ 已解锁仍在，但「这周没坚持住」 */
function ctxStreakBroken(now: Date): Ctx {
  return {
    progress: [],
    mistakes: [],
    streak: { current: 3, longest: 9, lastDate: localDayKey(now) },
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
// 周键：周一起算
// ---------------------------------------------------------------------------
describe('localWeekKey — 周一起算（用户裁决）', () => {
  it('周一当天 → 键就是那一天', () => {
    // 2026-10-19 是周一
    expect(localWeekKey(at(2026, 10, 19))).toBe('W2026-10-19')
  })

  it('周二 ~ 周六 → 同一周', () => {
    for (const d of [20, 21, 22, 23, 24]) {
      expect(localWeekKey(at(2026, 10, d))).toBe('W2026-10-19')
    }
  })

  it('★ 周日属于**上一周**（这是"周一起算"最容易写错的一格）', () => {
    // 2026-10-25 是周日 → 归 10-19 那一周
    expect(localWeekKey(at(2026, 10, 25))).toBe('W2026-10-19')
  })

  it('下一周的周一 → 换键', () => {
    expect(localWeekKey(at(2026, 10, 26))).toBe('W2026-10-26')
  })

  it('跨月：2026-11-01（周日）仍属 10-26 那周', () => {
    expect(localWeekKey(at(2026, 11, 1))).toBe('W2026-10-26')
  })

  it('跨年：2027-01-01（周五）属 2026-12-28 那周', () => {
    expect(localWeekKey(at(2027, 1, 1))).toBe('W2026-12-28')
  })

  it('定宽 → 字符串序即时间序（合并取"较晚"才能直接比）', () => {
    const keys = [
      localWeekKey(at(2026, 10, 5)),
      localWeekKey(at(2026, 10, 12)),
      localWeekKey(at(2026, 10, 19)),
      localWeekKey(at(2027, 1, 4)),
    ]
    expect([...keys].sort()).toEqual(keys)
  })

  it('mondayOf 只改日期部分，时分秒归零', () => {
    const m = mondayOf(at(2026, 10, 22, 23))
    expect([m.getHours(), m.getMinutes(), m.getDate()]).toEqual([0, 0, 19])
  })
})

describe('可重复成就的范围（这是裁决出来的，不是随手加的）', () => {
  it('内置 28 枚里**只有** streak-7（一周不断）声明了 repeat', () => {
    // 为什么钉死范围：`repeat` 一旦往累计型成就上放就会变成噪声 ——
    // 「掌握 10 个知识点」每周"再达成一次"没有意义（它的条件永远为真）。
    // 想扩这个列表，先回答"这一周没真的做到也算吗"，答案必然要求一个非单调的 holds。
    const ids = ACHIEVEMENTS.filter((a) => a.repeat !== undefined).map((a) => a.id)
    expect(ids).toEqual(['streak-7'])
  })

  it('streak-7 的 repeat 用周口径、hold 模式，且 holds 与 check 不是同一个谓词', () => {
    const def = ACHIEVEMENTS.find((a) => a.id === 'streak-7')
    expect(def?.repeat?.period).toBe('weekly')
    // 内置卡一律 hold：它要判的是"这一周是否仍然保持在一周不断"，不是"又推进了多少"
    expect(def?.repeat?.mode).toBe('hold')
    // 同一个谓词 = 单调 = 每周白涨一次（躺平也「第 N 次」）。这条断言守的是"没有偷懒复用 check"
    const rule = def?.repeat
    expect(rule?.mode === 'hold' ? rule.holds : null).not.toBe(def?.check)
  })
})

describe('normalizeRepeatPeriod — 只认形状合法的周键', () => {  it('合法值原样保留', () => {
    expect(normalizeRepeatPeriod('W2026-10-19')).toBe('W2026-10-19')
  })

  it('形状不对一律当"还没有锚点"（它们会参与字符串比较，坏值会让比较永远偏向一侧）', () => {
    for (const bad of [
      'w2026-10-19',
      '2026-10-19',
      'W2026-1-9',
      'W2026-10-19 ',
      '',
      null,
      undefined,
      123,
      {},
    ]) {
      expect(normalizeRepeatPeriod(bad)).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// 结算：repeatCount 什么时候涨、什么时候不涨
// ---------------------------------------------------------------------------
describe('syncAchievements · weekly 重复', () => {
  it('首次解锁当周：落锚点但不计数（同一周里 holds 也为真，不能立刻变「第 2 次」）', async () => {
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxStreak7(now), now)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-19')
    expect(rec).not.toHaveProperty('repeatCount')
  })

  it('★ 同一周结算三次 → 仍是 1 次（幂等；去抖 + 路由跳转一天会结算好几次）', async () => {
    const now = at(2026, 10, 21)
    await syncAchievements(ctxStreak7(now), now)
    await syncAchievements(ctxStreak7(at(2026, 10, 22)), at(2026, 10, 22))
    const r = await syncAchievements(ctxStreak7(at(2026, 10, 25)), at(2026, 10, 25))

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-19')
  })

  it('下一周仍然坚持 → 第 2 次，锚点跟着走', async () => {
    const w1 = at(2026, 10, 21)
    await syncAchievements(ctxStreak7(w1), w1)

    const w2 = at(2026, 10, 28)
    const r = await syncAchievements(ctxStreak7(w2), w2)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-26')
  })

  it('★ 下一周没坚持住（当前连续只剩 3 天）→ 不涨，锚点也不动', async () => {
    const w1 = at(2026, 10, 21)
    await syncAchievements(ctxStreak7(w1), w1)

    const w2 = at(2026, 10, 28)
    const r = await syncAchievements(ctxStreakBroken(w2), w2)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec).not.toHaveProperty('repeatCount')
    // 锚点不动 = 下周只要坚持住，这一天之后仍然能被计入
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-19')
  })

  it('连涨三周 → 4 次（含首次）', async () => {
    const weeks = [at(2026, 10, 21), at(2026, 10, 28), at(2026, 11, 4), at(2026, 11, 11)]
    let last: Rec | undefined
    for (const w of weeks) {
      const r = await syncAchievements(ctxStreak7(w), w)
      last = r.unlockedRecords.find((x) => x.id === 'streak-7')
    }
    expect(last?.repeatCount).toBe(4)
    expect(last?.lastRepeatPeriod).toBe(localWeekKey(at(2026, 11, 11)))
  })

  it('★ 系统时间被调回过去（锚点更晚）→ 什么都不做，等时间追上来', async () => {
    await seed([
      { id: 'streak-7', unlockedAt: '2026-10-01', repeatCount: 3, lastRepeatPeriod: 'W2026-11-02' },
    ])
    const past = at(2026, 10, 21)
    const r = await syncAchievements(ctxStreak7(past), past)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec?.repeatCount).toBe(3)
    expect(rec?.lastRepeatPeriod).toBe('W2026-11-02')
  })

  it('★ 升级路径：旧记录没有锚点 → 首周只落基线，不计数', async () => {
    // 升级前的记录长这样：有 repeatCount 或没有，但绝没有 lastRepeatPeriod
    await seed([{ id: 'streak-7', unlockedAt: '2026-03-01' }])
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxStreak7(now), now)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-19')
  })

  it('旧记录带着 repeatCount=2 升级 → 首周仍只落基线，不变成 3', async () => {
    await seed([{ id: 'streak-7', unlockedAt: '2026-03-01', repeatCount: 2 }])
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxStreak7(now), now)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-19')
  })

  it('没有声明 repeat 的成就永不涨（first-step 满足一百周也只有 1 次）', async () => {
    await seed([{ id: 'first-step', unlockedAt: '2026-03-01' }])
    const ctx: Ctx = {
      progress: [
        {
          profileId: 'default',
          packageId: 'p',
          knowledgePointId: 'p::k1',
          status: '已掌握',
          correctCount: 1,
          wrongCount: 0,
          correctStreak: 1,
          wrongStreak: 0,
          lastStudiedAt: '2026-10-21T00:00:00.000Z',
          studySeconds: 0,
        },
      ],
      mistakes: [],
      streak: { current: 0, longest: 0, lastDate: '' },
    }
    for (const w of [at(2026, 10, 21), at(2026, 11, 4), at(2026, 11, 18)]) {
      await syncAchievements(ctx, w)
    }
    const rec = await record('first-step')
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec).not.toHaveProperty('lastRepeatPeriod')
  })

  it('repeat.holds 抛错 → 本周不计入，且不把结算搞崩', async () => {
    const boom = {
      id: 'custom-repeat',
      icon: '🧪',
      title: '会抛错的卡',
      desc: '测试用',
      category: 'B' as const,
      check: () => true,
      repeat: {
        period: 'weekly' as const,
        mode: 'hold' as const,
        holds: () => {
          throw new Error('boom')
        },
      },
    }
    await seed([
      { id: 'custom-repeat', unlockedAt: '2026-10-01', lastRepeatPeriod: 'W2026-10-12' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = at(2026, 10, 21)

    const r = await syncAchievements({ progress: [], mistakes: [], streak: { current: 0, longest: 0, lastDate: '' } }, now, [boom])

    const rec = r.unlockedRecords.find((x) => x.id === 'custom-repeat')
    expect(rec).not.toHaveProperty('repeatCount')
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-12')
    warn.mockRestore()
  })

  it('自定义定义声明了 repeat 也能涨（为将来开放给家长 JSON 留的路）', async () => {
    const weekly = {
      id: 'custom-repeat',
      icon: '🧪',
      title: '每周一张',
      desc: '测试用',
      category: 'B' as const,
      check: () => true,
      repeat: { period: 'weekly' as const, mode: 'hold' as const, holds: () => true },
    }
    await seed([
      { id: 'custom-repeat', unlockedAt: '2026-10-01', lastRepeatPeriod: 'W2026-10-12' },
    ])
    const now = at(2026, 10, 21)
    const r = await syncAchievements(
      { progress: [], mistakes: [], streak: { current: 0, longest: 0, lastDate: '' } },
      now,
      [weekly],
    )

    const rec = r.unlockedRecords.find((x) => x.id === 'custom-repeat')
    expect(rec?.repeatCount).toBe(2)
    expect(rec?.lastRepeatPeriod).toBe('W2026-10-19')
  })

  it('重复计数不会把 unlockedAt 顶掉（"第一次拿到"永远不变）', async () => {
    await seed([
      { id: 'streak-7', unlockedAt: '2026-03-01', lastRepeatPeriod: 'W2026-10-12' },
    ])
    const now = at(2026, 10, 21)
    const r = await syncAchievements(ctxStreak7(now), now)

    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec?.unlockedAt).toBe('2026-03-01')
    expect(rec?.repeatCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 存储与合并
// ---------------------------------------------------------------------------
describe('normalizeUnlocked — 保留合法周键', () => {
  it('带锚点的记录原样保留', () => {
    const out = normalizeUnlocked([
      { id: 'a', unlockedAt: '', repeatCount: 2, lastRepeatPeriod: 'W2026-10-19' },
    ])
    expect(out[0]).toEqual({
      id: 'a',
      unlockedAt: '',
      repeatCount: 2,
      lastRepeatPeriod: 'W2026-10-19',
    })
  })

  it('脏锚点被丢掉，其余字段不受影响', () => {
    const out = normalizeUnlocked([
      { id: 'a', unlockedAt: '2026-01-01', lastRepeatPeriod: '2026-10-19' },
    ])
    expect(out[0]).toEqual({ id: 'a', unlockedAt: '2026-01-01' })
  })
})

describe('dedupeUnlocked — 锚点取较晚', () => {
  const rec = (over: Partial<Rec> = {}): Rec => ({ id: 'a', unlockedAt: '2026-03-01', ...over })

  it('两条同 id 记录 → 取较晚的周键', () => {
    const out = dedupeUnlocked([
      rec({ lastRepeatPeriod: 'W2026-10-12' }),
      rec({ lastRepeatPeriod: 'W2026-10-19' }),
    ])
    expect(out[0].lastRepeatPeriod).toBe('W2026-10-19')
  })

  it('一侧没有锚点 → 用另一侧的（不能因为本机缺就丢掉远端的）', () => {
    expect(dedupeUnlocked([rec(), rec({ lastRepeatPeriod: 'W2026-10-19' })])[0].lastRepeatPeriod).toBe(
      'W2026-10-19',
    )
    expect(dedupeUnlocked([rec({ lastRepeatPeriod: 'W2026-10-19' }), rec()])[0].lastRepeatPeriod).toBe(
      'W2026-10-19',
    )
  })

  it('两侧都没有 → 结果不带这个字段', () => {
    expect(dedupeUnlocked([rec(), rec()])[0]).not.toHaveProperty('lastRepeatPeriod')
  })
})

describe('mergeSettings — 锚点取较晚（与 repeatCount 取 max 配套）', () => {
  function merged(local: Rec[], remote: Rec[]): Rec[] {
    const out = mergeSettings({ achievements: local }, { achievements: remote }, 'p1')
    const row = out.upserts.find((u) => u.key.startsWith('achievements'))
    // 没有 upsert = 合并结果与本机逐字节相同（只在真变化时才产 upsert）
    return (row?.value ?? local) as Rec[]
  }

  it('远端锚点更晚 → 取远端的', () => {
    const out = merged(
      [{ id: 'a', unlockedAt: '2026-03-01', repeatCount: 2, lastRepeatPeriod: 'W2026-10-12' }],
      [{ id: 'a', unlockedAt: '2026-03-01', repeatCount: 3, lastRepeatPeriod: 'W2026-10-19' }],
    )
    expect(out[0]).toMatchObject({ repeatCount: 3, lastRepeatPeriod: 'W2026-10-19' })
  })

  it('本机锚点更晚 → 保留本机的（远端是上周的旧备份）', () => {
    const out = merged(
      [{ id: 'a', unlockedAt: '2026-03-01', repeatCount: 3, lastRepeatPeriod: 'W2026-10-19' }],
      [{ id: 'a', unlockedAt: '2026-03-01', repeatCount: 2, lastRepeatPeriod: 'W2026-10-12' }],
    )
    expect(out[0]).toMatchObject({ repeatCount: 3, lastRepeatPeriod: 'W2026-10-19' })
  })

  it('★ 端到端：合并后同一周再结算，不会凭空 +1', async () => {
    const now = at(2026, 10, 21)
    const out = merged(
      [{ id: 'streak-7', unlockedAt: '2026-03-01', repeatCount: 3, lastRepeatPeriod: 'W2026-10-19' }],
      [{ id: 'streak-7', unlockedAt: '2026-03-01', repeatCount: 2, lastRepeatPeriod: 'W2026-10-12' }],
    )
    await fake.settings.put({ key: achievementsKey(), value: out })

    const r = await syncAchievements(ctxStreak7(now), now)
    const rec = r.unlockedRecords.find((x) => x.id === 'streak-7')
    expect(rec?.repeatCount).toBe(3)
  })
})
