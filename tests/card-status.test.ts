/**
 * V1.6 · Stage D · D1 —— 卡片状态的纯函数口径
 *
 * 这个文件守的是三件事：
 *   1. **聚合顺序**（「需复习」压过「已掌握」）—— 错序会让一张该复习的卡显示成已掌握；
 *   2. **同一 `(packageId, kpId)` 多条进度行取最新**（`canonicalizeProgressRows` 层 1）；
 *   3. **跨包不互相污染**（层 2 的 kpId 收敛是统计分母口径，不能拿来查卡片状态）。
 */
import { describe, expect, it } from 'vitest'
import type { MasteryStatus } from '@/db'
import {
  CARD_STATUS_LABEL,
  CARD_STATUS_MARK,
  aggregateCardStatus,
  cardStatusClass,
  packageCardStatusOf,
  topicCardStatusOf,
  unitCardStatusOf,
} from '@core/learning/cardStatus'
import { makeProgress } from './helpers/progressFixtures'

/** 造一条「某包某知识点」的进度行，只关心状态与时间 */
function row(
  id: number,
  packageId: string,
  knowledgePointId: string,
  status: MasteryStatus,
  lastStudiedAt = '2026-01-01T00:00:00.000Z'
) {
  return makeProgress({ id, packageId, knowledgePointId, status, lastStudiedAt })
}

describe('aggregateCardStatus —— 顺序即优先级', () => {
  it('空数组 → none', () => {
    expect(aggregateCardStatus([])).toBe('none')
  })

  it('全是「未学」→ none', () => {
    expect(aggregateCardStatus(['未学', '未学', '未学'])).toBe('none')
  })

  it('全是「已掌握」→ mastered', () => {
    expect(aggregateCardStatus(['已掌握', '已掌握'])).toBe('mastered')
  })

  it('「已掌握 + 未学」混合 → learning（不能因为有一个已掌握就整卡变绿）', () => {
    expect(aggregateCardStatus(['已掌握', '未学'])).toBe('learning')
  })

  it('「学习中」→ learning', () => {
    expect(aggregateCardStatus(['学习中'])).toBe('learning')
  })

  it('任一「需复习」压过「已掌握」→ review', () => {
    expect(aggregateCardStatus(['已掌握', '需复习'])).toBe('review')
  })

  it('需复习 + 已掌握 + 未学 → review', () => {
    expect(aggregateCardStatus(['需复习', '已掌握', '未学'])).toBe('review')
  })

  it('未知/缺失状态归一到「未学」（而不是莫名其妙变成「学习中」）', () => {
    // ① 判据：全是脏状态 → 应等价于「全未学」→ none。
    //    若没归一，`''` 既不等于「未学」也不等于「已掌握」→ 会落进 learning 分支。
    expect(aggregateCardStatus(['' as MasteryStatus, undefined as unknown as MasteryStatus])).toBe('none')
    // ② 脏状态归一到「未学」后，与「已掌握」混合 → learning（不是 mastered）
    expect(aggregateCardStatus(['已掌握', '' as MasteryStatus])).toBe('learning')
  })
})

describe('unitCardStatusOf —— 摊平单元下所有主题的知识点', () => {
  it('无进度行 → none', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a', 'kp-b'] }] }
    expect(unitCardStatusOf(unit, 'p1', [])).toBe('none')
  })

  it('空单元（没有 topics / 没有知识点）→ none，不编状态', () => {
    expect(unitCardStatusOf({}, 'p1', [row(1, 'p1', 'kp-a', '已掌握')])).toBe('none')
    expect(unitCardStatusOf({ topics: [] }, 'p1', [row(1, 'p1', 'kp-a', '已掌握')])).toBe('none')
    expect(unitCardStatusOf({ topics: [{ knowledgePointIds: [] }] }, 'p1', [])).toBe('none')
  })

  it('跨多个主题摊平后聚合：2 个已掌握 + 1 个未学 → learning', () => {
    const unit = {
      topics: [{ knowledgePointIds: ['kp-a'] }, { knowledgePointIds: ['kp-b', 'kp-c'] }],
    }
    const progress = [row(1, 'p1', 'kp-a', '已掌握'), row(2, 'p1', 'kp-b', '已掌握')]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('learning')
  })

  it('摊平后全部已掌握 → mastered', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a', 'kp-b'] }] }
    const progress = [row(1, 'p1', 'kp-a', '已掌握'), row(2, 'p1', 'kp-b', '已掌握')]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('mastered')
  })

  it('同一 kp 重复出现在多个主题里只算一次状态（不改变聚合结果）', () => {
    const unit = {
      topics: [{ knowledgePointIds: ['kp-a', 'kp-a'] }, { knowledgePointIds: ['kp-a'] }],
    }
    expect(unitCardStatusOf(unit, 'p1', [row(1, 'p1', 'kp-a', '已掌握')])).toBe('mastered')
  })
})

describe('去重：同一 (packageId, kpId) 多条行按 lastStudiedAt 取最新', () => {
  it('旧行=未学、新行=已掌握 → mastered（裸 find 会取到哪条全看顺序）', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a'] }] }
    const oldFirst = [
      row(1, 'p1', 'kp-a', '未学', '2026-01-01T00:00:00.000Z'),
      row(2, 'p1', 'kp-a', '已掌握', '2026-03-01T00:00:00.000Z'),
    ]
    const newFirst = [oldFirst[1], oldFirst[0]]
    expect(unitCardStatusOf(unit, 'p1', oldFirst)).toBe('mastered')
    expect(unitCardStatusOf(unit, 'p1', newFirst)).toBe('mastered')
  })

  it('新行反而更难（掌握 → 需复习）时也要听最新那条', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a'] }] }
    const progress = [
      row(1, 'p1', 'kp-a', '已掌握', '2026-01-01T00:00:00.000Z'),
      row(2, 'p1', 'kp-a', '需复习', '2026-04-01T00:00:00.000Z'),
    ]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('review')
  })
})

describe('跨包隔离', () => {
  it('packageId 不匹配的进度行不得算进来', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a', 'kp-b'] }] }
    const progress = [
      row(1, 'p2', 'kp-a', '已掌握'),
      row(2, 'p2', 'kp-b', '已掌握'),
    ]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('none')
  })

  it('同 kpId 在两个包里：另一个包的已掌握不能点亮本包（层 2 收敛不用于卡片）', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a'] }] }
    const progress = [row(1, 'p2', 'kp-a', '已掌握')]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('none')
    expect(unitCardStatusOf(unit, 'p2', progress)).toBe('mastered')
  })
})

describe('topicCardStatusOf', () => {
  it('只看本主题自己的知识点', () => {
    const topic = { knowledgePointIds: ['kp-a', 'kp-b'] }
    const progress = [
      row(1, 'p1', 'kp-a', '已掌握'),
      row(2, 'p1', 'kp-b', '需复习'),
      row(3, 'p1', 'kp-other', '已掌握'),
    ]
    expect(topicCardStatusOf(topic, 'p1', progress)).toBe('review')
  })

  it('没有知识点的主题 → none；缺失 topic → none', () => {
    expect(topicCardStatusOf({}, 'p1', [row(1, 'p1', 'kp-a', '已掌握')])).toBe('none')
    expect(topicCardStatusOf(null, 'p1', [row(1, 'p1', 'kp-a', '已掌握')])).toBe('none')
  })
})

describe('packageCardStatusOf —— 每日一练打卡卡片', () => {
  it('该包没有进度行 → none（今天还没练）', () => {
    expect(packageCardStatusOf('p1', [row(1, 'p2', 'kp-a', '已掌握')])).toBe('none')
    expect(packageCardStatusOf('p1', [])).toBe('none')
  })

  it('四个板块全掌握 → mastered', () => {
    const progress = ['kp-a', 'kp-b', 'kp-c', 'kp-d'].map((kpId, i) =>
      row(i + 1, 'p1', kpId, '已掌握')
    )
    expect(packageCardStatusOf('p1', progress)).toBe('mastered')
  })

  it('练了两个板块、还有两个没练 → learning（不因「有已掌握」就变绿）', () => {
    const progress = ['kp-a', 'kp-b', 'kp-c', 'kp-d'].map((kpId, i) =>
      row(i + 1, 'p1', kpId, i < 2 ? '已掌握' : '未学')
    )
    expect(packageCardStatusOf('p1', progress)).toBe('learning')
  })

  it('同一知识点练了多遍只算一个状态（不能被数量放大成 learning）', () => {
    const progress = [
      row(1, 'p1', 'kp-a', '未学', '2026-01-01T00:00:00.000Z'),
      row(2, 'p1', 'kp-a', '已掌握', '2026-02-01T00:00:00.000Z'),
      row(3, 'p1', 'kp-a', '已掌握', '2026-03-01T00:00:00.000Z'),
      row(4, 'p1', 'kp-b', '已掌握'),
    ]
    expect(packageCardStatusOf('p1', progress)).toBe('mastered')
  })

  it('有「需复习」的行 → review（最需要把孩子拽回来）', () => {
    const progress = [
      row(1, 'p1', 'kp-a', '已掌握'),
      row(2, 'p1', 'kp-b', '需复习'),
      row(3, 'p1', 'kp-c', '未学'),
    ]
    expect(packageCardStatusOf('p1', progress)).toBe('review')
  })
})

describe('角标与标签 —— 色弱必须有颜色之外的线索', () => {
  it('三个「非未学」角标两两不同（否则色弱只剩颜色一条线索）', () => {
    const marks = ['learning', 'review', 'mastered'] as const
    expect(new Set(marks.map((s) => CARD_STATUS_MARK[s])).size).toBe(3)
  })

  it('未学也有独立的角标字形', () => {
    expect(CARD_STATUS_MARK.none).not.toBe(CARD_STATUS_MARK.learning)
    expect(CARD_STATUS_MARK.none).not.toBe(CARD_STATUS_MARK.review)
    expect(CARD_STATUS_MARK.none).not.toBe(CARD_STATUS_MARK.mastered)
  })

  it('标签用词与 MasteryStatus 一致（不造新词）', () => {
    expect(CARD_STATUS_LABEL).toEqual({
      none: '未学',
      learning: '学习中',
      review: '需复习',
      mastered: '已掌握',
    })
  })

  it('状态类名稳定（SCSS 里按 .is-* 命中）', () => {
    expect(cardStatusClass('none')).toBe('is-none')
    expect(cardStatusClass('learning')).toBe('is-learning')
    expect(cardStatusClass('review')).toBe('is-review')
    expect(cardStatusClass('mastered')).toBe('is-mastered')
  })
})
