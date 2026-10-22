/**
 * 打印分页（V1.4 · B5 / D4「按小组分页」）
 *
 * ## 为什么是"按小组"而不是"每页 N 枚"
 * 按枚数硬切会把同一小组劈到两页（第 1 页末尾是精熟组、第 2 页开头还是精熟组），
 * 家长翻页时看不出"这一页讲什么"。按小组分页后每页只属于一个小组，
 * 页眉能写清"精熟 · 已获得 6 / 8"，一页一件事。
 *
 * 更实际的理由：**自定义包一进来顺序就全错**。包里的卡追加在 28 枚之后，
 * 按枚数切页会让同一组的卡随着包的数量漂移到不同页（今天第 2 页、明天第 3 页），
 * 而按组切页只影响那一组自己的续页。
 *
 * ## 两个"不要做"的事
 * 1. **不生成页码**。页码（`第 x / n 页`）由渲染层统一编号：算法里编的话，
 *    续页会出现"第 3 / 4 页"和"第 3 / 5 页"打架（两个分支各自算总数）。
 * 2. **不产空页**。某组一枚都没有就整组跳过 —— 空页在打印件上就是一张白纸，
 *    用户会以为打印机漏了。
 */
import {
  CATEGORY_ORDER,
  type AchievementCategory,
  type AchievementItem,
} from '@core/motivation/achievementMeta'
import { isCollectible } from '@core/motivation/achievements'

/** 一页放 3 列 × 4 行。改这个数只需改这里，打印与图片共用同一套分页。 */
export const PRINT_PER_PAGE = 12

export interface PrintPage {
  /** 这一页属于哪个小组（每页只含一个小组） */
  category: AchievementCategory
  /** 本页的卡（顺序 = 传入顺序，即 `ACHIEVEMENTS` 声明顺序 + 自定义包追加顺序） */
  items: AchievementItem[]
  /** 是否是同组的**续页** → 渲染标题时加"（续）" */
  continued: boolean
  /** 该小组总枚数（同一组的每一页都报同一个数，页眉才不会跳） */
  groupTotal: number
  /** 该小组已获得枚数（同上） */
  groupEarned: number
}

/**
 * 按小组分页。
 *
 * ## 可收集过滤（V1.6 · C6）
 * 打印件与"导出图片"都是**收集类界面**：家长会把这张纸贴到墙上、把图片发到家庭群。
 * 所以 `night-owl`（不参与收集的彩蛋）在这里也必须隐身 —— 否则孩子会在一张纸上
 * 看到图鉴里怎么翻都翻不到的第 28 枚，那比"多展示一枚"更糟（它等于泄底 + 造出
 * "我有一枚看不见的徽章"的怪状态）。
 * 过滤放在**本函数**而不是两个调用点（`AchievementsPrint.vue` / `exportImages.ts`）：
 * 这里是二者共用的唯一分页入口，放在这里就不存在"新增一个导出目标忘了滤"。
 *
 * @param items 已排好序的视图模型（`buildAchievementItems` 的输出）
 * @param perPage 单页容量，默认 12（3×4）
 *
 * 规则：
 * 1. 只取**参与收集**的卡；按 `CATEGORY_ORDER`（M → G → B → E）遍历，组内保持传入顺序；
 * 2. 空组**不产页**；
 * 3. 组内超过容量 → 续页，后续页 `continued: true`；
 * 4. 不足一页的组也只占一页（不做"合并两个小组省纸"——那会破坏"每页一件事"）。
 */
export function paginateByCategory(
  items: AchievementItem[],
  perPage: number = PRINT_PER_PAGE,
): PrintPage[] {
  // 容量非法时按 1 处理：0 会让 chunk 循环死循环，负数同理。
  // 这条不是洁癖 —— 调用方可能从设置里读容量，读到 0 就是一张也打不出来。
  const capacity = Number.isFinite(perPage) && perPage >= 1 ? Math.floor(perPage) : 1

  // ★ 收集面口径：彩蛋（night-owl）不出现在任何一页，也不计入 groupTotal / groupEarned
  const collectible = items.filter((i) => isCollectible(i.id))

  const pages: PrintPage[] = []
  for (const category of CATEGORY_ORDER) {
    const group = collectible.filter((i) => i.category === category)
    if (group.length === 0) continue

    const groupTotal = group.length
    const groupEarned = group.filter((i) => i.earned).length

    for (let start = 0; start < group.length; start += capacity) {
      pages.push({
        category,
        items: group.slice(start, start + capacity),
        continued: start > 0,
        groupTotal,
        groupEarned,
      })
    }
  }
  return pages
}

/**
 * 页码文案。**渲染层唯一**的页码来源（算法不生成页码，见文件头）。
 *
 * @param index 0-based 页序
 * @param total 总页数
 */
export function pageLabel(index: number, total: number): string {
  const n = total > 0 ? total : 1
  return `第 ${index + 1} / ${n} 页`
}
