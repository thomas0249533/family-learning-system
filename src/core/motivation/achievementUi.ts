/**
 * 成就图鉴的**折叠状态**（V1.3 · A-04）
 *
 * 折叠状态是**纯 UI 态**，与解锁数据解耦：解锁发生在别的页面时，
 * 已获得区若处于收起态**不自动展开**（避免页面跳动），只更新计数与总进度条。
 *
 * ## 存哪里
 * 存 `db.settings` 的 `achievementUi` 键，结构 `{ v: 1, collapsed: string[] }`。
 * 之所以不放 localStorage：折叠偏好会随"导出/恢复备份"一起走，换设备后体验一致；
 * 而且 settings 表本来就是这类"应用偏好"的归属地（`studyStreak` 等也在那里）。
 *
 * ## 与 PRD §5.2 的一处细化（不是偏离）
 * PRD 的键表写的是 `grp:M` / `grp:G` / …，但**每个组在两个分区里各出现一次**
 * （`精熟目标` 在「已获得」和「待解锁」里都有），单一 `grp:M` 无法同时表达
 * "已获得组收起、待解锁组展开"。所以这里把组键限定为分区作用域：
 * `grp:<section>:<category>`。区键仍是 `earned` / `pending`。
 *
 * ## 组级跟随区级
 * 组没有"自己的默认态"，它跟随所在区的默认态：已获得区默认收起 → 其组收起；
 * 待解锁区默认展开 → 其组展开。用户手动点开某个区时，**该区的组一起展开**
 * （否则要点 1 + 4 次才能看到内容）；点收起时一起收起。
 * 单点某个组则只影响它自己（不再跟随），直到下次动它的父区。
 */
import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'

export const ACH_UI_KEY = 'achievementUi'

/** 当前档案的折叠状态键（V1.4：折叠是"这个孩子的界面"，必须分片） */
export function achUiKey(profileId: string = currentProfileId()): string {
  return scopedKey(ACH_UI_KEY, profileId)
}

export const UI_SECTIONS = ['earned', 'pending'] as const
export type UiSection = (typeof UI_SECTIONS)[number]

export const UI_CATEGORIES = ['M', 'G', 'B', 'E'] as const

/** 合法键集合（脏数据 / 旧版本键一律丢弃） */
export const UI_KEYS: string[] = [
  ...UI_SECTIONS,
  ...UI_SECTIONS.flatMap((s) => UI_CATEGORIES.map((c) => groupKey(s, c))),
]

/** 组键：`grp:earned:M` */
export function groupKey(section: UiSection, category: string): string {
  return `grp:${section}:${category}`
}

/**
 * 默认收起集合（PRD §5.2）：**已获得区收起，待解锁区展开**。
 * 组不单独列出 —— 它们跟随区（见文件头说明）。
 */
export const DEFAULT_COLLAPSED: string[] = ['earned']

/**
 * 归一化任意输入 → 合法的收起键数组。
 * 读不到 / 结构不合法 / 全是脏键 → **静默降级为默认态**，绝不阻塞渲染。
 */
export function normalizeCollapsed(raw: unknown): string[] {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { collapsed?: unknown }).collapsed)
      ? ((raw as { collapsed: unknown[] }).collapsed ?? [])
      : null
  if (!list) return [...DEFAULT_COLLAPSED]

  const out: string[] = []
  for (const v of list) {
    if (typeof v !== 'string') continue
    // 兼容早期写法的裸组键 `grp:M` → 视为「已获得区」的组键（那是最早只有一层折叠时的语义）
    const normalized = /^grp:[MGBE]$/.test(v) ? groupKey('earned', v.slice(4)) : v
    if (UI_KEYS.includes(normalized) && !out.includes(normalized)) out.push(normalized)
  }
  return out
}

/** 键是否收起 */
export function isCollapsed(collapsed: string[], key: string): boolean {
  return collapsed.includes(key)
}

/** 某区的全部下级组键 */
export function groupKeysOf(section: UiSection): string[] {
  return UI_CATEGORIES.map((c) => groupKey(section, c))
}

/**
 * 切换某区：区本身 + 其下全部组一起切（"组级跟随区级"）。
 * 返回**新数组**（不可变，方便 Vue 响应式）。
 */
export function toggleSection(collapsed: string[], section: UiSection): string[] {
  const keys = [section, ...groupKeysOf(section)]
  const next = isCollapsed(collapsed, section)
  const set = new Set(collapsed)
  for (const k of keys) {
    if (next) set.delete(k)
    else set.add(k)
  }
  return UI_KEYS.filter((k) => set.has(k))
}

/** 切换单个组 */
export function toggleGroup(collapsed: string[], section: UiSection, category: string): string[] {
  const key = groupKey(section, category)
  const set = new Set(collapsed)
  if (set.has(key)) set.delete(key)
  else set.add(key)
  return UI_KEYS.filter((k) => set.has(k))
}

/** 是否全部展开（任一分组收起 → false） */
export function isAllExpanded(collapsed: string[], visibleKeys: string[]): boolean {
  return visibleKeys.every((k) => !collapsed.includes(k))
}

/** 一键：任一收起 → 全部展开；全展开 → 全部收起 */
export function toggleAll(collapsed: string[], visibleKeys: string[]): string[] {
  if (isAllExpanded(collapsed, visibleKeys)) {
    const set = new Set([...collapsed, ...visibleKeys])
    return UI_KEYS.filter((k) => set.has(k))
  }
  const set = new Set(collapsed.filter((k) => !visibleKeys.includes(k)))
  return UI_KEYS.filter((k) => set.has(k))
}

// ==================== 持久化 ====================

/** 读取折叠状态（失败 → 默认态） */
export async function loadCollapsed(): Promise<string[]> {
  try {
    const rec = await db.settings.get(achUiKey())
    return normalizeCollapsed(rec?.value)
  } catch {
    return [...DEFAULT_COLLAPSED]
  }
}

/** 写入折叠状态（失败静默：本次会话内的折叠仍然有效） */
export async function saveCollapsed(collapsed: string[]): Promise<void> {
  try {
    await db.settings.put({ key: achUiKey(), value: { v: 1, collapsed } })
  } catch {
    /* 存不了就算了，不影响使用 */
  }
}
