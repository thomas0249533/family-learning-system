/**
 * JSON 成就包的**类型与常量**（V1.4 · B3 / PRD `P0-1`、设计 `§8.4`）
 *
 * ## 为什么类型单独一个文件
 * 校验器（纯函数）、存储层（读写 db）、视图装配（`achievementMeta`）三个人写，
 * 共享同一份类型才不会有第二套口径。本文件**只有类型和常量**，没有 logic、不 import `@/db`
 * （避免 `db → … → customPackTypes` 之类的环）。
 *
 * ## 一条贯穿始终的裁决（D2）
 * 规则**白名单只有两种**：`manual-check` 与 `counter`。**不预留 `expr` 字段** ——
 * 预留一个永远报错的字段只会让家长写出无效配置；表达式等 V1.5 用真正的 `schemaVersion: 2` 加，
 * 且必须配沙箱。校验器遇到未知 `rule.kind` 一律按"不支持"拒绝（AC-P2-2）。
 */

/** 本版支持的包 schema 版本。不是这个数就拒（不猜、不兼容）。 */
export const CUSTOM_PACK_SCHEMA_VERSION = 1

/** 自定义成就 id 必须带此前缀 —— 内置 28 枚一个都不用这个前缀，撞 id 从结构上不可能 */
export const CUSTOM_ID_PREFIX = 'custom::'

/** 全局键：自定义包清单（含回滚快照、启用态）。**不分片**（包是家里的资产，不是某个孩子的） */
export const CUSTOM_PACKS_KEY = 'achievement:customPacks'

/** 审计日志（全局）。每次导入 / 启用 / 停用 / 回滚写一条 */
export const AUDIT_KEY = 'achievement:audit'

/**
 * per-profile 键的基名：家长手工勾选的状态。
 *
 * 与 `UnlockedRecord` **分开存**是有意的：「家长勾了」是**输入**，「解锁」是**输出**。
 * 混在一起会导致停用包后再启用时出现"没勾过却已解锁"—— 因为解锁记录是保留的，
 * 分不清它是勾出来的还是算出来的。
 */
export const CUSTOM_CHECKS_BASE = 'customChecks'

/** 单包最多多少枚（防止一份 JSON 把成就页塞爆） */
export const MAX_ACHIEVEMENTS_PER_PACK = 50
/** 同名 packId 会自动升版覆盖，所以上限按"不同包"算 */
export const MAX_PACKS = 20

/** 文案长度上限（PRD「文案长度上限」的落地值） */
export const LIMITS = {
  packId: 40,
  packName: 20,
  title: 16,
  desc: 60,
  prompt: 30,
} as const

// ---------------------------------------------------------------------------
// 规则（求值见 `customRule.ts`）
// ---------------------------------------------------------------------------

/**
 * `counter` 可用的指标。**枚举白名单**，不允许写任意路径/表达式/脚本。
 *
 * 值语义（与 `achievementProgress.ts` 的统计基元同口径）：
 * - `masteredKp`：状态为「已掌握」的知识点数
 * - `totalAttempts`：所有进度行的 `correctCount + wrongCount` 之和
 * - `studyDays`：有作答记录的天数（`dailyStats` 里 `questionCount > 0`）
 * - `streak`：`max(current, longest)`（历史最长连续天数）
 */
export type CounterMetric = 'masteredKp' | 'totalAttempts' | 'studyDays' | 'streak'

export const COUNTER_METRICS: readonly CounterMetric[] = [
  'masteredKp',
  'totalAttempts',
  'studyDays',
  'streak',
]

/** 指标的展示元信息：量词 + 名词（`Measure` 需要），以及未指定 `tier` 时的推导基准 */
export const METRIC_META: Record<CounterMetric, { unit: string; noun: string }> = {
  masteredKp: { unit: '个', noun: '知识点' },
  totalAttempts: { unit: '次', noun: '作答' },
  studyDays: { unit: '天', noun: '学习' },
  streak: { unit: '天', noun: '连续' },
}

export type CustomRule =
  | { kind: 'manual-check'; prompt: string }
  | { kind: 'counter'; metric: CounterMetric; target: number }

/**
 * 可重复达成的周期（V1.5）。**只有周**，周一起算。
 *
 * ## 为什么是字符串而不是对象
 * 家长写的是 JSON，`"repeat": "weekly"` 比 `"repeat": { "period": "weekly" }` 少一层，
 * 抄错的机会也少一层。等真的有第二种周期（`daily`）再加值，
 * 校验器按白名单判定，多写一个值就是一条 E_REPEAT_PERIOD。
 *
 * ## 为什么 `manual-check` 不允许 repeat
 * 「家长勾一次」没有可累计的量：勾选态是 0/1，重复达成无从度量。
 * 放开它只有一个做法 —— 允许同一张卡每周被再勾一次，那会把 `customChecks`
 * 从"一次性输入"变成"按周的表"，是另一个数据结构，不在这一版做（见 §校验的 E_REPEAT_MANUAL）。
 */
export type CustomRepeatPeriod = 'weekly'

export const CUSTOM_REPEAT_PERIODS: readonly CustomRepeatPeriod[] = ['weekly']

export type CustomCategory = 'M' | 'G' | 'B' | 'E'
export const CUSTOM_CATEGORIES: readonly CustomCategory[] = ['M', 'G', 'B', 'E']

export type CustomSource = 'core' | 'subject' | 'habit' | 'hidden'
export const CUSTOM_SOURCES: readonly CustomSource[] = ['core', 'subject', 'habit', 'hidden']

export type CustomTier = 'common' | 'advanced' | 'rare' | 'hidden'
export const CUSTOM_TIERS: readonly CustomTier[] = ['common', 'advanced', 'rare', 'hidden']

/** 包内的单枚自定义成就（**已通过校验的形态**，字段都合法） */
export interface CustomAchievement {
  /** 带 `custom::` 前缀；与内置 28 枚不可能撞 */
  id: string
  icon: string
  title: string
  desc: string
  category: CustomCategory
  source: CustomSource
  /** 省略时由 `target` 推导（见 `deriveCustomTier`） */
  tier?: CustomTier
  metered: boolean
  /** `metered: true` 必填且 ≥1；`metered: false` **不得出现** */
  target?: number
  /** 量词覆盖（`counter` 用）；省略取 `METRIC_META[metric]` */
  unit?: string
  noun?: string
  /**
   * 可重复达成（V1.5）。只有 `counter` 规则可以带 —— 语义是
   * 「本周期内该指标又推进了**一份 `target` 那么多** → 记一次」，一周最多一次。
   * 见 `customPackDefs` 里翻成 `RepeatRule(mode: 'grow')` 的那一段。
   */
  repeat?: CustomRepeatPeriod
  rule: CustomRule
}

export interface CustomPack {
  schemaVersion: typeof CUSTOM_PACK_SCHEMA_VERSION
  packId: string
  /** 展示名；缺失时 UI 用 packId */
  name?: string
  achievements: CustomAchievement[]
}

// ---------------------------------------------------------------------------
// 落库形态
// ---------------------------------------------------------------------------

/**
 * 一条已导入的包。
 *
 * `previous` 是**回滚唯一依赖**：回滚只把 `pack` 换回上一版、`version` 减一，
 * **绝不动 `customChecks` 与 `UnlockedRecord`**（AC-P2-4「解锁记录一条不少」）。
 */
export interface StoredPack {
  packId: string
  enabled: boolean
  /** 从 1 开始，每次同 packId 重新导入 +1 */
  version: number
  pack: CustomPack
  previous: { pack: CustomPack; version: number } | null
  importedAt: string
  enabledAt?: string
}

export interface CustomPackState {
  packs: StoredPack[]
}

export type AuditAction = 'import' | 'enable' | 'disable' | 'rollback'

export interface AuditEntry {
  at: string
  action: AuditAction
  packId: string
  /** 影响枚数：导入=新增枚数，启用/停用=包内枚数，回滚=版本差枚数 */
  affected: number
  /** 人类可读补充（例如 `v2 → v1`）；不要放用户没见过的内部结构 */
  detail?: string
}

/** `Record<`packId::id`, {at}>`；`at` 为 ISO 时间 */
export type CustomCheckState = Record<string, { at: string }>

/** 勾选键：**包内 id 全局唯一**（id 必须唯一即已由校验保证），带上 packId 便于按包清理 */
export function checkKey(packId: string, achievementId: string): string {
  return `${packId}::${achievementId}`
}

// ---------------------------------------------------------------------------
// 校验 / 预览的返回形态（实现见 `customPack.ts`）
// ---------------------------------------------------------------------------

export interface PackIssue {
  /** 出错位置，如 `achievements[2].rule.kind`；包级问题用 `$` */
  path: string
  /** 机器可读的稳定 code（测试与 UI 分组用，**不要写进面向家长的文案**） */
  code: string
  message: string
}

export type ValidationResult =
  | { ok: true; pack: CustomPack; warnings: PackIssue[] }
  | { ok: false; errors: PackIssue[] }

export interface PackConflict {
  id: string
  title: string
  /** builtin=与内置 28 枚撞；custom=与别的已装包撞；duplicate=同一份包内重复 */
  kind: 'builtin' | 'custom' | 'duplicate'
  /** 撞到的来源（内置 id / 另一个 packId） */
  with: string
}

export interface PackPreview {
  packId: string
  /**
   * **净新增**的卡（按包内顺序）：本版提供、且旧版本（同 packId）**没有**、
   * 也不与内置 / 别的已装包冲突的 id。
   *
   * 为什么是"净"新增而不是"本版提供的全部"：升版时旧版本已有的卡会被原样保留，
   * 把它们算进 `added` 会让 UI 的"将新增 N 枚"变成"重复导入一批"的误读。
   * 需要"本版总共多少枚"就读 `provided`，两个数分开，调用方不可能再理解错。
   */
  added: Array<{
    id: string
    title: string
    category: CustomCategory
    ruleKind: CustomRule['kind']
    /**
     * 这张卡是否可重复达成（V1.5）。`undefined` = 一次性成就。
     *
     * 为什么让 preview 带上它：可重复是**家长看得懂、也在乎**的属性
     * （"这枚每周都能再拿一次"），而导入前那张清单是唯一能看到它的地方 ——
     * 导入完成后再发现，孩子的图鉴上已经多了枚会重复计数的卡。
     */
    repeat?: CustomRepeatPeriod
  }>
  /** 旧版本已有、本版仍保留的枚数（按 id 计；新包恒 0） */
  retained: number
  /** 本版总共提供多少枚（= `added.length + retained`，不含冲突项） */
  provided: number
  conflicts: PackConflict[]
  /** 同 packId 已存在 → 这次导入会升版替换（回滚可退回它） */
  replaces: { packId: string; fromVersion: number } | null
}
