import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'

export interface DependencyCheckResult {
  /** 缺失的依赖 packageId */
  missing: string[]
  /** 已存在的依赖 packageId */
  present: string[]
  /** 循环依赖链，如 [['A','B','A']] */
  circular: string[][]
  /** 全部 OK */
  ok: boolean
}

/**
 * 检查一个包的依赖是否满足
 * 环检测：从当前包出发，DFS 遍历依赖图
 */
export async function checkDependencies(
  pkg: LearningPackageRecord
): Promise<DependencyCheckResult> {
  const missing: string[] = []
  const present: string[] = []

  // 1. 收集所有本地包
  const allPackages = await db.packages.toArray()
  const pkgMap = new Map<string, LearningPackageRecord>()
  for (const p of allPackages) {
    pkgMap.set(p.packageId, p)
  }
  // 当前包加入
  pkgMap.set(pkg.packageId, pkg)

  // 2. 直接依赖：存在性检查
  const directDeps: string[] = pkg.manifest.dependencies ?? []
  for (const depId of directDeps) {
    if (pkgMap.has(depId)) present.push(depId)
    else missing.push(depId)
  }

  // 3. 环检测（DFS）
  const circular: string[][] = []
  const visited = new Set<string>()
  const stack: string[] = []
  const inStack = new Set<string>()

  function dfs(id: string) {
    if (inStack.has(id)) {
      const idx = stack.indexOf(id)
      if (idx >= 0) circular.push([...stack.slice(idx), id])
      return
    }
    if (visited.has(id)) return

    visited.add(id)
    inStack.add(id)
    stack.push(id)

    const node = pkgMap.get(id)
    if (node?.manifest.dependencies) {
      for (const depId of node.manifest.dependencies) {
        if (pkgMap.has(depId)) dfs(depId)
      }
    }

    stack.pop()
    inStack.delete(id)
  }

  dfs(pkg.packageId)

  return {
    missing,
    present,
    circular,
    ok: missing.length === 0 && circular.length === 0,
  }
}