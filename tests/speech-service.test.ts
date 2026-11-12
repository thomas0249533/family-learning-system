/**
 * V3.1.7 · 语音服务的纯函数部分（node 环境无 Web Speech API，故只测可测的）。
 * 组件/播放路径不在这里跑，避免假验证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
})

const {
  detectLang,
  effectiveRate,
  splitForSpeech,
  loadVoicePreferences,
  saveVoicePreferences,
} = await import('@core/audio/speechService')

beforeEach(() => { store.clear() })

describe('detectLang', () => {
  it('含中文 → zh-CN，纯英文 → en-US', () => {
    expect(detectLang('奇观')).toBe('zh-CN')
    expect(detectLang('奇观 city')).toBe('zh-CN')
    expect(detectLang('building')).toBe('en-US')
  })
})

describe('effectiveRate（家长设置 > 默认值）', () => {
  it('未设置：中文听写降速 0.82，英文 0.92', () => {
    expect(effectiveRate('zh-CN')).toBe(0.82)
    expect(effectiveRate('en-US')).toBe(0.92)
  })
  it('显式指定优先', () => {
    expect(effectiveRate('zh-CN', 1.1)).toBe(1.1)
  })
  it('家长设置持久化后生效；越界值被忽略', () => {
    saveVoicePreferences({ voiceName: 'X', rate: 0.7 })
    expect(effectiveRate('zh-CN')).toBe(0.7)
    expect(loadVoicePreferences().voiceName).toBe('X')
    saveVoicePreferences({ voiceName: '', rate: 99 })
    expect(loadVoicePreferences().rate).toBeNull()
    expect(effectiveRate('zh-CN')).toBe(0.82)
  })
  it('存储损坏时回退默认，不抛异常', () => {
    store.set('fls.voice.preferences.v1', '{not json')
    expect(loadVoicePreferences()).toEqual({ voiceName: '', rate: null })
  })
})

describe('splitForSpeech（长句分段，规避 WebView 截断）', () => {
  it('短句整段返回', () => {
    expect(splitForSpeech('奇观')).toEqual(['奇观'])
    expect(splitForSpeech('')).toEqual([])
  })
  it('长文本切成的每段都不超过上限，且拼接能还原', () => {
    const text = '第一句，第二句，第三句，第四句，第五句，第六句。'.repeat(12)
    const parts = splitForSpeech(text, 60)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(p => p.length <= 60)).toBe(true)
    expect(parts.join('')).toBe(text)
  })
})
