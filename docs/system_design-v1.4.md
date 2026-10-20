# 系统设计 · V1.4 成就 P2

> 上游：`docs/prd-v1.4-achievement-p2.md`（评审通过，D1~D5 已裁决）。
> 前置：`docs/system_design-v1.3.md`（v3 迁移、写入端收口、成就链路）。
> 本文只做**架构决策与落点**，不含实现代码；所有函数签名是契约，不是已有代码。
> 状态：待实施。批次拆分见 §12。

---

## 0. 一句话

V1.4 = **给数据加一层 `profileId` + 给导入换一套合并语义**。
前者是结构变更（v4 迁移），后者是行为变更（并集而非覆盖）。
其余四项（JSON 包 / 家庭墙 / 打印 / 重复印记）都是这两件事之上的展示层。

按危险度排序，本版真正会伤到用户的只有两处：

1. **v4 迁移漏搬一个 settings 键** → 某个孩子的打卡天数/徽章突然归零，且**没有任何报错**。
2. **导入沿用 `db.settings.put()` 整键覆盖** → 目标设备的成就墙被抹掉（PRD §1 第 4 条）。

本文 §4 与 §6 分别对这两处给出结构性防线（"键清单穷举 + 未知键兜底"、"两阶段 plan/apply + 单调不减不变量"）。

---

## 1. 裁决承接

PRD 的五条产品裁决直接约束架构，逐条落到设计约束：

| PRD 裁决 | 架构约束 | 落点 |
|---|---|---|
| **D1** 跨设备 = 备份导出 + 导入，导入不得减少已有进度 | 合并必须是**纯函数**且满足 `merge(local, remote) ⊇ local`；导入必须单事务 | §6 |
| **D2** 只做 `manual-check` / `counter` | 规则求值器是**有限 switch**，不接受字符串求值；`metric` 走枚举 | §8.4 |
| **D3** 档案上限 4 | `profiles.list.length <= 4` 是**数据不变量**，写入端强制；UI 只是显示 | §3.2 |
| **D4** 打印按小组分页 | 分页算法吃 `CATEGORY_ORDER`，不按枚数硬切 | §8.5 |
| **D5** 两台设备的档案是同一个孩子 | **`profileId` 导入时不重写**；无档案映射步骤；无设备标识 | §3.2、§7 |

### 1.1 架构级新增裁决（A1~A6）

| # | 裁决 | 为什么 |
|---|---|---|
| **A1** | `profileId` **不由 UI 传参**，只由一个门面读"当前档案" | 一旦允许 `recordProgress(pid, …)` 这种签名，30 个调用点里漏掉一个就写错档案，而且统计层看不出来（数字都对）。收口到门面后，调用方**拿不到**"不传 profile"的可能性 |
| **A2** | **删掉** `progress` 的 `[packageId+knowledgePointId]` 旧复合索引 | 保留旧索引 = 旧查询继续能跑 = 跨档案串数据且不报错。删掉后 `where('[packageId+knowledgePointId]')` 直接抛，逼所有调用点改（全库只有 2 处，改动成本低，收益是"漏改必炸"） |
| **A3** | `profiles` 存 **settings 一个键**，不建新表 | 它是 4 条元数据，不是需要索引查询的实体。建表要动 schema、要写迁移、要处理"表为空"的边界；存键则 v4 的 schema 变更只剩 `progress`/`mistakes`/`examSessions` 三个表加列 |
| **A4** | 合并走 **plan（纯函数）→ apply（哑 IO）** 两阶段 | 预览与执行**必须同源**。分开写两套必然漂移：预览说"新增 12 枚"、执行却写进 15 枚，家长会认为软件在骗人 |
| **A5** | 未知 settings 键在 v4 迁移里 **默认按 per-profile 搬**，并列入白名单豁免表 | 迁移的失败模式是"漏搬"，不是"多搬"。默认搬错档案的代价（老二看到老大的设置）远小于默认不搬（数据消失）。豁免表是全局键的**显式清单**，新增全局键必须来登记（§3.3 有测试锁住） |
| **A6** | 不引入 `profileId` 的可空形态 | 不允许 `profileId?: string`。可空 = 存在"无档案"状态 = 必然有一条代码路径忘了判断。迁移时直接补 `'default'` |

---

## 2. 现状盘点（改动面）

| 区域 | 现状 | 需要动的地方 |
|---|---|---|
| `src/db/index.ts` | `version(1..3)`；`progress`/`mistakes`/`examSessions` 无 `profileId` | `version(4)`：三表加列 + 改索引；挂 `upgrade()` |
| `src/core/stores/userData.ts` | `recordProgress(packageId, kpId, isCorrect, opts)`；写错题、打卡、BKT/FSRS 都在这里 | 全部写入加 `profileId`；查询改复合索引 |
| `src/core/motivation/*` | `achievements` / `achievementUi` / `collectionSeen` / `discovery` 四个键各存单份 | 键名加 `:<profileId>` 后缀；读写集中在少数几个函数里（改造成本低） |
| `src/core/motivation/dailyStats.ts` / `streak.ts` | `dailyStats` / `studyStreak` 单份 | 同上 |
| `src/core/motivation/attemptedTypes.ts` | `attemptedTypes` 单份 | 同上 |
| `src/core/export/exportService.ts` | `version:'1.0'` 扁平导出；`importUserData` 的 settings 是 `put` | 新增 v2 导出；新增合并导入（**不复用旧 `importUserData` 的 settings 分支**） |
| `src/core/storage/migrateV3*.ts` | v3 迁移 + 启动补偿 + 串行队列 | v4 迁移**照抄这套骨架**，共用 `serialize()` 队列 |
| `src/views/*` | 无档案概念 | 档案切换器、家庭墙、导入预览、打印 |
| `src/core/stores/achievement.ts` | 单份 `items` / `view` | 切换档案时**整体失效重建** |

**改动面的关键判断**：settings 的读写虽然散落在 6 个文件，但**每个键都只有一个读写函数**
（`loadAchievements` / `saveAchievementUi` / `readDiscovery` …）。所以分片不需要改 6 个文件的所有代码，
只需要改这些函数的键名 + 在门面里注入 `profileId`。这是本版能控制住工作量的主要原因。

---

## 3. 数据模型

### 3.1 Dexie v4 schema

```ts
this.version(4)
  .stores({
    packages: 'packageId, manifest.subject, manifest.grade',
    // A2：删掉 [packageId+knowledgePointId]，换成三元复合索引
    progress: '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
    // 错题仍按 exerciseId 去重，但同一条错题在两个档案里是两行
    mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
    settings: 'key',
    examSessions: '++id, [profileId+packageId], profileId, status, startedAt'
  })
  .upgrade((tx) => migrateV4(tx))
```

为何 `mistakes` 用 `[profileId+exerciseId]` 而不是保留 `exerciseId` 单列索引：
现有 `importUserData` / 错题本页面按 `exerciseId` 查一条（`where('exerciseId').equals(...)`）。
加了档案后这个查询会跨档案命中（老大答错的题出现在老二的错题本里）——正是 A2 想避免的静默串数据。
改成复合索引后旧写法直接抛错。

### 3.2 `profileId`：唯一真相与不变量

```ts
// src/core/profile/currentProfile.ts（新增）
export interface ProfileMeta {
  id: string          // 稳定标识，创建时生成，**永不改**
  name: string        // 显示名，家长可改
  createdAt: string   // ISO
}

export const MAX_PROFILES = 4
export const DEFAULT_PROFILE_ID = 'default'

/** 同步读取当前档案 id。用于所有写入路径。 */
export function currentProfileId(): string
/** 切换档案：改 settings.activeProfileId，并广播一次（见 §8.1） */
export async function switchProfile(id: string): Promise<void>
export async function listProfiles(): Promise<ProfileMeta[]>
/** 新建：超过 MAX_PROFILES 直接抛 ProfileLimitError，不做截断/隐藏 */
export async function createProfile(name: string): Promise<ProfileMeta>
```

**数据不变量（写入端强制，不是 UI 强制）**

| # | 不变量 | 违反时的行为 |
|---|---|---|
| P-1 | `profiles.list.length ∈ [1, 4]` | `createProfile` 抛 `ProfileLimitError`；导入时整笔拒绝 |
| P-2 | `activeProfileId ∈ profiles.list.map(p => p.id)` | 启动读不到就回落到 `list[0].id`，并重写 `activeProfileId` |
| P-3 | 任何写入行的 `profileId` 必等于写入时刻的 `currentProfileId()` | 无法从外部传入，违反不了（A1） |
| P-4 | `profileId` 一经创建不变 | 导入**不重写**（D5）；改名只动 `name` |

`profileId` 的生成：`default` 用固定字面量（保证跨设备同一个人就是同一个 id，D5 的前提）；
新建档案用 `p_<时间戳36进制>_<4位随机>`。**故意不用递增序号**——两台设备各自建到 `p2` 时，
序号会撞成一个 id 却对应两个不同孩子，合并时会把两个人并成一个人。

### 3.3 settings 键分片总表（**本版最重要的清单**）

**per-profile（8 个，键名加 `:<profileId>` 后缀）**

| 原键 | v4 键名 | 内容 | 漏搬的可见症状 |
|---|---|---|---|
| `achievements` | `achievements:<pid>` | `UnlockedRecord[]` | 徽章全灰，孩子以为白学了 |
| `achievementUi` | `achievementUi:<pid>` | 折叠状态 | 折叠状态回默认（轻微） |
| `achievement:collectionSeen` | `achievement:collectionSeen:<pid>` | 全收集卡只弹一次 | 全收集卡重复弹（轻微） |
| `achievement:discovery` | `achievement:discovery:<pid>` | 今日抽过 + 已得线索 | 隐藏成就线索丢失 |
| `achievement:discoveryEnabled` | `achievement:discoveryEnabled:<pid>` | 家长开关 | 孩子能绕过家长关闭 |
| `dailyStats` | `dailyStats:<pid>` | 每日题数/时长 | 统计图归零 |
| `studyStreak` | `studyStreak:<pid>` | 连续天数 | **打卡天数归零（最刺眼）** |
| `attemptedTypes` | `attemptedTypes:<pid>` | 做过的题型 | 相关成就重新变灰 |

**global（不 shard，白名单）**

| 键 | 为什么是全局 |
|---|---|
| `profiles` | 档案列表本身就是全局的 |
| `achievement:customPacks` | 包是**设备级资产**：装一次，所有档案共用 |
| `achievement:audit` | 审计是设备级操作日志 |
| `migration:v3` / `migration:v4` | 迁移标记 |
| `progress:lastRecovery` / `progress:lastStartupRecovery` | 补偿节流标记 |
| `fls:theme` | 界面主题，跟人无关 |
| `owner:indexCache` | 归属索引缓存，全库同一份 |

**兜底规则（A5）**：迁移遍历 `settings` 全表，遇到**不在 global 白名单里的键**，一律按 per-profile 搬。
同时写一条 `console.warn` 列出"未知键已按档案分片"——它不阻塞，但下次有人加全局键没登记时会被看见。
另有一条**单测**：`settingsKeys.test.ts` 静态扫 `src/` 里所有 `settings.get/put` 的键字面量，
要求每个键都出现在上两张表的**某一张**里。新键漏登记 → 测试红。

### 3.4 `examSessions`：PRD 漏了但它必须分片

考试记录（`ExamSessionRecord`）含 `answers`、`finalRate`、`elapsedSeconds`。不分片的具体后果：
老二在"模考"页面能看到老大的历史成绩，而成绩是**最容易被孩子拿来比较**的东西——
这与"不做排行"的产品红线直接冲突。因此：

- schema 加 `profileId` + `[profileId+packageId]`；
- 所有 `examSessions` 查询加 `profileId` 前缀；
- 备份 v2 的 `profiles[]` 里也要带 `examSessions`（PRD §P0-3b 的样例漏了，按本文补）。

### 3.5 查询点变更清单（A2 的直接后果）

| 文件 | 原查询 | 改为 |
|---|---|---|
| `src/core/stores/userData.ts:174` | `.where('[packageId+knowledgePointId]').equals([pkg, kp])` | `.where('[profileId+packageId+knowledgePointId]').equals([pid, pkg, kp])` |
| `src/core/export/exportService.ts:175` | 同上 | 合并引擎内部用 Map，不再逐行查库（§6.4） |
| 测试桩 `tests/progress-migrate.test.ts` / `tests/user-data-store.test.ts` | 假 Dexie 的 `KNOWN` 索引集合 | 补 `[profileId+packageId+knowledgePointId]`、`[profileId+exerciseId]` 等 |

`progress` 还有 `where('status')` / `where('packageId')` 的读点，全部要加 `.and(r => r.profileId === pid)`
或改走 `[profileId+packageId]` 索引。**收口办法**：所有"读全部进度"的地方统一走
`src/core/progress/readProgress.ts` 新增的 `progressOf(pid)`，避免 20 处各写一遍过滤条件。

---

## 4. v4 迁移

### 4.1 与 v3 的本质差异

| | v3（E-01） | v4 |
|---|---|---|
| 目的 | **改内容**：`packageId` 归一化为归属包 | **加列 + 搬键**：补 `profileId`、settings 键改名 |
| 失败后果 | 统计口径不收敛，数据一行不丢 | 若"搬键"半途而废，**旧键还在但没人读** → 数据看似消失 |
| 是否需要旧数据参与计算 | 需要（要算归属） | **不需要**（只是复制一份到新键） |

关键结论：v4 比 v3 **更简单**（无业务计算），但**更怕漏**。所以 v4 的设计重点不是"计划正确"，
而是**"清单穷举 + 未知键兜底"**（§3.3 的 A5 规则）。

### 4.2 三段式（照抄 v3 骨架）

```
src/core/storage/migrateV4.ts
  planV4Migration(tx): Promise<V4Plan>      // 只读 + 纯计算，唯一 try/catch 面
  applyV4Plan(tx, plan): Promise<void>      // 哑 IO：只 put，不判断
  migrateProfileV4(tx): Promise<void>       // upgrade() 入口，永不 rethrow
  writeMarkerV4(tx, marker)                 // 写 migration:v4
```

**只认 `tx`，不出现 `db.`** —— 与 v3 同一条铁律（在 `versionchange` 事务里访问 `db.x` 会死锁）。

`V4Plan` 的形状：

```ts
export interface V4Plan {
  /** 需要 UPDATE 的行（只补 profileId 字段，其余字段一个不动） */
  progressPatches: Array<{ id: number; profileId: string }>
  mistakePatches: Array<{ id: number; profileId: string }>
  sessionPatches: Array<{ id: number; profileId: string }>
  /** 需要「复制到新键」的 settings（原键保留不删，见 §4.3） */
  settingCopies: Array<{ from: string; to: string; value: unknown }>
  /** 统计与告警，给标记用 */
  stats: { progress: number; mistakes: number; sessions: number; keys: number; unknownKeys: string[] }
}
```

「只补一个字段」而不是整行重写，是为了让 `applyV4Plan` 能做 `table.update(id, { profileId })`——
不经过 JS 对象往返，也就不会因为 `ensureFields`/序列化把 BKT/FSRS 状态写坏。

### 4.3 旧键保留不删（**有意为之**）

迁移把 `achievements` 复制成 `achievements:default` 之后，**不删旧键**。理由三条：

1. 删了就没退路。虽然本版不支持降级，但用户回退 App 版本是现实存在的（安装包留在文件夹里）。
2. 旧键是**迁移是否成功的证据**：出问题时能逐键对比新旧值，比只看日志强得多。
3. 代价只是几十 KB 的空间（`dailyStats` 大一些，也就几十 KB 量级）。

配套规则：读路径**只读新键**；迁移后旧键变成"归档"。`exportUserData` v2 不导出旧键（避免备份越滚越大）。

### 4.4 失败与恢复

| 场景 | 版本号 | 数据 | 恢复 |
|---|---|---|---|
| 写库失败（Dexie 标记 aborted） | **不推进** | 整笔回滚 | 下次 `open()` 自动重跑 `upgrade()`（v3 已验证的同一条路径） |
| 钩子返回但计划构建失败 | 推进 | 原样 | 写 `migration:v4={status:'failed',attempts:0}` → 启动补偿最多 3 次 |
| 钩子内连标记都写不进 | — | 原样 | 静默；应用照常可用（表结构已是最新，只是 `profileId` 有缺） |

**"有缺"的兜底**：`profileId` 缺失的行仍能被读到（Dexie 不管语义），但会在 `progressOf(pid)` 里被过滤掉。
为避免这种"看不见的行"累积，启动补偿除了重跑迁移，还要跑一次**计数核对**：
`progress.total === progressOf(all pids).total`，不等就再补一次（上限 3 次），仍不等则写
`migration:v4={status:'partial'}` 并在家长端显示一条"数据修复未完成，请导出备份后联系我们"的提示。
**不静默吞掉**——数据不对却说一切都好，是最坏的选择。

**与 v3 的关系**：v3 的 `migration:v3.status === 'failed'` 且未收敛时，v4 的迁移**必须等 v3 补偿跑完**
再执行（共用 `migrateV3Recovery.ts` 的 `serialize()` 串行队列）。否则 v4 会在"包归属还没收敛"的行上补
`profileId`，之后 v3 补偿再改这些行时可能把它们整行替换掉、丢掉 `profileId`。

### 4.5 升级前强制导出

因为 §4.3 只保旧键、不保"能降级运行"，升级到 v4 的第一屏（只出现一次）要给一个
**"升级前先导出备份"** 的按钮，并允许"我已备份，继续"。不做强制拦截（强拦会让人找破解办法），
但要记录 `migration:v4={preExport:'done'|'skipped'}` 以便出问题时判断用户有没有退路。

---

## 5. 写入端收口

### 5.1 唯一入口

```ts
// src/core/profile/currentProfile.ts
let cached: string | null = null
export function currentProfileId(): string {
  // 启动时由 initProfile() 一次性读入并缓存；未初始化直接抛（fail loud）
  if (!cached) throw new Error('[profile] currentProfileId 在 initProfile 之前被调用')
  return cached
}
```

**禁止**从以下位置取 profile：路由参数、组件 props、`useRoute()`、URL query、pinia store 的局部 state。
理由统一：这些都是**可被伪造/可过期**的副本，一旦与 `activeProfileId` 不同步，写入就进错档案。

### 5.2 `recordProgress` 变更

```ts
// 签名不变（V1.3 刚把第 1 参数语义定成"入口包"，不要再动）
async function recordProgress(
  packageId: string,
  knowledgePointId: string,
  isCorrect: boolean,
  opts: RecordProgressOptions = {}
): Promise<void>
```

内部改动只有三行：

```ts
const pid = currentProfileId()                                   // ①
const raw = await db.progress
  .where('[profileId+packageId+knowledgePointId]')               // ②
  .equals([pid, targetPackageId, targetKpId]).first()
// ③ 新建行时带上 profileId: pid
```

**为什么不在签名里加 `profileId`**（A1）：4 个调用点（TopicDetail ×2 / ExamPanel / VocabDrill）
都能改，但**未来的第 5 个调用点**改不改得对没人保证。签名不给这个参数，就没有"传错"这种可能。

### 5.3 错题 / 考试 / 打卡写入

- 错题：`addMistake` / `reviewMistake` / `markMistakeMastered` 三处加 `profileId`，
  查询改 `[profileId+exerciseId]`。
- 考试：`startExam` / `saveExamAnswer` / `finishExam` 加 `profileId`。
- 打卡与每日统计：`dailyStats` / `studyStreak` 的读写函数改成 `key(pid)` 形式（§3.3 表）。

### 5.4 成就结算

`syncAchievements(ctx)` 的 `ctx` 里**不含** `profileId`——它内部自己取 `currentProfileId()`。
这样"结算时用哪个档案"与"写入时用哪个档案"是同一个来源，不会出现"结算写了 A、进度写了 B"。

切换档案时必须做两件事（顺序不能反）：

1. `await syncAchievements()` **在旧档案下跑完**（把当前档案的待结算成就落库）；
2. 改 `activeProfileId` → 清空 achievement store → 重新 `loadUserData()`。

漏掉第 1 步的表现：孩子刚答完最后一题就切档案，那枚成就永远不会解锁（下次进来条件已不成立或
`shouldAdvanceSchedule` 不再推进）。

### 5.5 漏改的静态防线

三道，从便宜到贵：

1. **类型层**：`ProgressRecord` / `MistakeRecord` / `ExamSessionRecord` 的 `profileId` 设为**必填**。
   `tsc --noEmit` 会把所有构造这些对象的地方挑出来。
2. **门禁脚本**：`scripts/check-profile-scope.mjs`（新增，进 `npm run verify`）扫描
   `src/**` 里对 `db.progress` / `db.mistakes` / `db.examSessions` 的直接访问，
   要求同一表达式里出现 `profileId`（白名单：`src/core/storage/migrateV4.ts`、`exportService.ts` 的合并段）。
3. **单测**：`tests/profile-write-scope.test.ts` —— 用 Dexie 替身建两个档案，各写一条进度，
   断言 A 档案读不到 B 的行、且 `progress` 表总行数为 2。

第 2 道是这次新增的**唯一一条新门禁**，加在 `check:text-color` 之后、`test` 之前（它比测试快）。

---

## 6. 合并引擎（本版技术核心）

### 6.1 两阶段 + 纯函数边界

```
src/core/merge/
  types.ts            // Bundle / MergePlan / MergeStats
  mergeProgress.ts    // 单表：progress
  mergeMistakes.ts
  mergeSessions.ts
  mergeSettings.ts    // 8 个分片键 + 全局键
  mergeBundle.ts      // 组合：planMerge(local, remote) → MergePlan
  applyMergePlan.ts   // 哑 IO：单事务内 apply
```

`planMerge` 是**纯函数**：输入两份数据（从库里读出来放内存），输出一份"要写什么"的计划。
它不碰 `db`、不读时钟（`now` 由调用方传入）、不产生随机。这三点保证它能被**穷举单测**
——e2e 点一遍要 30 秒，纯函数跑一遍要 3 毫秒。

### 6.2 契约

```ts
export interface Bundle {
  profileId: string
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  examSessions: ExamSessionRecord[]
  settings: Record<string, unknown>   // 已剥掉 `:<pid>` 后缀的键
}

export interface MergePlan {
  /** 要 upsert 的行（含 profileId），按表分组 */
  progressUpserts: ProgressRecord[]
  mistakeUpserts: MistakeRecord[]
  sessionUpserts: ExamSessionRecord[]
  settingUpserts: Array<{ key: string; value: unknown }>   // 含 `:<pid>` 全名
  /** 新档案（本机没有的 profileId） */
  newProfiles: ProfileMeta[]
  /** 预览用统计 */
  stats: {
    achievementsAdded: number
    progressAdded: number
    progressKeptLocal: number   // 本机更新、备份较旧 → 保持本机
    mistakesAdded: number
    mistakesKeptLocal: number
    settingsChanged: number
    noop: boolean               // 幂等命中：整份备份无新增（AC-P2-13）
  }
}

export function planMerge(
  local: LocalSnapshot,
  remote: Bundle[],
  now: string
): MergePlan
```

### 6.3 逐表规则（对应 PRD §P0-3c，落到实现）

**progress**：`key = packageId \u0000 knowledgePointId`（profileId 在 `Bundle` 层，不进 key）

```ts
const rank = (r: ProgressRecord) => r.lastReviewAt ?? r.lastStudiedAt ?? ''
// 备份更晚 → 取备份；本机更晚或相等 → 取本机
```

**这里有一个必须写进代码注释的坑**：`lastReviewAt` 可能是 `null`（从没复习过），
`lastStudiedAt` 一定有值。取 `??` 是对的；取 `||` 会把 `''` 也吃掉、语义变成"空串优先"，
两者在 `null` 上等价，但对将来可能出现的空串不等价。

**相等时一律取本机**。理由：相等意味着两者信息量相同，取本机可以少写一次库（也保证 `merge(local, local)`
不产生任何写操作 → 幂等自动成立）。

**mistakes**：`key = exerciseId`，比较 `wrongAt`；`wrongAt` 相等时比 `masteryLevel` 等级
（`none=0 / partial=1 / mastered=2`）。等级**只升不降**——即使备份的 `wrongAt` 更晚，
只要等级更低就不取（§P0-3c 的"取更低等于抹掉努力"）。

**examSessions**：`key = packageId \u0000 sessionIndex \u0000 startedAt`。
`sessionIndex` 是"第几次模考"，跨设备可能重复（两台都做了第 3 次），所以要把 `startedAt` 也进 key
——否则一次跨设备导入会把两次不同的考试合成一次，`finalRate` 只剩一个。

**settings（8 个分片键）**：每个键有自己的合并函数，不是一套通用规则：

| 键 | 合并 |
|---|---|
| `achievements:<pid>` | `UnlockedRecord[]` 按 `id` 取**并集**；`unlockedAt` **两边都非空取更早、只有一边非空取非空那侧、都空取空**（见下方 §6.3.1）；`evidence` 本机非空则保留 |
| `dailyStats:<pid>` | 按 `date` 对齐；`questionCount` / `lastStudyAt` 取 max，`firstStudyAt` 取 **min** |
| `studyStreak:<pid>` | `lastDate` 取更晚；`current` / `longest` **分别取 max**（不整对象取，否则会出现 current > longest） |
| `achievementUi:<pid>` | 本机优先（纯界面状态，不值得合并） |
| `achievement:collectionSeen:<pid>` | 逻辑或（看过就算看过） |
| `achievement:discovery:<pid>` | `lastGrantDay` 取更晚；`revealed` 取并集；`chances` / `streakWithoutNew` 取 **max** |
| `achievement:discoveryEnabled:<pid>` | 本机优先（家长在本机的设置是更近的意图） |
| `attemptedTypes:<pid>` | 取并集 |
| `customChecks:<pid>` | **B3 新增时补**：按勾选 id 取并集（停用不清空，见 §13.4 裁决） |

**字段名以真源为准，不要照抄本表旧稿**：实施时发现本表初版有三处字段名写错（`dailyStats` 实际是
`{date, questionCount, firstStudyAt, lastStudyAt}`、`studyStreak` 实际是 `{current, longest, lastDate}`、
`achievement:discovery` 实际是 `{chances, revealed, streakWithoutNew, lastGrantDay}`）。
合并函数一律以 `src/core/motivation/*.ts` 的读写函数为形状定义。

**`repeatCount` 目前不存在**（`UnlockedRecord` 没有这个字段）。B6 加「重复印记」时**必须同时补合并规则**，
否则跨设备导入会把重复次数抹成单次 —— 这是 B6 的 DoD 之一，别漏。

#### 6.3.1 `unlockedAt` 为什么不能用「空串最早」

初稿写的是「`unlockedAt` 取更早（空串 `<` 任意）」，字面实现会**永久毁掉真实日期**：
只要有一台设备是老数据（`unlockedAt: ''`），导入后那枚徽章的日期就变成 `''` 且再也回不来。
而仓库自己的写入口 `saveUnlocked()` 用的是 `prev.unlockedAt || r.unlockedAt`（**优先非空**），
两处语义直接打架。所以规则改成：

```
两边都非空 → 取更早
只有一边非空 → 取非空那侧
都空 → ''
```

这条不是"更加固"，而是**修一个会丢数据的规则**：日期是「什么时候拿到的」的唯一证据，
B5 的打印件和成就卡都要显示它。

#### 6.3.2 整行胜的已知代价：`status` 可以回落

整行胜（R3）意味着：备份侧该行 `lastReviewAt` 更晚时，本机整行被替换，
`status` / `masteryProbability` / `wrongCount` 都可能一起变低。**这是有意为之，不加闸门**：

- 加「已掌握不得回退」就是**字段级合并** —— 会造出「`status`=已掌握 但排期明天到期」的自相矛盾行，
  而 FSRS 下次复习本来就会重算状态，人工拼接只会让调度器读到假状态。
- AC-P2-12 守的是「**旧**备份不覆盖新进度」。备份侧**更晚**且状态更低，是忠实反映更晚的真实状态
  （孩子在另一台设备上答错了），不是"越导越差"。
- `mistakes` 有等级闸门（只升不降）而 `progress` 没有，这个不对称是故意的：错题等级是**累计努力**，
  进度状态是**当前估计**，前者不该被覆盖，后者应该跟着最新证据走。

**`longest` 与 `current` 必须分别取 max** 这个细节很容易漏：如果整对象按 `lastDate` 取，会出现
"`current=3` 但 `longest=9`"（本机 longest 大、备份 current 大）——不算错但难看；
反过来若按 `current` 取整对象，`longest` 可能从 9 掉到 3，这是**可见的倒退**。

**全局键**：本机存在即保留，本机缺失才写入。`achievement:customPacks` 特例：**绝不合并**
（两边的包集合不同，合并会产生"启用了但内容不在本机"的假卡片）——导入不改包，只改数据。

### 6.4 事务边界与规模

- 单个 `db.transaction('rw', progress, mistakes, examSessions, settings, ...)` 里 apply 整个计划。
- 计划在事务**外**算好（读快照 + 纯计算），事务内只写。这样事务时间与"计算耗时"解耦，不容易
  撞 Dexie 的事务超时（大库导入时 5 秒限制是真会撞的）。
- 快照读取也在事务外 —— 理论上两次读之间本机可能被写（孩子边导入边答题）。
  这个窗口**不处理**，但要接受一个已知后果：那条并发的学习记录可能在本次导入后被"较旧的本机快照"
  覆盖。缓解：导入入口在家长端，孩子端同一时刻在答题属于极端场景；且 `progress` 的取值规则
  （比 `lastStudiedAt`）会让覆盖只发生在"本机那条恰好没有更晚时间"的情况下 → 影响面极小。
  **写进 §11 风险登记，不假装不存在。**

### 6.5 单调不减不变量的可测形式

PRD 只给了判据"导入后 ≥ 导入前"，实现层要能**自动验证**：

```ts
// tests/merge-monotonic.test.ts
// 对每个 profileId：
//   导入后的 derived 指标（徽章数、掌握数、打卡天数、错题数、考试数）逐项 >= 导入前
```

用**属性测试**（不引第三方库，自己写一个小生成器）：随机生成 200 组 `local/remote` 对，
断言三条性质：

1. **单调**：`merged ⊇ local`（每个 key 都存在，且 rank 不降低）
2. **幂等**：`planMerge(merged, remote).stats.noop === true`（第二遍无变化）
3. **自反**：`planMerge(local, local).stats.noop === true`

第 2、3 条合起来才能杜绝"导两次翻倍"（AC-P2-13）。只用固定样例测不出这类 bug——
它们只在特定的时间戳组合下出现。

### 6.6 v1 备份适配

`formatVersion` 缺失或 `'1.0'` → 走适配器：整份数据包成
`[{ profileId: 'default', name: '我', ... }]` 再进 `planMerge`。
适配器是纯函数（`tests/backup-v1-adapter.test.ts` 锁住），**不做字段猜测**——
v1 没有的字段一律按"缺失"处理，由各合并函数自己的空值语义兜（这也是为什么 `unlockedAt` 要允许空串）。

---

## 7. 备份 v2 与版本路由

### 7.1 格式

```ts
export interface BackupV2 {
  formatVersion: 2
  exportedAt: string
  appVersion: string          // 便于排障，不参与判断
  activeProfileId: string
  profiles: Array<{
    profileId: string
    name: string
    createdAt: string
    progress: ProgressRecord[]      // 行内带 profileId（冗余但便于人工核对）
    mistakes: MistakeRecord[]
    examSessions: ExamSessionRecord[]
    settings: Array<SettingRecord>  // 键已带 `:<pid>` 后缀
  }>
  globalSettings: Array<SettingRecord>
  /** 不含 packages：包是设备级资产，由用户另外搬运（与 PRD §P0-3b 一致） */
}
```

**为什么行内还带 `profileId`（与所在 profile 冗余）**：备份可能被人工打开看、
也可能被手工编辑后再导入。行内带 pid 时，`profileId` 与所属 profile 不一致能被**检出并拒绝**
（`BACKUP_PROFILE_MISMATCH`）；不带的话这种错误会静默按外层归属写入。

### 7.2 版本路由（唯一入口，禁止各处自己判断）

```ts
export type BackupRoute =
  | { kind: 'v1'; data: LegacyFlat }
  | { kind: 'v2'; data: BackupV2 }
  | { kind: 'reject'; reason: 'too-new' | 'unknown' | 'mismatch'; detail: string }

export function routeBackup(json: unknown, appFormatVersion: 2): BackupRoute
```

| 输入 | 结果 |
|---|---|
| `formatVersion` 缺失 / `'1.0'` | `v1` → 适配成 Bundle → 合并 |
| `formatVersion === 2` | `v2` → 直接合并 |
| `formatVersion > 2` | `reject('too-new')`："这份备份来自更新的版本，请先升级本设备" |
| 结构不符 / 行内 pid 与外层不一致 | `reject`，不尝试修复 |

`routeBackup` 是纯函数，`tests/backup-route.test.ts` 覆盖 8 个分支。

### 7.3 导出时的注意点

- **Tauri 与 Web 的落盘差异**（PRD §7 风险表）：Tauri 下用 `save` 对话框拿绝对路径并回显；
  Web 下沿用 `downloadJson`（浏览器下载目录）并提示"文件在下载文件夹"。
- 文件名：`fls-backup-<档案名或family>-<yyyyMMdd-HHmm>.json`；**不含真实姓名**。
- 空备份（0 档案）不导出——正常不会出现（P-1 保证至少有 1 个档案）。

---

## 8. UI 层改造点

### 8.1 档案切换

- 位置：`AppShell` 顶栏右侧，显示当前档案名；点击开 `n-dropdown`（切换 / 改名 / 新建 / 管理）。
- 切换流程（顺序即正确性）：

```
syncAchievements()          // ① 旧档案先结算
→ flushAchievementToast()   // ② 把待弹的去抖队列清掉（否则会弹在新档案里）
→ setActiveProfileId(id)
→ 清空 achievement store / userData store 的缓存
→ loadUserData() + syncAchievements()
→ 路由保持不动（当前页面按新档案重读数据）
```

第 ② 步容易漏：toast 的去抖队列挂在 `AppShell`，切换档案后它仍会弹，于是老二看到"你解锁了老大的徽章"。

- **改名 / 新建 / 删除**都在家长端（`Parent.vue` 的档案管理区），孩子端只能切换、不能改。
  防止孩子给自己换个名字绕过家长判断。

### 8.2 家庭墙

```
src/views/FamilyWall.vue            // 家长端页面
src/components/AchievementWallColumn.vue   // 单档案一列（复用 AchievementSection 的数据层）
```

- 数据：对每个档案依次 `buildAchievementItems(ctx(pid), records(pid))`。
  **不要**为了墙去新增"批量读所有档案成就"的 API —— 4 个档案 × 28 枚，量小到不值得优化。
- 多档案时横向滚动（`overflow-x: auto` + 列最小宽 320px），不做两两对比布局。
- 文案禁用词清单进单测（AC-P2-8）：`排名 / 第 1 名 / 第一 / 领先 / 落后 / 超过 / 最高分`。
  静态扫 SFC 文本 + 人工复核截图。

### 8.3 导入预览

两步向导的第二屏（第一步是选文件）：

```
src/views/settings/ImportPreview.vue
```

- 调 `planMerge` 拿 `MergePlan`，**只渲染 `stats`，不落库**。
- 三种结束态：`noop`（"没有需要导入的新内容"）/ 可导入 / `reject`。
- 执行按钮 → `applyMergePlan`（单事务）→ 成功后清缓存 + 重读 → 跳回首页。
- 失败 → 明确一句"未导入任何数据"，并把错误原文折在"详情"里（不吞）。

### 8.4 JSON 成就包与规则求值（D2）

```ts
// src/core/motivation/customRule.ts
export type CustomRule =
  | { kind: 'manual-check'; prompt: string }
  | { kind: 'counter'; metric: CounterMetric; target: number }

export type CounterMetric = 'masteredKp' | 'totalAttempts' | 'studyDays' | 'streak'

export function evaluateRule(rule: CustomRule, ctx: CounterContext): number  // 返回当前值
```

- `evaluateRule` 是**有限 switch**，无 `eval` / `new Function` / 表达式解析。
  `tsc` 的 `never` 穷尽检查保证新增 kind 必须同时写求值分支。
- 未知 kind 在校验阶段就被拒（AC-P2-2），走不到求值。
- `manual-check` 的勾选状态存 `achievements:<pid>` 之外的 `customChecks:<pid>` = `Record<packId::id, {at}>`
  —— 与 `UnlockedRecord` 分开，因为"家长勾了"是输入，"解锁"是输出，两者混存会导致
  停用包后再启用时出现"没勾过却已解锁"。

> 注：这一项的**包导入 UI、预览 diff、回滚、审计**在 B3 才做。本版先把 `evaluateRule` 与校验器做成纯函数。

### 8.5 打印分页（D4）

分页算法是纯函数，不依赖 DOM：

```ts
// src/core/report/printLayout.ts
export interface PrintPage { category: AchievementCategory; items: AchievementItem[]; continued: boolean }
export function paginateByCategory(items: AchievementItem[], perPage: number): PrintPage[]
```

规则：

1. 按 `CATEGORY_ORDER` 遍历四类，组内按 `ACHIEVEMENTS` 声明顺序（家长习惯稳定）；
2. 空组跳过，**不产空页**；
3. 组内超过 `perPage`（3 列 × 4 行 = 12）→ 续页，`continued: true`；
4. 页码在渲染时统一编号（`第 x / n 页`），不在算法里生成——否则续页会出现"第 3 / 4 页"和"第 3 / 5 页"打架。

打印 CSS：`src/styles/print.scss`，单独一份，**固定浅色 token**，不继承主题变量。
`@media print` 里 `@page { size: A4 portrait; margin: 12mm }`。

---

## 9. 测试策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 纯函数 | vitest（node 环境，无 jsdom） | `planMerge` 全部分支、属性测试（§6.5）、`routeBackup`、`paginateByCategory`、`evaluateRule`、`planV4Migration` |
| Dexie 相关 | `vi.hoisted()` 造内存表 + `vi.mock('@/db')`（既有做法） | 写入端 profile 隔离、计数器核对、事务回滚 |
| 迁移 | 假 `tx`（只需 `table() → toArray/put/update/delete`） | 逐键搬家的键清单、未知键兜底、幂等（跑两次结果相同） |
| 组件 | **静态 SFC 校验**（读源码串断言） | 禁词、无 `role="progressbar"` 误用等 |
| e2e | Playwright | 跨设备往返（两个 context 各自一份 IDB）、档案切换后数字正确、打印分页页数 |

**e2e 的"两台设备"怎么造**：同一个 `browser` 起两个 `browserContext`（各自的 IndexedDB 隔离），
A 里导出 → 用 `page.waitForEvent('download')` 拿文件 → B 里上传该文件。
**不要**试图通过复制 IDB 文件模拟——那是测 Dexie 不是测我们的合并。

已知坑（沿用 V1.3 教训）：删库必须在 `goto` 之后；种数据前要等应用读库完成；
不能裸 `indexedDB.open(name)` 探库；`test-results/**` 的 trace 会被安全软件拦，
判据是 error-context 里只有 EPERM。

---

## 10. 门禁

现有 `npm run verify` 的真实顺序（`package.json`）：

```
tokens:check → typecheck(vue-tsc) → lint:styles → check:hex → check:text-color → test(vitest)
```

`tokens:check` **必须留在第一位**：`test` 与 `build` 都有 `pretest`/`prebuild` 钩子会跑 `tokens:build`，
把它放到后面就会先被生成一遍、脏值被自愈，掩盖真实漂移。

新增命令：

```json
"check:profile-scope": "node scripts/check-profile-scope.mjs"
```

插在 `check:text-color` 之后、`test` 之前（脚本扫文件，几十毫秒，比跑 2100 条测试便宜）：

```
tokens:check → typecheck → lint:styles → check:hex → check:text-color
  → check:profile-scope（新）→ test → build → playwright(test:e2e)
```

`check:profile-scope` 的规则（三句话说完）：
1. 匹配 `db.progress` / `db.mistakes` / `db.examSessions` 的访问表达式；
2. 同一表达式（同一行 + 前后 2 行）里必须出现 `profileId`（或 `pid`）；
3. 白名单：`src/core/storage/migrateV4.ts`、`src/core/merge/*`、`src/core/export/exportService.ts`
   （这三处本来就要跨档案操作），白名单要求每行带 `// profile-scope-ok: <理由>` 注释，
   **注释必须给理由**，只写 `// profile-scope-ok` 不通过。

---

## 11. 风险登记

| # | 风险 | 触发条件 | 后果 | 对策 | 残余风险 |
|---|---|---|---|---|---|
| R1 | v4 漏搬 settings 键 | 新增了键但没登记 | 某孩子数据看似归零 | A5 默认按档案搬 + 键清单单测 + 旧键保留 | 低 |
| R2 | 导入沿用 `settings.put` | 复用了旧 `importUserData` | 目标设备成就墙被抹 | 新写合并引擎，旧函数**不接线**（B2 完成后旧路径标 `@deprecated`） | 低 |
| R3 | 合并写成字段级 | 图省事按字段挑 max | 复习排期错乱 | §6.3 明确"整行胜"+ 属性测试断言行级一致 | 中（易手滑） |
| R4 | 并发写与导入重叠 | 孩子边答题边被导入 | 一条学习记录被较旧快照覆盖 | 接受；导入入口在家长端；进度取较晚者已把影响压到最小 | 低 |
| R5 | e2e 模拟跨设备不真 | 用同一 context | 测不到隔离问题 | 强制两 context，代码评审卡这条 | 低 |
| R6 | `profileId` 生成撞车 | 两台设备都用递增序号 | 两个孩子被并成一个 | 用时间戳+随机，不用序号（§3.2） | 极低 |
| R7 | 迁移后"看不见的行" | 部分行缺 `profileId` | 统计偏低且无报错 | 启动计数核对 + `partial` 标记 + 家长端提示 | 低 |
| R8 | 打印样式吃掉暗色主题 | 直接复用屏幕 token | 白底印出黑块 | 单独 `print.scss` + 固定浅色 | 低 |
| R9 | 导入后某 kp 的掌握态**回落** | 备份侧该行 `lastReviewAt` 更晚且状态更低 | 家长看到"掌握数变少" | **有意接受**（§6.3.2）：整行胜，加闸门会造出自相矛盾行；AC-P2-12 守的是"旧备份不覆盖新进度" | 中（文案需解释） |
| R10 | 导入时漏传全局键 | `planMerge` 第 4 参可选 | 主题/审计等全局设置静默不导 | 第 4 参**必填**（无默认值）→ 编译期就炸 | 极低 |
| R11 | 合并把重复印记抹成单次 | B6 加 `repeatCount` 时没补合并规则 | 重复解锁的历史消失 | B6 的 DoD 里直接写明"加字段必须同时加合并规则" | 低（有清单兜） |

---

## 12. 交付批次与 DoD

| 批次 | 范围 | DoD（可判定） |
|---|---|---|
| **B1** 档案底座 | v4 schema + 迁移 + `currentProfileId` 门面 + 写入端收口 + settings 分片 + 档案切换 UI + 上限 4 | AC-P2-5/6/7 绿；`check:profile-scope` 绿；档案 A 写不影响 B（单测 + e2e） |
| **B2** 备份与合并 | v2 导出 + `routeBackup` + `planMerge`/`applyMergePlan` + 导入预览 + 事务 | AC-P2-11~15、17 绿；属性测试 200 组 |
| **B3** JSON 成就包 | 校验器 + 预览 diff + 启用/停用/回滚/审计 + `evaluateRule` | AC-P2-1~4 绿 |
| **B4** 家庭墙 | `FamilyWall.vue` + `AchievementWallColumn.vue` + 禁词检查 | AC-P2-8 绿；e2e 两档案并排 |
| **B5** 导出打印 | `paginateByCategory` + `print.scss` + PNG 导出（4 张） | AC-P2-9/10/16 绿；灰度截图人工复核 |
| **B6** 重复印记 | `repeatCount` 合并规则 + 卡面印记 + 故事卡 | 重复解锁计数正确、`aria-label` 同步 |

批次纪律：
- **B1 与 B2 之间不插别的**（合并规则全以 `profileId` 为主键）。
- B2 的纯函数必须先于 UI：先 15 分钟穷举，再接界面。
- 每批独立提交、独立跑门禁；不打包（打包由用户确认后统一做）。

---

## 13. 未决

1. **`examSessions` 合并键的最终形态**（§6.3 用了 `packageId+sessionIndex+startedAt`）：
   若后续要"跨设备继续同一场考试"，键就得换成 `sessionId`（需要给 session 加稳定 id）。
   本版按"两次考试就是两次"处理，不做续考。
2. **档案改名对备份文件名、打印页眉的影响**：目前页眉直接用 `name`，改名后旧打印件与新件不一致，
   可接受（打印件本来就是快照）。
3. **`achievement:discoveryEnabled` 到底是"每个孩子一个开关"还是"全设备一个"**：
   本文按 per-profile 设计（家长对某个孩子的设置）。若产品认为它是"家长总开关"，改回全局即可，
   改动只在 §3.3 表的一行。
4. ~~**待 PRD 补充**：自定义包停用后，`customChecks:<pid>` 里的勾选记录是否保留。~~
   **已裁决（2026-10-20）：保留。** 与"解锁记录停用后保留"同构 —— 停用是"我不想要这张卡了"，
   不是"把这个孩子达成的证据删掉"；删了之后重新启用会回到零且**不可恢复**，代价不对称。
   B3 实施时必须同时做一件事：**把 `customChecks` 登记进 `PROFILE_SCOPED_KEYS`**。
   现状是它连键都还不存在（`grep customChecks src/` 零命中），若 B3 直接按 `customChecks:<pid>`
   读写而不登记，它会落进 `classifyKey()` 的 `unknown` 分支 —— 迁移会"多搬一份"、
   导出会被当成未知键，两处口径都与设计不符。
