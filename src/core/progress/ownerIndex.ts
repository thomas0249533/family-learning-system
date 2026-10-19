/**
 * E-01 · 归属包（owner）解析 —— 纯函数，零 I/O、零 Dexie 依赖
 *
 * 语义（`docs/system_design-v1.3.md` §2.1 / C1）：
 *   `own` = **该包的 `knowledgePoints` 数组里声明了这个 kpId 的包**。
 *   不是 units 里引用它的包 —— units 口径全库只有 49.7% 能唯一解析，
 *   `knowledgePoints` 声明口径 100%（898/898）。
 *
 * 三分支，**零 tie-break**（C2）：
 *   |own| == 0 → null（不知道就不动）
 *   |own| >= 2 → null（歧义就不猜；**即使所有候选 title 完全相同也不选代表**）
 *   |own| == 1 → 该包，再过 subject 闸门
 *
 * ⚠️ 为什么必须"零 tie-break"：写入端错了会**永久污染**数据，
 *    而全库实测按 knowledgePoints 判定 100% 唯一解析 → 保守分支在生产数据里几乎不会触发，
 *    它只为"用户手工导入的裸 JSON"兜底。
 *
 * ⚠️ 禁止 stripPrefix 去重：english-7 的 49 个不同知识点共用 7 个裸 id
 *    （`docs/kp-id-ownership-english-7.md` §4.2）。短 id 只作为**兜底查找**，
 *    且仅在「全库只有一个声明者」时才敢用。
 */
import type { LearningPackageRecord } from '@/db'

/**
 * 组合键分隔符。
 * 用 `\u0000` 而不是 `::` —— 因为 id 前缀本身就用 `::`（`unit-xxx::kp-yyy`），
 * 用 `::` 做分隔会产生"`a::b` + `c`" 与 "`a` + `b::c`" 撞键的可能。
 */
export const KEY_SEP = '\u0000'

export interface OwnerIndex {
  /** kpId（原值） → 声明了它的 packageId 列表 */
  byKpId: Map<string, string[]>
  /** 短 id（去 `::` 前缀） → 声明了它的 packageId 列表。仅用于兜底，绝不单独用于写入决策 */
  byShortKpId: Map<string, string[]>
  /** packageId → subject，用于 subject 相容性闸门 */
  subjectByPkgId: Map<string, string>
}

/** 去掉 `pkg::` 前缀；无前缀时原样返回。与 `TopicDetail.vue` 里的实现语义一致 */
export function stripPrefix(id: string): string {
  if (!id) return ''
  const idx = id.indexOf('::')
  return idx >= 0 ? id.slice(idx + 2) : id
}

/** 往 `Map<string, string[]>` 里追加且去重（同一包重复声明同一 kpId 时不要重复计数） */
function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) {
    if (!list.includes(value)) list.push(value)
  } else {
    map.set(key, [value])
  }
}

/**
 * 建索引。成本：898 个 kp × 2 次 Map 写入 ≈ 1ms，包加载时算一次，**不入 DB、不落缓存**。
 *
 * @param packages 任意来源的包数组（store 里的、迁移事务里 `tx.table('packages')` 读出来的都行）
 */
export function buildOwnerIndex(packages: LearningPackageRecord[]): OwnerIndex {
  const byKpId = new Map<string, string[]>()
  const byShortKpId = new Map<string, string[]>()
  const subjectByPkgId = new Map<string, string>()

  for (const pkg of packages ?? []) {
    const packageId = pkg?.packageId
    if (!packageId) continue

    // 聚合包历史上曾缺 subject（实测构建产物已补全，但不依赖这一点）
    const subject = pkg.manifest?.subject
    if (typeof subject === 'string' && subject) subjectByPkgId.set(packageId, subject)

    for (const kp of pkg.knowledgePoints ?? []) {
      const kpId = kp?.id
      if (!kpId) continue
      pushUnique(byKpId, kpId, packageId)
      pushUnique(byShortKpId, stripPrefix(kpId), packageId)
    }
  }

  return { byKpId, byShortKpId, subjectByPkgId }
}

/**
 * 解析归属包。三分支，无 tie-break。
 *
 * @param kpId 进度里要用的 kpId（**原值**，不 strip）
 * @param entryPackageId 学习入口包（调用方传进来的是什么就是什么）
 * @param index `buildOwnerIndex` 的结果
 * @returns 归属 packageId，或 `null`（= 不归一化，保留原记录）
 */
export function resolveOwnerPackageId(
  kpId: string,
  entryPackageId: string,
  index: OwnerIndex
): string | null {
  if (!kpId) return null

  // ---- 1. 精确 id：唯一声明者才算 ----
  const exact = index.byKpId.get(kpId) ?? []
  let owner: string
  if (exact.length === 1) {
    owner = exact[0]
  } else if (exact.length >= 2) {
    // 歧义：不猜（不看 title、不看 packageType）
    return null
  } else {
    // ---- 2. 短 id 兜底：只有"全库唯一声明者"才敢用 ----
    const short = index.byShortKpId.get(stripPrefix(kpId)) ?? []
    if (short.length !== 1) return null // == 0：谁都没声明；>= 2：裸 JSON 路径的 english-7 死在这里
    owner = short[0]
  }

  // ---- 3. subject 闸门：跨学科归属一律视为异常，不动 ----
  // 任一侧缺失即跳过闸门 —— 不把 `undefined !== 'math'` 误判成"跨学科"
  const ownerSubject = index.subjectByPkgId.get(owner)
  const entrySubject = entryPackageId ? index.subjectByPkgId.get(entryPackageId) : undefined
  if (ownerSubject && entrySubject && ownerSubject !== entrySubject) return null

  return owner
}

/**
 * 规范化 kpId：把"历史行里的短 id"换成归属包声明的完整 id。
 *
 * - 精确命中 owner 的声明列表 → 原值返回（**99%+ 的情况，零变化**）
 * - 命中短 id 分支 → 返回 owner 声明的那个完整 id
 * - 都找不到 → 原值返回（防御性，正常不该发生）
 *
 * 只在 `resolveOwnerPackageId` **已解析出 owner** 时调用；owner 为 null 时不得调用。
 */
export function canonicalKpId(ownerPackageId: string, kpId: string, index: OwnerIndex): string {
  if (!ownerPackageId || !kpId) return kpId

  const declared = index.byKpId.get(kpId)
  if (declared && declared.includes(ownerPackageId)) return kpId

  // 短 id 分支：在 owner 声明的 id 里找短形相同的那个完整 id。
  // 只在兜底路径上发生，O(898) 可接受（一次作答最多一次）。
  const short = stripPrefix(kpId)
  for (const [fullId, owners] of index.byKpId) {
    if (stripPrefix(fullId) === short && owners.includes(ownerPackageId)) return fullId
  }
  return kpId
}

/**
 * 一步到位的便利函数：给定行键，返回归一化后的行键。
 * 解析失败 → 原样返回入参（不猜）。
 *
 * 仅供 `planProgressMerge` / `recordProgress` 这类"要两个字段一起换"的场景使用；
 * 只关心包归属时请直接调 `resolveOwnerPackageId`。
 */
export function resolveProgressKey(
  kpId: string,
  entryPackageId: string,
  index: OwnerIndex
): { packageId: string; knowledgePointId: string; resolved: boolean } {
  const owner = resolveOwnerPackageId(kpId, entryPackageId, index)
  if (!owner) {
    return { packageId: entryPackageId, knowledgePointId: kpId, resolved: false }
  }
  return {
    packageId: owner,
    knowledgePointId: canonicalKpId(owner, kpId, index),
    resolved: true,
  }
}
