/**
 * 隐藏成就的「发现」机制（V1.3 · P1，**2026-10 用户裁决：推翻"P0 不引入随机"**）。
 *
 * ## 为什么改
 * 原裁决是"本轮没有随机，先验证确定性收集结构"。结构验证完（28 枚图鉴 + 证据 + 层级），
 * 用户判断 3 枚隐藏成就常驻剪影"等于把谜面直接摊开"，决定上发现机制。
 *
 * ## 它到底是什么（先划清，别做成盲盒）
 * - 抽到的是**线索**，不是成就本身：抽中只揭示"这枚藏在什么地方"的一句模糊提示，
 *   解锁仍然只认 `check(ctx)`，**永远不会因为抽签而直接解锁**；
 * - **池内等概率**，不做权重、不做稀有度、不做限定池；
 * - **保底 N=5**：连续 5 次抽到重复线索，第 5 次强制给一条没见过的 —— 保底是为了
 *   "别让孩子白抽五次"，不是为了制造惊喜；
 * - **一天最多送一次机会**（本地日期口径），不做可购买、可兑换、可囤积的正反馈；
 * - **家长可关**（`achievement:discoveryEnabled`），关掉后机制整体消失，图鉴回到纯剪影。
 *
 * 不向儿童展示任何概率数字（六条不变量的第 3 条与伦理红线"不展示概率"仍然有效）。
 */

import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'

export const DISCOVERY_KEY = 'achievement:discovery'
export const DISCOVERY_ENABLED_KEY = 'achievement:discoveryEnabled'

/** 当前档案的发现状态键（"今天抽过没"是**每个孩子各自的**） */
export function discoveryKey(profileId: string = currentProfileId()): string {
  return scopedKey(DISCOVERY_KEY, profileId)
}

/**
 * 家长开关的键。按 per-profile 处理：语义是"允许这个孩子通过发现机制拿线索"，
 * 两个孩子年龄不同时家长完全可能只要一个开。
 * 若产品改成"家里总开关"，把它挪到 `GLOBAL_KEYS` 即可，这里不用动。
 */
export function discoveryEnabledKey(profileId: string = currentProfileId()): string {
  return scopedKey(DISCOVERY_ENABLED_KEY, profileId)
}

/** 隐藏成就池（顺序固定，抽签只在这 3 枚里） */
export const HIDDEN_POOL = ['comeback', 'early-bird', 'night-owl'] as const

/**
 * 线索文案：**故意模糊**。
 * 判据：拿这句话去反推，能得到方向但推不出精确条件（精确条件就是成就本身的解锁规则，
 * 说出来等于把谜底写在谜面上）。
 */
export const CLUE_TEXT: Record<string, string> = {
  comeback: '它藏在一个你反复错过、后来又拿下的知识点里。',
  'early-bird': '它只属于某个清晨。',
  'night-owl': '它只属于某个很晚的夜晚。',
}

/** 保底次数：连续抽到 N 次重复后，第 N 次必给新线索 */
export const GUARANTEE_N = 5

export interface DiscoveryState {
  v: 1
  /** 剩余发现机会 */
  chances: number
  /** 已经揭示过的线索 id */
  revealed: string[]
  /** 连续抽到"重复线索"的次数（抽到新的就清零） */
  streakWithoutNew: number
  /** 最后一次发放机会的本地日期 YYYY-MM-DD */
  lastGrantDay: string
}

export function emptyDiscoveryState(): DiscoveryState {
  return { v: 1, chances: 0, revealed: [], streakWithoutNew: 0, lastGrantDay: '' }
}

/** 脏数据降级：结构不对就当没玩过（不抛错，也不猜） */
export function normalizeDiscoveryState(raw: unknown): DiscoveryState {
  const v = raw as Partial<DiscoveryState> | null | undefined
  if (!v || typeof v !== 'object' || v.v !== 1) return emptyDiscoveryState()
  const revealed = Array.isArray(v.revealed)
    ? [...new Set(v.revealed.filter((x): x is string => typeof x === 'string' && x !== ''))]
    : []
  return {
    v: 1,
    chances: Number.isFinite(v.chances) ? Math.max(0, Math.floor(v.chances as number)) : 0,
    revealed,
    streakWithoutNew:
      Number.isFinite(v.streakWithoutNew) ? Math.max(0, Math.floor(v.streakWithoutNew as number)) : 0,
    lastGrantDay: typeof v.lastGrantDay === 'string' ? v.lastGrantDay : '',
  }
}

/**
 * 每天发放一次机会（**同一本地日期最多一次**，日期由调用方按本地口径算好传入）。
 *
 * 故意不做"补发"：昨天没用掉的机会不累积 —— 攒着反而会变成"催你来点"的压力。
 */
export function grantDailyChance(
  state: DiscoveryState,
  today: string,
): { state: DiscoveryState; granted: boolean } {
  if (!today || state.lastGrantDay === today) return { state, granted: false }
  return {
    state: { ...state, chances: state.chances + 1, lastGrantDay: today },
    granted: true,
  }
}

/** 还剩几枚没被发现 */
export function remainingUnrevealed(state: DiscoveryState, pool: readonly string[] = HIDDEN_POOL): string[] {
  return pool.filter((id) => !state.revealed.includes(id))
}

/** 现在能不能抽：有机会，且池里还有没见过的 */
export function canDraw(state: DiscoveryState, pool: readonly string[] = HIDDEN_POOL): boolean {
  return state.chances > 0 && remainingUnrevealed(state, pool).length > 0
}

export interface DrawResult {
  state: DiscoveryState
  /** 抽到的线索 id；不能抽时为 null */
  clueId: string | null
  /** 是不是"新的"（第一次被揭示） */
  wasNew: boolean
}

/**
 * 抽一次（纯函数，`rand` 可注入以保证测试确定性）。
 *
 * 规则顺序（**先判保底再抽**，否则保底永远不会在"第 N 次"生效）：
 *   1. 不能抽 → 原样返回；
 *   2. `streakWithoutNew + 1 >= GUARANTEE_N` → 强制从"没见过的"里抽；
 *   3. 否则从**整个池**里等概率抽（允许重复，重复才有"保底"的意义）。
 *
 * 抽到重复时 `streakWithoutNew` +1，抽到新的清零 —— 这是保底计数器的唯一真相。
 */
export function drawDiscovery(
  state: DiscoveryState,
  pool: readonly string[] = HIDDEN_POOL,
  rand: () => number = Math.random,
): DrawResult {
  if (!canDraw(state, pool)) return { state, clueId: null, wasNew: false }

  const unseen = remainingUnrevealed(state, pool)
  const guaranteed = state.streakWithoutNew + 1 >= GUARANTEE_N
  const candidates = guaranteed ? unseen : pool

  // rand() 可能返回 1（理论上不会，但注入的假随机可能）→ 取模前夹一下
  const idx = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))
  const clueId = candidates[Math.max(0, idx)]
  const wasNew = !state.revealed.includes(clueId)

  return {
    clueId,
    wasNew,
    state: {
      ...state,
      chances: state.chances - 1,
      revealed: wasNew ? [...state.revealed, clueId] : state.revealed,
      streakWithoutNew: wasNew ? 0 : state.streakWithoutNew + 1,
    },
  }
}

// ==================== 持久化 ====================
//
// 与折叠状态、总结卡标记同一处（`db.settings`）：这些是**应用偏好/进度**，
// 要随导出与恢复一起走，不能存在 localStorage 里。

/** 读发现状态（失败 → 当没玩过；脏数据 → 降级，不抛错） */
export async function loadDiscoveryState(): Promise<DiscoveryState> {
  try {
    const rec = await db.settings.get(discoveryKey())
    return normalizeDiscoveryState(rec?.value)
  } catch {
    return emptyDiscoveryState()
  }
}

/** 写发现状态（失败静默：本次会话内已揭示的线索照常显示） */
export async function saveDiscoveryState(state: DiscoveryState): Promise<void> {
  try {
    await db.settings.put({ key: discoveryKey(), value: state })
  } catch {
    /* 存不了就算了，不影响使用 */
  }
}

/**
 * 家长开关。**默认开**：机制本身不带来任何外部激励（不给分、不给钱、不排名），
 * 关掉后只是回到"纯剪影"，所以默认开是安全的；家长想彻底关掉随时可关。
 */
export async function loadDiscoveryEnabled(): Promise<boolean> {
  try {
    const rec = await db.settings.get(discoveryEnabledKey())
    return rec?.value !== false
  } catch {
    return true
  }
}

export async function saveDiscoveryEnabled(enabled: boolean): Promise<void> {
  try {
    await db.settings.put({ key: discoveryEnabledKey(), value: enabled })
  } catch {
    /* 存不了就算了 */
  }
}
