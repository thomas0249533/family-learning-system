/**
 * 成就解锁提示的**合并规则**（V1.3 · AC-07）
 *
 * 一次结算同时解锁 4 枚以上时，逐条播会变成"中奖广告"：孩子刚做完一道题，
 * 屏幕上连弹 5 条祝贺，注意力全被抢走。规则是 —— **≥4 枚合并成一条**，
 * 图标取其中**层级最高**的那一枚。
 *
 * "合并"只影响**播放形式**，不影响数据：全部记录照常进「已获得」区，
 * 所以孩子回头再看一枚不少。
 *
 * 抽成纯函数的原因：这条规则既不能挂组件测，也不该埋在 `.vue` 的 `enqueue` 里 ——
 * 边界（3 枚不合并 / 4 枚合并 / 层级相同取谁 / 空数组）都能在 node 里穷举。
 */
import { ACHIEVEMENTS, type AchievementDef } from './achievements'
import { tierOf } from './achievementTaxonomy'

/** 达到这个枚数就合并（PRD §6.3：超过 3 枚） */
export const MERGE_THRESHOLD = 4

/** 层级权重：合并提示取"最高层级那枚"的图标。隐藏成就最"稀有"，排最高 */
const TIER_RANK: Record<string, number> = { common: 1, advanced: 2, rare: 3, hidden: 4 }

/** 合并出来的伪成就 id（不会进任何持久化记录） */
export const MERGED_ID = '__merged__'

/**
 * 一次解锁事件 → 实际要播放的提示列表。
 *
 * - < 4 枚：原样返回（逐条播放）；
 * - ≥ 4 枚：返回**一条**合并提示，`title` 带枚数，`desc` 列出前 3 个标题。
 *
 * 返回的元素仍是 `AchievementDef`，这样 toast 组件不需要分情况处理。
 */
export function mergeUnlocksForToast(defs: AchievementDef[] | null | undefined): AchievementDef[] {
  const list = (defs ?? []).filter(Boolean)
  if (list.length === 0) return []
  if (list.length < MERGE_THRESHOLD) return [...list]

  const top = [...list].sort(
    (a, b) => (TIER_RANK[tierOf(b.id)] ?? 0) - (TIER_RANK[tierOf(a.id)] ?? 0),
  )[0]
  const names = list
    .slice(0, 3)
    .map((d) => d.title)
    .filter(Boolean)
    .join('、')

  return [
    {
      id: MERGED_ID,
      icon: top?.icon ?? '🏅',
      title: `解锁 ${list.length} 枚新成就`,
      desc: list.length > 3 ? `${names} 等` : names,
      category: top?.category ?? 'M',
      // 合成项只用于展示，永远不会被 check()
      check: () => true,
    },
  ]
}

/**
 * 合并提示里"代表图标"对应的成就（供 e2e / 家长端回溯"这批里最亮的是哪枚"）。
 * 找不到合成项时返回 `null`。
 */
export function mergedRepresentative(defs: AchievementDef[]): AchievementDef | null {
  const list = (defs ?? []).filter(Boolean)
  if (list.length === 0) return null
  return [...list].sort(
    (a, b) => (TIER_RANK[tierOf(b.id)] ?? 0) - (TIER_RANK[tierOf(a.id)] ?? 0),
  )[0]
}

/** 某枚成就的层级权重（导出给测试与家长端排序用） */
export function tierRankOf(id: string): number {
  return TIER_RANK[tierOf(id)] ?? 0
}

/** 全部 28 枚的层级权重表（测试用：保证权重映射没有漏项） */
export function tierRankTable(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of ACHIEVEMENTS) out[a.id] = tierRankOf(a.id)
  return out
}
