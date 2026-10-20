import { describe, expect, it } from 'vitest'
import {
  SKIP_REASONS,
  isSkippedBase,
  mergeSettingValue,
  mergeSettings,
  type SettingsMergeOutcome,
} from '@core/merge/mergeSettings'
import { PROFILE_SCOPED_KEYS, type ProfileScopedBase } from '@core/profile/settingsScope'

/**
 * 分片 settings 合并（§6.3）。
 *
 * 登记在 `PROFILE_SCOPED_KEYS` 里的键语义各不相同，用一条通用规则必然有一半是错的。
 * 本文件逐个键钉死规则，并额外守住三条"不写库 / 不漏键"的边界：
 *   - 结果与现值逐字节相同 → 不进 upserts（幂等的前提）；
 *   - 输出键必须是**全名** `base:pid`（自己拼字符串迟早拼出 `dailyStats:p1:p1`）；
 *   - **每个登记键都必须有归属**：要么有合并规则，要么在 `SKIP_REASONS` 里写明理由。
 *     最后这条是 V1.4–B3 加 `customChecks` 时漏掉的教训：`switch` 少一个 case 不报错，
 *     于是"新功能没接上跨设备合并"静默过了 2580 条测试。
 */

const PID = 'p1'

/** 把计划回放到本机现值上，用于验证"再合一次不再变" */
function applyLocal(
  local: Record<string, unknown>,
  outcome: SettingsMergeOutcome,
): Record<string, unknown> {
  const next = { ...local }
  for (const u of outcome.upserts) {
    const base = u.key.slice(0, u.key.lastIndexOf(':'))
    next[base] = u.value
  }
  return next
}

describe('mergeSettings — 输出键', () => {
  it('★ 键是全名 base:pid，不是裸基名', () => {
    const out = mergeSettings({}, { attemptedTypes: ['blank'] }, PID)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].key).toBe('attemptedTypes:p1')
  })

  it('含冒号的基名也只拼一层后缀', () => {
    const out = mergeSettings(
      {},
      { 'achievement:discovery': { v: 1, chances: 1, revealed: ['a'], streakWithoutNew: 0, lastGrantDay: '2026-01-01' } },
      PID,
    )
    expect(out.upserts.map((u) => u.key)).toEqual(['achievement:discovery:p1'])
  })

  it('备份里没有的键 → 什么都不发生，也不计数', () => {
    const out = mergeSettings({ achievements: [] }, {}, PID)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(0)
    expect(out.changed).toBe(0)
  })
})

describe('achievements — 并集 + 解锁日取更早', () => {
  it('并集、日期取更早、evidence 保留本机', () => {
    const local = [
      { id: 'a', unlockedAt: '2026-01-05' },
      { id: 'b', unlockedAt: '2026-01-01', evidence: '本机证据' },
    ]
    const remote = [
      { id: 'b', unlockedAt: '2025-12-01', evidence: '远端证据' },
      { id: 'c', unlockedAt: '2026-02-01' },
    ]

    const out = mergeSettings({ achievements: local }, { achievements: remote }, PID)
    expect(out.achievementsAdded).toBe(1) // 只新增 c
    expect(out.changed).toBe(1)

    const value = out.upserts[0].value as Array<{ id: string; unlockedAt: string; evidence?: string }>
    expect(value.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(value.find((r) => r.id === 'b')?.unlockedAt).toBe('2025-12-01')
    expect(value.find((r) => r.id === 'b')?.evidence).toBe('本机证据')
  })

  it('★ 旧数据的空串不得抹掉真实日期（非空优先，V1.4 裁决）', () => {
    // local 是 P3 之前的老数据（unlockedAt=''），remote 有真实日期。
    // 按字符串比较（'' < 任意非空）会取 ''，等于把真实日期永久毁掉；
    // 正确行为是保留非空那侧。`saveUnlocked()` 用的也是 `prev.unlockedAt || r.unlockedAt`。
    const local = [{ id: 'a', unlockedAt: '' }]
    const remote = [{ id: 'a', unlockedAt: '2026-01-01T00:00:00.000Z' }]

    const out = mergeSettings({ achievements: local }, { achievements: remote }, PID)
    const value = out.upserts[0].value as Array<{ id: string; unlockedAt: string }>
    expect(value[0].unlockedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('★ 两边都有日期 → 取更早者胜', () => {
    const out = mergeSettings(
      { achievements: [{ id: 'a', unlockedAt: '2026-03-01' }] },
      { achievements: [{ id: 'a', unlockedAt: '2026-01-05' }] },
      PID,
    )
    const value = out.upserts[0].value as Array<{ id: string; unlockedAt: string }>
    expect(value[0].unlockedAt).toBe('2026-01-05')
  })

  it('两边都空 → 仍是空串（不凭空造一个日期）', () => {
    const out = mergeSettings(
      { achievements: [{ id: 'a', unlockedAt: '' }] },
      { achievements: [{ id: 'a', unlockedAt: '' }, { id: 'b', unlockedAt: '' }] },
      PID,
    )
    const value = out.upserts[0].value as Array<{ id: string; unlockedAt: string }>
    expect(value.find((r) => r.id === 'a')?.unlockedAt).toBe('')
  })

  it('本机没有 achievements → 直接取远端，全部算新增', () => {
    const out = mergeSettings({}, { achievements: [{ id: 'a', unlockedAt: '2026-01-01' }] }, PID)
    expect(out.achievementsAdded).toBe(1)
    expect(out.upserts).toHaveLength(1)
  })

  it('★ 兼容旧格式 string[]，且不会因此重写库', () => {
    const out = mergeSettings({ achievements: ['a', 'b'] }, { achievements: ['a'] }, PID)
    // 归一化后两边语义相同 → 不写（否则每次导入都重写一遍，noop 永远 false）
    expect(out.upserts).toHaveLength(0)
    expect(out.achievementsAdded).toBe(0)
  })

  it('远端是脏数据 → 当作空集，不抛错', () => {
    const out = mergeSettings({ achievements: [{ id: 'a', unlockedAt: '2026-01-01' }] }, { achievements: 42 }, PID)
    expect(out.upserts).toHaveLength(0)
  })

  it('幂等：合并结果再合一次不再变', () => {
    const local = { achievements: [{ id: 'a', unlockedAt: '2026-01-05' }] }
    const remote = { achievements: [{ id: 'b', unlockedAt: '2026-02-01' }] }
    const first = mergeSettings(local, remote, PID)
    const next = applyLocal(local, first)
    expect(mergeSettings(next, remote, PID).upserts).toHaveLength(0)
  })
})

describe('dailyStats — 按 date 对齐，逐字段取更多', () => {
  it('同日取题量 max、首学时刻 min、末学时刻 max', () => {
    const local = [
      { date: '2026-01-01', questionCount: 5, firstStudyAt: 1000, lastStudyAt: 2000 },
    ]
    const remote = [
      { date: '2026-01-01', questionCount: 8, firstStudyAt: 500, lastStudyAt: 2000 },
      { date: '2026-01-02', questionCount: 3, firstStudyAt: 9000, lastStudyAt: 9000 },
    ]

    const out = mergeSettings({ dailyStats: local }, { dailyStats: remote }, PID)
    const value = out.upserts[0].value as Array<Record<string, unknown>>
    expect(value).toHaveLength(2)
    expect(value[0]).toEqual({
      date: '2026-01-01',
      questionCount: 8,
      firstStudyAt: 500,
      lastStudyAt: 2000,
    })
    expect(value[1].date).toBe('2026-01-02')
  })

  it('★ 题量只增不减（少算等于抹掉"今日之星"）', () => {
    const local = [{ date: '2026-01-01', questionCount: 25, firstStudyAt: 1, lastStudyAt: 2 }]
    const remote = [{ date: '2026-01-01', questionCount: 3, firstStudyAt: 1, lastStudyAt: 2 }]
    const out = mergeSettings({ dailyStats: local }, { dailyStats: remote }, PID)
    expect(out.upserts).toHaveLength(0)
  })

  it('我方缺首学时刻（0）→ 取远端的', () => {
    const local = [{ date: '2026-01-01', questionCount: 5, firstStudyAt: 0, lastStudyAt: 0 }]
    const remote = [{ date: '2026-01-01', questionCount: 5, firstStudyAt: 700, lastStudyAt: 800 }]
    const out = mergeSettings({ dailyStats: local }, { dailyStats: remote }, PID)
    const value = out.upserts[0].value as Array<Record<string, unknown>>
    expect(value[0].firstStudyAt).toBe(700)
    expect(value[0].lastStudyAt).toBe(800)
  })

  it('输出按日期升序（顺序稳定 = JSON 比较稳定 = 幂等）', () => {
    const local = [{ date: '2026-01-03', questionCount: 1, firstStudyAt: 1, lastStudyAt: 1 }]
    const remote = [{ date: '2026-01-01', questionCount: 1, firstStudyAt: 1, lastStudyAt: 1 }]
    const out = mergeSettings({ dailyStats: local }, { dailyStats: remote }, PID)
    const value = out.upserts[0].value as Array<Record<string, unknown>>
    expect(value.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-03'])
  })

  it('幂等', () => {
    const local = { dailyStats: [{ date: '2026-01-01', questionCount: 5, firstStudyAt: 10, lastStudyAt: 20 }] }
    const remote = { dailyStats: [{ date: '2026-01-01', questionCount: 9, firstStudyAt: 5, lastStudyAt: 30 }] }
    const first = mergeSettings(local, remote, PID)
    expect(mergeSettings(applyLocal(local, first), remote, PID).upserts).toHaveLength(0)
  })
})

describe('studyStreak — current 与 longest 分别取 max', () => {
  it('★ 分别取 max：不会出现"最佳倒退"，也不会让 current 被另一台的 best 顶掉', () => {
    const local = { current: 5, longest: 9, lastDate: '2026-01-01' }
    const remote = { current: 7, longest: 6, lastDate: '2026-01-03' }

    const out = mergeSettings({ studyStreak: local }, { studyStreak: remote }, PID)
    expect(out.upserts[0].value).toEqual({ current: 7, longest: 9, lastDate: '2026-01-03' })
  })

  it('lastDate 取更晚（空串 = 从没学过，最小）', () => {
    const local = { current: 0, longest: 0, lastDate: '' }
    const remote = { current: 2, longest: 2, lastDate: '2026-01-03' }
    const out = mergeSettings({ studyStreak: local }, { studyStreak: remote }, PID)
    expect((out.upserts[0].value as { lastDate: string }).lastDate).toBe('2026-01-03')
  })

  it('本机缺失 → 等于直接取远端', () => {
    const out = mergeSettings({}, { studyStreak: { current: 3, longest: 4, lastDate: '2026-05-01' } }, PID)
    expect(out.upserts[0].value).toEqual({ current: 3, longest: 4, lastDate: '2026-05-01' })
  })

  it('幂等', () => {
    const local = { studyStreak: { current: 5, longest: 9, lastDate: '2026-01-01' } }
    const remote = { studyStreak: { current: 7, longest: 6, lastDate: '2026-01-03' } }
    const first = mergeSettings(local, remote, PID)
    expect(mergeSettings(applyLocal(local, first), remote, PID).upserts).toHaveLength(0)
  })
})

describe('achievement:discovery — 机会/保底取 max，线索取并集', () => {
  it('逐字段取"更多"，发放日取更晚', () => {
    const local = { v: 1, chances: 1, revealed: ['a'], streakWithoutNew: 1, lastGrantDay: '2026-01-01' }
    const remote = { v: 1, chances: 2, revealed: ['b'], streakWithoutNew: 0, lastGrantDay: '2026-01-02' }

    const out = mergeSettings({ 'achievement:discovery': local }, { 'achievement:discovery': remote }, PID)
    expect(out.upserts[0].value).toEqual({
      v: 1,
      chances: 2,
      revealed: ['a', 'b'],
      streakWithoutNew: 1,
      lastGrantDay: '2026-01-02',
    })
  })

  it('脏数据降级为"没玩过"，不抛错', () => {
    const out = mergeSettings({}, { 'achievement:discovery': { v: 9 } }, PID)
    expect(out.upserts).toHaveLength(0)
  })

  it('幂等', () => {
    const local = { 'achievement:discovery': { v: 1, chances: 1, revealed: ['a'], streakWithoutNew: 1, lastGrantDay: '2026-01-01' } }
    const remote = { 'achievement:discovery': { v: 1, chances: 2, revealed: ['b'], streakWithoutNew: 0, lastGrantDay: '2026-01-02' } }
    const first = mergeSettings(local, remote, PID)
    expect(mergeSettings(applyLocal(local, first), remote, PID).upserts).toHaveLength(0)
  })
})

describe('attemptedTypes — 并集', () => {
  it('去重并集，本机顺序在前', () => {
    const out = mergeSettings({ attemptedTypes: ['blank', 'judge'] }, { attemptedTypes: ['judge', 'match'] }, PID)
    expect(out.upserts[0].value).toEqual(['blank', 'judge', 'match'])
  })

  it('本机已包含全部 → 不写', () => {
    const out = mergeSettings({ attemptedTypes: ['blank'] }, { attemptedTypes: ['blank'] }, PID)
    expect(out.upserts).toHaveLength(0)
  })

  it('本机缺失 → 取远端', () => {
    const out = mergeSettings({}, { attemptedTypes: ['blank'] }, PID)
    expect(out.upserts[0].value).toEqual(['blank'])
  })
})

describe('本机优先的两个键', () => {
  it('achievementUi — 本机有值就不动（纯界面态）', () => {
    const out = mergeSettings(
      { achievementUi: { v: 1, collapsed: ['pending'] } },
      { achievementUi: { v: 1, collapsed: ['earned'] } },
      PID,
    )
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('achievementUi — 本机缺失才取远端', () => {
    const out = mergeSettings({}, { achievementUi: { v: 1, collapsed: [] } }, PID)
    expect(out.upserts).toHaveLength(1)
  })

  it('achievement:discoveryEnabled — 本机 false 不被远端的 true 覆盖', () => {
    const out = mergeSettings({ 'achievement:discoveryEnabled': false }, { 'achievement:discoveryEnabled': true }, PID)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('achievement:discoveryEnabled — 本机缺失才取远端', () => {
    const out = mergeSettings({}, { 'achievement:discoveryEnabled': false }, PID)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].value).toBe(false)
  })
})

describe('achievement:collectionSeen — 逻辑或', () => {
  it('远端看过 → 写 true', () => {
    const out = mergeSettings({}, { 'achievement:collectionSeen': true }, PID)
    expect(out.upserts[0].value).toBe(true)
  })

  it('本机已看过 → 不写', () => {
    const out = mergeSettings({ 'achievement:collectionSeen': true }, { 'achievement:collectionSeen': false }, PID)
    expect(out.upserts).toHaveLength(0)
  })

  it('两边都没有 → 不凭空写一个 false 进去', () => {
    const out = mergeSettings({}, { 'achievement:collectionSeen': false }, PID)
    expect(out.upserts).toHaveLength(0)
  })
})

describe('mergeSettingValue — 供折叠多份备份时使用', () => {
  it('逐键规则与 mergeSettings 一致', () => {
    expect(mergeSettingValue('attemptedTypes', ['a'], ['b'])).toEqual(['a', 'b'])
    expect(mergeSettingValue('achievement:collectionSeen', true, false)).toBe(true)
    expect(mergeSettingValue('achievementUi', 'local', 'remote')).toBe('local')
    expect(mergeSettingValue('studyStreak', { current: 1, longest: 1, lastDate: '' }, { current: 3, longest: 2, lastDate: '2026-01-01' })).toEqual({
      current: 3,
      longest: 2,
      lastDate: '2026-01-01',
    })
  })
})

/**
 * 每个登记键的"有内容"样本。
 *
 * 用 `Record<ProfileScopedBase, unknown>` 而不是随手写的对象字面量：
 * 将来 `PROFILE_SCOPED_KEYS` 再加键时，**这里和 `RULES` 会同时逼人补一行**
 * （V1.4–B3 加 `customChecks` 时，就是因为没有这层约束，"新键没接上合并"静默过关了）。
 */
const SAMPLE: Record<ProfileScopedBase, unknown> = {
  achievements: [{ id: 'x', unlockedAt: '2026-01-01' }],
  achievementUi: { v: 1, collapsed: [] },
  'achievement:collectionSeen': true,
  'achievement:discovery': {
    v: 1,
    chances: 1,
    revealed: ['a'],
    streakWithoutNew: 0,
    lastGrantDay: '2026-01-01',
  },
  'achievement:discoveryEnabled': true,
  dailyStats: [{ date: '2026-01-01', questionCount: 1, firstStudyAt: 1, lastStudyAt: 1 }],
  studyStreak: { current: 1, longest: 1, lastDate: '2026-01-01' },
  attemptedTypes: ['blank'],
  customChecks: [{ packId: 'my-pack', itemId: 'i1', checked: true, at: '2026-01-01' }],
}

describe('逐键规则的登记完整性', () => {
  it('★ 每个登记的分片键都必须有归属：有合并规则，或明确写在 SKIP_REASONS 里', () => {
    const unowned = PROFILE_SCOPED_KEYS.filter(
      (base) => !isSkippedBase(base) && mergeSettingValue(base, undefined, SAMPLE[base]) === undefined,
    )
    expect(unowned).toEqual([])
  })

  it('★ 被跳过的键必须给出非空理由（只写标签等于把规则关掉）', () => {
    for (const base of PROFILE_SCOPED_KEYS) {
      if (!isSkippedBase(base)) continue
      expect(typeof SKIP_REASONS[base]).toBe('string')
      expect((SKIP_REASONS[base] ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('反向：写了理由的键必须真的被跳过（防止理由留下、规则又被打开）', () => {
    for (const base of Object.keys(SKIP_REASONS) as ProfileScopedBase[]) {
      expect(PROFILE_SCOPED_KEYS).toContain(base)
      expect(isSkippedBase(base)).toBe(true)
    }
  })
})

describe('customChecks — 本版明确不合并', () => {
  it('★ 备份里的勾选不搬，且**不计** keptLocal（否则预览数字虚高）', () => {
    const out = mergeSettings({}, { customChecks: SAMPLE.customChecks }, PID)
    expect(out.upserts).toHaveLength(0)
    expect(out.changed).toBe(0)
    expect(out.keptLocal).toBe(0)
  })

  it('本机已有勾选时也不动（不写、不计）', () => {
    const local = { customChecks: [{ packId: 'p', itemId: 'i', checked: true, at: '2026-01-01' }] }
    const out = mergeSettings(local, { customChecks: SAMPLE.customChecks }, PID)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(0)
  })

  it('mergeSettingValue 对 skipped 键返回 undefined（调用方须先问 isSkippedBase）', () => {
    expect(isSkippedBase('customChecks')).toBe(true)
    expect(mergeSettingValue('customChecks', undefined, SAMPLE.customChecks)).toBeUndefined()
    expect(isSkippedBase('attemptedTypes')).toBe(false)
  })
})

describe('mergeSettings — 计数语义', () => {
  it('除显式跳过者外，每个登记键有变化时各产出 1 条 upsert，无变化则全部 keptLocal', () => {
    const merged = PROFILE_SCOPED_KEYS.filter((base) => !isSkippedBase(base))

    const out = mergeSettings({}, SAMPLE, PID)
    expect(out.upserts.map((u) => u.key.slice(0, u.key.lastIndexOf(':')))).toEqual(merged)
    expect(out.changed).toBe(merged.length)
    expect(out.keptLocal).toBe(0)

    // 回放后再合一次：全部保持本机，零写入（AC-P2-13）
    const again = mergeSettings(applyLocal({}, out), SAMPLE, PID)
    expect(again.upserts).toHaveLength(0)
    expect(again.keptLocal).toBe(merged.length)
  })
})
