/**
 * settings 键的**作用域**（V1.4 · B1）
 *
 * ## 为什么需要这张表
 * v4 要给数据加 `profileId`。表加一列是显式的（`tsc` 会逼你改所有构造对象的地方），
 * 但 settings 是 key-value：**漏改一个键不会报错，只会让某个孩子的数据"看起来归零"**。
 * 这是本版最危险的失败模式，所以键清单必须是一个**可被测试穷举的数据结构**，
 * 而不是散落在 8 个文件里的字符串字面量。
 *
 * ## 谁是 per-profile，谁是 global
 * 判断标准只有一条：**"这个值换了孩子还成立吗？"**
 *   - 徽章、打卡天数、每日题量、折叠状态 → 换孩子就不成立 → per-profile
 *   - 主题、自定义成就包、审计日志、迁移标记 → 与孩子无关 → global
 *
 * 唯一有争议的是 `achievement:discoveryEnabled`（家长开关）：它既可以理解为
 * "对这个孩子的设置"，也可以理解为"家里总开关"。本文按 **per-profile** 处理，
 * 理由是这个开关的实际语义是"允许这个孩子通过发现机制获取线索"，
 * 老二上初中、老大上小学时家长完全可能只要一个开。若产品改成总开关，
 * 只需把它从 `PROFILE_SCOPED_KEYS` 挪到 `GLOBAL_KEYS`，其余代码不用动。
 *
 * ## 未知键的默认行为（对应 `system_design-v1.4.md` A5）
 * `classifyKey()` 对**不在任何清单里**的键返回 `unknown`，迁移时**按 per-profile 搬**。
 * 理由：迁移的失败模式是"漏搬"（数据消失且无报错），不是"多搬"（串档案）。
 * 前者用户完全察觉不到，后者至少还能在新档案里找到。
 */

/** per-profile 的键（v4 之后实际存为 `<base>:<profileId>`） */
export const PROFILE_SCOPED_KEYS = [
  'achievements',
  'achievementUi',
  'achievement:collectionSeen',
  'achievement:discovery',
  'achievement:discoveryEnabled',
  'dailyStats',
  'studyStreak',
  'attemptedTypes',
  /**
   * 家长手工勾选的自定义成就（V1.4 · B3）。
   *
   * **per-profile，不是 global**：勾选是"这个孩子的输入"（"他这周确实自己整理了书桌"），
   * 老二没做过就是没做过。包本身（`achievement:customPacks`）反而是 global ——
   * 包是家里的资产，同一份包被两个孩子共用。
   *
   * 与 `achievements` **分开存**是刻意的：勾选是输入、解锁是输出（见 `customPackTypes.ts`）。
   * 混在一起会导致停用包后重新启用时出现"没勾过却已解锁"。
   *
   * 注意：登记在这里意味着它进了 v4 迁移的搬键清单与跨设备合并的键清单。
   * 停用包**不清空**它（PRD §8.2 裁决），所以不需要任何"清理"逻辑。
   */
  'customChecks',
] as const

/** global 的键：不分片，原样保留 */
export const GLOBAL_KEYS = [
  'profiles',
  'achievement:customPacks',
  'achievement:audit',
  'migration:v3',
  'migration:v4',
  'progress:lastRecovery',
  'progress:lastStartupRecovery',
  'fls:theme',
  'owner:indexCache',
  /**
   * V1.11 · F1 · AI 助手配置（模型名 + 加密后的 API Key）。
   *
   * **设备级，不是 per-profile**：API Key 是家长花钱买的、全家共用的一份资产，
   * 按档案分片会变成"每个孩子各填一次 Key"，且切到老二时会被误判成"没配置 AI"。
   * 判断标准见本文件顶部："这个值换了孩子还成立吗？" —— 成立，所以是 global。
   *
   * ⚠️ 这里**只落密文 + salt + iv**（WebCrypto AES-GCM + PBKDF2，见
   * `src/core/ai/secretCipher.ts`），**不落明文 Key**：本仓 Tauri 侧没有
   * keychain 插件，真 Keychain 需新增 Rust 插件 + 重新打包，已单开任务，不在 F1。
   */
  'ai:config',
] as const

export type ProfileScopedBase = (typeof PROFILE_SCOPED_KEYS)[number]
export type GlobalKey = (typeof GLOBAL_KEYS)[number]

export type KeyScope =
  | { kind: 'profile'; base: ProfileScopedBase; profileId: string }
  /** v3 及更早的写法：没有 profileId 后缀，需要迁移 */
  | { kind: 'profile-legacy'; base: ProfileScopedBase }
  | { kind: 'global'; key: GlobalKey }
  /** 任何清单都没登记：迁移时按 per-profile 搬，同时告警 */
  | { kind: 'unknown' }

const PROFILE_SET: ReadonlySet<string> = new Set(PROFILE_SCOPED_KEYS)
const GLOBAL_SET: ReadonlySet<string> = new Set(GLOBAL_KEYS)

/** 拼出真正落库的键：`dailyStats` + `p1` → `dailyStats:p1` */
export function scopedKey(base: ProfileScopedBase, profileId: string): string {
  return `${base}:${profileId}`
}

/**
 * 判断一个 settings 键属于哪个作用域。
 *
 * 注意**判定顺序**：先查 global 精确匹配，再查 per-profile 精确匹配（= legacy 形态），
 * 最后才尝试按 `base:profileId` 拆。反过来会让 `achievement:discovery` 被误判成
 * "base=achievement, pid=discovery"。
 */
export function classifyKey(key: string): KeyScope {
  if (GLOBAL_SET.has(key)) return { kind: 'global', key: key as GlobalKey }
  if (PROFILE_SET.has(key)) return { kind: 'profile-legacy', base: key as ProfileScopedBase }

  for (const base of PROFILE_SCOPED_KEYS) {
    if (key.startsWith(`${base}:`)) {
      const profileId = key.slice(base.length + 1)
      // 空后缀（`dailyStats:`）属于脏数据，按未知处理，让迁移告警
      if (profileId) return { kind: 'profile', base, profileId }
    }
  }

  return { kind: 'unknown' }
}

/** 便捷判断：这个键换档案后应该不一样吗？（未知键按 true 处理，与迁移口径一致） */
export function isProfileScoped(key: string): boolean {
  const sc = classifyKey(key)
  return sc.kind === 'profile' || sc.kind === 'profile-legacy' || sc.kind === 'unknown'
}
