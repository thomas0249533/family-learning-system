import { describe, expect, it } from 'vitest'
import type { MistakeRecord } from '@/db'
import { mergeMistakes, mistakeLevel, mistakeLevelRank } from '@core/merge/mergeMistakes'

/**
 * 错题行合并（§6.3）。
 *
 * 核心不变量：**等级只升不降**。
 * 只按 `wrongAt` 更晚者胜会出现：设备 B 上今天答错一次，把设备 A 上孩子练到
 * `mastered` 的那行整行盖掉 —— 孩子第二天看到"未掌握"，而他明明已经会了。
 * 这是本文件优先要守住的规则。
 */

function row(over: Partial<MistakeRecord> = {}): MistakeRecord {
  return {
    profileId: 'default',
    packageId: 'pkg-a',
    exerciseId: 'ex-1',
    knowledgePointIds: ['kp-1'],
    wrongAt: '2026-01-01T00:00:00.000Z',
    wrongCount: 1,
    mastered: false,
    masteryLevel: 'none',
    ...over,
  }
}

describe('mistakeLevel — 兼容老字段 mastered', () => {
  it('有 masteryLevel 就用它', () => {
    expect(mistakeLevel({ masteryLevel: 'partial', mastered: false })).toBe('partial')
  })

  it('★ 只有 mastered（P3 之前的老备份）时不能当成 none', () => {
    expect(mistakeLevel({ mastered: true })).toBe('mastered')
    expect(mistakeLevel({ mastered: false })).toBe('none')
  })

  it('等级序 none < partial < mastered', () => {
    expect(mistakeLevelRank({ mastered: false })).toBeLessThan(
      mistakeLevelRank({ masteryLevel: 'partial', mastered: false }),
    )
    expect(mistakeLevelRank({ masteryLevel: 'partial', mastered: false })).toBeLessThan(
      mistakeLevelRank({ masteryLevel: 'mastered', mastered: true }),
    )
  })
})

describe('mergeMistakes — 时间与等级', () => {
  it('远端更晚且等级更高 → 取远端，剥掉 id', () => {
    const local = [row({ id: 3, wrongAt: '2026-01-01', masteryLevel: 'none', wrongCount: 1 })]
    const remote = [row({ id: 8, wrongAt: '2026-02-01', masteryLevel: 'partial', wrongCount: 4 })]

    const out = mergeMistakes(local, remote)
    expect(out.added).toBe(1)
    expect(out.upserts[0].wrongCount).toBe(4)
    expect('id' in out.upserts[0]).toBe(false)
  })

  it('★ 远端更晚但等级更低 → 保持本机（等级只升不降）', () => {
    const local = [row({ wrongAt: '2026-01-01', masteryLevel: 'mastered', mastered: true })]
    const remote = [row({ wrongAt: '2026-03-01', masteryLevel: 'none', mastered: false })]

    const out = mergeMistakes(local, remote)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('远端更晚且等级相同 → 取远端（时间更近，排错题本更准）', () => {
    const local = [row({ wrongAt: '2026-01-01', masteryLevel: 'partial', wrongCount: 1 })]
    const remote = [row({ wrongAt: '2026-02-01', masteryLevel: 'partial', wrongCount: 5 })]

    const out = mergeMistakes(local, remote)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].wrongCount).toBe(5)
  })

  it('本机更晚 → 保持本机', () => {
    const local = [row({ wrongAt: '2026-03-01', masteryLevel: 'none' })]
    const remote = [row({ wrongAt: '2026-02-01', masteryLevel: 'mastered', mastered: true })]

    const out = mergeMistakes(local, remote)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('wrongAt 相等 → 取等级高者', () => {
    const local = [row({ wrongAt: '2026-02-01', masteryLevel: 'none' })]
    const remote = [row({ wrongAt: '2026-02-01', masteryLevel: 'partial' })]

    const out = mergeMistakes(local, remote)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].masteryLevel).toBe('partial')
  })

  it('wrongAt 与等级都相等 → 保持本机（幂等）', () => {
    const local = [row({ wrongAt: '2026-02-01', masteryLevel: 'partial', lastUserAnswer: 'A' })]
    const remote = [row({ wrongAt: '2026-02-01', masteryLevel: 'partial', lastUserAnswer: 'B' })]

    expect(mergeMistakes(local, remote).upserts).toHaveLength(0)
  })

  it('本机没有这道题 → 补进来', () => {
    const out = mergeMistakes([], [row({ exerciseId: 'ex-new' })])
    expect(out.added).toBe(1)
    expect(out.upserts[0].exerciseId).toBe('ex-new')
  })

  it('key 是 exerciseId：同一道题不同 packageId 仍是同一行', () => {
    const local = [row({ exerciseId: 'ex-1', packageId: 'pkg-a', wrongAt: '2026-01-01' })]
    const remote = [row({ exerciseId: 'ex-1', packageId: 'pkg-b', wrongAt: '2026-05-01' })]
    const out = mergeMistakes(local, remote)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].packageId).toBe('pkg-b')
  })

  it('★ 整行胜的已知代价：远端胜出时 wrongCount 可能变小（不做字段级合并）', () => {
    // 这条断言把"取舍"写进测试，防止将来有人为了好看去加字段级 max ——
    // 那样会出现 wrongCount 来自 A、masteryLevel 来自 B 的缝合行，等级判断失去依据。
    const local = [row({ wrongAt: '2026-01-01', masteryLevel: 'partial', wrongCount: 9 })]
    const remote = [row({ wrongAt: '2026-02-01', masteryLevel: 'partial', wrongCount: 2 })]
    expect(mergeMistakes(local, remote).upserts[0].wrongCount).toBe(2)
  })
})

describe('mergeMistakes — 幂等', () => {
  it('merge(local, local) 零写入', () => {
    const local = [row({ exerciseId: 'ex-1' }), row({ exerciseId: 'ex-2', wrongAt: '2026-05-01' })]
    expect(mergeMistakes(local, local).upserts).toHaveLength(0)
  })

  it('merge(merged, remote) 零写入', () => {
    const local = [row({ wrongAt: '2026-01-01', masteryLevel: 'none' })]
    const remote = [row({ wrongAt: '2026-02-01', masteryLevel: 'mastered', mastered: true })]

    const first = mergeMistakes(local, remote)
    expect(mergeMistakes([first.upserts[0]], remote).upserts).toHaveLength(0)
  })
})
