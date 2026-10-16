import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'

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

export async function resolvePackageUnits(
  pkg: LearningPackageRecord
): Promise<ResolveUnitsResult> {
  const deps: string[] = pkg.manifest?.dependencies ?? []

  // 普通包：直接返回自己的 units
  if (deps.length === 0) {
    return {
      units: (pkg.units ?? []).map(u => ({
        unit: u,
        sourcePackageId: pkg.packageId,
        sourcePackageTitle: pkg.manifest.title,
      })),
      missing: [],
      isAggregate: false,
    }
  }

  // 聚合包：从依赖包聚合 units
  const units: ResolvedUnit[] = []
  const missing: string[] = []

  for (const depId of deps) {
    const dep = await db.packages.get(depId)
    if (!dep) {
      missing.push(depId)
      continue
    }

    // ✅ 只跳过"没 units 的聚合包"，不再用 dependencies 判断
    if (!dep.units || dep.units.length === 0) continue

    for (const u of dep.units) {
      units.push({
        unit: u,
        sourcePackageId: dep.packageId,
        sourcePackageTitle: dep.manifest.title,
      })
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