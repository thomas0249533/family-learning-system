import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'
import { packageTypeOf } from '@/schemas/manifest'

export interface ResolvedUnit {
  unit: any
  sourcePackageId: string
  sourcePackageTitle: string
}

export interface ResolveUnitsResult {
  units: ResolvedUnit[]
  missing: string[]
  isAggregate: boolean
}

/**
 * 解析一个包"能看到的所有单元"。三段式（V1.3 · E-01 · D2 / D4）。
 *
 * ## 旧实现为什么是错的
 * 判据是 `dependencies.length === 0`：非空就**只**返回依赖包的 units、丢掉自己的。
 * english-7 的单元包是**链式依赖**（`p2 deps=[p1]`、`p3 deps=[p2]` …），于是：
 *   - `UnitList` 里 p2 显示的是 **p1 的单元**（不是自己的）；
 *   - `findUnitByKnowledgePoint(p2, p2 自己的 kp)` 反查为 null → `Review` 直接 `continue`
 *     → p2~p7 这 6 个单元包的学习记录**全部进不了复习计划**。
 *
 * ## 新口径（三种包三种解析）
 * ```
 * ① 自有 units 永远先进来（scope='self'），保证 findUnitByKnowledgePoint 必定能找到自己
 * ② unit / base 类：**到此为止** —— 链式依赖不再把上游单元漏进来
 * ③ special / sprint：按 `manifest.sourceUnitIds` 精确追加来源单元（su 为空则回退全量依赖）
 * ④ term 等其他聚合包：没有 sourceUnitIds，回退"全量依赖"（全册视图本来就要看全部单元）
 * ```
 *
 * 缺依赖仍然只记进 `missing`、不抛错（`UnitList` 会渲染 W021 提示）。
 */
export async function resolvePackageUnits(
  pkg: LearningPackageRecord
): Promise<ResolveUnitsResult> {
  const deps: string[] = pkg.manifest?.dependencies ?? []
  const kind = packageTypeOf(pkg.manifest)
  const sourceUnitIds = pkg.manifest?.sourceUnitIds ?? []

  const units: ResolvedUnit[] = []
  const seen = new Set<string>()
  const missing: string[] = []

  // ① 自有 units 优先
  const push = (u: any, sourcePackageId: string, sourcePackageTitle: string) => {
    if (!u?.id || seen.has(u.id)) return
    seen.add(u.id)
    units.push({ unit: u, sourcePackageId, sourcePackageTitle })
  }
  for (const u of pkg.units ?? []) {
    push(u, pkg.packageId, pkg.manifest.title)
  }

  // ② 单元包 / 基础包：只看自己。链式依赖的"上游单元"不是它的内容。
  if (kind === 'unit' || kind === 'base') {
    return { units, missing, isAggregate: false }
  }

  if (deps.length === 0) return { units, missing, isAggregate: false }

  // ③④ 加载依赖包（顺序即 `dependencies` 声明顺序，决定展示顺序）
  const wanted = sourceUnitIds.length > 0 ? new Set(sourceUnitIds) : null
  const depsLoaded: LearningPackageRecord[] = []
  for (const depId of deps) {
    const dep = await db.packages.get(depId)
    if (!dep) {
      missing.push(depId)
      continue
    }
    depsLoaded.push(dep)
  }

  for (const dep of depsLoaded) {
    for (const u of dep.units ?? []) {
      // 有精确映射时只取映射内的单元（比整包聚合细一层，避免专项包里塞进整册单元）
      if (wanted && !wanted.has(u.id)) continue
      push(u, dep.packageId, dep.manifest.title)
    }
  }

  // 精确映射里点名了、但在依赖包里找不到的单元 → 也记进 missing，让 UI 能提示
  if (wanted) {
    for (const id of wanted) {
      if (!seen.has(id)) missing.push(id)
    }
  }

  return { units, missing, isAggregate: true }
}

export async function findUnitByKnowledgePoint(
  pkg: LearningPackageRecord,
  knowledgePointId: string
): Promise<{ unitId: string; topicId: string; sourcePackageId: string } | null> {
  const { units } = await resolvePackageUnits(pkg)

  for (const ru of units) {
    for (const topic of ru.unit.topics ?? []) {
      if (topic.knowledgePointIds?.includes(knowledgePointId)) {
        return {
          unitId: ru.unit.id,
          topicId: topic.id,
          sourcePackageId: ru.sourcePackageId,
        }
      }
    }
  }
  return null
}
