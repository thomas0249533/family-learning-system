/**
 * 跨设备合并 · 错题行（V1.4 · B2 / `system_design-v1.4.md` §6.3）
 *
 * ## 关键裁决：等级只升不降
 * 错题有三级掌握状态（`none` → `partial` → `mastered`），等级**代表孩子的努力**。
 * 如果只按 `wrongAt` 更晚者胜，会出现这种事：
 *   设备 A（家里平板）：孩子把这道题复习到 mastered，`wrongAt` 还是三天前；
 *   设备 B（学校电脑）：那天答错一次，`wrongAt` 是今天。
 * 单看时间是 B 更晚，取 B 就等于**把孩子练到 mastered 的过程整行抹掉**，
 * 孩子第二天打开看到的还是"未掌握"，而他明明已经会了 —— 这是最伤人的一种 bug。
 *
 * 所以规则是：`wrongAt` 更晚者胜，**但胜者的等级不得低于本机**；
 * 若远端更晚却等级更低 → 保持本机。宁可让 `wrongAt` 停在较早的那天，
 * 也不让等级倒退（`wrongAt` 只影响错题本排序，等级影响孩子看到什么）。
 *
 * ## 其余同 mergeProgress
 * key 是 `exerciseId`、整行胜、剥掉自增 `id`、相等取本机。理由见 mergeProgress 文件头。
 */

import type { MistakeMasteryLevel, MistakeRecord } from '@/db'
import { stripRowId } from './mergeProgress'

export interface MistakeMergeOutcome {
  upserts: MistakeRecord[]
  added: number
  keptLocal: number
}

/** 等级序：只用来比较，别拿它当展示文案 */
export const MASTERY_LEVEL_RANK: Record<MistakeMasteryLevel, number> = {
  none: 0,
  partial: 1,
  mastered: 2,
}

/** 包内定位 key：错题按 `exerciseId` 去重（同一档案内一道题一行） */
export function mistakeKey(row: Pick<MistakeRecord, 'exerciseId'>): string {
  return row.exerciseId
}

/**
 * 取有效等级。
 *
 * `mastered: boolean` 是 P3 之前的老字段，与 `masteryLevel === 'mastered'` 等价
 * （见 `@/db` 的注释）。老备份里只有 `mastered`、没有 `masteryLevel`，
 * 若只读 `masteryLevel`，那些行会被当成 `none` —— 合并时等级判断全错。
 */
export function mistakeLevel(
  row: Pick<MistakeRecord, 'masteryLevel' | 'mastered'>,
): MistakeMasteryLevel {
  const lv = row.masteryLevel
  if (lv === 'none' || lv === 'partial' || lv === 'mastered') return lv
  return row.mastered ? 'mastered' : 'none'
}

/** 等级的数值序，比较用 */
export function mistakeLevelRank(row: Pick<MistakeRecord, 'masteryLevel' | 'mastered'>): number {
  return MASTERY_LEVEL_RANK[mistakeLevel(row)]
}

function cmp(a: string, b: string): -1 | 0 | 1 {
  if (a > b) return 1
  if (a < b) return -1
  return 0
}

/** `wrongAt` 排序值（缺字段按空串，空串最小） */
function wrongAtOf(row: Pick<MistakeRecord, 'wrongAt'>): string {
  return row.wrongAt ?? ''
}

/**
 * 合并一个档案的错题行（纯函数）。
 *
 * 逐条判据：
 *   - 远端 `wrongAt` **更晚** 且等级 **不低于** 本机 → 取远端；
 *   - 远端 `wrongAt` **更晚** 但等级 **更低** → 保持本机（等级只升不降，见文件头）；
 *   - 远端 `wrongAt` **更早** → 保持本机；
 *   - `wrongAt` **相等** → 取等级高者；等级也相等 → 保持本机。
 */
export function mergeMistakes(
  local: readonly MistakeRecord[],
  remote: readonly MistakeRecord[],
): MistakeMergeOutcome {
  const state = new Map<string, MistakeRecord>()
  for (const row of local) {
    const k = mistakeKey(row)
    const prev = state.get(k)
    // 本机自带的重复 key（脏数据）先自我收敛：更晚者胜，其次等级高者胜
    if (!prev) {
      state.set(k, row)
      continue
    }
    const byTime = cmp(wrongAtOf(row), wrongAtOf(prev))
    if (byTime > 0 || (byTime === 0 && mistakeLevelRank(row) > mistakeLevelRank(prev))) {
      state.set(k, row)
    }
  }

  const upsertByKey = new Map<string, MistakeRecord>()
  let keptLocal = 0

  for (const row of remote) {
    const k = mistakeKey(row)
    const localRow = state.get(k)
    if (!localRow) {
      state.set(k, row)
      upsertByKey.set(k, stripRowId(row) as MistakeRecord)
      continue
    }

    const byTime = cmp(wrongAtOf(row), wrongAtOf(localRow))
    const remoteRank = mistakeLevelRank(row)
    const localRank = mistakeLevelRank(localRow)

    const takeRemote = byTime > 0 ? remoteRank >= localRank : byTime === 0 && remoteRank > localRank

    if (takeRemote) {
      state.set(k, row)
      upsertByKey.set(k, stripRowId(row) as MistakeRecord)
    } else {
      keptLocal++
    }
  }

  return { upserts: [...upsertByKey.values()], added: upsertByKey.size, keptLocal }
}
