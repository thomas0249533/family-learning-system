/**
 * 「手写作答」的**保留策略**（纯函数层）。
 * ---------------------------------------------------------------------------
 * ## 为什么必须有保留策略
 * 手写一行的体积不是"几十字节"：`cells` 是**逐格序列化笔迹**（每格 240 点 ×
 * 2 个 4 位小数 ≈ 2~4KB），一个 5 格的词就是 10~20KB。一个孩子一天随手练 20 题、
 * 一年就是几万行 / 上百 MB。IndexedDB 的配额是**整域共享**的，写爆之后连
 * `progress` 都存不进去 —— 那时丢的不是"笔迹"，是学习记录本身。
 *
 * 所以这里定两条闸门，逐层收紧：
 *   1. **每题留最近 K=2 条**（`keepRecentByExercise`）—— 再往前的同题作答对
 *      "回看最近两次尝试"这个唯一的读取场景已经没有价值；
 *   2. **每档案上限 M=2000 条，超了就压到 N=1800**（`pickOverflowByProfile`）——
 *      留出 200 的余量，否则每次提交都要跑一次淘汰。
 *
 * ## 红线：`pending` 永不自动清理
 * `pending` 是**待批改队列**，不是历史痕迹。它被自动删掉 = 孩子的作业凭空消失，
 * 而且是静默的（没有任何 UI 会因此报错）。所以两个函数都**跳过** `status === 'pending'`，
 * 全库上限也只统计**已批改**行 —— 极端情况下"攒了 3000 份没批的"会让表超过 M，
 * 这是有意接受的：宁可占空间，不可丢作业。真正的兜底是 UI 上的待批改角标
 * （提醒家长去批），而不是后台偷偷删。
 *
 * ## 为什么返回 id 列表而不是自己删
 * 纯函数才能单测：删除是 IO，判定是逻辑。store 层拿到 id 列表后一次 `bulkDelete`
 * （一次事务，而不是 N 次往返）。同时"删哪些"这件事可以在这里被逐条断言。
 *
 * ## 排序为什么全在内存里做
 * `tests/helpers/fakeDexie.ts` 的 `where` 只实现了 `.equals(v).first()/toArray()/
 * .count()/delete()`，**没有** `.sortBy() / .reverse() / .modify()`（见该文件头
 * "差异"第 3 条）。用到了会让测试炸 —— 但那不是"测试环境不够真"，而是刻意逼
 * 生产代码只依赖「索引选行 + 内存排序」这一个最小语义集：`createdAt` 排序还要
 * 跨档案分组，真 Dexie 的 `orderBy` 也帮不上忙（那是另一条索引路径，
 * 本表刻意没建 `[profileId+createdAt]` —— 死索引是技术债）。
 */
import type { HandwritingRecord } from '@/db'

/** 每题保留几条已批改记录（回看"最近两次尝试"够用） */
export const KEEP_PER_EXERCISE = 2
/** 每档案已批改记录的上限 */
export const MAX_ROWS_PER_PROFILE = 2000
/** 触发上限后压缩到的目标条数（留 10% 余量，避免每次提交都淘汰） */
export const KEEP_ROWS_PER_PROFILE = 1800

/**
 * 分组键：`profileId` + `exerciseId`。
 *
 * 为什么带 `profileId`：同一个 `exerciseId` 在两个孩子的档案里各有若干行，
 * 而 `id` 是**全库自增**。只按 `exerciseId` 分组会把老大的行算进老二的配额里
 * —— 症状是"老二答了一题，老大的旧记录被删了"，跨档案、而且不报错。
 */
function exerciseKey(row: HandwritingRecord): string {
  return `${row?.profileId ?? ''}\u0000${row?.exerciseId ?? ''}`
}

/** `createdAt` 降序，同刻按 `id` 降序（无 createdAt 的排最后） */
function byCreatedAtDesc(a: HandwritingRecord, b: HandwritingRecord): number {
  const ta = typeof a?.createdAt === 'string' ? a.createdAt : ''
  const tb = typeof b?.createdAt === 'string' ? b.createdAt : ''
  if (ta !== tb) return ta < tb ? 1 : -1
  return (b?.id ?? 0) - (a?.id ?? 0)
}

/** `createdAt` 升序（最旧的在前），同刻按 `id` 升序 */
function byCreatedAtAsc(a: HandwritingRecord, b: HandwritingRecord): number {
  return -byCreatedAtDesc(a, b) || 0
}

/** 可删除的行：有 id（没有 id 的行还在写、或来自内存夹具）且不是待批改 */
function deletable(row: HandwritingRecord): boolean {
  return typeof row?.id === 'number' && row.status !== 'pending'
}

/**
 * 同一题只留最近 `k` 条**已批改**记录，返回应删除的 id。
 *
 * - `pending` 一律跳过（待批改队列，见文件头红线）；
 * - 分组按 `(profileId, exerciseId)`，组内按 `createdAt` 降序保留前 `k`；
 * - `k <= 0` 视为"每题都不留"（把该题已批改的旧记录全删）—— 这是显式的清空语义，
 *   不是"参数错了"，所以不兜底成默认值。
 */
export function keepRecentByExercise(rows: HandwritingRecord[], k: number = KEEP_PER_EXERCISE): number[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const limit = Number.isFinite(k) ? Math.floor(k) : KEEP_PER_EXERCISE

  const groups = new Map<string, HandwritingRecord[]>()
  for (const row of rows) {
    if (!deletable(row)) continue
    const key = exerciseKey(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const doomed: number[] = []
  for (const bucket of groups.values()) {
    if (bucket.length <= Math.max(0, limit)) continue
    bucket.sort(byCreatedAtDesc)
    for (let i = Math.max(0, limit); i < bucket.length; i++) doomed.push(bucket[i].id!)
  }
  return doomed
}

/**
 * 每档案**已批改**记录超过 `max` 时，按 `createdAt` 升序淘汰到只剩 `keep` 条，
 * 返回应删除的 id。
 *
 * - 只统计 `status !== 'pending'`（见文件头红线：宁可超上限，不可丢作业）；
 * - 按 `profileId` 分组各自计额：`max` 是**每档案**上限，不是全库上限，
 *   否则老二一多写，老大的历史就被挤掉；
 * - `keep > max` 视为配置错误，夹到 `max`（否则"压缩到更多"会让函数永远删 0 条，
 *   上限形同虚设）。
 */
export function pickOverflowByProfile(
  rows: HandwritingRecord[],
  max: number = MAX_ROWS_PER_PROFILE,
  keep: number = KEEP_ROWS_PER_PROFILE
): number[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_ROWS_PER_PROFILE
  const target = Math.min(cap, Number.isFinite(keep) && keep >= 0 ? Math.floor(keep) : KEEP_ROWS_PER_PROFILE)

  const groups = new Map<string, HandwritingRecord[]>()
  for (const row of rows) {
    if (!deletable(row)) continue
    const pid = row?.profileId ?? ''
    const bucket = groups.get(pid)
    if (bucket) bucket.push(row)
    else groups.set(pid, [row])
  }

  const doomed: number[] = []
  for (const bucket of groups.values()) {
    if (bucket.length <= cap) continue
    bucket.sort(byCreatedAtAsc)
    // 淘汰最旧的 (总数 - target) 条：留下的是"最近 target 条"
    const dropCount = bucket.length - target
    for (let i = 0; i < dropCount; i++) doomed.push(bucket[i].id!)
  }
  return doomed
}

/**
 * 把两个来源的 id 合成一份去重的删除清单。
 * 单独一个函数是因为「同一条既超每题限额、又超全库上限」是常态，
 * 重复 `bulkDelete` 同一个 id 在真 Dexie 里不会报错但会多一次往返，
 * 而**顺序**在测试里可断言（先每题、后全库）。
 */
export function mergePurgeIds(...lists: number[][]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const list of lists) {
    for (const id of list) {
      if (typeof id !== 'number' || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
