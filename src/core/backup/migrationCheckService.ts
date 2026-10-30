/**
 * 换机迁移自检的 **IO 层**（纯函数在 `migrationCheck.ts`）。
 *
 * ## 为什么读库要单独一个文件
 * `migrationCheck.ts` 的比对规则要能被单测穷举（它没有 db、没有时钟）。
 * 这里只负责"把库里的数字数出来"，一旦它也开始判"够不够"，就会有两套口径，
 * 分叉的症状是"报告说全对、家长实际看到少了"。
 *
 * ## 为什么计数要按备份里的档案逐个读
 * `db.progress.count()` 是**跨档案**读，会被 `scripts/check-profile-scope.mjs` 判红，
 * 更实际的问题是：新设备上可能还留着别的档案的行，把它们算进来会让报告永远"更多"，
 * 从而永远不报警（一个恒真的断言等于没有断言）。
 * 所以只数备份涉及的那些 pid，读法与导出层一致（`where('profileId').equals(pid)`）。
 */

import { db } from '@/db'
import { scopedKey } from '@core/profile/settingsScope'
import { buildMigrationReport, countsFromBundles, type MigrationCounts, type MigrationReport } from './migrationCheck'
import type { Bundle } from './types'

/** 空计数（读库失败时的降级值：全 0 会让报告报"少了"，比"崩溃"好，也比"全绿"诚实） */
function emptyCounts(): MigrationCounts {
  return { packages: 0, progress: 0, mistakes: 0, achievements: 0, marks: 0 }
}

/** 某个分片键里数组的长度（形状不认识按 0） */
function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * 数本机现状。
 *
 * @param pids 只数这些档案的行（通常是备份里出现过的档案）。
 *             传空数组 = 只数包数，其余全 0。
 */
export async function readLocalCounts(pids: readonly string[]): Promise<MigrationCounts> {
  const counts = emptyCounts()

  // 学习包是设备级表（没有 profileId），数全库即可
  try {
    counts.packages = (await db.packages.toArray()).length
  } catch {
    counts.packages = null
  }

  for (const pid of pids) {
    if (typeof pid !== 'string' || pid === '') continue
    counts.progress += (await db.progress.where('profileId').equals(pid).toArray()).length
    counts.mistakes += (await db.mistakes.where('profileId').equals(pid).toArray()).length

    // 与 `bundleIO` 同样的降级：单测替身可能没有这张表（db v8 才加）
    const marksTable = (db as unknown as { cardCompletions?: typeof db.cardCompletions })
      .cardCompletions
    if (marksTable) {
      counts.marks += (await marksTable.where('profileId').equals(pid).toArray()).length
    }

    const badges = await db.settings.get(scopedKey('achievements', pid))
    counts.achievements += arrayLength(badges?.value)
  }

  return counts
}

/**
 * 导入之后的完整自检：备份里有多少 vs 本机现在有多少。
 *
 * @param imported `previewImport` 给出的 `bundles`（导入前的备份内容）。
 *                 它同时决定了"比对哪几个档案"—— 新设备上别的档案的行不参与。
 */
export async function checkAfterImport(
  imported: readonly Bundle[],
): Promise<MigrationReport & { counts: MigrationCounts }> {
  const pids = (imported ?? []).map((b) => b?.profileId).filter((p): p is string => !!p)
  // 期望值只走 `countsFromBundles` 这一个口径（`packages` 它已经返回 `null`）。
  // 在这里重写一遍求和是最容易发生的事故：两边漏项不一致，报告就会说"全对"而实际少了。
  const expected = countsFromBundles(imported)
  const actual = await readLocalCounts(pids)
  return { ...buildMigrationReport(expected, actual), counts: actual }
}
