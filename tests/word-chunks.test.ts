/**
 * V3.1.7 · 拼字块与纸笔自评判分（纯函数回归）
 *
 * 钉死三件事：
 *   1. 拼字块拼接后必须还原原词（脏数据不能进入练习，否则孩子拼对了被判错）；
 *   2. 干扰块不能改变"正确块仍可依次选出"这一事实（数量与去重规则）；
 *   3. 纸笔自评只认显式 'correct'，空值/未评价一律判错（不臆测手写内容）。
 */
import { describe, expect, it } from 'vitest'
import {
  chunksOf,
  isValidChunks,
  chunksEqual,
  buildChunkChoices,
  joinedChunks,
  gradeSelfAssessed,
} from '@core/quiz/wordChunks'

const deterministic = () => 0.42

describe('isValidChunks（结构合法；汉字偏旁不要求拼接还原）', () => {
  it('合法：≥2 块、非空 —— 偏旁拆「河」为 氵/可 是允许的', () => {
    expect(isValidChunks(['氵', '可'])).toBe(true)
    expect(isValidChunks(['teach', 'er'])).toBe(true)
  })
  it('非法：单块 / 空块 / 过长块 / 非数组', () => {
    expect(isValidChunks(['河'])).toBe(false)
    expect(isValidChunks(['氵', ''])).toBe(false)
    expect(isValidChunks(['氵', 'x'.repeat(9)])).toBe(false)
    expect(isValidChunks(null)).toBe(false)
  })
})

describe('chunksEqual（判分按块序列，不按拼接字符串）', () => {
  it('汉字偏旁：选对 氵/可 即判对，尽管拼起来不是「河」', () => {
    expect(chunksEqual(['氵', '可'], ['氵', '可'])).toBe(true)
    expect(joinedChunks(['氵', '可'])).toBe('氵可') // 拼接只用于展示
  })
  it('顺序敏感、长度敏感', () => {
    expect(chunksEqual(['可', '氵'], ['氵', '可'])).toBe(false)
    expect(chunksEqual(['氵'], ['氵', '可'])).toBe(false)
    expect(chunksEqual(['build', 'ing'], ['build', 'ing'])).toBe(true)
  })
})

describe('chunksOf（预置数据优先 + 保底拆分）', () => {
  it('中文预置偏旁合法 → 直接用（不要求拼回原字）', () => {
    expect(chunksOf('河', 'chinese', ['氵', '可'])).toEqual(['氵', '可'])
    expect(chunksOf('奇观', 'chinese', ['大', '可', '又', '见'])).toEqual(['大', '可', '又', '见'])
  })
  it('中文无预置 → 按单字拆', () => {
    expect(chunksOf('奇观', 'chinese')).toEqual(['奇', '观'])
  })
  it('英文按常见后缀切，短词按半切', () => {
    expect(chunksOf('building', 'english')).toEqual(['build', 'ing'])
    expect(chunksOf('teacher', 'english')).toEqual(['teach', 'er'])
    const c = chunksOf('city', 'english')
    expect(c).not.toBeNull()
    expect(c!.join('')).toBe('city')
  })
  it('单字 / 空词 → null（UI 跳过，不硬凑）', () => {
    expect(chunksOf('山', 'chinese')).toBe(null)
    expect(chunksOf('', 'chinese')).toBe(null)
  })
  it('预置数据结构不合法 → 退回规则拆分而不是抛错', () => {
    // 结构合法但内容与词无关的预置（['错','的']）由内容生成脚本负责拦截，
    // 运行时无法判断偏旁是否属于某字（「氵」本就不是「河」的字符）。
    expect(chunksOf('奇观', 'chinese', ['错'])).toEqual(['奇', '观'])          // 单块
    expect(chunksOf('奇观', 'chinese', ['错', ''])).toEqual(['奇', '观'])      // 空块
    expect(chunksOf('奇观', 'chinese', 'not-an-array')).toEqual(['奇', '观'])  // 非数组
  })
})

describe('buildChunkChoices / joinedChunks', () => {
  it('候选块包含全部正确块 + 指定数量干扰块', () => {
    const correct = ['氵', '可']
    const pool = ['木', '每', '日', '青', '扌']
    const choices = buildChunkChoices(correct, pool, 3, deterministic)
    expect(choices).toHaveLength(5)
    // 正确块各出现一次（未被干扰块吃掉）
    expect(choices.filter(c => c === '氵')).toHaveLength(1)
    expect(choices.filter(c => c === '可')).toHaveLength(1)
  })
  it('干扰池为空时只返回正确块', () => {
    expect(buildChunkChoices(['又', '见'], [], 4, deterministic).sort()).toEqual(['又', '见'])
  })
  it('joinedChunks 按点选顺序拼接（仅用于展示，不参与判分）', () => {
    expect(joinedChunks(['氵', '可'])).toBe('氵可')
    expect(joinedChunks(['build', 'ing'])).toBe('building')
    expect(joinedChunks([])).toBe('')
  })
})

describe('gradeSelfAssessed（纸笔自评）', () => {
  it('只有显式 correct 判对', () => {
    expect(gradeSelfAssessed('correct')).toBe(true)
    expect(gradeSelfAssessed('wrong')).toBe(false)
    expect(gradeSelfAssessed(null)).toBe(false)
    expect(gradeSelfAssessed(undefined)).toBe(false)
  })
})
