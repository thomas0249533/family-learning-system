import type {
  LearningPackageRecord,
  ProgressRecord,
} from '@/db'

export interface PrerequisiteStatus {
  /** 未掌握的前置知识点 */
  unmet: Array<{ id: string; title: string }>
  /** 全部前置已掌握 */
  allMet: boolean
}

/**
 * 检查某知识点的前置是否已掌握
 */
export function checkPrerequisites(
  pkg: LearningPackageRecord,
  kpId: string,
  progress: ProgressRecord[]
): PrerequisiteStatus {
  const kpMap = new Map<string, any>()
  for (const kp of pkg.knowledgePoints ?? []) kpMap.set(kp.id, kp)

  const kp = kpMap.get(kpId)
  const prerequisites: string[] = Array.isArray(kp?.prerequisites) ? kp.prerequisites : []

  if (prerequisites.length === 0) {
    return { unmet: [], allMet: true }
  }

  const progressMap = new Map<string, ProgressRecord>()
  for (const p of progress) progressMap.set(p.knowledgePointId, p)

  const unmet: Array<{ id: string; title: string }> = []
  for (const preId of prerequisites) {
    const p = progressMap.get(preId)
    if (p?.status !== '已掌握') {
      const preKp = kpMap.get(preId)
      unmet.push({ id: preId, title: preKp?.title ?? preId })
    }
  }

  return { unmet, allMet: unmet.length === 0 }
}

/**
 * 找出一组知识点中所有"最优先学"的（前置未掌握的不算）
 */
export function filterUnlockedKnowledgePoints(
  pkg: LearningPackageRecord,
  kpIds: string[],
  progress: ProgressRecord[]
): string[] {
  return kpIds.filter(id => checkPrerequisites(pkg, id, progress).allMet)
}