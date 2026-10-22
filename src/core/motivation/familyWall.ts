/**
 * 家庭成就墙的**展示派生**（V1.6 · Stage C · C7「去比较化」）
 *
 * ## 这一页为什么要把数字收起来（产品红线，写进代码而不只写在 PRD 里）
 * 家庭墙是 4 个孩子的档案横向并排。并排的**标量数字**是最强的比较诱饵：
 * 家长一眼就会比出"老大 12 枚、老二才 5 枚"——这一页从此变成记分牌。
 * 所以默认视野里只有两样东西：
 *   1. 该孩子**最近解锁的几枚徽章**（叙事："最近在做什么"）；
 *   2. 一句**中性鼓励语**（同样只是叙事）。
 * 已解锁数 / 连续天数 / 掌握数这些标量默认折叠，家长主动点开才出现，
 * 且只在本列内展开 —— 不排成跨孩子的一行让大家比。
 *
 * 延续 B4 的三条旧红线（不许回退）：**不排序、不显示名次、不合计算分**。
 *
 * ## 为什么这些函数放在 core 而不是组件里
 * 与 `achievementMeta.ts` 同源的分工：组件只负责渲染，"最近几枚""这句文案"
 * 这类判断必须是被单测覆盖的纯函数 —— 否则下次改文案的人会顺手加一个
 * `Math.random()` 或者一句带数字的"又解锁 2 枚"，而没有任何测试会红。
 */
import { buildAchievementViewFromItems, type AchievementItem } from './achievementMeta'

/**
 * 最近解锁的徽章（默认 3 枚）。
 *
 * **不另写排序**：直接复用图鉴视图的 `recent`（日期倒序、空日期垫底、
 * 最多 3 条，见 `achievement-meta.test.ts` 的覆盖）。墙与图鉴对"最近"
 * 的定义必须永远一致 —— 各排一遍的下场是"墙上第 1 枚和图鉴第 1 枚不同"，
 * 而这种不一致没有任何报错，只会被当成"墙坏了"。
 *
 * @param limit 最多几枚。图鉴口径上限本就是 3，传更大也不会变出更多。
 */
export function recentUnlocked(items: AchievementItem[], limit = 3): AchievementItem[] {
  if (!Array.isArray(items) || limit <= 0) return []
  return buildAchievementViewFromItems(items).recent.slice(0, limit)
}

/**
 * 每类成就对应的中性叙事（按"最近解锁那一枚"的类别选一句）。
 *
 * 三条硬约束（对应验收点）：
 *   1. **句中无数字** —— 有数字就有可比性（"又解锁 2 枚"不行）；
 *   2. **确定性** —— 同一份数据每次渲染同一句。不用 `Math.random()`：
 *      每次重绘文案都变，既抖动又没法测试；
 *   3. **叙事性** —— 说"最近在怎样"，不说"拿到几个"。
 */
const CATEGORY_LINE: Record<AchievementItem['category'], string> = {
  M: '最近在精熟类上刚有突破',
  G: '最近在成长类上很稳',
  B: '最近在习惯类上很稳',
  E: '最近在探索类上有了新发现',
}

/** 一枚都没有时的中性文案：不批评、不比较、不画饼 */
const EMPTY_LINE = '旅程刚起步，从任何一道题开始都好'

/**
 * 由该孩子的成就视图模型推导一句中性鼓励语。
 *
 * 取"最近解锁那一枚"的类别作为叙事主题 —— 这句话因此永远描述**默认视野里
 * 排在最前面那枚徽章**，不会出现"文案说精熟、徽章却是习惯类"的错位。
 *
 * @param items 该孩子的成就视图模型（`buildAchievementItems` 的产出）
 * @returns 一句中文叙事；**任何输入都不会抛、不会是空串**
 */
export function encouragementLine(items: AchievementItem[]): string {
  const latest = recentUnlocked(items, 1)[0]
  // 自定义成就包的类别理论上被 JSON 校验锁死在这四种，但视图模型是渲染数据，
  // 脏数据不该把整列墙搞崩 → 兜底回空态文案而不是抛。
  if (!latest) return `${EMPTY_LINE}。`
  return `${CATEGORY_LINE[latest.category] ?? EMPTY_LINE}。`
}
