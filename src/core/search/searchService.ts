import type { LearningPackageRecord, MistakeRecord } from '@/db'
import type { KnowledgePoint } from '@/schemas/knowledge-point'

export type SearchItemType = 'knowledgePoint' | 'exercise' | 'mistake'

export interface SearchResultItem {
  type: SearchItemType
  id: string
  title: string
  snippet: string
  knowledgePointId: string
  raw: any
}

export interface SearchGroup {
  knowledgePointId: string
  knowledgePointTitle: string
  items: SearchResultItem[]
}

/** 取关键词上下文的短摘要 */
function makeSnippet(text: string, keyword: string, maxLen = 100): string {
  if (!text) return ''
  const lower = text.toLowerCase()
  const kw = keyword.toLowerCase()
  const idx = lower.indexOf(kw)
  if (idx === -1) return text.slice(0, maxLen)
  const start = Math.max(0, idx - 20)
  const end = Math.min(text.length, idx + kw.length + 60)
  let s = text.slice(start, end)
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s
}

/**
 * 当前包内搜索：知识点 / 题目 / 错题
 * 结果按知识点分组
 */
export function searchInPackage(
  pkg: LearningPackageRecord | null,
  mistakes: MistakeRecord[],
  keyword: string
): SearchGroup[] {
  if (!pkg || !keyword.trim()) return []
  const kw = keyword.trim().toLowerCase()

  const kpMap = new Map<string, KnowledgePoint>()
  for (const kp of pkg.knowledgePoints || []) {
    kpMap.set(kp.id, kp)
  }

  const groupMap = new Map<string, SearchGroup>()

  const ensureGroup = (kpId: string): SearchGroup => {
    if (!groupMap.has(kpId)) {
      const kp = kpMap.get(kpId)
      groupMap.set(kpId, {
        knowledgePointId: kpId,
        knowledgePointTitle: kp?.title ?? '（未分类）',
        items: [],
      })
    }
    return groupMap.get(kpId)!
  }

  // 1. 知识点
  for (const kp of pkg.knowledgePoints || []) {
    const titleHit = kp.title?.toLowerCase().includes(kw)
    const contentHit = kp.content?.toLowerCase().includes(kw)
    if (titleHit || contentHit) {
      const g = ensureGroup(kp.id)
      g.items.push({
        type: 'knowledgePoint',
        id: kp.id,
        title: kp.title,
        snippet: makeSnippet(kp.content || '', keyword),
        knowledgePointId: kp.id,
        raw: kp,
      })
    }
  }

  // 2. 题目（规范化后顶层池，含 knowledgePointIds）
  for (const ex of pkg.exercises || []) {
    const questionHit = ex.question?.toLowerCase().includes(kw)
    const optionHit = (ex.options || []).some(
      (opt: string) => opt.toLowerCase().includes(kw)
    )
    if (questionHit || optionHit) {
      const kpIds: string[] = ex.knowledgePointIds || []
      if (kpIds.length === 0) {
        const g = ensureGroup('__uncategorized__')
        g.items.push({
          type: 'exercise',
          id: ex.id,
          title: ex.question,
          snippet: makeSnippet(ex.explanation || '', keyword),
          knowledgePointId: '__uncategorized__',
          raw: ex,
        })
      } else {
        for (const kpId of kpIds) {
          const g = ensureGroup(kpId)
          g.items.push({
            type: 'exercise',
            id: ex.id,
            title: ex.question,
            snippet: makeSnippet(ex.explanation || '', keyword),
            knowledgePointId: kpId,
            raw: ex,
          })
        }
      }
    }
  }

  // 3. 错题
  for (const m of mistakes) {
    const question: string = m.questionData?.question ?? ''
    if (!question.toLowerCase().includes(kw)) continue

    const kpIds: string[] = m.knowledgePointIds || []
    const push = (kpId: string) => {
      const g = ensureGroup(kpId)
      g.items.push({
        type: 'mistake',
        id: String(m.id),
        title: question,
        snippet: makeSnippet(m.questionData?.explanation || '', keyword),
        knowledgePointId: kpId,
        raw: m,
      })
    }

    if (kpIds.length === 0) push('__uncategorized__')
    else kpIds.forEach(push)
  }

  return Array.from(groupMap.values())
}