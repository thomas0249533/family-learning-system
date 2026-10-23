import { describe, expect, it } from 'vitest'
import { deriveAccent, ACCENT_PRESETS } from '@core/theme/accent'

describe('deriveAccent · 自定义主题色派生', () => {
  it('非法 hex 返回 null（调用方据此跳过覆盖，不崩溃）', () => {
    expect(deriveAccent('#zzz', 'light')).toBeNull()
    expect(deriveAccent('notacolor', 'dark')).toBeNull()
    expect(deriveAccent('#abc', 'light')).toBeNull()
  })

  it('浅色下淡紫被推到 AA 安全文字色', () => {
    const a = deriveAccent('#b9a3e3', 'light')
    expect(a).not.toBeNull()
    expect(a!.primaryText).toMatch(/^#[0-9a-f]{6}$/)
    expect(a!.onPrimary).toBe('#ffffff')
    // 派生色只能比基色更深（朝黑推），不会变浅
    expect(a!.primaryText).not.toBe('#b9a3e3')
  })

  it('深色下返回近黑 onPrimary', () => {
    const a = deriveAccent('#b9a3e3', 'dark')
    expect(a!.onPrimary).toBe('#08120e')
  })

  it('深色下偏暗基色被推亮以满足 AA', () => {
    const a = deriveAccent('#3a2a5c', 'dark')
    expect(a!.primaryText).toMatch(/^#[0-9a-f]{6}$/)
    expect(a!.primaryText).not.toBe('#3a2a5c')
  })

  it('深色下极浅基色本身已达标则保持（不被无谓改写）', () => {
    const a = deriveAccent('#e7dffb', 'dark')
    expect(a!.primaryText).toBe('#e7dffb')
  })

  it('已达标基色（深松绿）不被无谓改写', () => {
    const a = deriveAccent('#2d6a4f', 'light')
    expect(a!.primaryText).toBe('#2d6a4f')
  })

  it('返回软色 / 渐变 / rgb 三元组（格式正确）', () => {
    const a = deriveAccent('#6db3e8', 'light')
    expect(a!.primarySoft).toContain('rgba')
    expect(a!.gradientPrimary).toContain('linear-gradient')
    expect(a!.primaryRgb).toMatch(/^\d+, \d+, \d+$/)
  })

  it('预设色板都是合法 6 位 hex', () => {
    for (const p of ACCENT_PRESETS) {
      expect(p.hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
