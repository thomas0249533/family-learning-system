> ⚠️ **已失效（2026-10-19）**：本文件为早期版本，口径已被 `docs/system_design-v1.3.md` 的 §0（C1–C6）覆盖。仅保留 §5 任务列表 T01–T10 作为细度参考，**任何口径以正文为准**。

# 家庭学习系统 · V1.3 增量设计 + 任务分解（成就系统 P0 + 工程债 E-01~E-03）

> 角色：架构师 高见远（software-architect-2） ｜ 目标工程：`D:\study`
> 输入：`docs/prd-v1.3-achievement.md`（本轮增量 PRD）、`docs/成就方案.txt`（六条不变量 + 伦理红线）、`docs/system_design-v1.2.md`（设计系统 2.0 / token 与门禁）
> 上游契约（**直接引用，不重新推导**）：`docs/mastery-metric-definition.md`（掌握率口径，已定稿）、`docs/kp-id-ownership-english-7.md`（kpId 归属与歧义实证）
> 纪律：**本文只做设计与任务分解，不写业务代码、不改 `src/`、不打包。**

---

## 0. 先摆事实：五条纠偏与三条前置

这一节是整份设计的地基。下面每一条都与"上一版口头需求"不一致，**以此处的裁决为准**。

| # | 结论文 | 证据 | 本设计的处置 |
|---|---|---|---|
| **R1** | `db.progress` 主键是自增 `id`，`[packageId+knowledgePointId]` 只是**普通复合索引** | `src/db/index.ts:89` `Table<ProgressRecord, number>`；`:98` `'++id, [packageId+knowledgePointId], packageId, status'` | **不改主键、不改索引**，只升版本拿 `upgrade()` 钩子（§3.1） |
| **R2** | `recordProgress` **没有 for 循环**，签名单个 KP；多 KP 循环在调用方。`userData.ts:276-278` 的注释已过期 | `src/core/stores/userData.ts:168` | 改造点集中在 `recordProgress` 与 4 个调用方，**不要按"内部循环"去改** |
| **R3** | **禁止按裸 `kpId` 去重**。english-7 有 49 个不同知识点共用 7 个裸 id（`kp-reading-001` 等），裸去重会把 49 塌成 7 | `docs/kp-id-ownership-english-7.md` §2 / §4.2 | 去重键 = **`(归属包 packageId, kpId)`**；`computeMasterySummary` 内部再做"同 kpId 且 title 全同"的副本收敛 |
| **R4** | `resolveOwnerPackage` **严格三分支、零 tie-break**：`\|own\|==0 → null`；`\|own\|>=2 → null`；`\|own\|==1 → 该包`；且**归属包 subject ≠ 入口包 subject → null**。`own` 的定义 = **该包的 `knowledgePoints` 里声明了该 kpId**（不是 units） | `kp-id-ownership` §3：按 knowledgePoints 判定，全库 472 个 kpId 100% 唯一解析 | 见 §3.1.1。**本裁决覆盖** `mastery-metric-definition.md` §3.4 里"title 全同则按 packageType 选代表"的分支（该分支已被撤销），需由该文作者同步回写 |
| **R5** | 掌握率三处口径必须统一为 `computeMasterySummary(packages, progress)`，**两入参**；`Total` 来自 packages，不是 progress | `mastery-metric-definition.md` §3.2 | Home / Parent / Report 三处只调这一个函数；`notStarted` 不再用 `total - progress.length` |

### 三条**强制前置**（不做则归属包解析必错）

| # | 缺陷 | 位置 | 症状 |
|---|---|---|---|
| **D2** | 有 `dependencies` 时**丢弃自己的 units** | `src/core/importer/resolvePackageUnits.ts:22-55`（普通包分支只在 `deps.length===0` 生效） | special / sprint 包既声明了 KP、又有自己的 units，但 `findUnitByKnowledgePoint` 只看 deps → **归属包指向自己时，复习页整条记录消失**（`Review.vue:146-152` 有 `continue`） |
| **D1** | 模拟考把进度写到 `deps[0]` | `src/views/learn/ExamPanel.vue:266-269` `sourcePackageId = deps[0] ?? pkgId`，`:340-351` 用它写进度 | **构建产物** `content/math-4-up-rjb/packages/sprint-math-4-up-final.json`（及同名 zip 条目）的 `manifest.dependencies = [p1,p3,p4,p5]`，而它覆盖的 KP 含 p3/p4/p5 的 id → p3 的 KP 被写成 `(p1, kp-of-p3)`，**包与 KP 不匹配**，复习页查不到。⚠️ 原始源文件 `sprint-math-4-up-final.json` **没有** `dependencies`（构建期注入），排查时不要拿源文件下结论 |
| **D3** | 复习页 kp 标题索引以**裸 kpId** 为键 | `src/views/Review.vue:133-139` `kpTitleMap.set(kp.id, …)` | 跨包同名裸 id 互相覆盖 → 标题串台；且带前缀 id 查不到 → `continue` 丢记录 |

> D2 必须在 D1 之前或同批修：`resolveOwnerPackage` 指到 special 包后，若 D2 未修，`findUnitByKnowledgePoint(specialPkg, kp)` 仍只搜依赖包 → 记录依旧消失。

---

## 1. 方案总览

### 1.1 两条轨道、十项交付

| 轨道 | 交付 | 一句话 |
|---|---|---|
| **A 成就 P0** | A-01 元数据 · A-02 进度 · A-03 结算链路 · A-04 折叠 UI · A-05 三类卡片 · A-06 证据快照 | 28 枚**定义冻结**，只加"可算进度、可折叠界面、实时结算" |
| **B 工程债** | E-01 进度归一化（含 D1/D2/D3） · E-02 题干富文本 · E-03 学习流程 e2e | 掌握率口径统一 + 题干表格可读 + 主流程有回归网 |

### 1.2 与现有架构的关系

| 层 | 新增 | 改造 |
|---|---|---|
| 纯函数（可 node 单测） | `achievementMeta` / `achievementProgress` / `achievementView` / `achievementUiState` / `richText` / `progressIdentity` / `progressMerge` / `masterySummary` / `coalesce` | 无 |
| Pinia store | `stores/achievement.ts` | `stores/userData.ts`（归一化写入 + `ensureLoaded`）、`stores/package.ts`（刷新归属索引） |
| 持久层 | — | `db/index.ts`（v3 + `upgrade()`，**索引一行不改**） |
| 界面 | `components/achievement/AchievementPanel.vue`、`AchievementCard.vue` | `Home.vue`（成就区整体替换 + toast 迁出）、`Parent.vue`（改读 store + 脚注）、`Mistakes.vue`（题干富文本） |
| 装配 | — | `AppShell.vue`（常驻 toast host） |
| 测试 | 6 个纯函数测试 + 1 个 store 测试 + 1 个 fixture 校验 + 1 个 e2e spec | `user-data-store.test.ts`（替身重写）、`playwright.config.ts` |

### 1.3 依赖图（也是任务并行边界）

```
T01 E-01 纯函数 ──> T02 E-01 数据层（含 D2/D1/D3）──> T03 A 纯函数 ──┬─> T04 A store/接线 ──┬─> T06 A 首页 UI ──┐
                                                                  └─> T05 A 折叠态纯函数 ──┘                  ├─> T09 E2E ─> T10 收尾
                                                                                    T04 ──> T07 A 家长端 ─────┘
                                                                                    T04 ──> T08 E-02 富文本 ──┘
```

> **串行铁律**：`QuizEngine.vue` 被 **T08（E-02）** 与 **T09（E-03 选择器/表格断言）** 同时触碰；`ExamPanel.vue` / `Mistakes.vue` 被 **T04（A 接线）** 与 **T08（E-02）** 同时触碰 → 这三对**不得并行**，顺序固定为 `T04 → T08 → T09`。

---

## 2. 轨道 A：成就系统 P0

### 2.1 数据模型（零迁移）

#### 2.1.1 关键决策：元数据**不挂到 `AchievementDef` 上**

PRD §4.1 建议给 `AchievementDef` 加 `source` / `tier`。**本文改为独立静态表 `ACHIEVEMENT_META`（`Record<string, Meta>`）**，理由：

1. 验收 AC-01 要求"28 枚的 `id/title/desc/check()` 与改前快照 diff 为空"。把字段写进数组字面量会让 `achievements.ts` 产生 28×2 行 diff，**用 `git diff` 无法证明"只加了元数据"**；独立表则 `ACHIEVEMENTS` 数组一字不动。
2. `source` / `tier` 是**展示与未来 JSON 包的过滤维度**，不是判定输入；放在独立模块可让 `achievements.ts` 保持"只依赖 db + 统计数据"的最小面。
3. 冻结校验可以直接做：`git diff 99886fe -- src/core/motivation/achievements.ts` 只允许出现 ①`UnlockedRecord.evidence?` ②`syncAchievements` 的可选参数 ③`masteredKpCount` 辅助函数的一行委派（§3.1.5）。

#### 2.1.2 28 枚 `source` / `tier` / `target` / `unit` 静态表

`tier` 由 PRD §4.2 的规则静态派生，但**不做运行时推导**，本表即唯一真相；由测试断言「本表 28 条 = `ACHIEVEMENTS` 28 条（id 集合相等）」「层级分布 = 常见 5 / 进阶 11 / 稀有 9 / 隐藏 3」。

| # | id | cat | source | tier | kind | target | unit |
|---|---|---|---|---|---|---|---|
| 1 | `first-step` | M | core | common | counter | 1 | 个知识点 |
| 2 | `ten-kp` | M | subject | advanced | counter | 10 | 个知识点 |
| 3 | `fifty-kp` | M | subject | rare | counter | 50 | 个知识点 |
| 4 | `hundred-kp` | M | subject | rare | counter | 100 | 个知识点 |
| 5 | `kp-300` | M | subject | rare | counter | 300 | 个知识点 |
| 6 | `subject-master-3` | M | subject | rare | composite | 30 | 个知识点 |
| 7 | `perfect-kp` | M | core | advanced | counter | 10 | 道连对 |
| 8 | `mastery-half` | M | subject | rare | gated | 50 | % |
| 9 | `mistake-first` | G | core | common | counter | 1 | 道错题 |
| 10 | `mistake-cleaner` | G | subject | advanced | counter | 10 | 道错题 |
| 11 | `mistake-cleaner-50` | G | subject | rare | counter | 50 | 道错题 |
| 12 | `comeback` | G | hidden | hidden | — | — | — |
| 13 | `review-20` | G | core | advanced | counter | 20 | 次 |
| 14 | `patience` | G | core | advanced | counter | 30 | 题 |
| 15 | `streak-master` | G | core | advanced | counter | 5 | 道连对 |
| 16 | `streak-3` | B | habit | common | counter | 3 | 天 |
| 17 | `streak-7` | B | habit | advanced | counter | 7 | 天 |
| 18 | `streak-30` | B | habit | rare | counter | 30 | 天 |
| 19 | `streak-60` | B | habit | rare | counter | 60 | 天 |
| 20 | `streak-100` | B | habit | rare | counter | 100 | 天 |
| 21 | `early-bird` | B | hidden | hidden | — | — | — |
| 22 | `night-owl` | B | hidden | hidden | — | — | — |
| 23 | `daily-20` | B | core | advanced | counter | 20 | 题 |
| 24 | `explorer-3` | E | subject | common | counter | 3 | 个学习包 |
| 25 | `explorer-10` | E | subject | advanced | counter | 10 | 个学习包 |
| 26 | `type-collector` | E | subject | advanced | counter | 5 | 种题型 |
| 27 | `term-cross` | E | subject | advanced | counter | 2 | 个学期 |
| 28 | `senior-new` | E | subject | common | binary | 1 | 科 |

汇总：`core 7 · subject 13 · habit 5 · hidden 3`；`common 5 · advanced 11 · rare 9 · hidden 3`。
`source` 归属与 PRD §4.1 的映射表逐条一致；`hidden` 三枚的 `tier` 恒为 `hidden`（不参与 counter）。

#### 2.1.3 `evidence`（A-06）

- `UnlockedRecord` 增加 **可选** 字段 `evidence?: string`（≤40 字，解锁瞬间固化）。旧记录无该字段 → 已获得卡**不渲染证据行**，不补算、不伪造。
- 证据生成是**纯函数** `evidenceOf(id, ctx): string | null`，三套模板：
  - counter：`已掌握 10 个知识点` / `已攻克 10 道错题` / `已连续学习 7 天`
  - composite：`数学 10 · 语文 10 · 英语 10`
  - binary：`首次学习了非数学学科`
- **对 PRD §4.4 示例的一处主动缩水**：PRD 举例"连续学习 7 天（10/12–10/18）"，但项目**没有逐日 streak 历史**（`streak.ts` 只存 `current/longest/lastDate`），无法回溯起止日。不编造日期，只写"已连续学习 7 天"。同理不做"哪 10 个知识点"明细（P1 的成就详情弹层再做）。
- 写入时机：`syncAchievements(ctx, now, { evidence })` 在**落库成功后**才返回 `newlyUnlocked`；`evidence` 只为本次新解锁的 id 生成，已存在记录**绝不覆盖**。

---

### 2.2 进度模块（A-02）

#### 2.2.1 类型与签名

```ts
// src/core/motivation/achievementProgress.ts —— 纯函数，不读 db / 不读 store / 不碰 Date.now()
import type { AchievementContext } from './achievements'

/** 在 AchievementContext 之上补一个"显式时钟"，避免 progressOf 偷偷读系统时间 */
export interface ProgressContext extends AchievementContext {
  nowMs: number
}

export type ProgressKind = 'counter' | 'composite' | 'gated' | 'binary'

export interface AchievementProgress {
  current: number          // 已 clamp 到 [0, target]
  target: number
  unit: string
  kind: ProgressKind
  /** 前置门槛未满足（目前只有 mastery-half）：此时 current 无意义，UI 显示门槛文案 */
  blocked: boolean
  /** 复合进度分项（目前只有 subject-master-3） */
  parts?: Array<{ key: string; label: string; current: number; target: number }>
}

export function progressOf(id: string, ctx: ProgressContext): AchievementProgress | null
```

- **返回 `null` 仅限 3 枚隐藏成就**（`comeback` / `early-bird` / `night-owl`），且**无论是否已解锁**（已解锁也不补显示进度，只显示"隐藏成就已解锁"）。
- **未知 id 返回 `null`**（防御：旧数据里可能有已下架 id）。
- `current` 一律 `Math.min(raw, target)` 且 `Math.max(0, …)`；`raw` 必须有限，`NaN/-Infinity` → 0。
- **进度不落库**：每次渲染现算（千级数据 <5ms）。落库会制造"进度表 / 解锁表 / 真实数据"三份不一致。

#### 2.2.2 分派策略（25 枚可进度化 + 3 枚 null）

实现为 `PROGRESS_SPECS: Record<string, Spec>` 的**声明式常量表**，`progressOf` 只做 `spec.compute(ctx)` + clamp：

| 规格族 | 覆盖 | `compute` 的数据源 |
|---|---|---|
| `masteredKp` | `first-step` `ten-kp` `fifty-kp` `hundred-kp` `kp-300` | `countMasteredKps(progress)`——**与掌握率分子同一函数、同一去重键 `(packageId, kpId)`**（`masterySummary.ts` 导出；summary 调用时额外传 domain 集合以排除孤儿，见 §3.1.6） |
| `masteredBySubject` | `subject-master-3` | 复用 `achievements.ts` 的 `masteredBySubject(ctx)`（改为导出，函数体不动），把三科 `min(c,10)` 求和作为 `current`，`parts` 给三科分项 |
| `bestStreak(correct)` | `perfect-kp` `streak-master` | `max(progress.correctStreak)`（用 `achievements.ts` 同一 helper，避免两套 max） |
| `masteryRate` | `mastery-half` | **与 `check()` 严格同源**：`floor(masteredKpCount(ctx.progress) / totalKpCount(ctx) * 100)`，`blocked = totalKpCount(ctx) < 20`。⚠️ 这里**显式不用** `computeMasterySummary().rate`——因为 `check()` 用的是这两个 helper，用 summary 会让"进度条说 52%"和"没解锁"同时出现。两者差异只可能来自孤儿记录 / 重复副本，属已登记的可接受偏差（§3.1.6） |
| `clearedMistake` | `mistake-first` `mistake-cleaner` `mistake-cleaner-50` | `mistakes.filter(m => m.mastered).length` |
| `reviewCorrect` | `review-20` | `Σ reviewCorrectCount` |
| `maxAnswerCount` | `patience` | `max(correctCount + wrongCount)` |
| `bestStreak(days)` | `streak-3/7/30/60/100` | `max(streak.longest, effectiveCurrent(streak, new Date(ctx.nowMs)))` |
| `dailyPeak` | `daily-20` | `max(dailyStats[].questionCount)` |
| `distinctPackages` | `explorer-3` `explorer-10` | `new Set(progress.map(p => p.packageId)).size` |
| `distinctTypes` | `type-collector` | `attemptedTypes.length` |
| `distinctTerms` | `term-cross` | 有进度的包 → term 集合大小 |
| `nonMathSubject` | `senior-new` | 有无"有进度的包且 subject ≠ math" → 1/0 |

**关键点**：`progressOf` 与 `check()` 必须**读同一个原始量**，否则会出现"进度 100% 但不解锁"。因此规格表里每一行都点名了它复用的 helper：`masteredKp` 用 `countMasteredKps`（与掌握率分子同函数）、`masteryRate` 用 `masteredKpCount`/`totalKpCount`（与 `check` 同函数）、`bestStreak` 用同一个 `max(correctStreak)`。**禁止**在 `achievementProgress.ts` 里重写这些统计式子。

#### 2.2.3 文案模块（同样是纯函数，供 UI 与测试共用）

```ts
export function progressText(p: AchievementProgress | null, opts?: { hasPackages?: boolean }): string
```

按 PRD §5.3 的文案表逐条实现（`c=current, t=target, n=t-c`）：

| 条件 | 文案 |
|---|---|
| `p === null` | `达成后揭晓` |
| `blocked` | `需先有 20 个知识点` |
| `c >= t`（未解锁间隙） | `已达标 · 正在确认` |
| `c === 0 && kind === 'binary'` | `完成一次即可解锁` |
| `c === 0` 且无任何学习包 | `导入学习包后开始探索` |
| `c === 0` | `目标 {t}{unit}` |
| `c/t >= 0.8` | `就快拿到了 · 还差 {n}{unit}` |
| 其余 | `已完成 {c}/{t} · 还差 {n}{unit}` |

量词由 `target unit` 直接给出（不需要另一张量词表）。红线：不出现"抽/概率/稀有/限时"，不做否定式催促。

---

### 2.3 一致性测试设计（A-02 验收的核心）

**命题**：对任意 `ctx` 与 25 枚可进度化成就，
`progress.blocked ? check(ctx) === false : (progress.current >= progress.target) === check(ctx)`。

**怎么避免"空洞"**（这是评审最容易挑战的点）：不能只测"达标/未达标"两组，因为那样写一个恒返回 `target` 的实现也能过。测试矩阵：

1. **四值扫描**：每枚成就至少用 4 组 ctx：`n = 0`、`n = 1`、`n = target-1`、`n = target`，外加 `n = target+1`（**超额**）与 `n = max(1, floor(target/2))`（**中段**）。共 6 组 × 25 枚 = 150 条断言。
2. **构造方式**：`tests/helpers/achievement-fixtures.ts` 导出 `ctxAt(id, n): ProgressContext`——内部用 `switch(id)` 把标量 n 写进对应字段（`progress` 行数、`correctStreak`、`mistakes.length`、`dailyStats[0].questionCount`、`attemptedTypes.slice(0,n)`……）。**同一份 builder 既喂 `progressOf` 也喂 `check`**，杜绝"两套夹具各测各的"。
3. **必须单独列的三类**：
   - `mastery-half`：`total=19 / 20 / 21` × `mastered` 满足/不满足 50% → 断言 `blocked` 与 `check()` 的与关系。
   - `streak-*`：夹具用 `streak:{longest:n, current:0, lastDate:''}` 让 `effectiveCurrent` 恒为 0，使 `check()` 内部读真实 `Date.now()` 也不影响结果（**时钟无关**）；另加一条独立用例（不进一致性矩阵）用 `nowMs` 覆盖 `effectiveCurrent` 分支。
   - 隐藏 3 枚：断言 `progressOf` 返回 `null`，且 `check` 正/负向仍正确。
4. **clamp 断言**：`ctxAt(id, target+1)` 时 `current === target`（不是 `target+1`）。
5. **纯度断言**：同一 ctx 调两次结果 `toEqual`；**禁止** mock `Date.now` 才能通过。

---

### 2.4 状态管理与结算链路（A-03）

#### 2.4.1 store 形态

```ts
// src/core/stores/achievement.ts
interface AchievementState {
  records: UnlockedRecord[]        // 唯一真相（含 evidence）
  ctx: ProgressContext | null      // 最近一次结算的快照（不可变替换）
  settledAt: number
  loading: boolean
  /** 给 AppShell 的 toast 批次；seq 单调递增，供 watch 触发 */
  batch: { seq: number; defs: AchievementDef[] } | null
}

// 对外
ensureLoaded(): Promise<void>          // 幂等，只读 settings 一次
refresh(): Promise<void>               // 强制重读（跨页/导入后用）
settleNow(reason): Promise<Result|null> // 立即结算（boot / exam / import）
schedule(reason): Promise<Result|null>  // 防抖 600ms 结算（作答类）
```

规则：

- **单一数据源**：任何页面展示成就**只读这个 store**，禁止再 `loadUnlocked()`。`Parent.vue:145` 的直读改为 `store.ensureLoaded()`。
- **ctx 组装唯一入口**：store 内部 `buildContext()`，从 `userDataStore`（`ensureLoaded()` 后取 `progress`/`mistakes`）、`packageStore.packages`、`loadDailyStats()`、`loadAttemptedTypes()`、`loadStreak()` 取值，`nowMs = Date.now()`。调用方**不得自行拼 ctx**。
- **先落库后提示**：`syncAchievements` 写 `db.settings` 成功 → 才更新 `records` 与 `ctx` → 才把 `newlyUnlocked` 放进 `batch`。写失败：`console.warn`、不更新、不弹、不写 `settledAt`（下次触发自然重试）。**宁可不弹，不可弹了没存。**
- **失败隔离**：整个 `settle` 包 `try/catch`，绝不向调用方抛（答题主流程不能被成就拖死）。
- **跨页同步**：`Home` / `Parent` 都读 store；`AppShell` 常驻，toast 跨路由不断。

#### 2.4.2 单飞 + 防抖（抽成可单测的纯机制）

新建 `src/core/util/coalesce.ts`：

```ts
export interface CoalescedRunner {
  trigger(): Promise<void>   // 触发一次；返回"观察到本次触发的那一轮"完成
  flush(): Promise<void>     // 跳过防抖立即执行
  readonly pending: boolean
}
export function createCoalescedRunner(opts: {
  run: () => Promise<void>
  delayMs: number
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => number
  clearTimeout?: (h: number) => void
}): CoalescedRunner
```

语义（每条都有测试）：

1. **trailing debounce**：窗口内多次 `trigger` 只执行一次，且执行发生在最后一次触发后 `delayMs`。
2. **单飞**：`run` 执行中再来触发 → 不并发执行；置 `dirty=true`，当前轮结束后**立刻补跑一轮**（保证"最后一题"的证据不被丢）。
3. **同一轮的等待者一起 resolve**，且只 resolve 一次。
4. `run` 抛错 → 该轮 reject 被 store 吞掉（`console.warn`），`pending` 归零，后续触发可重试。

这些语义正是 AC-08（写库失败可补）、AC-09（幂等、不重复弹）的可测载体。

#### 2.4.3 触发点清单（含"与 PRD 不一致"的如实说明）

| # | 位置（改后行号会漂，以函数名定位） | 函数 | 方式 | 备注 |
|---|---|---|---|---|
| 1 | `src/views/Home.vue` `onMounted`（现 432-479） | 启动兜底 | `settleNow('boot')` | 保留现状语义；同时删掉本地 `AchievementToast` 与 `toastRef` |
| 2 | `src/views/learn/TopicDetail.vue:499-538` | `handleAnswer` | `schedule('answer')` | 在 `for` 循环**全部 await 完之后**调；600ms |
| 3 | `src/views/learn/TopicDetail.vue:437-469` | `handleWarmupAnswer` | `schedule('answer')` | 前置热身；600ms |
| 4 | `src/views/learn/ExamPanel.vue:416-424` | `handleFinish` | `settleNow('exam')` | **作答中 `handleAnswer` 绝不调**（AC-06）；交卷后一次结算 |
| 5 | `src/views/Mistakes.vue:351-353` | `markMastered` | `schedule('mistake')` | 600ms |
| 6 | `src/modules/core/VocabDrill.vue:267-279` | `writeProgress` | `schedule('vocab')` | 600ms |
| 7 | `src/views/settings/ImportWizard.vue:137-154`（单包）/ `157-173`（批量） | 导入成功分支 | `settleNow('import')` + `packageStore.loadPackages()` + `refreshKpOwnerIndex()` | 影响 `distinctPackages` / `totalKp` / 学科覆盖 |

**两处如实上报**：

- PRD §6.1 的第 4、5 项把 `Review.vue` 列为触发点，但 `Review.vue` **没有任何作答提交**（`Review.vue:175-177` 只是跳转到 TopicDetail），真正的复习作答发生在 `TopicDetail.handleAnswer`。**不为凑数加假触发点**；本设计把 #5 合并进 #2/#3，PRD 的 7 项在实现上是 7 个**真实**调用点（上表）。
- `Report.vue` 只读 `generateReportData()`，不触发结算（符合 PRD"路由切换不触发"）。

#### 2.4.4 toast 从 Home 迁到 AppShell

| 项 | 设计 |
|---|---|
| 位置 | `src/components/AppShell.vue` 根节点内、`.app-shell` 之后：`<AchievementToast ref="toastRef" />`（组件内部 `teleport to="body"`，位置不影响层叠） |
| 触发 | `watch(() => store.batch, (b) => b && toastRef.value?.enqueue(b.defs))`（`batch.seq` 保证同一批只播一次） |
| Home 清理 | 删除 `:182` 的 `<AchievementToast ref="toastRef" />`、`:212` import、`:226` ref、`:468-470` 的 enqueue |
| 合并播放（≥4 枚） | 在 `AchievementToast.vue` 内部：`enqueue(defs)` 时若 `defs.length >= 4`，入队一个**合并条目**（`{ merged: true, count, icon: 最高层级那枚.icon }`），卡片显示「🎉 解锁 4 枚新成就」+ 最高层级图标；全部记录仍进入「已获得」区 |
| **必须加的防御** | `.ach-toast { pointer-events: none; }`。现状它是 `position:fixed; z-index:10000`，会**截获点击**——e2e 里正好覆盖在题干预选项上，会造成随机失败 |
| 层级 | 合并条目的"最高层级"取 `ACHIEVEMENT_META[id].tier` 的序：rare > advanced > common > hidden |

#### 2.4.5 幂等（AC-09）

`syncAchievements` 本身已幂等（已存在 id 不重复写、`unlockedAt` 保留）。本轮补两条：

- `saveUnlocked` 前先比对：`unlockedRecords.length === saved.length && 无新增` → **不写库**（避免每次答题都写 settings）。
- `batch` 只在 `newlyUnlocked.length > 0` 时生成；连续 3 次同一 ctx 结算 → 0 条提示（测试覆盖）。

---

### 2.5 折叠 UI（A-04 / A-05）

#### 2.5.1 组件结构：不新建 `ui/` 基元

| 组件 | 位置 | 职责 | 复用现有基元 |
|---|---|---|---|
| `AchievementPanel.vue` | `src/components/achievement/` | 总览条 + 两个区 + 8 个组 + 全展开/全收起按钮 | `SectionTitle`（区标题）、`AppBadge`（计数）、`ProgressBar`（总进度条） |
| `AchievementCard.vue` | 同上 | 三类卡（已获得 / 待解锁 / 隐藏） | `ProgressBar`（卡内细条）、`AppBadge`（层级角标） |
| `EmptyState` | `src/components/ui/` | 0 枚解锁引导、无学习包 | 直接复用 |

**为什么不进 `ui/`**：`ui/` 的 8 个基元是**领域无关**的通用件（`system_design-v1.2.md` §4），成就卡依赖 `AchievementDef` 与进度模型，属领域组件。放 `components/achievement/` 既保持 `ui/` 语义纯净，又让 `Home.vue` 只留一行 `<AchievementPanel />`（Home 现在已 1062 行）。

#### 2.5.2 折叠状态：`localStorage` + 纯函数

**对 PRD §5.2 的两处修正**（会在 §7 待裁决里再提一次）：

1. PRD 写"持久化到 `db.settings` key `achievementUi`"。**本文改为 `localStorage`**（key `fls:achievementUi`，与既有 `fls:theme` 同族），理由：
   - 折叠是**纯 UI 态**，不该进 `settings`——`exportService.ts:100-118` 的整库备份会把 `settings` 全量导出，UI 偏好会污染备份并在另一台机器上覆盖对方偏好。
   - `localStorage` 是**同步**读，首帧即正确；`db.settings` 是异步，必然出现"先默认态、后跳变"，PRD 自己也承认要"先渲染默认态，读到后再应用"。
2. PRD 的 key 表 `earned / pending / grp:M / grp:G / grp:B / grp:E` **表达不了"同一组在两个区状态不同"**（已获得区默认收起、待解锁区默认展开）。改为**按区分组**的 key：`earned` / `pending` / `earned:M`…`earned:E` / `pending:M`…`pending:E`。

```ts
// src/core/motivation/achievementUiState.ts —— 纯函数，Storage 通过参数注入（node 可测）
export type SectionKey = 'earned' | 'pending'
export type GroupKey = `${SectionKey}:${AchievementCategory}`
export type CollapseKey = SectionKey | GroupKey

export interface AchievementUiState { v: 1; collapsed: CollapseKey[] }

export const UI_STORAGE_KEY = 'fls:achievementUi'
export const DEFAULT_COLLAPSED: CollapseKey[] = ['earned', 'earned:M', 'earned:G', 'earned:B', 'earned:E']

export function parseUiState(raw: unknown): AchievementUiState      // 容错：非对象/版本不符/未知 key → 丢弃该 key
export function isCollapsed(s: AchievementUiState, k: CollapseKey): boolean
export function toggle(s: AchievementUiState, k: CollapseKey): AchievementUiState   // 纯，返回新对象
export function expandAll(): AchievementUiState
export function collapseAll(): AchievementUiState
export function allExpanded(s: AchievementUiState, keys: CollapseKey[]): boolean
export function loadUiState(storage: Pick<Storage,'getItem'> | null): AchievementUiState
export function saveUiState(storage: Pick<Storage,'setItem'> | null, s: AchievementUiState): void
```

- 默认态：`collapsed = DEFAULT_COLLAPSED` → **已获得区收起、待解锁区展开**（满足裁决 2）。
- 一键按钮文案：`allExpanded(state, ALL_KEYS) ? '全部收起' : '全部展开'`。
- 解析失败/结构不合法 → 静默降级为默认态，不阻塞渲染。
- **不做**"解锁时自动展开已获得区"（避免页面跳动，PRD §5.2 最后一行）。

#### 2.5.3 信息架构与排序

```
我的成就                                         [12 / 28]
总进度条 ████████░░░░░░  43%              [全部展开]
▸ 已获得 (12)          ← 默认收起
   ▸ 精熟目标 4 枚
▾ 待解锁 (16)          ← 默认展开
   ▾ 精熟目标 4 枚未得
      [卡片] [卡片] [卡片] [卡片]
   ▾ 探索 5 枚未得     ← 按完成度降序
```

- 每枚成就**只出现一次**：已解锁 → 已获得区；否则 → 待解锁区。
- 组内排序（`buildAchievementView` 内做，纯函数）：待解锁按 `current/target` **降序**；不可进度化（隐藏）排最后；同分按 `order ?? 999`、再按 `id`。已获得按 `unlockedAt` 降序（`''` 排最后），再按 `id`。
- 某组在该区 0 枚 → 不渲染该组（避免空组头）。
- 区头计数 = 该区枚数；组头计数 = 组内该区枚数（已获得区不显示 `/总数`）。

#### 2.5.4 视图模型（让 UI 变薄、让规则可测）

```ts
// src/core/motivation/achievementView.ts
export interface AchievementCardVM {
  id: string
  revealed: boolean                 // false = 隐藏未解锁：不得带 title/desc/icon/def
  title: string                     // revealed=false 时为 '？？？'
  desc: string                      // revealed=false 时为 '达成后揭晓'
  icon: string                      // revealed=false 时为 '🔒'
  category: AchievementCategory
  tier: Tier | null                 // revealed=false 时为 null
  unlocked: boolean
  unlockedAt: string
  evidence: string
  chainLabel: string                // '精熟之链 2/5'
  nextRing: { icon: string; title: string } | null
  progress: AchievementProgress | null
  progressText: string
}
export function buildAchievementView(input: {
  ctx: ProgressContext | null
  records: UnlockedRecord[]
  collapsed: AchievementUiState
  hasPackages: boolean
}): { total: number; unlocked: number; sections: SectionVM[] }
```

**隐藏成就防泄底**在 VM 层落实（不是 CSS 层）：`revealed === false` 时**不把 `AchievementDef` 放进 VM**，`title/desc/icon` 全是占位字面量。测试直接 `expect(JSON.stringify(vm)).not.toContain('越挫越勇')`。

#### 2.5.5 a11y 与动效

| 项 | 规格 |
|---|---|
| 区头/组头 | 原生 `<button type="button">` + `:aria-expanded="!collapsed"` + `:aria-controls="panelId"`；**不自写 keydown**（Enter/Space 由原生提供） |
| 面板 | `<div :id="panelId" role="region" :aria-labelledby="headId" v-show="!collapsed">` |
| 焦点 | 复用全局 `:focus-visible` 规则（`components.scss` 的 `--focus-ring`），不新增 |
| 卡片 | `role="listitem"`，`aria-label="<title>，<progressText>"`，图标 `aria-hidden="true"` |
| 动效 | **主动降级**：折叠不做过场动画（`display:none` 与 `max-height` 过渡互斥，要动画必须 JS 量高度，收益不抵风险），只做箭头 90° 旋转 + `--duration-fast`；`prefers-reduced-motion: reduce` 下箭头也不转 |
| 颜色 | 只用 `--{tone}-text` 作文字色；层级靠**边框粗细 + 星标数量 + `-soft` 底色**（非颜色单一编码） |

> 对 PRD §5.2「展开/收起 ≤120ms + opacity/max-height 过渡」的偏离已在 §7 报备。

---

### 2.6 隐藏、空态、全收集（A-05）

| 场景 | 规则 |
|---|---|
| 隐藏未解锁 | `title='？？？'`、`desc='达成后揭晓'`、`icon='🔒'`、**无进度区**；VM 内不存在真实 def（源码级不泄底） |
| 隐藏已解锁 | 正常卡 + `secret` 角标"隐藏成就已解锁"；**不补显示进度** |
| 0 枚解锁 | 不渲染「已获得」区；总览条下一行：`还没有徽章。掌握第一个知识点，就能拿到第 1 枚。`；「待解锁」照常展开 |
| 28 / 28 | 总览文案 `28 / 28 · 全部收集完成`；已获得区**强制展开**、隐藏待解锁区、隐藏一键按钮；**不加动画、不新增视觉**（"毕业"画面留 P1，按裁决 5） |
| 无学习包 | `explorer-*` 显示 `导入学习包后开始探索`（只改文案，不加跳转按钮） |
| `ctx` 未就绪 | 卡片照常渲染标题/描述；进度区显示占位（不显示 `0/10`，避免误报"你什么都没做"） |

---

### 2.7 成就连带影响（裁决 C：口径变更后变难还是变易）

`check()` 一律不改，但它们的**输入口径**会因 E-01 变化。逐条结论：

| 成就 | 依赖 | 方向 | 说明 |
|---|---|---|---|
| `first-step` `ten-kp` `fifty-kp` `hundred-kp` `kp-300` | `masteredKpCount` | **变难（延后）** | 多条重复行合并成 1 条；分子不再虚高。这正是 PRD §7.1 的修复目标 |
| `mastery-half` | `mastered / totalKp` | **变难（延后）** | 同上去重；且 `totalKp` 改为 `computeMasterySummary().total`（副本收敛后可能**变小**，两股力量方向相反，净效果以实测为准） |
| `perfect-kp` `streak-master` | `max(correctStreak)` | **变难（延后）** | 连对被劈到两条记录后各自都到不了 3/5/10；合并取"最新那条"的连对（不求和、不取 max），所以数值只会**回到真实值**，不会凭空变大 |
| `patience` | `max(correct+wrong)` | **变难（延后）** | 同上，计数合并后两条变一条，单条最大值下降 |
| `review-20` | `Σ reviewCorrectCount`（错题，不涉及 progress） | **不变** | E-01 不碰 mistakes |
| `mistake-*` `comeback` | mistakes / progress.wrongCount | `comeback` **可能延后** | wrongCount 求和 → 更容易 ≥3，方向**变易**；但 status 取最新那条 → 可能不再是"已掌握"，**变难**。净效果以实测为准，**必须在 QA 报告里单列这一条** |
| `daily-20` `early-bird` `night-owl` | dailyStats | **不变** | 与 progress 无关 |
| `streak-3/7/30/60/100` | `bestStreak(streak)` | **不变** | 独立 settings |
| `explorer-3` `explorer-10` | `distinctPackageCount(progress.packageId)` | **变易（提前）** | 归一化后 `packageId` = 归属**单元包**。以前从学期包进入，3 个不同 KP 都记在 `term-*` 下 → 只算 1 个包；现在算 N 个。**这是本轮最容易"意外提前解锁"的一枚**，需在验收时人为造三包数据核对 |
| `term-cross` | `studiedTerms`（有进度的包的 term） | **基本不变 / 略变易** | 单元包的 term 与学期包一致（up/down）；只有"跨学期聚合包"被拆成单元包时才会**变易**（2 个单元包分属上下册即可解锁，而旧口径可能只有 1 个聚合包） |
| `senior-new` | `studiedSubjects`（有进度的包的 subject） | **基本不变** | 归属包 subject 与入口包 subject 相同才保留（R4 的 subject 分支），跨学科包才可能变 |
| `type-collector` | attemptedTypes | **不变** | 与 progress 无关 |

**不变量（必须写进代码注释与 AC）**：`syncAchievements` 只增不减。口径变严只会让**新判定**延后，**已解锁的 28 枚记录绝不回收**（`achievements.ts:470-495` 的既定语义）。AC-E1-6 的"解锁 id 集合不变"由"迁移只动 `progress` 表、不动 `settings.achievements`"结构性保证。

---

## 3. 轨道 B：工程债

### 3.1 E-01：进度记录归一化

#### 3.1.1 归属包规则（严格三分支，零 tie-break）

```ts
// src/core/progress/progressIdentity.ts —— 纯函数，packages 由调用方注入
export interface OwnerResolution {
  packageId: string          // 归一化后的归属包
  knowledgePointId: string   // 归一化后的 kpId（= 归属包 knowledgePoints 里的原值）
  resolved: boolean          // false = 无法归属，两个字段保持入参原值
}

export function resolveOwnerPackage(
  packages: LearningPackageRecord[],
  entryPackageId: string,
  kpId: string,
): { pkg: LearningPackageRecord; canonicalId: string } | null
```

规则（**逐字实现，不做任何补充推断**）：

1. `own = packages.filter(p => p.knowledgePoints?.some(k => k.id === kpId))`——**按精确 id 比**，不看 units、**不 stripPrefix**（strip 会导致 english-7 的 49 个知识点串成 7 个）。
2. `own.length === 0` → 返回 `null`。
3. `own.length >= 2` → 返回 `null`（歧义即不动，**不做 title 比较、不按 packageType 选代表**）。
4. `own.length === 1` → 候选即该包；再查 **subject 闸门**：**两侧 subject 都非空且不相等** → 返回 `null`（任一侧缺失即跳过闸门，不把 `undefined !== 'math'` 误判成"跨学科"——聚合包历史上曾缺 `subject`，实测构建产物已补全为 `math`，但不依赖这一点）。
5. 通过 → `{ pkg: candidate, canonicalId: kpId }`。

`resolveProgressTarget(packages, entryPackageId, kpId): { packageId, knowledgePointId }`：
- 命中 → `{ candidate.packageId, kpId }`
- 未命中（0 / ≥2 / subject 不符）→ `{ entryPackageId, kpId }`（**保留原记录**，不改写、不合并）

> **为什么这样"保守"是对的**：归错的代价（把 A 知识点的掌握度算到 B 上）远大于"少合并一条"。全库实测按 knowledgePoints 判定 100% 唯一解析（`kp-id-ownership` §3），所以保守分支在生产数据里几乎不会触发；它只为"用户手工导入的裸 JSON"兜底。

#### 3.1.2 归属索引（缓存，避免每次作答都读 packages）

```ts
// src/core/progress/kpOwnerIndex.ts
let cache: { packages: LearningPackageRecord[]; byKpId: Map<string, LearningPackageRecord[]> } | null = null
export function setKpOwnerIndex(packages: LearningPackageRecord[]): void
export async function ensureKpOwnerIndex(): Promise<void>   // 空则从 db.packages.toArray() 建一次
export function resolveProgressTarget(entryPackageId: string, kpId: string): { packageId: string; knowledgePointId: string }
```

- 刷新点：`packageStore.loadPackages()` 末尾（一处即可覆盖所有进入学习页的路径）+ `ImportWizard` 成功回调。
- 冷启动兜底：`ensureKpOwnerIndex()` 在 `recordProgress` 里 `await` 一次（只在首次真正读库）。
- **`byKpId` 存数组而不是单值**：这样 `own.length >= 2` 的歧义判断在 O(1) 里成立，不需要每次都扫全部包。

#### 3.1.3 写入端改造（治未来）

| 文件 | 改动 |
|---|---|
| `src/core/stores/userData.ts:168-271` | `recordProgress` 开头：`await ensureKpOwnerIndex()` → `const target = resolveProgressTarget(packageId, knowledgePointId)`；后续**全部改用 `target.packageId` / `target.knowledgePointId`**（查询键、新记录字段、`existing.packageId`）。**索引名与查询写法不变**（仍是 `where('[packageId+knowledgePointId]')`），只是入参换成归一化后的值 |
| `src/views/learn/ExamPanel.vue:266-269` | 删掉 `sourcePackageId`（`deps[0]`），改传 `props.pkg.packageId`；归属由 `recordProgress` 统一解析（D1） |
| `src/views/learn/ExamPanel.vue:340-351` | `recordProgress(props.pkg.packageId, kpId, …)`；`addMistake` 的 `packageId` 也用 `resolveProgressTarget(...).packageId`（错题的打包归属要与进度一致，否则家长端学科分布对不上） |
| `src/views/learn/TopicDetail.vue:446-457 / 512-523` | 两个 `recordProgress` 调用保留（`ownerPackageIdOf` 可以留着做 `addMistake` 的包，但**不再是唯一真相**）；不加新逻辑，靠 store 归一化 |
| `src/modules/core/VocabDrill.vue:273-275` | 不改调用（归一化在 store 内）；但要验证单词 id 是否在 `knowledgePoints` 里——不在则走 `resolved:false` 分支，保持原行为 |
| `src/core/importer/resolvePackageUnits.ts:22-55`（**D2，强制前置**） | 普通包分支改为「先放自己的 units，再放 deps 的 units，按 `unit.id` 去重」；`isAggregate` 改为 `deps.length > 0` 但 `units` 不再被丢弃 |

> **`recordProgress` 的新签名不变**：`(packageId, kpId, isCorrect, opts)`。归一化是内部行为，4 个调用方不需要改参数语义（只需 ExamPanel 改掉 `deps[0]`）。

#### 3.1.4 `version(3).upgrade()` 迁移算法

**版本声明（`stores` 与 v2 逐字节相同，索引一行不改）**：

```ts
this.version(2).stores({ /* 原样保留，不要动 */ })
this.version(3)
  .stores({
    packages: 'packageId, manifest.subject, manifest.grade',
    progress: '++id, [packageId+knowledgePointId], packageId, status',
    mistakes: '++id, packageId, exerciseId, mastered',
    settings: 'key',
    examSessions: '++id, packageId, status, startedAt',
  })
  .upgrade(async (tx) => { await migrateProgressV3(tx) })
```

**跳版路径**：Dexie 对 v1 库升到 v3 时，按 v3 声明的 schema 建缺失表（`examSessions` 创建），然后**只执行 v3 的 `upgrade()`**（v2 没有 upgrade 钩子）。因此 v1/v2 → v3 是同一条路径，无需分支。

**算法（两阶段，纯计算 + 哑 IO）**：

```
async function migrateProgressV3(tx) {
  // ---- 阶段 1：纯计算（唯一可挽救的失败面）----
  let plans
  try {
    const packages = await tx.table('packages').toArray()
    const rows     = await tx.table('progress').toArray()
    plans = planProgressMerge(rows, packages)      // 纯函数，见下
  } catch (e) {
    console.warn('[migrate v3] 合并计划构建失败，本次不合并（数据保持原样）', e)
    return                                          // 版本号照常升到 3，不阻塞启动
  }

  // ---- 阶段 2：哑 IO（只 put/delete，无业务逻辑、不解析、不校验）----
  for (const p of plans) {
    await tx.table('progress').put(p.merged)        // merged 含保留行的 id
    for (const id of p.dropIds) await tx.table('progress').delete(id)
    // 注意：put 必须在 delete 之前（先写后删），且在同一个 versionchange 事务内
  }
}
```

**`planProgressMerge(rows, packages)`（纯函数，单独可测）**：

```
1. ownerIndex = 按 knowledgePoints 建 kpId → packages[]
2. 对每条 row：
     target = resolveProgressTarget(ownerIndex, row.packageId, row.knowledgePointId)
     if (!target.resolved) key = `${row.packageId}\u0000${row.knowledgePointId}`   // 原样保留
     else                  key = `${target.packageId}\u0000${target.knowledgePointId}`
3. 按 key 分组
4. 每组：
     if (group.length === 1 && target.resolved === false) → 不产生 plan（零写入）
     if (group.length === 1 && target.resolved === true)  → plan: 只改 packageId/knowledgePointId，其余字段原样
     else                                                 → mergeProgressGroup(group)  （见 §3.1.5）
5. 返回 plans: Array<{ merged: ProgressRecord & { id: number }, dropIds: number[] }>
```

**必须遵守的三条**：

1. **只用 `tx.table(...)`**，绝不 `db.progress.*`（Dexie 在 versionchange 事务里访问 `db` 会死锁）。
2. 迁移**不触碰** `settings`（成就记录、streak、dailyStats 全部原样）。
3. `merged` 必须带 `id`（保留组内**最小 id**，让主键尽量不漂）。

#### 3.1.5 合并字段映射（逐字段，代码级）

设组内按 **`lastStudiedAt` 降序、`id` 降序**排序后，`latest = group[0]`，`maxObs = argmax(bkt.observed)`（并列取 `latest` 一方）。

| 字段 | 取值 | 理由 |
|---|---|---|
| `id` | `min(group.id)` | 主键稳定，减少外部引用漂移 |
| `packageId` | `target.packageId` | 归属包（保证 `findUnitByKnowledgePoint` 能查到） |
| `knowledgePointId` | `target.knowledgePointId` | 归属包声明的原值 |
| `correctCount` | `Σ` | 可累加语义 |
| `wrongCount` | `Σ` | 同上 |
| `studySeconds` | `Σ` | 每次作答固定 +30，与包无关 → **守恒断言的锚** |
| `lastStudiedAt` | `max`（字符串比较即可，ISO 定长） | 时间取最新 |
| `correctStreak` | `latest.correctStreak` | **禁止求和、禁止取 max**——两者都会制造"从未发生过的连对"→ 假"已掌握"（`masteryRules.ts:27` 的 `masteredCorrectStreak=3`） |
| `wrongStreak` | `latest.wrongStreak` | 同上 |
| `status` | `latest.status` | **与连对同源**；禁止"取最优等级"（会掩盖最近一次答错） |
| `fsrs` | 取 `fsrs.last_review` 最新那张卡的**整卡** | 两张卡不可合并。**必丢另一张的复习历史**——这是本迁移唯一不可挽回的信息损失，须在 CHANGELOG 与代码注释中明写 |
| `reviewStage` / `nextReviewAt` / `lastReviewAt` | 与最终选定的 `fsrs` **同源**（同一条记录的三个字段） | 否则与 `Home.vue:294` 的 `dueCount`、`reportGenerator.ts:125-132` 的 due 统计矛盾 |
| `bkt` | `maxObs.bkt`（整块） | 证据最多的一条；**禁止平均**（会造出从未观测到的中间态） |
| `masteryProbability` | `maxObs.bkt.pKnown`（无 bkt 时退回 `maxObs.masteryProbability`） | 与 `bkt.pKnown` 必须一致 |
| 其余未知字段 | `latest` 的值 | 前向兼容 |

**边界**：
- 某条 `lastStudiedAt` 非法/空 → 视为最旧。
- 全组都没有 `fsrs` → 保留 `undefined`（不要造空卡）。
- `bkt.observed` 缺失 → 记 0（老数据）。

**守恒断言（迁移正确性的唯一硬指标）**：
```
Σ correctCount  前 === Σ correctCount  后
Σ wrongCount    前 === Σ wrongCount    后
Σ studySeconds  前 === Σ studySeconds  后
rowCount 后 <= rowCount 前（且被删除的行数 === 组内多余行数）
已解锁成就 id 集合前后完全相同（结构性保证：迁移不碰 settings）
```

#### 3.1.6 掌握率口径（`computeMasterySummary`）

**完全按 `docs/mastery-metric-definition.md` §3.2/§3.3/§5 实现**，本文只补两处落地细节：

```ts
// src/core/mastery/masterySummary.ts
export function progressKeyOf(r: { packageId: string; knowledgePointId: string }): string
/** 同一去重键、只计一次；传 domain 时排除孤儿（不传 = 全量，供成就使用） */
export function countMasteredKps(progress: ProgressRecord[], domainKeys?: ReadonlySet<string>): number
export function computeMasterySummary(
  packages: LearningPackageRecord[],
  progress: ProgressRecord[],
): MasterySummary   // total / mastered / learning / needReview / unlearned / notStarted / rate / orphanRecordCount
```

**AC-E1-3 的精确措辞**（避免"同函数但不同值"被误判为违约）：三处掌握率与成就的 `masteredKp` 必须调用**同一个** `countMasteredKps`（同一去重键 `(packageId, kpId)`）；`computeMasterySummary` 额外传入 domain 以排除孤儿记录，因此在**存在孤儿**时数值可能比成就侧少。测试断言：**无孤儿时 `countMasteredKps(p) === computeMasterySummary(pkgs, p).mastered`**；有孤儿时 `computeMasterySummary(...).mastered + orphanRecordCount` 与成就侧自洽。

1. **两层收敛在函数内部完成**：先建 `domainKeys = Set<`${pkgId}\u0000${kpId}`>`，再把「不同 packageId 下同一 kpId 且 **title 字符串完全相同**」的 key 合并为 1 个。**不做 stripPrefix**（`kp-id-ownership` §4.2 的反例）。
2. **`progress.packageId` 必须是归属包**（即 `recordProgress` 归一化后的值；无法归一化的保留原值 → 可能落进 `orphanRecordCount`）。

三处调用点：

| 位置 | 改动 |
|---|---|
| `Home.vue:283-292` | `const s = computeMasterySummary(packageStore.packages, userDataStore.progress)`；`total/mastered/learning` 取 `s`；`:414` 的 `Math.max(...,0)` 删除，改用 `s.notStarted` |
| `Parent.vue:183-212` | 总览取 `s`；`subjectStats`（215-245）改为按 `(packageId, kpId)` 的**归属包 subject** 分桶，不再用 `kpToSubject` 裸 id 反查 |
| `reportGenerator.ts:53-98` | `totalKnowledgePoints/mastered/notStarted/masteryRate` 全部取 `s`；`subjectBreakdown` 同步改归属包 subject |

> **成就侧同源**：`achievements.ts:62` 的 `masteredKpCount` 改为一行委派 `(p) => countMasteredKps(p)`。**check 函数体一字不动**（仍写 `masteredKpCount(ctx.progress)`），因此冻结快照 diff 为空。`masteredBySubject` 保持原实现（按行 + `packages[].subject`），仅在归一化后行已唯一的前置下成立，不额外改动以缩小冻结面。

#### 3.1.7 两处复合索引查询点

| 位置 | 现状 | 改法 |
|---|---|---|
| `userData.ts:174-176` | `where('[packageId+knowledgePointId]').equals([packageId, kpId])` | 入参换成 `resolveProgressTarget(...)` 的结果；**索引名不变** |
| `exportService.ts:139-142` | 导入时同样按二元组去重 | ① 先对**备份内的每一行**做 `resolveProgressTarget`；② **在备份内部先按新 key 合并**（老备份里同一 KP 可能有 2-3 行，逐行 upsert 会互相覆盖、丢计数）；③ 再对库做 upsert（保持"备份覆盖库"的既有语义，不求和） |

**幂等要求**：`导出 → 清空 → 导入 → 再导出`，两次导出的 `progress` 数组（忽略 `id`）必须相等。

#### 3.1.8 测试替身重写（必须，否则假绿）

`tests/user-data-store.test.ts:50-65` 的 `where(field)` 对**未知索引名会静默 `rows.find(r => r[field] === value)` → undefined**，看起来"没找到旧记录"→ 每次都新建行 → 测试全绿但生产重复。改法：

```ts
where(field: string) {
  if (field === '[packageId+knowledgePointId]') { /* 现有 tuple 逻辑 */ }
  else if (field === 'packageId' || field === 'status' || field === 'id') { /* 单列 */ }
  else throw new Error(`[fake] 未实现的索引：${field}（禁止静默 fallback）`)
  …
}
```

并新增用例：

1. **跨 3 个包同一 KP** → `progress` 只有 1 行，`correctCount === 3`，`packageId === 归属包`。
2. **sprint 包写 p3 的 KP** → 行落在 p3，`findUnitByKnowledgePoint(p3, kp)` 能命中（用真实 `resolvePackageUnits` 的纯逻辑跑）。
3. **归属 0 / ≥2 / subject 不符** → 三条都**不合并**（写入值与入参一致）。
4. **老数据（`reviewStage` 无 `fsrs`）** 仍能接管（现有用例保留）。

#### 3.1.9 迁移测试（诚实的边界）

项目**没有 `fake-indexeddb`**（`node_modules` 实测不存在），`vitest` 是 `node` 环境、无 `indexedDB` → **`.upgrade()` 本身无法自动化**。因此分两层：

| 层 | 手段 | 覆盖 |
|---|---|---|
| **纯函数层（自动）** | `tests/progress-merge.test.ts` | `planProgressMerge` 全部字段规则 + 守恒 + 幂等（把输出再喂一次 → 0 条 plan）+ 组内边界 |
| **升级层（手工，写进 QA 清单）** | 用 v1.9.0 产物造 v2 库 → 导入 3 包 → 打同一 KP 的习惯数据 → 换本版打开 | 跳版路径、`examSessions` 自动建表、`version` 升到 3、行数/守恒/成就 id 不变 |

手工步骤写进 `docs/qa-v1.3-manual.md`（由 QA 落盘，不由本文件落盘）。

---

### 3.2 E-02：题干最小 Markdown 子集

#### 3.2.1 现状与爆炸半径

`QuizEngine.vue:318-324` 与 `ExamPanel.vue:284-290` **各抄了一份** `renderQuestionText`：

```ts
escaped.replace(/\\n/g, '<br>')   // ← 匹配的是"字面反斜杠 + n"，不是真实换行
```

实测：`'a\nb'.replace(/\\n/g,'<br>') === 'a\nb'`（真实换行原样不动），而 `.question-text`（`QuizEngine.vue:832-838`）**没有任何 `white-space: pre*`** → 真实换行被 HTML 塌掉。全库 1954 道题源里 **166 道（8.5%）题干含真实换行**（single 47 / blank 82 / judge 18 / multiple 19；`english-7-up-rjb` 149 道、`math-4-up-rjb` 17 道），英语阅读理解的"引导语 + 短文 + 题目"现在全挤成一行。

#### 3.2.2 API

```ts
// src/core/text/richText.ts —— 纯字符串进出，不碰 DOM，无第三方依赖
export type RichTextBlock =
  | { kind: 'text'; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][]; align: Array<'left'|'center'|'right'|null> }

/** 解析：只识别"连续 ≥2 行且第 2 行是分隔行"的管道表格，其余原样成块 */
export function parseRichText(src: string): RichTextBlock[]

/** 渲染：转义 + 真实换行 → <br> + 表格 → <table>；输出可直接进 v-html */
export function renderRichText(src: string): string
```

#### 3.2.3 最小子集边界（明确**不支持**什么）

| 支持 | 不支持（显式拒绝，遇到也不解析） |
|---|---|
| 真实换行 `\n` / `\r\n` → `<br>` | 图片 `![]()`、链接 `[]()`、裸 URL 自动链接 |
| GFM 管道表格（首行表头 + 分隔行 + N 行数据） | HTML 标签（一律转义成文本） |
| 单元格内 `\|` 转义为 `|` | 加粗/斜体/删除线、行内代码、代码块 |
| 表头右侧的 `:---:` / `:---` / `---:` 读取为对齐（输出 class，不用 inline style） | 列表、引用块、标题、脚注、任务列表 |
| 列数固定为表头列数：**少补空 `<td>`，多截断**（避免错位） | 合并单元格、多行表头 |
| 旧兜底：字面 `\n`（反斜杠+n）仍转 `<br>` | 任何形式的 HTML 白名单 |

**表格识别规则（避免误伤题干里的 `|`）**：

1. 至少 2 行；
2. 第 2 行必须满足 `/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/`；
3. 第 1、2 行去首尾 `|` 后 split 出的列数**必须相等**；
4. 任何一条不满足 → **整块按文本渲染**（绝不半解析）。

#### 3.2.4 XSS 策略

`renderRichText` 是**唯一的拼接点**，规则：

1. 所有文本先 `escapeHtml`（`& < > " '` 全转）；
2. 输出里**只出现**我们自己拼的固定标签名与固定 class，**没有任何来自输入的名字**（不做属性插值、不拼接 `href/src/style`）；
3. 表头/单元格内容只走文本通道，`<img src=x onerror=alert(1)>` 会变成 `&lt;img …&gt;`（AC-E2-3）；
4. 单元测试断言：输出中 `onerror`/`<script`/`javascript:` 的出现次数为 0（它们只会以转义形式出现）。

#### 3.2.5 接入点（3 处，缺一不可）

| 文件 | 改动 | 原因 |
|---|---|---|
| `src/modules/core/QuizEngine.vue:318-324` | 删本地函数，改 `import { renderRichText } from '@core/text/richText'`；模板两处 `v-html="renderQuestionText(...)"` 改为 `renderRichText(...)` | 练习页（含多陈述判断题的 `.judge-stmt__text`） |
| `src/views/learn/ExamPanel.vue:283-290` | 同上（它现在是**第二份抄写**） | 模拟考页 |
| `src/views/Mistakes.vue:100` / `:148` | `{{ m.questionData?.question }}` → `<h3 class="question-text" v-html="renderRichText(m.questionData?.question)">`，并补 `:deep()` 表格样式 | 错题本。**PRD AC-E2-1 明确要求三处**，而错题本现在是纯文本插值 → 表格必然不显示 |

**样式（两处 `.question-text` + 错题本）**：

```scss
:deep(.rt-table-wrap) { max-width: 100%; overflow-x: auto; margin: 8px 0; }
:deep(.rt-table) {
  border-collapse: collapse;
  min-width: 320px;
  th, td { border: 1px solid var(--border-color); padding: 6px 10px; text-align: left; }
  th { background: var(--bg-color-hover); font-weight: 700; }
}
:deep(.rt-align-center) { text-align: center; }
:deep(.rt-align-right) { text-align: right; }
```

- 窄屏：**滚动容器在表格外**（`.rt-table-wrap`），页面本身不出现横向滚动（AC-E2-5）。
- 零硬编码色值：只用 `--border-color` / `--bg-color-hover`（AC-E2-6）。

#### 3.2.6 4 处重复 `renderMarkdown` 是否收敛

`ChineseText.vue:30` / `ChineseWriting.vue:26` / `EnglishGrammar.vue:26` / `EnglishWriting.vue:26` 是**完全相同的 3 行**（`new MarkdownIt({ html:false, linkify:true, breaks:true })`）。

**结论：收敛，但独立成一个改动**（`src/core/text/markdown.ts` 导出单例 `renderMarkdownContent(s)`）。理由：4 份逐字重复的 MarkdownIt 实例既浪费内存，也意味着"以后改一个安全选项要改 4 处"。风险控制：**不改任何选项**（保持 `html:false, linkify:true, breaks:true`），改完用两个真实 `kp.content` 做快照断言（HTML 字符串完全相等）。

**明确不做**：不用 `markdown-it` 替换 `renderRichText`。用整库解析 1954 道题干会改变现有一切题干语义（自动链接、`*` 强调、`#` 标题），风险不可控，且 PRD §2.2 已把"完整 Markdown 渲染题干"列为非目标。

---

### 3.3 E-03：学习流程 e2e

#### 3.3.1 fixture：代码生成，不提交二进制 zip

| 项 | 设计 |
|---|---|
| 位置 | `tests/fixtures/miniSet.ts`（**TS 模块，不是 zip 文件**） |
| 内容 | 2 个包：① `unit-mini-math`（普通包，1 unit / 1 topic / 6 题：3 single + 1 blank + 1 judge（**含 3 列表格**）+ 1 essay）；② `sprint-mini-math`（`manifest.examMode: true`，3 题） |
| 体量 | 6 题 × ~300 字 ≈ 8KB，远低于 50KB |
| 生成 | `buildMiniSetZip(): Uint8Array`，用**已有依赖** `fflate.zipSync`，现场打 `manifest.json` + `packages/*.json`；`setInputFiles({ name, mimeType, buffer })` **内存投递**，不落临时文件、不进 git |
| 为什么不提交二进制 | 二进制在 diff 里不可审、改了没人知道；代码生成可读、可被单测直接校验 |
| 为什么新建而不是用 `content/math-4-up-rjb-set.lpkgset.zip` | 裁决 4：真实包 12 个、体积大、内容会变、断言脆；真实上传**路径**已由 `setInputFiles` 覆盖（走 `n-upload` 的 `custom-request`，等价于用户点上传） |
| 校验 | `tests/fixtures/miniSet.test.ts`：对两个包跑 `normalizePackage()` → `errors.length === 0`；断言 `packageId`/`units`/`topics`/`exercises` 计数；**这样 fixture 坏了在 1 秒内红，而不是 90 秒后 e2e 超时** |

`manifest.json`（包集合）字段按 `unzipPackageSet` 的要求：顶层 `manifest.json` + `packages/` 下任意 `.json`；`importOrder` 可选（不写也能导，`sortByImportOrder` 会原序）。

#### 3.3.2 7 个节点与断言清单

| # | 节点 | 操作 | 断言（可见性，不用 `waitForTimeout`） |
|---|---|---|---|
| 1 | 导入 | `/settings/import` → `input.n-upload-file-input[accept=".zip,.lpkgset"]` `setInputFiles` | 弹窗标题 `✅ 批量导入成功` 可见；`n-tag` 文本含 `unit-mini-math`；`已成功导入 2 个学习包` |
| 2 | 选包 | `/learn` | 卡片文本 `迷你数学（e2e）` 可见 |
| 3 | 选单元 | 点卡片 | 单元卡 `第 1 单元 · 数与运算` 可见 |
| 4 | 选专题 | 点单元 | 专题 `数与运算专题` 可见 |
| 5 | 做题 + 判题 | 点 `.opt-item`（第一个正确项）→ `.quiz-actions button` | `.feedback-box.correct` 可见；含 `正确答案`；含 `解析` 文本 |
| 6 | 表格题干 + 收尾 | 翻到判断题 | `table.rt-table` 可见；`thead th` 数量 = 3；`tbody tr` 数量 = 3；`.judge-stmt` 数量 = 2；再走完剩余题 → `🏁 完成练习` |
| 7 | 模拟考 | `/learn/sprint-mini-math` → `[data-testid="exam-start"]` → 3 题 → `提交试卷` | `.exam-result` 可见；`正确率` 文本存在；`本次答对` 数值存在 |

**选择器策略**：

- 优先用**稳定 DOM class**（已核实存在）：`.judge-stmt` / `.quiz-actions button` / `.feedback-box.correct|.wrong` / `.fill-blank input` / `.essay-group textarea` / `.opt-item` / `.n-upload-file-input`。
- **只新增 3 个 `data-testid`**（其余不加，避免污染模板）：`exam-start`（`ExamPanel.vue` 的开始按钮）、`exam-submit`（交卷按钮所在 `AppButton`）、`achievement-panel`（首页成就区根节点，供未来断言）。理由：这三处的"文本"会随文案微调，且没有独占 class。
- 禁止 `waitForTimeout`；统一 `expect(locator).toBeVisible({ timeout })`。

#### 3.3.3 清理与隔离

- Playwright 默认 **每个 test 一个全新 context**（非持久化），IndexedDB 天然隔离 → 首选 **单文件 2 个 test，互不依赖**（`flow` + `table-render`）。
- 额外保险（AC-E3-5）：`resetDb(page)` 工具：`page.goto('/')` → `await page.evaluate(() => { const db = window.db; db.close(); return new Promise(r => { const q = indexedDB.deleteDatabase('FamilyLearningDB'); q.onsuccess = q.onerror = q.onblocked = () => r(null) }) })` → `page.reload()`。只在 `beforeEach` 用一次，作为"上一轮没清干净"的兜底。
- 失败留证：`playwright.config.ts` 的 `use` 增加 `trace: 'retain-on-failure'`、`screenshot: 'only-on-failure'`。

#### 3.3.4 规避 `predev` 覆写生成物

现状 `webServer.command = 'npm run dev -- --port 5173 --strictPort'` → npm 会先跑 `predev` → `tokens:build` **无条件重写** `theme.scss` / `palette.ts`。若开发者手里有未提交的 token 改动，会被"悄悄洗掉"（`system_design-v1.2.md` §2.3 明确这是自愈而非检测）。

改法（一行）：

```ts
webServer: { command: 'npx vite --port 5173 --strictPort', … }
```

- 绕过 npm lifecycle → **不触发 `predev`**；
- 生成物本来已入库（v1.2 §2.4），dev server 读到的就是仓库里的版本；
- 检测职责仍由门禁的 `tokens:check`（排在 `tokens:build` 之前）承担，**不弱化**任何一道门。

---

## 4. 文件清单

### 4.1 新增

| 文件 | 轨道 | 内容 |
|---|---|---|
| `src/core/motivation/achievementMeta.ts` | A | 28 枚 `source/tier/kind/target/unit` 静态表 + `tierRank` |
| `src/core/motivation/achievementProgress.ts` | A | `ProgressContext` / `AchievementProgress` / `PROGRESS_SPECS` / `progressOf` / `progressText` / `evidenceOf` |
| `src/core/motivation/achievementView.ts` | A | `buildAchievementView`（分区/分组/排序/文案/隐藏防泄底） |
| `src/core/motivation/achievementUiState.ts` | A | 折叠态 schema + 纯函数 + localStorage 读写（Storage 注入） |
| `src/core/util/coalesce.ts` | A | `createCoalescedRunner`（防抖 + 单飞 + dirty 补跑） |
| `src/core/stores/achievement.ts` | A | 成就 store（records/ctx/batch + settleNow/schedule + 失败隔离） |
| `src/components/achievement/AchievementPanel.vue` | A | 总览条 + 两区 + 8 组 + 一键按钮 |
| `src/components/achievement/AchievementCard.vue` | A | 三类卡 |
| `src/core/progress/progressIdentity.ts` | B/E-01 | `resolveOwnerPackage` / `resolveProgressTarget`（纯） |
| `src/core/progress/kpOwnerIndex.ts` | B/E-01 | 归属索引缓存（含 `ensureKpOwnerIndex`） |
| `src/core/progress/progressMerge.ts` | B/E-01 | `planProgressMerge` / `mergeProgressGroup`（纯） |
| `src/core/mastery/masterySummary.ts` | B/E-01 | `computeMasterySummary` / `countMasteredKps` |
| `src/core/text/richText.ts` | B/E-02 | `parseRichText` / `renderRichText` / `escapeHtml` |
| `src/core/text/markdown.ts` | B/E-02 | 单例 `renderMarkdownContent`（4 处收敛） |
| `tests/achievement-meta.test.ts` | A | 28 条齐全 / tier 分布 / source 分布 / 与 `ACHIEVEMENTS` id 集合相等 |
| `tests/achievement-progress.test.ts` | A | 一致性矩阵（6 组 × 25 枚）+ clamp + 隐藏 null + mastery-half 门槛 + streak 时钟无关 |
| `tests/achievement-view.test.ts` | A | 分区/排序/文案表/隐藏不泄底/空态/全收集 |
| `tests/achievement-ui-state.test.ts` | A | parse/toggle/expandAll/allExpanded/容错 |
| `tests/coalesce.test.ts` | A | 防抖合并 / 单飞 / dirty 补跑 / 抛错后可重试 |
| `tests/achievement-store.test.ts` | A | 先落库后提示 / 写失败不弹 / 幂等 / 跨页 records 一致 |
| `tests/achievements-freeze.test.ts` | A | 28 枚 id/title/desc/`check.toString()` 快照（改前录制的字面量） |
| `tests/progress-identity.test.ts` | B/E-01 | 三分支 / subject 闸门 / 歧义不合并 / 精确 id 不 strip |
| `tests/progress-merge.test.ts` | B/E-01 | 字段规则 / 守恒 / 幂等 / 边界 |
| `tests/mastery-summary.test.ts` | B/E-01 | I1–I8 + english-7 49 夹具 + 副本收敛 + 孤儿 + >100% 复现 |
| `tests/rich-text.test.ts` | B/E-02 | 换行 / 表格 / `\|` / 空单元格 / 缺分隔行 / XSS / 单列 / 多列表格混排 |
| `tests/fixtures/miniSet.ts` | B/E-03 | `MINI_SET` + `buildMiniSetZip()` |
| `tests/fixtures/miniSet.test.ts` | B/E-03 | `normalizePackage` 零 error + 计数断言 |
| `tests/e2e/learning-flow.spec.ts` | B/E-03 | 7 节点 |

### 4.2 修改

| 文件 | 轨道 | 改什么 |
|---|---|---|
| `src/core/motivation/achievements.ts` | **A + B（共享）** | ① `UnlockedRecord.evidence?`；② `syncAchievements` 第三参 `{ evidence? }` + "无新增不写库"；③ `masteredKpCount` 一行委派 `countMasteredKps`。**28 条定义行零 diff** |
| `src/core/stores/userData.ts` | **A + B（共享）** | ① `recordProgress` 归一化写入；② 新增 `ensureLoaded()`（成就 store 用）。过期注释 `:276-278` 顺手改掉 |
| `src/core/stores/package.ts` | B（服务 A） | `loadPackages()` 末尾 `setKpOwnerIndex(packages)` |
| `src/db/index.ts` | B | `version(3).stores(同 v2) + .upgrade()`（**索引一行不改**） |
| `src/core/export/exportService.ts` | B | 导入：行级归一化 + 备份内先合并 + 再 upsert |
| `src/core/importer/resolvePackageUnits.ts` | B（**D2 前置**） | 有 deps 时**不再丢弃自己的 units** |
| `src/core/report/reportGenerator.ts` | B | 三处统计改 `computeMasterySummary`；`notStarted` 非负 |
| `src/views/Home.vue` | **A + B（共享）** | ① 成就区整体换 `<AchievementPanel>`（删本地 toast / 分组 / 卡片 / 相关 scss）；② `stats` 改 summary；③ `onMounted` 调 `settleNow('boot')` |
| `src/views/Parent.vue` | **A + B（共享）** | ① 成就概览改读 store；② 总览/学科分布改 summary；③ 统计区块底部**常驻一行脚注** `统计口径：同一知识点跨学习包只计一次。`（裁决 3） |
| `src/views/learn/TopicDetail.vue` | A | 两个作答函数末尾 `schedule('answer')` |
| `src/views/learn/ExamPanel.vue` | **A + B（共享）** | ① 删 `sourcePackageId`（D1），改传本包；② `handleFinish` 里 `settleNow('exam')`；③ `renderQuestionText` → `renderRichText`；④ `data-testid="exam-start"` |
| `src/views/Mistakes.vue` | **A + B（共享）** | ① `markMastered` 后 `schedule('mistake')`；② 题干两处改 `v-html="renderRichText"` + 表格样式 |
| `src/modules/core/VocabDrill.vue` | A | `writeProgress` 成功后 `schedule('vocab')` |
| `src/views/settings/ImportWizard.vue` | A | 两条成功分支：`loadPackages()` + `refreshKpOwnerIndex()` + `settleNow('import')` |
| `src/components/AppShell.vue` | A | 挂 `<AchievementToast>`（单实例，跨路由） |
| `src/components/AchievementToast.vue` | A | ① `pointer-events:none`；② ≥4 枚合并成一条 |
| `src/modules/core/QuizEngine.vue` | **A + B（共享）** | ① `renderQuestionText` → `renderRichText`；②（E-03）表格样式 `:deep`。**A 侧不改它**——列入共享是因为 E-02/E-03 都碰它，串行执行 |
| `src/modules/chinese/ChineseText.vue` · `ChineseWriting.vue` · `english/EnglishGrammar.vue` · `EnglishWriting.vue` | B | 改用 `renderMarkdownContent`（4 处相同 3 行） |
| `tests/user-data-store.test.ts` | B | 替身 `where()` 未知索引**抛错**；新增 4 组归一化用例 |
| `playwright.config.ts` | B | `webServer.command` 改 `npx vite …`；补 `trace` / `screenshot` |
| `package.json` | — | **不改**（不新增依赖、不新增脚本） |

> **同时被 A 与 B 触碰（必须串行）**：`achievements.ts`、`userData.ts`、`Home.vue`、`Parent.vue`、`ExamPanel.vue`、`Mistakes.vue`、`QuizEngine.vue`。

---

## 5. 任务列表（按实现顺序）

> 每项都能独立跑门禁后 commit。**"串行"= 同一文件不得并行**。

### T01 · E-01 纯函数地基
- **触碰**：`progressIdentity.ts`(新) · `progressMerge.ts`(新) · `masterySummary.ts`(新) · `tests/progress-identity.test.ts` · `tests/progress-merge.test.ts` · `tests/mastery-summary.test.ts`
- **依赖**：无
- **要点**：三分支归属（**零 tie-break**、精确 id、subject 闸门）；合并字段表逐字段；守恒 + 幂等；`computeMasterySummary` 的 I1–I8
- **验收**：`npx vitest run tests/progress-*.test.ts tests/mastery-summary.test.ts` 全绿；english-7 夹具 `total === 49`

### T02 · E-01 数据层（含 D2 / D1 / D3）
- **触碰**：`db/index.ts` · `userData.ts` · `package.ts` · `exportService.ts` · `resolvePackageUnits.ts` · `ExamPanel.vue`(D1) · `achievements.ts`(masteredKpCount 委派) · `tests/user-data-store.test.ts`
- **依赖**：T01
- **要点**：`version(3)` + `upgrade()`（**只用 `tx.table`**，纯计算阶段 try/catch，IO 阶段哑写入）；`recordProgress` 入参归一化；`resolvePackageUnits` 先 own 后 deps；`exportService` 备份内先合并
- **验收**：同 KP 跨 3 包 → 1 行 + `correctCount=3`；替身未知索引抛错；导出→清空→导入→再导出 幂等
- **串行**：`ExamPanel.vue` 此后归 T04/T08 排队

### T03 · A 纯函数（元数据 / 进度 / 视图 / 证据）
- **触碰**：`achievementMeta.ts`(新) · `achievementProgress.ts`(新) · `achievementView.ts`(新) · `achievements.ts`(evidence + sync 第三参) · 5 个 A 测试
- **依赖**：T02（`masteredKpCount` 同源）
- **要点**：一致性矩阵 150 条；`blocked` 语义；隐藏返回 null；`evidenceOf` 不编造日期；冻结快照测试
- **验收**：`achievements-freeze.test.ts` 绿；`git diff 99886fe -- src/core/motivation/achievements.ts` 的定义行**为空**

### T04 · A 结算链路（store + 触发点 + toast host）
- **触碰**：`coalesce.ts`(新) · `stores/achievement.ts`(新) · `AppShell.vue` · `AchievementToast.vue` · `Home.vue`(只删 toast + 加 boot settle) · `TopicDetail.vue` · `ExamPanel.vue` · `Mistakes.vue` · `VocabDrill.vue` · `ImportWizard.vue` · `tests/coalesce.test.ts` · `tests/achievement-store.test.ts`
- **依赖**：T03
- **要点**：先落库后提示；写失败不弹不更新；单飞 + dirty 补跑；toast `pointer-events:none`；≥4 合并；考试中不结算
- **验收**：AC-05/06/07/08/09

### T05 · A 折叠态纯函数（可与 T04 并行）
- **触碰**：`achievementUiState.ts`(新) · `tests/achievement-ui-state.test.ts`
- **依赖**：T03
- **要点**：按区分组 key（`earned:M` 等）；默认 `earned` 收起、`pending` 展开；解析容错
- **验收**：默认态断言 + 一键全展/全收 + 非法输入降级

### T06 · A 首页 UI（成就区重写）
- **触碰**：`AchievementPanel.vue`(新) · `AchievementCard.vue`(新) · `Home.vue` ·（可选）`docs/screenshots/home-*`
- **依赖**：T04、T05
- **要点**：两区两级折叠、三类卡、文案表、空态/全收集、a11y（原生 button + aria）、零新增色值、`stats` 改 summary、删 `Math.max(...,0)`
- **验收**：AC-10~AC-17；`check:hex` / `check:text-color` / `lint:styles` 绿

### T07 · A 家长端（可与 T06 并行）
- **触碰**：`Parent.vue` · `reportGenerator.ts`（若 T02 未做，归此处）
- **依赖**：T04
- **要点**：成就概览改读 store（只读）；总览/学科分布改 summary；**常驻脚注**
- **验收**：家长端与首页的 `mastered/total/rate` 完全一致（同一函数同输入）

### T08 · E-02 富文本
- **触碰**：`richText.ts`(新) · `markdown.ts`(新) · `QuizEngine.vue` · `ExamPanel.vue` · `Mistakes.vue` · 4 个模块 `.vue` · `tests/rich-text.test.ts`
- **依赖**：T04（`ExamPanel/Mistakes` 先完成 A 侧改动，避免并行冲突）
- **要点**：真实换行 + GFM 表格；`\|` 转义；空单元格；缺分隔行降级；XSS；窄屏横向滚动；4 处 md 收敛（零行为变化）
- **验收**：AC-E2-1~E2-8

### T09 · E-03 学习流程 e2e
- **触碰**：`tests/fixtures/miniSet.ts`(新) · `tests/fixtures/miniSet.test.ts`(新) · `tests/e2e/learning-flow.spec.ts`(新) · `playwright.config.ts` · `ExamPanel.vue`(testid)
- **依赖**：T06、T08
- **要点**：内存 zip + `setInputFiles` 走真实 `n-upload`；7 节点；2 个 test 各自 context；`npx vite` 绕开 `predev`
- **验收**：冷启动通过、单条 ≤90s、既有 3 个 spec 不回归

### T10 · 收尾（门禁 + 视觉基线 + 手工迁移清单）
- **触碰**：`docs/screenshots/{home,parent}-{light,dark}.png` · `docs/qa-v1.3-manual.md`(新，由 QA 落)
- **依赖**：T06、T07、T09
- **门禁（顺序铁律）**：
  ```
  npm run tokens:check && npm run tokens:build && npx vue-tsc --noEmit && npm test
    && npm run lint:styles && npm run check:hex && npm run check:text-color && npx playwright test
  ```
- **基线变更登记**：`home-*`（成就区结构变化）、`parent-*`（脚注 + 数字口径）属**预期变更**，需在提交说明里写清，不许当回归处理

---

## 6. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | **用户数据迁移不可逆**：`upgrade()` 删行后无法回滚 | **高** | ① 合并规则全部为"可累加字段求和 + 时序字段取最新"，不做任何推测性填充；② 守恒断言（`Σ counts` / `Σ studySeconds`）作为迁移前置测试；③ **升级前自动备份**：`upgrade()` 第一行把 `progress` 原样写进 `settings` key `progressBackupV2`（一次性，成功后不再写）——代价是一次性存储翻倍；④ 迁移失败仅"不合并"，不删任何行 |
| 2 | **掌握率数值变化**（用户可见） | 中 | 三处统一后 `rate` 可能显著下降（english-7 分母 7→49）。按裁决 3：家长端**常驻一行脚注**；提交说明与 QA 报告标注"口径修正，非退步"；视觉基线单独登记 |
| 3 | **成就提前/延后解锁** | 中 | ① `explorer-3/10` 会**提前**（归属包化后 distinct 包变多）——验收时用三包数据显式核对；② `ten-kp` 系列**延后**（去重）；③ **不变量：已解锁绝不回收**（`syncAchievements` 只增不减）；④ `comeback` 方向不确定（bad 方向相反），QA 单列 |
| 4 | **e2e 抢 dev server / `predev` 覆写生成物** | 中 | `webServer.command` 改 `npx vite`（绕 npm lifecycle）；`reuseExistingServer: true` 保留；生成物检测仍靠 `tokens:check` |
| 5 | **`pretest` 自愈掩盖生成物漂移** | 中 | 门禁顺序把 `tokens:check` 放在 `tokens:build` **之前**；e2e 不再触发 `predev`；`tests/tokens-generation.test.ts` 保留（直连 vitest 时会红） |
| 6 | **`upgrade()` 无自动化覆盖** | **高** | 项目无 `fake-indexeddb`（实测 `node_modules` 不存在），node 环境无 `indexedDB` → 只能"纯函数全覆盖 + 手工迁移演练"。**必须**在 T10 交付 `docs/qa-v1.3-manual.md` 的三步演练清单；**不新增依赖**是硬约束，不申请破例 |
| 7 | **toast 遮挡导致 e2e 随机失败** | 中 | `.ach-toast { pointer-events: none }`；e2e 断言用 `toBeVisible` 而非点击 toast |
| 8 | **合并后 `Review.vue` 仍有记录丢失** | 中 | 归属包解析 + D2 修复 + D3 的 id/短 id 双索引；验收用例：sprint 包作答后，`/review` 能看到该 KP |
| 9 | **冻结被破坏**（有人顺手改 `desc` 文案） | 中 | `achievements-freeze.test.ts` 快照 + `git diff 99886fe` 人工检查点写进 T03 验收 |
| 10 | **`daily-20` 的 60 天窗口**：未解锁时峰值会滚出 | 低 | PRD 已接受；`progressOf` 与 `check` 同源（都读 `dailyStats`），一致性不受影响 |
| 11 | **`fsrs` 合并没有可合并语义** | 中 | 明确写进代码注释与 CHANGELOG："同一 KP 被拆成多张卡时，迁移只保留复习时间最新的一张，另一张的历史丢失"；不做事后补救（补救只能靠猜） |

---

## 7. 待裁决事项（≤3，只列真正需要主理人/用户拍板的）

| # | 事项 | 我的默认 | 影响面 |
|---|---|---|---|
| **1** | **折叠态持久化载体**：PRD §5.2 写 `db.settings['achievementUi']`，本文改 `localStorage['fls:achievementUi']`（理由：UI 偏好不进整库备份、同步读无首帧跳变，见 §2.5.2） | 用 localStorage | 若坚持 `db.settings`，需接受"先默认态后跳变"，并把这一个 key 加入 `exportService` 的排除名单 |
| **2** | **折叠动画**：PRD §5.2 要求 `max-height` + `opacity` 过渡；本文**主动降级为无过场**（`display:none` 与 height 过渡互斥，且 reduced-motion 下本来要关） | 不做高度动画，只转箭头 | 若必须保留动画，需要 JS 量 `scrollHeight`（约 20 行，且要处理"折叠中被再次点击"） |
| **3** | **`resolveOwnerPackage` 的 `\|own\| >= 2` 分支**：team-lead 最新指令是"一律 null"，而 `docs/mastery-metric-definition.md` §3.4 仍写着"title 全同则按 packageType 选代表"。**两份文档现在互相矛盾** | 按最新指令：**一律 null** | 需该文作者把 §3.4 与 §7.1 同步改成"一律 null"，否则实现者会照旧文档写出 tie-break。当前生产数据命中率 0（472 个 kpId 全部唯一声明），风险仅在裸 JSON 导入路径 |

---

## 8. 与 PRD 的主动偏离清单（如实上报，便于评审）

| # | PRD | 本文 | 理由 |
|---|---|---|---|
| 1 | `source`/`tier` 写进 `AchievementDef` | 独立 `ACHIEVEMENT_META` 表 | 保 `ACHIEVEMENTS` 数组零 diff，冻结可证（§2.1.1） |
| 2 | 折叠态存 `db.settings` | `localStorage` | §2.5.2 + §7-1 |
| 3 | 折叠 key 为 `grp:M` | `earned:M` / `pending:M` | 同一组在两区默认态不同，`grp:M` 表达不了 |
| 4 | 折叠有 `max-height` 过渡 | 无过场动画 | §7-2 |
| 5 | 证据含日期区间（"10/12–10/18"） | 只写"已连续学习 7 天" | 项目没有逐日 streak 历史，不编造（§2.1.3） |
| 6 | 7 个触发点含 `Review.vue` | `Review.vue` 无提交点，合并进 TopicDetail | 不造会计数的假事件（§2.4.3） |
| 7 | e2e 用 `tests/fixtures/mini-package.json` | 用代码生成 `.lpkgset` zip（内存投递） | 走真实 `n-upload` 路径（裁决 4），且二进制不入库（§3.3.1） |
| 8 | PRD 未提 D1/D2/D3 | 列为 E-01 **强制前置** | 不修则归属包解析后记录仍从复习页消失（§0） |

---

*本文件由架构师高见远产出，仅含设计与任务清单，不含实现代码。*
