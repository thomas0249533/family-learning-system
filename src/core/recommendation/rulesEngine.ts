import type {
  LearningPackageRecord,
  ProgressRecord,
  MistakeRecord,
} from '@/db'
import { checkPrerequisites } from '@core/prerequisites/prerequisiteEngine'

export interface Recommendation {
  knowledgePointId: string
  title: string
  type: 'mistake' | 'review' | 'new' | 'prerequisite'
  reason: string
}

export function generateRecommendations(
  pkg: LearningPackageRecord,
  mistakes: MistakeRecord[],
  progress: ProgressRecord[]
): Recommendation[] {
  const result: Recommendation[] = []
  const used = new Set<string>()

  const kpMap = new Map<string, any>()
  for (const kp of pkg.knowledgePoints ?? []) kpMap.set(kp.id, kp)

  const progressMap = new Map<string, ProgressRecord>()
  for (const p of progress) progressMap.set(p.knowledgePointId, p)

  const push = (rec: Recommendation) => {
    if (used.has(rec.knowledgePointId)) return
    used.add(rec.knowledgePointId)
    result.push(rec)
  }

  // 1. 错题优先
  const mistakeKpIds = new Set<string>()
  for (const m of mistakes) {
    if (m.mastered) continue
    for (const kpId of m.knowledgePointIds ?? []) mistakeKpIds.add(kpId)
  }
  for (const kpId of mistakeKpIds) {
    const kp = kpMap.get(kpId)
    if (!kp) continue
    push({
      knowledgePointId: kpId,
      title: kp.title,
      type: 'mistake',
      reason: '你在这个知识点上有未掌握的错题',
    })
  }

  // 2. 需复习
  for (const p of progress) {
    if (p.status !== '需复习') continue
    const kp = kpMap.get(p.knowledgePointId)
    if (!kp) continue
    push({
      knowledgePointId: kp.id,
      title: kp.title,
      type: 'review',
      reason: `掌握度需要加强（已错 ${p.wrongCount} 次）`,
    })
  }

  // 3. 新知识点（考虑前置）
  for (const kp of pkg.knowledgePoints ?? []) {
    if (used.has(kp.id)) continue
    const p = progressMap.get(kp.id)
    if (p && (p.status === '已掌握' || p.status === '学习中')) continue

    const { unmet } = checkPrerequisites(pkg, kp.id, progress)

    if (unmet.length > 0) {
      // 推荐第一个未掌握的前置
      const pre = unmet[0]
      push({
        knowledgePointId: pre.id,
        title: pre.title,
        type: 'prerequisite',
        reason: `这是《${kp.title}》的前置知识，先掌握它才能继续`,
      })
    } else {
      push({
        knowledgePointId: kp.id,
        title: kp.title,
        type: 'new',
        reason: '前置已就绪，可以开始学习',
      })
    }
  }

  return result.slice(0, 6)
}