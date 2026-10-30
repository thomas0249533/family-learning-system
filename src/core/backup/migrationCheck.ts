/**
 * 换机迁移 · 自检报告（V3.0 · M4 / `docs/plan/v3.0-milestone.md`）
 *
 * ## 它要解决的问题
 * "导入完成"这句话本身没有任何信息量：家长真正想知道的是**数据是不是都过来了**。
 * 而数据丢失在这个系统里的症状极其安静 —— 少 3 条进度不会有任何报错，
 * 要等孩子几天后复习时才发现"这个知识点怎么又是新的"。
 *
 * 所以导入之后立刻做一次**计数对账**：备份里有多少、本机现在有多少，
 * 逐项摆出来。这不是额外的数据源，两边都在手上（备份的 `Bundle[]` + 库里现状）。
 *
 * ## 为什么判据是"不少于"而不是"相等"
 * 合并是**单调不减**的并集（`planMerge` 的整条设计前提）：
 *   - 本机原来就有更多进度 → 导入后 `actual > expected`，这是**正常**的；
 *   - 本机原来更少 → 导入后应当恰好补齐到 `expected`。
 * 唯一需要报警的是 `actual < expected`：**少了**，说明有行没写进去。
 * 把"相等"当判据会让所有在用的设备都报红，报告立刻失去意义。
 *
 * ## 为什么 `packages` 是"无法比对"
 * v2 备份按设计**不含学习包**（包是设备级资产，见 `types.ts` 的 `BackupV2` 注释）。
 * 所以本机包数没有"应有多少"这个期望值。硬凑一个（比如"用备份里 progress 涉及的
 * 包 id 数"）会把"家长还没导入那个包"报成数据丢失 —— 那是另一件事，
 * 已有 `missingPackages` 专门负责。这里只**报数**，不下结论。
 */

import type { Bundle } from './types'

/** 五项计数的口径与界面上的顺序一致 */
export interface MigrationCounts {
  /** 学习包数（备份里没有 → `null`，见文件头末段） */
  packages: number | null
  progress: number
  mistakes: number
  achievements: number
  marks: number
}

export type CheckVerdict =
  /** 与本机原有数据合并后恰好等于备份里的数量 */
  | 'ok'
  /** 本机原来就有更多（并集正常结果） */
  | 'more'
  /** 少了 —— 唯一需要报警的结论 */
  | 'less'
  /** 备份里没有这个口径，无从比对 */
  | 'n/a'

export interface MigrationCheckRow {
  key: keyof MigrationCounts
  label: string
  /** 备份里的数量；`null` = 无从比对 */
  expected: number | null
  actual: number
  verdict: CheckVerdict
  /** 给家长看的一句话（`ok` 时为"一致"，`less` 时说少了多少） */
  hint: string
}

export interface MigrationReport {
  rows: MigrationCheckRow[]
  /** 没有任何一项是 `less`。`n/a` 不阻塞（见文件头末段） */
  ok: boolean
  /** 少了的那几项的中文名，供一句话总结用 */
  failedLabels: string[]
}

const LABELS: Record<keyof MigrationCounts, string> = {
  packages: '学习包',
  progress: '学习进度',
  mistakes: '错题',
  achievements: '徽章',
  marks: '完成标记',
}

/**
 * 备份（`Bundle[]`）里各项有多少。
 *
 * 用 `Bundle` 而不是 `BackupV2` 文档：导入链路已经把 v1/v2 两种格式都适配成
 * `Bundle[]` 了，报告不该再区分"这份备份是什么年代写的"。
 */
export function countsFromBundles(bundles: readonly Bundle[]): MigrationCounts {
  const out: MigrationCounts = { packages: null, progress: 0, mistakes: 0, achievements: 0, marks: 0 }

  for (const bundle of bundles ?? []) {
    if (!bundle) continue
    out.progress += Array.isArray(bundle.progress) ? bundle.progress.length : 0
    out.mistakes += Array.isArray(bundle.mistakes) ? bundle.mistakes.length : 0
    out.marks += Array.isArray(bundle.cardCompletions) ? bundle.cardCompletions.length : 0

    // 徽章存在分片键 `achievements` 里，是个数组（`[{ id, unlockedAt }]`）。
    // 形状不认识就按 0 算 —— 宁可报告少一项，也不要因为一个畸形值整块抛错，
    // 那会把"导入成功"变成"导入后页面白屏"。
    const badges = (bundle.settings ?? {}).achievements
    if (Array.isArray(badges)) out.achievements += badges.length
  }

  return out
}

/** 逐项比对的结论（纯函数） */
export function buildMigrationReport(
  expected: MigrationCounts,
  actual: MigrationCounts,
): MigrationReport {
  const keys: Array<keyof MigrationCounts> = [
    'packages',
    'progress',
    'mistakes',
    'achievements',
    'marks',
  ]

  const rows: MigrationCheckRow[] = keys.map((key) => {
    const want = expected[key]
    const got = actual[key]
    const label = LABELS[key]

    if (want === null) {
      return {
        key,
        label,
        expected: null,
        actual: got ?? 0,
        verdict: 'n/a',
        hint: '备份里不含学习包，无法比对（这属于正常情况）',
      }
    }

    const realGot = got ?? 0
    if (realGot >= want) {
      const verdict: CheckVerdict = realGot === want ? 'ok' : 'more'
      return {
        key,
        label,
        expected: want,
        actual: realGot,
        verdict,
        hint: verdict === 'ok' ? '一致' : `本机原有更多（多 ${realGot - want}）`,
      }
    }

    return {
      key,
      label,
      expected: want,
      actual: realGot,
      verdict: 'less',
      hint: `少了 ${want - realGot} 条，建议重新导入`,
    }
  })

  const failedLabels = rows.filter((r) => r.verdict === 'less').map((r) => r.label)
  return { rows, ok: failedLabels.length === 0, failedLabels }
}

/** 一句话总结（报告卡片顶部那句话，避免 UI 自己拼） */
export function summarizeReport(report: MigrationReport): string {
  if (report.ok) return '数据已全部到位，可以放心用了。'
  return `${report.failedLabels.join('、')}比备份里少，请重新导入同一份备份。`
}
