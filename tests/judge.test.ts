import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  judgeToken, normalizeJudgeList, isMultiJudge, gradeJudge,
  judgeLabels, formatJudgeTokens, splitJudgeStatements,
} from '../src/core/quiz/judge'

describe('judgeToken · 值域归一化', () => {
  it('识别布尔与字符串真值', () => {
    expect(judgeToken(true)).toBe('对')
    expect(judgeToken('true')).toBe('对')
    expect(judgeToken('TRUE')).toBe('对')
    expect(judgeToken('对')).toBe('对')
    expect(judgeToken('正确')).toBe('对')
  })
  it('识别布尔与字符串假值', () => {
    expect(judgeToken(false)).toBe('错')
    expect(judgeToken('false')).toBe('错')
    expect(judgeToken('错')).toBe('错')
    expect(judgeToken('错误')).toBe('错')
  })
  it('T / F 大小写均可（内容里两种都出现过）', () => {
    expect(judgeToken('T')).toBe('对')
    expect(judgeToken('t')).toBe('对')
    expect(judgeToken('F')).toBe('错')
    expect(judgeToken('f')).toBe('错')
  })
  it('无法识别一律返回 null —— 旧实现在这里 String(a) 静默降级', () => {
    expect(judgeToken('abc')).toBeNull()
    expect(judgeToken('')).toBeNull()
    expect(judgeToken(null)).toBeNull()
    expect(judgeToken(undefined)).toBeNull()
    expect(judgeToken(0)).toBeNull()
    expect(judgeToken(['F', 'T'])).toBeNull()
  })
})

describe('normalizeJudgeList', () => {
  it('标量 → 长度 1', () => {
    expect(normalizeJudgeList('对')).toEqual(['对'])
    expect(normalizeJudgeList('F')).toEqual(['错'])
  })
  it('数组 → 逐元素归一化', () => {
    expect(normalizeJudgeList(['F', 'T', 'F', 'T'])).toEqual(['错', '对', '错', '对'])
  })
  it('数组内含非法值 → 丢弃该项（长度会缩短，判分自然失败）', () => {
    expect(normalizeJudgeList(['F', 'X'])).toEqual(['错'])
  })
  it('空/非法 → 空数组', () => {
    expect(normalizeJudgeList([])).toEqual([])
    expect(normalizeJudgeList('abc')).toEqual([])
  })
})

describe('isMultiJudge', () => {
  it('长度 >1 才是多陈述', () => {
    expect(isMultiJudge(['F', 'T', 'F', 'T'])).toBe(true)
    expect(isMultiJudge(['T'])).toBe(false)
    expect(isMultiJudge('对')).toBe(false)
  })
})

describe('gradeJudge · 判分', () => {
  it('多陈述全对 → 正确（修复前这里永远 false）', () => {
    expect(gradeJudge(['错', '对', '错', '对'], ['F', 'T', 'F', 'T'])).toBe(true)
  })
  it('多陈述全错 → 错误', () => {
    expect(gradeJudge(['对', '对', '对', '对'], ['F', 'T', 'F', 'T'])).toBe(false)
  })
  it('【钉死决策】部分答对也算错 —— 全或无，与 multiple 一致', () => {
    // 只错第 4 句，其余全对
    expect(gradeJudge(['错', '对', '错', '错'], ['F', 'T', 'F', 'T'])).toBe(false)
    // 只错第 1 句
    expect(gradeJudge(['对', '对', '错', '对'], ['F', 'T', 'F', 'T'])).toBe(false)
  })
  it('多陈述题收到标量作答 → 错误（长度不等）', () => {
    expect(gradeJudge('对', ['F', 'T', 'F', 'T'])).toBe(false)
  })
  it('多陈述题漏答（长度不足）→ 错误', () => {
    expect(gradeJudge(['错', '对'], ['F', 'T', 'F', 'T'])).toBe(false)
  })
  it('单陈述回归守卫（现有 134 道题走这条路径）', () => {
    expect(gradeJudge('对', '对')).toBe(true)
    expect(gradeJudge('错', '对')).toBe(false)
    expect(gradeJudge('T', 'T')).toBe(true)
    expect(gradeJudge('F', 'T')).toBe(false)
  })
  it('跨域等价：题答 T / 用户选 对 → 算对', () => {
    expect(gradeJudge('对', 'T')).toBe(true)
    expect(gradeJudge('错', 'F')).toBe(true)
  })
  it('正确答案为空 → 错误（不因空值误判为对）', () => {
    expect(gradeJudge('对', [])).toBe(false)
    expect(gradeJudge('对', 'abc')).toBe(false)
  })
})

describe('judgeLabels · 按钮文案由 options 驱动', () => {
  it('options 含 T/F → 显示 T / F', () => {
    expect(judgeLabels(['T', 'F'])).toEqual({ t: 'T', f: 'F' })
  })
  it('无 options → 显示 对 / 错', () => {
    expect(judgeLabels(undefined)).toEqual({ t: '对', f: '错' })
    expect(judgeLabels([])).toEqual({ t: '对', f: '错' })
  })
  it('options 是普通选项（如 A/B）→ 回退 对 / 错', () => {
    expect(judgeLabels(['A', 'B'])).toEqual({ t: '对', f: '错' })
  })
  it('只有 T 没有 F → 回退（防误判）', () => {
    expect(judgeLabels(['T', 'X'])).toEqual({ t: '对', f: '错' })
  })
})

describe('formatJudgeTokens', () => {
  it('按标签域渲染，空格分隔', () => {
    expect(formatJudgeTokens(['错', '对'], ['T', 'F'])).toBe('F T')
    expect(formatJudgeTokens(['错', '对'], undefined)).toBe('错 对')
  })
  it('单陈述', () => {
    expect(formatJudgeTokens(['对'], ['T', 'F'])).toBe('T')
  })
})

describe('splitJudgeStatements · 题干解析', () => {
  const LILY = [
    '阅读 Lily 的找笔友帖子，判断下列句子是否正确，正确写 T，错误写 F。',
    "Hi! I'm Lily. I'm 13 and I live in Toronto, Canada.",
    '(1) Lily is from China. (2) Lily likes drawing animals. (3) Lily wants a pen pal from Canada. (4) Coco is Lily\'s dog.',
  ].join('\n')

  it('正常切分：材料 + 4 条陈述，且剥离编号', () => {
    const r = splitJudgeStatements(LILY, 4)
    expect(r).not.toBeNull()
    expect(r!.statements).toHaveLength(4)
    expect(r!.statements[0]).toBe('Lily is from China.')
    expect(r!.statements[3]).toBe("Coco is Lily's dog.")
    expect(r!.material).toContain('阅读 Lily')
    expect(r!.material).not.toContain('(1)')
  })

  it('3 条陈述', () => {
    const q = '阅读社团广告，判断是否正确（T/F）。\n\nMusic Club: Join us!\n\n(1) A. (2) B. (3) C.'
    const r = splitJudgeStatements(q, 3)
    expect(r!.statements).toEqual(['A.', 'B.', 'C.'])
  })

  it('全角括号也能识别', () => {
    const r = splitJudgeStatements('材料。（1）甲。（2）乙。', 2)
    expect(r).not.toBeNull()
    expect(r!.statements).toEqual(['甲。', '乙。'])
  })

  it('【降级】标记少于 2 个 → null（单陈述题不该走解析）', () => {
    expect(splitJudgeStatements('只有一句(1) 甲。')).toBeNull()
    expect(splitJudgeStatements('完全没有编号。')).toBeNull()
  })

  it('【降级】编号不连续 → null', () => {
    expect(splitJudgeStatements('材料。(1) 甲。(3) 乙。', 2)).toBeNull()
  })

  it('【降级】编号数与答案长度不等 → null', () => {
    expect(splitJudgeStatements(LILY, 3)).toBeNull()
  })

  it('【降级】切出空句 → null', () => {
    expect(splitJudgeStatements('材料。(1) 甲。(2)', 2)).toBeNull()
  })

  it('空题干 → null', () => {
    expect(splitJudgeStatements('')).toBeNull()
    expect(splitJudgeStatements(null)).toBeNull()
  })
})

describe('真实内容回归 · english-7-up-rjb 的 18 道多陈述判断题', () => {
  const FILE = resolve(process.cwd(), 'content/english-7-up-rjb/sprint-english-7-up-final.json')

  function collectJudge(node: any, out: any[] = []) {
    if (Array.isArray(node)) {
      node.forEach((v) => collectJudge(v, out))
    } else if (node && typeof node === 'object') {
      if (node.type === 'judge' && 'answer' in node) out.push(node)
      Object.values(node).forEach((v) => collectJudge(v, out))
    }
    return out
  }

  const pkg = JSON.parse(readFileSync(FILE, 'utf-8'))
  const judges = collectJudge(pkg)
  const multi = judges.filter((q: any) => Array.isArray(q.answer))

  it('文件里确实存在多陈述判断题（否则本组测试形同虚设）', () => {
    expect(judges.length).toBeGreaterThan(0)
    expect(multi.length).toBeGreaterThan(0)
  })

  it('每一道都能按答案长度解析出等量的陈述句（不降级）', () => {
    for (const q of multi) {
      const tokens = normalizeJudgeList(q.answer)
      const r = splitJudgeStatements(q.question, tokens.length)
      expect(r, `题目 ${q.id} 解析失败`).not.toBeNull()
      expect(r!.statements).toHaveLength(tokens.length)
    }
  })

  it('每一道的标准答案都能被完整归一化（无非法值）', () => {
    for (const q of multi) {
      expect(normalizeJudgeList(q.answer), `题目 ${q.id} 含非法答案`).toHaveLength(q.answer.length)
    }
  })

  it('照标准答案作答 → 全部判对（修复前这里 100% 判错）', () => {
    for (const q of multi) {
      const asTokens = normalizeJudgeList(q.answer)
      expect(gradeJudge(asTokens, q.answer), `题目 ${q.id} 应判对`).toBe(true)
    }
  })
})
