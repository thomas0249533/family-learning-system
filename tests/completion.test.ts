/**
 * V2.12.3 · 学习卡片的「全部完成」判定
 *
 * ## 这个文件守的是什么
 *
 * 用户的原话：
 *
 * > 「每日打卡，现在是做过的题目会有这个边框和标识，但是没有全做对的，这种就必须得
 * > 从头再做一遍。这种模式很费时。」
 *
 * 卡片状态原本**只**由 `progress.status` 聚合，而 `progress.status` 判「已掌握」要
 * 连对 3 次（知识点级的**复习**门槛）。「这一天做完了没有」是**题目级**的问题 ——
 * 一道题做对一次就算做完了。口径错位导致孩子必须把整天重做一遍。
 *
 * 本文件钉死新的完成度判定：
 *  1. **都学过 + 没有未掌握的错题** → 判「已掌握」（自动通道）；
 *  2. **错题本里已掌握** → 自动转绿（用户明确要的「错题本已掌握就自动更新」）；
 *  3. **只做了一部分** → 仍然是「学习中」（不能点开第一个知识点就变绿）；
 *  4. **手动标记** → 判「已掌握」，且优先级最高（可撤销）。
 */
import { describe, expect, it } from 'vitest'
import type { MasteryStatus, MistakeRecord, ProgressRecord } from '@/db'
import { completionStatusOf, pendingMistakeCount, scopeOfUnit } from '@core/learning/completion'
import { makePkg, makeProgress } from './helpers/progressFixtures'
import { buildOwnerIndex } from '@core/progress/ownerIndex'

const PKG = 'daily-math-4-up-rjb-45d'
const OWNER = 'unit-math-4-up-rjb-p1'
const KP_A = `${OWNER}::kp-num-001`
const KP_B = `${OWNER}::kp-num-002`
const KP_C = `${OWNER}::kp-num-003`

/** 归属包索引：每日包引用教材包的 kpId，进度落在教材包上（与生产同源） */
const OWNER_INDEX = buildOwnerIndex([
  makePkg(OWNER, 'math', [{ id: KP_A }, { id: KP_B }, { id: KP_C }]),
])

function row(id: number, kpId: string, status: MasteryStatus): ProgressRecord {
  return makeProgress({ id, packageId: OWNER, knowledgePointId: kpId, status })
}

function mistake(spec: {
  id: number
  exerciseId: string
  kpIds: string[]
  level?: 'none' | 'partial' | 'mastered'
}): MistakeRecord {
  const level = spec.level ?? 'none'
  return {
    id: spec.id,
    profileId: 'default',
    packageId: OWNER,
    exerciseId: spec.exerciseId,
    knowledgePointIds: spec.kpIds,
    wrongAt: '2026-01-01T00:00:00.000Z',
    wrongCount: 1,
    mastered: level === 'mastered',
    masteryLevel: level,
    reviewCorrectCount: level === 'mastered' ? 2 : level === 'partial' ? 1 : 0,
  }
}

describe('completionStatusOf · 自动通道', () => {
  it('一个知识点都没做过 → none（没做过的东西不能说「做完了」）', () => {
    expect(
      completionStatusOf({
        entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
        kpIds: [KP_A, KP_B],
        progress: [],
        mistakes: [],
      })
    ).toBe('none')
  })

  it('只做了一部分 → learning（不能点开第一个知识点就变绿）', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A, KP_B],
      progress: [row(1, KP_A, '学习中')],
      mistakes: [],
    })
    expect(status).toBe('learning')
  })

  it('全部做过且没有错题 → mastered（「当日题型全部掌握」）', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A, KP_B, KP_C],
      progress: [
        row(1, KP_A, '学习中'),
        row(2, KP_B, '学习中'),
        row(3, KP_C, '学习中'),
      ],
      mistakes: [],
    })
    expect(status).toBe('mastered')
  })

  it('做错过但错题还没攻克 → learning（不能提前变绿）', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A, KP_B],
      progress: [row(1, KP_A, '学习中'), row(2, KP_B, '需复习')],
      mistakes: [mistake({ id: 1, exerciseId: 'd45-01-x02', kpIds: [KP_B] })],
    })
    expect(status).toBe('learning')
  })

  it('错题在错题本里已掌握 → 自动转绿（用户要的「错题本已掌握就自动更新」）', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A, KP_B],
      progress: [row(1, KP_A, '学习中'), row(2, KP_B, '需复习')],
      mistakes: [
        mistake({ id: 1, exerciseId: 'd45-01-x02', kpIds: [KP_B], level: 'mastered' }),
      ],
    })
    expect(status).toBe('mastered')
  })

  it('错题只是「部分掌握」（复习对过 1 次）→ 还不算完成', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A, KP_B],
      progress: [row(1, KP_A, '学习中'), row(2, KP_B, '学习中')],
      mistakes: [
        mistake({ id: 1, exerciseId: 'd45-01-x02', kpIds: [KP_B], level: 'partial' }),
      ],
    })
    expect(status).toBe('learning')
  })

  it('范围外的错题不影响这张卡', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A],
      progress: [row(1, KP_A, '学习中')],
      mistakes: [
        mistake({ id: 1, exerciseId: 'other-x02', kpIds: [KP_B], level: 'none' }),
      ],
    })
    expect(status).toBe('mastered')
  })

  it('没带知识点的错题，靠题目 id 兜住（否则会漏出视野导致提前变绿）', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A],
      exerciseIds: ['d45-01-x02'],
      progress: [row(1, KP_A, '学习中')],
      mistakes: [mistake({ id: 1, exerciseId: 'd45-01-x02', kpIds: [] })],
    })
    expect(status).toBe('learning')
  })

  it('既有掌握度已是「已掌握」→ mastered（既有语义不动）', () => {
    const status = completionStatusOf({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A],
      progress: [row(1, KP_A, '已掌握')],
      mistakes: [],
    })
    expect(status).toBe('mastered')
  })
})

describe('completionStatusOf · 手动标记', () => {
  it('手动标记 → mastered（优先级最高）', () => {
    expect(
      completionStatusOf({
        entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
        kpIds: [KP_A],
        progress: [],
        mistakes: [],
        manual: true,
      })
    ).toBe('mastered')
  })

  it('手动标记时连知识点都没有也照样是 mastered', () => {
    expect(
      completionStatusOf({
        entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
        kpIds: [],
        progress: [],
        mistakes: [],
        manual: true,
      })
    ).toBe('mastered')
  })
})

describe('pendingMistakeCount', () => {
  it('统计范围内未掌握的错题数', () => {
    const count = pendingMistakeCount({
      entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
      kpIds: [KP_A, KP_B],
      progress: [],
      mistakes: [
        mistake({ id: 1, exerciseId: 'e1', kpIds: [KP_A], level: 'none' }),
        mistake({ id: 2, exerciseId: 'e2', kpIds: [KP_B], level: 'mastered' }),
        mistake({ id: 3, exerciseId: 'e3', kpIds: [KP_A], level: 'partial' }),
        mistake({ id: 4, exerciseId: 'e4', kpIds: [KP_C], level: 'none' }),
      ],
    })
    expect(count).toBe(2)
  })

  it('老数据只有 mastered 布尔值时也认（兼容旧错题行）', () => {
    const legacy = {
      id: 9,
      profileId: 'default',
      packageId: OWNER,
      exerciseId: 'legacy',
      knowledgePointIds: [KP_A],
      wrongAt: '2026-01-01T00:00:00.000Z',
      wrongCount: 1,
      mastered: true,
    } as MistakeRecord
    expect(
      pendingMistakeCount({
        entryPackageId: PKG,
        ownerIndex: OWNER_INDEX,
        kpIds: [KP_A],
        progress: [],
        mistakes: [legacy],
      })
    ).toBe(0)
  })
})

describe('scopeOfUnit', () => {
  it('摊平单元下所有主题的知识点与题目，并去重', () => {
    const scope = scopeOfUnit({
      topics: [
        {
          knowledgePointIds: [KP_A, KP_B],
          exercises: [{ id: 't1-e1' }, { id: 't1-e2' }],
        },
        {
          knowledgePointIds: [KP_B, KP_C],
          exercises: [{ id: 't2-e1' }, { id: 't1-e1' }],
        },
      ],
    })
    expect(scope.kpIds).toEqual([KP_A, KP_B, KP_C])
    expect(scope.exerciseIds).toEqual(['t1-e1', 't1-e2', 't2-e1'])
  })

  it('空单元 → 空范围', () => {
    expect(scopeOfUnit(undefined)).toEqual({ kpIds: [], exerciseIds: [] })
    expect(scopeOfUnit({ topics: [] })).toEqual({ kpIds: [], exerciseIds: [] })
  })
})
