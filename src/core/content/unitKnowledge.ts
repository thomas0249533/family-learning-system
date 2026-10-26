/**
 * unitKnowledge.ts —— 单元 → 知识点 ID 的推导。
 *
 * 背景：本仓词汇包（如 special-chinese-4-up-vocab.json）的
 * `unit.knowledgePointIds` 是**空数组**，真正的词挂在
 * `unit.topics[].modules[].knowledgePointIds`。旧代码用
 * `u.knowledgePointIds ?? props.knowledgePointIds`，空数组不是 null → `??` 不兜底
 * → 选中单元后拿到 []，导致词表清空 / 切换失效。
 *
 * 本函数统一"单元下全部知识点"的取法：优先单元显式字段，否则从 topics/modules
 * 汇总去重。纯函数、无副作用、无 DB 依赖，便于单测。
 */
export function deriveUnitKnowledgePointIds(unit: any): string[] {
  if (Array.isArray(unit?.knowledgePointIds) && unit.knowledgePointIds.length > 0) {
    return unit.knowledgePointIds
  }
  const ids: string[] = []
  for (const topic of unit?.topics ?? []) {
    for (const mod of topic?.modules ?? []) {
      const arr = Array.isArray(mod?.knowledgePointIds)
        ? mod.knowledgePointIds
        : Array.isArray(mod?.knowledgePoints)
          ? mod.knowledgePoints
          : []
      ids.push(...arr)
    }
    if (Array.isArray(topic?.knowledgePointIds)) ids.push(...topic.knowledgePointIds)
  }
  return Array.from(new Set(ids))
}
