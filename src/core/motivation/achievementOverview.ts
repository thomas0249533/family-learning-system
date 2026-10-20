/**
 * 成就「概览」派生（V1.3 · P1 收尾）：家长端的四类来源分布、解锁证据列表，以及全收集判定。
 *
 * 为什么单独一个纯函数模块而不是写在页面里：
 *   1. 这些是**可穷举的规则**（四类必须恒定出现、证据只取已锁定的、按日期倒序），
 *      放页面里就只能靠 e2e 间接验；放纯函数里能在 node 环境逐条钉住。
 *   2. 家长端与图鉴页要显示**同一套口径**（"已解锁 3/8" 不能两处算出不同的数）。
 *
 * 输入刻意用最小接口（`OverviewItem`）而不是整个 `AchievementItem`：
 * 家长端手上只有 `ACHIEVEMENTS`（静态定义）+ `unlockedRecords`（库里的记录），
 * 硬造完整的 view model 会白算一遍进度。`AchievementItem` 天然满足这个接口，所以两处共用。
 */
import { db } from '@/db'
import type { AchievementSource } from './achievementMeta'

/** 四类来源的固定展示顺序（与 PRD §4.1 `source` 表一致） */
export const SOURCE_ORDER: AchievementSource[] = ['core', 'subject', 'habit', 'hidden']

/** 家长视图可以出现文字（儿童视图不出现"稀有/史诗"这类词，但来源是中性词，可以给家长看） */
export const SOURCE_LABEL: Record<AchievementSource, string> = {
  core: '核心',
  subject: '学科',
  habit: '习惯',
  hidden: '隐藏',
}

export interface OverviewItem {
  id: string
  source: AchievementSource
  earned: boolean
  /** YYYY-MM-DD；旧数据可能缺省或 '' */
  unlockedAt?: string
  /** 证据快照；旧记录没有 → 空串/缺省 */
  evidence?: string
  title?: string
  icon?: string
}

export interface SourceBucket {
  source: AchievementSource
  label: string
  total: number
  earned: number
}

/**
 * 四类来源分布。
 *
 * 硬约束：**四个桶恒定存在**（哪怕某一类是 0 枚），否则家长会以为"漏了一类"；
 * 顺序恒定 `SOURCE_ORDER`，不随数据顺序抖动。
 */
export function distributionBySource(items: OverviewItem[]): SourceBucket[] {
  return SOURCE_ORDER.map((source) => {
    const group = items.filter((it) => it.source === source)
    return {
      source,
      label: SOURCE_LABEL[source],
      total: group.length,
      earned: group.filter((it) => it.earned).length,
    }
  })
}

export interface EvidenceLine {
  id: string
  title: string
  icon: string
  evidence: string
  unlockedAt: string
}

/**
 * 最近解锁的证据列表。
 *
 * 规则：
 *   - 只取**已解锁且证据非空**的（旧记录没有快照 → 不显示，绝不事后补算，PRD §4.1）；
 *   - 按 `unlockedAt` 倒序，空日期排最后（`''` 是"旧数据未知"，不是"最早"）；
 *   - 同日期保持入参顺序（稳定排序），避免每次刷新抖动；
 *   - 不修改入参。
 */
export function evidenceLines(items: OverviewItem[], limit = 3): EvidenceLine[] {
  const rows = items
    .filter((it) => it.earned && (it.evidence ?? '').trim() !== '')
    .map((it) => ({
      id: it.id,
      title: it.title ?? it.id,
      icon: it.icon ?? '🏅',
      evidence: (it.evidence ?? '').trim(),
      unlockedAt: it.unlockedAt ?? '',
      _order: 0,
    }))

  // 带下标的稳定排序：同日期不比大小，只有"空日期垫底"这一条规则
  return rows
    .map((r, i) => ({ ...r, _order: i }))
    .sort((a, b) => {
      if (a.unlockedAt && b.unlockedAt && a.unlockedAt !== b.unlockedAt) {
        return b.unlockedAt.localeCompare(a.unlockedAt)
      }
      if (a.unlockedAt && !b.unlockedAt) return -1
      if (!a.unlockedAt && b.unlockedAt) return 1
      return a._order - b._order
    })
    .slice(0, Math.max(0, limit))
    .map(({ _order, ...rest }) => rest)
}

// ==================== 全收集总结卡「只弹一次」的状态 ====================
//
// 存 `db.settings`（跟折叠状态同一处）：这是**应用偏好**，要随导出/恢复一起走。
// 用户的迁移/恢复会把这条一起带走，不会出现"恢复备份后又弹一次总结卡"。

export const COLLECTION_SEEN_KEY = 'achievement:collectionSeen'

/** 是否已经看过总结卡（读失败 → 当作没看过，宁可多弹一次也别把里程碑吞掉） */
export async function hasSeenCollection(): Promise<boolean> {
  try {
    const rec = await db.settings.get(COLLECTION_SEEN_KEY)
    return rec?.value === true
  } catch {
    return false
  }
}

/** 标记已看过（失败静默：本次会话内关闭即生效，下次进来可能再弹一次，可接受） */
export async function markCollectionSeen(): Promise<void> {
  try {
    await db.settings.put({ key: COLLECTION_SEEN_KEY, value: true })
  } catch {
    /* 存不了就算了 */
  }
}
