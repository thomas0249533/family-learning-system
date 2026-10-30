import { describe, it, expect } from 'vitest'
import { normalizeDictation, gradeDictation } from '@core/quiz/dictationGrade'

describe('normalizeDictation', () => {
  it('去首尾空白并转小写', () => {
    expect(normalizeDictation('  Hello  ')).toBe('hello')
  })

  it('合并词间连续空白（含全角空格）', () => {
    expect(normalizeDictation('get   up')).toBe('get up')
    expect(normalizeDictation('get\u3000\u3000up')).toBe('get up')
  })

  it('只剥句末标点，保留词内撇号', () => {
    expect(normalizeDictation('What is it?')).toBe('what is it')
    expect(normalizeDictation("What's this")).toBe("what's this")
  })

  it('纯标点归一化后为空', () => {
    expect(normalizeDictation('...')).toBe('')
    expect(normalizeDictation('。')).toBe('')
  })

  it('非字符串输入返回空串', () => {
    // @ts-expect-error 故意传错类型，验证运行时兜底
    expect(normalizeDictation(undefined)).toBe('')
  })
})

describe('gradeDictation', () => {
  it('大小写不敏感', () => {
    expect(gradeDictation('PE', 'pe')).toBe(true)
    expect(gradeDictation('Chinese', 'chinese')).toBe(true)
  })

  it('首尾空白与多余空格不扣分', () => {
    expect(gradeDictation('  get up  ', 'get up')).toBe(true)
    expect(gradeDictation('get  up', 'get up')).toBe(true)
  })

  it('句末标点不扣分', () => {
    expect(gradeDictation('doctor.', 'doctor')).toBe(true)
    expect(gradeDictation('写完了。', '写完了')).toBe(true)
  })

  it('词中间漏空格判错（真听漏）', () => {
    expect(gradeDictation('getup', 'get up')).toBe(false)
  })

  it('拼写错误判错', () => {
    expect(gradeDictation('recieve', 'receive')).toBe(false)
  })

  it('空答案判错（即使标准答案也为空）', () => {
    expect(gradeDictation('', 'doctor')).toBe(false)
    expect(gradeDictation('   ', 'doctor')).toBe(false)
    expect(gradeDictation('', '')).toBe(false)
  })

  it('中文词语判分', () => {
    expect(gradeDictation('观潮', '观潮')).toBe(true)
    expect(gradeDictation('观朝', '观潮')).toBe(false)
  })
})
