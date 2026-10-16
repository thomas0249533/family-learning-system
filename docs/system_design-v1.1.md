# 家庭学习系统 · 本轮增量设计 + 任务分解（路线图 V1.1 批次 + 用户新增 A1/A2）

> 角色：架构师 高见远 ｜ 目标工程：`D:\study`
> 权威输入：`docs/prd-v1.1.md`（一切以其为准）＋上一轮 `docs/system_design.md`（§8 跨文件约定**沿用**）＋主理人转达的**用户已拍板决策**。
> 纪律：本文件**只出设计与任务清单，不写实现代码、不改源码、不打包**。若现实与 PRD 冲突，以「不降级既有功能 + 用户已拍板决策」为准并如实指出。
>
> **版本口径**：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 三处 `1.8.0 → 1.9.0`；`src/App.vue` 侧栏 `V1.8 → V1.9`（两处：sidebar-footer 与 header-right）；git tag **`v1.9.0`**；文档口径 = **路线图 V1.1 批次**（= app 版本 1.9.0）。

---

## 0. 关键事实核查（先摆事实，再谈设计）

| # | PRD 待确认/事实 | 本轮核查结论 | 影响 |
|---|---|---|---|
| 1 | `attemptedTypes`（题型）数据源 | **可得，无需降级**。`src/modules/core/QuizEngine.vue:146` 定义 `QuizQuestionType = 'single'\|'blank'\|'multiple'\|'judge'\|'matching'\|'spelling'\|'essay'`（7 种 ≥5）；`QuizQuestion.type`（:150）在作答处可拿到；且 `TopicDetail.vue:509`、`ExamPanel.vue:341`、`VocabDrill.vue:271` 已把 `questionType` 传入 `recordProgress` | `type-collector` 按**真实题型**判定，不降级 |
| 2 | 成就墙位置 | **仅 `Home.vue` 有**；`Parent.vue`/`Report.vue` 零成就代码 | A2-5 = **新建**（非改造） |
| 3 | `fontSizeMap` 双缩放 | 全库**零 `rem` 使用**（grep `\d+rem` 无命中）；根字号 `documentElement.style.fontSize` 仅影响"未显式设 font-size 的继承文本"，naive-ui 组件走 `themeOverrides` 的 px | 见 §4.1 选型 |
| 4 | Tauri 判定手段 | `package.json` **无 `@tauri-apps/api`**，仅 devDep `@tauri-apps/cli`；`src` 内零 tauri 引用 | B4 用**全局变量探测**，**不新增依赖**（见 §4.4） |
| 5 | B7 依赖缺口 | `package.json` 有 `test:e2e: "playwright test"`，devDeps **无 `@playwright/test`** | B7 高风险 → 降级方案（§4.7） |
| 6 | B6 存量例外 | `Home.vue:437` `filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15))` | 处置决策见 §4.6 |
| 7 | 根目录 exe 数量 | 实际 **7 个**（非 5 个）：`Study1.5.exe`/`app20261012.exe`/`app20261015.exe`/`app20261015b.exe`/`app20261015c.exe`/`homenstudy.exe`/`study.exe`；另有 `dist/`、`node_modules/`、`src-tauri/target/`、若干中文 `.txt` | `.gitignore` 见 §5 |
| 8 | 项目 git 状态 | 根目录**无 `.git`**、**无 `.gitignore`** | C1 干净起步 |

---

## Part A · 系统设计

### 1. 架构总览（本轮新增/改动分层）

本轮的架构核心是**两条正交主线 + 一条工程基线**：

```
                         ┌─────────────────────────────────────────────┐
                         │  C1  工程基线（git init / .gitignore / tag）  │  独立，最先做
                         └─────────────────────────────────────────────┘

  主线① 多学段主题（A1 + B1/B2/B3/B5）
  ┌───────────────────────────────────────────────────────────────────────────┐
  │  数据源层（纯，可测）                                                        │
  │    theme.scss  ← 6 组选择器（唯一 CSS 源）                                   │
  │    palette.ts  ← presets.{primary,junior,senior}.{light,dark}（唯一 JS 数值源）│
  │    variables.scss ← SCSS 门面 $x = var(--x)（结构不变）                      │
  │    presetInference.ts ← 年级→主题 纯函数                                     │
  │    ── 被 tests/palette-consistency.test.ts（6 组防漂移）锁定 ──               │
  ├───────────────────────────────────────────────────────────────────────────┤
  │  状态层                                                                      │
  │    stores/theme.ts ← preset + mode + fontSize + presetManual + localStorage  │
  ├───────────────────────────────────────────────────────────────────────────┤
  │  服务层（JS 取色统一，组件不再直接 import palette）                           │
  │    theme/useThemeTokens.ts（读当前生效 CSS 变量数值，供内联）                 │
  │    theme/useChartTheme.ts（echarts 主题）                                    │
  │    report/pdfExporter.ts（PDF 固定浅色）                                     │
  ├───────────────────────────────────────────────────────────────────────────┤
  │  呈现层                                                                      │
  │    index.html（防 FOUC 内联启动脚本）                                         │
  │    components/ThemeProvider.vue（n-config-provider + themeOverrides）         │
  │    components/AppShell.vue（布局骨架）                                        │
  │    App.vue（仅组合）  Settings.vue（预设卡片单选 + 推荐条）                     │
  └───────────────────────────────────────────────────────────────────────────┘

  主线② 成就体系（A2）
  ┌───────────────────────────────────────────────────────────────────────────┐
  │  stores/userData.ts（热路径：recordProgress/resolveMistake/新增 recordAnswerEvent）│
  │      │                                                                       │
  │      ├─ motivation/dailyStats.ts（每日题量 + 首/末时刻，内存聚合 + 防抖落盘） │
  │      └─ motivation/streak.ts（既有 touchStudyDay，点位保持不变）              │
  │  motivation/achievements.ts（28 枚 + category/hidden/chain + 存储迁移）       │
  │  motivation/chains.ts（连环元数据）                                          │
  │      │                                                                       │
  │      ├─ Home.vue（成就墙升级 + 动效 + echarts 走 useChartTheme）              │
  │      ├─ components/AchievementToast.vue（新解锁动效，尊重 reduced-motion）    │
  │      └─ Parent.vue（成就概览，新建）                                          │
  └───────────────────────────────────────────────────────────────────────────┘
```

**分层原则**：纯逻辑（inference / achievements / dailyStats / palette）与副作用（store / DOM / Dexie）**分离**，纯逻辑一律可单测。

---

### 2. A1 多学段主题架构（本轮最大工作量）

#### 2.1 `theme.scss` 六组选择器与**特异性证明表**

**变量分两轴**（这是把 6 组从"×3 全量"降到"可维护"的关键）：

- **维度 A（preset，换色相）**：`--primary-*`、语义色族、`--bg-color/-hover`、`--card-bg`、`--surface-2`、`--text-*`、`--text-on-primary`、`--border-color/-light`、`--gradient-primary`。
- **维度 B（mode，换明度 + 中性）**：`--shadow-*`、`--band-*`、`--code-color`、`--gradient-warm/cool/success/sunset`、`--on-strong(-rgb)`。
  > **决策**：阴影 / band 档位 / code-color / 非主色渐变 **跨学段恒定**（它们是与色相无关的语义/中性值），只随明暗变；**仅 `--gradient-primary` 随学段变**。此决策显著降低维护成本且不损失"学段个性"。

**命名与选择器（严格按下表）**：

| 选择器 | 作用域元素 | 特异性 | 命中条件 | 覆盖内容 |
|---|---|---|---|---|
| `:root` | `html` | **(0,1,0)** | 恒 | 尺寸/动效 + **初中浅**全量 + 维度 B 浅色值 |
| `body[data-theme-preset="primary"]` | `body` | **(0,1,1)** | 属性=primary | 小学·浅（preset 覆盖） |
| `body[data-theme-preset="senior"]` | `body` | **(0,1,1)** | 属性=senior | 高中·浅（preset 覆盖） |
| `body.dark-mode` | `body` | **(0,1,1)** | 有 class | **初中深**全量 + 维度 B 深色值 |
| `body[data-theme-preset="primary"].dark-mode` | `body` | **(0,2,1)** | 属性=primary ∧ class | 小学·深（preset 深色覆盖） |
| `body[data-theme-preset="senior"].dark-mode` | `body` | **(0,2,1)** | 属性=senior ∧ class | 高中·深（preset 深色覆盖） |

> **为什么不需要显式 `junior` 属性块**：属性=junior/缺失时，`body` 上**没有任何 preset 规则命中**，`body` 直接继承 `:root`（初中浅）；深色时由 `body.dark-mode`（初中深）接管。零冲突。

**6 组组合命中证明（逐例，含"互相压盖"排查）**

| 场景（body 上的 state） | 命中 `body` 的规则（按特异性） | 胜出者 | 结果 | 期望 |
|---|---|---|---|---|
| 属性=junior/无 + 浅 | 无 preset 规则 → 继承 `:root` | `:root` | 初中浅 | ✔ |
| 属性=junior/无 + 深 | `body.dark-mode`(0,1,1) | 它 | **初中深** | ✔（**PRD 硬要求**） |
| 属性=primary + 浅 | `body[data-theme-preset="primary"]`(0,1,1) | 它 | 小学浅 | ✔ |
| 属性=senior + 浅 | `body[data-theme-preset="senior"]`(0,1,1) | 它 | 高中浅 | ✔ |
| 属性=primary + 深 | `body.dark-mode`(0,1,1) · `body[..primary]`(0,1,1) · `body[..primary].dark-mode`**(0,2,1)** | **(0,2,1)** | 小学深 | ✔ |
| 属性=senior + 深 | `body.dark-mode`(0,1,1) · `body[..senior]`(0,1,1) · `body[..senior].dark-mode`**(0,2,1)** | **(0,2,1)** | 高中深 | ✔ |

**关键不变量（防上一轮 `index.scss` 那类特异性 bug 复发）**：
1. **`--bg-color` / `--card-bg` / 所有主题色变量的定义，只能出现在 `theme.scss`**。`index.scss` 已在上一轮删除冲突块（现仅字体/盒模型），本轮**不得再引入任何定义主题变量的选择器**。
2. **深色 + 非默认学段**必须命中 `(0,2,1)` 的组合选择器（比单维 `(0,1,1)` 高），因此组合块**必须存在**。这是唯一的"相等特异性陷阱"来源——当 `.dark-mode`(0,1,1) 与 preset 浅色块(0,1,1) 同时命中时，靠组合块(0,2,1) 胜出。**若工程师漏写组合块 → 深色会串成"学段浅色"**。测试须**结构性断言组合块存在**（见 §2.5）。
3. `body.dark-mode`（初中深）**单独存在**（无 preset 属性）时仍正确 = 初中深（上表第 2 行）。✔ 满足 PRD 要求。
4. `:root` 保留**初中浅**为兜底：**无 JS 的首帧**也能看到合理配色（不白屏/不乱色）。

#### 2.2 三套预设色板（14 hero token，PRD §4.1）

初中 = 现状原值（零回归）。小学/高中为 PRD 建议值。

| token | 小学·浅 | 小学·深 | 初中·浅(现状) | 初中·深(现状) | 高中·浅 | 高中·深 |
|---|---|---|---|---|---|---|
| primary | `#f2760c` | `#ffa447` | `#2d6a4f` | `#4fa57f` | `#3b5b7a` | `#7fa3c4` |
| primary-hover | `#d96706` | `#ffb368` | `#245741` | `#5fb88f` | `#2f4a63` | `#93b3d0` |
| primary-pressed | `#bd5a05` | `#e58a2f` | `#1c4633` | `#3f8a69` | `#263c50` | `#6a8dae` |
| primary-suppl | `#d96706` | `#ffb368` | `#245741` | `#5fb88f` | `#2f4a63` | `#93b3d0` |
| success | `#16a34a` | `#4ade80` | `#15803d` | `#4ade80` | `#15803d` | `#4ade80` |
| warning | `#c9820a` | `#fbbf24` | `#b45309` | `#fbbf24` | `#b45309` | `#fbbf24` |
| danger | `#dc2626` | `#f87171` | `#dc2626` | `#f87171` | `#dc2626` | `#f87171` |
| info | `#2563eb` | `#60a5fa` | `#2563eb` | `#60a5fa` | `#2563eb` | `#60a5fa` |
| bg-color | `#fff8f1` | `#1a130c` | `#f6f8f5` | `#0d1613` | `#f4f6f9` | `#0e1319` |
| card-bg | `#ffffff` | `#241a11` | `#ffffff` | `#15211c` | `#ffffff` | `#161e27` |
| text-main | `#2c1f12` | `#f6ede1` | `#16261f` | `#e8f1ec` | `#1c2530` | `#e9eef4` |
| text-sub | `#5c4a38` | `#cdbcab` | `#3f574c` | `#b6c8bf` | `#44515f` | `#b5c0cc` |
| text-muted | `#877665` | `#9c8b79` | `#5f756a` | `#8b9c93` | `#66717d` | `#8a95a1` |
| border-color | `#f0ddc8` | `#3d2e1f` | `#cfdcd5` | `#2a3b34` | `#d3dbe3` | `#28333f` |

**非 hero token 的成套派生规则（同套骨架，换色不换结构）**：

| 派生 token | 规则 | 例（小学·浅） |
|---|---|---|
| `--primary-light` | primary 与白 90:10 混（浅）/ primary 与 bg 混（深） | `#ffeede` |
| `--primary-soft` | `rgba(<primary-rgb>, 0.10)`（浅）/ `0.14`（深） | `rgba(242, 118, 12, 0.10)` |
| `--primary-soft-strong` | `0.18`（浅）/ `0.24`（深） | — |
| `--primary-rgb` | primary 的 `r, g, b` | `242, 118, 12` |
| `--bg-color-hover` | bg 加深 ~6%（浅）/ 提亮（深） | `#f7ebdf` |
| `--surface-2` | bg 与 card 之间的近白/近深 | `#fffcf9` |
| `--text-on-primary` | 叠在 primary 上的色（浅=白，深=极深） | `#ffffff` |
| `--border-light` | border 更淡一档 | `#f7ecdd` |
| `--success/warning/danger/info-light` | 各自与白 90:10（浅）/ 与 bg 混（深） | — |
| `--success/warning/danger/info-soft` | `rgba(<x-rgb>, 0.10)`（浅）/ `0.14`（深） | — |
| `--success/warning/danger/info-rgb` | 各自 rgb 三元组 | — |
| `--gradient-primary` | `linear-gradient(135deg, <primary> 0%, <更深/更亮搭档> 100%)` | `linear-gradient(135deg, #f2760c 0%, #ffa447 100%)` |

**跨学段恒定（写入 `:root` / `body.dark-mode` 即可，preset 块不覆盖）**：`--shadow-xs/sm/ /md/lg/up`、`--band-*-bg/border`、`--code-color`、`--gradient-warm/cool/success/sunset`、`--on-strong(-rgb)`、圆角/间距/字号/动效。
> 深色下这些"恒定"值由 `body.dark-mode` 提供，**在 `属性=primary + 深` 时仍生效**（属性只覆盖 preset 变量，两者是不同属性、不同声明，互不冲突——见 §2.1 不变量）。

#### 2.3 `palette.ts` 新结构 + `buildThemeOverrides` 新签名

```ts
export type ThemePreset = 'primary' | 'junior' | 'senior'
export type ThemeMode   = 'light' | 'dark'

export interface ThemeColors {
  // —— 与 theme.scss 共享、逐字段断言（★=本轮新增字段）——
  primary: string; primaryHover: string; primaryPressed: string; primarySuppl: string
  success: string; warning: string; danger: string; info: string
  cardBg: string; bgColor: string          // ★ bgColor 新增（图表背景需要）
  textMain: string; textSub: string; textMuted: string
  border: string; borderLight: string       // ★ borderLight 新增（图表轴需要）
}

export interface ThemePalette {
  presets: Record<ThemePreset, Record<ThemeMode, ThemeColors>>   // ★ 2 组 → 6 组
  subjects: SubjectColors                                        // 学科色：主题无关（不变）
  radius: Record<string, string>                                 // 不变
  gradients: Record<ThemePreset, Record<ThemeMode, Record<string, string>>> // ★ 按 (preset,mode)，仅 primary 随学段变
}

// 字号档位：从 App.vue 的 fontSizeMap 迁到 palette.ts（JS 唯一源），供 B1 单一缩放源
export const FONT_SIZE_MAPS: Record<'small'|'medium'|'large', FontSizes> = { ... }

// ★ 新签名：多 preset 参数
export function buildThemeOverrides(
  palette: ThemePalette,
  preset: ThemePreset,
  theme: ThemeMode,
  sizes: FontSizes,
): GlobalThemeOverrides {
  const c = palette.presets[preset][theme]
  // ... 其余逻辑与现状一致（primaryColor 四态/文字/边框/Card.color/sizes 展开）
}
```

- 兼容：旧 `palette.light` / `palette.dark` **移除**，全部调用点（`App.vue` / `Home.vue` / `pdfExporter.ts` / 测试）改为 `palette.presets[preset][mode]`。旧单测同步重写为 6 组（§2.5）。
- `--gradient-primary` 的取值来源统一为 `palette.gradients[preset][mode].primary`，`normalizeColor` 去掉空白后比较。

#### 2.4 `stores/theme.ts` 新结构 + localStorage schema + 初始化时序（防 FOUC）

**就近现状**：`themeMode`/`fontSize` 为纯 `ref`（`:5-6`），`watchEffect`（`:17-22`）写 `body.dark-mode` 与 `documentElement.style.fontSize`。**无持久化**。

**新 store 结构（Pinia setup 风格，沿用现有）**：

```ts
export type FontSize = 'small' | 'medium' | 'large'
const STORAGE_KEY = 'fls:theme'   // 见下 JSON schema

export const useThemeStore = defineStore('theme', () => {
  const themeMode   = ref<'light' | 'dark' | 'system'>('light')
  const fontSize    = ref<FontSize>('medium')
  const preset      = ref<ThemePreset>('junior')     // ★ 新增，默认初中=零回归
  const presetManual = ref<boolean>(false)            // ★ 家长是否手动覆盖过
  // ... actualTheme 计算不变
  // watchEffect：同步 body.classList(dark-mode) + body.dataset.themePreset = preset.value
  //   注意：B1 后不再写 documentElement.style.fontSize（见 §4.1）
  // setTheme / setFontSize / setPreset(manual) / restoreAuto()
})
```

**localStorage JSON schema**（键 `fls:theme`）：

```json
{ "preset": "primary|junior|senior", "mode": "light|dark|system",
  "fontSize": "small|medium|large", "presetManual": true|false }
```

- **读取**：同步 `JSON.parse`，逐字段校验枚举，缺失/非法 → 用默认（`junior` / `light` / `medium` / `false`）。旧键不存在即"首装"，等价默认。
- **写入**：任一 `ref` 变化 → `watch(..., {deep})` 同步写回（写的是原始"意图"值，`preset` 存原始、`mode` 存 `system` 而非解析值）。
- **载体 = `localStorage`**（用户已拍板）：同步读，`store` 首次求值（App setup 期）即可应用，避免异步闪色。

**初始化时序（双保险防 FOUC）**：

```
① <body> 内联启动脚本（index.html，body 首个元素）
     ├─ 同步读 localStorage['fls:theme']
     ├─ document.body.classList.toggle('dark-mode', resolveDark(pref))
     └─ document.body.dataset.themePreset = pref.preset || 'junior'
        —— 在 #app 渲染、首帧绘制之前执行，消灭"先白后深"闪色
② main.ts 创建 pinia → useThemeStore()（setup 内 hydrate 同源 localStorage）
     └─ watchEffect 再次对齐（幂等；与①一致）
③ App.vue <ThemeProvider> 用 store 值算 themeOverrides（naive-ui 侧）
```

> 为什么需要①：即使 store 在 setup 同步 apply，`index.html` 到 Vue mount 之间仍有一帧；① 把 state 落到 `body` 上，令 `theme.scss` 的 6 组选择器在首帧即命中。①与②共用同一 schema，**小且唯一**。`system` 模式的深色解析（`prefers-color-scheme`）在①与②都做一次。

#### 2.5 年级 → 主题推断纯函数（签名、位置、单测）

- **位置**：新建 `src/core/theme/presetInference.ts`（纯函数、无副作用、无 Vue/Pinia/Dexie 依赖）。**不放进 store**：store 只做编排（调用 + 决定是否覆盖），保证可单测。
- **签名**：

```ts
export interface GradeSource {
  grade: number
  updatedAt?: string      // manifest.updatedAt
  createdAt?: string      // manifest.createdAt
}
export function gradeToPreset(grade: number): ThemePreset      // ≤6→primary, 7-9→junior, ≥10→senior
export function inferPreset(sources: GradeSource[]): { preset: ThemePreset; grade: number | null; usedFallback: boolean }
```

- **规则**：取 `grade` **众数**；并列取 `updatedAt ?? createdAt` **最新**者；空数组 → `{ preset: 'junior', grade: null, usedFallback: true }`（默认初中，零回归）。
- **应用时机（编排在 store / 调用方）**：
  - 仅当 `presetManual === false` 时应用推断结果；
  - **首次且 `presetManual===false`** → 自动 `setPreset(inferred)`（不置 manual）；
  - 家长**手动**切换 → `presetManual = true`，此后**永久停止覆盖**；UI 提供"恢复自动"（置回 `false` 并立即重新推断）。
  - 触发点：`packageStore.loadPackages()` 之后（设置页/首页挂载时）调用 `themeStore.reconcilePreset(packages.map(p => p.manifest))`。
- 数据源：`packageStore.packages[].manifest.grade`（`ImportWizard.vue:20` 约束 1–9；`manifest.grade` 为 `number`）。

#### 2.6 一致性测试如何从 2 组扩展到 6 组（**命脉，不空洞**）

> 该测试是"双源防漂移"的唯一兜底网（`palette.ts` JS 源 ⇄ `theme.scss` CSS 源）。扩展后**更强**，绝不允许被弱化。

**解析策略（按选择器抽块 + 模拟继承，镜像浏览器语义）**：

1. 读 `theme.scss` 原文，新增 `extractBlock(text, selectorLine)`：从选择器行起花括号配对，抽出该块内所有 `--x: value;`。
2. 抽 6 个"原始块"：
   - `:root`（合并两处 `:root`：尺寸块 + 颜色块）
   - `body[data-theme-preset="primary"]`
   - `body[data-theme-preset="senior"]`
   - `body.dark-mode`（合并"变量块 + 组件微调块"，微调块无 `--x:` 定义，天然无害）
   - `body[data-theme-preset="primary"].dark-mode`
   - `body[data-theme-preset="senior"].dark-mode`
3. **合成 6 个"生效变量表"（模拟继承）**：
   - `junior.light = :root`
   - `junior.dark  = dark-mode`
   - `primary.light = { ...:root,        ...primaryBlock }`
   - `primary.dark  = { ...dark-mode,    ...primaryDarkBlock }`
   - `senior.light  = { ...:root,        ...seniorBlock }`
   - `senior.dark   = { ...dark-mode,    ...seniorDarkBlock }`
   > 这正是浏览器里"preset 覆盖 = 就近声明胜出"的等价；**能捕获"漏了某覆盖"**。
4. **断言 A（数值一致，防漂移）**：对每个 `(preset, mode)`，遍历 `ThemeColors` 共享字段（`FIELD_TO_VAR` 映射，含新增 `bgColor→--bg-color`、`borderLight→--border-light`），`normalize(palette.presets[p][m][f]) === normalize(effective[mode][var])`。规模 = 6 × ~15 ≈ 90 用例。
5. **断言 B（数值源齐全）**：`radius`（对 `:root`）、`gradients[preset][mode][*]`（对合成表，6×5=30）、`subjects`（对 `variables.scss` 常量，不变）。
6. **断言 C（结构性，防"抄漏"与"漏组合块"）**：
   - 6 组的生效表**键集合必须完全相同**（新增/改一个 token 时，6 组都要补，否则红）；
   - `body[data-theme-preset="primary"].dark-mode` 与 `...senior...` 两个组合块**存在且非空**（守住 §2.1 不变量 2）；
   - 白名单 token（`-rgb`/`band-*`/`code-color`/`shadow-up`/`on-strong*`）在浅深两段成对存在（沿用现状断言，扩到新结构）。
7. **断言 D（`buildThemeOverrides`）**：对全部 6 个 `(preset,theme)` 断言 `common.*/Card.*/sizes` 正确透传（现状 2 组 → 6 组）。

**用例规模**：现状 80 → 预计 **200+**（90 数值 + 30 渐变 + 30+ 结构 + 6×4 派生函数）。**旧 2 组断言全保留为 6 组展开**，不删任何既有守护点。
**失败信息**：附 `preset.mode.field` 与两值 + 变量名，便于定位漂移。

---

### 3. A2 成就体系架构

#### 3.1 `AchievementDef` 扩展字段（沿用现有纯函数结构）

```ts
export type AchievementCategory = 'M' | 'G' | 'B' | 'E'   // 精熟/成长/行为/探索
export interface AchievementDef {
  id: string
  icon: string
  title: string
  desc: string
  category: AchievementCategory     // ★ 新增
  hidden?: boolean                  // ★ 新增（解锁前剪影，不给暗示）
  chain?: string                    // ★ 新增（连环 id）
  order?: number                    // ★ 新增（链内顺序）
  check: (ctx: AchievementContext) => boolean
}
```
- 既有 9 枚 **id / title / desc / check 语义完全不变**，仅补 `category/hidden/chain/order`。
- 连环元数据独立：`src/core/motivation/chains.ts` → `export interface ChainDef { id; name; ids: string[] }`，`export const CHAINS: ChainDef[]`（坚持/错题/精熟/探索四链，见 PRD §5.1）。

#### 3.2 `AchievementContext` 扩展 + 数据可得性落地

```ts
export interface AchievementContext {
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  streak: StreakState
  packages?: { packageId: string; subject: string; grade: number; term: string; packageType: string; kpCount: number }[]
  dailyStats?: DailyStat[]
  attemptedTypes?: string[]
}
```
- `packages`：由 `packageStore.packages` 映射（`manifest.subject/grade/term/packageType` + `kpCount = pkg.knowledgePoints.length`），在调用 `syncAchievements` 处组装。
- `dailyStats`：新模块（§3.3）。
- `attemptedTypes`：**真实题型来源已确认**（核查 §0-1）；由 `recordAnswerEvent` 记录（§3.3）。

#### 3.3 `dailyStats` 模块 + 热路径写入策略（**避免双写放大**）

现状热路径（`userData.recordProgress`，`:166-269`）已有 2 次写：`db.progress.put/add` + `touchStudyDay→db.settings.put`。**再叠加一次 settings 写 = 双写放大**，故**不逐题落盘**。

**新模块 `src/core/motivation/dailyStats.ts`**：

```ts
export interface DailyStat { date: string; questionCount: number; firstStudyAt: number; lastStudyAt: number }
const KEY = 'dailyStats'
export const RETAIN_DAYS = 60
export function localDayKey(d?: Date): string            // 复用 streak.ts 的本地日期口径（勿用 UTC）
export async function loadDailyStats(): Promise<DailyStat[]>
export function bumpDailyStats(opts: { count?: number; at?: Date }): void   // 内存累加，触发防抖落盘
export async function flushDailyStats(): Promise<void>                       // 落盘 + 裁剪保留 60 天
```

**写入策略（内存聚合 + 防抖落盘）**：
1. 每次作答事件：**仅更新模块级内存缓存**（`questionCount += n`、`firstStudyAt = min(旧, at)`、`lastStudyAt = max(旧, at)`；本地日期键）。
2. **防抖落盘**：尾部 1500ms 防抖调用 `flushDailyStats()`；并在 `visibilitychange→hidden`、`beforeunload` 各强制 flush 一次。
3. **裁剪**：flush 时保留最近 **60 天**（本地日期排序截断），防膨胀。
4. **计量口径 = "题"不是"知识点"**：一次作答可能触达多个 KP（`TopicDetail:503` 的 for 循环）。因此 `dailyStats` 的 `+1` **在"题目级"点位累加，绝不放 `recordProgress` 内部**（否则多 KP 会重复计数）。

**新增答题事件点位（一次性、题目级）**：
- `userData` 新增 `recordAnswerEvent(payload: { exerciseId?: string; questionType?: string; at?: Date }): void`
  - 内部：`bumpDailyStats({count:1})` + 把 `questionType` 记入 `attemptedTypes`（settings 键 `attemptedTypes`，**Set 去重**，同样防抖落盘）。
- 调用点（各**一次/题**）：`TopicDetail.handleAnswer`（:493）、`TopicDetail.handleWarmupAnswer`、`ExamPanel.handleAnswer`（:329，考试为 N 题 → 逐题 emit 已各自调用）、`VocabDrill.writeProgress`（:266，写入 `questionType:'spelling'`）。
  - 考试聚合优化：`ExamPanel` 可在 `finalize` 时一次性 `bumpDailyStats({count: N})`（可选，见任务说明）。

> 开销评估：把"每题 1 次 IndexedDB 写"降为"每次空闲 1 次写"，热路径**几乎零额外 I/O**；代价是"崩溃丢最近 ≤1.5s 计数"（可接受，属统计埋点）。

#### 3.4 成就存储迁移（`string[]` → `{id, unlockedAt}[]`，读时兼容）

```ts
export interface UnlockedRecord { id: string; unlockedAt: string }  // unlockedAt='' 表示旧数据未知
function normalizeUnlocked(raw: unknown): UnlockedRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(v => typeof v === 'string'
    ? [{ id: v, unlockedAt: '' }]
    : (v && typeof v.id === 'string' ? [{ id: v.id, unlockedAt: String(v.unlockedAt ?? '') }] : []))
}
```
- **读**：`loadUnlocked()` 用 `normalizeUnlocked` 兼容旧 `string[]` 与半迁移态；保留 `loadUnlockedIds()`（返回 id 数组）供旧调用。
- **写**：新解锁写 `{ id, unlockedAt: localDayKey(now) }`（**本地日期**，`YYYY-MM-DD`）。
- **语义**：仍**只增不减**（`syncAchievements` 合并去重、旧记录 `unlockedAt` 原样保留）。
- **展示**：`unlockedAt===''` → 显示"—"或"较早"。

#### 3.5 隐藏 / 连环的元数据与展示

- 隐藏 3 枚（`comeback`/`early-bird`/`night-owl`）：`hidden:true`。**未解锁前不给任何暗示**：成就墙显示灰底剪影 + 🔒 + `？？？` + "达成后揭晓"；**不显示 icon/title/desc/条件**。解锁后完整展示 + "隐藏成就已解锁！"揭晓动效。
- 连环：`chains.ts` 定义 4 链；成就墙在已解锁环旁显示"下一环：<icon><name>"与进度；后续未解锁环仅显示剪影。

#### 3.6 新解锁动效 + `prefers-reduced-motion`

- 触发：`syncAchievements` 返回的 `newlyUnlocked`（已存在）。
- 形态：`components/AchievementToast.vue` — 徽章卡片居中/顶部弹出，轻微放大回弹（复用 `--ease-spring`）+ 光晕；多枚**依次播放**。
- 无障碍：`const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches` → **真则退化为静态提示**（无动画、无回弹），不改变信息量。
- 落点：`Home.vue` `onMounted` 的 `syncAchievements` 结果处，替换现有 `message.success('🏅 解锁新成就…')`（:341-344）。

#### 3.7 家长端可见（A2-5，**新建**）

- `Parent.vue` 新增「🏅 成就概览」section（数据只读）：`已解锁 N / 28`、四类分布（M/G/B/E 各自已解锁/总数）、**最近解锁 3 枚**（按 `unlockedAt` 倒序，空日期排最后）。
- 数据来源：`loadUnlocked()` + `ACHIEVEMENTS` + `CHAINS`。`Parent.vue` 现有 section 结构（`.section`/`.section-title`/卡片）可复用。
- `Report.vue` 成就里程碑 = **P1，本轮可延后**。

---

### 4. B1–B7 各项设计

#### 4.1 B1 · 修 `fontSizeMap` 双缩放（✚ 与 B5 合并设计）

**实测两处生效范围**：
- `App.vue:150-160` `fontSizeMap` → 经 `buildThemeOverrides` 注入 naive-ui `common.fontSize*`：**只影响 naive-ui 组件**（用 px，naive 默认 base 14px）。
- `theme.ts:20` `documentElement.style.fontSize`（14/16/18px）：**只影响"未显式设 font-size 的继承文本"**（`medium=16px` 恰为浏览器默认，近 no-op；`small/large` 才改变继承文本）。全库**零 `rem`**（已核实），故对 px 布局无影响。

**选型（单一缩放源）**：**保留 naive-ui `themeOverrides`（`FONT_SIZE_MAPS`）为唯一缩放源；移除 `theme.ts` 对 `documentElement.style.fontSize` 的写入**（`:20-21`）。
- 理由：naive 组件是可见文本主体且默认必须靠覆盖缩放；根字号写入会与覆盖**并行、按不同系数**影响继承文本，是"双缩放"来源。
- **影响面**：
  | 对象 | 现状 | 变更后 |
  |---|---|---|
  | naive-ui 组件 | 随档位缩放 | **不变**（仍缩放） |
  | 显式 px 的自定义组件 | 不随档位缩放 | **不变** |
  | 无 font-size 的继承文本 | 随根字号缩放 | **固定 16px 基准**（不再随档位）——这是"消除第二次缩放"的**预期收益** |
- **落地（与 B5 合并）**：`fontSizeMap` 现位于 `App.vue`，B5 拆分后移入 **`ThemeProvider.vue`**；同时把常量 `FONT_SIZE_MAPS` 提取到 **`palette.ts`**（JS 唯一源），`ThemeProvider` 引用之。`theme.ts` 只保留 `preset/mode` 的状态应用。
- **验证**：small/medium/large 逐档实测"只缩放一次"；`vue-tsc` 0 error。

#### 4.2 B2 · JS 取色统一（服务层边界）

**边界规则：组件层（views/modules/components）不得直接 `import { palette }`；一律经服务层。**

- `src/core/theme/useThemeTokens.ts`（新）：
  - `useThemeTokens()`：读当前**生效** CSS 变量数值（`getComputedStyle(document.body).getPropertyValue('--x')`），返回 `computed` 对象；依赖 `themeStore.preset/actualTheme` 变化重算。供模板内联 `style` 取真值场景。
  - `resolveToken(name): string`：一次性取值（非响应式），供一次性计算。
- `src/core/theme/useChartTheme.ts`（新）：`useChartTheme()` 返回 echarts 主题色（轴 `axisLine/splitLine` ← `--border-light`/`--border`；文字 `--text-sub`；tooltip 背景 `--card-bg`、字色 `--text-main`；色块 `--success/--warning/--border` 等，来自 `useThemeTokens`）。**Home echarts 改用它**。
- `pdfExporter.ts`：**PDF 固定浅色** —— `backgroundColor` 与截图内容统一取**当前 preset 的 light 值**（`palette.presets[activePreset].light`，导出前临时去掉 `dark-mode`/加 `force-light`，截图后恢复，见 B3）。
- 现状散落点回收：`Home.vue:189/350-365`（改服务层）、`pdfExporter.ts:16`（改 preset-light）、模板内联 `style`（`Home.vue:151/158/165` 已是 `var(--x)`，合规）。

#### 4.3 B3 · 图表 / PDF / 打印主题

- **深色图表可读**：echarts 走 `useChartTheme`（轴/文字/tooltip/色块随明暗）；`Home.vue` 在 `watchEffect` 内 `chart.setOption(chartThemeOption)` 并 `chart.resize()`，主题切换即时重绘。
- **PDF 固定浅色**：导出流程 `pdfExporter.exportReportAsPDF` 前置：给导出根元素加 `.force-light`（或用 `themeStore` 临时切 light + 去 `dark-mode`），`await nextTick`/下一帧后 `html2canvas`，完成 `finally` 恢复原主题。`backgroundColor` 取 preset light `cardBg`。
- **打印固定浅色**：`theme.scss` 新增 `@media print { body { color-scheme: light; } }` 兜底 + JS `window.addEventListener('beforeprint', …)` 临时移除 `dark-mode`、`afterprint` 恢复（保证 `Ctrl+P` 与打印预览为浅色）。二者取"JS 为主、CSS 兜底"。

#### 4.4 B4 · PWA / Tauri 分端

- **判定手段（零依赖）**：新建 `src/core/pwa/isTauri.ts`：
  ```ts
  export const isTauri = (): boolean =>
    typeof window !== 'undefined' &&
    (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window))   // Tauri v2 / v1 注入的全局
  ```
  > 依据：`package.json` 无 `@tauri-apps/api`（仅 `@tauri-apps/cli` devDep），故**不引入依赖**，用全局探测。Tauri v2 注入 `__TAURI_INTERNALS__`，v1 注入 `__TAURI__`，两者都判。
- `PWAUpdateBar.vue`：模板根加 `v-if="!isTauri()"`（或以 `isTauri()` 直接 `return null`）。Web 端行为不变；Tauri 下不渲染 SW 更新条。

#### 4.5 B5 · `App.vue` 拆分

- `src/components/ThemeProvider.vue`：封装 `<n-config-provider :theme :theme-overrides>`，内部用 `buildThemeOverrides(palette, preset, actualTheme, FONT_SIZE_MAPS[fontSize])`；`<slot/>`。承载 B1 的字号源与 B5 的覆盖计算。
- `src/components/AppShell.vue`：侧栏 + 顶栏 + 底部 tab + `.app-main`（含 `router-view` slot 或直接内置）。布局样式从 `App.vue <style>` 迁入。
- `App.vue`：仅 `ThemeProvider > n-message-provider > n-dialog-provider > AppShell + PWAUpdateBar`；`<style>` 只留极薄全局（或归零）。
- `buildThemeOverrides` 保持 `palette.ts` 内纯函数（补 preset 参）。
- 验收：`vue-tsc` 0 error；导航/布局无回归。

#### 4.6 B6 · 防回潮门禁

- **首选**：Stylelint（`stylelint` + `stylelint-declaration-strict-value` 或自定义正则规则）→ `npm run lint:styles`。**需新增 devDep，沙箱风险高。**
- **降级（必交付，零依赖）**：`scripts/check-hex.mjs` + `package.json` 脚本 `"check:hex": "node scripts/check-hex.mjs"`。
  - 扫描：`src/views/**`、`src/modules/**`、`src/components/**` 下 `*.vue|*.ts|*.scss`（**递归**）。
  - 命中：`#([0-9a-fA-F]{3,8})\b` 或 `rgba?\(\s*\d`（数字开头的 rgba/rgb）。
  - 白名单（不扫描/放行）：`src/core/styles/**`（含 `theme.scss`/`variables.scss`/`palette.ts`）；行内豁免注释 `// check-hex-allow` / `/* check-hex-allow */`。
  - **存量例外处置决定**（`Home.vue:437` `filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15))`）：
    **采用"放行纯黑阴影"** —— 在脚本中豁免匹配 `rgba(0, 0, 0,`（纯黑，任意 alpha）的行，与 `theme.scss` 既有 `rgba(0, 0, 0, 0.06)` 约定一致。
    > **不新增 token 的理由**：`$shadow-*` 是 **box-shadow 简写**，**无法用于 `filter: drop-shadow`**；且该阴影只作用于渐变横幅上的装饰 emoji，浅深同值、无主题价值。为单点装饰新增第 6 类 token 属过度设计。**若产品坚持零硬编码，则退路** =正式登记 `--shadow-drop` 为白名单**第 6 类**（浅深各 1），此处已列明但不采用。
  - 失败判定：对现存代码 `exit 0`；人为注入 `#123456` 时 `exit ≠ 0`。

#### 4.7 B7 · 视觉回归基线

- **首选（高风险）**：Playwright 截图矩阵：浅/深 × 8 类页面（首页/报告/搜索/复习/错题/家长/学习子页/模块）× 关键状态。**需 `@playwright/test` + 浏览器内核（数百 MB），沙箱概率失败。**
- **降级（必交付，零依赖）**：`docs/视觉回归清单.md`（人工核对清单，覆盖 8 类 × 浅/深）+ `docs/screenshots/`（截图留档，命名 `{页面}-{light|dark}.png`）。
- **切换条件**：`npm i -D @playwright/test` 或 `npx playwright install chromium` 任一步**失败/SIGTERM/超时** → 立即降级并如实上报，不阻塞其余任务。

#### 4.8 B1–B7 决策小结

| 项 | 决策 | 风险 |
|---|---|---|
| B1 | naive 覆盖为单一源，移除根字号写入 | 低（零 rem，影响面小） |
| B2 | 服务层 `useThemeTokens`/`useChartTheme`；组件禁 import palette | 中（Home 图表重构） |
| B3 | echarts 随主题；PDF/print 固定浅色（JS 主 + CSS 兜底） | 中 |
| B4 | 全局探测 `isTauri()`，零依赖 | 低 |
| B5 | ThemeProvider + AppShell 拆分，`FONT_SIZE_MAPS` 入 palette | 中（回归） |
| B6 | 首选 Stylelint；**必交付** check-hex.mjs；放行纯黑阴影 | 依赖风险高 |
| B7 | 首选 Playwright；**必交付** 人工清单 + 截图 | 依赖风险高 |

---

### 5. C1 `git init` 方案

**现状**：根无 `.git`、无 `.gitignore`；根有 **7 个 exe** + `dist/` + `node_modules/` + `src-tauri/target/`（含大量 `.exe`）+ 若干中文 `.txt`。

**`.gitignore` 完整建议内容**：

```gitignore
# 依赖
node_modules/
# 构建产物
dist/
dist-ssr/
.vite/
# Rust / Tauri 构建产物与打包
src-tauri/target/
src-tauri/gen/
# 根目录手工打包的 exe（本项目不纳入版本库）
/*.exe
# 临时脚本
*.tmp*
.tmp-*
# 环境
*.local
.env
.env.*
!.env.example
# 日志
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
# 测试缓存 / 覆盖率
.vitest-cache/
coverage/
# 编辑器 / 系统
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
Thumbs.db
# 视觉回归产物（截图留档需提交，故仅忽略临时 diff 输出）
tests/e2e/**/*-diff.png
test-results/
playwright-report/
```
> `/*.exe` 仅锚定仓库根（不误伤 `src-tauri/target/**`，后者已整目录忽略）。
> 中文 `.txt`（提示词/规范/方案）**默认纳入**（属项目资产）；若体积过大再由工程师单独确认。

**提交顺序（先基线后改动，便于 diff 审阅）**：
1. 新建 `.gitignore`；
2. `git init`；`git add -A`；
3. **检查暂存区**：`node_modules/`、`dist/`、`src-tauri/target/`、根 `*.exe` **均不在**暂存区（`git status` 干净）；
4. **initial commit**：`chore: baseline v1.8.0`（此时代码仍为 1.8.0，未改任何源码）；
5. 进行本轮其余任务；
6. 收尾提交：版本号 `1.9.0` + 侧栏 `V1.9` → `feat: v1.9.0 多学段主题 + 成就扩充 + 质量门禁`；
7. `git tag -a v1.9.0 -m "路线图 V1.1 批次"`。
   > 依据：**先 commit 1.8.0 基线** → 本轮所有改动可 `git diff` 审阅（团队要求）。tag 打在**最终** commit 上。

---

### 6. 文件清单（新增 / 改动）

**新增（`NEW`）**
```
.gitignore                                      # C1
scripts/check-hex.mjs                           # B6 降级门禁（零依赖）
src/core/theme/presetInference.ts               # A1-3 年级→主题纯函数
src/core/theme/useThemeTokens.ts                # B2 读生效 CSS 变量
src/core/theme/useChartTheme.ts                 # B2/B3 echarts 主题
src/core/motivation/dailyStats.ts               # A2-2b 每日统计（内存聚合+防抖）
src/core/motivation/chains.ts                   # A2-1 连环元数据
src/components/ThemeProvider.vue                # B5 + B1
src/components/AppShell.vue                     # B5
src/components/AchievementToast.vue             # A2-4 解锁动效
src/core/pwa/isTauri.ts                         # B4
tests/achievements.test.ts                      # A2 判定条件单测（28 枚）
tests/daily-stats.test.ts                       # A2-2b 统计/裁剪/去重
tests/preset-inference.test.ts                  # A1-3 众数/并列/默认
docs/视觉回归清单.md                            # B7 降级基线
docs/screenshots/                               # B7 截图留档目录
```

**改动（`MOD`）**
```
src/core/styles/theme.scss                      # A1-1 6 组选择器（§2.1/2.2）
src/core/styles/variables.scss                  # 门面：新增字段别名（结构基本不变）
src/core/styles/palette.ts                      # A1-1 presets 新结构 + buildThemeOverrides 新签名 + FONT_SIZE_MAPS
tests/palette-consistency.test.ts               # §2.5 扩到 6 组（200+ 用例）
src/core/stores/theme.ts                        # A1-0 preset/presetManual + localStorage + 初始化应用；B1 去根字号写
src/App.vue                                     # B5 拆分（仅组合）+ 侧栏 V1.8→V1.9（两处）
index.html                                      # A1-0 防 FOUC 内联启动脚本
src/views/Settings.vue                          # A1-2 预设卡片 + 推荐提示条（正交三控件）
src/views/Home.vue                              # A2-3 成就墙升级 + A2-4 动效接入 + B2/B3 echarts 走服务层
src/views/Parent.vue                            # A2-5 成就概览（新建区块）
src/core/motivation/achievements.ts             # A2-1/A2-2 28 枚 + Def/Context 扩展 + 存储迁移
src/core/stores/userData.ts                     # A2-2b 新增 recordAnswerEvent（热路径埋点）
src/core/report/pdfExporter.ts                  # B2/B3 PDF 固定浅色（preset light）
src/core/pwa/PWAUpdateBar.vue                   # B4 Tauri 下不渲染
package.json                                    # C1 无关；B6 加 "check:hex" 脚本；版本 1.9.0
src-tauri/tauri.conf.json                       # 版本 1.9.0
src-tauri/Cargo.toml                            # 版本 1.9.0
```

**可能改动的调用点（受 B2 边界影响，需核对）**：`src/views/learn/TopicDetail.vue`、`src/views/learn/ExamPanel.vue`、`src/modules/core/VocabDrill.vue`（新增 `recordAnswerEvent` 调用，各 1 行级）。

---

### 7. 任务分解（≤5 个，含依赖与并行标注）

> 遵循硬上限：**≤5 个任务**，按模块分组，避免线性链。**首个任务 = 工程基线与主题数据层**（配置/入口/依赖声明 + 主题唯一源，全在一个任务）。

| ID | 任务名 | 源文件 | 依赖 | 优先级 |
|---|---|---|---|---|
| **T01** | **工程基线 + 主题数据层**（C1 + A1-0 前置 + A1-1） | `.gitignore`(新)、`src/core/styles/theme.scss`、`variables.scss`、`palette.ts`、`tests/palette-consistency.test.ts`、`src/core/theme/presetInference.ts`(新)、`tests/preset-inference.test.ts`(新)、`src/core/stores/theme.ts` | — | P0 |
| **T02** | **主题呈现与切换**（A1-2 + A1-3 接线 + B1 + B5 + B2/B3 服务层） | `index.html`、`src/App.vue`、`src/components/ThemeProvider.vue`(新)、`AppShell.vue`(新)、`src/core/theme/useThemeTokens.ts`(新)、`useChartTheme.ts`(新)、`src/core/report/pdfExporter.ts`、`src/views/Settings.vue` | T01 | P0 |
| **T03** | **成就体系**（A2-1…A2-5 + Home.vue 全量含 echarts 走服务层） | `src/core/motivation/achievements.ts`、`dailyStats.ts`(新)、`chains.ts`(新)、`src/core/stores/userData.ts`、`tests/achievements.test.ts`(新)、`tests/daily-stats.test.ts`(新)、`src/views/Home.vue`、`src/views/Parent.vue`、`src/components/AchievementToast.vue`(新)、`src/core/pwa/isTauri.ts`(新) | （**无**，与 T01/T02 独立）| P0 |
| **T04** | **质量门禁**（B6 + B7；B4 归此或 T02） | `scripts/check-hex.mjs`(新)、`package.json`(script)、`docs/视觉回归清单.md`(新)、`docs/screenshots/`(新目录) | （**无**）| P0 |
| **T05** | **集成收尾：版本号 1.9.0 + tag v1.9.0 + 全量回归** | `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src/App.vue`(侧栏 V1.9) | T02、T03、T04 | P0 |

**并行关系**：
- **批A（串行，最先）**：`T01`（主题唯一源 + 一致性测试；为 T02 提供 `palette.presets` / `buildThemeOverrides` 新签名 / store 新结构）。
- **批B（可并行）**：`T01` 完成后，`T02 ∥ T03 ∥ T04` 三线并行。
- **批C（串行，最后）**：`T05`（打 tag、版本、整体回归）。

> ⚠️ **并行唯一冲突点**：`Home.vue` 同时被"B2 echarts（T02）"和"A2-3 成就墙（T03）"触及。
> **裁决：`Home.vue` 整体归 T03 独占**（含其 echarts 改 `useChartTheme`）；**T02 明确不改 `Home.vue`**。这样 T02 与 T03 可真正并行。`package.json` 被 T04（加脚本）与 T05（版本号）触及 → **T04 先于 T05**。

**未删减范围**：10 项设计全部在本表内（A1-0/1/2/3→T01+T02；A2-1..5→T03；B1/B2/B3/B5→T02；B4→T02 或 T04；B6/B7→T04；C1→T01+T05）。若一次交付过大，**分批建议**见上"批A/批B/批C"——依据是**主题数据源必须先于其消费者**、**成就线全独立**、**门禁必须在颜色改动冻结后统一跑**。

---

### 8. 共享知识（跨文件硬约定）

1. **颜色单一源**：`theme.scss` 是**唯一 CSS 源**；`palette.ts` 是**唯一 JS 数值源**（naive-ui 需真值）；`variables.scss` 只是 SCSS 门面（`$x = var(--x)`），不产生真值。
2. **6 组成对**：任何主题色变量变化，**6 组选择器必须同步**（`:root`/两个 preset 浅/`body.dark-mode`/两个 preset 深）；一致性测试**键集合相等**断言会拦截遗漏。
3. **深色 + 非默认学段 = 组合选择器**：`body[data-theme-preset="X"].dark-mode`(0,2,1) **必须存在**，否则深色被学段浅色压盖（历史 bug 类型）。
4. **组件零硬编码**：`src/views/**`、`src/modules/**`、`src/components/**` 内**禁止** `#hex` / `rgba(数字`（例外：放行纯黑 `rgba(0, 0, 0,` 阴影；行内豁免注释 `check-hex-allow`）。
5. **组件禁 import palette**：JS 取色一律经 `useThemeTokens` / `useChartTheme` / `pdfExporter`；PDF **固定浅色**（preset light）。
6. **不新增 token**（沿用上一轮白名单 5 类），除非正式登记为第 6 类（本轮 B6 决定**不**新增，改"放行纯黑阴影"）。
7. **字号单一源**：`FONT_SIZE_MAPS`（palette.ts）→ `ThemeProvider` → naive 覆盖；**禁止**再写 `documentElement.style.fontSize`。
8. **日期口径 = 本地日期**：`dailyStats`/`unlockedAt` 一律 `localDayKey`（`YYYY-MM-DD` 本地），**勿用 UTC/`toISOString`**（沿用 `streak.ts` 约定）。
9. **成就只增不减**：`syncAchievements` 幂等合并；存储升级 `{id,unlockedAt}[]` 但**读时兼容旧 `string[]`**。
10. **埋点计数在"题"级**：`dailyStats` 的 `+1` 只在 `recordAnswerEvent`（题目级）累加，**不得**放进 `recordProgress`（多 KP 会重复计数）。
11. **隐藏成就零暗示**：未解锁前不出现 icon/title/desc/条件。
12. **动效尊重 `prefers-reduced-motion`**：命中即退化静态。
13. **Tauri 判定零依赖**：用 `__TAURI_INTERNALS__`/`__TAURI__` 全局探测，不引入 `@tauri-apps/api`。
14. **新增依赖**：仅 B6/B7 可能引入（Stylelint / Playwright），**沙箱风险高**；失败即降级并上报，不得阻塞。
15. **测试同步**：凡改 `palette`/`theme.scss`/成就判定/推断逻辑，**必须同步维护对应测试**，不得留红/留空洞。

---

### 9. 待明确事项（歧义 + 建议）

| # | 事项 | 我的默认处理 | 是否需用户确认 |
|---|---|---|---|
| 1 | 深色下小学暖橙/高中蓝灰**语义色**对比度 | 初判正文/主按钮对比度足够（暗底 + 高亮色）；若某语义色 < 4.5:1，**按用户已拍板**允许微调该主题深色语义色，并在本文**登记被调值 + 理由**（工程实施时回填） | 已拍板（允许微调），仅需回填记录 |
| 2 | `--gradient-primary` 派生搭档色 | 取 `<primary> → <primary 的深/亮搭档>`（沿用初中 `#2d6a4f→#4fa57f` 结构），具体 hex 由工程按派生规则生成并锁进一致性测试 | 否（派生规则已定） |
| 3 | PDF 固定浅色用**哪个 preset 的浅色** | 取**当前激活 preset 的 light**（与孩子主题一致），而非固定 junior | 建议确认（低风险） |
| 4 | 考试埋点计"题"还是"题×KP" | 计**题**（`finalize` 一次 `count=N` 或逐题 emit 各 +1，二者等价需工程二选一并统一） | 否（口径已定为"题"） |
| 5 | `attemptedTypes` 是否含 `essay` 自评题 | **含**（`rateSelf` 也 emit answer），故上限 7 种 | 否 |
| 6 | 是否把"答题聚合逻辑"下沉到 store（顺带消除 4 处重复） | **本轮不做**（降回归风险），仅新增 `recordAnswerEvent`；重构留待下轮 | 否 |
| 7 | `.gitignore` 是否忽略根目录中文 `.txt`（提示词/规范） | **默认纳入**（项目资产），体积过大再议 | 建议确认 |
| 8 | 首帧防 FOUC 内联脚本是否可接受（`index.html`） | **采用**（标准做法，零依赖，最小侵入） | 否 |

---

### 10. 风险登记（含缓解）

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| **6 组变量维护成本** | 高 | 变量集 ×3；改一个 token 要动 6 处 | 一致性测试**键集合相等**断言（改漏即红）；"维度 A/B 拆分"把恒定项集中到 `:root`/`body.dark-mode`，preset 块只覆盖差异项；SCSS 派生规则表（§2.2）减少手填 |
| **CSS 特异性**（历史 bug 类型） | 高 | 相等特异性下源顺序决定 → 深色可能串成学段浅色 | 组合选择器 (0,2,1) > 单维 (0,1,1)；测试**结构性断言组合块存在**；主题变量仅定义于 `theme.scss`；`index.scss` 保持无主题变量 |
| **沙箱依赖**（Stylelint / Playwright） | 高 | `npm install` 不友好（历史 SIGTERM） | B6 **必交付**零依赖 `check-hex.mjs`；B7 **必交付**人工清单 + 截图；明确失败即降级、不阻塞；Stylelint/Playwright 仅"尽力尝试" |
| **热路径 IndexedDB 写** | 中 | 逐题写会放大 I/O | 内存聚合 + 1500ms 防抖 + 隐藏/卸载强制 flush；计数放"题"级避免多 KP 重复；保留 60 天防膨胀 |
| **`App.vue` 拆分回归** | 中 | 拆 ThemeProvider/AppShell 可能丢样式或断 `router-view` | 纯搬迁（先断言无行为变化）+ `vue-tsc` 0 error + 逐页目测；提交粒度独立（先基线后改，可 diff/回退） |
| **B2 取色边界破漏** | 中 | 组件仍可能残留 import palette | 门禁 + code review；Home echarts 显式改造；打印/PDF 固定浅色回归核对 |
| **防 FOUC 脚本与 store 双写不一致** | 低 | 内联脚本与 store 解析规则不一致会闪色 | 共用同一 `fls:theme` schema 与 `resolveDark`/`preset` 规则；脚本最小化 |
| **B1 移除根字号影响继承文本** | 低 | 极少数无 font-size 文本不再随档位 | 明确为预期收益；抽查关键页；如需，改为"继承文本引用统一 size 变量"（下轮） |
| **版本号双轨混淆** | 低 | V1.1（路线图）vs 1.9.0（app） | 文档标注"= 路线图 V1.1 批次"；仅改 1.9.0 + tag `v1.9.0` |

---

## Part B · 交付物与验收口径

- **主设计**：本文件 `docs/system_design-v1.1.md`。
- **序列图**：`docs/sequence-diagram.mermaid`（主题渲染链 / 一致性测试链 / 成就结算链 / 埋点落盘链）。
- **类图**：`docs/class-diagram.mermaid`（palette / theme store / inference / achievements / dailyStats / 服务层）。
- **验收（本轮）**：
  1. `vue-tsc --noEmit` 0 error；`npm test` 全绿（181 现有 + 新增；一致性测试扩到 6 组 200+）。
  2. `npm run check:hex` 对现存代码 exit 0；人为注入硬编码 exit ≠ 0。
  3. 6 组配色全站生效；主题/明暗/字号刷新保持；首屏无 FOUC。
  4. 28 枚成就、每枚有单测；隐藏/连环展示正确；解锁动效尊重 `prefers-reduced-motion`；家长端成就概览可见。
  5. 字号单次缩放；深色图表/PDF/打印可读；Tauri 下无 SW 更新条。
  6. `git status` 干净；`git log` 含 baseline 与 v1.9.0 两个 commit；tag `v1.9.0` 存在；`node_modules/dist/target/*.exe` 未入库。

---

*本文件由架构师高见远产出，仅含设计与任务清单，不含实现代码。*
