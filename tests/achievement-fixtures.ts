/**
 * 成就相关测试的**共用夹具**（不是测试文件，vitest 的 include 只收 `*.test.ts`）。
 *
 * 这里刻意把上下文做成一组建构器 + 一组"典型场景"，
 * 让 `achievement-progress` / `achievement-meta` / `achievement-taxonomy` 三个测试
 * 用**同一批数据**验证不同层 —— 否则各写各的夹具，很容易出现
 * "进度测试说达标、判定测试说不达标"这种自相矛盾的绿灯。
 */
import type { AchievementContext, PackageMeta } from '@core/motivation/achievements'
import type { StreakState } from '@core/motivation/streak'

export function ctx(over: Partial<AchievementContext> = {}): AchievementContext {
  return {
    progress: [],
    mistakes: [],
    streak: { current: 0, longest: 0, lastDate: '' } satisfies StreakState,
    packages: [],
    dailyStats: [],
    attemptedTypes: [],
    ...over,
  }
}

export function pkg(
  packageId: string,
  subject: string,
  kpCount: number,
  term = 'up',
): PackageMeta {
  return { packageId, subject, grade: 4, term, packageType: 'unit', kpCount }
}

export function prog(packageId: string, over: Record<string, unknown> = {}) {
  return {
    packageId,
    knowledgePointId: `${packageId}::kp`,
    status: '学习中',
    correctCount: 0,
    wrongCount: 0,
    correctStreak: 0,
    wrongStreak: 0,
    lastStudiedAt: '2026-10-01T00:00:00.000Z',
    studySeconds: 0,
    ...over,
  } as any
}

export function mastered(packageId: string, n: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) =>
    prog(packageId, { knowledgePointId: `${packageId}::kp${i}`, status: '已掌握', ...over }),
  )
}

export function mistake(over: Record<string, unknown> = {}) {
  return {
    exerciseId: `ex-${Math.random().toString(36).slice(2, 8)}`,
    packageId: 'unit-math',
    knowledgePointId: 'unit-math::kp0',
    question: 'q',
    wrongAnswer: '',
    correctAnswer: '',
    mastered: true,
    reviewCorrectCount: 0,
    ...over,
  } as any
}

/**
 * 典型场景表（PRD AC-04 要求 ≥6 组：0 值 / 临界值 / 达标 / 超额 各覆盖）。
 * key 会出现在测试名里，便于定位是哪组数据挂了。
 */
export function scenarios(): Record<string, AchievementContext> {
  return {
    /** 全新用户：什么都没有 */
    '0 值': ctx(),

    /** 临界下方：9 个已掌握 → ten-kp 差 1；连续 2 天 → streak-3 差 1 */
    '临界值-': ctx({
      progress: mastered('unit-math', 9),
      packages: [pkg('unit-math', 'math', 100)],
      streak: { current: 2, longest: 2, lastDate: '2026-10-19' },
      dailyStats: [{ day: '2026-10-19', questionCount: 19, firstStudyAt: 0, lastStudyAt: 0 }] as any,
      attemptedTypes: ['single', 'blank', 'multiple', 'judge'],
    }),

    /** 正好临界：10 个已掌握 → ten-kp 刚好达标 */
    '临界值': ctx({
      progress: mastered('unit-math', 10),
      packages: [pkg('unit-math', 'math', 100)],
      streak: { current: 3, longest: 3, lastDate: '2026-10-19' },
      dailyStats: [{ day: '2026-10-19', questionCount: 20, firstStudyAt: 0, lastStudyAt: 0 }] as any,
      attemptedTypes: ['single', 'blank', 'multiple', 'judge', 'matching'],
    }),

    /** 单维超额：数学 120 个已掌握（其他学科 0） */
    '超额-单维': ctx({
      progress: mastered('unit-math', 120),
      packages: [pkg('unit-math', 'math', 300)],
      streak: { current: 31, longest: 31, lastDate: '2026-10-19' },
      dailyStats: [
        { day: '2026-10-19', questionCount: 40, firstStudyAt: 0, lastStudyAt: 0 },
      ] as any,
      attemptedTypes: ['single', 'blank', 'multiple', 'judge', 'matching', 'spelling'],
    }),

    /** 门槛未满足：掌握率 100%，但全库只有 10 个知识点（<20）→ mastery-half 必须不达标 */
    '门槛未满足': ctx({
      progress: mastered('unit-math', 10),
      packages: [pkg('unit-math', 'math', 10)],
    }),

    /** 三科并进：每科 10 个 → subject-master-3 达标；senior-new 也达标 */
    '多学科': ctx({
      progress: [
        ...mastered('unit-math', 10),
        ...mastered('unit-chinese', 10),
        ...mastered('unit-english', 10),
      ],
      packages: [
        pkg('unit-math', 'math', 40),
        pkg('unit-chinese', 'chinese', 40),
        pkg('unit-english', 'english', 40),
      ],
      streak: { current: 7, longest: 7, lastDate: '2026-10-19' },
      attemptedTypes: ['single', 'blank'],
    }),

    /** 几乎全达标：用来验"超额"方向不与 check 冲突 */
    '全达标': ctx({
      progress: [
        ...mastered('unit-math', 60),
        ...mastered('unit-chinese', 60),
        ...mastered('unit-english', 60),
        prog('unit-math', { knowledgePointId: 'unit-math::hard', correctStreak: 12, correctCount: 25, wrongCount: 8 }),
      ],
      mistakes: Array.from({ length: 60 }, () => mistake({ reviewCorrectCount: 1 })),
      packages: [
        pkg('unit-math', 'math', 60),
        pkg('unit-chinese', 'chinese', 60, 'down'),
        pkg('unit-english', 'english', 60),
      ],
      streak: { current: 100, longest: 100, lastDate: '2026-10-19' },
      dailyStats: [
        {
          day: '2026-10-19',
          questionCount: 45,
          firstStudyAt: new Date('2026-10-19T06:20:00').getTime(),
          lastStudyAt: new Date('2026-10-19T22:10:00').getTime(),
        },
      ] as any,
      attemptedTypes: ['single', 'blank', 'multiple', 'judge', 'matching', 'spelling', 'essay'],
    }),

    /** 连续天数断掉：历史最长 30 天，但今天已经断了 5 天 */
    '连续中断': ctx({
      progress: mastered('unit-math', 3),
      packages: [pkg('unit-math', 'math', 30)],
      streak: { current: 0, longest: 30, lastDate: '2026-10-14' },
    }),
  }
}
