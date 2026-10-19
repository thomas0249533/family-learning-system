# 掌握率口径统一定义（#17 V1.3 归一化的上游输入）

> 角色：架构师 高见远 ｜ 性质：**只定义、不实现**（不改代码）。本文作为 software-architect-2 的 #17「progress 归一化」设计的上游口径输入，供其引用。
> 约束：本文**只描述公式与语义**，不含生产代码；`computeMasterySummary` 仅给签名与语义规范。
> 版本口径提醒（**2026-10-19 最终裁决，已落地**）：progress 归一化**完全不改 schema**——主键仍 `++id`、索引仍 `[packageId+knowledgePointId]`、查询一行不改。DB **升到 `version(3)`**，但 `stores` 与 v2 **逐字符相同**，升版本只为拿到 `upgrade()` 钩子；钩子内部**永不 rethrow**（rethrow 会让 `db.open()` 失败、应用变砖）。失败补偿有**两条独立路径**：① 写库失败 → 事务被 Dexie 标记 aborted → 版本号不推进 → 下次 `open()` 重跑 upgrade；② 钩子正常返回但计划构建失败 → 版本号照常推进 → 写 `settings['migration:v3'] = {status:'failed', attempts}` → 启动时 `recoverV3IfNeeded()` 补跑（最多 `MAX_ATTEMPTS = 3` 次，超限不再扫表）。此外**导入包 / 恢复备份之后**还会跑一次 `ensureE1Migrated({ orphanOnly: true })`：它**不改写 `migration:v3`**，只把「原本无主、现在可归因」的历史行重写一遍（另记 `settings['progress:lastRecovery']`）。本文只声明口径，实现见 `src/core/storage/migrateV3*.ts`。
> **状态：定稿（2026-10-19 二次修正）。** §7.1 的接口契约点已由 team-lead 裁定并回写（不要求 domain 预去重，改为函数内部两层收敛）。**归属判定 = 严格三分支、零 tie-break**：`|own| >= 2` **一律 null**（不比较 title、不按 packageType 挑、不取第一个）；`own` 的定义是「**该包的 `knowledgePoints` 数组里声明了该 kpId**」，**不是 units 里引用它**（units 口径实测仅 49.7% 可唯一解析）。

---

## 0. 一句话结论

三处掌握率**根本不是同一个指标**：分子都是「progress 记录条数」，但**分母三种口径**（Home/Parent 用"各包 KP 数组长度累加"，Report 用"裸 `kpId` 去重集合"），且分子**从未去重**。因此**同一份库在三处得到三个不同的百分比，且都可能 >100%**。统一方案：**分母与分子都用 `(packageId, kpId)` 二元组去重**，并对「同 kpId 且 title 完全相同」的副本在函数内部收敛；三处改调同一个 `computeMasterySummary`。

---

## 1. 三处现状：逐条公式与**实际输入**

### 1.1 `src/views/Home.vue`（`stats` computed，**283–292 行**）

```ts
let total = 0
for (const pkg of packageStore.packages) total += pkg.knowledgePoints?.length ?? 0   // 285-287
const mastered = userDataStore.progress.filter(p => p.status === '已掌握').length     // 288
const learning = userDataStore.progress.filter(p => p.status === '学习中' || p.status === '需复习').length // 289
const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0              // 290
```

| 项 | 现值 |
|---|---|
| **分子** | `progress.filter(status==='已掌握').length` → **progress 记录条数，未去重** |
| **分母** | `Σ_pkg pkg.knowledgePoints.length` → **各包 KP 数组长度累加，未去重** |
| **去重口径** | **两端都不去重** |
| 展示 | `Home.vue:158` `chart-rate` 直接显示 `stats.masteryRate`；饼图 `Home.vue:412-414` 用 `Math.max(total - mastered - learning, 0)` **掩盖负的"未学"** |

### 1.2 `src/views/Parent.vue`（`stats` / `subjectStats` computed，**183–245 行**）

`stats`（183–212）：
```ts
let totalKp = 0
for (const pkg of packageStore.packages) totalKp += pkg.knowledgePoints?.length ?? 0   // 184-187
const mastered = progress.filter(p => p.status === '已掌握').length                    // 190
// 注意：stats 里【没有】rate 字段，只返回 totalKp/mastered/learning/needReview/...
return { totalKp, mastered, learning, needReview, studyMinutes, continuousDays }       // 211
```
`subjectStats`（215–245，**学科掌握率在这里**）：
```ts
for (const pkg of packages) for (const kp of pkg.knowledgePoints ?? []) {
  kpToSubject.set(kp.id, subj)          // 224  ← 键是【裸 kp.id】，多包同 id 会【后者覆盖前者】
  perSubject[subj].total++              // 226  ← 分母：按【记录条数】累加，不去重
}
for (const p of progress) {
  if (p.status !== '已掌握') continue
  const subj = kpToSubject.get(p.knowledgePointId)   // 232 ← 用【裸 kpId】反查学科
  perSubject.get(subj).mastered++                     // 233 ← 分子：progress 记录条数
}
rate = total > 0 ? Math.round(mastered / total * 100) : 0   // 242
```

| 项 | 现值 |
|---|---|
| **分子** | progress 记录条数（`已掌握`）|
| **分母** | `Σ` 每学科 KP 记录条数（未去重）|
| **去重口径** | 无需去重；但**学科归属用裸 `kpId` 反查**（`kpToSubject` 以裸 id 为键，同 id 跨包/跨学科被覆盖） |
| 展示 | `Parent.vue:15` 已掌握 **计数卡**（无数值 rate）；`Parent.vue:60` 学科行 `{{s.mastered}} / {{s.total}}（{{s.rate}}%）` |

### 1.3 `src/core/report/reportGenerator.ts`（`generateReportData`，**50–160 行**；由 `Report.vue:30` 消费）

```ts
const allKpIds = new Set<string>()
for (const pkg of packages) for (const kp of pkg.knowledgePoints ?? []) {
  allKpIds.add(kp.id)                 // 59  ← 分母集合：按【裸 kp.id】去重
  kpIdToPkgId.set(kp.id, pkg.packageId)  // 60 ← 裸 id → 单个包（后者覆盖）
}
const totalKnowledgePoints = allKpIds.size
const mastered = progress.filter(p => p.status === '已掌握').length   // 67 ← 分子：记录条数，未去重
const notStarted = totalKnowledgePoints - progress.length            // 70 ← 可为负
const masteryRate = totalKnowledgePoints > 0 ? Math.round(mastered / totalKnowledgePoints * 100) : 0 // 71-73
```

| 项 | 现值 |
|---|---|
| **分子** | progress 记录条数（未去重）|
| **分母** | `Set(裸 kp.id).size` → **按裸 kpId 去重**（会把 english-7 的 49 个不同知识点塌成 7） |
| **去重口径** | 分母裸 kpId；分子不去重 → **分子分母不同源** |
| 副产物 | `notStarted = total - progress.length` 可为负；`subjectMap` 的 `kpIdToPkgId` 裸 id 覆盖导致学科归属失真（92-98） |

---

## 2. 三处互相矛盾 & `>100%` 的成因

### 2.1 三处分母口径对照

| 处 | 分子 | 分母 | 去重键 | 可出现 >100% |
|---|---|---|---|---|
| Home.vue | progress 记录条数(已掌握) | `Σ` 包 KP 数组长度（**不去重**） | 无 | 会（分子含孤儿/重复记录时） |
| Parent.vue(学科) | progress 记录条数(已掌握) | `Σ` 每学科 KP 条数（**不去重**） | 学科按**裸 kpId** 反查 | 会 |
| reportGenerator | progress 记录条数(已掌握) | `Set(裸 kpId)`（**裸 id 去重**） | **裸 kpId** | 会（且分母被 english-7 塌缩后尤其显著） |

⇒ 同一份数据：**Home 与 Report 的分母不同**（一个"记录条数累加"、一个"裸 id 去重"），**必然给出不同百分比**；Parent 又是第三种（按学科 + 裸 id 反查）。

### 2.2 `>100%` 的 4 个直接成因

1. **分子不去重、分母口径不一致**：分子数的是「progress 记录条数」，而 progress 记录数可能**多于**分母所代表的 KP 集合——典型是**同一真实知识点因 `packageId` 写成多个而存在多条 progress**（general-purpose-2 已实证：归一化前同一知识点可被写入非归属包，产生多个 packageId）。分子膨胀。
2. **孤儿记录**：**归属包**被删除/被替换后 progress 残留，**分子算、分母不算** → 比例虚高。
   > ⚠️ 限定词是关键：归一化后 `progress.packageId` 指向**归属包（unit 包）**。删 `term` / `sprint` / `special` / `daily` 这类**聚合入口包**时，行本来就挂在 unit 包上 → **什么都不会变成孤儿，掌握率三项全不变**。只有删 `unit`（归属包）才会产生孤儿。**不得把"入口包不存在"判成孤儿。**
   > 另：`Review.vue` 侧的 `droppedCount`（复习页反查不到 unit）与统计侧的 `orphanRecordCount`（归属包缺失）是**两个不同成因的计数，禁止复用同一个变量**。
3. **Report 分母被裸 kpId 去重而"缩小"**：english-7 的 p1~p7 各定义一套同名 id（49 个不同知识点共用 7 个 id），`Set(裸 kp.id)` 只数 7 → 分母被压低 → rate 被抬高，极易 >100%。
4. **`Math.max(...,0)` 在打掩护**：`Home.vue:414` 对"未学"取 `Math.max(...,0)`，把负值吞掉；但 `chart-rate`（158）仍直接显示可 >100 的 `masteryRate`。

> 结论：这不是"显示 bug"，是**指标定义缺失**。必须先定唯一定义，再做归一化（否则归一化前后不可比）。

---

## 3. 唯一定义（推荐方案 · 已做可行性与代价校验）

### 3.1 定义

> **掌握率 = 已掌握的去重知识点数 / 去重后的知识点全集**，**去重键 = `(packageId, kpId)` 二元组**。

```
domainKeys   = { `${pkg.packageId}::${kp.id}` | pkg ∈ packages, kp ∈ pkg.knowledgePoints }
             ⇒ 再收敛副本：同 kpId 且 title 全同的 key 合为一个（见 §3.2 第 1 步）
total        = |domainKeys|                                                  // 分母
mastered     = |{ k ∈ domainKeys | progress[k].status === '已掌握' }|          // 分子
rate         = total > 0 ? round(mastered / total * 100) : 0                  // ∈ [0,100]
```

### 3.2 ⚠️ 可行性修正（对 team-lead 原拟 `computeMasterySummary(records)` 的必要更正）

**仅凭 `records`（progress）无法算出分母**——progress 只含"学过的"，不知道"全集"。分母来自 **packages 里定义的 KP**。故签名必须是**两入参**：

```ts
// src/core/mastery/masterySummary.ts  （建议位置：与 masteryRules.ts 同目录，纯函数、无 Vue/Dexie 依赖）
import type { LearningPackageRecord, ProgressRecord } from '@/db'

export interface MasterySummary {
  total: number        // 去重 (packageId,kpId) 全集
  mastered: number
  learning: number     // status === '学习中'
  needReview: number   // status === '需复习'
  unlearned: number    // 有 progress 记录但 status === '未学'
  notStarted: number   // 全集内、从未产生 progress 记录 = total - 上述四类
  rate: number         // 0..100，round(mastered/total*100)
  orphanRecordCount: number // progress 中 (packageId,kpId) 不在 domain 的记录数（诊断用，不计入任何桶）
}

export function computeMasterySummary(
  packages: LearningPackageRecord[],
  progress: ProgressRecord[],
): MasterySummary
```

**语义规范（纯定义，非实现）**：
1. 建 `domainKeys = Set<`${pkgId}::${kpId}`>`，遍历 `packages[].knowledgePoints[].id`，**再做一层收敛**：把「不同 `packageId` 下同一个 `kpId` 且 **title 完全相同**」的 key 合并为一个（视为同一知识点的副本；任一 title 不同则不合并）。**收敛在函数内部完成，调用方无需预先去重 domain。**
2. 建 `progressByKey`：键同上；**同一 key 若有多条 progress（历史重复，复合索引非唯一）→ 按 team-lead 合并口径降级：`status` 取 `lastStudiedAt` 最新那条**（与 #17 合并规则一致；合并后本无重复，此仅为合并前的兜底）。
3. **孤儿**：`progress` 中 key ∉ `domainKeys` 的记录 → 计入 `orphanRecordCount`，**不进任何桶**（不算 mastered、也不算 notStarted）。
4. 四个桶 + `notStarted`：`notStarted = total - mastered - learning - needReview - unlearned`。
5. `rate` 四舍五入，并 **clamp 到 [0,100]**（防御性；正常不应触发）。

### 3.3 三处统一调用

| 调用点 | 改动 |
|---|---|
| Home.vue `stats` | `const s = computeMasterySummary(packageStore.packages, userDataStore.progress)`；`total/mastered/learning/masteryRate` 取自 `s`；**删除 `Home.vue:414` 的 `Math.max(...,0)` 兜底**（`notStarted` 已保证 ≥0） |
| Parent.vue `stats` / `subjectStats` | 总览取 `computeMasterySummary(...)`；学科分布按 `(packageId,kpId)` 归属包的 `manifest.subject` 统计（见 §3.4），不再用裸 kpId 反查 |
| reportGenerator | `stats.mastered/masteryRate/notStarted` 改由 `computeMasterySummary(packages, progress)` 提供；`subjectBreakdown` 同步改用二元组归属（见 §3.4） |

> **禁止**在这三处再各写一遍公式（`grep` 目标：不允许再出现 `mastered / total`、`totalKnowledgePoints - progress.length` 这类就地表达式）。

### 3.4 学科归属（供 Parent / Report 学科分布用）

- 学科 = **该 `(packageId, kpId)` 所在包的 `manifest.subject`**（即"归属包"的学科），**不再用裸 kpId 反查**。
- 实现：`masteryBySubject(packages, progress)`（`src/core/mastery/masterySummary.ts`），内部走**同一个** `canonicalizeProgressRows`，所以「学科 total 之和 = 整体 total」是结构保证，不是巧合。
- 这与 #17 的"归属包"判定**共用同一规则**：
  ```
  own = 所有「knowledgePoints 数组里声明了该 kpId」的包      ← 不是 units，禁止用 units 反推
  |own| == 0 → null                                          （保留原记录不动）
  |own| >= 2 → null                                          （一律 null：不比较 title、不按 packageType 挑、不取第一个）
  |own| == 1 → 该包即归属包
  另：归属包 subject ≠ 入口包 subject → null
  ```
  本函数只消费"已归属"的 `(packageId, kpId)`，**不做归属推断**（职责隔离：归属归 #17，口径归本函数）。

  > **为什么 `own` 必须是 `knowledgePoints` 声明口径**：units 口径实测只有 **49.7%（446/898）** 能唯一解析——term/sprint/special/daily 的 units 是从 unit 包聚合来的，同一 kpId 有 3–5 个候选，最高频的 unit 入口只有 26%；`knowledgePoints` 声明口径是 **100%（898/898）**，且 `TopicDetail.vue:399-407` 的 `ownerPackageIdOf` 已是同语义实现，可直接上提复用。
  > **为什么 tie-break 已撤销**：`knowledgePoints` 口径下 zip 库 472 个 kpId 每个只有 1 个声明者，`|own| >= 2` **命中率为 0** → 任何"按 title 选代表 / 按 packageType 挑"都是**永远走不到的死代码**，留着只会误导实现者；一旦真触发（裸 JSON 导入路径）就是拍脑袋，会把进度串到错误包，而**写入端错了不可逆**。宁可不归一化（保留重复行），也不能猜。
  > ⚠️ **层次区分（最容易写错）**：`(packageId, kpId)` 之后还有一层「同 kpId 且 title 全同 → 计 1」的**副本收敛**，它**只用于统计层**（`computeMasterySummary` 内部），**绝不用在归属判定/写入层**。两条规则不在同一层，不要互相套用。
- **口径一致性硬要求**：`computeMasterySummary` 收到的 `progress[].packageId` **就是归属包**（归一化后的值；无法归一化的记录保留原值）。**不要求调用方预先收敛 domain** —— 收敛责任在函数内部（§3.2 第 1 步的两层收敛），故分母口径与归一化规则自洽，不依赖调用方先做什么。

---

## 4. 去重键：**必须 `(packageId, kpId)`，禁止裸 `kpId`**（决定分母大小）

### 4.1 反例（实证，来自 general-purpose-2 的只读调研）

- **english-7 的 p1~p7**：七个包**各自定义一套** `kp-reading-001` / `kp-word-001` / `kp-sentence-001` / `kp-grammar-001` / `kp-grammar-002` / `kp-phonetic-001` / `kp-writing-001`，且**各包 title 不同**（p1 是「寻找朋友的帖子」、p2 是「一张家庭照片的描述」…）。⇒ **49 个不同知识点共用 7 个裸 id**。
- **跨学科复用**：同一 `kp-reading-001` 还被 `special-chinese-4-up-reading` 用作「梅雨潭」。
- 全库被引用 distinct kpId = 486，其中 **73 个**出现在 ≥2 个包。

### 4.2 结论

| 去重键 | english-7 一段的分母 | 判定 |
|---|---|---|
| 裸 `kpId` | **7** | ❌ **错**：把 49 个不同知识点塌成 7，掌握率虚高、跨学科学科归属覆盖 |
| `(packageId, kpId)` | **49**（7 包 × 7 id） | ✅ **对**：与真实知识点一一对应 |

- **短 id 与带前缀 id 并存**（`kp-reading-001` vs `unit-...p7::kp-reading-001`）也会放大裸 id 冲突——这正是 `TopicDetail.vue:334-337/387-389/401-403` 到处 `stripPrefix` 的根因。本函数**不做 stripPrefix**：以 `packages[].knowledgePoints[].id` 原值为 kpId，progress 侧用 `knowledgePointId` 原值；两者应同源（写入侧若 strip 需在 #17 统一）。

### 4.3 历史重复记录在场时的行为（**必须写清，供 AC 措辞**）

- **分子（mastered）**：归一化前，同一真实知识点若被写成多个 `packageId`，会有多条 progress → 若这些 packageId 都落在 domain 内，则计为**多个 key**（分母也含多个对应 key），rate 不一定虚高，但**"已掌握"计数被放大**；若部分是非归属包（不在有效 domain），则计入 `orphanRecordCount`、**不进分子**（rate 反而偏低）。**归一化后**（progress.packageId → 归属包）分子按真实 key 收敛 → 更准。
- **分母（total）**：**由 packages 的 KP 定义决定，progress 归一化不改变分母**。若 domain 里"同一知识点被多包重复登记"（如 base + unit 副本），`(packageId,kpId)` 会把它们计成多个 key → **分母偏大**。**该问题已由 §3.2 第 1 步的"副本收敛"吸收**：不同 packageId 下同 kpId 且 title 完全相同的 key 合并为一个，故无需调用方预先去重 domain。
  > 澄清：progress 归一化只修正**分子**；分母的"副本重复"由函数内部收敛处理。两条机制**互相独立但输出自洽**——归一化保证同一知识点写进唯一 packageId，副本收敛保证"确实被多包登记"的历史数据不重复计入。**注意 english-7 这类"同 id 不同 title"的用例不会被收敛**（title 各不相同），这正是它们必须被当作 49 个知识点计数的原因。

---

## 5. 硬约束（进 AC）+ 断言点

### 5.1 不变量（对任意输入恒成立）

| # | 不变量 | 说明 |
|---|---|---|
| I1 | `mastered <= total` | 分子不超过分母 |
| I2 | `0 <= rate <= 100` | `rate = round(mastered/total*100)` 且 clamp |
| I3 | `notStarted >= 0` | `= total - mastered - learning - needReview - unlearned` |
| I4 | `mastered + learning + needReview + unlearned + notStarted === total` | 五桶恰好划分全集 |
| I5 | `orphanRecordCount >= 0` 且**不进任何桶** | 孤儿隔离 |
| I6 | 空输入（无包/无进度）→ `total=0, rate=0, notStarted=0`，不抛异常 | 冷启动 |
| I7 | **幂等**：同一输入多次调用结果全等 | 纯函数 |
| I8 | 同 key 多条 progress → 该 key 只计 **1** 次 | 去重 |

### 5.2 断言点（**哪个文件、断言什么**）

| 测试文件（新增/改动） | 断言内容 |
|---|---|
| **`tests/mastery-summary.test.ts`（新增，主战场）** | I1–I8 全覆盖；**english-7 夹具**：7 包 × 7 同名 kpId 但 **title 各不相同** → `total === 49`（副本收敛**不得**触发）；**副本夹具**：base + unit 两包同 kpId 且 title 完全相同 → 收敛为 1 个 key（`total` 只 +1），title 改一个字 → 变 2 个 key；**跨学科夹具**：同 kpId 在数学/语文两包 → 计 2 个 key 且学科各归其包；**孤儿夹具**：progress 含一个不在 domain 的 key → `orphanRecordCount===1` 且 `mastered` 不含它；**>100% 复现夹具**：构造 `mastered>total` 的旧场景 → 新函数 `rate<=100`；**历史重复夹具**：同 key 两条 progress（一条已掌握旧、一条学习中新）→ 按 `lastStudiedAt` 最新取值且只计 1 次 |
| `tests/report-generator.test.ts`（若存在则改，否则并入上） | `notStarted >= 0`；`masteryRate <= 100`；学科 `mastered <= total`（per subject）；`totalKnowledgePoints === computeMasterySummary(...).total` |
| `tests/user-data-store.test.ts` | 归一化后同一 `(归属包,kpId)` 只 1 行（幂等）；行数不增长（与 #17 交叉，-2 负责实现，本处仅登记断言点） |
| **`tests/e2e/visual.spec.ts` + `docs/screenshots/`** | Home 饼图/Report 掌握率数字更新基线（属**预期口径变更**，非回归，需在基线 PR 说明） |
| 页面级（可选组件测试） | Home `chart-rate` 文本 ≤100；Parent 学科行 `mastered<=total`；Report `notStarted` 非负 |

> **QA 建基线时**：以 `computeMasterySummary` 的返回值作为唯一真值快照，不比对三处各自公式。

---

## 6. 行为变更清单（哪些页面数字会变、怎么变）

| 页面/指标 | 变更方向 | 原因 |
|---|---|---|
| **Report 整体掌握率**（`report.stats.masteryRate`） | **显著下降**（分母变大） | 分母从"裸 kpId 去重"→"(packageId,kpId) 去重"；含 english-7 等包的库，分母 7→49 之类的展开会让 rate 明显变小。**这是最大变化点**，非退步 |
| **Report `notStarted`** | 由"可为负"→ **非负** | `notStarted = total - 四桶`，且孤儿不进桶 |
| **Report 学科分布** | 学科间**重新分配**（有的升有的降） | 学科归属由"裸 id 覆盖"→"归属包 subject"，跨学科同 id 不再被覆盖 |
| **Home 掌握率** | 通常**略降或持平**（≤100） | 分子去重 + 排除孤儿；分母与旧口径基本相同（Σ 条数 ≈ 二元组去重数）；**不再 >100%** |
| **Home "已掌握"计数** | 可能**略降** | 去掉重复/孤儿记录 |
| **Parent 已掌握计数** | 可能**略降** | 同上 |
| **Parent 学科掌握率** | 学科间**重新分配** | 同 Report 学科归属修正 |
| **Parent/Home "学习中/需复习"** | 基本稳定（口径本就按 status 计数，仅去重影响） | 去重后同一 key 只算一次 |
| 空库/冷启动 | 三处统一为 0（不报错） | I6 |

> **给 QA 的核心提醒**：**数字变小不等于退步**。届时必须在基线说明里标注"掌握率口径从'裸 id 去重/记录条数'统一为'(packageId,kpId) 去重'，历史 english-7 类包被正确展开，故 rate 下降"。

---

## 7. 遗留 / 需 -2 与 PM 对齐的开放项

1. ~~**domain 是否也按归属包去重**~~ → **已由 team-lead 裁定（本文定稿口径）**：不要求 domain 侧预先去重，改由 `computeMasterySummary` **内部两层收敛**（先按 `(packageId, kpId)` 建 key，再对「不同 packageId 下同一 kpId 且 title 完全相同」的 key 合并 —— **仅统计层**）。`progress[].packageId` 即归属包（无法归一化的保留原值）。`resolveOwnerPackageId` 的 `|own| >= 2` 分支**一律 null**（tie-break 已撤销，不按 title / packageType 挑）。**§4.3 中"分母偏大"的担忧因此由函数内部收敛吸收，不再作为开放项。**
2. **`stripPrefix` 边界**：短 id / 带前缀 id 并存，写入侧若 strip 需与 progress 侧一致；本函数假定 `packages.kp.id` 与 `progress.knowledgePointId` **同源可比**。
3. **`achievements.ts` 的 `masteredKpCount`**（`achievements.ts:62`）同样是"记录条数"，与掌握率同源问题；建议 #17 一并改用 `computeMasterySummary(...).mastered`（本文不扩范围，仅提示）。
4. **`learning` 是否含 `需复习`**：Home 旧口径 `learning = 学习中 ∪ 需复习`，Report 分开计。统一后**分设 `learning`/`needReview` 两桶**（不合并），三处如需"学习中"合并展示由页面自行相加，公式只出原子桶。

---

*本文件由架构师高见远产出，仅含口径定义，不含实现代码。*

---

## 7. 落地状态（2026-10-19 · T02 / T04 完成）

| 项 | 状态 | 位置 |
|---|---|---|
| 唯一口径函数 | ✅ | `computeMasterySummary` / `canonicalizeProgressRows` / `countMasteredKps` / `masteryBySubject`（`src/core/mastery/masterySummary.ts`） |
| Home 掌握率 | ✅ 已改调 | `Home.vue` 的 `stats` computed（「学习中」卡片 = learning + needReview） |
| Parent 总览 | ✅ 已改调 | `Parent.vue` 的 `stats` computed |
| Parent 学科分布 | ✅ 已改调 | `masteryBySubject`，不再用裸 kpId → subject 映射 |
| Report 整体 + 学科 | ✅ 已改调 | `reportGenerator.buildReport` |
| 禁止就地公式 | 🚧 靠评审核对 | 全库已无 `mastered / total` 形式的就地表达式（`totalKnowledgePoints - progress.length` 已删） |

**预期可见变化**（不是退步）：Report 整体掌握率显著下降（分母展开）、`notStarted` 不再为负、学科间重新分配、Home/Parent 已掌握计数可能略降。
