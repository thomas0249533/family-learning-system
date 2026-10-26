// =====================================================================
// weekBucket · 学习包「按周」分桶（V2.7 · 轨道 A3）
// ---------------------------------------------------------------------
// 为什么需要它
//   每日一练类学习包是"45 天 / 90 天"的长计划，卡片列表一屏放不下，
//   而家长真正想找的是"这周的第几天"。这里只做**纯分桶**，不造数据：
//
//   · 包自己声明了周号（`manifest.week` / `manifest.weekIndex` /
//     `manifest.weekNo`，或标题里的「第 3 周」）→ 按声明值分桶；
//   · 没有声明 → 全部落进 `week: null` 的单一桶，由 UI 决定是否渲染周头。
//
// 关键约束：**绝不按顺序每 7 个塞一个桶**。那样只要中间少一个包，
// 后面所有周号都会错位，而界面上看不出任何异常 —— 属于"看着对、其实错"。
// =====================================================================

/** 分桶只需要这两个字段，避免把 Dexie 的记录类型打进纯函数签名 */
export interface WeekBucketed {
  /** 包声明里的周号（1 起）；没有声明为 null */
  week: number | null
  /** 桶内排序用的次级键（标题） */
  title: string
}

/** 从数据里找周号的候选字段名（先看显式字段，再看标题文本） */
const WEEK_FIELDS = ['week', 'weekIndex', 'weekNo', 'weekNumber'] as const

/** 「第 3 周」「第3周」「Week 3」「W3」都能认出来 */
const WEEK_IN_TITLE = /(?:第\s*(\d{1,2})\s*[周週]|(?:week|wk|w)\s*(\d{1,2}))/i

/**
 * 从一段任意的包元信息里解出周号。
 *
 * 设计取舍：**只认 1~52 的正整数**。0 或 999 这种值更可能是别的含义被误读
 * （例如 `week: 0` 表示"未设置"），硬塞进"第 0 周"只会让人困惑 —— 一律当没声明。
 */
export function resolveWeekOf(meta: Record<string, unknown> | null | undefined): number | null {
  if (!meta) return null

  for (const field of WEEK_FIELDS) {
    const raw = meta[field]
    const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN
    if (Number.isInteger(n) && n >= 1 && n <= 52) return n
  }

  const title = typeof meta.title === 'string' ? meta.title : ''
  const m = title.match(WEEK_IN_TITLE)
  if (m) {
    const n = Number.parseInt(m[1] ?? m[2] ?? '', 10)
    if (Number.isInteger(n) && n >= 1 && n <= 52) return n
  }

  return null
}

export interface WeekBucket<T extends WeekBucketed> {
  /** 周号；null = 未声明周的兜底桶 */
  week: number | null
  /** 展示用标题（`第 3 周` / `未分周`） */
  label: string
  items: T[]
}

/**
 * 按周分桶。
 *
 * 排序规则：声明了周的桶按周号升序排在前面，`null` 桶永远在最后 ——
 * "未分周"更像附录，放在中间会让人误以为它是第 N 周。
 * 桶内按标题本地化排序，保证每次进来顺序一致（不依赖入库顺序）。
 */
export function groupByWeek<T extends WeekBucketed>(items: T[]): WeekBucket<T>[] {
  const byWeek = new Map<number | null, T[]>()

  for (const item of items) {
    const list = byWeek.get(item.week)
    if (list) list.push(item)
    else byWeek.set(item.week, [item])
  }

  const buckets: WeekBucket<T>[] = []
  for (const [week, list] of byWeek) {
    buckets.push({
      week,
      label: week === null ? '未分周' : `第 ${week} 周`,
      items: [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN')),
    })
  }

  return buckets.sort((a, b) => {
    if (a.week === null) return 1
    if (b.week === null) return -1
    return a.week - b.week
  })
}

/** 是否真的分出了多周（决定 UI 要不要渲染周头） */
export function hasMultipleWeeks<T extends WeekBucketed>(items: T[]): boolean {
  return groupByWeek(items).length > 1
}
