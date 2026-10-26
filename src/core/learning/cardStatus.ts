/**
 * 学习卡片状态（V1.6 · Stage D · D1）—— 「一眼看出哪个单元学过」的唯一口径
 * ---------------------------------------------------------------------
 * 三张列表卡片（单元卡 / 主题卡 / 每日包卡）都要在**不读文字**的前提下区分
 * 「未学 / 学习中 / 需复习 / 已掌握」。本文件是那个判定的**唯一实现**：
 * 视图只负责把 `CardStatus` 翻成颜色与角标，不再各自算一遍。
 *
 * ## 为什么是纯函数、零 Vue 零 db
 * 本仓单测跑在 `environment: 'node'`（本机无 jsdom，见 `vitest.config.ts`），
 * 任何 `ref()` / `db.*` 都会把断言拖进浏览器语境。所以状态计算与渲染彻底切开：
 * 计算层只吃 `progress` 数组，测试可以直接喂假数据。
 *
 * ## 为什么分两种聚合模式（`attention` / `progress`）
 * 同一套「知识点状态」被问的问题不同，正确答案就不同：
 *
 * - **知识点级（`attention`）**：问的是「**此刻该不该回头**」。一个知识点到期了就该提醒，
 *   哪怕同组里其它都刚学完——这是 `topicCardStatusOf` 用的口径，也是引入 `progress`
 *   之前的唯一口径。
 * - **天 / 单元 / 包级（`progress`）**：问的是「**这摊内容我推进到哪了**」。用户对每日一练的
 *   原话是「40 天的打卡表，不知道**哪天做了、哪天没做**」——他要看的是**做没做**，而不是
 *   若干天之后这些天的内容整体的复习衰减情况。
 *
 * 全用 `attention` 会在真数据上立刻出两个错（team-lead 用 4 单元真包实测复现）：
 *   1. **学完的一天会长期挂红**：某天认真学完（当天 kp 全「已掌握」），过几天只要**一个**
 *      kp 被 `applyDecay` 判「需复习」，这天的卡就变红——用户读到的是「这天有问题」，
 *      而事实是「这天做完了」。
 *   2. **包卡几乎永不变绿**：45 天的每日包有几百个 kp，「所有 kp 同时都处于已掌握」这个
 *      条件同时成立的概率约等于零（`applyDecay` 每天都在把旧 kp 往「需复习」推），
 *      于是包卡只能长期红着，红失去信息量。
 *
 * 所以 `progress` 把「需复习」降级为**只在「该学的都学过了」时才允许红**：
 * 「掺着未学 / 学习中」= 还在推进（`learning`），「全学完且有人到期」= 整体到期（`review`）。
 * 状态集合没变（仍是四种），只是为了不改视图层的颜色协议，两种模式共用同一套
 * `CardStatus` 与 `CARD_STATUS_MARK/LABEL`。
 *
 * ## 语义映射（照抄 `TopicDetail.vue` 的 `.mastery-status`，不造第二套配色语言）
 * ```
 * 未学   → none      中性底（卡片保持 $card-bg，不改背景）
 * 学习中 → learning  warning
 * 需复习 → review    danger
 * 已掌握 → mastered  success
 * ```
 * 底色一律用 `--badge-{tone}-bg`（= `-light`），文字色用 `--{tone}-text`：
 * 这一对是 `scripts/a11y/contrast-report.ts` 的 `MUST_PASS` 成员，对比度真的被
 * 门禁守住。**绝对不能用 `-soft` 系列**——`-soft` 底被该脚本第 153 行显式排除在
 * 门禁之外（`/-soft$/` → 「不适用」），拿它当卡片底等于静默绕过 AA。
 *
 * ## 为什么必须复用 `canonicalizeProgressRows`
 * `progress` 表的历史包袱是「同一 `(packageId, kpId)` 可能有多条行」（复合索引非
 * 唯一）。裸 `.find()` 取到哪条全看数组顺序，表现为卡片状态在两次刷新之间跳变。
 * `canonicalizeProgressRows` 的 `rowByKey` 恰好就是「同键多条 → 取 `lastStudiedAt`
 * 最新那条」，复用它 = 与掌握率（`computeMasterySummary`）、成就、弱项推荐
 * **同一口径**，不产生第三套去重逻辑。
 *
 * ### 只借第 1 层，不借第 2 层（重要）
 * `canonicalizeProgressRows` 有两层收敛：
 *   - 层 1：`(packageId, kpId)` 建 domain，同键多条取最新 —— 这里要的；
 *   - 层 2：**不同包**下「同一 kpId 且 title 全同」收敛为一个代表键（代表 =
 *     `packageId` 字典序最小），并把所有进度行改挂到代表键上。
 * 层 2 是**统计分母**的规则（重复登记不能让分母翻倍），但卡片问的是「**这个包的
 * 这个知识点**」，跟着收敛的后果是：`(packageId, kpId)` 查不到自己那条行（键被换
 * 成了别的包的代表键）→ 卡片静默显示「未学」。所以本文件传入的 domain 是**由进度
 * 行自身反演的伪 packages**，且**故意不带 `title`**：`sameTitle()` 见到空 title 一律
 * 判「不可比较」→ 永不收敛 → 只剩层 1。这正是卡片需要的粒度。
 */
import type { LearningPackageRecord, MasteryStatus, ProgressRecord } from '@/db'
import { canonicalizeProgressRows, progressKeyOf } from '@core/mastery/masterySummary'
import { canonicalKpId, resolveOwnerPackageId, type OwnerIndex } from '@core/progress/ownerIndex'

/** 卡片的四种视觉状态。`none` = 未学（保持中性底，不做视觉强调） */
export type CardStatus = 'none' | 'learning' | 'review' | 'mastered'

/**
 * 聚合模式 —— **卡片问的问题不一样，答案就该不一样**（见文件头「为什么分两种模式」）。
 *   - `attention`（默认）：知识点级。「这组知识点里有没有该复习的？」——有一个就红。
 *   - `progress`：天 / 单元 / 包级。「这摊内容我推进到哪了？」——只有全都学完才红。
 *
 * 默认值刻意是 `attention`：`topicCardStatusOf`（知识点密集、语义最接近「此刻该学什么」）
 * 走默认分支，行为零变化；没显式传模式的调用方也保持既有语义。
 */
export type CardStatusMode = 'attention' | 'progress'

/** 卡片可能呈现的「主题 / 单元」最小形状（只用 `knowledgePointIds`） */
export interface TopicLike {
  knowledgePointIds?: string[]
}

/** 卡片的「单元」最小形状：知识点 ID 挂在 `topics[].knowledgePointIds` 上 */
export interface UnitLike {
  topics?: TopicLike[]
}

/** 全部合法掌握状态。用于把脏数据归一（`null` / 未知字符串一律当「未学」） */
const VALID_MASTERY_STATUS: readonly MasteryStatus[] = ['未学', '学习中', '已掌握', '需复习']

/**
 * 归一掌握状态：未知/缺失一律降级为「未学」。
 *
 * 为什么要防御：`progress.status` 是历史字段，旧备份或迁移中间态里出现过空串；
 * 一旦让它流进聚合，`状态 === undefined` 的卡片会落进「learning」分支，
 * 把没学过的单元标成「学习中」——错得比不显示更糟。
 */
function normalizeStatus(raw: unknown): MasteryStatus {
  return VALID_MASTERY_STATUS.includes(raw as MasteryStatus) ? (raw as MasteryStatus) : '未学'
}

/**
 * `progress` 模式的聚合：**「推进到哪了」优先于「有没有一个到期」**。
 *
 * 顺序即优先级（**勿调**）：
 *   1. 全是「未学」（含空数组被 `aggregateCardStatus` 提前挡掉）→ `none`
 *   2. 全部「已掌握」                                        → `mastered`
 *   3. **没有「未学」也没有「学习中」，且至少一个「需复习」** → `review`（学完了、整体到期）
 *   4. 其余（掺着「未学」或「学习中」）                      → `learning`
 *
 * 与 `attention` 的唯一区别就是第 3 条：`attention` 只要见到一个「需复习」就红，
 * 而这里要求**「该学的都学过了」才允许红**。理由见文件头「为什么分两种模式」——
 * 一句话：一天/一包是「任务」，一个知识点是「内容」；任务的红应表示「这件事该回头看了」，
 * 不该表示「这件事里有一项到期了」。
 */
function aggregateProgress(list: readonly MasteryStatus[]): CardStatus {
  let allUnlearned = true
  let allMastered = true
  let hasReview = false
  // 「还有没碰/没学完的」——它的存在说明这张卡还处在推进期，不该用红去催
  let hasPending = false

  for (const raw of list) {
    const status = normalizeStatus(raw)
    if (status === '需复习') hasReview = true
    if (status === '未学' || status === '学习中') hasPending = true
    if (status !== '未学') allUnlearned = false
    if (status !== '已掌握') allMastered = false
  }

  if (allUnlearned) return 'none'
  if (allMastered) return 'mastered'
  if (hasReview && !hasPending) return 'review'
  return 'learning'
}

/**
 * 聚合一组知识点状态为卡片状态。
 *
 * `mode` 决定**优先级**（默认 `attention`，与引入 `progress` 之前完全一致）：
 *
 * `attention`（知识点级，`topicCardStatusOf` 用）—— 顺序即优先级（**勿调**）：
 *   1. 空数组 / 全是「未学」        → `none`
 *   2. 任一「需复习」                → `review`（最需要注意力，优先暴露）
 *   3. 全部「已掌握」                → `mastered`
 *   4. 其余（含「已掌握 + 未学」混合）→ `learning`
 *
 * 为什么「需复习」压过「已掌握」：一张卡代表一组知识点，只要有一个该复习了，
 * 整张卡就该把孩子拽回来；反过来「一个已掌握就整卡绿」会把「还有 5 个没学过」
 * 藏起来，是更严重的误导。
 *
 * `progress`（天 / 单元 / 包级，`unitCardStatusOf` 与 `packageCardStatusOf` 用）：
 * 见 `aggregateProgress` —— 只有「该学的都学过了」才允许红。
 *
 * 未知状态先归一为「未学」再参与判定（见 `normalizeStatus`）。
 */
export function aggregateCardStatus(
  statuses: readonly MasteryStatus[],
  mode: CardStatusMode = 'attention'
): CardStatus {
  const list = Array.isArray(statuses) ? statuses : []
  if (list.length === 0) return 'none'
  // 进度模式下「全未学」也要 none，这里提前返回不影响它（两边都以 none 收尾）
  if (mode === 'progress') return aggregateProgress(list)

  let allUnlearned = true
  let allMastered = true

  for (const raw of list) {
    const status = normalizeStatus(raw)
    // 优先级最高的一条：见到「需复习」立刻返回，不必看完后面的
    if (status === '需复习') return 'review'
    if (status !== '未学') allUnlearned = false
    if (status !== '已掌握') allMastered = false
  }

  if (allUnlearned) return 'none'
  if (allMastered) return 'mastered'
  return 'learning'
}

/** 读屏 / 图例用的中文标签（与 `MasteryStatus` 用词一致，不再造新词） */
export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  none: '未学',
  learning: '学习中',
  review: '需复习',
  mastered: '已掌握',
}

/**
 * 角标字形 —— **颜色之外的第二信号**，色弱/灰度打印下靠形状也能分辨。
 *
 * 四个字形刻意两两不同（○ 空心圆 / ◐ 半圆 / ↻ 回转箭头 / ✓ 对勾）：
 * 「学习中」与「需复习」若都用实心点（`●`），色弱用户就只剩颜色一条线索，
 * 而这两态恰恰是最需要区分的（一个在推进、一个在倒退）。
 *
 * `none` 用 `○`：卡片列表里未学占多数，给它一个中性空心圆既是「未开始」的
 * 自然隐喻，也让每张卡的右侧槽位尺寸一致（角标出现/消失不改变布局）。
 */
export const CARD_STATUS_MARK: Record<CardStatus, string> = {
  none: '○',
  learning: '◐',
  review: '↻',
  mastered: '✓',
}

/** `CardStatus` → 卡片上的状态类名（`is-none` / `is-learning` / …） */
export function cardStatusClass(status: CardStatus): string {
  return `is-${status}`
}

/** `(packageId, kpId)` → 该知识点的当前状态 */
type StatusIndex = ReadonlyMap<string, MasteryStatus>

/**
 * 建 `(packageId, kpId) → 状态` 查表。
 *
 * 收敛口径见文件头「只借第 1 层，不借第 2 层」：传入的伪 packages 不带 `title`，
 * 于是 `canonicalizeProgressRows` 的层 2（同 kpId + 同 title 跨包合并）永不触发，
 * `rowByKey` 的键就是原始的 `(packageId, kpId)` 二元组，值是同键最新那条行。
 *
 * 代价：每次调用都会重算一次表。调用方是 `computed`/渲染函数，输入（卡片数 ×
 * 进度行数）在本仓量级（≤ 数百行）下是一次线性遍历，不做缓存——缓存键只能是数组
 * 引用，而 pinia 把数组换成新引用时 WeakMap 会漏判，得不偿失。
 */
function buildStatusIndex(progress: readonly ProgressRecord[]): StatusIndex {
  const index = new Map<string, MasteryStatus>()
  const rows: ProgressRecord[] = []

  for (const row of progress ?? []) {
    if (!row) continue
    // 脏行（缺 packageId / kpId）直接跳过：造不出二元组键，也不可能是任何卡片的进度
    if (typeof row.packageId !== 'string' || row.packageId === '') continue
    if (typeof row.knowledgePointId !== 'string' || row.knowledgePointId === '') continue
    rows.push(row)
  }
  if (rows.length === 0) return index

  // 伪 packages：domain 由进度行自身反演（见文件头），**不带 title** 以关掉层 2 收敛
  const kpIdsByPkg = new Map<string, string[]>()
  for (const row of rows) {
    const list = kpIdsByPkg.get(row.packageId)
    if (!list) {
      kpIdsByPkg.set(row.packageId, [row.knowledgePointId])
      continue
    }
    if (!list.includes(row.knowledgePointId)) list.push(row.knowledgePointId)
  }
  const pseudoPackages = [...kpIdsByPkg].map(([packageId, ids]) => ({
    packageId,
    manifest: {},
    knowledgePoints: ids.map((id) => ({ id })),
    exercises: [],
    units: [],
  })) as unknown as LearningPackageRecord[]

  const { rowByKey } = canonicalizeProgressRows(pseudoPackages, rows)
  for (const [key, row] of rowByKey) index.set(key, normalizeStatus(row.status))
  return index
}

/** 查一个知识点的状态；找不到行 = 没学过 = 「未学」 */
function statusOf(index: StatusIndex, packageId: string, kpId: string): MasteryStatus {
  if (!packageId || !kpId) return '未学'
  return index.get(progressKeyOf({ packageId, knowledgePointId: kpId })) ?? '未学'
}

/**
 * 带归属包解析的状态查表（与 `recordProgress` 写入端**同源**）。
 *
 * 为什么需要：进度行落库的 `packageId` 是**归属包**（见 `ownerIndex.ts`：声明该
 * kpId 的包），但卡片列表拿到的 `packageId` 是「入口包 / sourcePackageId」——
 * 例如每日一练是**自包含包**（`knowledgePoints` 为空），它的单元引用教材单元包的
 * kpId，于是进度被记到教材单元包上，而列表查表若只用每日一练的 id 就**永远查不到**
 * → 做过的单元显示「未学」（无颜色标记）。
 *
 * 解决：每个 kpId 先用 `resolveOwnerPackageId` 解析归属包；解析成功就用归属包查
 * （kpId 一并规范化），失败则回落入口包（保持旧行为，兼容 textbook / term 等
 * `sourcePackageId` 本就等于归属包的情况）。
 *
 * 不传 `ownerIndex` 时退化为 `statusOf`（旧行为，单测可无索引直接喂数据）。
 */
function statusOfOwner(
  index: StatusIndex,
  packageId: string,
  kpId: string,
  ownerIndex?: OwnerIndex | null
): MasteryStatus {
  const owner = ownerIndex ? resolveOwnerPackageId(kpId, packageId, ownerIndex) : null
  const lookupPkg = owner ?? packageId
  const lookupKp = owner ? canonicalKpId(owner, kpId, ownerIndex!) : kpId
  return statusOf(index, lookupPkg, lookupKp)
}

/** 摊平并去重一组 `topic` 的 `knowledgePointIds`（顺序保留，供聚合遍历） */
function collectKpIds(topics: readonly TopicLike[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const topic of topics ?? []) {
    const list = topic?.knowledgePointIds
    if (!Array.isArray(list)) continue
    for (const id of list) {
      if (typeof id !== 'string' || id === '') continue
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

/**
 * 单元卡片状态：把单元下**所有主题**的知识点摊平后聚合。
 *
 * `packageId` 传「入口包 / sourcePackageId」即可；当传入 `ownerIndex` 时，
 * 每个 kpId 会按 `recordProgress` 写入端的同一套**归属包解析**反查真实落库的包，
 * 再用归属包查进度。这样：
 *   - textbook / term 等「sourcePackageId 本就等于归属包」的包：行为与旧版完全一致；
 *   - 每日一练这类**自包含包**（`knowledgePoints` 为空、单元引用教材单元包的 kpId，
 *     进度被记到教材单元包上）：能正确解析到归属包 → 做过的单元不再显示「未学」。
 *
 * 不传 `ownerIndex` 时退化为旧行为（只用 `packageId` 查），单测可无索引直接喂数据。
 * 单元没有任何知识点（空单元 / 数据缺失）→ `none`（不编状态）。
 */
export function unitCardStatusOf(
  unit: UnitLike | null | undefined,
  packageId: string,
  progress: readonly ProgressRecord[],
  ownerIndex?: OwnerIndex | null
): CardStatus {
  const topics = Array.isArray(unit?.topics) ? (unit?.topics as TopicLike[]) : []
  const kpIds = collectKpIds(topics)
  if (kpIds.length === 0) return 'none'

  const index = buildStatusIndex(progress)
  // 单元级 → `progress` 模式：单元是「任务」，问的是推进到哪了，不是「里面有没有一个到期」
  return aggregateCardStatus(
    kpIds.map((kpId) => statusOfOwner(index, packageId, kpId, ownerIndex)),
    'progress'
  )
}

/**
 * 主题卡片状态：只看这个主题自己的知识点。
 *
 * 与 `unitCardStatusOf` 同源：传 `ownerIndex` 时按归属包解析查进度，
 * 不传则只用 `packageId` 查（旧行为）。主题没有知识点 → `none`。
 */
export function topicCardStatusOf(
  topic: TopicLike | null | undefined,
  packageId: string,
  progress: readonly ProgressRecord[],
  ownerIndex?: OwnerIndex | null
): CardStatus {
  const kpIds = collectKpIds(topic ? [topic] : [])
  if (kpIds.length === 0) return 'none'

  const index = buildStatusIndex(progress)
  // 主题级 → 默认 `attention` 模式（知识点密集，语义最接近「此刻该学什么」，见文件头）
  return aggregateCardStatus(
    kpIds.map((kpId) => statusOfOwner(index, packageId, kpId, ownerIndex))
  )
}

/**
 * 学习包卡片状态（每日一练打卡卡片的落点）。
 *
 * 与上面两个不同：这里拿不到包的完整知识点定义（调用处只有 `packageId`），
 * 所以状态集合**只能由该包的进度行反演** —— 没有进度行 → `none`，
 * 这正是「今天还没练」想要的「未学」表现。
 *
 * 同一 `kpId` 的多条行只算一次（走 `buildStatusIndex` 的最新行口径），
 * 否则「练了 3 遍」会被当成 3 个知识点参与聚合。
 */
export function packageCardStatusOf(
  packageId: string,
  progress: readonly ProgressRecord[]
): CardStatus {
  if (!packageId) return 'none'

  const rows = (progress ?? []).filter(
    (row) => row && row.packageId === packageId && typeof row.knowledgePointId === 'string' && row.knowledgePointId !== ''
  )
  if (rows.length === 0) return 'none'

  const index = buildStatusIndex(rows)
  const statuses: MasteryStatus[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.knowledgePointId)) continue
    seen.add(row.knowledgePointId)
    statuses.push(statusOf(index, packageId, row.knowledgePointId))
  }
  // 包级（每日一练一天 / 整包）→ `progress` 模式：
  // 一个 45 天的包有几百个 kp，「全部已掌握」同时成立几乎不可能，用 `attention`
  // 会让它「有进度就变红、几乎永不变绿」，见文件头「为什么分两种模式」。
  return aggregateCardStatus(statuses, 'progress')
}
