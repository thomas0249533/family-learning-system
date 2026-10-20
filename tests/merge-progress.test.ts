import { describe, expect, it } from 'vitest'
import type { ProgressRecord } from '@/db'
import { mergeProgress, progressKey, progressRank } from '@core/merge/mergeProgress'

/**
 * 进度行合并（§6.3）。
 *
 * 这里守的是两条最容易写错、且写错之后**不会报错**的规则：
 *   1. 「更晚者胜」的比较值必须走 `lastReviewAt ?? lastStudiedAt ?? ''`：
 *      用 `||` 会把空串也当假值吃掉，于是"从没学过"和"学过没复习"被判成同一个值，
 *      两台设备的空进度行互相覆盖 → `correctCount` 归零；
 *   2. key 是 `packageId + '\u0000' + knowledgePointId`：
 *      用可见字符当分隔符会让 `('a|b','c')` 与 `('a','b|c')` 撞成同一个 key。
 */

function row(over: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    profileId: 'default',
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '学习中',
    correctCount: 1,
    wrongCount: 0,
    correctStreak: 1,
    wrongStreak: 0,
    lastStudiedAt: '2026-01-01T00:00:00.000Z',
    studySeconds: 60,
    ...over,
  }
}

describe('progressRank — 排序值', () => {
  it('lastReviewAt 优先', () => {
    expect(progressRank({ lastReviewAt: '2026-02-01', lastStudiedAt: '2026-01-01' })).toBe(
      '2026-02-01',
    )
  })

  it('★ lastReviewAt 为 null 时退回 lastStudiedAt（不能用 ||，null 会被当假值但这是对的）', () => {
    expect(progressRank({ lastReviewAt: null, lastStudiedAt: '2026-01-01' })).toBe('2026-01-01')
    expect(progressRank({ lastReviewAt: undefined, lastStudiedAt: '2026-01-01' })).toBe('2026-01-01')
  })

  it('★ lastReviewAt 是空串时**不**退回 lastStudiedAt（?? 与 || 的分水岭）', () => {
    // 用 `||` 这里会得到 '2026-01-01'，于是下面那条"远端更晚"的用例会判反
    expect(progressRank({ lastReviewAt: '', lastStudiedAt: '2026-01-01' })).toBe('')
  })

  it('两个都缺 → 空串（空串是最小值，于是"更晚者胜"退化为"保持本机"）', () => {
    expect(progressRank({})).toBe('')
  })
})

describe('progressKey — 包内定位', () => {
  it('分隔符不可被业务字符伪造', () => {
    const a = progressKey({ packageId: 'a|b', knowledgePointId: 'c' })
    const b = progressKey({ packageId: 'a', knowledgePointId: 'b|c' })
    expect(a).not.toBe(b)
  })

  it('同一 packageId 下不同知识点是两个 key', () => {
    expect(progressKey({ packageId: 'p', knowledgePointId: 'k1' })).not.toBe(
      progressKey({ packageId: 'p', knowledgePointId: 'k2' }),
    )
  })
})

describe('mergeProgress — 更晚者胜', () => {
  it('远端更晚 → 取远端整行，并剥掉自增 id', () => {
    const local = [row({ id: 7, lastStudiedAt: '2026-01-01', correctCount: 3 })]
    const remote = [row({ id: 99, lastStudiedAt: '2026-02-01', correctCount: 9 })]

    const out = mergeProgress(local, remote)
    expect(out.added).toBe(1)
    expect(out.keptLocal).toBe(0)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].correctCount).toBe(9)
    expect('id' in out.upserts[0]).toBe(false)
  })

  it('本机更晚 → 保持本机，不产出任何写操作（AC-P2-12）', () => {
    const local = [row({ lastStudiedAt: '2026-03-01', correctCount: 9 })]
    const remote = [row({ lastStudiedAt: '2026-02-01', correctCount: 1 })]

    const out = mergeProgress(local, remote)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('★ 相等 → 保持本机（这就是 merge(local, local) 零写入的机制）', () => {
    const local = [row({ lastStudiedAt: '2026-02-01', correctCount: 9 })]
    const remote = [row({ lastStudiedAt: '2026-02-01', correctCount: 1 })]

    const out = mergeProgress(local, remote)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('本机没有该知识点 → 补进来', () => {
    const out = mergeProgress([], [row({ knowledgePointId: 'kp-new' })])
    expect(out.added).toBe(1)
    expect(out.upserts[0].knowledgePointId).toBe('kp-new')
  })

  it('★ 空串 vs 有值：靠 ?? 才能判对"谁更晚"', () => {
    // 本机 lastReviewAt='' → rank ''；远端 lastReviewAt='2025-01-01' → rank 更晚 → 远端胜。
    // 若这里用 `||`，本机 rank 会变成 '2026-01-01'，结论就反了。
    const local = [row({ lastReviewAt: '', lastStudiedAt: '2026-01-01', correctCount: 5 })]
    const remote = [row({ lastReviewAt: '2025-01-01', lastStudiedAt: '', correctCount: 2 })]

    const out = mergeProgress(local, remote)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].correctCount).toBe(2)
  })

  it('lastReviewAt 为 null 的两边：按 lastStudiedAt 比较', () => {
    const local = [row({ lastReviewAt: null, lastStudiedAt: '2026-01-05', correctCount: 5 })]
    const remote = [row({ lastReviewAt: null, lastStudiedAt: '2026-01-04', correctCount: 2 })]
    expect(mergeProgress(local, remote).upserts).toHaveLength(0)

    const remote2 = [row({ lastReviewAt: null, lastStudiedAt: '2026-01-06', correctCount: 2 })]
    expect(mergeProgress(local, remote2).upserts).toHaveLength(1)
  })

  it('不同 packageId 的同一知识点互不影响', () => {
    const local = [row({ packageId: 'pkg-a', knowledgePointId: 'kp-1' })]
    const remote = [row({ packageId: 'pkg-b', knowledgePointId: 'kp-1' })]
    const out = mergeProgress(local, remote)
    expect(out.added).toBe(1)
    expect(out.upserts[0].packageId).toBe('pkg-b')
  })

  it('远端同一 key 出现两行 → 只留最晚那行（否则写入顺序决定结果）', () => {
    const remote = [
      row({ lastStudiedAt: '2026-01-01', correctCount: 1 }),
      row({ lastStudiedAt: '2026-05-01', correctCount: 7 }),
      row({ lastStudiedAt: '2026-03-01', correctCount: 4 }),
    ]
    const out = mergeProgress([], remote)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].correctCount).toBe(7)
  })

  it('本机自带同一 key 两行（脏数据）→ 按更晚者自我收敛', () => {
    const local = [
      row({ lastStudiedAt: '2026-01-01', correctCount: 1 }),
      row({ lastStudiedAt: '2026-02-01', correctCount: 2 }),
    ]
    // 远端夹在中间：应判"本机更晚" → 不写
    const remote = [row({ lastStudiedAt: '2026-01-15', correctCount: 9 })]
    expect(mergeProgress(local, remote).upserts).toHaveLength(0)
  })
})

describe('mergeProgress — 幂等（AC-P2-13 的一半）', () => {
  it('merge(local, local) 零写入', () => {
    const local = [
      row({ knowledgePointId: 'kp-1' }),
      row({ knowledgePointId: 'kp-2', lastReviewAt: '2026-04-01' }),
    ]
    const out = mergeProgress(local, local)
    expect(out.upserts).toHaveLength(0)
  })

  it('merge(merged, remote) 零写入：先按计划覆盖，再合一次不再变', () => {
    const local = [row({ lastStudiedAt: '2026-01-01', correctCount: 1 })]
    const remote = [row({ lastStudiedAt: '2026-02-01', correctCount: 2 })]

    const first = mergeProgress(local, remote)
    const merged = [first.upserts[0]]
    expect(mergeProgress(merged, remote).upserts).toHaveLength(0)
  })

  it('多条混合：计数与写操作条数一致', () => {
    const local = [
      row({ knowledgePointId: 'k1', lastStudiedAt: '2026-03-01' }),
      row({ knowledgePointId: 'k2', lastStudiedAt: '2026-01-01' }),
    ]
    const remote = [
      row({ knowledgePointId: 'k1', lastStudiedAt: '2026-02-01' }), // 本机更晚 → 保持
      row({ knowledgePointId: 'k2', lastStudiedAt: '2026-05-01' }), // 远端更晚 → 写
      row({ knowledgePointId: 'k3', lastStudiedAt: '2026-01-01' }), // 新行 → 写
    ]
    const out = mergeProgress(local, remote)
    expect(out.upserts).toHaveLength(2)
    expect(out.added).toBe(2)
    expect(out.keptLocal).toBe(1)
  })
})
