/**
 * 今日任务编排 · IO 层（V3.0 · M1）
 * ---------------------------------------------------------------------
 * 本文件只做三件事，**不含任何产品规则**（规则全在 `dailyPlan.ts`）：
 *   1. 把库里的 progress / mistakes / 包结构，拼成 `PlanCandidate[]`；
 *   2. 读 / 写 / 冻结「今日队列」与「每日目标」；
 *   3. 把标记完成写回库（幂等）。
 *
 * ## 为什么要把"拼候选"独立成一个可缓存的索引
 * 一个知识点要变成一条任务，需要知道它**在哪个包的哪个单元的哪个主题里**，
 * 而 `findUnitByKnowledgePoint(pkg, kpId)` 每次调用都会重新 `resolvePackageUnits`
 * （里面还有若干次 `db.packages.get`）。逐条调用 = 几百次 DB 往返，
 * 首页会转圈两秒。所以这里一次遍历建三张索引，之后全是内存查表。
 *
 * ## 索引为什么键是 `(包, 知识点)` 二元组
 * 与 `Review.vue`、`ownerIndex` 同一口径：同一份教材的单元包和学期包里，
 * kpId 可能同名（都叫 `kp-1`），用裸 kpId 做键会「后者覆盖前者」，
 * 于是任务标题是数学的、点进去跳到语文。分隔符用 `\u0000`。
 */

import { db, type LearningPackageRecord } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'
import { isDueForReview } from '@core/review/reviewScheduler'
import { mistakeLevel, needsReview } from '@core/mistake/mistakeRules'
import { resolvePackageUnits } from '@core/importer/resolvePackageUnits'
import { localDayKey } from '@core/motivation/streak'
import { subjectLabelOf } from '@core/ai/prompt'
import { stripPrefix } from '@core/progress/ownerIndex'
import {
  buildDailyPlan,
  isPlanStale,
  markItemDone,
  normalizeGoal,
  type DailyGoal,
  type DailyPlan,
  type PlanCandidate,
} from './dailyPlan'

const GOAL_BASE = 'dailyGoal'
const PLAN_BASE = 'dailyPlan'

/**
 * 空队列的重算冷却。60 秒足够覆盖"刚导入完就切到今日页"，
 * 又不至于每次导航都重扫全部包。
 */
const EMPTY_RETRY_MS = 60_000

/** 目标键（漏分片 → 换孩子后目标还是哥哥的 24 题，且不报错） */
export function dailyGoalKey(pid: string = currentProfileId()): string {
  return scopedKey(GOAL_BASE, pid)
}

/** 队列键 */
export function dailyPlanKey(pid: string = currentProfileId()): string {
  return scopedKey(PLAN_BASE, pid)
}

// ===========================================================================
// 目标
// ===========================================================================

export async function loadDailyGoal(): Promise<DailyGoal> {
  const rec = await db.settings.get(dailyGoalKey())
  return normalizeGoal(rec?.value as Partial<DailyGoal> | undefined)
}

export async function saveDailyGoal(patch: Partial<DailyGoal>): Promise<DailyGoal> {
  const cur = await loadDailyGoal()
  const next = normalizeGoal({ ...cur, ...patch })
  await db.settings.put({ key: dailyGoalKey(), value: next })
  return next
}

// ===========================================================================
// 索引（一次遍历，之后全是内存查表）
// ===========================================================================

interface UnitEntry {
  unitId: string
  topicId: string
  unitTitle: string
  topicTitle: string
  packageId: string
  subtitle: string
  /** 该 kp 能出的题数 */
  exercises: number
}

interface PlanIndex {
  /** `${packageId}\u0000${kpId}` → 定位信息 */
  kp: Map<string, UnitEntry>
  /** 短 id 兜底（仅当全库唯一时保留，歧义即删 —— 与 Review.vue 同口径） */
  kpShort: Map<string, UnitEntry>
  /** `${packageId}\u0000${kpId}` → 标题 */
  title: Map<string, string>
  titleShort: Map<string, string>
  /** 所有可学单元的列表（按包 + 单元顺序），用于「新学」 */
  units: Array<{
    unitId: string
    packageId: string
    title: string
    subtitle: string
    order: number
    kpIds: string[]
    exercises: number
    firstTopicId?: string
  }>
}

function exCountOfTopic(topic: any): Map<string, number> {
  const out = new Map<string, number>()
  for (const ex of topic?.exercises ?? []) {
    const ids: string[] = Array.isArray(ex?.knowledgePointIds) ? ex.knowledgePointIds : []
    for (const id of new Set(ids)) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

/**
 * 建索引。
 *
 * 只遍历**非内部包**（`manifest.isInternal === true` 的是学期包的单元包，
 * 学习页不展示它们；把它们算进来会让「新学」候选翻倍且顺序混乱）。
 */
async function buildIndex(packages: LearningPackageRecord[]): Promise<PlanIndex> {
  const idx: PlanIndex = {
    kp: new Map(),
    kpShort: new Map(),
    title: new Map(),
    titleShort: new Map(),
    units: [],
  }

  const pkgById = new Map<string, LearningPackageRecord>()
  for (const p of packages) pkgById.set(p.packageId, p)

  // 标题索引：全量包（含内部包）都要进 —— 进度行可能指向内部包里的 kp
  const shortSeen = new Map<string, number>()
  for (const p of packages) {
    for (const kp of p.knowledgePoints ?? []) {
      idx.title.set(`${p.packageId}\u0000${kp.id}`, kp.title)
      const short = stripPrefix(kp.id)
      shortSeen.set(short, (shortSeen.get(short) ?? 0) + 1)
      idx.titleShort.set(short, kp.title)
    }
  }
  for (const [short, n] of shortSeen) if (n > 1) idx.titleShort.delete(short)

  const visible = packages.filter((p) => (p.manifest as any)?.isInternal !== true)
  const unitSeen = new Set<string>()
  let order = 0

  for (const pkg of visible) {
    let resolved
    try {
      resolved = await resolvePackageUnits(pkg)
    } catch {
      // 依赖缺失不阻塞今日队列：这个包跳过，其它包照常
      continue
    }
    for (const ru of resolved.units) {
      const unit = ru.unit as any
      if (!unit?.id || unitSeen.has(unit.id)) continue
      unitSeen.add(unit.id)
      const subtitle = `${subjectLabelOf(pkg.manifest?.subject)} · ${ru.sourcePackageTitle ?? pkg.manifest?.title ?? ''}`
      const kpIds: string[] = []
      let unitExercises = 0
      /** 单元里第一个"有题"的主题：新学项直接进它，避免孩子还要自己挑主题 */
      let firstTopicId: string | undefined
      for (const topic of unit.topics ?? []) {
        const counts = exCountOfTopic(topic)
        for (const [kpId, n] of counts) {
          unitExercises += n
          idx.kp.set(`${ru.sourcePackageId}\u0000${kpId}`, {
            unitId: unit.id,
            topicId: topic.id,
            unitTitle: unit.title ?? unit.name ?? unit.id,
            topicTitle: topic.title ?? topic.id,
            packageId: ru.sourcePackageId,
            subtitle,
            exercises: n,
          })
          idx.kpShort.set(stripPrefix(kpId), {
            unitId: unit.id,
            topicId: topic.id,
            unitTitle: unit.title ?? unit.name ?? unit.id,
            topicTitle: topic.title ?? topic.id,
            packageId: ru.sourcePackageId,
            subtitle,
            exercises: n,
          })
        }
        for (const kpId of topic.knowledgePointIds ?? []) kpIds.push(kpId)
        if (!firstTopicId && counts.size > 0 && topic?.id) firstTopicId = topic.id
      }
      idx.units.push({
        unitId: unit.id,
        packageId: ru.sourcePackageId,
        title: unit.title ?? unit.name ?? unit.id,
        subtitle,
        order: order++,
        kpIds: Array.from(new Set(kpIds)),
        exercises: unitExercises,
        firstTopicId,
      })
    }
  }

  // 短 id 兜底只在**全库唯一**时可用：同一个短 id 落到不同单元/主题上就删掉。
  // 与 `Review.vue` 同一裁决 —— 歧义时宁可丢这条兜底，也不能猜（猜到别的学科，
  // 孩子点进去看到的是完全无关的题，比"少一条"糟糕得多）。
  const shortLocations = new Map<string, Set<string>>()
  for (const [key, entry] of idx.kp) {
    const kpId = key.slice(key.indexOf('\u0000') + 1)
    const short = stripPrefix(kpId)
    if (!shortLocations.has(short)) shortLocations.set(short, new Set())
    shortLocations.get(short)!.add(`${entry.packageId}\u0000${entry.unitId}\u0000${entry.topicId}\u0000${kpId}`)
  }
  for (const [short, locs] of shortLocations) {
    if (locs.size > 1) idx.kpShort.delete(short)
  }

  return idx
}

function lookup(
  idx: PlanIndex,
  packageId: string,
  kpId: string
): { entry: UnitEntry; title: string } | null {
  const entry = idx.kp.get(`${packageId}\u0000${kpId}`) ?? idx.kpShort.get(stripPrefix(kpId))
  if (!entry) return null
  const title =
    idx.title.get(`${entry.packageId}\u0000${kpId}`) ?? idx.titleShort.get(stripPrefix(kpId)) ?? kpId
  return { entry, title }
}

// ===========================================================================
// 拼候选
// ===========================================================================

const WEAK_MASTERY_THRESHOLD = 0.6

function overdueDaysOf(nextReviewAt?: string): number {
  if (!nextReviewAt) return 0
  const ms = Date.now() - new Date(nextReviewAt).getTime()
  if (ms <= 0) return 0
  return Math.floor(ms / 86400000)
}

/**
 * 拼候选。
 *
 * **同一个知识点最多出现一次**：优先级 复习 → 错题 → 弱项。
 * 三者常常指向同一个 kp（到期了、还有错题、掌握度也低），排三遍等于让孩子
 * 把同一张卡做三次，还会把其它知识点挤出预算。
 */
export async function buildPlanCandidates(pid: string = currentProfileId()): Promise<PlanCandidate[]> {
  const packages = await db.packages.toArray()
  const idx = await buildIndex(packages)

  const progress = await db.progress.where('profileId').equals(pid).toArray()
  const mistakes = await db.mistakes.where('profileId').equals(pid).toArray()
  const pending = mistakes.filter((m) => needsReview(mistakeLevel(m)))

  const out: PlanCandidate[] = []
  const usedKp = new Set<string>()

  const push = (c: PlanCandidate) => {
    const key = `${c.packageId}\u0000${c.knowledgePointId ?? c.unitId}`
    if (c.knowledgePointId && usedKp.has(key)) return
    if (c.knowledgePointId) usedKp.add(key)
    out.push(c)
  }

  // ① 到期复习
  for (const p of progress) {
    if (!isDueForReview(p)) continue
    const hit = lookup(idx, p.packageId, p.knowledgePointId)
    if (!hit) continue
    push({
      kind: 'review',
      packageId: hit.entry.packageId,
      unitId: hit.entry.unitId,
      topicId: hit.entry.topicId,
      knowledgePointId: p.knowledgePointId,
      title: hit.title,
      subtitle: hit.entry.subtitle,
      overdueDays: overdueDaysOf(p.nextReviewAt),
      availableQuestions: hit.entry.exercises,
    })
  }

  // ② 待攻克错题（按知识点聚合：一个 kp 下 5 道错题算一项，不是五项）
  const byKp = new Map<string, { packageId: string; count: number }>()
  for (const m of pending) {
    for (const kpId of m.knowledgePointIds ?? []) {
      const key = `${m.packageId}\u0000${kpId}`
      const cur = byKp.get(key)
      if (cur) cur.count += 1
      else byKp.set(key, { packageId: m.packageId, count: 1 })
    }
  }
  for (const [key, v] of byKp) {
    const kpId = key.slice(key.indexOf('\u0000') + 1)
    const hit = lookup(idx, v.packageId, kpId)
    if (!hit) continue
    push({
      kind: 'mistake',
      packageId: hit.entry.packageId,
      unitId: hit.entry.unitId,
      topicId: hit.entry.topicId,
      knowledgePointId: kpId,
      title: hit.title,
      subtitle: hit.entry.subtitle,
      pendingMistakes: v.count,
      availableQuestions: Math.max(v.count, 1),
    })
  }

  // ③ 弱项（掌握度低、没到期、也没错题 —— 否则上面两条已经收了）
  for (const p of progress) {
    if (p.status === '已掌握') continue
    const mastery = typeof p.masteryProbability === 'number' ? p.masteryProbability : null
    if (mastery !== null && mastery >= WEAK_MASTERY_THRESHOLD) continue
    // 从未做过题（correctCount = 0 且 wrongCount = 0）说明只是点开过，不算弱项
    if ((p.correctCount ?? 0) + (p.wrongCount ?? 0) === 0) continue
    const hit = lookup(idx, p.packageId, p.knowledgePointId)
    if (!hit) continue
    push({
      kind: 'weak',
      packageId: hit.entry.packageId,
      unitId: hit.entry.unitId,
      topicId: hit.entry.topicId,
      knowledgePointId: p.knowledgePointId,
      title: hit.title,
      subtitle: hit.entry.subtitle,
      mastery,
      availableQuestions: hit.entry.exercises,
    })
  }

  // ④ 新学：完全没有进度行的单元（按包顺序 + 单元顺序）
  const touchedUnits = new Set<string>()
  for (const p of progress) {
    const hit = lookup(idx, p.packageId, p.knowledgePointId)
    if (hit) touchedUnits.add(`${hit.entry.packageId}\u0000${hit.entry.unitId}`)
  }
  for (const u of idx.units) {
    if (touchedUnits.has(`${u.packageId}\u0000${u.unitId}`)) continue
    if (u.exercises <= 0) continue
    push({
      kind: 'new',
      packageId: u.packageId,
      unitId: u.unitId,
      topicId: u.firstTopicId,
      title: u.title,
      subtitle: u.subtitle,
      order: u.order,
      availableQuestions: u.exercises,
    })
  }

  return out
}

// ===========================================================================
// 队列读写
// ===========================================================================

async function readPlan(): Promise<DailyPlan | null> {
  const rec = await db.settings.get(dailyPlanKey())
  const v = rec?.value as DailyPlan | undefined
  if (!v || v.version !== 1 || !Array.isArray(v.items)) return null
  return v
}

async function writePlan(plan: DailyPlan): Promise<void> {
  await db.settings.put({ key: dailyPlanKey(), value: plan })
}

export interface EnsurePlanResult {
  plan: DailyPlan
  /** 是否是这次重新生成的（用于"今天第一次打开"的提示） */
  rebuilt: boolean
  /** 候选总数（家长端「还有多少没排进今天」用） */
  candidateCount: number
}

/**
 * 取今日队列；必要时生成。
 *
 * 冻结规则见 `isPlanStale`：**同日 + 目标数字未变 = 复用**。
 * `force` 用于「重新安排今天」（家长改完目标 / 孩子想看别的内容）。
 *
 * ## 空队列的自愈
 * 「队列为空」本身不算冻结的理由不充分 —— 孩子确实可能今天无事可做。
 * 但**导入学习包之后**如果还显示"没有任务"，就是明确的错。所以：
 *   - 导入/恢复完成后主动 `invalidateDailyPlan()`（见 `afterPackagesChanged`）；
 *   - 再加一道保险：空队列超过 `EMPTY_RETRY_MS` 就重算一次。
 *     只在**空队列**时发生，非空队列永不重算，所以代价可以忽略。
 */
export async function ensureDailyPlan(force = false): Promise<EnsurePlanResult> {
  const today = localDayKey()
  const goal = await loadDailyGoal()
  const existing = await readPlan()

  const emptiesAreStale =
    !!existing &&
    existing.items.length === 0 &&
    Date.now() - (existing.builtAt || 0) > EMPTY_RETRY_MS

  if (!force && !isPlanStale(existing, today, goal) && !emptiesAreStale) {
    // 复用已有队列时也要保证 goal.mode 是最新的（切口径不重算，见 isPlanStale 注释）
    const plan =
      existing && existing.goal.mode !== goal.mode
        ? { ...existing, goal: { ...existing.goal, mode: goal.mode } }
        : existing!
    if (existing && existing.goal.mode !== goal.mode) await writePlan(plan)
    return { plan, rebuilt: false, candidateCount: plan.items.length }
  }

  const candidates = await buildPlanCandidates()
  const built = buildDailyPlan({ date: today, goal, candidates, builtAt: Date.now() })

  // 重新生成时**同一日内不清零"今天已经做了多少"**：
  // 日中途改目标 / 点「再练一组」都不该把今日完成量打回 0（那会让结算页与打卡
  // 说"今天什么都没做"）。所以 `done` 累计照搬，`doneIds` 只保留仍在新队列里的项 ——
  // 后者是"打勾"用的，项没了就不该有勾。
  if (existing && existing.date === today) {
    const doneSet = new Set(existing.doneIds)
    built.doneIds = built.items.filter((it) => doneSet.has(it.id)).map((it) => it.id)
    built.done = { ...existing.done }
  }

  await writePlan(built)
  return { plan: built, rebuilt: true, candidateCount: candidates.length }
}

/** 标记某项完成（幂等）。返回更新后的队列。 */
export async function completePlanItem(
  itemId: string,
  actual?: { questions?: number; minutes?: number }
): Promise<DailyPlan> {
  const cur = await readPlan()
  if (!cur) return (await ensureDailyPlan()).plan
  const next = markItemDone(cur, itemId, actual)
  if (next === cur) return cur
  await writePlan(next)
  return next
}

/** 强制重排今天（家长改完目标 / 孩子说"换一批"） */
export async function rebuildDailyPlan(): Promise<EnsurePlanResult> {
  return ensureDailyPlan(true)
}

/**
 * 让今日队列失效（下一次 `ensureDailyPlan` 会重算）。
 *
 * 什么时候必须调用：**包集合变了**（导入新包 / 恢复备份 / 删包）。
 * 不调用的后果很具体 —— 队列是当天冻结的，早上导入了四下数学包，
 * 今日页却说"今天没有排任务"，家长只会认为功能坏了。
 *
 * 只删键、不重算：重算是 `ensureDailyPlan` 的事，这里做加法会让导入流程变慢。
 */
export async function invalidateDailyPlan(): Promise<void> {
  try {
    await db.settings.delete(dailyPlanKey())
  } catch (err) {
    console.warn('[dailyPlan] 失效今日队列失败（忽略）', err)
  }
}

/** 只换口径，不重排（已完成的项必须保留） */
export async function setGoalMode(mode: DailyGoal['mode']): Promise<DailyGoal> {
  const goal = await saveDailyGoal({ mode })
  const cur = await readPlan()
  if (cur && cur.date === localDayKey()) {
    await writePlan({ ...cur, goal: { ...cur.goal, mode } })
  }
  return goal
}

// ===========================================================================
// 明天预告（结算页用）
// ===========================================================================

export interface TomorrowPreview {
  /** 明天到期的复习卡数 */
  dueCards: number
  /** 还没学过、明天可以开的新单元数 */
  newUnits: number
}

/**
 * 明天有多少活。只做两次轻量读，不跑完整编排 ——
 * 结算页要的是"明天有点事做"这个量级，不需要精确到题。
 */
export async function tomorrowPreview(pid: string = currentProfileId()): Promise<TomorrowPreview> {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const key = localDayKey(tomorrow)

  let dueCards = 0
  try {
    const rows = await db.progress.where('profileId').equals(pid).toArray()
    for (const p of rows) {
      if (!p.nextReviewAt) continue
      if (localDayKey(new Date(p.nextReviewAt)) === key) dueCards += 1
    }
  } catch {
    /* 预告失败不影响结算：显示 0 而不是白屏 */
  }

  let newUnits = 0
  try {
    const candidates = await buildPlanCandidates(pid)
    newUnits = candidates.filter((c) => c.kind === 'new').length
  } catch {
    /* 同上 */
  }

  return { dueCards, newUnits }
}
