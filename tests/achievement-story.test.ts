import { describe, expect, it } from 'vitest'
import type { AchievementItem } from '@core/motivation/achievementMeta'
import type { StoryOpts } from '@core/motivation/achievementStory'
import { storyFileName, storyOf } from '@core/motivation/achievementStory'
import { ctx, mastered, mistake, pkg, prog } from './achievement-fixtures'

/**
 * 成就故事卡 · 纯逻辑（V1.4 · B6）
 *
 * 三件事必须钉死，因为它们在 UI 上都表现为"看起来没问题"：
 *   1. **三段口径不能混**：解锁/证据是固化事实，`related` 是"现在的"。
 *   2. **拿不到就不写**：知识点标题解析失败时宁少一行，也不能把
 *      `unit-math::kp3` 这种 id 印在给孩子看的卡片上。
 *   3. **剪影不泄底**：`canSave === false` 且 `title === ''`（连标题都不给）。
 */

/** 已解锁的默认视图项（各用例按需覆盖） */
function item(over: Partial<AchievementItem> = {}): AchievementItem {
  return {
    id: 'ten-kp',
    icon: '📚',
    title: '小试牛刀',
    desc: '掌握 10 个知识点',
    category: 'M',
    source: 'subject',
    tier: 'advanced',
    stars: 1,
    earned: true,
    unlockedAt: '2026-10-03',
    evidence: '已掌握 10 个知识点',
    silhouetted: false,
    metered: true,
    current: 10,
    target: 10,
    percent: 100,
    hint: '已获得',
    chainLabel: '精熟之链 2/5',
    repeatCount: 1,
    ...over,
  }
}

/** 知识点标题解析：`<pkg>::kpN` → `知识点N`（其它一律查不到 → 空串） */
function titleOf(packageId: string, kpId: string): string {
  const m = /^((?:.+)::kp)(\d+)$/.exec(kpId)
  if (!m || !kpId.startsWith(`${packageId}::`)) return ''
  return `知识点${m[2]}`
}

function opts(over: Partial<StoryOpts> = {}): StoryOpts {
  return {
    profileName: '姐姐',
    today: '2026-10-20',
    tierLabel: '进阶',
    categoryLabel: '精熟目标',
    kpTitleOf: titleOf,
    ...over,
  }
}

describe('storyOf · 不可保存的形态', () => {
  it('剪影：canSave=false，且连标题都是空串（AC-14 不泄底）', () => {
    const s = storyOf(
      item({ id: 'comeback', earned: false, silhouetted: true, title: '卷土重来', evidence: '' }),
      ctx(),
      opts(),
    )
    expect(s.canSave).toBe(false)
    expect(s.title).toBe('')
    expect(s.icon).toBe('')
    expect(s.evidence).toBe('')
    expect(s.related).toEqual([])
    expect(s.reason).toContain('隐藏')
  })

  it('未解锁（非剪影）：canSave=false，且同样不产出任何卡片字段', () => {
    const s = storyOf(item({ earned: false, unlockedAt: '', evidence: '' }), ctx(), opts())
    expect(s.canSave).toBe(false)
    // 与剪影走同一个 `empty()` 出口：不可保存就没有"半张卡"
    expect(s.title).toBe('')
    expect(s.evidence).toBe('')
    expect(s.related).toEqual([])
    expect(s.reason).toContain('还没有解锁')
  })
})

describe('storyOf · 固化的那两段', () => {
  it('解锁日期 / 证据 / 重复次数原样透传，不做任何补算', () => {
    const s = storyOf(
      item({ unlockedAt: '2026-09-30', evidence: '已掌握 10 个知识点', repeatCount: 3 }),
      ctx({ progress: mastered('unit-math', 10) }),
      opts(),
    )
    expect(s.canSave).toBe(true)
    expect(s.unlockedAt).toBe('2026-09-30')
    expect(s.evidence).toBe('已掌握 10 个知识点')
    expect(s.repeatCount).toBe(3)
    expect(s.profileName).toBe('姐姐')
    expect(s.today).toBe('2026-10-20')
  })

  it('旧记录没有证据 → evidence 为空串（卡片据此不渲染该段），绝不事后生成', () => {
    const s = storyOf(
      item({ evidence: '' }),
      ctx({ progress: mastered('unit-math', 10) }),
      opts(),
    )
    expect(s.evidence).toBe('')
    // 关联记录仍然有（那是"现在"的数据，与"当时没存证据"不矛盾）
    expect(s.related.length).toBeGreaterThan(0)
  })
})

describe('storyOf · M 精熟类默认两行', () => {
  it('最近掌握取 lastStudiedAt 最晚的那枚，并带上日期', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', {
          knowledgePointId: 'unit-math::kp1',
          status: '已掌握',
          lastStudiedAt: '2026-10-01T08:00:00.000Z',
        }),
        prog('unit-math', {
          knowledgePointId: 'unit-math::kp7',
          status: '已掌握',
          lastStudiedAt: '2026-10-18T08:00:00.000Z',
        }),
      ],
    })
    const s = storyOf(item(), c, opts())
    expect(s.related[0]).toEqual({ label: '最近掌握', value: '知识点7 · 2026-10-18' })
    expect(s.related[1]).toEqual({
      label: '掌握概况',
      value: '已掌握 2 个知识点 · 覆盖 1 个学科',
    })
  })

  it('未掌握的不算进掌握概况', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', { knowledgePointId: 'unit-math::kp1', status: '已掌握' }),
        prog('unit-math', { knowledgePointId: 'unit-math::kp2', status: '学习中' }),
      ],
    })
    const s = storyOf(item(), c, opts())
    expect(s.related[1].value).toBe('已掌握 1 个知识点 · 覆盖 1 个学科')
  })

  it('查不到知识点标题 → 少一行，绝不把 id 印到卡片上', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', { knowledgePointId: 'unit-math::kp1', status: '已掌握' }),
      ],
    })
    // 不给解析器 = 拿不到标题
    const s = storyOf(item(), c, opts({ kpTitleOf: undefined }))
    expect(s.related.map((r) => r.label)).toEqual(['掌握概况'])
    expect(JSON.stringify(s.related)).not.toContain('unit-math::kp1')
  })

  it('完全没有已掌握的知识点 → related 为空（不是两行空串）', () => {
    const s = storyOf(item(), ctx(), opts())
    expect(s.related).toEqual([])
  })
})

describe('storyOf · G 成长类默认两行', () => {
  it('最近攻克取 wrongAt 最晚的已攻克错题；错题记录含复习答对次数', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      mistakes: [
        mistake({
          knowledgePointIds: ['unit-math::kp2'],
          wrongAt: '2026-10-05T10:00:00.000Z',
          mastered: true,
          reviewCorrectCount: 3,
        }),
        mistake({
          knowledgePointIds: ['unit-math::kp9'],
          wrongAt: '2026-10-12T10:00:00.000Z',
          mastered: true,
          reviewCorrectCount: 1,
        }),
        // 未攻克的不算
        mistake({ knowledgePointIds: ['unit-math::kp4'], wrongAt: '2026-10-19T10:00:00.000Z', mastered: false }),
      ],
    })
    const s = storyOf(item({ id: 'mistake-cleaner', category: 'G' }), c, opts())
    expect(s.related[0]).toEqual({ label: '最近攻克', value: '知识点9 · 2026-10-12' })
    expect(s.related[1]).toEqual({
      label: '错题记录',
      value: '已攻克 2 道 · 复习答对 4 次',
    })
  })
})

describe('storyOf · B 行为类默认两行', () => {
  it('连续天数用 max(longest, current)，单日最多取题量最大的那天', () => {
    const c = ctx({
      streak: { current: 4, longest: 11, lastDate: '2026-10-19' },
      dailyStats: [
        { date: '2026-10-18', questionCount: 9, firstStudyAt: 0, lastStudyAt: 0 },
        { date: '2026-10-19', questionCount: 26, firstStudyAt: 0, lastStudyAt: 0 },
      ],
    })
    const s = storyOf(item({ id: 'streak-7', category: 'B' }), c, opts())
    expect(s.related[0]).toEqual({ label: '连续天数', value: '最长 11 天 · 当前 4 天' })
    expect(s.related[1]).toEqual({ label: '单日最多', value: '2026-10-19 完成 26 题' })
  })

  it('一天都没学过 → related 为空', () => {
    const s = storyOf(item({ id: 'streak-3', category: 'B' }), ctx(), opts())
    expect(s.related).toEqual([])
  })
})

describe('storyOf · E 探索类默认两行', () => {
  it('只数"学过"的包，学科与学期去重后给中文', () => {
    const c = ctx({
      packages: [
        pkg('unit-math', 'math', 10, 'up'),
        pkg('unit-math-down', 'math', 10, 'down'),
        pkg('unit-chinese', 'chinese', 10, 'up'),
        // 没学过的包不该出现
        pkg('unit-english', 'english', 10, 'up'),
      ],
      progress: [
        prog('unit-math', { status: '已掌握' }),
        prog('unit-math-down', { status: '学习中' }),
        prog('unit-chinese', { status: '已掌握' }),
      ],
    })
    const s = storyOf(item({ id: 'explorer-3', category: 'E' }), c, opts())
    expect(s.related[0]).toEqual({ label: '学过的学习包', value: '3 个' })
    expect(s.related[1]).toEqual({
      label: '学科与学期',
      value: '数学·上册，数学·下册，语文·上册',
    })
    expect(JSON.stringify(s.related)).not.toContain('英语')
  })
})

describe('storyOf · 特例（替换类目默认，不叠加）', () => {
  it('perfect-kp 关联"连对最多"的那个知识点', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', { knowledgePointId: 'unit-math::kp1', status: '已掌握', correctStreak: 4 }),
        prog('unit-math', { knowledgePointId: 'unit-math::kp5', status: '已掌握', correctStreak: 10 }),
      ],
    })
    const s = storyOf(item({ id: 'perfect-kp' }), c, opts())
    expect(s.related).toEqual([{ label: '关联知识点', value: '知识点5 · 连对 10' }])
  })

  it('patience 用"答对 + 答错"的累计题量，不是连对数', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', {
          knowledgePointId: 'unit-math::kp2',
          status: '已掌握',
          correctCount: 18,
          wrongCount: 12,
          correctStreak: 2,
        }),
      ],
    })
    const s = storyOf(item({ id: 'patience', category: 'G' }), c, opts())
    expect(s.related).toEqual([{ label: '关联知识点', value: '知识点2 · 累计答对加答错共 30' }])
  })

  it('连对次数为 0 时不写"连对 0"这种句子', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', { knowledgePointId: 'unit-math::kp2', status: '已掌握', correctStreak: 0 }),
      ],
    })
    expect(storyOf(item({ id: 'perfect-kp' }), c, opts()).related).toEqual([])
  })

  it('early-bird 落到具体那一天的开始时刻（本地时区，两位补零）', () => {
    const early = new Date(2026, 9, 3, 6, 45).getTime()
    const later = new Date(2026, 9, 9, 7, 20).getTime()
    const c = ctx({
      dailyStats: [
        { date: '2026-10-09', questionCount: 5, firstStudyAt: later, lastStudyAt: later },
        { date: '2026-10-03', questionCount: 8, firstStudyAt: early, lastStudyAt: early },
      ],
    })
    const s = storyOf(item({ id: 'early-bird', category: 'B', earned: true }), c, opts())
    expect(s.related).toEqual([{ label: '最早的一天', value: '2026-10-03 06:45 开始学习' }])
  })

  it('night-owl 落到最晚的结束时刻', () => {
    const night = new Date(2026, 9, 7, 21, 5).getTime()
    const c = ctx({
      dailyStats: [{ date: '2026-10-07', questionCount: 3, firstStudyAt: night, lastStudyAt: night }],
    })
    const s = storyOf(item({ id: 'night-owl', category: 'B' }), c, opts())
    expect(s.related).toEqual([{ label: '最晚的一天', value: '2026-10-07 21:05 仍在学习' }])
  })

  it('comeback 只认"错够 3 次且最终已掌握"的知识点', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', {
          knowledgePointId: 'unit-math::kp6',
          status: '已掌握',
          wrongCount: 4,
        }),
        prog('unit-math', {
          knowledgePointId: 'unit-math::kp7',
          status: '已掌握',
          wrongCount: 1,
        }),
      ],
    })
    const s = storyOf(item({ id: 'comeback', category: 'G' }), c, opts())
    expect(s.related).toEqual([{ label: '走通过的知识点', value: '知识点6 · 错过 4 次' }])
  })

  it('comeback 找不到"错够 3 次"的知识点 → 空（不硬凑一行）', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: [
        prog('unit-math', { knowledgePointId: 'unit-math::kp7', status: '已掌握', wrongCount: 1 }),
      ],
    })
    expect(storyOf(item({ id: 'comeback', category: 'G' }), c, opts()).related).toEqual([])
  })

  it('subject-master-3 给分科枚数（降序）', () => {
    const c = ctx({
      packages: [
        pkg('unit-math', 'math', 100),
        pkg('unit-chinese', 'chinese', 100),
        pkg('unit-english', 'english', 100),
      ],
      progress: [
        ...mastered('unit-math', 12),
        ...mastered('unit-chinese', 10),
        ...mastered('unit-english', 10),
      ],
    })
    const s = storyOf(item({ id: 'subject-master-3' }), c, opts())
    expect(s.related).toEqual([{ label: '分科掌握', value: '数学 12 个 · 语文 10 个 · 英语 10 个' }])
  })
})

describe('storyOf · 结构性约束', () => {
  it('related 最多 2 条（一张卡上超过两行就成报表了）', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: mastered('unit-math', 10),
      streak: { current: 5, longest: 5, lastDate: '2026-10-19' },
      dailyStats: [{ date: '2026-10-19', questionCount: 20, firstStudyAt: 1, lastStudyAt: 2 }],
    })
    // 即使某个 builder 未来返回更多，也只会输出前 2 条
    expect(storyOf(item(), c, opts()).related.length).toBeLessThanOrEqual(2)
  })

  it('不修改入参（纯函数）', () => {
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: mastered('unit-math', 3),
    })
    const snapshot = JSON.stringify(c)
    const it0 = item()
    const itemSnapshot = JSON.stringify(it0)
    storyOf(it0, c, opts())
    expect(JSON.stringify(c)).toBe(snapshot)
    expect(JSON.stringify(it0)).toBe(itemSnapshot)
  })

  it('所有已解锁记录的 related 标签都在白名单内（防止未来加出"排名/最高"这类词）', () => {
    const ALLOWED = new Set([
      '最近掌握',
      '掌握概况',
      '最近攻克',
      '错题记录',
      '连续天数',
      '单日最多',
      '学过的学习包',
      '学科与学期',
      '关联知识点',
      '最早的一天',
      '最晚的一天',
      '走通过的知识点',
      '分科掌握',
    ])
    const c = ctx({
      packages: [pkg('unit-math', 'math', 100)],
      progress: mastered('unit-math', 5),
      streak: { current: 2, longest: 2, lastDate: '2026-10-19' },
      dailyStats: [{ date: '2026-10-19', questionCount: 20, firstStudyAt: 1, lastStudyAt: 2 }],
      mistakes: [mistake({ mastered: true })],
    })
    const ids = [
      'first-step', 'ten-kp', 'subject-master-3', 'perfect-kp', 'mastery-half',
      'mistake-first', 'review-20', 'patience', 'streak-master', 'comeback',
      'streak-3', 'daily-20', 'early-bird', 'night-owl',
      'explorer-3', 'type-collector', 'term-cross', 'senior-new',
    ]
    for (const id of ids) {
      const s = storyOf(item({ id }), c, opts())
      for (const row of s.related) expect(ALLOWED.has(row.label)).toBe(true)
    }
  })
})

describe('storyFileName', () => {
  it('内置 id 直接用', () => {
    expect(storyFileName('perfect-kp')).toBe('achievement-story-perfect-kp.png')
  })

  it('自定义包 id 里的脏字符折成 `-`，避免下载名被编码成一串 %E6', () => {
    expect(storyFileName('my pack/第1版')).toBe('achievement-story-my-pack-1.png')
  })

  it('全是非法字符 / 空串 → unknown（不能生成 `.png` 这种隐藏文件）', () => {
    expect(storyFileName('')).toBe('achievement-story-unknown.png')
    expect(storyFileName('///')).toBe('achievement-story-unknown.png')
  })

  it('超长 id 截断到 48 字符（给前缀与扩展名留空间）', () => {
    const name = storyFileName('a'.repeat(80))
    expect(name).toBe(`achievement-story-${'a'.repeat(48)}.png`)
  })
})
