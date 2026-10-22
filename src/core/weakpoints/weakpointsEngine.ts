/**
 * E2 · 智能错题重组引擎（纯函数层，零 I/O、零 Dexie 依赖）
 * =====================================================================
 * 按「错因 + 失败程度」把长期没搞懂的错题重组成一个临时 special 包
 * （`special-weakpoints-auto`），让孩子集中攻克。IO 编排见同目录
 * `generateWeakpoints.ts`；本文件只含可穷举的纯逻辑。
 *
 * ## 三条设计决策（都有教训来源，改前先读）
 *
 * ### 1. 临时包 `knowledgePoints` 必须为空 —— 只引用，不声明
 * 归属机制（`@core/progress/ownerIndex`）：KP 的 owner 是**在自己
 * `knowledgePoints` 里声明了它**的那个包；声明者 ≥2 → 歧义 → 解析为 null →
 * `recordProgress` 回落到**入口包**。临时包一旦抄进 KP 定义，这些 KP 就有两个
 * 声明者，进度会全部落在临时包自己名下，原包掌握度永不更新 —— 家长端数字
 * 与孩子实际水平脱节。所以本引擎生成的包里，topic / 题目只通过
 * `knowledgePointIds` **引用**原 KP id，定义留在原包（唯一声明者不变）。
 * 线上既有专项包 `special-math-4-up-jiajiancheng.json` 正是这个形态。
 * 回归测试：`tests/weakpoints-engine.test.ts`「★ 归属回流」。
 *
 * ### 2. 选题：主池（knowledge/timeout/misread 或连续失败）+ careless 少量混入
 * 全混 careless 会让孩子练"粗心"而不是练不会的。careless 也有价值
 * （同一地方反复粗心说明习惯问题），但只能是配菜。连续失败 ≥2 次的 careless
 * 进主池 —— "总在同一个地方摔倒"首先是没学会，其次才是粗心。
 *
 * ### 3. 单学科成卷
 * manifest 只能有一个 subject（subject 闸门：跨学科归属一律判异常）。
 * 错题本跨学科时取**主池候选最多**的学科成卷，其余学科等它被清掉后
 * 下一轮再成卷。归属解析失败的候选一律不进卷 —— 它们的 KP 没有唯一
 * owner，进度会落到临时包自己头上（正是决策 1 要避免的污染）。
 */

import type { LearningPackageRecord, MistakeRecord } from '@/db'
import type { MistakeMasteryLevel } from '@/db'
import { mistakeCauseOf, type MistakeCause } from '@core/mistake/mistakeCause'
import { mistakeLevel, needsReview } from '@core/mistake/mistakeRules'

/** 临时包 id。**稳定**：每次生成覆盖同一个 id，不累积（设备级资产，不进备份） */
export const WEAKPOINTS_PACKAGE_ID = 'special-weakpoints-auto'

/** 单卷题目上限。ExamPanel 默认按 10 题/卷切片，30 题约 3 卷，一课练得完 */
export const WEAKPOINTS_MAX_QUESTIONS = 30

/** careless 混入比例（相对主池入选数）。"少量" = 两成 */
export const WEAKPOINTS_CARELESS_RATIO = 0.2

/** 连续失败几次算"总没学会"——与错题本口径（wrongCount）同源 */
export const WEAKPOINTS_FAIL_THRESHOLD = 2

/** 主池错因：知识盲区 / 超时未完成 / 审题不清（careless 不在内，见文件头决策 2） */
export const WEAKPOINTS_PRIMARY_CAUSES: readonly MistakeCause[] = ['knowledge', 'timeout', 'misread']

/** 默认卷标（E3 可传自定义标题） */
export const WEAKPOINTS_DEFAULT_TITLE = '我的弱项攻关卷'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 一条错题的归因快照（由 IO 层从 MistakeRecord 提取，本层只消费） */
export interface WeakpointCandidate {
  mistake: MistakeRecord
  /** 逻辑层归因（未打标按 knowledge 兜底，与 mistakeCauseOf 一致） */
  cause: MistakeCause
  /** 三级掌握状态 */
  level: MistakeMasteryLevel
  /** 累计错误次数 */
  wrongCount: number
  /**
   * 归属包信息。`null` = 归属解析失败（歧义 / 零候选 / 跨学科 / 包已删除）——
   * 这类候选**永不入卷**（进度会落到临时包自己头上，见文件头决策 1）。
   */
  source: WeakpointSource | null
}

/** 候选的归属包元信息（IO 层从 owner 包的 manifest / units 解析） */
export interface WeakpointSource {
  packageId: string
  subject: string
  grade: number
  term: string
  edition?: string
  templateId?: string
  /** KP 标题（查不到则 undefined，topic 标题退化为 kpId） */
  kpTitle?: string
  /** KP 所在单元的 id（`<packageId>::<unitId>` 原值）；KP 不在任何 topic 里则为 undefined */
  unitId?: string
}

export interface SelectWeakpointsOptions {
  /** 题目上限，默认 WEAKPOINTS_MAX_QUESTIONS */
  maxQuestions?: number
  /** careless 混入比例，默认 WEAKPOINTS_CARELESS_RATIO */
  carelessRatio?: number
  /** 只打包指定学科（E3 可按学科 tab 传入）；默认自动取主导学科 */
  subject?: string
}

export interface WeakpointsSelection {
  /** 入选候选（主池 + careless 混合后按弱程度排序，卷内顺序即此序） */
  selected: WeakpointCandidate[]
  /** 入选学科；空 selection 时为 null */
  subject: string | null
  primaryCount: number
  carelessCount: number
}

export interface BuildWeakpointsPackageOptions {
  /** 生成时刻，默认 `new Date()`；写 manifest.createdAt / updatedAt */
  now?: Date
  /** 卷标，默认 WEAKPOINTS_DEFAULT_TITLE */
  title?: string
  /**
   * 兜底的 sourceUnitIds（仅在"KP 不在任何 topic 里"导致推导为空时使用）。
   * IO 层传"涉及的源包的全部单元 id"，保证 manifest 契约非空。
   */
  fallbackSourceUnitIds?: readonly string[]
}

// ---------------------------------------------------------------------------
// 选题
// ---------------------------------------------------------------------------

/** 是否待复习（复用错题本口径：mastered 移出，none/partial 留下） */
function needsWeakReview(level: MistakeMasteryLevel): boolean {
  return needsReview(level)
}

/**
 * 是否主池候选：主池错因，或连续失败够次数。
 * 注意"连续失败"优先于错因 —— 总在同一个地方摔倒，首先是没学会。
 */
export function isPrimaryWeakness(c: WeakpointCandidate): boolean {
  if (!needsWeakReview(c.level)) return false
  if (WEAKPOINTS_PRIMARY_CAUSES.includes(c.cause)) return true
  return c.wrongCount >= WEAKPOINTS_FAIL_THRESHOLD
}

/** careless 池：待复习、错因 careless、且没到连续失败线 */
export function isCarelessMix(c: WeakpointCandidate): boolean {
  return needsWeakReview(c.level) && c.cause === 'careless' && c.wrongCount < WEAKPOINTS_FAIL_THRESHOLD
}

/** 掌握程度权重：未掌握比部分掌握更该优先攻克 */
const LEVEL_WEIGHT: Record<MistakeMasteryLevel, number> = {
  none: 2,
  partial: 1,
  mastered: 0,
}

/**
 * 弱程度排序（确定性）：未掌握 > 部分掌握 → 错得多 > 错得少 →
 * 最近错的 > 早先错的 → exerciseId 字典序（最终 tie-break，保证输出稳定）。
 */
export function compareWeakness(a: WeakpointCandidate, b: WeakpointCandidate): number {
  const lw = LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level]
  if (lw !== 0) return lw
  if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount
  const wa = a.mistake.wrongAt ?? ''
  const wb = b.mistake.wrongAt ?? ''
  if (wa !== wb) return wa < wb ? 1 : -1
  const ea = a.mistake.exerciseId ?? ''
  const eb = b.mistake.exerciseId ?? ''
  return ea < eb ? -1 : ea > eb ? 1 : 0
}

/**
 * 选题。纯函数：输入候选（含归属信息），输出入选列表与统计。
 *
 * 步骤：
 *   1. 丢掉归属解析失败的候选（`source === null`）—— 它们会污染临时包；
 *   2. 按学科分组，取主池候选最多的学科（平手按学科名字典序，确定性）；
 *     指定了 `opts.subject` 时只在该学科内选；
 *   3. 主池排序后按上限截取；careless 池按 `round(主池入选数 × 比例)` 配额混入；
 *   4. 混合后重新按弱程度排序返回（卷内顺序稳定）。
 *
 * 只有 careless、没有主池候选 → 空 selection（不让孩子练"粗心"）。
 */
export function selectWeakpoints(
  candidates: readonly WeakpointCandidate[] | null | undefined,
  opts: SelectWeakpointsOptions = {}
): WeakpointsSelection {
  const maxQuestions = Math.max(1, Math.floor(opts.maxQuestions ?? WEAKPOINTS_MAX_QUESTIONS))
  const carelessRatio = opts.carelessRatio ?? WEAKPOINTS_CARELESS_RATIO

  const usable = (candidates ?? []).filter((c): c is WeakpointCandidate => !!c && !!c.source)

  // ---- 学科分组（Map 迭代序 = 插入序；平手时要字典序，故排序后扫） ----
  const groups = new Map<string, WeakpointCandidate[]>()
  for (const c of usable) {
    const subject = c.source!.subject
    const list = groups.get(subject)
    if (list) list.push(c)
    else groups.set(subject, [c])
  }

  let chosen: WeakpointCandidate[] = []
  let chosenSubject: string | null = null

  if (opts.subject) {
    chosen = groups.get(opts.subject) ?? []
    chosenSubject = chosen.length > 0 ? opts.subject : null
  } else if (groups.size > 0) {
    let bestCount = 0
    for (const subject of [...groups.keys()].sort()) {
      const primaryCount = groups.get(subject)!.filter(isPrimaryWeakness).length
      if (primaryCount > bestCount) {
        bestCount = primaryCount
        chosen = groups.get(subject)!
        chosenSubject = subject
      }
    }
  }

  const empty: WeakpointsSelection = { selected: [], subject: null, primaryCount: 0, carelessCount: 0 }
  if (!chosenSubject || chosen.length === 0) return empty

  const primary = chosen.filter(isPrimaryWeakness).sort(compareWeakness)
  const careless = chosen.filter(isCarelessMix).sort(compareWeakness)

  const primaryPicked = primary.slice(0, maxQuestions)
  if (primaryPicked.length === 0) return empty

  const quota = Math.max(0, Math.round(primaryPicked.length * carelessRatio))
  const carelessPicked = careless.slice(0, Math.min(careless.length, quota))

  const selected = [...primaryPicked, ...carelessPicked].sort(compareWeakness)
  return {
    selected,
    subject: chosenSubject,
    primaryCount: primaryPicked.length,
    carelessCount: carelessPicked.length,
  }
}

// ---------------------------------------------------------------------------
// 题目归一化
// ---------------------------------------------------------------------------

/**
 * 错题行 → 可入包的题目。
 *
 * `knowledgePointIds` 取**错题行**上的值（题目携带的原值，复习与分组都按它反查），
 * 不信任 questionData 里的旧快照。exerciseId **原样保留** ——
 * `resolveMistake` / `addMistake` 的去重与状态推进都按它匹配，
 * 换 id 等于把错题本里的同一道题劈成两道。
 *
 * 缺 id / type / answer 的行返回 `null`（进了 ExamPanel 也渲染不了，
 * 宁可少一题也不要一张坏卷）。调用方应把它计为 skipped。
 */
export function exerciseFromMistake(m: MistakeRecord): Record<string, unknown> | null {
  const q = m?.questionData as Record<string, unknown> | undefined
  if (!q) return null
  const id = typeof q.id === 'string' && q.id ? q.id : m.exerciseId
  if (!id) return null
  const type = typeof q.type === 'string' && q.type ? q.type : ''
  if (!type) return null
  const answer = q.answer
  if (answer === undefined || answer === null || answer === '') return null
  if (Array.isArray(answer) && answer.length === 0) return null

  const kpIds = Array.isArray(m.knowledgePointIds) ? m.knowledgePointIds.filter((x) => typeof x === 'string' && x) : []
  if (kpIds.length === 0) return null

  const ex: Record<string, unknown> = { id, type, question: q.question ?? '', answer }
  if (Array.isArray(q.options)) ex.options = q.options
  if (typeof q.explanation === 'string' && q.explanation) ex.explanation = q.explanation
  if (Array.isArray(q.left)) ex.left = q.left
  if (Array.isArray(q.right)) ex.right = q.right
  if (q.hint !== undefined) ex.hint = q.hint
  if (q.metadata !== undefined) ex.metadata = q.metadata
  ex.knowledgePointIds = kpIds
  return ex
}

// ---------------------------------------------------------------------------
// 包构建
// ---------------------------------------------------------------------------

/** 单元 / topic / 题目的 id 前缀（包 id 稳定，故派生 id 也稳定） */
const UNIT_ID = `${WEAKPOINTS_PACKAGE_ID}-u1`
const topicIdOf = (i: number): string => `${WEAKPOINTS_PACKAGE_ID}-t${i + 1}`

/** 去重 + 字典序（输出稳定，UI 与断言才不飘） */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

/**
 * 由选题结果构建临时 special 包。
 *
 * manifest 铁律（缺一不可，全部来自既有专项包实例的实测字段）：
 *   1. `examMode: true` —— 否则 UnitList 不进 ExamPanel、没有题目导航；
 *   2. `sourceUnitIds` 非空（选中 KP 所在的单元 id）—— 否则包卡不显示来源、
 *      非 examMode 路径下 `resolvePackageUnits` 会显示"基于 0 个单元"；
 *   3. `dependencies` 列源单元包（照实例；空 dependencies 的 special 包在
 *      `resolvePackageUnits` 里会提前返回、丢来源信息）；
 *   4. subject / grade / term 与源包一致 —— 否则 subject 闸门会把回流判成跨学科；
 *   5. `knowledgePoints: []` —— 只引用不声明（文件头决策 1，本函数最重要的性质）。
 *
 * @param selection `selectWeakpoints` 的结果（**必须非空**；空 selection 抛错，
 *   由调用方在 IO 层提前挡掉）
 */
export function buildWeakpointsPackage(
  selection: WeakpointsSelection,
  opts: BuildWeakpointsPackageOptions = {}
): LearningPackageRecord {
  const selected = selection.selected
  if (selected.length === 0) {
    throw new Error('[weakpoints] selection 为空，不该调用 buildWeakpointsPackage')
  }

  // ---- 题目归一化（IO 层已过滤过，这里防御性再滤一次） ----
  const picked = selected
    .map((c) => ({ c, ex: exerciseFromMistake(c.mistake) }))
    .filter((x): x is { c: WeakpointCandidate; ex: Record<string, unknown> } => x.ex !== null)
  if (picked.length === 0) {
    // 全部题目都残缺（纯函数被直接调用且没预过滤时会走到这里）
    throw new Error('[weakpoints] selection 里没有可用的题目，拒绝生成空卷')
  }

  // ---- topic：按主 KP（kpIds[0]）分组，组内保持弱程度排序 ----
  const byKp = new Map<string, { kpTitle?: string; kpId: string; exercises: Record<string, unknown>[] }>()
  for (const { c, ex } of picked) {
    const kpId = (ex.knowledgePointIds as string[])[0]
    let group = byKp.get(kpId)
    if (!group) {
      group = { kpId, kpTitle: c.source?.kpTitle, exercises: [] }
      byKp.set(kpId, group)
    }
    group.exercises.push(ex)
  }
  const topics = [...byKp.values()]
    .sort((a, b) => (a.kpId < b.kpId ? -1 : a.kpId > b.kpId ? 1 : 0))
    .map((g, i) => ({
      id: topicIdOf(i),
      title: g.kpTitle ?? g.kpId,
      knowledgePointIds: [g.kpId],
      modules: [],
      exercises: g.exercises,
    }))

  const unit = {
    id: UNIT_ID,
    name: '弱项攻关',
    title: opts.title ?? WEAKPOINTS_DEFAULT_TITLE,
    desc: `按错因与失败程度从错题本自动重组 · 共 ${picked.length} 题`,
    topics,
  }

  // ---- manifest 元数据：取弱程度最高的那个候选的源包（主攻方向的包） ----
  const firstSource = picked[0].c.source!
  const withGrade = picked.find((x) => typeof x.c.source!.grade === 'number')?.c.source
  const withTerm = picked.find((x) => !!x.c.source!.term)?.c.source
  const withEdition = picked.find((x) => !!x.c.source!.edition)?.c.source
  const withTemplate = picked.find((x) => !!x.c.source!.templateId)?.c.source

  const unitIds = sortedUnique(picked.map((x) => x.c.source!.unitId ?? '').filter(Boolean))
  const sourceUnitIds = unitIds.length > 0 ? unitIds : sortedUnique(opts.fallbackSourceUnitIds ?? [])
  const dependencies = sortedUnique(picked.map((x) => x.c.source!.packageId))

  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()

  const manifest: Record<string, unknown> = {
    schemaVersion: '1.0',
    packageId: WEAKPOINTS_PACKAGE_ID,
    type: 'special',
    // 系统生成的练习卷，不是孩子导入的学习资产 —— 不进 PackageList 分组
    // （E3 决定它的入口；届时可按需改回 false）
    isInternal: true,
    examMode: true,
    subject: firstSource.subject,
    grade: withGrade?.grade ?? 4,
    term: withTerm?.term ?? 'up',
    title: opts.title ?? WEAKPOINTS_DEFAULT_TITLE,
    sourceUnitIds,
    dependencies,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  if (withEdition?.edition) manifest.edition = withEdition.edition
  if (withTemplate?.templateId) manifest.templateId = withTemplate.templateId

  const exercises = topics.flatMap((t) => t.exercises)

  return {
    packageId: WEAKPOINTS_PACKAGE_ID,
    manifest: manifest as unknown as LearningPackageRecord['manifest'],
    // ★ 决策 1：不声明任何 KP 定义。topic / 题目只引用原 KP id，
    //   唯一声明者留在原包 → recordProgress 的归属解析回原包。
    knowledgePoints: [],
    exercises,
    units: [unit],
  } as LearningPackageRecord
}

// ---------------------------------------------------------------------------
// 便捷导出（IO 层复用同一套判据，避免两处实现漂移）
// ---------------------------------------------------------------------------

/** 从错题行提取归因快照（cause / level / wrongCount） */
export function classifyMistake(m: MistakeRecord): {
  cause: MistakeCause
  level: MistakeMasteryLevel
  wrongCount: number
} {
  const raw = m.wrongCount
  const wrongCount = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1
  return { cause: mistakeCauseOf(m), level: mistakeLevel(m), wrongCount }
}
