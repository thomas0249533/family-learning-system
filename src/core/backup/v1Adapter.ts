/**
 * v1（扁平）备份 → `Bundle[]` 的**适配器**（V1.4 · B2 / `system_design-v1.4.md` §6.6）
 *
 * ## 为什么需要适配器，而不是让合并引擎兼容两套格式
 * 合并引擎是纯函数、要被属性测试穷举（§6.5）。它只该认识一种输入形状。
 * 把"v1 的各种残缺"塞进它，等于让每个合并函数都要写一遍 `?? []`，
 * 而且这些兜底无法被单独测试。适配器把"形状差异"一次性收敛，
 * 之后合并引擎看到的永远是完整的 `Bundle`。
 *
 * ## 为什么**不做字段猜测**
 * v1 备份里没有 `masteryProbability`、没有 `fsrs`、没有 `examSessions`。
 * 可以给它们"补"上默认值（比如 `masteryProbability: 0.5`），让导入后的数据看起来更"完整"。
 * 那样做是错的：
 *   1. 补出来的值会**参与**后续判决（BKT 会拿 0.5 当"答过一次"的先验），
 *      于是"导入备份"悄悄改变了学习排期；
 *   2. 用户无法区分"这条记录本来就是这样"和"导入时编的"。
 * 所以：文件里没有的字段，输出里也没有。缺失由各合并函数自己的空值语义兜
 * （这也是为什么 `types.ts` 里 `unlockedAt` 允许空串）。
 *
 * ## 唯一的一处"补齐"：行的 `profileId`
 * 这不是猜字段，而是**归属**：`Bundle.profileId = 'default'` 已经声明了这份数据属于谁，
 * 而 `ProgressRecord.profileId` 在 `@/db` 里是**必填**字段（v4 的不可空约束）。
 * 若把 v1 的行原样交出去，合并引擎拿到的就是一批 `profileId: undefined` 的行 ——
 * 要么写库时落进 `undefined` 档案（不可见的数据），要么被 `tsc` 之外的运行时吞掉。
 * 与 v4 迁移的口径完全一致：**所有存量数据都进 `default`**。
 * 行里**已经有** `profileId` 的（v1 混入了中间版本的数据）一律**原样保留**，不改写、不校验。
 */

import type { ExamSessionRecord, MistakeRecord, ProgressRecord } from '@/db'
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME } from '@core/profile/profileTypes'
import { classifyKey } from '@core/profile/settingsScope'
import type { Bundle, LegacyFlat } from './types'

/** 只保留对象行（`null` / 字符串行无法参与合并；routeBackup 已在入口拒绝，这里再兜一层） */
function objectRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row)
  )
}

/**
 * 给行补上归属档案 —— **只在该行没有 `profileId` 时**。
 * 见文件头"唯一的一处补齐"。
 */
function withOwner<T extends object>(row: Record<string, unknown>, pid: string): T {
  const hasPid = typeof row.profileId === 'string' && row.profileId !== ''
  return (hasPid ? row : { ...row, profileId: pid }) as unknown as T
}

/**
 * v1 的 `settings` 是 `[{key, value}]`，键**没有** `:<pid>` 后缀（v1 时代只有一个档案）。
 *
 * 处理规则（与 v4 迁移的 `classifyKey` 口径完全一致）：
 *   - 登记过的 per-profile 键（`customChecks` 之类的键是后来才引入的，v1 老文件里不会有
 *     它们是**事实**，不是"当前有几个键"的断言 —— 写死数字会随 `PROFILE_SCOPED_KEYS` 漂）
 *     → 放进 `Bundle.settings`，键保持基名；
 *   - global 键（`profiles` / `achievement:customPacks` / 迁移标记 …）→ **丢弃**，
 *     由调用方从 `globalSettings` 走另一条路（导入 global 键会覆盖本机的档案列表，
 *     那是"换设备"的语义，不是"合并"的语义）；
 *   - **未知键 → 按 per-profile 处理**。理由同 v4 迁移：漏搬（数据消失且无报错）
 *     比多搬（串到一个新档案里，还能找到）可怕得多。
 *   - 万一混进了带后缀的键（`dailyStats:p2`），剥掉后缀按基名收下 ——
 *     v1 时代不该有后缀，出现就说明文件被别的版本写过；这里只做"不报错地收下"，
 *     不据此推断还有第二个档案（推断档案等于凭空造档案）。
 */
function adaptSettings(rows: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of objectRows(rows)) {
    const key = row.key
    if (typeof key !== 'string' || key === '') continue

    const scope = classifyKey(key)
    if (scope.kind === 'global') continue

    let base: string
    if (scope.kind === 'profile-legacy') base = scope.base
    else if (scope.kind === 'profile') base = scope.base
    else base = key // unknown：原样按 per-profile 收下

    out[base] = row.value
  }
  return out
}

/**
 * 把一份 v1 扁平备份整份包成**单个档案**的 Bundle 列表。
 *
 * 为什么是单个：v1 没有档案概念，所有数据属于同一个（唯一的）使用者。
 * `profileId` 用固定的 `'default'` 而不是随机 id —— 跨设备合并依赖
 * "同一个孩子 = 同一个 id"（见 `profileTypes.DEFAULT_PROFILE_ID` 的注释）。
 *
 * `packages` 字段**直接忽略**：学习包是设备级资产，由用户另外搬运
 * （`types.ts` 的 `BackupV2` 注释、PRD §P0-3b）。把包塞进数据备份会让
 * "导入数据"变成"导入几十兆题库"，且包的去重规则与进度完全不同。
 *
 * @param flat 已通过 `routeBackup` 判定的 v1 数据
 * @returns 恰好一个元素的 Bundle 数组（即使 v1 里一条数据都没有 —— 那也是一份
 *          "空档案"的备份，合并时按 noop 处理，由调用方决定要不要提示"没有新内容"）
 */
export function adaptV1ToBundles(flat: LegacyFlat): Bundle[] {
  const pid = DEFAULT_PROFILE_ID
  const createdAt = typeof flat.exportedAt === 'string' ? flat.exportedAt : ''

  const progress = objectRows(flat.progress).map((row) => withOwner<ProgressRecord>(row, pid))
  const mistakes = objectRows(flat.mistakes).map((row) => withOwner<MistakeRecord>(row, pid))

  return [
    {
      profileId: pid,
      name: DEFAULT_PROFILE_NAME,
      createdAt,
      progress,
      mistakes,
      // v1 没有考试记录这一层（`examSessions` 是 v2 schema 才进备份的）。
      // 写成 `[]` 而不是省略：`Bundle` 是"完整的一份档案"，省略会让合并函数多一条分支。
      examSessions: [] as ExamSessionRecord[],
      // 同理：v1 时代还没有"手动完成标记"这个概念（db v8 · V2.0 才加的表）
      cardCompletions: [],
      settings: adaptSettings(flat.settings),
    },
  ]
}
