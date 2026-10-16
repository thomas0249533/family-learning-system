import type { LearningPackageRecord } from '@/db'

// 其余 import 保持不动
export interface SearchResult {
  packageId: string
  packageTitle: string
  unitId: string
  unitTitle: string
  topicId: string
  topicTitle: string
  knowledgePointId: string
  knowledgePointTitle: string
  knowledgePointContent: string
  matchField: 'title' | 'content'
}

/**
 * 在当前学习包中搜索知识点
 */
export function searchKnowledgePoints(
  pkg: LearningPackageRecord,
  keyword: string
): SearchResult[] {
  if (!keyword.trim() || !pkg) return []
  
  const kw = keyword.trim().toLowerCase()
  const results: SearchResult[] = []
  const kpMap = new Map(pkg.knowledgePoints.map((kp: any) => [kp.id, kp]))

  // 遍历所有单元和主题
  for (const unit of pkg.units || []) {
    for (const topic of unit.topics || []) {
      for (const kpId of topic.knowledgePointIds || []) {
        const kp = kpMap.get(kpId) as any
        if (!kp) continue

        const titleMatch = kp.title?.toLowerCase().includes(kw)
        const contentMatch = kp.content?.toLowerCase().includes(kw)

        if (titleMatch || contentMatch) {
          results.push({
            packageId: pkg.packageId,
            packageTitle: pkg.manifest.title,
            unitId: unit.id,
            unitTitle: unit.title,
            topicId: topic.id,
            topicTitle: topic.title,
            knowledgePointId: kp.id,
            knowledgePointTitle: kp.title,
            knowledgePointContent: kp.content,
            matchField: titleMatch ? 'title' : 'content'
          })
        }
      }
    }
  }

  return results
}