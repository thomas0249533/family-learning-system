/**
 * 跨设备合并 · 进度行（V1.4 · B2 / `system_design-v1.4.md` §6.3）
 *
 * ## 为什么是「整行胜」而不是字段级合并
 * 一行进度里 `fsrs` / `bkt` / `nextReviewAt` / `lastReviewAt` 是一组**互相咬合**的状态。
 * 只取 A 的 `fsrs` 加 B 的 `nextReviewAt`，排期就会指向一个两台设备都没算过的日期。
 * 而这种错乱的症状是「昨天复习过的知识点今天又冒出来」—— 孩子不会报告，
 * 家长只会觉得"这系统怎么老是重复"。所以只比「谁更晚」，然后**整行搬走**。
 *
 * ## key 里为什么没有 `profileId`
 * 合并是**按档案逐个**进行的（`Bundle` 层就代表"一个档案"），包内只需要
 * `packageId + knowledgePointId` 定位。若把 pid 塞进 key，拼错一次就变成
 * "永远合并不上"：两份数据谁都不覆盖谁，库里留下两行同一个知识点，统计直接翻倍。
 *
 * ## 相等为什么取本机
 * 两个作用：
 *   1. 少写一次库（相等还写等于每次导入都全表重写，导入变成 IO 风暴）；
 *   2. `merge(local, local)` 的 upserts 自动为空 → 幂等（AC-P2-13）不用另写特判。
 */

import type { ProgressRecord } from '@/db'

/**
 * 复合 key 的分隔符：`\u0000` 不可能出现在 `packageId` / `knowledgePointId` 里。
 * 用 `'|'` 之类的可见字符会出真事故：`a|b` + `c` 与 `a` + `b|c` 撞成同一个 key。
 */
export const MERGE_KEY_SEP = '\u0000'

export interface ProgressMergeOutcome {
  /** 需要写库的行（已剥掉自增 `id`） */
  upserts: ProgressRecord[]
  /** 远端胜出、需要写库的行数（含覆盖既有行） */
  added: number
  /** 本机更晚**或相等** → 保持本机（AC-P2-12 的可见证据） */
  keptLocal: number
}

/**
 * 剥掉自增主键。
 *
 * apply 阶段要靠复合索引去找**既有行**再 `update(id)`，所以计划里绝不能带 id：
 * 带了 id 又 add 进去，会在同一个知识点上凭空多出一行（id 是定值，第二次导入直接主键冲突）。
 *
 * 为什么挂在 `mergeProgress` 上而不是单独的 util 文件：`merge/m/` 目录只允许这几个文件
 * （见任务书），而本模块不依赖任何兄弟模块，放这里不会成环。
 * 名字前缀 `_` 让 `noUnusedLocals` 放过这个"故意不用"的变量。
 */
export function stripRowId<T extends { id?: number }>(row: T): Omit<T, 'id'> {
  const { id: _dropId, ...rest } = row
  return rest
}

/** 包内定位 key：同一个知识点在两个档案里是两行，所以 pid 不进 key（见文件头） */
export function progressKey(row: Pick<ProgressRecord, 'packageId' | 'knowledgePointId'>): string {
  return `${row.packageId}${MERGE_KEY_SEP}${row.knowledgePointId}`
}

/**
 * 排序值：优先 `lastReviewAt`，退化到 `lastStudiedAt`，再退化到空串。
 *
 * **必须用 `??` 不能用 `||`**：`lastReviewAt` 的类型是 `string | null | undefined`，
 * 而 `lastStudiedAt` 在老数据里可能是 `''`。用 `||` 会把 `''` 也当假值吃掉，
 * 于是"从没学过"（`''`）和"学过但没复习"被算成同一个值，
 * 两台设备的空进度行会互相覆盖 —— 覆盖的结果是 `correctCount` 归零。
 *
 * 形参是 `Partial<Pick<…>>` 而不是 `Pick<…>`：`ProgressRecord.lastStudiedAt` 在**库里的
 * 契约**是必填，但本函数是纯排序工具，实现里第三段 `?? ''` 明确支持"两个都没有"的形态
 * （手搓的部分行 / 老备份映射出来的行）。类型比实现更严也是失真 —— 调用方会被迫写
 * `as` 才能测这条分支，而 `as` 一旦用惯，真正该报错的地方也一起被盖住了。
 */
export function progressRank(
  row: Partial<Pick<ProgressRecord, 'lastReviewAt' | 'lastStudiedAt'>>,
): string {
  return row.lastReviewAt ?? row.lastStudiedAt ?? ''
}

/**
 * 三态比较：`'>' | '<' | '='`，只用于 ISO 字符串。
 *
 * ⚠️ 字典序 = 时间序**只在同格式下成立**：比较值来自 `progressRank`
 * （`lastReviewAt ?? lastStudiedAt`），当前所有写入口都发 UTC 全时刻
 * （`...Z`，见 tests/review-time-contract.test.ts 钉住的格式契约）。
 * 一旦混入带偏移格式（`+08:00`）或日精度串，字典序就会与时间序脱钩——
 * 更早的瞬时可能胜出，直接违反「单调不减」。要改写入口格式，必须先来这里
 * 改成 `new Date(a).getTime()` 时刻比较（注意日精度串 '2026-02-01' 解析为
 * UTC 零点，与同时刻瞬时的相等语义需要一并裁定）。
 */
function cmp(a: string, b: string): -1 | 0 | 1 {
  if (a > b) return 1
  if (a < b) return -1
  return 0
}

/**
 * 合并一个档案的进度行。
 *
 * 纯函数：不读时钟、不碰 db、不产生随机（这是 200 组属性测试能跑 3 毫秒的前提）。
 * `local` 里同一个 key 出现多次（历史脏数据）时按"更晚者胜"先自我收敛，
 * 否则结果会依赖行序，属性测试的幂等性就断了。
 */
export function mergeProgress(
  local: readonly ProgressRecord[],
  remote: readonly ProgressRecord[],
): ProgressMergeOutcome {
  const state = new Map<string, ProgressRecord>()
  for (const row of local) {
    const k = progressKey(row)
    const prev = state.get(k)
    if (!prev || cmp(progressRank(row), progressRank(prev)) > 0) state.set(k, row)
  }

  const upsertByKey = new Map<string, ProgressRecord>()
  let keptLocal = 0

  for (const row of remote) {
    const k = progressKey(row)
    const localRow = state.get(k)

    // 远端更晚才覆盖；本机更晚**或相等**一律保持本机（见文件头「相等为什么取本机」）
    if (!localRow || cmp(progressRank(row), progressRank(localRow)) > 0) {
      state.set(k, row)
      upsertByKey.set(k, stripRowId(row) as ProgressRecord)
    } else {
      keptLocal++
    }
  }

  return { upserts: [...upsertByKey.values()], added: upsertByKey.size, keptLocal }
}
