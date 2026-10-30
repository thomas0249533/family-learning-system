/**
 * 手动完成标记的合并语义（V3.0 · M4）
 *
 * 这块的性质与 `progress` / `mistakes` 完全不同，所以单独一组用例：
 * 那些表要"挑更晚的一条"，而标记只有"有/没有"两种状态，合并是**纯并集**。
 * 一旦有人把它改成"按时间覆盖"，幂等（AC-P2-13）会立刻失效 ——
 * 第二遍导入会报"有新数据"，而这组用例正是钉住这一点的地方。
 */

import { describe, expect, it } from 'vitest'
import type { CardCompletionRecord } from '@/db'
import { markKey, mergeCardCompletions } from '@core/merge/mergeCardCompletions'

function mark(over: Partial<CardCompletionRecord> = {}): CardCompletionRecord {
  return {
    profileId: 'p1',
    kind: 'unit',
    packageId: 'pkg-a',
    targetId: 'u1',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('markKey — 三要素缺一不可', () => {
  it('同一个单元 id 在两个不同的包里是两张卡片', () => {
    expect(markKey(mark({ packageId: 'pkg-a', targetId: 'u1' }))).not.toBe(
      markKey(mark({ packageId: 'pkg-b', targetId: 'u1' })),
    )
  })

  it('同一个 targetId 在 unit 与 package 两种 kind 下是两张卡片', () => {
    expect(markKey(mark({ kind: 'unit', targetId: 'x' }))).not.toBe(
      markKey(mark({ kind: 'package', targetId: 'x' })),
    )
  })

  it('包 id 里本来就带分隔符时不会串键（用 \\0 而不是 ::）', () => {
    // 若 key 用 `${kind}::${packageId}::${targetId}` 拼接，这两行会撞成同一个 key：
    //   a) packageId='p::q', targetId='r'
    //   b) packageId='p',     targetId='q::r'
    const a = markKey(mark({ packageId: 'p::q', targetId: 'r' }))
    const b = markKey(mark({ packageId: 'p', targetId: 'q::r' }))
    expect(a).not.toBe(b)
  })

  it('key 不含 profileId（合并按档案逐个进行）', () => {
    expect(markKey(mark({ profileId: 'p1' }))).toBe(markKey(mark({ profileId: 'p2' })))
  })
})

describe('mergeCardCompletions — 纯并集', () => {
  it('本机空 → 远端的全部写进来', () => {
    const out = mergeCardCompletions([], [mark(), mark({ targetId: 'u2' })])
    expect(out.added).toBe(2)
    expect(out.keptLocal).toBe(0)
    expect(out.upserts).toHaveLength(2)
  })

  it('两边都有同一张卡片 → 不写、记 keptLocal（幂等的来源）', () => {
    const local = [mark()]
    const out = mergeCardCompletions(local, [mark({ createdAt: '2026-01-01T00:00:00.000Z' })])
    expect(out.added).toBe(0)
    expect(out.keptLocal).toBe(1)
    expect(out.upserts).toHaveLength(0)
  })

  it('本机有 a、远端有 b → 只补 b，a 不动', () => {
    const out = mergeCardCompletions([mark({ targetId: 'a' })], [mark({ targetId: 'b' })])
    expect(out.upserts.map((r) => r.targetId)).toEqual(['b'])
    expect(out.added).toBe(1)
    expect(out.keptLocal).toBe(0)
  })

  it('幂等：把并集结果再合一次，一条都不写', () => {
    const first = mergeCardCompletions([mark({ targetId: 'a' })], [mark({ targetId: 'b' })])
    const merged = [mark({ targetId: 'a' }), ...first.upserts]
    const second = mergeCardCompletions(merged, [mark({ targetId: 'a' }), mark({ targetId: 'b' })])
    expect(second.added).toBe(0)
    expect(second.upserts).toHaveLength(0)
  })

  it('可交换：先合 A 再合 B 与先合 B 再合 A 的并集相同', () => {
    const A = [mark({ targetId: 'a' }), mark({ targetId: 'b' })]
    const B = [mark({ targetId: 'b' }), mark({ targetId: 'c' })]
    const ab = [...mergeCardCompletions(A, B).upserts, ...A]
    const ba = [...mergeCardCompletions(B, A).upserts, ...B]
    expect(ab.map(markKey).sort()).toEqual(ba.map(markKey).sort())
  })

  it('剥掉自增 id（落库由 Dexie 重新分配，带着旧 id 会覆盖别的行）', () => {
    const out = mergeCardCompletions([], [mark({ id: 7 })])
    expect(out.upserts[0].id).toBeUndefined()
    expect('id' in out.upserts[0]).toBe(false)
  })

  it('远端重复的同一张卡片只写一条（折叠多份备份时的关键）', () => {
    const out = mergeCardCompletions([], [mark(), mark()])
    expect(out.added).toBe(1)
    expect(out.keptLocal).toBe(1)
  })

  it('undefined / null 行不炸也不进结果（备份可能被手工编辑过）', () => {
    const dirty = [mark(), undefined as unknown as CardCompletionRecord, null as unknown as CardCompletionRecord]
    const out = mergeCardCompletions([], dirty)
    expect(out.upserts).toHaveLength(1)
  })
})
