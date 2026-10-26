// =====================================================================
// 体验激励 · 盲盒抽奖引擎（V2.8 · C2，纯函数 + 薄存储层）
// ---------------------------------------------------------------------
// 与成就体系的关系（一条边界划清楚）：
//   · 盲盒成就**不在** `ACHIEVEMENTS` 里 —— 不进图鉴、不进待解锁、不进分母、
//     不弹解锁 toast（「不参与普通图鉴展示」）。唯一的获得途径是抽盲盒。
//   · 抽中后写进 `achievements:<profileId>` 的解锁记录（老记录"不可撤销"原则照用），
//     `syncAchievements` 按 id 合并时遇到未知 id 只会原样保留，绝不误删。
//   · 因此盲盒 id **必须**从「单日解锁 ≥3」的计数里排除 —— 否则抽 1 枚盲盒 +
//     2 枚普通成就就又能触发一次，激励回路自我反馈。
//
// 时间口径：全部走 `localDayKey`（本地日期），**禁用** `toISOString()`（项目铁律）。
// =====================================================================
import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'
import {
  ACHIEVEMENTS,
  isCollectible,
  loadUnlocked,
  saveUnlocked,
  type AchievementDef,
  type UnlockedRecord,
} from './achievements'
import type { DailyStat } from './dailyStats'
import { effectiveCurrent, localDayKey } from './streak'

// ==================== 盲盒专属成就池（5 枚） ====================

/**
 * 盲盒专属成就（不参与普通图鉴）。
 *
 * 主题统一走「惊喜 / 奇遇」意象，与普通成就的「行为与坚持」区分开 ——
 * 它们奖励的是**开出惊喜这件事本身**，语义上就属于盲盒，不该被日常努力解锁。
 */
export const BLIND_BOX_POOL: AchievementDef[] = [
  {
    id: 'bb-lucky-star',
    icon: '⭐',
    title: '幸运星',
    desc: '从盲盒中开出的惊喜',
    category: 'E',
    check: () => false, // 只能靠盲盒获得，永不参与日常结算
  },
  {
    id: 'bb-moon',
    icon: '🌛',
    title: '月夜奇遇',
    desc: '从盲盒中开出的惊喜',
    category: 'E',
    check: () => false,
  },
  {
    id: 'bb-rainbow',
    icon: '🌈',
    title: '彩虹瓶',
    desc: '从盲盒中开出的惊喜',
    category: 'E',
    check: () => false,
  },
  {
    id: 'bb-comet',
    icon: '🌠',
    title: '流星信使',
    desc: '从盲盒中开出的惊喜',
    category: 'E',
    check: () => false,
  },
  {
    id: 'bb-crown',
    icon: '👑',
    title: '隐藏王冠',
    desc: '盲盒集齐的最终惊喜',
    category: 'E',
    check: () => false,
  },
]

/** 盲盒成就 id 集合（O(1) 判定；模块级算一次） */
const BLIND_BOX_IDS: ReadonlySet<string> = new Set(BLIND_BOX_POOL.map((a) => a.id))

/** 盲盒池总数（UI 文案口径唯一来源） */
export const BLIND_BOX_TOTAL = BLIND_BOX_POOL.length

/** 按 id 找盲盒成就定义（找不到 = 脏数据，返回 undefined 由调用方兜底） */
export function blindBoxDefById(id: string): AchievementDef | undefined {
  return BLIND_BOX_POOL.find((a) => a.id === id)
}

// ==================== 状态（持久化在 settings 的独立键） ====================

export interface BlindBoxState {
  /** 已抽中的盲盒成就 id（按抽中顺序） */
  owned: string[]
  /**
   * 已完成抽取的本地日期（YYYY-MM-DD）。
   *
   * 防刷锚点记在**抽取时**而不是触发时：盒子出现后孩子可以先不点，
   * 第二天点开照样能抽 —— 「一天只能触发一次」约束的是抽取动作，
   * 不是"今天没点就作废"（那是惩罚注意力，不是奖励学习）。
   */
  usedDays: string[]
}

/** 空状态（从未触发过） */
export function emptyBlindBoxState(): BlindBoxState {
  return { owned: [], usedDays: [] }
}

/** 日期键归一化：只认 YYYY-MM-DD，脏值丢弃 */
function normalizeDayKey(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined
}

/**
 * 归一化：非数组 → 空；owned 只收池内 id（去重、保序）；usedDays 只收合法日期键。
 * 脏数据一律当"没有"，绝不让一份坏 JSON 把抽取逻辑带偏。
 */
export function normalizeBlindBoxState(raw: unknown): BlindBoxState {
  if (!raw || typeof raw !== 'object') return emptyBlindBoxState()
  const o = raw as Partial<BlindBoxState>
  const owned: string[] = []
  if (Array.isArray(o.owned)) {
    for (const id of o.owned) {
      if (typeof id === 'string' && BLIND_BOX_IDS.has(id) && !owned.includes(id)) owned.push(id)
    }
  }
  const usedDays: string[] = []
  if (Array.isArray(o.usedDays)) {
    for (const d of o.usedDays) {
      const k = normalizeDayKey(d)
      if (k && !usedDays.includes(k)) usedDays.push(k)
    }
  }
  return { owned, usedDays }
}

export const BLIND_BOX_KEY = 'blindBox'

/** 当前档案的盲盒状态键 */
export function blindBoxKey(profileId: string = currentProfileId()): string {
  return scopedKey(BLIND_BOX_KEY, profileId)
}

/** 读取盲盒状态（读失败 / 脏数据 → 空状态，绝不抛错） */
export async function loadBlindBoxState(
  profileId: string = currentProfileId(),
): Promise<BlindBoxState> {
  try {
    const rec = await db.settings.get(blindBoxKey(profileId))
    return normalizeBlindBoxState(rec?.value)
  } catch {
    return emptyBlindBoxState()
  }
}

/** 写入盲盒状态（调用方传入已归一化的状态） */
export async function saveBlindBoxState(state: BlindBoxState): Promise<void> {
  await db.settings.put({ key: blindBoxKey(), value: state })
}

// ==================== 触发判定（纯函数） ====================

export type BlindBoxTriggerReason = 'unlocks-today' | 'streak' | 'focus'

export interface BlindBoxTriggerInput {
  /** 全部已解锁记录（含解锁日期）——来自 `loadUnlocked()` */
  unlockedRecords: UnlockedRecord[]
  /** 连续打卡状态 ——来自成就结算的同一份 streak */
  streak: { current: number; longest: number; lastDate: string }
  /** 每日统计（含 V2.8 的 focusMinutes 埋点） */
  dailyStats: DailyStat[]
  /** 结算时刻（注入，绝不内部 new Date()） */
  now: Date
  /** 当前盲盒状态 */
  state: BlindBoxState
}

/** 触发阈值（集中放这里，别让 UI 和测试各抄一份） */
export const BLIND_BOX_THRESHOLDS = {
  /** 单日解锁普通成就 ≥3 枚 */
  UNLOCKS_TODAY: 3,
  /** 连续学习 ≥7 天（`effectiveCurrent` 口径，含昨日宽限） */
  STREAK_DAYS: 7,
  /** 单日累计专注 ≥60 分钟 */
  FOCUS_MINUTES: 60,
} as const

/**
 * 当前是否应该出现盲盒。**可用性**与「抽哪个」是两件事，这里只回答前者。
 *
 * 判定顺序（返回第一个命中的 reason，UI 文案按此排序）：
 *   1. 系统失效闸：5 枚集齐 → 永不触发（自动隐藏）；
 *   2. 每日防刷：今天已经抽过 → 不触发；
 *   3. 三条激励条件：单日解锁 ≥3 / 连续 ≥7 天 / 单日专注 ≥60 分钟。
 *
 * 「连续 ≥7 天」用 `effectiveCurrent`（项目的**当前**口径，昨日打卡今天有宽限）：
 * 任务语义是"坚持到了 7 天就该有惊喜"，孩子第 8 天早上打开 App 也要能看到盒子，
 * 裸读 `streak.current`（还没被今天的学习刷新）会漏掉这个窗口。
 */
export function evaluateBlindBoxTrigger(
  input: BlindBoxTriggerInput,
): { available: true; reason: BlindBoxTriggerReason } | { available: false; reason?: 'complete' | 'used-today' | 'none' } {
  const today = localDayKey(input.now)

  // ① 集齐 5 枚 → 系统自动隐藏（任务 C2 第 3 条）
  if (input.state.owned.length >= BLIND_BOX_TOTAL) return { available: false, reason: 'complete' }

  // ② 每日防刷：今天已经抽过
  if (input.state.usedDays.includes(today)) return { available: false, reason: 'used-today' }

  // ③a 单日解锁普通成就 ≥3（排除盲盒 id 自反馈 + 排除 night-owl 彩蛋）
  const unlockedToday = input.unlockedRecords.filter(
    (r) =>
      r.unlockedAt === today &&
      isCollectible(r.id) &&
      !BLIND_BOX_IDS.has(r.id) &&
      // 内置成就才计数：自定义卡 id 理论上也不会出现在解锁记录里，这里白名单更稳
      ACHIEVEMENTS.some((a) => a.id === r.id),
  ).length
  if (unlockedToday >= BLIND_BOX_THRESHOLDS.UNLOCKS_TODAY) {
    return { available: true, reason: 'unlocks-today' }
  }

  // ③b 连续学习 ≥7 天
  if (effectiveCurrent(input.streak, input.now) >= BLIND_BOX_THRESHOLDS.STREAK_DAYS) {
    return { available: true, reason: 'streak' }
  }

  // ③c 单日累计专注 ≥60 分钟
  const todayFocus = (input.dailyStats ?? []).find((s) => s.date === today)
  if ((todayFocus?.focusMinutes ?? 0) >= BLIND_BOX_THRESHOLDS.FOCUS_MINUTES) {
    return { available: true, reason: 'focus' }
  }

  return { available: false, reason: 'none' }
}

// ==================== 抽取（纯函数，随机源可注入） ====================

export type BlindBoxDrawResult =
  | { ok: true; id: string; state: BlindBoxState }
  | { ok: false; reason: 'all-owned' | 'used-today' }

/**
 * 抽一次盲盒：**必出**一个未拥有的盲盒成就（任务 C2 的"保底"语义 ——
 * 池子只有 5 枚且抽到即拥有，所以"必出未拥有"天然等于"5 次必集齐"）。
 *
 * @param rand 随机源（默认 Math.random；测试注入确定性序列）
 *
 * 前置校验在抽取时**再跑一遍**（不只信触发判定）：入口组件与结算链路是两处调用，
 * 状态可能在两次渲染之间变化，抽取必须自己守住"集齐不放 / 当天不重抽"。
 */
export function drawBlindBox(
  state: BlindBoxState,
  now: Date = new Date(),
  rand: () => number = Math.random,
): BlindBoxDrawResult {
  const today = localDayKey(now)
  if (state.usedDays.includes(today)) return { ok: false, reason: 'used-today' }

  const remaining = BLIND_BOX_POOL.filter((a) => !state.owned.includes(a.id))
  if (remaining.length === 0) return { ok: false, reason: 'all-owned' }

  // 保底：候选非空时必出其一；`rand` 播出越界值（>1 或 NaN）时取模兜底到 0 号
  let r = rand()
  if (!Number.isFinite(r) || r < 0) r = 0
  const pick = remaining[Math.floor(r * remaining.length) % remaining.length]

  return {
    ok: true,
    id: pick.id,
    state: {
      owned: [...state.owned, pick.id],
      usedDays: state.usedDays.includes(today) ? state.usedDays : [...state.usedDays, today],
    },
  }
}

// ==================== 落库组合（薄层：抽中 → 成就记录 + 盲盒状态） ====================

/**
 * 完整的一次抽取落库：盲盒状态 + 成就解锁记录两处一起写。
 *
 * 成就记录走 `achievements:<profileId>`（与普通成就同键）：抽中的盲盒成就
 * 在「家庭墙 / 备份 / 合并」里就是一条普通解锁记录，跨设备天然同步；
 * 展示面由 C3 的盲盒抽屉负责（图鉴不展示，见文件头边界说明）。
 *
 * @returns 抽中的成就定义；未抽出（已集齐 / 今天已抽）返回 null
 */
export async function performBlindBoxDraw(
  now: Date = new Date(),
  rand: () => number = Math.random,
): Promise<AchievementDef | null> {
  const state = await loadBlindBoxState()
  const result = drawBlindBox(state, now, rand)
  if (!result.ok) return null

  // 成就记录：unlockedAt 记本地日期（与普通成就同口径）；saveUnlocked 自带去重合并
  const records = await loadUnlocked()
  records.push({
    id: result.id,
    unlockedAt: localDayKey(now),
    evidence: '从盲盒中开出',
  })
  await saveUnlocked(records)
  await saveBlindBoxState(result.state)
  // 状态刚写入，定义必在池内；`?? null` 是类型收口（脏状态时宁可报没抽到）
  return blindBoxDefById(result.id) ?? null
}
