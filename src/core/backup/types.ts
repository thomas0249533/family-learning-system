/**
 * 备份 v2 / 合并引擎的**类型契约**（V1.4 · B2 / `system_design-v1.4.md` §6、§7）
 *
 * ## 为什么类型单独一个文件
 * 合并引擎（`core/merge/`）与备份 IO（`core/backup/`）是两拨人并行写的。
 * 类型放在这里，两边 import 同一份，**不会有第二套口径**。
 * 依赖方向单向：`types.ts` 只 import `@/db` 的行类型与 `profileTypes`，
 * 不 import 任何实现文件（否则 merge ↔ backup 互相 import 就成环）。
 *
 * ## 三个接口的分工（别混）
 * - `Bundle`：**一个档案**的数据。settings 的键已剥掉 `:<pid>` 后缀。
 * - `LocalSnapshot`：本机现状（全部档案 + 全局键）。
 * - `MergePlan`：`planMerge()` 的纯输出 = "要写什么"。**它不碰 db、不读时钟、不产生随机**，
 *   这是能被 200 组属性测试穷举的前提。
 */

import type {
  ExamSessionRecord,
  MistakeRecord,
  ProgressRecord,
  SettingRecord,
} from '@/db'
import type { ProfileMeta } from '@/core/profile/profileTypes'

/** 当前备份格式版本。v1 = 无 `formatVersion` 或 `'1.0'`。 */
export const APP_FORMAT_VERSION = 2

/**
 * 单档案的一份数据。
 *
 * `settings` 的键是**剥掉 `:<profileId>` 之后的基名**（`achievements` / `dailyStats` …），
 * 写入时由 `mergeSettings` 再拼回去。这样合并函数不需要关心 pid 拼写，
 * 也不可能拼出 `dailyStats:p1:p1`。
 */
export interface Bundle {
  profileId: string
  /** 显示名；仅用于新建档案时落 `ProfileMeta`，**不覆盖本机已有名字** */
  name: string
  createdAt: string
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  examSessions: ExamSessionRecord[]
  /** 基名 → 值。只含 `PROFILE_SCOPED_KEYS` 里登记过的键中出现的那些 */
  settings: Record<string, unknown>
}

/** 本机现状快照（在事务**外**读，见 §6.4） */
export interface LocalSnapshot {
  profiles: ProfileMeta[]
  activeProfileId: string
  /** 与 `remote` 同构，便于同一个合并函数跑两边 */
  bundles: Bundle[]
  /** 全局键的现值（`profiles` / `achievement:customPacks` / 迁移标记 …） */
  globalSettings: Record<string, unknown>
}

/** 预览用统计。字段名与 UI 文案一一对应，别在这里加"只有测试用"的字段。 */
export interface MergeStats {
  profilesAdded: number
  progressAdded: number
  /** 本机更晚 → 保持本机（AC-P2-12 的可见证据） */
  progressKeptLocal: number
  mistakesAdded: number
  mistakesKeptLocal: number
  sessionsAdded: number
  sessionsKeptLocal: number
  /** `achievements` 并集后**新增**的徽章数 */
  achievementsAdded: number
  settingsChanged: number
  settingsKeptLocal: number
  /** 整份备份无新增（AC-P2-13）：`applyMergePlan` 见此为 true 必须零写入 */
  noop: boolean
}

/**
 * A6 · L2 **陈旧快照守卫**的基线（V1.6 · Stage A）。
 *
 * ## 它要防的是什么事故
 * 导入是两步：`previewImport` 在事务**外**读快照 → 家长点确认 → `executeImport` 才落库。
 * 两步之间孩子可能跑去学习页答题，本地 `progress` / `mistakes` 行被更新。
 * 直接 apply 就会用**备份里的旧值覆盖孩子刚产生的新记录** —— 而且不报错，
 * 症状只是"刚答对的题又变成未掌握"，家长根本不会把它和几分钟前的导入联系起来。
 *
 * ## 为什么是两层 Record
 * `progressKey`（`packageId\0knowledgePointId`）**故意不含 profileId** ——
 * 合并按档案逐个进行（见 `mergeProgress.ts` 文件头）。于是同一个 key 在两个档案下
 * 是两行，外层必须再套一层 `profileId` 才能唯一定位到"哪一行的基线"。
 *
 * ## 值为什么可以是 `null`
 * `null` = 快照时本机**没有**这一行（备份里新增的知识点）。
 * 到 apply 时它突然出现了，说明这两步之间本地新增了学习记录 —— 同样要中止。
 */
export interface StalenessGuard {
  /** 外层键 = profileId；内层键 = `progressKey`（`packageId\0knowledgePointId`） */
  progress: Record<string, Record<string, ProgressRecord | null>>
  /** 外层键 = profileId；内层键 = `exerciseId` */
  mistakes: Record<string, Record<string, MistakeRecord | null>>
}

export interface MergePlan {
  /** 只含**本机没有**的档案；已有档案的 name/createdAt 一律保持本机 */
  newProfiles: ProfileMeta[]
  progressUpserts: ProgressRecord[]
  mistakeUpserts: MistakeRecord[]
  sessionUpserts: ExamSessionRecord[]
  /** 键是**全名**（`dailyStats:p1`），直接 `settings.put` */
  settingUpserts: SettingRecord[]
  /**
   * A6 · L2 陈旧快照守卫：plan 生成时**本机行的基线**，由 `planMerge` 填充。
   *
   * `applyMergePlan` 在事务内、任何写入之前，按 plan 涉及的行重读库与此比对；
   * 不一致则抛 `code = 'stale-local-data'`（UI 提示"检测到新的学习记录，请重新预览"）。
   *
   * 为什么必填：守卫的失败模式是"没有基线"而不是"基线错了"。给它默认值
   * （`{}`）就等于让所有忘了填的调用方静默失去保护 —— 与 `planMerge` 第 4 个
   * 参数 `remoteGlobals` 同一条理由。
   */
  stalenessGuard: StalenessGuard
  stats: MergeStats
  /**
   * AC-P2-14：导入会超过档案上限 → **整笔拒绝**，不做部分导入。
   * 非空时 `applyMergePlan` 必须直接抛出，一行都不写。
   */
  reject?: { reason: 'profile-limit'; detail: string }
}

/** 空计划（自反/幂等的返回值，也是"没有新内容"的唯一构造方式） */
export function emptyPlan(): MergePlan {
  return {
    newProfiles: [],
    progressUpserts: [],
    mistakeUpserts: [],
    sessionUpserts: [],
    settingUpserts: [],
    // A6 · L2：空计划没有要写的行，也就没有基线可记（见 StalenessGuard）
    stalenessGuard: { progress: {}, mistakes: {} },
    stats: {
      profilesAdded: 0,
      progressAdded: 0,
      progressKeptLocal: 0,
      mistakesAdded: 0,
      mistakesKeptLocal: 0,
      sessionsAdded: 0,
      sessionsKeptLocal: 0,
      achievementsAdded: 0,
      settingsChanged: 0,
      settingsKeptLocal: 0,
      noop: true,
    },
  }
}

/** 计划是否有东西可写（`noop` 的唯一判据；避免各处自己数数组长度） */
export function isPlanNoop(plan: MergePlan): boolean {
  return (
    plan.newProfiles.length === 0 &&
    plan.progressUpserts.length === 0 &&
    plan.mistakeUpserts.length === 0 &&
    plan.sessionUpserts.length === 0 &&
    plan.settingUpserts.length === 0
  )
}

// ---------------------------------------------------------------------------
// 备份文件格式与版本路由（§7）
// ---------------------------------------------------------------------------

/**
 * v2 备份文件。
 *
 * **不含 `packages`**：学习包是设备级资产，由用户另外搬运（PRD §P0-3b）。
 * 把包塞进备份会让"导入数据"变成"导入几十兆题库"，且包的去重规则与进度完全不同。
 *
 * 行内**故意冗余** `profileId`（与所属档案重复）：备份可能被人工编辑过，
 * 行内 pid 与外层不一致时要能被检出并拒绝（`BACKUP_PROFILE_MISMATCH`），
 * 而不是静默按外层归属写入 —— 那种错误没有任何症状。
 */
export interface BackupV2 {
  formatVersion: 2
  exportedAt: string
  /** 仅排障用，**不参与任何判断** */
  appVersion: string
  /** 导出时人在哪个档案；导入**不据此切换**（不打断本机使用者） */
  activeProfileId: string
  profiles: Array<{
    profileId: string
    name: string
    createdAt: string
    progress: ProgressRecord[]
    mistakes: MistakeRecord[]
    examSessions: ExamSessionRecord[]
    /** 键已带 `:<pid>` 后缀 */
    settings: SettingRecord[]
  }>
  globalSettings: SettingRecord[]
}

/** V1.3 及更早的扁平备份：没有 profileId 这一层 */
export interface LegacyFlat {
  version?: string
  exportedAt?: string
  progress?: unknown[]
  mistakes?: unknown[]
  settings?: unknown[]
  /** 老的全量备份里可能有包；**导入时忽略**（见 `BackupV2` 注释） */
  packages?: unknown[]
}

export type BackupRejectReason = 'too-new' | 'unknown' | 'mismatch' | 'malformed'

export type BackupRoute =
  | { kind: 'v1'; data: LegacyFlat }
  | { kind: 'v2'; data: BackupV2 }
  | { kind: 'reject'; reason: BackupRejectReason; detail: string }
