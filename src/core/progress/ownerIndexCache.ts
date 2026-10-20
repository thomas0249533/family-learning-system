/**
 * 归属索引的**进程内缓存**（D1：调用点 O(1)，不再每次作答读一次 DB）。
 *
 * 为什么单独一个文件：
 *   - `userData.recordProgress` 需要它（写入收口）；
 *   - `packageStore.loadPackages` 需要把最新的 packages 塞进来（包变更时刷新）；
 *   - `backup/importOrchestrator` 需要它（备份内的行也要归一化）。
 * 如果缓存放在 `userData.ts`，`packageStore` 就得反向 import store → 循环依赖。
 *
 * 失效时机：包导入/删除（`invalidateOwnerIndex()` / `setOwnerIndexSource()`）。
 * 成本：898 个 kp × 2 次 Map 写入 ≈ 1ms 级，只在包加载时算一次，**不入 DB、不落 localStorage**。
 */
import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'
import { buildOwnerIndex, type OwnerIndex } from './ownerIndex'

let cache: OwnerIndex | null = null
let source: LearningPackageRecord[] | null = null
let inflight: Promise<OwnerIndex> | null = null

/** 包加载/导入后把最新数组推进来（同时刷新缓存） */
export function setOwnerIndexSource(packages: LearningPackageRecord[]): void {
  source = packages ?? []
  cache = buildOwnerIndex(source)
  inflight = null
}

/** 包变更（导入成功、删除包）后调用：下次用到时再重建 */
export function invalidateOwnerIndex(): void {
  cache = null
  source = null
  inflight = null
}

/** 同步读缓存；没建过返回 null（调用方自行决定要不要 await） */
export function peekOwnerIndex(): OwnerIndex | null {
  return cache
}

/**
 * 拿索引。缓存在则 O(1) 返回；否则从 `db.packages` 建一次并缓存。
 *
 * 读库失败 → 返回空索引（等价"全部解析失败 → 保留入口包"），
 * 绝不让"建索引失败"把一次作答搞崩（D9 同款思路：能降级就降级）。
 */
export async function ensureOwnerIndex(): Promise<OwnerIndex> {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const packages = source ?? (await db.packages.toArray())
      const index = buildOwnerIndex(packages)
      // 并发调用时可能已被 setOwnerIndexSource 覆盖，以最后一次设置为准
      if (!cache) {
        source = packages
        cache = index
      }
      return cache
    } catch (e) {
      console.warn('[ownerIndex] 建索引失败，本次按"不归一化"处理', e)
      const empty = buildOwnerIndex([])
      cache = empty
      return empty
    } finally {
      inflight = null
    }
  })()

  return inflight
}
