/**
 * 进度记录的"字段补全"纯函数。
 *
 * 从 `stores/userData.ts` 抽出来（**纯搬运，行为不变**）的唯一原因：
 * `version(3).upgrade()` 要对 v1/v2 行做合并，而 v1 行可能缺 `fsrs` / `bkt` / `reviewStage` /
 * `lastReviewAt`。迁移模块不能 import 任何 Pinia store（会拉着整棵 store 树进升级回调），
 * 所以补字段这件事必须呆在一个"零 store 依赖"的文件里。
 */
import type { ProgressRecord } from '@/db'
import { stateFromProbability } from '@core/mastery/bkt'

/** 补全所有可能缺失的字段，保证老数据平滑升级 */
export function ensureFields(rec: ProgressRecord): ProgressRecord {
  const reviewStage = rec.reviewStage ?? 0
  const bkt = rec.bkt ?? stateFromProbability(rec.masteryProbability) ?? undefined
  return {
    ...rec,
    correctStreak: rec.correctStreak ?? 0,
    wrongStreak: rec.wrongStreak ?? 0,
    reviewStage,
    nextReviewAt: rec.nextReviewAt ?? rec.lastStudiedAt,
    lastReviewAt: rec.lastReviewAt ?? null,
    bkt,
    masteryProbability: rec.masteryProbability ?? bkt?.pKnown,
  }
}
