/**
 * 跨设备合并 · 模考记录（V1.4 · B2 / `system_design-v1.4.md` §6.3）
 *
 * ## 为什么 key 必须带 `startedAt`
 * `sessionIndex` 是"这个包里第几次模考"，是**每台设备各自数的序号**。
 * 两台设备都可能做出"第 3 次模考"，但它们其实是**两场不同的考试**：
 * 孩子在学校电脑上考了一场，回家又考了一场。
 *
 * 若只按 `packageId + sessionIndex` 去重，这两场会被合成一场，
 * 结果就是 `finalRate` 只剩一个 —— 成绩单上"两次模考"变成"一次"，
 * 而且哪一场的分数被留下完全取决于导入顺序（不可复现，无法解释）。
 *
 * 把 `startedAt` 放进 key 之后，同一次考试在两台设备上必然同 key
 * （同一次考试只有一次开始时刻），两场不同考试自然不同 key。
 *
 * ## 同 key 为什么保持本机
 * 同一场考试在两台设备上的差异只可能是"做到一半同步过来"与"已经做完了"。
 * 选本机 = 选当前设备看到的状态，至少不会把孩子的答题进度往回退；
 * 而且"相等/同 key 不写"是幂等（AC-P2-13）的前提。
 */

import type { ExamSessionRecord } from '@/db'
import { MERGE_KEY_SEP, stripRowId } from './mergeProgress'

export interface SessionMergeOutcome {
  upserts: ExamSessionRecord[]
  added: number
  keptLocal: number
}

/** 场次定位 key：`packageId \0 sessionIndex \0 startedAt`（见文件头） */
export function sessionKey(
  row: Pick<ExamSessionRecord, 'packageId' | 'sessionIndex' | 'startedAt'>,
): string {
  return `${row.packageId}${MERGE_KEY_SEP}${row.sessionIndex}${MERGE_KEY_SEP}${row.startedAt}`
}

/**
 * 合并一个档案的模考记录（纯函数）。
 *
 * 只做两件事：本机没有的场次补进来；本机已有的场次**原样不动**（记 `keptLocal`）。
 * 没有"取更晚"这种比较 —— 两场不同的考试之间不存在谁覆盖谁的问题。
 */
export function mergeSessions(
  local: readonly ExamSessionRecord[],
  remote: readonly ExamSessionRecord[],
): SessionMergeOutcome {
  const seen = new Set<string>()
  for (const row of local) seen.add(sessionKey(row))

  const upsertByKey = new Map<string, ExamSessionRecord>()
  let keptLocal = 0

  for (const row of remote) {
    const k = sessionKey(row)
    if (seen.has(k)) {
      keptLocal++
      continue
    }
    seen.add(k)
    upsertByKey.set(k, stripRowId(row) as ExamSessionRecord)
  }

  return { upserts: [...upsertByKey.values()], added: upsertByKey.size, keptLocal }
}
