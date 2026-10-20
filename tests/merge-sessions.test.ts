import { describe, expect, it } from 'vitest'
import type { ExamSessionRecord } from '@/db'
import { mergeSessions, sessionKey } from '@core/merge/mergeSessions'

/**
 * 模考记录合并（§6.3）。
 *
 * 核心裁决：key 必须含 `startedAt`。
 * `sessionIndex` 是**每台设备各自数**的序号，两台设备都可能做出"第 3 次模考"，
 * 但那是两场不同的考试。只按 index 去重会把两场合成一场，`finalRate` 只剩一个，
 * 而且留下哪一场完全取决于导入顺序（不可复现、无法向家长解释）。
 */

function session(over: Partial<ExamSessionRecord> = {}): ExamSessionRecord {
  return {
    profileId: 'default',
    packageId: 'pkg-a',
    sessionIndex: 1,
    questionIds: ['q1', 'q2'],
    answers: {},
    currentIndex: 2,
    elapsedSeconds: 120,
    totalCount: 2,
    timeLimit: 600,
    startedAt: '2026-01-01T10:00:00.000Z',
    finishedAt: '2026-01-01T10:02:00.000Z',
    status: 'finished',
    finalCorrect: 2,
    finalRate: 1,
    ...over,
  }
}

describe('sessionKey — 场次定位', () => {
  it('同一 packageId + 同一 sessionIndex 但 startedAt 不同 → 两场考试', () => {
    const a = sessionKey(session({ sessionIndex: 3, startedAt: '2026-01-01T10:00:00.000Z' }))
    const b = sessionKey(session({ sessionIndex: 3, startedAt: '2026-01-02T10:00:00.000Z' }))
    expect(a).not.toBe(b)
  })

  it('三段的边界不会被内容伪造', () => {
    // sessionIndex 是数字，不会带分隔符；这里守住 packageId 与 startedAt 的边界
    expect(sessionKey(session({ packageId: 'a', startedAt: 'b' }))).not.toBe(
      sessionKey(session({ packageId: 'a\u0000b', startedAt: '' })),
    )
  })
})

describe('mergeSessions — 同场保持本机、异场并集', () => {
  it('★ 两台设备各自的"第 3 次模考"是两场，都留下', () => {
    const local = [session({ sessionIndex: 3, startedAt: '2026-01-01T10:00:00.000Z', finalRate: 0.8 })]
    const remote = [
      session({ sessionIndex: 3, startedAt: '2026-01-02T10:00:00.000Z', finalRate: 1 }),
    ]

    const out = mergeSessions(local, remote)
    expect(out.added).toBe(1)
    expect(out.upserts).toHaveLength(1)
    expect(out.upserts[0].finalRate).toBe(1)
  })

  it('同 key（同一场）→ 保持本机，计数进 keptLocal', () => {
    const local = [session({ currentIndex: 2, status: 'finished', finalRate: 1 })]
    const remote = [session({ currentIndex: 0, status: 'ongoing', finalRate: undefined })]

    const out = mergeSessions(local, remote)
    expect(out.upserts).toHaveLength(0)
    expect(out.keptLocal).toBe(1)
  })

  it('本机没有的场次补进来，并剥掉自增 id', () => {
    const out = mergeSessions([], [session({ id: 42 })])
    expect(out.added).toBe(1)
    expect('id' in out.upserts[0]).toBe(false)
  })

  it('同 packageId 不同 sessionIndex 互不覆盖', () => {
    const local = [session({ sessionIndex: 1, startedAt: '2026-01-01T10:00:00.000Z' })]
    const remote = [session({ sessionIndex: 2, startedAt: '2026-01-01T10:00:00.000Z' })]
    expect(mergeSessions(local, remote).added).toBe(1)
  })

  it('远端自带同一场两行 → 只留一条 upsert', () => {
    const remote = [session(), session()]
    expect(mergeSessions([], remote).upserts).toHaveLength(1)
  })
})

describe('mergeSessions — 幂等', () => {
  it('merge(local, local) 零写入', () => {
    const local = [session(), session({ sessionIndex: 2 })]
    expect(mergeSessions(local, local).upserts).toHaveLength(0)
  })

  it('merge(merged, remote) 零写入', () => {
    const local: ExamSessionRecord[] = []
    const remote = [session(), session({ sessionIndex: 2 })]
    const merged = mergeSessions(local, remote).upserts
    expect(mergeSessions(merged, remote).upserts).toHaveLength(0)
  })
})
