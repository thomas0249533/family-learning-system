/**
 * E2 · 智能错题重组引擎（IO 编排层）
 * =====================================================================
 * 读当前档案的错题本 → 选题（纯函数，见 `weakpointsEngine.ts`）→ 构建临时
 * special 包 → 覆盖写入 `db.packages` → 失效归属索引缓存。
 *
 * ## 为什么不走 `PackageImporter` / `normalizePackage`
 * `normalizePackage` 的 E009 会拒绝"题目引用了本包未声明的知识点"——
 * 跨包引用只在 **ZIP 批量导入**（`externalKpIds` 批次池）里放行。临时包恰恰
 * 全部是跨包引用（决策：只引用、不声明，见 `weakpointsEngine.ts` 文件头），
 * 走导入路径必然被 E009 打回。本包由机器生成、结构自证（题目 kpIds 直接来自
 * 错题行，无任何用户输入），照 `importService.ts:189` 的
 * `db.packages.put(normalized)` 模式直接落库，形状与 normalizePackage 的产物一致
 * （顶层 `packageId` + `manifest` + `knowledgePoints` + `exercises` + `units`）。
 *
 * ## 落库后为什么必须失效归属索引
 * `ownerIndexCache` 是进程内缓存，`recordProgress` 每次作答都读它做归属决策。
 * 不失效 → 下次解析可能拿到写入前的包数组。虽然本设计让临时包不声明 KP、
 * 索引内容其实不变，但"写完包让缓存失效"是包变更的既定契约
 * （`importService.afterPackagesChanged` 同款），这里照做。
 * 注意：直接调 `invalidateOwnerIndex()` 而不是 pinia store 的
 * `invalidateOwnerIndexCache()` —— 后者只是它的薄包装（见 `stores/package.ts`），
 * 核心层不 import store 可以避免把 pinia 活跃状态变成隐式前置条件
 * （`importService.ts` 同样是直接调）。两者效果完全相同。
 *
 * ## 为什么不需要 `ensureE1Migrated({ orphanOnly: true })`
 * 导入路径跑它是为了"导入前无主的历史进度行现在可能有归属包了"。
 * 临时包不声明任何 KP → 归属索引内容一个字都不变 → 不存在新的可归因行。
 */

import { db, type LearningPackageRecord, type MistakeRecord } from '@/db'
import { buildOwnerIndex, resolveOwnerPackageId, type OwnerIndex } from '@core/progress/ownerIndex'
import { invalidateOwnerIndex } from '@core/progress/ownerIndexCache'
import { currentProfileId } from '@core/profile/currentProfile'
import {
  WEAKPOINTS_PACKAGE_ID,
  buildWeakpointsPackage,
  classifyMistake,
  exerciseFromMistake,
  selectWeakpoints,
  type SelectWeakpointsOptions,
  type WeakpointCandidate,
  type WeakpointSource,
} from './weakpointsEngine'

export interface GenerateWeakpointsOptions extends SelectWeakpointsOptions {
  /** 卷标，默认引擎内置标题 */
  title?: string
  /** 生成时刻，默认 `new Date()`（写 manifest.createdAt / updatedAt） */
  now?: Date
}

export interface GenerateWeakpointsResult {
  /** 是否写出了包。false = 错题本没有可重组的弱项（旧包不动） */
  generated: boolean
  packageId: string
  /** 卷入的题目数 */
  questionCount: number
  primaryCount: number
  carelessCount: number
  /** 因数据不可用（无 KP 关联 / 归属解析失败 / 题目残缺）被跳过的错题行数 */
  skippedCount: number
  /** 成卷学科；未生成时为 null */
  subject: string | null
  /** 未生成的原因：`no-mistakes` 错题本为空；`no-weakness` 有错题但无可攻关弱项 */
  reason?: 'no-mistakes' | 'no-weakness'
}

/** 在 owner 包里找声明了 kpId 的单元（topic 引用口径，与 `findUnitByKnowledgePoint` 同构） */
function findUnitIdForKp(pkg: LearningPackageRecord, kpId: string): string | undefined {
  for (const u of pkg.units ?? []) {
    for (const t of u.topics ?? []) {
      if (Array.isArray(t?.knowledgePointIds) && t.knowledgePointIds.includes(kpId)) {
        return u.id
      }
    }
  }
  return undefined
}

/**
 * 错题行 → 选题候选。
 *
 * 归属解析（三分支，与 `recordProgress` / `addMistake` 同一套）：
 *   - kpIds[0] 有唯一声明者且学科相容 → 该包为 source（进度练习时回流的目标）；
 *   - 歧义 / 零候选 / 跨学科 / 包已删 → source = null，该行**永不入卷**
 *     （KP 没有唯一 owner，入卷后进度会落到临时包自己头上 —— 正是要避的污染）。
 */
function toCandidate(
  mistake: MistakeRecord,
  packages: readonly LearningPackageRecord[],
  index: OwnerIndex
): WeakpointCandidate | null {
  const kpIds = Array.isArray(mistake.knowledgePointIds) ? mistake.knowledgePointIds : []
  const kpId = kpIds[0]
  if (!kpId) return null

  // 入口包取错题行现值（addMistake 落库时已解析过；行上是旧值也能自愈）
  const ownerId = resolveOwnerPackageId(kpId, mistake.packageId, index)
  if (!ownerId) return null
  const owner = packages.find((p) => p.packageId === ownerId)
  if (!owner) return null

  const manifest = owner.manifest as unknown as Record<string, unknown>
  const subject = typeof manifest.subject === 'string' ? manifest.subject : ''
  if (!subject) return null // 没有 subject 写不出合规 manifest，也过不了 subject 闸门

  const source: WeakpointSource = {
    packageId: ownerId,
    subject,
    grade: typeof manifest.grade === 'number' ? manifest.grade : 4,
    term: manifest.term === 'down' ? 'down' : 'up',
    unitId: findUnitIdForKp(owner, kpId),
    kpTitle: (owner.knowledgePoints ?? []).find((kp) => kp?.id === kpId)?.title,
  }
  if (typeof manifest.edition === 'string') source.edition = manifest.edition
  if (typeof manifest.templateId === 'string') source.templateId = manifest.templateId

  return { mistake, ...classifyMistake(mistake), source }
}

/**
 * 生成（覆盖）临时弱项包。
 *
 * 幂等语义：包 id 稳定（`WEAKPOINTS_PACKAGE_ID`），`db.packages.put` 按主键
 * 覆盖 → 连生成多少次 `db.packages` 里只有一行，不累积。
 *
 * 没有可重组的弱项时**不写库**（不拿空卷覆盖旧卷；旧卷的题目仍然是有效练习材料），
 * 由调用方据 `generated` / `questionCount` 决定 UI 提示。
 */
export async function generateWeakpointsPackage(
  opts: GenerateWeakpointsOptions = {}
): Promise<GenerateWeakpointsResult> {
  const pid = currentProfileId()
  const [mistakes, packages] = await Promise.all([
    db.mistakes.where('profileId').equals(pid).toArray(),
    db.packages.toArray(),
  ])

  const index = buildOwnerIndex(packages)
  const base: GenerateWeakpointsResult = {
    generated: false,
    packageId: WEAKPOINTS_PACKAGE_ID,
    questionCount: 0,
    primaryCount: 0,
    carelessCount: 0,
    skippedCount: 0,
    subject: null,
  }

  if (mistakes.length === 0) {
    return { ...base, reason: 'no-mistakes' }
  }

  // ---- 候选解析 + 数据可用性过滤 ----
  let skipped = 0
  const candidates: WeakpointCandidate[] = []
  for (const m of mistakes) {
    if (exerciseFromMistake(m) === null) {
      skipped += 1 // 题目残缺（无 id/type/answer/KP 关联），进了 ExamPanel 也渲染不了
      continue
    }
    const c = toCandidate(m, packages, index)
    if (!c) {
      skipped += 1 // 归属解析失败 / 无 KP 关联 / 源包缺失
      continue
    }
    candidates.push(c)
  }

  const selection = selectWeakpoints(candidates, {
    maxQuestions: opts.maxQuestions,
    carelessRatio: opts.carelessRatio,
    subject: opts.subject,
  })

  if (selection.selected.length === 0) {
    return { ...base, skippedCount: skipped, reason: 'no-weakness' }
  }

  // 兜底来源单元：仅当"KP 不在任何 topic 里"导致推导为空时使用，
  // 保证 manifest.sourceUnitIds 契约非空（examMode 包它只影响包卡展示文案）
  const fallbackUnitIds = packages
    .filter((p) => selection.selected.some((c) => c.source?.packageId === p.packageId))
    .flatMap((p) => (p.units ?? []).map((u) => u?.id ?? ''))
    .filter(Boolean)

  const pkg = buildWeakpointsPackage(selection, {
    now: opts.now,
    title: opts.title,
    fallbackSourceUnitIds: fallbackUnitIds,
  })

  // JSON 往返：与本仓其它写入口同一惯例（toPlain），避免把响应式代理/类实例写进库
  await db.packages.put(JSON.parse(JSON.stringify(pkg)) as LearningPackageRecord)

  // 包集合变了 → 归属索引缓存失效（见文件头）
  invalidateOwnerIndex()

  return {
    generated: true,
    packageId: WEAKPOINTS_PACKAGE_ID,
    questionCount: pkg.exercises.length,
    primaryCount: selection.primaryCount,
    carelessCount: selection.carelessCount,
    skippedCount: skipped,
    subject: selection.subject,
  }
}

/** 供 UI / 测试复用：当前是否存在临时包 */
export async function weakpointsPackageExists(): Promise<boolean> {
  return (await db.packages.get(WEAKPOINTS_PACKAGE_ID)) !== undefined
}
