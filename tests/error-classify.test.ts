import { describe, it, expect } from 'vitest'
import { suggestCause, splitUnit, isEditDistanceOne } from '@core/mistake/errorClassify'

describe('splitUnit', () => {
  it('剥出常见单位', () => {
    expect(splitUnit('15174克')).toEqual(['15174', '克'])
    expect(splitUnit('6 条')).toEqual(['6', '条'])
    expect(splitUnit('3.5平方米')).toEqual(['3.5', '平方米'])
  })

  it('优先匹配长单位（平方厘米不能拆成平方 + 厘米）', () => {
    expect(splitUnit('12平方厘米')).toEqual(['12', '平方厘米'])
  })

  it('没单位 → 单位为空串', () => {
    expect(splitUnit('42')).toEqual(['42', ''])
    expect(splitUnit('和')).toEqual(['和', ''])
  })

  it('单位不能把整个答案吃掉（答案就是「米」时不算漏单位）', () => {
    expect(splitUnit('米')).toEqual(['米', ''])
  })
})

describe('isEditDistanceOne', () => {
  it('漏一个字母 / 多一个字母 / 错一个字母', () => {
    expect(isEditDistanceOne('aplle', 'apple')).toBe(true)
    expect(isEditDistanceOne('aple', 'apple')).toBe(true)
    expect(isEditDistanceOne('appple', 'apple')).toBe(true)
  })

  it('完全相同 → false（不是"差一个"）', () => {
    expect(isEditDistanceOne('apple', 'apple')).toBe(false)
  })

  it('差两个以上 → false', () => {
    expect(isEditDistanceOne('aplle', 'orange')).toBe(false)
    expect(isEditDistanceOne('app', 'apple')).toBe(false)
  })
})

describe('suggestCause · 空作答', () => {
  it('没写就交 → 粗心（有明确证据）', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: '42', userAnswer: '' })
    expect(s?.cause).toBe('careless')
    expect(s?.signal).toBe('empty')
  })

  it('只有空白 / 标点也算没写', () => {
    expect(suggestCause({ type: 'blank', correctAnswer: '42', userAnswer: '  ' })?.signal).toBe('empty')
    expect(suggestCause({ type: 'blank', correctAnswer: '42', userAnswer: '，' })?.signal).toBe('empty')
  })
})

describe('suggestCause · 漏单位', () => {
  it('答案 15174克，孩子写 15174 → 粗心（漏单位），证据里带单位', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: '15174克', userAnswer: '15174' })
    expect(s?.cause).toBe('careless')
    expect(s?.signal).toBe('unit-missing')
    expect(s?.evidence).toContain('克')
  })

  it('数值不对时不算漏单位（那是算错了）', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: '15174克', userAnswer: '15000' })
    expect(s?.signal).not.toBe('unit-missing')
  })

  it('孩子写了别的单位 → 不算漏单位', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: '5米', userAnswer: '5厘米' })
    expect(s?.signal).not.toBe('unit-missing')
  })
})

describe('suggestCause · 数字错位', () => {
  it('48 写成 4.8 → 位数错', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: '48', userAnswer: '4.8' })
    expect(s?.signal).toBe('numeric-shift')
    expect(s?.cause).toBe('careless')
  })

  it('15174 写成 15147 → 只错一个数字', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: '15174', userAnswer: '15147' })
    expect(s?.signal).toBe('numeric-shift')
  })

  it('完全不同的数（48 vs 156）→ 不猜', () => {
    expect(suggestCause({ type: 'blank', correctAnswer: '48', userAnswer: '156' })).toBeNull()
  })
})

describe('suggestCause · 顺序颠倒', () => {
  it('「和,加数」写成「加数,和」→ 粗心', () => {
    const s = suggestCause({
      type: 'blank',
      correctAnswer: ['和', '加数'],
      userAnswer: '加数,和',
    })
    // 多空数组会先走"部分正确"判定（2 个空都命中），不应误报为顺序问题
    expect(s?.cause === 'careless' || s?.cause === 'knowledge').toBe(true)
  })

  it('单空答案字符集合相同但顺序不同 → 顺序颠倒', () => {
    const s = suggestCause({ type: 'blank', correctAnswer: 'abc', userAnswer: 'cba' })
    expect(s?.signal).toBe('order-swap')
  })
})

describe('suggestCause · 多空部分正确', () => {
  it('3 个空对 2 个 → 知识盲区（有明确证据：只对了一部分）', () => {
    const s = suggestCause({
      type: 'blank',
      correctAnswer: ['和', '加数', '减数'],
      userAnswer: '和,加数,被减数',
    })
    expect(s?.cause).toBe('knowledge')
    expect(s?.signal).toBe('partial')
    expect(s?.evidence).toContain('3 个空对了 2 个')
  })

  it('一个空都没对 → 不走"部分正确"，也不猜', () => {
    expect(
      suggestCause({ type: 'blank', correctAnswer: ['和', '加数'], userAnswer: '甲乙,丙丁' }),
    ).toBeNull()
  })
})

describe('suggestCause · 英文拼写', () => {
  it('aplle vs apple → 拼写差一个字母', () => {
    const s = suggestCause({ type: 'spelling', correctAnswer: 'apple', userAnswer: 'aplle' })
    expect(s?.signal).toBe('spelling')
  })

  it('完全不同的单词 → 不猜（那是没记住，属于知识盲区，但无证据不标）', () => {
    expect(suggestCause({ type: 'spelling', correctAnswer: 'apple', userAnswer: 'banana' })).toBeNull()
  })
})

describe('suggestCause · 选择/判断不出建议', () => {
  it('判断题选错 → null（看不出是没懂还是看错）', () => {
    expect(suggestCause({ type: 'judge', correctAnswer: '对', userAnswer: '错' })).toBeNull()
  })

  it('选择题选错 → null', () => {
    expect(suggestCause({ type: 'single', correctAnswer: 'A', userAnswer: 'C' })).toBeNull()
  })
})

describe('suggestCause · 不该建议的情况', () => {
  it('作答与标准答案等价（只差空格/标点）→ 不归因（那是判分口径问题）', () => {
    expect(suggestCause({ type: 'blank', correctAnswer: '48, 60', userAnswer: '48，60' })).toBeNull()
  })

  it('没有标准答案 → null', () => {
    expect(suggestCause({ type: 'blank', correctAnswer: undefined, userAnswer: '42' })).toBeNull()
  })
})
