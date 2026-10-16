/**
 * ID 重写：将局部 ID 加上包前缀
 * 规则：
 *   kp-num-001                → unit-xxx::kp-num-001
 *   unit-math-xxx::kp-num-001 → 保持不变（已重写）
 */
export function rewriteIdsInPackage(pkg: any, prefix: string): any {
  const out = JSON.parse(JSON.stringify(pkg))

  const rewrite = (id: string): string => {
    if (!id) return id
    if (id.includes('::')) return id
    return `${prefix}::${id}`
  }

  // ---------- 知识点 ----------
  for (const kp of out.knowledgePoints ?? []) {
    kp.id = rewrite(kp.id)
    if (Array.isArray(kp.prerequisites)) {
      kp.prerequisites = kp.prerequisites.map(rewrite)
    }
  }

  // ---------- ✅ 新增：顶层 exercises 池 ----------
  for (const ex of out.exercises ?? []) {
    ex.id = rewrite(ex.id)
    if (Array.isArray(ex.knowledgePointIds)) {
      ex.knowledgePointIds = ex.knowledgePointIds.map(rewrite)
    }
  }

  // ---------- units ----------
  for (const u of out.units ?? []) {
    u.id = rewrite(u.id)

    for (const t of u.topics ?? []) {
      t.id = rewrite(t.id)

      if (Array.isArray(t.knowledgePointIds)) {
        t.knowledgePointIds = t.knowledgePointIds.map(rewrite)
      }

      for (const m of t.modules ?? []) {
        m.id = rewrite(m.id)
        if (Array.isArray(m.knowledgePointIds)) {
          m.knowledgePointIds = m.knowledgePointIds.map(rewrite)
        }
      }

      for (const ex of t.exercises ?? []) {
        ex.id = rewrite(ex.id)
        if (Array.isArray(ex.knowledgePointIds)) {
          ex.knowledgePointIds = ex.knowledgePointIds.map(rewrite)
        }
      }
    }
  }

  return out
}