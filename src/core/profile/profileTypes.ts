/**
 * 档案（profile）的**类型与常量**，刻意不 import `@/db`。
 *
 * 原因：`db/index.ts` 要 import `migrateV4.ts` 挂 upgrade 钩子，而迁移又需要
 * `DEFAULT_PROFILE_ID` / `PROFILES_KEY` 这些常量。若常量放在 `currentProfile.ts`
 * （它要读写 `db.settings`），就形成
 *   `db → migrateV4 → currentProfile → db`
 * 的循环。V1.3 的 `migrateV3Recovery` 拆文件也是同一个理由。
 *
 * 依赖方向必须是单向的：
 *   profileTypes ← migrateV4 ← db
 *   profileTypes ← currentProfile → db
 */

export interface ProfileMeta {
  /** 稳定标识，创建后**永不改**（改名只动 name） */
  id: string
  /** 显示名，家长可改 */
  name: string
  /** ISO 时间 */
  createdAt: string
}

/** 上限（D3 裁决：够二胎 + 家长自己体验）。第 5 个直接拒绝，不做"切换时隐藏"。 */
export const MAX_PROFILES = 4

/**
 * 默认档案 id。
 *
 * 用**固定字面量**而不是生成值，是因为跨设备合并（D5「两台设备是同一个孩子」）
 * 依赖"同一个孩子 = 同一个 id"。若默认档案也用随机 id，两台设备的 `default`
 * 就会变成两个不同 id，导入时会新建一个重复档案。
 */
export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_PROFILE_NAME = '我'

/** settings 里存档案列表与当前档案的键（**全局**，不分片） */
export const PROFILES_KEY = 'profiles'

export interface ProfilesState {
  activeId: string
  list: ProfileMeta[]
}

/** 超过档案上限时抛这个，UI 据此给"先导出再删"的引导文案 */
export class ProfileLimitError extends Error {
  readonly code = 'PROFILE_LIMIT'
  constructor(limit: number = MAX_PROFILES) {
    super(`最多 ${limit} 个档案`)
    this.name = 'ProfileLimitError'
  }
}

/** 新建档案的 id：时间戳 + 随机，**不用递增序号** */
export function makeProfileId(now: Date = new Date(), rand: () => number = Math.random): string {
  // 为什么不用 `p2` / `p3` 这种序号：两台设备各自建到第 2 个档案时会撞成同一个 id，
  // 而它们背后是两个不同的孩子 —— 合并时会把两个人并成一个人，且无法事后区分。
  const t = Math.floor(now.getTime()).toString(36)
  const r = Math.floor(rand() * 0xffff)
    .toString(36)
    .padStart(4, '0')
  return `p_${t}_${r}`
}

/** 归一化任意输入 → 合法的 ProfilesState（读不到 / 全脏 → 单个 default） */
export function normalizeProfilesState(raw: unknown, now: Date = new Date()): ProfilesState {
  const fallback: ProfilesState = {
    activeId: DEFAULT_PROFILE_ID,
    list: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: now.toISOString() }],
  }
  if (!raw || typeof raw !== 'object') return fallback

  const obj = raw as { activeId?: unknown; list?: unknown }
  const rawList = Array.isArray(obj.list) ? obj.list : []
  const list: ProfileMeta[] = []
  const seen = new Set<string>()

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Partial<ProfileMeta>
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!id || seen.has(id)) continue // 空 id / 重复 id 一律丢弃：id 重复等于两个人共用一个档案
    seen.add(id)
    list.push({
      id,
      name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : id,
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : now.toISOString(),
    })
    if (list.length >= MAX_PROFILES) break
  }

  if (list.length === 0) return fallback

  const wanted = typeof obj.activeId === 'string' ? obj.activeId : ''
  const activeId = list.some((p) => p.id === wanted) ? wanted : list[0].id
  return { activeId, list }
}
