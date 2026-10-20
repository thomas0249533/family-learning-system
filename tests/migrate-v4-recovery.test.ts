import { describe, expect, it, vi } from 'vitest'

// 本文件只测纯函数（shouldRunV4Recovery / hasScopeGaps），
// 但模块顶层 import 了运行时的 `db`；node 环境没有 IndexedDB，直接替换掉。
vi.mock('@/db', () => ({ db: {} }))

const { shouldRunV4Recovery, hasScopeGaps } = await import('@core/storage/migrateV4Recovery')

/**
 * v4 迁移的启动补偿"该不该跑"与"还有没有缺口"。
 *
 * 这两条是纯函数，但它们的边界决定了**会不会无限重试**和**会不会静默放过缺行**：
 *   - 上限判错（`<` 写成 `<=`）→ 少跑一次，`partial` 永远修不回来；
 *   - 状态判错（`partial` 当成终态）→ 缺行永远不被发现。
 * 所以断言按"状态 × attempts"两维穷举，而不是只测一两个代表值。
 */

describe('shouldRunV4Recovery — 状态判定', () => {
  it('没有标记（首次启动 / 标记读不到）→ 不补跑：没跑过 v4 迁移就没什么可修', () => {
    expect(shouldRunV4Recovery(null)).toBe(false)
  })

  it('★ ok / ok-recovered 是一次性语义，永不再跑（跑了会覆盖成功标记）', () => {
    expect(shouldRunV4Recovery({ status: 'ok', at: 't' })).toBe(false)
    expect(shouldRunV4Recovery({ status: 'ok-recovered', at: 't' })).toBe(false)
  })

  it('failed 且 attempts 缺失 → 当作 0 次，要跑', () => {
    expect(shouldRunV4Recovery({ status: 'failed', at: 't' })).toBe(true)
  })

  it('partial 同样要跑：它可能只是 unknownKeys 非空，核一遍能升级成 ok-recovered', () => {
    expect(shouldRunV4Recovery({ status: 'partial', at: 't', attempts: 0 })).toBe(true)
  })
})

describe('shouldRunV4Recovery — 次数上限边界', () => {
  it('★ failed：0/1/2 次都还要跑，第 3 次起放弃（边界不能写成 <=）', () => {
    for (const attempts of [0, 1, 2]) {
      expect(shouldRunV4Recovery({ status: 'failed', at: 't', attempts })).toBe(true)
    }
    expect(shouldRunV4Recovery({ status: 'failed', at: 't', attempts: 3 })).toBe(false)
    expect(shouldRunV4Recovery({ status: 'failed', at: 't', attempts: 4 })).toBe(false)
  })

  it('★ partial：同样受 3 次上限约束（否则每次启动都会重写标记）', () => {
    expect(shouldRunV4Recovery({ status: 'partial', at: 't', attempts: 2 })).toBe(true)
    expect(shouldRunV4Recovery({ status: 'partial', at: 't', attempts: 3 })).toBe(false)
  })
})

describe('hasScopeGaps — 四项缺口的任一为真都算"没修完"', () => {
  const clean = { progress: 0, mistakes: 0, sessions: 0, hasProfilesKey: true }

  it('全部干净 → false', () => {
    expect(hasScopeGaps(clean)).toBe(false)
  })

  it('★ 三张表各有一条缺 profileId 的行，都必须被报出来', () => {
    expect(hasScopeGaps({ ...clean, progress: 1 })).toBe(true)
    expect(hasScopeGaps({ ...clean, mistakes: 1 })).toBe(true)
    expect(hasScopeGaps({ ...clean, sessions: 1 })).toBe(true)
  })

  it('★ 缺 profiles 键也算缺口（否则 UI 与导入要各自兜"没读到就新建"）', () => {
    expect(hasScopeGaps({ ...clean, hasProfilesKey: false })).toBe(true)
  })

  it('多个缺口同时存在仍为 true（不是"只有一项为真才算"）', () => {
    expect(hasScopeGaps({ progress: 2, mistakes: 3, sessions: 1, hasProfilesKey: false })).toBe(true)
  })
})
