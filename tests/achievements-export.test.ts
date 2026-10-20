import { describe, expect, it, vi } from 'vitest'

// exportService 会 `import { db }`：node 环境下没有 IndexedDB，
// 这里只需要它的纯函数（buildAchievementsExport），给个空壳即可。
vi.mock('@/db', () => ({ db: {} }))

const { buildAchievementsExport } = await import('@core/export/exportService')
const { imageFileName } = await import('@core/report/exportImages')
const { mergeSettings } = await import('@core/merge/mergeSettings')
import type { BackupV2 } from '@core/backup/types'

/**
 * V1.4 · B5 · 成就导出
 *
 * 两条判据：
 *   1. **AC-P2-9**：同机导出后重新导入，解锁记录完全一致（含 `evidence` / `repeatCount`），
 *      且导入后总数不变。这里用"导出投影 → 合并进空库 → 逐字段比对"直接证明，
 *      不依赖 UI 往返（那条在 e2e 里另有一套）。
 *   2. 导出文件**不许**携带进度/错题/考试记录：合并是并集，但"空数组"与"没这个键"
 *      在别处可能有别的语义；这里明确断言它们是空数组，避免将来有人改成 `undefined`
 *      让合并器走到另一条分支。
 */

const NOW = '2026-10-20T10:00:00+08:00'

function full(): BackupV2 {
  return {
    formatVersion: 2,
    exportedAt: NOW,
    appVersion: 'test',
    activeProfileId: 'p1',
    profiles: [
      {
        profileId: 'p1',
        name: '老大',
        createdAt: NOW,
        progress: [{ profileId: 'p1', packageId: 'pkg', knowledgePointId: 'k1', status: '已掌握' } as never],
        mistakes: [{ profileId: 'p1', packageId: 'pkg', exerciseId: 'e1' } as never],
        examSessions: [{ profileId: 'p1', packageId: 'pkg', startedAt: NOW } as never],
        settings: [
          {
            key: 'achievements:p1',
            value: [
              { id: 'first-step', unlockedAt: '2026-03-01', evidence: '答对了第一道题', repeatCount: 3 },
              { id: 'custom::tidy-desk', unlockedAt: '2026-04-01' },
            ],
          },
          { key: 'customChecks:p1', value: { 'home-1::custom::tidy-desk': { at: NOW } } },
          { key: 'dailyStats:p1', value: [{ date: '2026-10-20', questionCount: 9 }] },
          { key: 'studyStreak:p1', value: { current: 4, longest: 9, lastDate: '2026-10-20' } },
        ],
      },
    ],
    globalSettings: [{ key: 'achievement:customPacks', value: { packs: [] } }],
  }
}

describe('buildAchievementsExport — 只留成就相关键', () => {
  const subset = buildAchievementsExport(full())

  it('进度 / 错题 / 考试记录一律置空（这个文件绝不能动别人的学习数据）', () => {
    for (const p of subset.profiles) {
      expect(p.progress).toEqual([])
      expect(p.mistakes).toEqual([])
      expect(p.examSessions).toEqual([])
    }
  })

  it('settings 只留 achievements: 与 customChecks:', () => {
    expect(subset.profiles[0].settings.map((s) => s.key)).toEqual([
      'achievements:p1',
      'customChecks:p1',
    ])
  })

  it('globalSettings 置空：包体是设备级资产，写进来会让用户以为包也搬过去了', () => {
    expect(subset.globalSettings).toEqual([])
  })

  it('格式头保持不变（仍是合法 v2，导入走既有路由）', () => {
    expect(subset.formatVersion).toBe(2)
    expect(subset.profiles[0].profileId).toBe('p1')
    expect(subset.activeProfileId).toBe('p1')
  })
})

describe('AC-P2-9 — 导出后重新导入，解锁记录逐字段一致', () => {
  it('evidence / repeatCount / unlockedAt 全部原样回来', () => {
    const subset = buildAchievementsExport(full())
    const exported = subset.profiles[0].settings.find((s) => s.key === 'achievements:p1')?.value

    // 空库合并：等价于"把这台设备导出的记录装进另一台"
    const out = mergeSettings({}, { achievements: exported }, 'p1')
    const row = out.upserts.find((u) => u.key === 'achievements:p1')
    expect(row?.value).toEqual(exported)
  })

  it('总数不变：并集不会凭空多出记录', () => {
    const subset = buildAchievementsExport(full())
    const exported = subset.profiles[0].settings.find((s) => s.key === 'achievements:p1')
      ?.value as unknown[]
    const merged = mergeSettings({ achievements: exported }, { achievements: exported }, 'p1')
    const row = merged.upserts.find((u) => u.key === 'achievements:p1')
    // 同值合并 → 不产生 upsert（changed=0），结果就是本机那份
    expect((row?.value ?? exported) as unknown[]).toHaveLength(exported.length)
  })

  it('★ 重复次数不因"投影 → 导入"被打回 1（B6 的 R11 在导出路径上也成立）', () => {
    const subset = buildAchievementsExport(full())
    const exported = subset.profiles[0].settings.find((s) => s.key === 'achievements:p1')?.value
    const out = mergeSettings({}, { achievements: exported }, 'p1')
    const value = out.upserts.find((u) => u.key === 'achievements:p1')?.value as Array<{
      id: string
      repeatCount?: number
    }>
    expect(value.find((r) => r.id === 'first-step')?.repeatCount).toBe(3)
  })
})

describe('imageFileName — PRD 点名的四个文件名', () => {
  it('单页 → achievements-M.png（不带页号）', () => {
    expect(imageFileName('M', 0, 1)).toBe('achievements-M.png')
    expect(imageFileName('G', 0, 1)).toBe('achievements-G.png')
    expect(imageFileName('B', 0, 1)).toBe('achievements-B.png')
    expect(imageFileName('E', 0, 1)).toBe('achievements-E.png')
  })

  it('一组多页 → 带页号，避免浏览器自动加 (1) 出现不可预期的名字', () => {
    expect(imageFileName('B', 0, 2)).toBe('achievements-B-1.png')
    expect(imageFileName('B', 1, 2)).toBe('achievements-B-2.png')
  })
})
