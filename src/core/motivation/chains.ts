// =====================================================================
// 体验激励 · 连环成就元数据（Chain）
// ---------------------------------------------------------------------
// 连环成就：解锁前一环后，成就墙在「最高已解锁环」旁提示「下一环：<icon><name>」，
// 使孩子对下一步目标有明确预期（成长梯度）。
// =====================================================================

export interface ChainDef {
  id: string
  /** 连环名称 */
  name: string
  /** 按顺序排列的成就 id（从头到尾） */
  ids: string[]
}

export const CHAINS: ChainDef[] = [
  {
    id: 'streak',
    name: '坚持之链',
    ids: ['streak-3', 'streak-7', 'streak-30', 'streak-60', 'streak-100'],
  },
  {
    id: 'mistake',
    name: '错题之链',
    ids: ['mistake-first', 'mistake-cleaner', 'mistake-cleaner-50'],
  },
  {
    id: 'mastery',
    name: '精熟之链',
    ids: ['first-step', 'ten-kp', 'fifty-kp', 'hundred-kp', 'kp-300'],
  },
  {
    id: 'explore',
    name: '探索之链',
    ids: ['explorer-3', 'explorer-10'],
  },
]

/** 归属某连环的下一环（用于成就墙提示）。 */
export function chainNextOf(chain: ChainDef, unlockedIds: string[]): string | null {
  let lastUnlocked = -1
  chain.ids.forEach((id, i) => {
    if (unlockedIds.includes(id)) lastUnlocked = i
  })
  if (lastUnlocked >= 0 && lastUnlocked < chain.ids.length - 1) {
    return chain.ids[lastUnlocked + 1]
  }
  return null
}
