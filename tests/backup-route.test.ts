import { describe, expect, it } from 'vitest'
import { routeBackup } from '@core/backup/routeBackup'

/**
 * §7.2 的版本路由分支表 —— 8 个分支 + 几个边界。
 *
 * 为什么这条路由值得单独一套测试：它是**唯一**决定"这份文件要不要被导入"的地方。
 * 判错的方向只有两种，都很贵：
 *   - 把坏文件当好的 → 结构错误在合并之后才显现（那时已经无法区分哪条数据是错的）；
 *   - 把好文件当坏的 → 用户换设备时数据进不来，且我们永远收不到这条反馈。
 * 纯函数，所以可以逐分支穷举。
 */

/** 一条合法的 v2 进度行 */
function row(pid: string, extra: Record<string, unknown> = {}) {
  return {
    profileId: pid,
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '学习中',
    correctCount: 1,
    ...extra,
  }
}

/** 一份结构完整的 v2 备份（各用例在此基础上改一处） */
function validV2(override: Record<string, unknown> = {}) {
  return {
    formatVersion: 2,
    exportedAt: '2025-01-01T00:00:00.000Z',
    appVersion: '1.9.1',
    activeProfileId: 'default',
    profiles: [
      {
        profileId: 'default',
        name: '我',
        createdAt: '2024-01-01T00:00:00.000Z',
        progress: [row('default')],
        mistakes: [],
        examSessions: [],
        settings: [{ key: 'dailyStats:default', value: { date: '2025-01-01' } }],
      },
    ],
    globalSettings: [{ key: 'fls:theme', value: 'default' }],
    ...override,
  }
}

describe('routeBackup — v1 分支', () => {
  it('没有 formatVersion → v1（v1 备份压根没有这个字段）', () => {
    const flat = { version: '1.0', exportedAt: '2024-01-01T00:00:00.000Z', progress: [], mistakes: [] }
    const route = routeBackup(flat)
    expect(route.kind).toBe('v1')
    if (route.kind !== 'v1') throw new Error('unreachable')
    // 原样交出（路由不负责清洗，适配器负责）
    expect(route.data).toBe(flat)
  })

  it("formatVersion: '1.0' → v1", () => {
    const route = routeBackup({ formatVersion: '1.0', progress: [] })
    expect(route.kind).toBe('v1')
  })

  it('数字 1 也按 v1 处理（同一个扁平结构）', () => {
    expect(routeBackup({ formatVersion: 1, progress: [] }).kind).toBe('v1')
  })

  it('v1 里多余的 packages 字段被**保留在数据里**（由适配器忽略，路由不擅自删）', () => {
    const flat = { version: '1.0', progress: [], packages: [{ packageId: 'pkg-a' }] }
    const route = routeBackup(flat)
    expect(route.kind).toBe('v1')
    if (route.kind !== 'v1') throw new Error('unreachable')
    expect(route.data.packages).toHaveLength(1)
  })

  it('v1 的 progress 不是数组 → malformed（不静默当空）', () => {
    const route = routeBackup({ version: '1.0', progress: 'oops' })
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('malformed')
  })

  it('v1 的行不是对象 → malformed', () => {
    const route = routeBackup({ version: '1.0', mistakes: ['不是对象'] })
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('malformed')
  })
})

describe('routeBackup — v2 分支', () => {
  it('formatVersion: 2 且结构完整 → v2', () => {
    const doc = validV2()
    const route = routeBackup(doc)
    expect(route.kind).toBe('v2')
    if (route.kind !== 'v2') throw new Error('unreachable')
    expect(route.data.profiles[0].profileId).toBe('default')
    expect(route.data.globalSettings).toHaveLength(1)
  })

  it("formatVersion: '2' 字符串也认定（人工编辑过的文件常见）", () => {
    expect(routeBackup(validV2({ formatVersion: '2' })).kind).toBe('v2')
  })

  it('profiles 不是数组 → malformed', () => {
    const route = routeBackup(validV2({ profiles: { default: {} } }))
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('malformed')
  })

  it('profiles 为空数组 → malformed（空备份不该存在，导入它会假装成功）', () => {
    const route = routeBackup(validV2({ profiles: [] }))
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('malformed')
  })

  it('缺 exportedAt / appVersion / activeProfileId → malformed', () => {
    for (const field of ['exportedAt', 'appVersion', 'activeProfileId']) {
      const doc = validV2()
      delete (doc as Record<string, unknown>)[field]
      const route = routeBackup(doc)
      expect(route.kind, field).toBe('reject')
      if (route.kind !== 'reject') throw new Error('unreachable')
      expect(route.reason).toBe('malformed')
    }
  })

  it('档案缺 examSessions（字段被省略）→ malformed，而不是当空数组', () => {
    const doc = validV2()
    const profiles = doc.profiles as unknown as Record<string, unknown>[]
    delete profiles[0].examSessions
    const route = routeBackup(doc)
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('malformed')
  })
})

describe('routeBackup — 太新 / 认不出', () => {
  it('formatVersion: 3 → too-new，并给出可执行的指引文案', () => {
    const route = routeBackup(validV2({ formatVersion: 3 }))
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('too-new')
    expect(route.detail).toContain('更新的版本')
    expect(route.detail).toContain('升级本设备')
  })

  it('旧客户端（appFormatVersion: 1）读到 v2 备份 → too-new', () => {
    const route = routeBackup(validV2(), 1)
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('too-new')
  })

  it('formatVersion 是无法识别的字符串 → unknown', () => {
    const route = routeBackup(validV2({ formatVersion: '2-beta' }))
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('unknown')
  })

  it('根本不是对象（null / 字符串 / 数组 / 数字）→ unknown', () => {
    for (const bad of [null, undefined, 'backup.json', 42, [1, 2, 3]]) {
      const route = routeBackup(bad)
      expect(route.kind, String(bad)).toBe('reject')
      if (route.kind !== 'reject') throw new Error('unreachable')
      expect(route.reason).toBe('unknown')
    }
  })
})

describe('routeBackup — 行内 pid 与外层不一致（BACKUP_PROFILE_MISMATCH）', () => {
  it('进度行的 profileId 指向另一个档案 → mismatch', () => {
    const doc = validV2()
    const profiles = doc.profiles as unknown as Record<string, unknown>[]
    profiles[0].progress = [row('default'), row('p_other')]
    const route = routeBackup(doc)
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('mismatch')
    // detail 要能让家长看出"哪一份文件的哪一部分对不上"
    expect(route.detail).toContain('p_other')
    expect(route.detail).toContain('default')
  })

  it('错题行 / 考试行的 pid 不一致同样拒绝', () => {
    for (const field of ['mistakes', 'examSessions']) {
      const doc = validV2()
      const profiles = doc.profiles as unknown as Record<string, unknown>[]
      profiles[0][field] = [row('p_other')]
      const route = routeBackup(doc)
      expect(route.kind, field).toBe('reject')
      if (route.kind !== 'reject') throw new Error('unreachable')
      expect(route.reason).toBe('mismatch')
    }
  })

  it('行里**没有** profileId → malformed（缺字段是结构损坏，不是"分歧"）', () => {
    const doc = validV2()
    const profiles = doc.profiles as unknown as Record<string, unknown>[]
    const noPid = row('default')
    delete (noPid as Record<string, unknown>).profileId
    profiles[0].progress = [noPid]
    const route = routeBackup(doc)
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('malformed')
  })

  it('settings 键的后缀指向别的档案 → mismatch（写进去就是串档案）', () => {
    const doc = validV2()
    const profiles = doc.profiles as unknown as Record<string, unknown>[]
    profiles[0].settings = [{ key: 'dailyStats:p_other', value: 1 }]
    const route = routeBackup(doc)
    expect(route.kind).toBe('reject')
    if (route.kind !== 'reject') throw new Error('unreachable')
    expect(route.reason).toBe('mismatch')
  })
})
