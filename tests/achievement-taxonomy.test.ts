import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '@core/motivation/achievements'
import {
  SOURCE_META,
  TAXONOMY,
  TIER_META,
  deriveTier,
  missingTaxonomy,
  sourceOf,
  tierOf,
  tierStars,
  type AchievementSource,
  type AchievementTier,
} from '@core/motivation/achievementTaxonomy'

/**
 * 成就分类学测试（V1.3 · A-01，对应 PRD §4.1 / §4.2）
 *
 * 两件事：
 *   1. `source`（来源）与 `tier`（层级）**逐条与 PRD 的表比对** —— 表是契约，不是注释；
 *   2. 层级必须是**规则算出来的**：`deriveTier(facts)` 要能被穷举验证，
 *      这样"为什么这枚是稀有"永远答得出一句人话（"因为要连续 30 天"）。
 */

/** PRD §4.5「逐条规则表」里的层级列（**契约快照**，改层级必须先改这张表 + PRD） */
const EXPECTED_TIER: Record<string, AchievementTier> = {
  'first-step': 'common',
  'ten-kp': 'advanced',
  'fifty-kp': 'rare',
  'hundred-kp': 'rare',
  'kp-300': 'rare',
  'subject-master-3': 'rare',
  'perfect-kp': 'advanced',
  'mastery-half': 'rare',
  'mistake-first': 'common',
  'mistake-cleaner': 'advanced',
  'mistake-cleaner-50': 'rare',
  comeback: 'hidden',
  'review-20': 'advanced',
  patience: 'advanced',
  'streak-master': 'advanced',
  'streak-3': 'common',
  'streak-7': 'advanced',
  'streak-30': 'rare',
  'streak-60': 'rare',
  'streak-100': 'rare',
  'early-bird': 'hidden',
  'night-owl': 'hidden',
  'daily-20': 'advanced',
  'explorer-3': 'common',
  'explorer-10': 'advanced',
  'type-collector': 'advanced',
  'term-cross': 'advanced',
  'senior-new': 'common',
}

/** PRD §4.1「映射表（28 枚逐条归属）」 */
const EXPECTED_SOURCE: Record<string, AchievementSource> = {
  // M
  'first-step': 'core',
  'perfect-kp': 'core',
  'ten-kp': 'subject',
  'fifty-kp': 'subject',
  'hundred-kp': 'subject',
  'kp-300': 'subject',
  'subject-master-3': 'subject',
  'mastery-half': 'subject',
  // G
  'mistake-first': 'core',
  'review-20': 'core',
  patience: 'core',
  'streak-master': 'core',
  'mistake-cleaner': 'subject',
  'mistake-cleaner-50': 'subject',
  comeback: 'hidden',
  // B
  'streak-3': 'habit',
  'streak-7': 'habit',
  'streak-30': 'habit',
  'streak-60': 'habit',
  'streak-100': 'habit',
  'daily-20': 'core',
  'early-bird': 'hidden',
  'night-owl': 'hidden',
  // E
  'explorer-3': 'subject',
  'explorer-10': 'subject',
  'type-collector': 'subject',
  'term-cross': 'subject',
  'senior-new': 'subject',
}

describe('覆盖率', () => {
  it('28 枚全部登记了 source 与层级事实', () => {
    expect(missingTaxonomy()).toEqual([])
    expect(Object.keys(TAXONOMY)).toHaveLength(28)
  })

  it('分类学表里没有多余条目（拼错 id 的孤儿）', () => {
    const known = new Set(ACHIEVEMENTS.map((a) => a.id))
    for (const id of Object.keys(TAXONOMY)) expect(known.has(id)).toBe(true)
  })
})

describe('source 来源（PRD §4.1）', () => {
  it('逐条与映射表一致', () => {
    for (const [id, expected] of Object.entries(EXPECTED_SOURCE)) {
      expect(sourceOf(id), `${id} 的来源不对`).toBe(expected)
    }
  })

  it('分布：core 7 · subject 13 · habit 5 · hidden 3 = 28', () => {
    const count: Record<string, number> = {}
    for (const a of ACHIEVEMENTS) count[sourceOf(a.id)] = (count[sourceOf(a.id)] ?? 0) + 1
    expect(count).toEqual({ core: 7, subject: 13, habit: 5, hidden: 3 })
  })

  it('每个来源都有展示元数据（家长端筛选要用）', () => {
    for (const s of ['core', 'subject', 'habit', 'hidden'] as AchievementSource[]) {
      expect(SOURCE_META[s].label).not.toBe('')
      expect(SOURCE_META[s].desc).not.toBe('')
    }
  })
})

describe('tier 稀有层级（PRD §4.2 / §4.5）', () => {
  it('逐条与规则表一致（28/28）', () => {
    for (const [id, expected] of Object.entries(EXPECTED_TIER)) {
      expect(tierOf(id), `${id} 的层级不对`).toBe(expected)
    }
  })

  it('分布：常见 5 · 进阶 11 · 稀有 9 · 隐藏 3 = 28', () => {
    const count: Record<string, number> = {}
    for (const a of ACHIEVEMENTS) count[tierOf(a.id)] = (count[tierOf(a.id)] ?? 0) + 1
    expect(count).toEqual({ common: 5, advanced: 11, rare: 9, hidden: 3 })
  })

  it('hidden 字段与 hidden 层级完全对齐（双向）', () => {
    for (const a of ACHIEVEMENTS) {
      expect(tierOf(a.id) === 'hidden', `${a.id} 的 hidden 标记与层级不一致`).toBe(a.hidden === true)
    }
  })
})

describe('deriveTier 规则本身（穷举边界）', () => {
  it('优先级：隐藏 > 首次发生 > 稀有 > 进阶 > 常见', () => {
    // hidden 压倒一切，哪怕目标值 300
    expect(deriveTier({ hidden: true, target: 300, streak: 100 })).toBe('hidden')
    // 首次发生压倒"涉及多学科"（senior-new 的补充条款）
    expect(deriveTier({ firstOccurrence: true, subjectCount: 3, crossTerm: true })).toBe('common')
  })

  it('稀有：目标 ≥50 / 连续 ≥30 / 掌握率 ≥50% / 学科 ≥3，任一命中', () => {
    expect(deriveTier({ target: 50 })).toBe('rare')
    expect(deriveTier({ target: 49 })).toBe('advanced')
    expect(deriveTier({ streak: 30 })).toBe('rare')
    expect(deriveTier({ streak: 29 })).toBe('advanced')
    expect(deriveTier({ masteryRate: 50 })).toBe('rare')
    // PRD 只把"掌握率 ≥50%"归入稀有，没给进阶档的掌握率区间；
    // 当前 28 枚里唯一的掌握率成就（mastery-half）门槛正是 50，不受影响。
    expect(deriveTier({ masteryRate: 49 })).toBe('common')
    expect(deriveTier({ subjectCount: 3 })).toBe('rare')
    expect(deriveTier({ subjectCount: 2 })).toBe('common')
  })

  it('进阶：目标 5–49 / 连续 5–29 / 跨学期', () => {
    expect(deriveTier({ target: 5 })).toBe('advanced')
    expect(deriveTier({ target: 4 })).toBe('common')
    expect(deriveTier({ streak: 5 })).toBe('advanced')
    expect(deriveTier({ streak: 4 })).toBe('common')
    expect(deriveTier({ crossTerm: true })).toBe('advanced')
  })

  it('常见：目标 ≤4 且单一维度', () => {
    expect(deriveTier({ target: 1 })).toBe('common')
    expect(deriveTier({})).toBe('common')
  })
})

describe('层级 → 视觉（颜色不是唯一编码）', () => {
  it('星标数量：常见 0 · 进阶 1 · 稀有 2', () => {
    expect(tierStars('first-step')).toBe(0)
    expect(tierStars('ten-kp')).toBe(1)
    expect(tierStars('fifty-kp')).toBe(2)
  })

  it('儿童视图不出现"稀有/史诗/SSR"字样 —— 层级名只给家长端', () => {
    expect(TIER_META.common.label).toBe('常见')
    expect(TIER_META.advanced.label).toBe('进阶')
    expect(TIER_META.rare.label).toBe('稀有')
    // 读屏用的中性描述
    expect(TIER_META.advanced.ariaSuffix).toBe('层级：进阶')
  })

  it('未知 id 退化为常见而不是崩溃', () => {
    expect(tierOf('nope')).toBe('common')
    expect(sourceOf('nope')).toBe('core')
  })
})
