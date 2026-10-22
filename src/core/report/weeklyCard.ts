/**
 * E3 · 家长周报卡片数据装配（纯函数，可单测）
 * =====================================================================
 * 把"一屏摘要"需要的全部数字算成一份快照（`WeeklyCardData`），
 * UI（`WeeklyReportCard.vue`）只负责画。分工与 `reportGenerator.ts` 相同：
 * 能测的逻辑留在 core，DOM 相关的不测。
 *
 * ## 口径铁律：一律照 `reportGenerator.ts` 的既有先例，禁止另写公式
 *   - 掌握率 / 学科分布：`computeMasterySummary` + `masteryBySubject`
 *     （Stage C 铁律，全仓唯一实现，本文件直接复用）；
 *   - 连续天数：`max(streak.current, 旧口径)` —— 旧口径就是
 *     `computeContinuousDays`（同步版），打卡口径就是 `effectiveCurrent`，
 *     与 `resolveContinuousDays` 逐行同构，只是它自己读库、这里由调用方注入；
 *   - 日期边界：`localDayKey`（UTC 截断式日键是违禁写法，见
 *     `tests/date-discipline.test.ts` 的静态扫描）；
 *   - 高频错题：pending = `!mastered`，按 `wrongCount` 求和取前 N；
 *   - 成就：可收集口径（`ACHIEVEMENT_TOTAL_COLLECTIBLE` + `isCollectible`，
 *     与 Parent.vue 成就概览同一个分母 27）。
 *
 * ## 为什么是纯函数、入参全注入（与 reportGenerator 不同）
 * reportGenerator 自己读库，因为它的调用方（Report.vue）只有"打开页面"一个入口。
 * 周报卡片是**快照语义**：家长点「生成周报卡片」那一刻的数据冻结成卡，
 * 之后页面数据再变（孩子又答了题）也不该改了这张卡。所以入参全部由调用方
 * （Parent.vue）从 store 现取，本函数只做计算 —— 单测因此不需要假库，
 * 也不需要冻结全局时钟（`now` 可注入）。
 */

import type { LearningPackageRecord, MistakeRecord, ProgressRecord } from '@/db'
import { computeMasterySummary, masteryBySubject } from '@core/mastery/masterySummary'
import { mistakeLevel } from '@core/mistake/mistakeRules'
import {
  ACHIEVEMENT_TOTAL_COLLECTIBLE,
  isCollectible,
} from '@core/motivation/achievements'
import { effectiveCurrent, localDayKey, type StreakState } from '@core/motivation/streak'
import {
  SUBJECT_LABEL,
  computeContinuousDays,
  computeRecent7Days,
} from './reportGenerator'

/**
 * 摘要行数封顶（为 OOM 预防铺路）。
 *
 * 卡片是**截图源**：行数无上界 = PNG 尺寸无上界 = `html2canvas` 的内存无上界。
 * 装配时就截断，导出侧（`weeklyCardExporter.ts`）还有一道 DOM 计数防线。
 */
export const WEEKLY_CARD_MAX_TOP_MISTAKES = 5
export const WEEKLY_CARD_MAX_SUBJECTS = 4

export interface WeeklyCardSubjectRow {
  subject: string
  label: string
  total: number
  mastered: number
  /** 0..100 */
  masteryRate: number
}

export interface WeeklyCardTopRow {
  kpId: string
  title: string
  count: number
}

export interface WeeklyCardDayRow {
  /** 本地日键 `YYYY-MM-DD` */
  date: string
  /** 星期标签（'日' … '六'） */
  label: string
  count: number
  /** 柱高百分比 0~100（有数据的保底 10%，与 Parent.vue 的 `barHeight` 同形） */
  heightPct: number
}

export interface WeeklyCardStats {
  totalKnowledgePoints: number
  mastered: number
  learning: number
  needReview: number
  /** 0..100 */
  masteryRate: number
  totalStudyMinutes: number
  continuousDays: number
}

export interface WeeklyCardData {
  /** 生成日期（本地日键） */
  generatedAt: string
  /** 时间范围文案（固定「近 7 天」） */
  rangeLabel: string
  profileName: string
  stats: WeeklyCardStats
  /** 学科行（已封顶 `WEEKLY_CARD_MAX_SUBJECTS`） */
  subjects: WeeklyCardSubjectRow[]
  /** 近 7 天（恒定 7 行） */
  days: WeeklyCardDayRow[]
  weekTotal: number
  /** 高频错题（已封顶 `WEEKLY_CARD_MAX_TOP_MISTAKES`） */
  topMistakes: WeeklyCardTopRow[]
  mistakeStats: {
    total: number
    unmastered: number
    partial: number
  }
  achievements: {
    /** 已解锁（可收集口径） */
    unlocked: number
    /** 可收集总数（27；彩蛋 night-owl 不计入，与家长端成就概览同源） */
    total: number
  }
}

export interface WeeklyCardInput {
  packages: LearningPackageRecord[]
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  /** 打卡状态（当前档案） */
  streak: StreakState
  /** 已解锁成就 id 列表（原样传入；可收集过滤在本函数内统一收口） */
  unlockedAchievementIds: readonly string[]
  /** 档案名（卡头展示） */
  profileName: string
  /** 生成时刻，默认 `new Date()` */
  now?: Date
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 本地日键 → 星期标签。按**本地**日期解析（`new Date(y, m-1, d)`），不碰 UTC。 */
function weekdayLabelOf(localDay: string): string {
  const [y, m, d] = localDay.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ''
  return WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()] ?? ''
}

/**
 * 高频错题 Top N。
 *
 * 口径逐行照 `reportGenerator.ts` 的错题统计：pending = `!mastered`
 * （注意**不是**三级状态过滤 —— 部分掌握仍算待巩固，要出现在 Top 里），
 * 同一 kp 多次出现按 `wrongCount` 求和，标题取包的 `knowledgePoints`
 * （后写入的包覆盖先写入的，与 reportGenerator 的 map 构建同序），
 * 计数降序 + 稳定排序（Map 迭代序即插入序，与输入顺序一致 → 确定）。
 */
function topMistakeRows(
  packages: LearningPackageRecord[],
  mistakes: MistakeRecord[]
): WeeklyCardTopRow[] {
  const kpIdToTitle = new Map<string, string>()
  for (const pkg of packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      if (kp?.id) kpIdToTitle.set(kp.id, kp.title)
    }
  }

  const countMap = new Map<string, number>()
  for (const m of mistakes) {
    if (m.mastered) continue
    for (const kpId of m.knowledgePointIds ?? []) {
      countMap.set(kpId, (countMap.get(kpId) ?? 0) + m.wrongCount)
    }
  }

  return Array.from(countMap.entries())
    .map(([kpId, count]) => ({ kpId, title: kpIdToTitle.get(kpId) ?? kpId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, WEEKLY_CARD_MAX_TOP_MISTAKES)
}

/**
 * 装配周报卡片数据（纯函数）。
 *
 * 输入全部由调用方从 store 现取（快照语义见文件头）；本函数不碰 Dexie、
 * 不碰 pinia、不抛异常 —— 畸形输入只被 clamp 或计 0（空库 → 全 0 卡，
 * 那是一张有效的"这一周还没有记录"卡）。
 */
export function buildWeeklyCardData(input: WeeklyCardInput): WeeklyCardData {
  const now = input.now ?? new Date()

  // ---- 掌握率 / 学科分布：Stage C 铁律，唯一实现 ----
  const summary = computeMasterySummary(input.packages, input.progress)
  const subjects = masteryBySubject(input.packages, input.progress)
    .slice(0, WEEKLY_CARD_MAX_SUBJECTS)
    .map((s) => ({
      subject: s.subject,
      label: SUBJECT_LABEL[s.subject] ?? s.subject,
      total: s.total,
      mastered: s.mastered,
      masteryRate: s.rate,
    }))

  // ---- 连续天数：max(旧口径, 打卡口径)（resolveContinuousDays 的同步同构）----
  const legacy = computeContinuousDays(input.progress, now)
  const continuousDays = input.streak.lastDate
    ? Math.max(legacy, effectiveCurrent(input.streak, now))
    : legacy

  // ---- 错题统计（口径照 reportGenerator.ts:102-103）----
  const unmastered = input.mistakes.filter((m) => !m.mastered).length
  const partial = input.mistakes.filter((m) => mistakeLevel(m) === 'partial').length

  // ---- 近 7 天：本地日边界（computeRecent7Days 同口径），补标签与柱高 ----
  const rawDays = computeRecent7Days(input.progress, now)
  const maxCount = Math.max(...rawDays.map((d) => d.count), 1)
  const days: WeeklyCardDayRow[] = rawDays.map((d) => ({
    date: d.date,
    label: weekdayLabelOf(d.date),
    count: d.count,
    heightPct: Math.max((d.count / maxCount) * 100, d.count > 0 ? 10 : 0),
  }))

  return {
    generatedAt: localDayKey(now),
    rangeLabel: '近 7 天',
    profileName: input.profileName,
    stats: {
      totalKnowledgePoints: summary.total,
      mastered: summary.mastered,
      learning: summary.learning,
      needReview: summary.needReview,
      masteryRate: summary.rate,
      totalStudyMinutes: Math.round(
        input.progress.reduce((sum, p) => sum + (p.studySeconds ?? 0), 0) / 60
      ),
      continuousDays,
    },
    subjects,
    days,
    weekTotal: days.reduce((sum, d) => sum + d.count, 0),
    topMistakes: topMistakeRows(input.packages, input.mistakes),
    mistakeStats: {
      total: input.mistakes.length,
      unmastered,
      partial,
    },
    achievements: {
      // 可收集口径统一收口在这里：彩蛋（night-owl）照旧留档、不进分母
      unlocked: input.unlockedAchievementIds.filter(isCollectible).length,
      total: ACHIEVEMENT_TOTAL_COLLECTIBLE,
    },
  }
}
