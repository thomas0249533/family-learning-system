import { describe, expect, it } from 'vitest'
import { gradeToPreset, inferPreset, type GradeSource } from '../src/core/theme/presetInference'

describe('gradeToPreset — 年级 → 学段', () => {
  it('≤6 → 小学 primary', () => {
    expect(gradeToPreset(1)).toBe('primary')
    expect(gradeToPreset(4)).toBe('primary')
    expect(gradeToPreset(6)).toBe('primary')
  })

  it('7-9 → 初中 junior', () => {
    expect(gradeToPreset(7)).toBe('junior')
    expect(gradeToPreset(8)).toBe('junior')
    expect(gradeToPreset(9)).toBe('junior')
  })

  it('≥10 → 高中 senior', () => {
    expect(gradeToPreset(10)).toBe('senior')
    expect(gradeToPreset(12)).toBe('senior')
  })
})

describe('inferPreset — 众数 / 并列 / 兜底', () => {
  it('空数组 → 默认初中 + usedFallback', () => {
    expect(inferPreset([])).toEqual({ preset: 'junior', grade: null, usedFallback: true })
  })

  it('非法/缺 grade 的来源被过滤 → 等价空数组', () => {
    const bad = [
      { grade: Number.NaN } as GradeSource,
      {} as GradeSource,
    ]
    expect(inferPreset(bad)).toEqual({ preset: 'junior', grade: null, usedFallback: true })
  })

  it('单一来源 → 对应学段', () => {
    expect(inferPreset([{ grade: 4 }])).toEqual({ preset: 'primary', grade: 4, usedFallback: false })
    expect(inferPreset([{ grade: 8 }])).toEqual({ preset: 'junior', grade: 8, usedFallback: false })
    expect(inferPreset([{ grade: 11 }])).toEqual({ preset: 'senior', grade: 11, usedFallback: false })
  })

  it('取众数：出现次数最多的年级胜出', () => {
    const sources: GradeSource[] = [
      { grade: 4 }, { grade: 4 }, { grade: 8 },
    ]
    expect(inferPreset(sources).grade).toBe(4)
    expect(inferPreset(sources).preset).toBe('primary')
  })

  it('众数跨学段：多数 7 年级 → 初中（即使另有小学/高中包）', () => {
    const sources: GradeSource[] = [
      { grade: 3 }, { grade: 7 }, { grade: 7 }, { grade: 7 }, { grade: 11 },
    ]
    expect(inferPreset(sources)).toEqual({ preset: 'junior', grade: 7, usedFallback: false })
  })

  it('并列 → 取 updatedAt 最新的年级', () => {
    const sources: GradeSource[] = [
      { grade: 4, updatedAt: '2024-01-01T00:00:00.000Z' },
      { grade: 10, updatedAt: '2025-06-01T00:00:00.000Z' },
    ]
    expect(inferPreset(sources)).toEqual({ preset: 'senior', grade: 10, usedFallback: false })
  })

  it('并列且只有 createdAt → 用 createdAt 比较', () => {
    const sources: GradeSource[] = [
      { grade: 9, createdAt: '2023-01-01T00:00:00.000Z' },
      { grade: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    expect(inferPreset(sources)).toEqual({ preset: 'primary', grade: 2, usedFallback: false })
  })

  it('并列且时间都缺失 → 仍返回合法结果（取首个）', () => {
    const sources: GradeSource[] = [{ grade: 5 }, { grade: 12 }]
    const r = inferPreset(sources)
    expect([5, 12]).toContain(r.grade)
    expect(r.usedFallback).toBe(false)
    expect(r.preset).toBe(r.grade === 5 ? 'primary' : 'senior')
  })

  it('updatedAt 优先级高于 createdAt', () => {
    const sources: GradeSource[] = [
      { grade: 4, updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2030-01-01T00:00:00.000Z' },
      { grade: 10, updatedAt: '2025-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' },
    ]
    expect(inferPreset(sources).grade).toBe(10)
  })
})
