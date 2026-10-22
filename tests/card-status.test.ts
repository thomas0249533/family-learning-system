/**
 * V1.6 · Stage D · D1 —— 卡片状态的纯函数口径
 *
 * 这个文件守的是四件事：
 *   1. **聚合顺序**（`attention`：任一「需复习」压过「已掌握」）—— 错序会让一张该复习的
 *      卡显示成已掌握；
 *   2. **同一 `(packageId, kpId)` 多条进度行取最新**（`canonicalizeProgressRows` 层 1）；
 *   3. **跨包不互相污染**（层 2 的 kpId 收敛是统计分母口径，不能拿来查卡片状态）；
 *   4. **两种聚合模式的边界**（`attention` 知识点级 / `progress` 天·单元·包级）——
 *      后者的存在理由：任一到期就把「学完的一天」整卡挂红，是用户明确否掉的语义。
 *
 * ⚠️ 文件前半部分（`attention` 相关断言）是**引入 `progress` 之前的原文**，
 * 新增模式时**一条都没有改**：这就是「`attention` 分支零行为变化」的证据之一。
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

  /**
   * ⚠️ 这条断言在 D1 返工时**改过**（唯一一条），原因不是 `attention` 分支变了，
   * 而是**包卡的聚合模式**按用户反馈从 `attention` 换成了 `progress`：
   * 「有未学的 + 一个到期 → 整格挂红」正是被否掉的旧行为（会让「今天练了两个板块」
   * 看起来像告警）。此处保留这个场景，把期望改成新语义，作为变更的锚点。
   * 知识点评级（`topicCardStatusOf`）在同一场景下**仍然是 review**，见下方模式块。
   */
  it('有「需复习」但也有「未学」的行 → learning（还在推进，不整格挂红）', () => {
    const progress = [
      row(1, 'p1', 'kp-a', '已掌握'),
      row(2, 'p1', 'kp-b', '需复习'),
      row(3, 'p1', 'kp-c', '未学'),
    ]
    expect(packageCardStatusOf('p1', progress)).toBe('learning')
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

// =====================================================================
// 两种聚合模式（V1.6 · D1 返工）
// ---------------------------------------------------------------------
// `attention` = 知识点级「有没有一个该回头了」；`progress` = 天/单元/包级
// 「这摊内容推进到哪了」。真数据上全用 `attention` 会让「学完的一天」长期挂红、
// 让 45 天的包卡永远变不了绿（理由见 cardStatus.ts 文件头）。
// =====================================================================

/** 用例表：同一组 statuses 在两种模式下各自的期望（**差异集中在 review 那一行**） */
const MODE_MATRIX: Array<{
  name: string
  statuses: MasteryStatus[]
  attention: 'none' | 'learning' | 'review' | 'mastered'
  progress: 'none' | 'learning' | 'review' | 'mastered'
}> = [
  { name: '没碰过（全未学）', statuses: ['未学', '未学'], attention: 'none', progress: 'none' },
  { name: '学完一天（全已掌握）', statuses: ['已掌握', '已掌握'], attention: 'mastered', progress: 'mastered' },
  { name: '学完但整体到期（全需复习）', statuses: ['需复习', '需复习'], attention: 'review', progress: 'review' },
  { name: '在学（全学习中）', statuses: ['学习中'], attention: 'learning', progress: 'learning' },
  // ↓ 关键一行：学完 3 个、剩 2 个没碰 → 不该红
  {
    name: '学完 3 个 + 剩 2 个没碰',
    statuses: ['已掌握', '已掌握', '已掌握', '未学', '未学'],
    attention: 'learning',
    progress: 'learning',
  },
  // ↓ 关键一行：混着未学时，个别到期也不该把「还在推进的一天」整卡挂红
  {
    name: '3 已掌握 + 1 需复习 + 2 未学',
    statuses: ['已掌握', '已掌握', '已掌握', '需复习', '未学', '未学'],
    attention: 'review',
    progress: 'learning',
  },
  // ↓ 该学的都学过了、有人到期 → 这才允许红
  {
    name: '都学过了、其中 1 个到期',
    statuses: ['已掌握', '已掌握', '已掌握', '需复习'],
    attention: 'review',
    progress: 'review',
  },
]

describe('aggregateCardStatus(mode) —— 两种模式对同一输入的期望', () => {
  for (const c of MODE_MATRIX) {
    it(`[attention] ${c.name} → ${c.attention}`, () => {
      expect(aggregateCardStatus(c.statuses, 'attention')).toBe(c.attention)
      // 显式传 'attention' 必须与不传完全等价（默认值语义）
      expect(aggregateCardStatus(c.statuses)).toBe(c.attention)
    })

    it(`[progress] ${c.name} → ${c.progress}`, () => {
      expect(aggregateCardStatus(c.statuses, 'progress')).toBe(c.progress)
    })
  }

  it('空数组两种模式都是 none', () => {
    expect(aggregateCardStatus([], 'attention')).toBe('none')
    expect(aggregateCardStatus([], 'progress')).toBe('none')
  })

  it('progress：全学完但整体到期 → review（红只在「都学过了」时出现）', () => {
    expect(aggregateCardStatus(['需复习'], 'progress')).toBe('review')
    expect(aggregateCardStatus(['已掌握', '需复习'], 'progress')).toBe('review')
  })

  it('progress：只要还有「学习中」就不算整体到期（仍在推进期）', () => {
    expect(aggregateCardStatus(['学习中', '需复习'], 'progress')).toBe('learning')
  })

  it('progress：脏状态归一到「未学」后按「还没学」处理（不会误判成已学完到期）', () => {
    expect(aggregateCardStatus(['已掌握', '需复习', '' as MasteryStatus], 'progress')).toBe('learning')
  })

  it('progress：归一后全是脏状态 → none（不会变成 learning）', () => {
    expect(aggregateCardStatus(['' as MasteryStatus, undefined as unknown as MasteryStatus], 'progress')).toBe('none')
  })
})

describe('调用点固定了模式：单元/包 = progress，主题 = attention', () => {
  it('单元卡：混着未学时，个别 kp 到期不把整卡挂红 → learning', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a', 'kp-b', 'kp-c'] }] }
    const progress = [
      row(1, 'p1', 'kp-a', '已掌握'),
      row(2, 'p1', 'kp-b', '需复习'),
      row(3, 'p1', 'kp-c', '未学'),
    ]
    // 同一组状态在 attention 下会是 review —— 这正是被否掉的旧行为
    expect(aggregateCardStatus(['已掌握', '需复习', '未学'], 'attention')).toBe('review')
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('learning')
  })

  it('单元卡：都学过了且整体到期 → review', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a', 'kp-b'] }] }
    const progress = [row(1, 'p1', 'kp-a', '需复习'), row(2, 'p1', 'kp-b', '需复习')]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('review')
  })

  it('单元卡：全部已掌握仍然是 mastered（绿没被削弱）', () => {
    const unit = { topics: [{ knowledgePointIds: ['kp-a', 'kp-b'] }] }
    const progress = [row(1, 'p1', 'kp-a', '已掌握'), row(2, 'p1', 'kp-b', '已掌握')]
    expect(unitCardStatusOf(unit, 'p1', progress)).toBe('mastered')
  })

  it('主题卡仍走 attention：主题内有一个到期就 review（行为零变化）', () => {
    const topic = { knowledgePointIds: ['kp-a', 'kp-b'] }
    const progress = [row(1, 'p1', 'kp-a', '已掌握'), row(2, 'p1', 'kp-b', '需复习')]
    expect(topicCardStatusOf(topic, 'p1', progress)).toBe('review')
  })

  it('包卡（每日一练一天）：练了一部分 + 一个到期 → learning，不再整格挂红', () => {
    const progress = [
      row(1, 'p1', 'kp-a', '已掌握'),
      row(2, 'p1', 'kp-b', '已掌握'),
      row(3, 'p1', 'kp-c', '需复习'),
      row(4, 'p1', 'kp-d', '未学'),
    ]
    expect(packageCardStatusOf('p1', progress)).toBe('learning')
  })

  it('包卡：当天四个板块全掌握 → mastered', () => {
    const progress = ['kp-a', 'kp-b', 'kp-c', 'kp-d'].map((kpId, i) => row(i + 1, 'p1', kpId, '已掌握'))
    expect(packageCardStatusOf('p1', progress)).toBe('mastered')
  })

  it('包卡：当天全练完但都到期了 → review', () => {
    const progress = ['kp-a', 'kp-b'].map((kpId, i) => row(i + 1, 'p1', kpId, '需复习'))
    expect(packageCardStatusOf('p1', progress)).toBe('review')
  })
})
