/**
 * 「备份引用了、但本机没装」的学习包 —— 纯函数（V1.6 · E1）
 *
 * ## 它要回答的那句话
 * 家长报的是「专项练习进度丢了」。排查结论是**数据一行没丢**：
 *   - 导出侧（`bundleIO.ts`）：按档案把 `progress` / `mistakes` 全量导出，
 *     **没有**按 `packageType` 过滤，专项包的行本来就在备份里；
 *   - 合并侧（`mergeProgress.ts`）：单调不减，谁新谁胜，
 *     **从不因为"包不存在"而丢行**。
 * 真正发生的是：v2 备份**按设计不含 `packages`**（`types.ts` 的 `BackupV2` 注释：
 * 包是设备级资产，由用户另外搬运）。专项包是一次性导入的、只存在于当初导它的
 * 那台设备；内置单元包每台设备都从 content/ 装好了 —— 这解释了为什么只有专项包出事。
 * 于是另一台设备导入之后：行全在 `db.progress` 里，但挂它的包不在 `db.packages` 里，
 * `/learn` 按包渲染，这些行就没有入口可挂 → 看起来就是"进度没了"。
 *
 * ## 为什么这里只"算出来"，不动任何数据
 * 修复只负责把真相摆到家长眼前（预览警告 + 完成提示）。
 * **合并引擎的单调不减不许碰**：为了"列表干净"而丢掉这些行，等于把
 * "换台设备接着学"变成"换台设备从头学" —— 那才是真丢数据。
 * 所以本文件零 I/O、零 Dexie 依赖，也不提供任何"过滤行"的入口。
 *
 * ## 为什么不做归属推断
 * 行上的 `packageId` 可能是老的入口包 id，真正的归属是 `resolveOwnerPackageId`
 * 的职责，且要在包导入之后才算得准。导入预览阶段**照抄行上的值**：
 * 宁可多报一个（导入包之后它自然归位），也不能因为"猜错了归属"而少报一个 ——
 * 少报就是家长看到的那句"进度丢了"。
 */

/** 只用到 `packageId` 一个字段的行（`ProgressRecord` / `MistakeRecord` 都满足） */
export interface PackageRefRow {
  readonly packageId?: string | null
}

/** 字典序（按 UTF-16 码位），**不用** `localeCompare`：后者随语言环境变，测试会飘 */
function compareIds(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** 行上的 `packageId`：只认非空字符串，其余（缺失 / 空串 / 非字符串）一律跳过 */
function packageIdOf(row: PackageRefRow | null | undefined): string {
  const id = row?.packageId
  return typeof id === 'string' ? id : ''
}

/**
 * 备份里引用了、但本机 `db.packages` 里没有的包 id。
 *
 * @param incoming 备份数据里所有带 `packageId` 的行（`progress` + `mistakes`）。
 *   错题本同样会"看起来丢"（错题卡按包分组），所以两张表都要算。
 * @param localPackageIds 本机已装包的 id 全集。
 * @returns 缺失的包 id，**去重 + 升序**（方便断言与 UI 稳定展示）。
 *
 * 容错：`incoming` / `localPackageIds` 为 `null`、行本身为 `null`、
 * `packageId` 为空串或缺失 —— 一律跳过，不抛。预览只是"提醒"，
 * 不该因为一份手工编辑过的备份文件把整个导入流程打断。
 */
export function collectMissingPackageIds(
  incoming: readonly PackageRefRow[] | null | undefined,
  localPackageIds: ReadonlySet<string> | null | undefined
): string[] {
  const local: ReadonlySet<string> = localPackageIds ?? new Set<string>()
  const missing = new Set<string>()

  for (const row of incoming ?? []) {
    const id = packageIdOf(row)
    if (id === '') continue
    if (local.has(id)) continue
    missing.add(id)
  }

  return [...missing].sort(compareIds)
}

/**
 * `rows` 里属于 `packageIds` 的行数 —— 给家长的文案要报"**几条**记录"，
 * 只报包个数会让人误以为是"缺了几个包的功能"。
 *
 * 与 `collectMissingPackageIds` 分开是为了各管一件事：
 * 前者决定"缺哪些包"，后者决定"牵连多少条"。合并成一个返回
 * `{ ids, rows }` 的对象反而让"稳定排序"这条契约变得难测。
 */
export function countRowsForPackages(
  rows: readonly PackageRefRow[] | null | undefined,
  packageIds: readonly string[]
): number {
  if (packageIds.length === 0) return 0
  const wanted = new Set(packageIds)
  let count = 0

  for (const row of rows ?? []) {
    const id = packageIdOf(row)
    if (id === '') continue
    if (wanted.has(id)) count++
  }

  return count
}
