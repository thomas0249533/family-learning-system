// =====================================================================
// 阅读理解「划线辅助」纯函数层单测（V1.6 · Stage D · D4）
// ---------------------------------------------------------------------
// 只测 `src/core/reading/ink.ts`：这一层刻意做成零 DOM 依赖，
// 所以能在 node 环境（本仓无 jsdom）下跑完整覆盖；组件层的几何逻辑
// 全部下沉到这里，Vue 组件里只剩"事件 → 调用纯函数"的胶水。
//
// 重点不在"happy path"，而在**脏数据**：痕迹存在 sessionStorage 里，
// 可能是旧版本写的、被别的标签页截断的、手改的。反序列化一旦抛异常，
// 整篇课文（渲染在 setup 里）就白屏 —— 这是本模块最不能接受的失败模式。
// =====================================================================

import { describe, expect, it } from 'vitest'
import {
  INK_MAX_POINTS,
  INK_STORAGE_PREFIX,
  deserializeStrokes,
  hitTestStroke,
  inkStorageKey,
  serializeStrokes,
  toNormalized,
  toPathD,
} from '@core/reading/ink'
import type { InkStroke } from '@core/reading/ink'

/** 数一条 path 里有多少个指令（M/L），等于采样点数 */
function countCommands(d: string): number {
  return (d.match(/[ML]/g) ?? []).length
}

/** 造一条两点直线 stroke（0,0 → 1,1） */
function lineStroke(overrides: Partial<InkStroke> = {}): InkStroke {
  return {
    color: 'warning',
    width: 3,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    ...overrides,
  }
}

describe('toNormalized · 像素坐标 → 归一化', () => {
  it('容器 100×200、点在 (50,100) → (0.5,0.5)', () => {
    const p = toNormalized(50, 100, { left: 0, top: 0, width: 100, height: 200 })
    expect(p.x).toBeCloseTo(0.5, 10)
    expect(p.y).toBeCloseTo(0.5, 10)
  })

  it('容器有偏移时按 (client - left) / width 换算', () => {
    const p = toNormalized(60, 120, { left: 10, top: 20, width: 100, height: 200 })
    expect(p.x).toBeCloseTo(0.5, 10)
    expect(p.y).toBeCloseTo(0.5, 10)
  })

  it('点在容器左上方之外 → clamp 到 0', () => {
    const p = toNormalized(-10, -30, { left: 0, top: 0, width: 100, height: 200 })
    expect(p).toEqual({ x: 0, y: 0 })
  })

  it('点在容器右下方之外 → clamp 到 1（拖出容器不留残影）', () => {
    const p = toNormalized(150, 300, { left: 0, top: 0, width: 100, height: 200 })
    expect(p).toEqual({ x: 1, y: 1 })
  })

  it('宽为 0（还没布局）时不产生 NaN / Infinity', () => {
    const p = toNormalized(50, 100, { left: 0, top: 0, width: 0, height: 200 })
    expect(Number.isFinite(p.x)).toBe(true)
    expect(p.x).toBe(0)
    expect(p.y).toBeCloseTo(0.5, 10)
  })

  it('高为 0 时 y 返回 0 且仍是有限数', () => {
    const p = toNormalized(50, 100, { left: 0, top: 0, width: 100, height: 0 })
    expect(p.y).toBe(0)
    expect(Number.isFinite(p.y)).toBe(true)
  })

  it('rect 字段是 NaN（布局未完成）时不产生 NaN', () => {
    const p = toNormalized(10, 10, { left: Number.NaN, top: 0, width: Number.NaN, height: 100 })
    expect(p.x).toBe(0)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(p.y).toBeCloseTo(0.1, 10)
  })
})

describe('toPathD · 生成 SVG path', () => {
  it('0 个点 → 空串', () => {
    expect(toPathD([])).toBe('')
  })

  it('1 个点 → 空串（单点画不出线）', () => {
    expect(toPathD([{ x: 0.5, y: 0.5 }])).toBe('')
  })

  it('2 个点 → 以 M 开头且含 L', () => {
    const d = toPathD([
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ])
    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain('L')
    expect(countCommands(d)).toBe(2)
  })

  it('首点坐标写进 M 指令', () => {
    const d = toPathD([
      { x: 0.1234, y: 0.5678 },
      { x: 1, y: 1 },
    ])
    expect(d.startsWith('M0.1234 0.5678')).toBe(true)
  })

  it('点数超过阈值时抽稀，且点数 ≤ 阈值', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i / 999, y: i / 999 }))
    const d = toPathD(points, 100)
    expect(countCommands(d)).toBeLessThanOrEqual(100)
    // 抽稀不能把曲线压成一段直线：点数仍应远多于 2
    expect(countCommands(d)).toBeGreaterThan(50)
  })

  it('抽稀保留首尾点（否则笔画会缩水、末笔消失）', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i / 999, y: 0.5 }))
    const d = toPathD(points, 120)
    expect(d.startsWith('M0 0.5')).toBe(true)
    expect(d.endsWith('L1 0.5')).toBe(true)
  })

  it('默认阈值为 INK_MAX_POINTS', () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({ x: (i % 100) / 100, y: 0.5 }))
    const d = toPathD(points)
    expect(countCommands(d)).toBeLessThanOrEqual(INK_MAX_POINTS)
  })

  it('阈值 <= 1 时退化成两点直线，仍合法', () => {
    const points = Array.from({ length: 50 }, (_, i) => ({ x: i / 49, y: 0 }))
    const d = toPathD(points, 1)
    expect(countCommands(d)).toBe(2)
    expect(d.startsWith('M')).toBe(true)
  })

  it('脏坐标不会写出 NaN / Infinity 到 d 里', () => {
    const d = toPathD([
      { x: Number.NaN, y: 0.2 },
      { x: 0.5, y: Number.POSITIVE_INFINITY },
    ])
    expect(d).not.toContain('NaN')
    expect(d).not.toContain('Infinity')
    expect(d.startsWith('M')).toBe(true)
  })
})

describe('hitTestStroke · 橡皮命中', () => {
  const diagonal = lineStroke()

  it('线上的点命中', () => {
    expect(hitTestStroke(diagonal, { x: 0.5, y: 0.5 }, 0.02)).toBe(true)
  })

  it('远离线的点不命中', () => {
    expect(hitTestStroke(diagonal, { x: 0.9, y: 0.1 }, 0.02)).toBe(false)
  })

  it('端点本身命中（不是"整条无限直线都算命中"）', () => {
    expect(hitTestStroke(diagonal, { x: 1, y: 1 }, 0)).toBe(true)
  })

  it('线段延长线上、端点之外 → 不命中（投影参数被夹到 [0,1]）', () => {
    const shortSegment = lineStroke({
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
      ],
    })
    expect(hitTestStroke(shortSegment, { x: 0.9, y: 0.9 }, 0.05)).toBe(false)
  })

  it('0 个点的退化 stroke 不抛异常且不命中', () => {
    expect(() => hitTestStroke(lineStroke({ points: [] }), { x: 0.5, y: 0.5 }, 0.1)).not.toThrow()
    expect(hitTestStroke(lineStroke({ points: [] }), { x: 0.5, y: 0.5 }, 0.1)).toBe(false)
  })

  it('1 个点的 stroke 按"点"比距离', () => {
    const dot = lineStroke({ points: [{ x: 0.5, y: 0.5 }] })
    expect(hitTestStroke(dot, { x: 0.5, y: 0.5 }, 0.01)).toBe(true)
    expect(hitTestStroke(dot, { x: 0.9, y: 0.9 }, 0.01)).toBe(false)
  })

  it('半径为 0 时只有精确落点命中（不抛异常）', () => {
    const horizontal = lineStroke({
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    })
    expect(hitTestStroke(horizontal, { x: 0.3, y: 0.5 }, 0)).toBe(true)
    expect(hitTestStroke(horizontal, { x: 0.3, y: 0.6 }, 0)).toBe(false)
  })

  it('脏点（NaN / Infinity）不抛异常', () => {
    const dirty = lineStroke({
      points: [
        { x: Number.NaN, y: 0 },
        { x: 0.5, y: Number.POSITIVE_INFINITY },
      ],
    })
    expect(() => hitTestStroke(dirty, { x: 0.5, y: 0.5 }, 0.1)).not.toThrow()
    expect(hitTestStroke(dirty, { x: 0.5, y: 0.5 }, 0.1)).toBe(false)
  })

  it('目标点是脏数据时返回 false（不抛）', () => {
    expect(hitTestStroke(diagonal, { x: Number.NaN, y: 0 }, 0.1)).toBe(false)
  })
})

describe('deserializeStrokes · 脏数据零抛异常', () => {
  it('null / undefined / 空串 → []', () => {
    expect(deserializeStrokes(null)).toEqual([])
    expect(deserializeStrokes(undefined)).toEqual([])
    expect(deserializeStrokes('')).toEqual([])
    expect(deserializeStrokes('   ')).toEqual([])
  })

  it('非 JSON 文本 → []（不抛）', () => {
    expect(deserializeStrokes('not json')).toEqual([])
    expect(deserializeStrokes('{"a":1')).toEqual([])
  })

  it('JSON 但不是数组（对象 / 数字 / 字符串）→ []', () => {
    expect(deserializeStrokes('{}')).toEqual([])
    expect(deserializeStrokes('42')).toEqual([])
    expect(deserializeStrokes('"abc"')).toEqual([])
    expect(deserializeStrokes('null')).toEqual([])
  })

  it('空数组 → []', () => {
    expect(deserializeStrokes('[]')).toEqual([])
  })

  it("'[{bad}]' 之类的坏条目被整条丢弃", () => {
    expect(deserializeStrokes('[{"color":"warning"}]')).toEqual([])
    expect(deserializeStrokes('[{"points":[{"x":0,"y":0}]}]')).toEqual([])
    expect(deserializeStrokes('[{"color":"blue","width":3,"points":[{"x":0,"y":0}]}]')).toEqual([])
  })

  it('坐标 Infinity（JSON 里的 1e999）→ 丢弃该条', () => {
    const raw = '[{"color":"warning","width":3,"points":[{"x":1e999,"y":0},{"x":0.5,"y":0.5}]}]'
    expect(deserializeStrokes(raw)).toEqual([])
  })

  it('坐标是 NaN（JSON.stringify 会把 NaN 变成 null）→ 丢弃该条', () => {
    const bogus = JSON.stringify([
      { color: 'warning', width: 3, points: [{ x: Number.NaN, y: 0 }, { x: 0.5, y: 0.5 }] },
    ])
    expect(deserializeStrokes(bogus)).toEqual([])
  })

  it('坐标 > 1 或 < 0 → 丢弃该条（越界说明坐标系变了）', () => {
    const tooBig = '[{"color":"warning","width":3,"points":[{"x":0,"y":0},{"x":1.5,"y":0.5}]}]'
    const tooSmall = '[{"color":"warning","width":3,"points":[{"x":-0.2,"y":0},{"x":0.5,"y":0.5}]}]'
    expect(deserializeStrokes(tooBig)).toEqual([])
    expect(deserializeStrokes(tooSmall)).toEqual([])
  })

  it('width 非法（0 / 负数 / 过大）→ 丢弃该条', () => {
    const mk = (width: number) =>
      `[{"color":"warning","width":${width},"points":[{"x":0,"y":0},{"x":1,"y":1}]}]`
    expect(deserializeStrokes(mk(0))).toEqual([])
    expect(deserializeStrokes(mk(-3))).toEqual([])
    expect(deserializeStrokes(mk(999))).toEqual([])
  })

  it('points 为空数组 → 丢弃该条', () => {
    expect(deserializeStrokes('[{"color":"warning","width":3,"points":[]}]')).toEqual([])
  })

  it('好坏混在一起 → 只保留好的那几条', () => {
    const raw = JSON.stringify([
      { color: 'warning', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { color: 'nope', width: 3, points: [{ x: 0, y: 0 }] },
      { color: 'danger', width: 2, points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] },
      { oops: true },
    ])
    const result = deserializeStrokes(raw)
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.color)).toEqual(['warning', 'danger'])
  })

  it('微小的浮点越界（-1e-12）被容忍并夹回 0，而不是整条丢弃', () => {
    const raw = '[{"color":"success","width":3,"points":[{"x":-1e-12,"y":0},{"x":1,"y":1}]}]'
    const result = deserializeStrokes(raw)
    expect(result).toHaveLength(1)
    expect(result[0].points[0].x).toBe(0)
  })
})

describe('serializeStrokes · 往返一致', () => {
  it('空数组 → "[]"', () => {
    expect(serializeStrokes([])).toBe('[]')
  })

  it('serialize → deserialize 等值（含三种颜色）', () => {
    const strokes: InkStroke[] = [
      { color: 'warning', width: 3, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }] },
      { color: 'danger', width: 4, points: [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }] },
      { color: 'success', width: 2, points: [{ x: 0.33, y: 0.66 }, { x: 0.34, y: 0.67 }] },
    ]
    expect(deserializeStrokes(serializeStrokes(strokes))).toEqual(strokes)
  })

  it('坐标写到 4 位小数（不把 0.3333333… 全塞进 storage）', () => {
    const raw = serializeStrokes([
      { color: 'primary', width: 3, points: [{ x: 1 / 3, y: 2 / 3 }, { x: 1, y: 0 }] },
    ])
    expect(raw).toContain('0.3333')
    expect(raw).not.toContain('0.3333333')
  })

  it('序列化时顺手丢掉坏条目（写进去的一定是干净的）', () => {
    const dirty = [
      { color: 'warning', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { color: 'warning', width: 3, points: [] },
      { color: 'purple', width: 3, points: [{ x: 0, y: 0 }] },
    ] as unknown as InkStroke[]
    expect(JSON.parse(serializeStrokes(dirty))).toHaveLength(1)
  })
})

describe('inkStorageKey · 按档案隔离', () => {
  it('键里同时含 profileId 与 docKey，并带 fls:ink 前缀', () => {
    const key = inkStorageKey('p1', 'pkg-a:topic-1')
    expect(key.startsWith(`${INK_STORAGE_PREFIX}:`)).toBe(true)
    expect(key).toContain('p1')
    expect(key).toContain('pkg-a:topic-1')
    expect(key).toBe('fls:ink:p1:pkg-a:topic-1')
  })

  it('两个不同档案的键不相等（否则老二会看到老大画的花）', () => {
    expect(inkStorageKey('p1', 'pkg-a:topic-1')).not.toBe(inkStorageKey('p2', 'pkg-a:topic-1'))
  })

  it('同一档案的不同课文 → 键不同', () => {
    expect(inkStorageKey('p1', 'pkg-a:topic-1')).not.toBe(inkStorageKey('p1', 'pkg-a:topic-2'))
  })

  it('空档案 / 空文档有兜底，且不会拼出 "::" 这种模糊键', () => {
    const key = inkStorageKey('', '')
    expect(key).toBe('fls:ink:default:unknown')
    expect(key).not.toContain('::')
  })
})
