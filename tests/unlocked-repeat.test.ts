import { describe, expect, it } from 'vitest'
import {
  dedupeUnlocked,
  normalizeRepeatCount,
  normalizeUnlocked,
  type UnlockedRecord,
} from '@core/motivation/achievements'
import { buildAchievementItems } from '@core/motivation/achievementMeta'
import { mergeSettings } from '@core/merge/mergeSettings'
import { ACHIEVEMENTS } from '@core/motivation/achievements'

/**
 * V1.4 · B6 · 重复纪念印记（`repeatCount`）的数据侧测试
 *
 * ## 为什么这一批测试必须在"只做基础设施"的版本里就写全
 * V1.4 的 `repeatCount` **只写不涨**（写入侧刻意不递增，理由见
 * `UnlockedRecord.repeatCount` 的注释：内置判定单调、结算每次都重判，字面实现会虚涨）。
 * 也就是说：**功能上线那天这些路径一条都不会被走到。**
 *
 * 正因为如此，更要把它们钉死 —— 等 V1.5 真开始递增、或某天有人手工改备份时，
 * 这几条规则是唯一能守住"重复次数不被抹成单次"的东西（设计稿 R11）。
 *
 * 三个方向相反的规则是本文件的重点：
 *   - `unlockedAt` 取**更早**（第一次拿到）；
 *   - `evidence` **本机优先**（当时的证据比后来的可信）；
 *   - `repeatCount` 取**更大**（发生过几次是累计事实）。
 */

const PID = 'p1'

function rec(id: string, over: Partial<UnlockedRecord> = {}): UnlockedRecord {
  return { id, unlockedAt: '2026-03-01', ...over }
}

describe('normalizeRepeatCount — 只认 ≥1 的整数', () => {
  it('合法值原样保留', () => {
    expect(normalizeRepeatCount(1)).toBe(1)
    expect(normalizeRepeatCount(2)).toBe(2)
    expect(normalizeRepeatCount(99)).toBe(99)
  })

  it('0 / 负数 / 小数 / 非数字 / null / NaN 一律当"没有这个字段"', () => {
    for (const bad of [0, -1, -3, 1.5, 2.0001, '3', '', null, undefined, Number.NaN, Infinity, {}]) {
      expect(normalizeRepeatCount(bad)).toBeUndefined()
    }
  })
})

describe('normalizeUnlocked — 保留合法 repeatCount，且不给旧记录补字段', () => {
  it('带 repeatCount 的记录保留它', () => {
    const out = normalizeUnlocked([{ id: 'a', unlockedAt: '', repeatCount: 3 }])
    expect(out).toEqual([{ id: 'a', unlockedAt: '', repeatCount: 3 }])
  })

  it('★ 旧记录（没有该字段）不会被打上 repeatCount: 1', () => {
    // 写死 1 会让"这份数据到底带没带这个信息"无法判断：合并时 1 与 3 取 max 看着正常，
    // 但一旦将来把"省略即 1"的口径改成别的，满地的显式 1 就成了假事实
    const out = normalizeUnlocked([{ id: 'a', unlockedAt: '2026-01-01' }])
    expect(out[0]).not.toHaveProperty('repeatCount')
  })

  it('非法 repeatCount 被丢掉，其余字段不受影响', () => {
    const out = normalizeUnlocked([
      { id: 'a', unlockedAt: '2026-01-01', evidence: '答题 10 道', repeatCount: 0 },
    ])
    expect(out[0]).toEqual({ id: 'a', unlockedAt: '2026-01-01', evidence: '答题 10 道' })
  })
})

describe('dedupeUnlocked — 三条方向相反的规则', () => {
  it('repeatCount 取较大（与本机优先/取更早相反）', () => {
    const out = dedupeUnlocked([rec('a', { repeatCount: 3 }), rec('a', { repeatCount: 2 })])
    expect(out).toHaveLength(1)
    expect(out[0].repeatCount).toBe(3)
  })

  it('任一侧没有 repeatCount 时，另一侧的 ≥2 仍然保留', () => {
    const out = dedupeUnlocked([rec('a'), rec('a', { repeatCount: 4 })])
    expect(out[0].repeatCount).toBe(4)
  })

  it('两侧都只是"达成过一次" → 不写这个字段（而不是写 1）', () => {
    const out = dedupeUnlocked([rec('a'), rec('a', { repeatCount: 1 })])
    expect(out[0]).not.toHaveProperty('repeatCount')
  })

  it('unlockedAt 取先到的非空；evidence 本机优先', () => {
    const out = dedupeUnlocked([
      rec('a', { unlockedAt: '', evidence: '', repeatCount: 2 }),
      rec('a', { unlockedAt: '2026-02-02', evidence: '后来那句' }),
    ])
    expect(out[0]).toMatchObject({ unlockedAt: '2026-02-02', evidence: '后来那句', repeatCount: 2 })
  })

  it('幂等：同一份输入跑两次结果逐字段相同', () => {
    const input = [rec('a', { repeatCount: 2 }), rec('b'), rec('a', { repeatCount: 5 })]
    expect(dedupeUnlocked(dedupeUnlocked(input))).toEqual(dedupeUnlocked(input))
  })
})

describe('mergeSettings — 跨设备合并 repeatCount 取 max（R11 的 DoD）', () => {
  function merged(local: UnlockedRecord[], remote: UnlockedRecord[]): UnlockedRecord[] {
    const out = mergeSettings({ achievements: local }, { achievements: remote }, PID)
    const row = out.upserts.find((u) => u.key.startsWith('achievements'))
    // 没有 upsert = **合并结果与本机逐字节相同**（mergeSettings 只在真变化时才产 upsert）。
    // 这不是"没拿到值"：此时结果就是本机那行。把这条写清楚，免得后人以为合并丢了数据。
    return (row?.value ?? local) as UnlockedRecord[]
  }

  it('本机 2 次、远端 3 次 → 3 次（不能被抹成单次，也不能取小的）', () => {
    const out = merged([rec('a', { repeatCount: 2 })], [rec('a', { repeatCount: 3 })])
    expect(out.find((r) => r.id === 'a')?.repeatCount).toBe(3)
  })

  it('本机 5 次、远端 1 次（或没有）→ 仍是 5 次', () => {
    expect(merged([rec('a', { repeatCount: 5 })], [rec('a')]).find((r) => r.id === 'a')?.repeatCount).toBe(5)
    expect(merged([rec('a', { repeatCount: 5 })], [rec('a', { repeatCount: 1 })]).find((r) => r.id === 'a')?.repeatCount).toBe(5)
  })

  it('两边都只有 1 次 → 结果不带这个字段（不制造假事实）', () => {
    const out = merged([rec('a')], [rec('a')])
    expect(out.find((r) => r.id === 'a')).not.toHaveProperty('repeatCount')
  })

  it('远端独有的记录连同 repeatCount 一起进来', () => {
    const out = merged([], [rec('b', { repeatCount: 4 })])
    expect(out.find((r) => r.id === 'b')?.repeatCount).toBe(4)
  })

  it('反向：unlockedAt 仍取更早，不会被 repeatCount 的 max 逻辑带偏', () => {
    const out = merged(
      [rec('a', { unlockedAt: '2026-05-01', repeatCount: 2 })],
      [rec('a', { unlockedAt: '2026-01-05', repeatCount: 3 })],
    )
    expect(out.find((r) => r.id === 'a')).toMatchObject({
      unlockedAt: '2026-01-05',
      repeatCount: 3,
    })
  })
})

describe('AchievementItem.repeatCount — 卡面与读屏的唯一来源', () => {
  const ctx = { progress: [], mistakes: [], streak: { current: 0, longest: 0, lastDate: '' } }
  const items = (records: UnlockedRecord[]) => buildAchievementItems(ctx, records)

  it('已获得 + 3 次 → 3', () => {
    const it = items([{ id: 'first-step', unlockedAt: '2026-01-01', repeatCount: 3 }]).find(
      (i) => i.id === 'first-step',
    )
    expect(it?.repeatCount).toBe(3)
  })

  it('已获得 + 没有字段 → 1（模板比较 >= 2，不会显示印记）', () => {
    const it = items([{ id: 'first-step', unlockedAt: '2026-01-01' }]).find((i) => i.id === 'first-step')
    expect(it?.repeatCount).toBe(1)
  })

  it('未获得恒为 1', () => {
    const it = items([]).find((i) => i.id === 'first-step')
    expect(it?.repeatCount).toBe(1)
  })

  it('★ 剪影（隐藏成就未解锁）恒为 1 —— 重复次数本身会泄露"这条路走通过"', () => {
    const hiddenId = ACHIEVEMENTS.find((a) => a.hidden)?.id
    expect(hiddenId).toBeDefined()
    const it = items([{ id: hiddenId!, unlockedAt: '2026-01-01', repeatCount: 4 }]).find(
      (i) => i.id === hiddenId,
    )
    // 就算库里意外带了 repeatCount，剪影也不能把它暴露出来
    expect(it?.silhouetted).toBe(false) // 有记录 = 已解锁，不是剪影
    // 真正要守的是"没记录 + hidden"那条：
    const sil = items([]).find((i) => i.id === hiddenId)
    expect(sil?.silhouetted).toBe(true)
    expect(sil?.repeatCount).toBe(1)
  })
})
