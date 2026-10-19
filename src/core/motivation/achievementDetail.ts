/**
 * 成就卡片详情 · **纯展示逻辑**（V1.3 · P1）
 *
 * 为什么单独一个文件：本项目单测跑在 node 环境（无 jsdom），组件挂不上，
 * 所以"弹层里显示什么"必须从 `.vue` 里搬出来，才能被穷举单测钉死。
 * 组件只负责把 `AchievementDetail` 画成 DOM。
 *
 * ## 三条铁律
 * 1. **剪影不可打开**：隐藏成就未解锁时 `canOpen === false`，且返回对象里
 *    **连占位文案都不带真实 title/desc** —— 一旦"能点开"，就等于把谜底交出去
 *    （PRD AC-14）。哪怕调用方忘了判空，`title` 也是空串，不会画出真实标题。
 * 2. **只做展示，不改判定口径**：本模块不缓存历史最大值、不改 `percent`、
 *    不改 `current`/`target`，只把已算好的字段重新组织成"行"。
 * 3. **文案不另起一套**：进度提示直接透传 `item.hint`（唯一来源是
 *    `achievementProgress.progressText`），这里不拼任何百分比/量词。
 *
 * ## 三类形态
 * - 已解锁：层级 / 小组 / 连环 / 解锁日期 / 证据（旧记录没有证据就不渲染该行），
 *   不显示进度（"10/10"是无意义回放），`cta` = 已解锁。
 * - 未解锁·可进度化：进度条 + 提示 + current/target，`cta` = 还差 N（N ≥ 1）。
 * - 未解锁·二值事件：不画进度条，`cta` = 完成一次即可解锁（与 hint 同句，只出现一次）。
 */
import type { AchievementItem } from './achievementMeta'

/** 详情里的一行"标签 : 值" */
export interface DetailRow {
  label: string
  value: string
}

export interface AchievementDetail {
  /** 是否允许打开弹层；剪影恒 false */
  canOpen: boolean
  /** 弹层标题；剪影为空串（不泄底） */
  title: string
  /** 静态事实行（层级 / 小组 / 连环 / 日期 / 证据） */
  rows: DetailRow[]
  /** 页脚状态词：已解锁 / 还差 N / 完成一次即可解锁 */
  cta: string
  /** 是否画进度条（仅"未解锁且可进度化"） */
  showProgress: boolean
  /**
   * 未解锁可进度化时的提示文案（原样透传 `item.hint`）；
   * 其他形态为空串 —— 二值形态的那句话由 `cta` 承担，避免同句出现两遍。
   */
  hint: string
}

/** 剪影/不可打开时的返回值：零信息，杜绝"点开即泄底"。每次新建，避免共享数组被改脏。 */
function closed(): AchievementDetail {
  return { canOpen: false, title: '', rows: [], cta: '', showProgress: false, hint: '' }
}

/**
 * 组装一枚成就的详情。
 *
 * @param item          图鉴视图项（已由 `buildAchievementView` 算好一切）
 * @param tierLabel     `TIER_META[tier].label`（常见 / 进阶 / 稀有 / 隐藏）
 * @param categoryLabel `CATEGORY_META[category].label`（精熟目标 / …）
 */
export function detailOf(
  item: AchievementItem,
  tierLabel: string,
  categoryLabel: string,
): AchievementDetail {
  // ★ 剪影一律不许打开：这里直接短路，后面的字段一个都不碰
  if (item.silhouetted) return closed()

  const rows: DetailRow[] = [
    { label: '层级', value: tierLabel },
    { label: '所属小组', value: categoryLabel },
  ]

  // 连环标记只有已解锁项才有值（未解锁为空串）→ 天然不会泄底
  if (item.chainLabel) rows.push({ label: '连环', value: item.chainLabel })

  if (item.earned) {
    rows.push({ label: '解锁日期', value: item.unlockedAt || '较早' })
    // 旧记录没有 evidence → 空串 → 该行不渲染（绝不事后补算，PRD A-06）
    if (item.evidence) rows.push({ label: '证据', value: item.evidence })
    return {
      canOpen: true,
      title: item.title,
      rows,
      cta: '已解锁',
      showProgress: false,
      hint: '',
    }
  }

  // 未解锁：`target > 1` 才值得画进度条（事件型 0%/100% 的条没有信息量）
  if (item.metered && item.target > 1) {
    // 正常数据恒有 current < target；仍兜一层 max(1, …)，
    // 免得脏数据算出"还差 0"这种自相矛盾的状态词。
    const gap = Math.max(1, item.target - item.current)
    return {
      canOpen: true,
      title: item.title,
      rows,
      cta: `还差 ${gap}`,
      showProgress: true,
      hint: item.hint,
    }
  }

  return {
    canOpen: true,
    title: item.title,
    rows,
    cta: '完成一次即可解锁',
    showProgress: false,
    hint: '',
  }
}
