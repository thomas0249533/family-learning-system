/**
 * C2 · 掌握度联合估计（computeMasteryScore）单测
 *
 * 覆盖主理人点名的场景：
 *   1. 无 FSRS 记录 → 纯 BKT 降级（pKnown*100）；
 *   2. 全错 / 全对两个真实场景的分数量级；
 *   3. 空 progress 行（无 BKT 无 FSRS）→ null，不编数；
 *   4. progress 有行但 FSRS 卡缺 stability / difficulty 字段 → 降级；
 *   5. 有 FSRS 的三个方向性（S 越大不降 / D 越大不增 / S 极大趋近 100·p·kD）；
 *   6. 边界与脏数据（NaN/Infinity/负数/越界概率/null 行）→ 收敛或 null，绝不抛异常；
 *   7. 输出域不变量（200 组随机畸形行 → 恒为 [0,100] 内的整数或 null）。
 *
 * 注意（PRD §11.5）：熟练度只供算法消费（C3 弱项推荐的筛选/排序），不进任何 UI，
 * 所以这里没有任何"平均熟练度"聚合用例 —— 聚合函数已随 UI 回退一并删除。
 */
import { describe, expect, it } from 'vitest'
import type { ProgressRecord } from '@/db'
import { computeMasteryScore } from '@core/mastery/masterySummary'
import { makeProgress } from './helpers/progressFixtures'

/** 手写确定性伪随机（xorshift32，不引依赖；种子固定则可复现） */
function xorshift32(seed: number): () => number {
  let x = seed >>> 0
  if (x === 0) x = 0x9e3779b9
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

const FSRS_DUE = '2026-10-01T00:00:00.000Z'

/** 造一行：默认只有 BKT（无 FSRS），按需覆盖 */
function row(spec: {
  id: number
  masteryProbability?: number
  bkt?: { pKnown: number; observed: number }
  fsrs?: { due: string; stability?: number; difficulty?: number }
}): ProgressRecord {
  return makeProgress({
    id: spec.id,
    packageId: 'pkg-1',
    knowledgePointId: 'kp-1',
    masteryProbability: spec.masteryProbability,
    bkt: spec.bkt,
    fsrs: spec.fsrs,
  })
}

describe('computeMasteryScore —— 无 FSRS 记录 → 纯 BKT 降级（pKnown*100）', () => {
  it('p=0.8 → 80', () => {
    expect(computeMasteryScore(row({ id: 1, masteryProbability: 0.8 }))).toBe(80)
  })

  it('p=0 → 0；p=1 → 100', () => {
    expect(computeMasteryScore(row({ id: 1, masteryProbability: 0 }))).toBe(0)
    expect(computeMasteryScore(row({ id: 2, masteryProbability: 1 }))).toBe(100)
  })

  it('masteryProbability 缺失时 fallback 到 bkt.pKnown*100（0.5 → 50）', () => {
    expect(computeMasteryScore(row({ id: 1, bkt: { pKnown: 0.5, observed: 3 } }))).toBe(50)
  })

  it('空 progress 行（没有任何 BKT/FSRS 字段）→ null（无法估计，不许编一个数）', () => {
    expect(computeMasteryScore(row({ id: 1 }))).toBeNull()
  })

  it('有 FSRS 卡但没有 BKT → null（没有 p 就无法联合估计）', () => {
    expect(
      computeMasteryScore(row({ id: 1, fsrs: { due: FSRS_DUE, stability: 30, difficulty: 5 } }))
    ).toBeNull()
  })
})

describe('computeMasteryScore —— 全错 / 全对两个真实场景', () => {
  it('全错：BKT 连续答错后 p≈0.2、stability 被遗忘压到 2 天、难度升到 8 → 1 分', () => {
    // 0.2 * kS(2) * kD(8) ≈ 0.2 * 0.0645 * 0.8056 ≈ 1.04 → 1
    expect(
      computeMasteryScore(
        row({ id: 1, bkt: { pKnown: 0.2, observed: 4 }, fsrs: { due: FSRS_DUE, stability: 2, difficulty: 8 } })
      )
    ).toBe(1)
  })

  it('全对：BKT 全对后 p≈0.99、stability 涨到 90 天、难度降到 1 → 94 分', () => {
    // 0.99 * kS(90) * kD(1) ≈ 0.99 * 0.9502 * 1 ≈ 94.07 → 94
    expect(
      computeMasteryScore(
        row({ id: 1, bkt: { pKnown: 0.99, observed: 12 }, fsrs: { due: FSRS_DUE, stability: 90, difficulty: 1 } })
      )
    ).toBe(94)
  })
})

describe('computeMasteryScore —— 有 FSRS 的联合估计', () => {
  it('方向性：p 固定时 S 越大分数不降', () => {
    const stabilities = [1, 3, 7, 30, 90, 365, 1000]
    const scores = stabilities.map((stability) =>
      computeMasteryScore(
        row({ id: 1, masteryProbability: 0.9, fsrs: { due: FSRS_DUE, stability, difficulty: 5 } })
      )
    )
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!)
    }
  })

  it('方向性：D 从 1 到 10 分数不增', () => {
    const scores: number[] = []
    for (let d = 1; d <= 10; d += 1) {
      const score = computeMasteryScore(
        row({ id: d, masteryProbability: 0.9, fsrs: { due: FSRS_DUE, stability: 30, difficulty: d } })
      )
      expect(score).not.toBeNull()
      scores.push(score!)
    }
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!)
    }
  })

  it('S 极大时分数趋近 100·p·kD（区间断言，不用浮点全等）', () => {
    // kS(1e6) = 1 - e^(-33333) 浮点下溢为 0 → kS = 1；期望 100 * 0.9 * kD(5) = 80
    const score = computeMasteryScore(
      row({ id: 1, masteryProbability: 0.9, fsrs: { due: FSRS_DUE, stability: 1e6, difficulty: 5 } })
    )
    expect(score).not.toBeNull()
    expect(score!).toBeGreaterThanOrEqual(79)
    expect(score!).toBeLessThanOrEqual(81)
  })

  it('关键点数值：p=0.8, S=30, D=5 → 45', () => {
    // kS = 1 - e^-1 ≈ 0.6321；kD = 1 - 0.25*4/9 ≈ 0.8889 → 44.95 → 45
    expect(
      computeMasteryScore(row({ id: 1, masteryProbability: 0.8, fsrs: { due: FSRS_DUE, stability: 30, difficulty: 5 } }))
    ).toBe(45)
  })

  it('关键点数值：p=1, S=30, D=1 → 63（"一个月还记得"算六成熟）', () => {
    expect(
      computeMasteryScore(row({ id: 1, masteryProbability: 1, fsrs: { due: FSRS_DUE, stability: 30, difficulty: 1 } }))
    ).toBe(63)
  })

  it('BKT 走 bkt.pKnown 时同样参与联合估计（p=0.5, S=30, D=1 → 32）', () => {
    expect(
      computeMasteryScore(
        row({ id: 1, bkt: { pKnown: 0.5, observed: 2 }, fsrs: { due: FSRS_DUE, stability: 30, difficulty: 1 } })
      )
    ).toBe(32)
  })
})

describe('computeMasteryScore —— 边界与脏数据降级（绝不抛异常）', () => {
  it('S=0 / S<0 / S=NaN / stability 字段缺失 → 视作无 FSRS，退回纯 BKT', () => {
    const base = { id: 1, masteryProbability: 0.8 }
    expect(computeMasteryScore(row({ ...base, fsrs: { due: FSRS_DUE, stability: 0, difficulty: 5 } }))).toBe(80)
    expect(computeMasteryScore(row({ ...base, fsrs: { due: FSRS_DUE, stability: -3, difficulty: 5 } }))).toBe(80)
    expect(computeMasteryScore(row({ ...base, fsrs: { due: FSRS_DUE, stability: NaN, difficulty: 5 } }))).toBe(80)
    // 旧数据/导入数据里 FSRS 卡可能整个缺 stability 字段
    expect(computeMasteryScore(row({ ...base, fsrs: { due: FSRS_DUE, difficulty: 5 } }))).toBe(80)
  })

  it('difficulty 字段缺失 / NaN → 走纯 BKT 降级（钉住本实现的选择）', () => {
    const base = { id: 1, masteryProbability: 0.8 }
    expect(computeMasteryScore(row({ ...base, fsrs: { due: FSRS_DUE, stability: 30 } }))).toBe(80)
    expect(computeMasteryScore(row({ ...base, fsrs: { due: FSRS_DUE, stability: 30, difficulty: NaN } }))).toBe(80)
  })

  it('stability=Infinity（非有限）→ 按无 FSRS 处理，纯 BKT', () => {
    expect(
      computeMasteryScore(row({ id: 1, masteryProbability: 0.5, fsrs: { due: FSRS_DUE, stability: Infinity, difficulty: 1 } }))
    ).toBe(50)
  })

  it('D=0 与 D=99 被 clamp 到 1/10（分别等于 D=1 / D=10 的分数）', () => {
    const base = { due: FSRS_DUE, stability: 30 }
    const d1 = computeMasteryScore(row({ id: 1, masteryProbability: 0.9, fsrs: { ...base, difficulty: 1 } }))
    const d0 = computeMasteryScore(row({ id: 2, masteryProbability: 0.9, fsrs: { ...base, difficulty: 0 } }))
    const d10 = computeMasteryScore(row({ id: 3, masteryProbability: 0.9, fsrs: { ...base, difficulty: 10 } }))
    const d99 = computeMasteryScore(row({ id: 4, masteryProbability: 0.9, fsrs: { ...base, difficulty: 99 } }))
    expect(d0).toBe(d1)
    expect(d99).toBe(d10)
  })

  it('p 越界被 clamp 收敛：-1 → 0；1.5（无 FSRS）→ 100；1.5（有 FSRS）→ 84', () => {
    expect(computeMasteryScore(row({ id: 1, masteryProbability: -1 }))).toBe(0)
    expect(computeMasteryScore(row({ id: 2, masteryProbability: 1.5 }))).toBe(100)
    // 公式是 clamp01(p * kS * kD) —— 对乘积收敛：1.5 * 0.6321 * 0.8889 ≈ 0.843 → 84
    expect(
      computeMasteryScore(row({ id: 3, masteryProbability: 1.5, fsrs: { due: FSRS_DUE, stability: 30, difficulty: 5 } }))
    ).toBe(84)
  })

  it('masteryProbability=NaN 时回退 bkt.pKnown（脏字段不致命）', () => {
    expect(
      computeMasteryScore(row({ id: 1, masteryProbability: NaN, bkt: { pKnown: 0.5, observed: 3 } }))
    ).toBe(50)
  })

  it('null / undefined 行 → null（不抛）', () => {
    expect(computeMasteryScore(null as unknown as ProgressRecord)).toBeNull()
    expect(computeMasteryScore(undefined as unknown as ProgressRecord)).toBeNull()
  })
})

describe('输出域不变量 —— 200 组随机畸形行', () => {
  it('每个分数都是 [0,100] 内的整数或 null（绝不抛异常）', () => {
    const rand = xorshift32(20261022)
    let scorable = 0
    for (let i = 0; i < 200; i += 1) {
      const mpRoll = rand()
      const masteryProbability =
        mpRoll < 0.08
          ? undefined
          : mpRoll < 0.14
            ? NaN
            : mpRoll < 0.2
              ? Infinity
              : mpRoll < 0.26
                ? -1
                : rand() * 1.5 // [0, 1.5)：含超过 1 的越界上界
      const bkt =
        typeof masteryProbability === 'number' || rand() > 0.5
          ? undefined
          : { pKnown: rand(), observed: 1 }
      const fsrsRoll = rand()
      const fsrs =
        fsrsRoll < 0.35
          ? undefined
          : {
              due: FSRS_DUE,
              stability: fsrsRoll < 0.45 ? NaN : fsrsRoll < 0.5 ? 0 : rand() * 1200 - 20,
              difficulty: fsrsRoll > 0.9 ? NaN : rand() * 22 - 6,
            }
      const score = computeMasteryScore(row({ id: i + 1, masteryProbability, bkt, fsrs }))
      if (score === null) continue
      expect(Number.isInteger(score)).toBe(true)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
      scorable += 1
    }
    // 生成器本身要能产出足够多的可估分行，否则这条不变量是空转
    expect(scorable).toBeGreaterThan(50)
  })
})
