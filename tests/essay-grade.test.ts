/**
 * 主观题（essay + 标为主观的填空/拼写）判分内核测试。
 *
 * 回归护栏目标：确保"按得分点覆盖度判分"的行为稳定，且：
 * - 空作答恒判错；
 * - 全覆盖 / 达标覆盖 → 判对；
 * - 覆盖不足 → 判错，并给出 missing 清单；
 * - 同义备选（`/`）命中即算覆盖；
 * - 整段语义相似度（换说法）回退 → 判对；
 * - 作者显式 keyPoints 优先于自动抽取。
 */
import { describe, it, expect } from 'vitest'
import { gradeEssay, extractKeyPoints, similarity } from '../src/core/quiz/essayGrade'

describe('extractKeyPoints', () => {
  it('作者显式 keyPoints 优先', () => {
    expect(extractKeyPoints('一段很长的参考答案', ['比喻', '拟人'])).toEqual(['比喻', '拟人'])
  })

  it('按句切分，过滤过短碎片', () => {
    const pts = extractKeyPoints('表达了思乡之情。运用了比喻手法。')
    expect(pts).toContain('表达了思乡之情')
    expect(pts).toContain('比喻')
  })

  it('句内含顿号/逗号再细分，并去前缀后缀露出关键词', () => {
    const pts = extractKeyPoints('使用了比喻、拟人、排比的修辞手法。')
    expect(pts).toEqual(['比喻', '拟人', '排比'])
  })

  it('去重（保留首次顺序）', () => {
    expect(extractKeyPoints('思乡。思乡。')).toEqual(['思乡'])
    expect(extractKeyPoints('思乡之情。思乡之情。')).toEqual(['思乡之情'])
  })

  it('空参考答案返回空数组', () => {
    expect(extractKeyPoints('')).toEqual([])
    expect(extractKeyPoints('   ')).toEqual([])
  })
})

describe('gradeEssay · 边界', () => {
  it('空作答判错', () => {
    const r = gradeEssay('', '表达了思乡之情')
    expect(r.correct).toBe(false)
    expect(r.covered).toBe(0)
  })

  it('无可用得分点（参考答案极短）走相似度回退', () => {
    const r = gradeEssay('思乡', '思乡')
    expect(r.correct).toBe(true)
  })
})

describe('gradeEssay · 覆盖度', () => {
  it('全覆盖 → 判对', () => {
    const ref = '表达了作者对故乡的思念。运用了比喻的修辞手法。'
    const ans = '本文表达了作者对故乡的思念，还运用了比喻的修辞手法。'
    const r = gradeEssay(ans, ref)
    expect(r.correct).toBe(true)
    expect(r.covered).toBe(r.total)
    expect(r.missing).toEqual([])
  })

  it('达标覆盖（≥0.6）→ 判对', () => {
    const ref = '要点一。要点二。要点三。'
    // 命中 2/3 = 0.67 ≥ 0.6
    const r = gradeEssay('要点一 要点二', ref)
    expect(r.correct).toBe(true)
    expect(r.covered).toBe(2)
    expect(r.total).toBe(3)
  })

  it('覆盖不足（<0.6）→ 判错并给出 missing', () => {
    const ref = '要点一。要点二。要点三。'
    const r = gradeEssay('要点一', ref)
    expect(r.correct).toBe(false)
    expect(r.covered).toBe(1)
    expect(r.missing).toEqual(['要点二', '要点三'])
  })

  it('同义备选（/）命中即算覆盖', () => {
    const r = gradeEssay('用了比拟', '使用了比喻/比拟的修辞', ['比喻/比拟'])
    expect(r.correct).toBe(true)
    expect(r.covered).toBe(1)
  })
})

describe('gradeEssay · 整段相似度回退（大体内容一致）', () => {
  it('近义改写（同义复述，字符高度重合）→ 判对', () => {
    const ref = '表达了作者对故乡的思念之情'
    const ans = '表达了作者对故乡深深的思念之情'
    const r = gradeEssay(ans, ref)
    expect(r.correct).toBe(true)
  })

  it('完全不相关 → 判错', () => {
    const ref = '表达了作者对故乡的思念之情'
    const ans = '今天天气真好适合出去玩'
    const r = gradeEssay(ans, ref)
    expect(r.correct).toBe(false)
  })
})

describe('gradeEssay · 显式 keyPoints', () => {
  it('用显式得分点判分，命中不足 → 判错', () => {
    const ref = '（很长一段参考答案文字）'
    // 只命中 1/3 个得分点，低于阈值 → 判错
    const r = gradeEssay('比喻', ref, ['比喻', '拟人', '排比'])
    expect(r.total).toBe(3)
    expect(r.covered).toBe(1)
    expect(r.correct).toBe(false)
    expect(r.missing).toEqual(['拟人', '排比'])
  })
})

describe('similarity', () => {
  it('相同返回 1', () => {
    expect(similarity('思乡之情', '思乡之情')).toBe(1)
  })
  it('空串返回 0', () => {
    expect(similarity('', 'abc')).toBe(0)
  })
  it('纯二元组 Jaccard（不含 includes 短路）', () => {
    // '思乡' 被 '深深的思乡之情' 包含，但不应返回 1（子串判定在 gradeEssay 另处处理）
    expect(similarity('思乡', '深深的思乡之情')).toBeGreaterThan(0)
    expect(similarity('思乡', '深深的思乡之情')).toBeLessThan(1)
  })
})
