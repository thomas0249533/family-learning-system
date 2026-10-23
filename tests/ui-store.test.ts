import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '@core/stores/ui'

describe('ui store · 沉浸式专注模式', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('初始 isFocusMode 必须为 false（普通页面，不黑屏）', () => {
    const ui = useUiStore()
    expect(ui.isFocusMode).toBe(false)
  })

  it('enterFocus / exitFocus 正确切换状态', () => {
    const ui = useUiStore()
    ui.enterFocus()
    expect(ui.isFocusMode).toBe(true)
    ui.exitFocus()
    expect(ui.isFocusMode).toBe(false)
  })

  it('toggleFocus 取反', () => {
    const ui = useUiStore()
    ui.toggleFocus()
    expect(ui.isFocusMode).toBe(true)
    ui.toggleFocus()
    expect(ui.isFocusMode).toBe(false)
  })

  it('exitFocus 是幂等的（重复退出不会抛错，且保持 false）', () => {
    const ui = useUiStore()
    ui.enterFocus()
    ui.exitFocus()
    expect(() => ui.exitFocus()).not.toThrow()
    expect(ui.isFocusMode).toBe(false)
  })
})
