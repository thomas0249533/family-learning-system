/**
 * 为**指定档案**构建 `AchievementContext`（V1.4 · B4 家庭成就墙的地基）
 *
 * ## 为什么不能直接用 store 里那个 `buildContext()`
 * 那个函数取的是**当前档案**的上下文：`loadStreak()` / `loadDailyStats()` /
 * `loadAttemptedTypes()` 都不带参数，内部走 `currentProfileId()`。家庭墙要在同一屏
 * 渲染 4 个孩子的墙，如果复用它，4 列拿到的都是当前档案的数据 ——
 * 症状是"老二的徽章和老大的完全一样"，而且**不报错**。
 *
 * ## 为什么另写只读函数，而不是给 `loadDailyStats` 加个 pid 参数
 * `dailyStats` 与 `attemptedTypes` 都有**模块级单档案缓存**（切档案时钩子清空）：
 *   - 给它们加 pid 参数，就得把缓存改成 Map<pid, …>，热路径（每次答题累加）跟着变复杂；
 *   - 更糟的是：墙读完 A 再读 B，缓存里留着 B，当前档案的热路径随后就写进 B —— 串数据。
 * 所以墙走 `readDailyStatsFor(pid)` / `readAttemptedTypesFor(pid)`：**只读、不碰缓存**，
 * 当前档案的热路径完全不受影响。这是本模块存在的全部理由。
 *
 * ## 什么不是"按档案"的
 * - `packages`：学习包是**设备级资产**，所有档案共用同一份清单；
 * - `extraDefs`（自定义成就定义）：包是全局的，但 `manual-check` 的勾选态是 per-profile，
 *   所以调用方要用 `enabledPackDefs(state, await loadChecks(pid))` 为**每个档案**各算一份。
 *   本模块不替调用方做这件事 —— 它需要 `customPackStore`，那会把纯取值层拖进存储依赖。
 *
 * ## 纯读
 * 不写库、不写任何模块缓存、不改全局状态。相同输入反复调用结果一致。
 */
import type { MistakeRecord, ProgressRecord } from '@/db'
import {
  loadUnlocked,
  type AchievementContext,
  type AchievementDef,
  type PackageMeta,
  type UnlockedRecord,
} from './achievements'
import { loadStreak } from './streak'
import { readDailyStatsFor } from './dailyStats'
import { readAttemptedTypesFor } from './attemptedTypes'

export interface ProfileContextDeps {
  /** 学习包元信息（设备级，所有档案共用） */
  packages: PackageMeta[]
  /** 全量进度行（本函数内部按 profileId 过滤；传全量比让调用方各自过滤更不容易错） */
  progress: ProgressRecord[]
  /** 全量错题行（同上） */
  mistakes: MistakeRecord[]
}

/**
 * 单列墙需要的全部数据：上下文 + 解锁记录 + 该档案的自定义定义。
 *
 * 把三者一起返回，是为了让"同一列的三份数据必然来自同一个 pid"这件事由**类型**保证 ——
 * 让调用方自己去 `loadUnlocked(pid)` 迟早会漏传一个，而漏传的症状是
 * "这一列显示的是别人的徽章"，肉眼极难发现（两列长得一样）。
 */
export interface ProfileWallData {
  profileId: string
  ctx: AchievementContext
  records: UnlockedRecord[]
  extraDefs: AchievementDef[]
}

/**
 * 构建某个档案的成就上下文。
 *
 * `progress` / `mistakes` 在 `ProgressRecord` 里是**必填**字段（B1 起没有"全局行"形态），
 * 所以这里只做严格相等过滤，不做"缺省归 default"的兜底 ——
 * 兜底会让一条本该被迁移修好的脏数据永远潜伏下来。
 */
export async function buildContextForProfile(
  profileId: string,
  deps: ProfileContextDeps,
): Promise<AchievementContext> {
  const [streak, dailyStats, attemptedTypes] = await Promise.all([
    loadStreak(profileId),
    readDailyStatsFor(profileId),
    readAttemptedTypesFor(profileId),
  ])

  return {
    progress: deps.progress.filter((r) => r.profileId === profileId),
    mistakes: deps.mistakes.filter((r) => r.profileId === profileId),
    streak,
    packages: deps.packages,
    dailyStats,
    attemptedTypes,
  }
}

/**
 * 一列墙的完整数据（上下文 + 解锁记录 + 自定义定义）。
 *
 * `extraDefsOf` 由调用方注入（通常是 `enabledPackDefs(state, await loadChecks(pid))`）：
 * 勾选是 per-profile 的，必须在**每个 pid** 上单独算，不能拿一份给所有列共用。
 */
export async function loadProfileWall(
  profileId: string,
  deps: ProfileContextDeps,
  extraDefsOf: (profileId: string) => Promise<AchievementDef[]>,
): Promise<ProfileWallData> {
  const [ctx, records, extraDefs] = await Promise.all([
    buildContextForProfile(profileId, deps),
    loadUnlocked(profileId),
    extraDefsOf(profileId),
  ])
  return { profileId, ctx, records, extraDefs }
}
