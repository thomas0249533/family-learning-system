import { describe, expect, it } from 'vitest'
import {
  EMPTY_CELL,
  cellAriaLabel,
  cellCharsOf,
  cellCountOf,
  cellPinyinOf,
  countPoints,
  countStrokes,
  deserializeCell,
  inkPromptOf,
  isCellEmpty,
  isEmptyCells,
  normalizeCell,
  normalizeCells,
  serializeCell,
} from '@core/handwriting/pad'
import { serializeStrokes, type InkStroke } from '@core/reading/ink'

/**
 * 手写板的纯逻辑（P1 · 2026-xx）：格数 / 空判定 / 序列化。
 *
 * 这一轮 e2e 不做，所以这里要覆盖的是"组件里不许再写一遍"的判据 ——
 * 每个用例都对着一个真实会出错的场景，不是为覆盖率凑数。
 */

function stroke(points: Array<[number, number]>): InkStroke {
  return {
    color: 'primary',
    width: 6,
    points: points.map(([x, y]) => ({ x, y })),
  }
}

describe('cellCountOf —— 该写几格', () => {
  it('按字数给格：两个字两个格', () => {
    expect(cellCountOf('奇观')).toBe(2)
    expect(cellCountOf('人山人海')).toBe(4)
  })

  it('空答案至少给 1 格（0 格会被当成"没加载出来"）', () => {
    expect(cellCountOf('')).toBe(1)
    expect(cellCountOf('   ')).toBe(1)
    expect(cellCountOf(null as unknown as string)).toBe(1)
  })

  it('代理对只算一个字（用 length 会多切一格）', () => {
    // 𠮷 是扩展 B 区汉字，.length === 2
    expect(Array.from('𠮷').length).toBe(1)
    expect(cellCountOf('𠮷昌')).toBe(2)
  })

  it('去首尾空白：首尾空格不额外占一格', () => {
    expect(cellCountOf(' 奇观 ')).toBe(2)
  })
})

describe('cellCharsOf —— 逐格的字', () => {
  it('与格数严格同长', () => {
    const chars = cellCharsOf('奇观')
    expect(chars).toHaveLength(2)
    expect(chars).toEqual(['奇', '观'])
  })

  it('空答案给一个空串占位，不返回空数组', () => {
    expect(cellCharsOf('')).toEqual([''])
  })
})

describe('normalizeCell / normalizeCells —— 脏输入不白屏', () => {
  it('空串 / null / 非字符串一律退成空态', () => {
    expect(normalizeCell('')).toBe(EMPTY_CELL)
    expect(normalizeCell(null)).toBe(EMPTY_CELL)
    expect(normalizeCell(42)).toBe(EMPTY_CELL)
  })

  it('坏 JSON 退成空态而不是抛', () => {
    expect(normalizeCell('not json')).toBe(EMPTY_CELL)
    expect(normalizeCell('{}')).toBe(EMPTY_CELL)
  })

  it('合法串原样保留（过一遍反序列化再序列化是幂等的）', () => {
    const raw = serializeStrokes([stroke([[0.1, 0.2], [0.3, 0.4]])])
    expect(normalizeCell(raw)).toBe(raw)
  })

  it('长度按期望格数对齐：多的截掉、少的补空', () => {
    const one = serializeStrokes([stroke([[0.1, 0.1], [0.2, 0.2]])])
    expect(normalizeCells([one], 3)).toEqual([one, EMPTY_CELL, EMPTY_CELL])
    expect(normalizeCells([one, one, one], 2)).toEqual([one, one])
  })

  it('格数非法时退成 1 格', () => {
    expect(normalizeCells(undefined, 0)).toEqual([EMPTY_CELL])
    expect(normalizeCells([], Number.NaN)).toEqual([EMPTY_CELL])
  })
})

describe('isEmptyCells / isCellEmpty —— 提交按钮的 disabled 判据', () => {
  it('全空 → true（含"还没初始化"）', () => {
    expect(isEmptyCells(undefined)).toBe(true)
    expect(isEmptyCells([])).toBe(true)
    expect(isEmptyCells([EMPTY_CELL, EMPTY_CELL])).toBe(true)
  })

  it('任意一格有笔迹 → false', () => {
    const one = serializeStrokes([stroke([[0.5, 0.5], [0.6, 0.6]])])
    expect(isEmptyCells([EMPTY_CELL, one])).toBe(false)
    expect(isCellEmpty(one)).toBe(false)
  })

  it("空串与 '[]' 是同一种空（两种写法都要认）", () => {
    expect(isCellEmpty('')).toBe(true)
    expect(isCellEmpty('[]')).toBe(true)
  })
})

describe('serializeCell / deserializeCell —— 一格的往返', () => {
  it('有笔迹时给出可反序列化的串', () => {
    const raw = serializeCell([stroke([[0.25, 0.25], [0.75, 0.75]])])
    const back = deserializeCell(raw)
    expect(back).toHaveLength(1)
    expect(back[0].points).toHaveLength(2)
  })

  it('空数组 → 空态常量（不是空字符串，避免两套空值）', () => {
    expect(serializeCell([])).toBe(EMPTY_CELL)
    expect(serializeCell(null)).toBe(EMPTY_CELL)
  })

  it('单点笔迹也保留（手指点一下就会产生 1 点笔迹）', () => {
    const raw = serializeCell([stroke([[0.4, 0.4]])])
    expect(deserializeCell(raw)[0].points).toHaveLength(1)
  })

  it('反序列化脏串不抛', () => {
    expect(deserializeCell('garbage')).toEqual([])
    expect(deserializeCell(undefined)).toEqual([])
  })
})

describe('countStrokes / countPoints —— 管理信息，不参与判分', () => {
  it('跨格累加', () => {
    const a = serializeCell([stroke([[0.1, 0.1], [0.2, 0.2]]), stroke([[0.3, 0.3], [0.4, 0.4]])])
    const b = serializeCell([stroke([[0.5, 0.5], [0.6, 0.6]])])
    expect(countStrokes([a, b])).toBe(3)
    expect(countPoints([a, b])).toBe(6)
  })

  it('空 / 非法输入给 0', () => {
    expect(countStrokes(null)).toBe(0)
    expect(countPoints([])).toBe(0)
    expect(countStrokes(['garbage', EMPTY_CELL])).toBe(0)
  })
})

describe('cellAriaLabel —— 读屏要能说清"第几格、写了没有"', () => {
  it('有笔迹时带笔数', () => {
    expect(cellAriaLabel(1, 4, 2)).toBe('第 2 格，共 4 格，已写 2 笔')
  })

  it('没写时明说还没写（不要让读屏只念"第 2 格"）', () => {
    expect(cellAriaLabel(0, 1, 0)).toBe('第 1 格，共 1 格，还没写')
  })
})

describe('cellPinyinOf —— 逐格拼音只在音节数对得上时才分', () => {
  it('两字词两段拼音：格子里各挂各的', () => {
    expect(cellPinyinOf('qí guān', 2)).toEqual(['qí', 'guān'])
  })

  it('四字成语四段', () => {
    expect(cellPinyinOf('rén shān rén hǎi', 4)).toEqual(['rén', 'shān', 'rén', 'hǎi'])
  })

  it('音节数与字数不等 → 一格都不挂（宁缺勿错）', () => {
    expect(cellPinyinOf("nǚ'ér", 2)).toEqual(['', ''])
    expect(cellPinyinOf('qí guān', 3)).toEqual(['', '', ''])
  })

  it('没有拼音也不崩', () => {
    expect(cellPinyinOf(undefined, 2)).toEqual(['', ''])
  })
})

describe('inkPromptOf —— 批改页的题干快照', () => {  it('有拼音：题面是拼音 + 字数，不含答案', () => {
    const text = inkPromptOf('qí guān', '奇观')
    expect(text).toBe('看拼音写词语：qí guān（2 个字）')
    expect(text).not.toContain('奇观')
  })

  it('无拼音：退回字数提示', () => {
    expect(inkPromptOf('', '奇观')).toBe('手写作答（2 个字）')
  })

  it('空答案也不崩，且不出现「手写作答（手写作答）」这种套娃', () => {
    expect(inkPromptOf(undefined, '')).toBe('手写作答')
  })
})
