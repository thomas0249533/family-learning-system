/**
 * 自定义成就包 → `AchievementDef`（V1.4 · B3 / PRD `P0-1`）
 *
 * ## 为什么是"翻译"而不是"第二套成就模型"
 * 图鉴、结算、toast、详情弹层全都在 `AchievementDef` 这一条约上跑。如果自定义卡
 * 另起一套模型，就会出现"内置卡能弹 toast、自定义卡不能"这类只有走到那条路径才发现的分叉。
 * 所以这里只做一件事：把 `CustomAchievement` 拍成 `AchievementDef`，让它**在结构上
 * 与内置 28 枚无法区分** —— 之后所有既有流程（`syncAchievements` / `buildAchievementItems`
 * / `buildAchievementViewFromItems`）都不需要知道"这枚是自定义的"。
 *
 * ## 两条判定为什么必须这样写
 * 1. **`manual-check` 的 `check` 不依赖 `ctx`**。家长勾了就是勾了 —— 这是"人的判断"，
 *    不是"数据算出来的结论"。写成依赖 ctx 就等于说"你没有数据支撑你的判断"，
 *    而解锁集合由 `syncAchievements` 从 `check` 汇总，于是这张卡永远解不开。
 * 2. **`counter` 的 `check` 必须与 `measure` 同源**（都走 `evaluateRule` / `ruleMeasure`）。
 *    自己再写一遍 `>=` 比较，就会出现"进度条满了但徽章没亮"—— 这正是
 *    `achievementProgress` 花整整一节去避免的观感灾难，不能从自定义包这里重新引入。
 *
 * ## `tier` 的回落
 * 包里的 `tier` 可以省略（`customPackTypes.CustomAchievement.tier?`）。省略时用
 * `achievementTaxonomy.deriveTier()` 从 `target` / `hidden` 推导 —— 复用内置 28 枚同一套
 * 规则，**不另写一份阈值**。包里写了就以包里为准（家长/包作者可以手动调层级）。
 */
import type { AchievementDef } from './achievements'
import { deriveCustomTier } from './customPack'
import { evaluateRule, ruleMeasure } from './customRule'
import {
  checkKey,
  type CustomAchievement,
  type CustomCheckState,
  type CustomPack,
  type CustomPackState,
} from './customPackTypes'

/**
 * 单枚自定义成就 → `AchievementDef`
 *
 * 两处 `ruleMeasure` 的用法不同，写清楚免得后来者以为可以统一：
 *   - `counter`：直接把规则交给 `ruleMeasure`（它负责 floor + clamp + 量词回落，
 *     与内置 `achievementProgress` 同口径）；
 *   - `manual-check`：`ruleMeasure` 给出的是**未勾选态**（0/1），勾选态由本层注入
 *     `current = 1`。这样量词/kind 的语义仍然只有一份真相，本层只补一个数字。
 */
function toDef(packId: string, a: CustomAchievement, checks: CustomCheckState): AchievementDef {
  const checked = checks[checkKey(packId, a.id)] !== undefined
  const hidden = a.source === 'hidden'
  const rule = a.rule

  // 层级：包里声明的优先；没声明就用校验器同一个推导函数（`deriveCustomTier`），
  // **绝不另写一份阈值表** —— 两份阈值必然在某次调整后分叉，症状是"导入时显示的层级"
  // 与"图鉴里显示的层级"不一致。
  const tier = a.tier ?? deriveCustomTier(a)

  const base = {
    id: a.id,
    icon: a.icon,
    title: a.title,
    desc: a.desc,
    // CustomCategory 与 AchievementCategory 是同一组字面量（'M'|'G'|'B'|'E'）
    category: a.category,
    source: a.source,
    tier,
    ...(hidden ? { hidden: true } : {}),
  }

  if (rule.kind === 'manual-check') {
    const baseMeasure = ruleMeasure(rule, { unit: a.unit, noun: a.noun })
    return {
      ...base,
      // 不依赖 ctx：家长勾了就是勾了（见文件头第 1 条）。
      // 用构建时捕获的 `checked` 而不是闭包里重读 `checks`：这样
      // `check()` 与 `measure()` 必然同源（一个说"已勾"另一个不可能说"0/1"）。
      check: () => checked,
      measure: (ctx) => {
        const m = baseMeasure(ctx)
        return checked ? { ...m, current: 1 } : m
      },
    }
  }

  // counter：check 与 measure 同源（见文件头第 2 条）
  const target = rule.target
  return {
    ...base,
    check: (ctx) => evaluateRule(rule, ctx) >= target,
    // 量词覆盖透传：包里写了 unit/noun 就用它，没写由 ruleMeasure 回落到 METRIC_META
    measure: ruleMeasure(rule, { unit: a.unit, noun: a.noun }),
  }
}

/**
 * 一个包 → 该包全部成就定义（顺序 = 包内顺序，便于家长对照 JSON 排查）。
 *
 * `checks` 用**包自己的 packId** 去拼 `checkKey`：勾选键是 `packId::achievementId`，
 * 用外层的 `packId` 与用 `pack.packId` 结果相同（存储层保证两者一致），
 * 这里统一走 `pack.packId` 少一个参数。
 */
export function packToDefs(pack: CustomPack, checks: CustomCheckState): AchievementDef[] {
  return pack.achievements.map((a) => toDef(pack.packId, a, checks))
}

/**
 * 全部**已启用**包的成就定义（安装顺序）。
 *
 * 只取 `enabled` 的包：停用的包不该出现在图鉴里，也不该参与结算 ——
 * 否则"停用"就只是把卡藏起来，孩子照样会因为一张看不见的卡弹 toast。
 */
export function enabledPackDefs(state: CustomPackState, checks: CustomCheckState): AchievementDef[] {
  const defs: AchievementDef[] = []
  for (const stored of state.packs) {
    if (!stored.enabled) continue
    defs.push(...packToDefs(stored.pack, checks))
  }
  return defs
}
