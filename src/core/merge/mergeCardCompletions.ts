/**
 * 跨设备合并 · 手动「已完成」标记（V3.0 · M4）
 *
 * ## 为什么这张表也要进合并
 * 标记本身是**便利信息**（真的学习数据是 `progress` / `mistakes`），但它有一个
 * 别处没有的性质：**无法从备份里重建**。
 * 自动判定通道（`completionStatusOf` 的自动分支）只能把"所有知识点都学过且没错题"
 * 的卡片判绿；家长手动点绿的往往是"这个单元我让孩子口算过了，不用刷题"——
 * 这种**家长的判断**不在任何数据里。换机后它消失，家长看到的是"我标过的一整片又变灰了"，
 * 只能一个个重新点。
 *
 * 所以 M4 把"换机后标记不丢"写进了验收（`docs/plan/v3.0-milestone.md`），
 * 自动快照与自检报告都要覆盖这一项。
 *
 * ## 合并语义：纯并集，没有"谁覆盖谁"
 * 一条标记的全部内容就是"这张卡片被标过"（`createdAt` 只是审计痕迹，
 * 不参与任何判断、界面上也不显示）。所以两台设备各标了不同卡片 → 并集；
 * 同一张卡片两边都有 → 留本机那行（记 `keptLocal`），内容完全等价。
 *
 * 这带来一个好处：合并是**幂等**的（同 key 不写，AC-P2-13 的零写入得以成立），
 * 也是**可交换**的（并集），不需要像 `progress` 那样挑更晚的一条。
 *
 * ## key 为什么不含 `profileId`
 * 与 `mergeProgress` / `mergeMistakes` / `mergeSessions` 同一条口径：合并按档案逐个进行
 * （`planMerge` 的循环体里 pid 是外层常量），key 里再带 pid 只是把同一个值拼两遍。
 * 但 `[kind, packageId, targetId]` 三者**缺一不可** —— 同一个单元 id 在两个不同的包里
 * 完全可能重名，少了 `packageId` 会把两个包的标记合成一个，孩子少掉一整片绿。
 */

import type { CardCompletionRecord } from '@/db'
import { MERGE_KEY_SEP, stripRowId } from './mergeProgress'

export interface MarkMergeOutcome {
  upserts: CardCompletionRecord[]
  added: number
  keptLocal: number
}

/**
 * 标记定位 key：`kind \0 packageId \0 targetId`（见文件头末段）。
 *
 * 用 `\0` 而不是 `::`：包 id / 单元 id 都是用户可见、可被学习包作者命名的字符串，
 * `pkg::unit` 这种拼接会与"包 id 里本来就有 `::`"的情况撞键，撞了之后
 * 两张不同卡片的标记会被判成同一张 —— 症状是"我明明标了另一个单元，它变绿了"。
 */
export function markKey(
  row: Pick<CardCompletionRecord, 'kind' | 'packageId' | 'targetId'>,
): string {
  return `${row.kind}${MERGE_KEY_SEP}${row.packageId}${MERGE_KEY_SEP}${row.targetId}`
}

/**
 * 合并一个档案的完成标记（纯函数）。
 *
 * 不做任何合法性判断（`kind` 是不是那两个值、字段是否为空字符串）：那是
 * `routeBackup` 的职责，合并层再判一次就是第二套口径。这里只保证**幂等 + 并集**。
 */
export function mergeCardCompletions(
  local: readonly CardCompletionRecord[],
  remote: readonly CardCompletionRecord[],
): MarkMergeOutcome {
  const seen = new Set<string>()
  for (const row of local) {
    if (!row) continue
    seen.add(markKey(row))
  }

  const upsertByKey = new Map<string, CardCompletionRecord>()
  let keptLocal = 0

  for (const row of remote) {
    if (!row) continue
    const k = markKey(row)
    if (seen.has(k)) {
      keptLocal++
      continue
    }
    seen.add(k)
    upsertByKey.set(k, stripRowId(row) as CardCompletionRecord)
  }

  return { upserts: [...upsertByKey.values()], added: upsertByKey.size, keptLocal }
}
