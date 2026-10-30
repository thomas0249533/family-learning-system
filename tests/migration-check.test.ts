/**
 * 换机迁移自检的比对规则（V3.0 · M4）
 *
 * 这块最容易写错的地方是**判据**：直觉会写"相等才算通过"，但合并是并集，
 * 在用的设备上 `actual` 几乎总是大于 `expected`。那样的报告会把每一次正常导入
 * 都标红，家长很快就学会忽略它 —— 一个恒红的告警等于没有告警。
 *
 * 所以这里逐条钉死：`>=` 通过、"更多"要如实说出来但不报警、只有 `less` 需要动手。
 */

import { describe, expect, it } from 'vitest'
import type { Bundle } from '@core/backup/types'
import {
  buildMigrationReport,
  countsFromBundles,
  summarizeReport,
  type MigrationCounts,
} from '@core/backup/migrationCheck'

function counts(over: Partial<MigrationCounts> = {}): MigrationCounts {
  return { packages: null, progress: 0, mistakes: 0, achievements: 0, marks: 0, ...over }
}

function bundle(over: Partial<Bundle> = {}): Bundle {
  return {
    profileId: 'p1',
    name: '老大',
    createdAt: '2025-01-01T00:00:00.000Z',
    progress: [],
    mistakes: [],
    examSessions: [],
    cardCompletions: [],
    settings: {},
    ...over,
  }
}

describe('countsFromBundles — 备份侧计数', () => {
  it('跨档案求和（不是只数第一个）', () => {
    const out = countsFromBundles([
      bundle({ progress: [{} as never, {} as never], mistakes: [{} as never] }),
      bundle({ profileId: 'p2', progress: [{} as never], cardCompletions: [{} as never] }),
    ])
    expect(out.progress).toBe(3)
    expect(out.mistakes).toBe(1)
    expect(out.marks).toBe(1)
  })

  it('徽章从分片键 achievements 的数组长度来', () => {
    const out = countsFromBundles([
      bundle({ settings: { achievements: [{ id: 'a' }, { id: 'b' }] } }),
      bundle({ settings: { achievements: [{ id: 'c' }] } }),
    ])
    expect(out.achievements).toBe(3)
  })

  it('徽章键形状不认识 → 按 0 算，绝不抛错', () => {
    const out = countsFromBundles([bundle({ settings: { achievements: { weird: true } } })])
    expect(out.achievements).toBe(0)
  })

  it('packages 永远是 null（备份里没有包，见 migrationCheck 文件头）', () => {
    expect(countsFromBundles([bundle()]).packages).toBeNull()
  })

  it('空输入 / undefined 行不炸', () => {
    expect(countsFromBundles([]).progress).toBe(0)
    expect(countsFromBundles([undefined as unknown as Bundle]).progress).toBe(0)
  })
})

describe('buildMigrationReport — 判据', () => {
  it('★ 相等 → 全绿', () => {
    const r = buildMigrationReport(counts({ progress: 3 }), counts({ progress: 3, packages: 5 }))
    expect(r.ok).toBe(true)
    expect(r.rows.find((x) => x.key === 'progress')!.verdict).toBe('ok')
  })

  it('★ 本机原有更多 → 不报警，但如实说明多多少', () => {
    const r = buildMigrationReport(counts({ progress: 3 }), counts({ progress: 8, packages: 2 }))
    const row = r.rows.find((x) => x.key === 'progress')!
    expect(row.verdict).toBe('more')
    expect(row.hint).toContain('多 5')
    expect(r.ok).toBe(true)
  })

  it('★ 少了 → 唯一的失败结论，且点名是哪一项', () => {
    const r = buildMigrationReport(
      counts({ progress: 10, mistakes: 4 }),
      counts({ progress: 10, mistakes: 2, packages: 3 }),
    )
    expect(r.ok).toBe(false)
    expect(r.failedLabels).toEqual(['错题'])
    expect(r.rows.find((x) => x.key === 'mistakes')!.verdict).toBe('less')
    expect(r.rows.find((x) => x.key === 'mistakes')!.hint).toContain('少了 2')
  })

  it('packages 恒为 n/a，且不阻塞 ok（备份不含包，不是数据丢）', () => {
    const r = buildMigrationReport(counts({ progress: 1 }), counts({ progress: 1, packages: 0 }))
    const row = r.rows.find((x) => x.key === 'packages')!
    expect(row.verdict).toBe('n/a')
    expect(row.expected).toBeNull()
    expect(r.ok).toBe(true)
  })

  it('五项齐全且顺序稳定（界面按它渲染）', () => {
    const r = buildMigrationReport(counts(), counts())
    expect(r.rows.map((x) => x.key)).toEqual([
      'packages',
      'progress',
      'mistakes',
      'achievements',
      'marks',
    ])
  })

  it('expected 是 0 而实际也是 0 → ok（不是 n/a，也不许报 less）', () => {
    const r = buildMigrationReport(counts({ marks: 0 }), counts({ packages: 1 }))
    expect(r.rows.find((x) => x.key === 'marks')!.verdict).toBe('ok')
  })
})

describe('summarizeReport — 一句话', () => {
  it('通过时给"可以放心用"', () => {
    expect(summarizeReport(buildMigrationReport(counts({ progress: 1 }), counts({ progress: 1 }))))
      .toContain('放心用')
  })

  it('失败时点名 + 给出下一步动作', () => {
    const r = buildMigrationReport(counts({ progress: 5, marks: 2 }), counts({ progress: 5, marks: 1 }))
    const text = summarizeReport(r)
    expect(text).toContain('完成标记')
    expect(text).toContain('重新导入')
  })
})
