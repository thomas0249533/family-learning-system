import { afterEach, describe, expect, it } from 'vitest'
import { isTauri } from '../src/core/pwa/isTauri'

const g = globalThis as any

afterEach(() => {
  delete g.window
})

describe('isTauri — Tauri 环境探测（零依赖）', () => {
  it('无 window（非浏览器）→ false', () => {
    delete g.window
    expect(isTauri()).toBe(false)
  })

  it('有 window 但无 Tauri 全局（Web 端）→ false', () => {
    g.window = {}
    expect(isTauri()).toBe(false)
  })

  it('window.__TAURI_INTERNALS__（Tauri v2）→ true', () => {
    g.window = { __TAURI_INTERNALS__: {} }
    expect(isTauri()).toBe(true)
  })

  it('window.__TAURI__（Tauri v1）→ true', () => {
    g.window = { __TAURI__: {} }
    expect(isTauri()).toBe(true)
  })

  it('无关全局不影响判定', () => {
    g.window = { __TAURI_LIKE__: {}, something: 1 }
    expect(isTauri()).toBe(false)
  })
})
