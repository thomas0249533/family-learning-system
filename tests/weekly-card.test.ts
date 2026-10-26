import { describe, expect, it } from 'vitest'

/**
 * E3 · 周报卡片数据装配（`weeklyCard.ts`）单测
 * ------------------------------------------------------------------
 * 这个文件是**纯函数**测试：不碰 Dexie、不碰 pinia、不需要假库 ——
 * 装配入参全部注入（见 weeklyCard.ts 文件头"为什么是纯函数"）。
 *
 * 头号断言不是"某个数字对"，而是**口径与 reportGenerator 一致**：
 *   - 掌握率 / 学科分布必须与 `computeMasterySummary` / `masteryBySubject`
 *     逐项相等（Stage C 铁律：禁止第二套公式）；
 *   - 连续天数必须等于 `max(旧口径, effectiveCurrent(streak))`；
 *   - 高频错题必须与 reportGenerator 的算法同序同数（pending = !mastered）；
 *   - 成就必须走可收集口径（night-owl 不计入分母）。
 *
 * 日期一律本地构造（`new Date(y, m-1, d, ...)`），不写 `toISOString().slice`
 * —— 与 tests/date-discipline.test.ts 同一条纪律。
 */

import type { LearningPackageRecord, MistakeRecord, ProgressRecord } from '@/db'
import { computeMasterySummary, masteryBySubject } from '@core/mastery/masterySummary'
import { effectiveCurrent, EMPTY_STREAK, type StreakState } from '@core/motivation/streak'
import {
  WEEKLY_CARD_MAX_SUBJECTS,
  WEEKLY_CARD_MAX_TOP_MISTAKES,
  buildWeeklyCardData,
} from '@core/report/weeklyCard'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 固定"现在"：2026-10-15 10:00 本地时间（周四）。所有相对日期都由它推导 */
const NOW = new Date(2026, 9, 15, 10, 0, 0)

/** 本地日键（与 src 的 localDayKey 同口径；测试侧不 import 它，避免绕远） */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 一个三知识点的数学包 */
function mathPkg(): LearningPackageRecord {
  return {
    packageId: 'unit-math',
    manifest: { packageId: 'unit-math', type: 'unit', subject: 'math', grade: 4, term: 'up', title: '数学' },
    knowledgePoints: [
      { id: 'unit-math::kp1', title: '两位数乘法' },
      { id: 'unit-math::kp2', title: '带余除法' },
      { id: 'unit-math::kp3', title: '小数意义' },
    ],
    exercises: [],
    units: [],
  } as unknown as LearningPackageRecord
}

/** 一个两知识点的英语包（学科行要出现两行 → 测封顶） */
function englishPkg(): LearningPackageRecord {
  return {
    packageId: 'unit-english',
    manifest: { packageId: 'unit-english', type: 'unit', subject: 'english', grade: 4, term: 'up', title: '英语' },
    knowledgePoints: [
      { id: 'unit-english::kp1', title: '单词拼写' },
      { id: 'unit-english::kp2', title: '句型转换' },
    ],
    exercises: [],
    units: [],
  } as unknown as LearningPackageRecord
}

function progressRow(
  packageId: string,
  kpId: string,
  status: ProgressRecord['status'],
  opts: { daysAgo?: number; studySeconds?: number } = {}
): ProgressRecord {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - (opts.daysAgo ?? 0), 9, 0, 0)
  return {
    profileId: 'default',
    packageId,
    knowledgePointId: kpId,
    status,
    correctCount: status === '已掌握' ? 5 : 1,
    wrongCount: status === '需复习' ? 3 : 0,
    correctStreak: status === '已掌握' ? 4 : 0,
    wrongStreak: 0,
    lastStudiedAt: d.toISOString(),
    studySeconds: opts.studySeconds ?? 600,
  }
}

function mistakeRow(
  kpIds: string[],
  opts: { wrongCount?: number; mastered?: boolean; masteryLevel?: MistakeRecord['masteryLevel'] } = {}
): MistakeRecord {
  return {
    profileId: 'default',
    packageId: 'unit-math',
    exerciseId: `ex-${kpIds.join('-')}-${opts.wrongCount ?? 1}`,
    knowledgePointIds: kpIds,
    wrongAt: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 9, 0, 0).toISOString(),
    wrongCount: opts.wrongCount ?? 1,
    mastered: opts.mastered ?? false,
    masteryLevel: opts.masteryLevel,
  }
}

const streak = (o: Partial<StreakState>): StreakState => ({ ...EMPTY_STREAK, ...o })

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('weeklyCard · 空数据（全 0 卡，不抛）', () => {
  it('空库 → 全 0、空数组、成就 0/37、7 天全 0', () => {
    const card = buildWeeklyCardData({
      packages: [],
      progress: [],
      mistakes: [],
      streak: EMPTY_STREAK,
      unlockedAchievementIds: [],
      profileName: '我',
      now: NOW,
    })

    expect(card.generatedAt).toBe('2026-10-15')
    expect(card.rangeLabel).toBe('近 7 天')
    expect(card.profileName).toBe('我')
    expect(card.stats).toEqual({
      totalKnowledgePoints: 0,
      mastered: 0,
      learning: 0,
      needReview: 0,
      masteryRate: 0,
      totalStudyMinutes: 0,
      continuousDays: 0,
    })
    expect(card.subjects).toEqual([])
    expect(card.days).toHaveLength(7)
    expect(card.days.every((d) => d.count === 0 && d.heightPct === 0)).toBe(true)
    expect(card.weekTotal).toBe(0)
    expect(card.topMistakes).toEqual([])
    expect(card.mistakeStats).toEqual({ total: 0, unmastered: 0, partial: 0 })
    expect(card.achievements).toEqual({ unlocked: 0, total: 37 })
  })
})

describe('weeklyCard · 四状态覆盖 + 与 reportGenerator 口径一致', () => {
  const packages = [mathPkg(), englishPkg()]
  // 四个状态各至少一条：已掌握 / 学习中 / 需复习 / 未学（未学 = 不写进度行）
  const progress: ProgressRecord[] = [
    progressRow('unit-math', 'unit-math::kp1', '已掌握', { daysAgo: 0, studySeconds: 600 }),
    progressRow('unit-math', 'unit-math::kp2', '已掌握', { daysAgo: 1, studySeconds: 300 }),
    progressRow('unit-math', 'unit-math::kp3', '学习中', { daysAgo: 0, studySeconds: 120 }),
    progressRow('unit-english', 'unit-english::kp1', '需复习', { daysAgo: 3, studySeconds: 60 }),
  ]
  const mistakes: MistakeRecord[] = [
    mistakeRow(['unit-math::kp1'], { wrongCount: 5 }),
    mistakeRow(['unit-math::kp1'], { wrongCount: 2 }),
    mistakeRow(['unit-math::kp2'], { wrongCount: 1 }),
    // 已掌握：不计入 pending（Top 里不许出现），但计入 total
    mistakeRow(['unit-math::kp3'], { wrongCount: 9, mastered: true, masteryLevel: 'mastered' }),
  ]
  const streakState = streak({ current: 4, longest: 6, lastDate: dayKey(NOW) })

  const card = buildWeeklyCardData({
    packages,
    progress,
    mistakes,
    streak: streakState,
    unlockedAchievementIds: ['first-step', 'night-owl'],
    profileName: '老大',
    now: NOW,
  })

  it('★ 掌握率四桶与 computeMasterySummary 逐项相等（禁止第二套公式）', () => {
    const s = computeMasterySummary(packages, progress)
    expect(card.stats.totalKnowledgePoints).toBe(s.total)
    expect(card.stats.mastered).toBe(s.mastered)
    expect(card.stats.learning).toBe(s.learning)
    expect(card.stats.needReview).toBe(s.needReview)
    expect(card.stats.masteryRate).toBe(s.rate)
    // 四状态覆盖的自查：5 个 KP（math 3 + english 2）→ 2 已掌握 / 1 学习中 / 1 需复习 / 1 未学
    expect(s.total).toBe(5)
    expect([s.mastered, s.learning, s.needReview, s.notStarted]).toEqual([2, 1, 1, 1])
  })

  it('★ 学科行与 masteryBySubject 同源（含中文标签），且封顶 4 行', () => {
    const expected = masteryBySubject(packages, progress).map((s) => ({
      subject: s.subject,
      label: s.subject === 'math' ? '数学' : s.subject === 'english' ? '英语' : s.subject,
      total: s.total,
      mastered: s.mastered,
      masteryRate: s.rate,
    }))
    expect(card.subjects).toEqual(expected.slice(0, WEEKLY_CARD_MAX_SUBJECTS))
    expect(card.subjects.length).toBeLessThanOrEqual(WEEKLY_CARD_MAX_SUBJECTS)
  })

  it('★ 连续天数 = max(旧口径, effectiveCurrent(streak))', () => {
    // 旧口径：progress 里有今天与昨天的学习日 → 连续 2 天
    // 打卡口径：lastDate = 今天、current = 4 → 4。取大 → 4
    expect(card.stats.continuousDays).toBe(
      Math.max(2, effectiveCurrent(streakState, NOW))
    )
    expect(card.stats.continuousDays).toBe(4)
  })

  it('连续天数：没有打卡记录时回落到旧口径（不因缺 streak 归零）', () => {
    const noStreak = buildWeeklyCardData({
      packages,
      progress,
      mistakes,
      streak: EMPTY_STREAK,
      unlockedAchievementIds: [],
      profileName: '老大',
      now: NOW,
    })
    expect(noStreak.stats.continuousDays).toBe(2)
  })

  it('★ 高频错题：pending=!mastered、wrongCount 求和、降序、封顶 5', () => {
    // kp1 错 5+2=7 次（第一），kp2 错 1 次；kp3 已掌握 → 不进
    expect(card.topMistakes).toEqual([
      { kpId: 'unit-math::kp1', title: '两位数乘法', count: 7 },
      { kpId: 'unit-math::kp2', title: '带余除法', count: 1 },
    ])
    expect(card.topMistakes.length).toBeLessThanOrEqual(WEEKLY_CARD_MAX_TOP_MISTAKES)
    // 错题存量：total 含已掌握，unmastered/partial 照 reportGenerator 口径
    expect(card.mistakeStats).toEqual({ total: 4, unmastered: 3, partial: 0 })
  })

  it('高频错题封顶：7 个不同 KP → 只出 5 行（按 count 降序取前 5）', () => {
    // 造一个 7 KP 的包，错题 count 9..3 → 期望输出 9,8,7,6,5
    const kpIds = Array.from({ length: 7 }, (_, i) => `unit-spread::kp${i + 1}`)
    const spreadPkg: LearningPackageRecord = {
      packageId: 'unit-spread',
      manifest: { packageId: 'unit-spread', type: 'unit', subject: 'math', grade: 4, term: 'up', title: '数学' },
      knowledgePoints: kpIds.map((id, i) => ({ id, title: `知识点${i + 1}` })),
      exercises: [],
      units: [],
    } as unknown as LearningPackageRecord
    const spread: MistakeRecord[] = kpIds.map((kpId, i) =>
      mistakeRow([kpId], { wrongCount: 9 - i })
    )

    const c = buildWeeklyCardData({
      packages: [spreadPkg],
      progress: [],
      mistakes: spread,
      streak: EMPTY_STREAK,
      unlockedAchievementIds: [],
      profileName: '老大',
      now: NOW,
    })
    expect(c.topMistakes.map((t) => t.count)).toEqual([9, 8, 7, 6, 5])
    expect(c.topMistakes).toHaveLength(WEEKLY_CARD_MAX_TOP_MISTAKES)
  })

  it('★ 近 7 天：本地日边界，今天/昨天有记录，合计 4', () => {
    // kp1 今天 + kp3 今天 + kp2 昨天 → 今天 2、昨天 1；kp-english 是 3 天前（窗口内但算 3 天前那天）
    const byDate = new Map(card.days.map((d) => [d.date, d.count]))
    expect(byDate.get(dayKey(NOW))).toBe(2)
    expect(byDate.get(dayKey(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1)))).toBe(1)
    expect(card.days).toHaveLength(7)
    expect(card.weekTotal).toBe(4)
    // 星期标签是本地口径（NOW 是周四 → '四'）
    expect(card.days[6].label).toBe('四')
    expect(card.days[6].date).toBe('2026-10-15')
    // 柱高：有数据的保底 10%，最大值 100%
    expect(card.days[6].heightPct).toBe(100)
    expect(card.days[5].heightPct).toBe(50)
    expect(card.days[0].heightPct).toBe(0)
  })

  it('★ 成就可收集口径：night-owl 不计入已解锁', () => {
    expect(card.achievements).toEqual({ unlocked: 1, total: 37 })
  })

  it('累计分钟：studySeconds 求和取整', () => {
    // 600+300+120+60 = 1080s = 18min
    expect(card.stats.totalStudyMinutes).toBe(18)
  })
})
