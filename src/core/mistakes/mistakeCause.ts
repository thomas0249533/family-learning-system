/**
 * C1 · 错题归因模型（纯函数，可单测）
 *
 * ## 为什么要有这个字段
 * 错题本原来只记"错了几次"，不记"为什么错"。孩子复习只是重做，家长想指导也无从下手 ——
 * 同一道题，"知识点没学会"和"算对了但抄错数"需要的干预完全不同：
 * 前者要回去补课，后者只要一句"做完检查一遍"。没有归因，复习建议只能一刀切。
 *
 * ## 为什么 `mistakeCause` 是 optional 而不是必填
 * 必填就意味着一次 schema 迁移 + 给全部历史错题**编一个**原因。那是撒谎：
 * 我们并不知道那道题当时为什么错，编出来的"知识盲区"会污染家长看到的所有统计。
 * optional 的代价由两层分摊：
 *   - **逻辑层**（`mistakeCauseOf`）：没标 = 按 `'knowledge'` 兜底。零迁移的代价
 *     就是把"没标"和"标了知识盲区"混同，下游算法（排序 / 建议）可以接受这种混同；
 *   - **UI 层**（`mistakeCauseLabelOf`）：必须区分 —— 显示「未分类」而不是默认
 *     替用户选一个。显示层替用户做一个他从未做过的决定，比没有字段更糟。
 *
 * ## 标签是手动打的
 * 没有"自动归因"：系统看得出对错，看不出为什么错。任何自动猜测（超时？审题？）
 * 都是把不确定性强加给家长。所以这个模型只提供打标 / 改标 / 取消打标三个动作，
 * 且只在用户点击时写库（绝不可以在 onMounted / computed 里写，否则刷新一次
 * 就给全部历史错题编了原因，等于假数据）。
 */

import type { MistakeRecord } from '@/db'

export type MistakeCause = 'knowledge' | 'careless' | 'timeout' | 'misread'

/**
 * 给家长和孩子看的中文标签。**不许出现英文码** —— 家长不认识 `careless`，
 * 看到英文码只会觉得"这是给机器看的"。
 */
export const MISTAKE_CAUSE_LABELS: Record<MistakeCause, string> = {
  knowledge: '知识盲区',
  careless: '粗心大意',
  timeout: '超时未完成',
  misread: '审题不清',
}

/** UI 迭代用的稳定顺序（与类型声明的顺序一致） */
export const MISTAKE_CAUSE_ORDER: readonly MistakeCause[] = [
  'knowledge',
  'careless',
  'timeout',
  'misread',
]

/** 未打标时 UI 显示的占位文案（**不是**「知识盲区」—— 别默认替用户选一个） */
export const MISTAKE_CAUSE_UNLABELED = '未分类'

/**
 * 逻辑层归因：旧行没有该字段时返回 `'knowledge'`。
 *
 * 只有逻辑层允许这样兜底：零迁移的代价就是把"没标"和"标了知识盲区"混同，
 * 下游算法可以接受；UI 层必须用 `mistakeCauseLabelOf` 区分。
 */
export function mistakeCauseOf(row: MistakeRecord): MistakeCause {
  return row.mistakeCause ?? 'knowledge'
}

/**
 * UI 层归因：未打标时返回「未分类」。
 *
 * 与 `mistakeCauseOf` 的兜底**故意不同** —— 显示层把"没标"画成"知识盲区"，
 * 等于替用户做了一个他从未做过的决定，比留空更糟。
 */
export function mistakeCauseLabelOf(row: MistakeRecord): string {
  return row.mistakeCause ? MISTAKE_CAUSE_LABELS[row.mistakeCause] : MISTAKE_CAUSE_UNLABELED
}
