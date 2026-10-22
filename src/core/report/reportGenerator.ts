import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { computeMasterySummary, masteryBySubject } from '@core/mastery/masterySummary'
import type { ProgressRecord } from '@/db'
import { effectiveCurrent, loadStreak, localDayKey } from '@core/motivation/streak'
import { mistakeLevel } from '@core/mistake/mistakeRules'
export interface ReportData {
  generatedAt: string
  rangeLabel: string
  stats: {
    totalKnowledgePoints: number
    mastered: number
    learning: number
    needReview: number
    notStarted: number
    masteryRate: number
    totalStudyMinutes: number
    continuousDays: number
  }
  subjectBreakdown: Array<{
    subject: string
    label: string
    total: number
    mastered: number
    masteryRate: number
  }>
  mistakeStats: {
    total: number
    unmastered: number
    /** P3 · 部分掌握（复习答对过 1 次，仍算待巩固） */
    partial: number
    topKnowledgePoints: Array<{ title: string; count: number }>
  }
  reviewStats: {
    dueToday: number
    dueThisWeek: number
  }
  recent7Days: Array<{ date: string; count: number }>
}

/**
 * 学科中文名（E3 周报卡片复用，**不另造一张映射表** —— 两张卡上的
 * 「数学」必须是同一处定义，否则改一处漏一处）。
 */
export const SUBJECT_LABEL: Record<string, string> = {
  math: '数学',
  chinese: '语文',
  english: '英语',
}

/**
 * 生成学习报告数据
 */
export async function generateReportData(): Promise<ReportData> {
  const packages = await db.packages.toArray()
  // V1.4 · B1：报告必须只看**当前档案**。漏了这两行过滤的后果不是报错，
  // 而是家长端报告里混进另一个孩子的进度与错题 —— 数字看起来还挺"合理"。
  const pid = currentProfileId()
  const progress = await db.progress.where('profileId').equals(pid).toArray()
  const mistakes = await db.mistakes.where('profileId').equals(pid).toArray()

  // 1. 全局统计
  const allKpIds = new Set<string>()
  const kpIdToPkgId = new Map<string, string>()
  const kpIdToTitle = new Map<string, string>()
  for (const pkg of packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      allKpIds.add(kp.id)
      kpIdToPkgId.set(kp.id, pkg.packageId)
      kpIdToTitle.set(kp.id, kp.title)
    }
  }

  // V1.3 · T04：掌握率统一口径（去重 + 两层收敛）。
  // 旧实现分母是 `Set(裸 kp.id)`：english-7 有 49 个不同知识点共用 7 个裸 id，
  // 分母被压成 7 而分子照旧按行数算 → 掌握率常年 >100%。notStarted 也因
  // `total - progress.length` 而可能为负。统一后 I1~I4 由 computeMasterySummary 保证。
  const summary = computeMasterySummary(packages, progress)
  const totalKnowledgePoints = summary.total
  const mastered = summary.mastered
  const learning = summary.learning
  const needReview = summary.needReview
  const notStarted = summary.notStarted
  const masteryRate = summary.rate

  const totalStudyMinutes = Math.round(
    progress.reduce((sum, p) => sum + (p.studySeconds ?? 0), 0) / 60
  )

  const continuousDays = await resolveContinuousDays(progress)

  // 2. 学科统计
  const pkgIdToSubject = new Map<string, string>()
  for (const pkg of packages) pkgIdToSubject.set(pkg.packageId, pkg.manifest.subject)

  // 学科分布同样走共享实现（分母分子都与整体掌握率同源）
  const subjectBreakdown = masteryBySubject(packages, progress).map((s) => ({
    subject: s.subject,
    label: SUBJECT_LABEL[s.subject] ?? s.subject,
    total: s.total,
    mastered: s.mastered,
    masteryRate: s.rate,
  }))

  // 3. 错题统计
  const pendingMistakes = mistakes.filter(m => !m.mastered)
  const partialMistakes = mistakes.filter(m => mistakeLevel(m) === 'partial')
  const kpMistakeCount = new Map<string, number>()
  for (const m of pendingMistakes) {
    for (const kpId of m.knowledgePointIds ?? []) {
      kpMistakeCount.set(kpId, (kpMistakeCount.get(kpId) ?? 0) + m.wrongCount)
    }
  }
  const topKnowledgePoints = Array.from(kpMistakeCount.entries())
    .map(([kpId, count]) => ({ title: kpIdToTitle.get(kpId) ?? kpId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // 4. 复习统计
  const now = Date.now()
  const weekLater = now + 7 * 86400000
  const dueToday = progress.filter(p =>
    p.nextReviewAt && new Date(p.nextReviewAt).getTime() <= now
  ).length
  const dueThisWeek = progress.filter(p => {
    if (!p.nextReviewAt) return false
    const t = new Date(p.nextReviewAt).getTime()
    return t > now && t <= weekLater
  }).length

  // 5. 近 7 天学习
  const recent7Days = computeRecent7Days(progress)

  return {
    generatedAt: new Date().toISOString(),
    rangeLabel: '累计学习报告',
    stats: {
      totalKnowledgePoints,
      mastered,
      learning,
      needReview,
      notStarted,
      masteryRate,
      totalStudyMinutes,
      continuousDays,
    },
    subjectBreakdown,
    mistakeStats: {
      total: mistakes.length,
      unmastered: pendingMistakes.length,
      partial: partialMistakes.length,
      topKnowledgePoints,
    },
    reviewStats: { dueToday, dueThisWeek },
    recent7Days,
  }
}

/**
 * 连续天数：与首页「连续打卡」共用同一份数据源。
 *
 * 两个来源口径不同（打卡记录按本地日期计、历史数据按 lastStudiedAt 推算），
 * 取较大值，保证升级后这个数字不会比升级前变小——只升不降。
 *
 * E3 导出（`export`）供周报卡片复用：**禁止在别处另写一套连续天数公式** ——
 * 两处口径漂移的表现是"报告说 5 天、周报卡说 3 天"，而两个数都没有错，
 * 只是算的不是同一件事。
 */
export async function resolveContinuousDays(progress: ProgressRecord[]): Promise<number> {
  const legacy = computeContinuousDays(progress)
  try {
    const streak = await loadStreak()
    if (!streak.lastDate) return legacy
    return Math.max(legacy, effectiveCurrent(streak))
  } catch {
    return legacy
  }
}

/**
 * 旧口径连续天数（同步、只读 progress 行）。
 *
 * `now` 可注入（默认 `new Date()`）：E3 周报卡片是快照语义，装配时刻
 * 由调用方给定，测试因此不需要冻结全局时钟。
 */
export function computeContinuousDays(progress: ProgressRecord[], now: Date = new Date()): number {
  const days = new Set<string>()
  for (const p of progress) {
    if (!p.lastStudiedAt) continue
    // `lastStudiedAt` 存的是 UTC ISO 串，直接 slice 得到的是 **UTC 日期**；
    // 而下面要比的是本地日历日，两边口径必须一致，否则东八区下差一天。
    days.add(localDayKey(new Date(p.lastStudiedAt)))
  }
  const sorted = Array.from(days).sort().reverse()
  if (sorted.length === 0) return 0

  let streak = 0
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  for (let i = 0; i < sorted.length; i++) {
    const expect = new Date(today.getTime() - i * 86400000)
    // 关键：用本地日键。旧实现把 UTC 串截十位当日键，东八区下本地零点转 UTC 会
    // 退到前一天，于是"今天学过"永远对不上"今天的键"，连续天数恒为 0。
    // 规范见 tests/date-discipline.test.ts（那条扫描禁止在源码里写 UTC 日键）。
    const expectStr = localDayKey(expect)
    if (sorted[i] === expectStr) streak++
    else break
  }
  return streak
}

/**
 * 近 7 天学习（本地日边界）。
 *
 * `now` 可注入（默认 `new Date()`），理由同 `computeContinuousDays`。
 */
export function computeRecent7Days(
  progress: ProgressRecord[],
  now: Date = new Date()
): Array<{ date: string; count: number }> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const result: Array<{ date: string; count: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    // 同上：柱状图的日期键必须是本地日，否则整张图会整体错位一天。
    const dateStr = localDayKey(d)
    const count = progress.filter(
      p => p.lastStudiedAt && localDayKey(new Date(p.lastStudiedAt)) === dateStr
    ).length
    result.push({ date: dateStr, count })
  }
  return result
}
