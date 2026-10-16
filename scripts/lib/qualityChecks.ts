/**
 * 质量检查：只报警告，不阻断导入。
 * 用于引导内容生产遵循推荐写法。
 */

import type { NormalizeIssue } from '../../src/core/importer/normalizePackage'

export function qualityChecks(raw: any): NormalizeIssue[] {
  const warnings: NormalizeIssue[] = []
  const pkgId = raw?.manifest?.packageId ?? '?'

  // ---------- W030：题目写在顶层 exercises 池 ----------
  if (Array.isArray(raw.exercises) && raw.exercises.length > 0) {
    warnings.push({
      level: 'warning',
      code: 'W030',
      path: 'exercises',
      message: `包 ${pkgId} 有 ${raw.exercises.length} 道题写在顶层 exercises，建议移到对应 topic.exercises`,
      hint: '推荐写法：题目放在 topic.exercises 里，让打包脚本和渲染逻辑更清晰',
    })
  }

  // ---------- W031：topic 没有 modules ----------
  for (const u of raw.units ?? []) {
    for (const t of u.topics ?? []) {
      if (!Array.isArray(t.modules) || t.modules.length === 0) {
        warnings.push({
          level: 'warning',
          code: 'W031',
          path: `units[${u.id}].topics[${t.id}].modules`,
          message: `topic ${t.id} 没有 modules，将依赖知识点类型自动渲染`,
          hint: '推荐写法：每个 topic 至少声明 1 个 module.type',
        })
      }
    }
  }

  // ---------- W032：知识点 ID 已带 :: 前缀 ----------
  for (const kp of raw.knowledgePoints ?? []) {
    if (typeof kp.id === 'string' && kp.id.includes('::')) {
      warnings.push({
        level: 'warning',
        code: 'W032',
        path: `knowledgePoints`,
        message: `知识点 ID 已带 :: 前缀（如 ${kp.id}），引擎一应输出裸 ID`,
        hint: '前缀由打包脚本自动加，引擎一不要手写',
      })
      break
    }
  }

  // ---------- W033：题目 ID 已带 :: 前缀 ----------
  outer:
  for (const u of raw.units ?? []) {
    for (const t of u.topics ?? []) {
      for (const ex of t.exercises ?? []) {
        if (typeof ex.id === 'string' && ex.id.includes('::')) {
          warnings.push({
            level: 'warning',
            code: 'W033',
            path: `units[${u.id}].topics[${t.id}].exercises`,
            message: `题目 ID 已带 :: 前缀（如 ${ex.id}），引擎一应输出裸 ID`,
            hint: '前缀由打包脚本自动加，引擎一不要手写',
          })
          break outer
        }
      }
    }
  }

  return warnings
}