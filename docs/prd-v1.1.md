# 家庭学习系统 · 本轮增量 PRD（路线图 V1.1 批次 + 用户新增）

- **文档语言**：中文
- **产品负责人**：许清楚（Alice）
- **目标工程**：`D:\study`（Vue 3.5 + TS + Vite + Tauri，naive-ui，Dexie/IndexedDB，vitest）
- **本轮范围**：路线图 **P0 批次（B1–B7 + C1）** + 用户新增 **A1 / A2**（用户决策：不做 V1.2/V1.3/V1.4 其余部分）
- **不写实现代码、不改源码、不打包**——本文仅定义"做什么、做到什么程度、验收标准、风险与降级"。

---

## 0. 原始需求复述

上一轮完成了「UI 主题重构」（把硬编码色搬到 token，建立 `theme.scss` / `variables.scss` / `palette.ts` 三源 + 80 例一致性测试），但只是"把颜色搬家"。本轮要做的是**主题收尾 + 质量门禁**，并叠加用户明确要求的两个新增：

1. **A1 多学段颜色主题**：小学/初中/高中三套预设 + 设置页可切换 + 按孩子年级自动推荐 + **持久化**（当前 `theme.ts` 未持久化，刷新即丢，是必须先补的前置）。
2. **A2 成就体系扩充到 20+ 枚**：四类（精熟目标/成长型思维/行为塑造阶梯/探索）+ 隐藏成就 + 连环成就；成就墙升级、新解锁祝贺反馈、家长端可见。
3. **B1–B7**：修复字号双缩放、JS 取色统一、图表/PDF/打印主题、PWA/Tauri 分端、`App.vue` 拆分、防回潮门禁、视觉回归基线。
4. **C1**：`git init` + `.gitignore` + initial commit + tag。

---

## 1. 产品目标（3 个正交目标 + 成功标准）

| # | 目标 | 为什么 | 成功标准（可量化） |
|---|---|---|---|
| **G1** | **视觉可归属**：不同学段的孩子/家长看到"属于自己阶段"的配色，且设置可靠留存 | 现系统一色到底，家长无法表达"我孩子是小学/高中"；且现有主题选择刷新即丢，体验断裂 | ① 3 套学段预设 × {浅, 深} = 6 组配色全站一致；② **主题/明暗/字号三项设置刷新后 100% 保持**；③ 组件层零硬编码色值（扫描通过） |
| **G2** | **激励可持续**：成就从 9 枚扩到 **≥20 枚**，覆盖四类 + 隐藏 + 连环，形成成长梯度 | 现 9 枚偏"总量/打卡"，缺少"从错误中成长""探索"维度，孩子易到天花板后失去动力 | ① ≥20 枚徽章，每枚**判定条件有单测覆盖**；② 解锁结算**幂等且不撤销**（旧徽章不掉）；③ 新解锁有明确动效反馈（尊重 `prefers-reduced-motion`） |
| **G3** | **质量不回潮**：字号、取色、深色可读性、硬编码四项被治理 | 上一轮遗留 4 个 P0 隐患，不做会持续恶化（240 处硬编码会回潮、双源会漂移） | ① 字号**单次缩放**（无双放大）；② JS 取色**集中到服务层**，组件无散落取色；③ 深色下图表/PDF 可读、打印固定浅色；④ `vue-tsc` 0 error，`npm test` 全绿（181 + 新增）；⑤ 硬编码门禁通过（或降级脚本通过） |

---

## 2. 用户故事

> 视角：**作为孩子** / **作为家长**。覆盖 A1、A2 与 B1–B5。

**A1 多学段主题**
- 作为**家长**，我想在设置页选择/确认适合孩子学段的配色（小学暖亮、初中松绿、高中蓝灰），这样界面看起来"是给我孩子的"，而不是一色到底。
- 作为**家长**，我希望系统根据孩子年级**自动推荐**主题，这样我不用手动研究；但我手动改过之后它就别再自作主张。
- 作为**孩子**，我希望昨天选的主题今天打开还在（**持久化**），不要每次刷新都变回去。
- 作为**家长**，我希望在浅色/深色之外还能独立选学段配色（**两个维度互不干扰**），孩子晚上护眼用深色、配色仍是小学的活泼色。

**A2 成就体系**
- 作为**孩子**，我想看到更多、更细的徽章（不只是"掌握 N 个知识点"），比如"知错能改""越挫越勇"，让我知道"改正错误"也值得骄傲。
- 作为**孩子**，我想在达成隐秘成就时被"惊喜"到（**隐藏成就**解锁前是剪影，解锁后揭晓）。
- 作为**孩子**，我想在徽章快达成时看到进度提示（**连环成就**的下一环），有奔头。
- 作为**家长**，我想在家长端/报告里看到孩子**解锁了哪些成就**，以便口头鼓励。
- 作为**孩子**，我想在刚解锁徽章时看到明显的祝贺动效，而不是一闪而过的文字。

**B 质量项**
- 作为**孩子**，我把字号调"大"后，希望**只放大一次**，不要大到离谱（B1）。
- 作为**孩子**，我在深色模式下看**学习进度图表**、导出 **PDF** 时，希望内容清晰可读（B2/B3）。
- 作为**用户**，我在 **Tauri 桌面端**不希望看到"网页版更新条"这种无意义提示（B4）。
- 作为**开发者**，我希望 `App.vue` 不要继续膨胀，主题逻辑集中可测（B5）。

---

## 3. 需求池

优先级定义：**P0 = 本轮必做（不做即未达成目标）**；**P1 = 本轮应做（时间/依赖允许）**；**P2 = 可延后**。
> ⚠️ **沙箱约束**：本机 `npm install` 不友好（上一轮装 `ts-fsrs` 被 SIGTERM 拦截，最后手改 `package.json`）。因此 **B6/B7 需新增 devDependency**，标为「需新增依赖 · 沙箱风险高」，并给出降级方案。**判定标准：零依赖项 100% 交付，需装包项"尽力尝试、失败即降级并如实上报"。**

### P0 需求

#### A1 · 多学段颜色主题（P0）
- **A1-0 主题持久化前置**（P0）：`src/core/stores/theme.ts` 的 `themeMode` / `fontSize` 目前是纯 `ref`，**无持久化**，刷新即丢。必须先把「学段预设 / 明暗模式 / 字号」三项落地存储并在 store 初始化时同步应用。
  - **验收**：改动任一设置 → 刷新 → 设置保持；首屏无配色闪烁（FOUC）。
- **A1-1 三套预设配色**（P0）：定义 小学/初中/高中 × 浅/深 = **6 组**色板，接入 `theme.scss` + `palette.ts`（见 §4.1）。
  - **验收**：6 组 CSS 变量齐备；`palette-consistency.test.ts` 扩展到 6 组且全绿。
- **A1-2 设置页切换**（P0）：外观设置新增"学习阶段主题"选择（见 §4.2）。
  - **验收**：切换即时生效；选中态清晰；与明暗/字号互不干扰。
- **A1-3 按年级自动推荐**（P0）：依据学习包 `manifest.grade` 映射，默认推荐 + 家长可手动覆盖（见 §4.3）。
  - **验收**：导入 4 年级包 → 推荐"小学"；家长手动改后不再被自动覆盖。

#### A2 · 成就体系扩充到 20+（P0）
- **A2-1 徽章扩到 ≥20 枚**（P0）：四类 + 隐藏 + 连环（见 §5）。
  - **验收**：≥20 枚，每枚判定条件可单测；旧 9 枚 id/语义保持不变。
- **A2-2 `AchievementContext` 扩展**（P0）：补充学科覆盖、复习完成、时段、单日题量等字段（见 §5.2）。
  - **验收**：新增字段有明确数据来源；无法从现有数据取得的，明确标注"需新增埋点"并给出埋点方案。
- **A2-3 成就墙升级**（P0）：Home.vue 成就区按类别分组 + 进度 + 解锁日期（见 §6）。
  - **验收**：四类分组展示；隐藏成就剪影占位；连环成就显示"下一环"。
- **A2-4 新解锁祝贺反馈**（P0）：由文本 message 升级为徽章动效（见 §6）。
  - **验收**：新解锁触发动效；`prefers-reduced-motion` 下退化为静态。
- **A2-5 家长端可见**（P0）：家长端新增成就概览（见 §6）。
  - ⚠️ **事实更正**：团队说明称成就墙已存在于 `Home.vue`、`Parent.vue`、`Report.vue`。经核实（grep），**目前仅 `Home.vue` 有成就展示，`Parent.vue` / `Report.vue` 完全没有任何成就相关代码**。因此 A2-5 是**新功能**而非改造，工作量需按新建评估。

#### B1 · 修复 `fontSizeMap` 双缩放（P0）
- 现状：`App.vue:150-160` 的 `fontSizeMap` 经 `buildThemeOverrides` 注入 naive-ui；同时 `theme.ts:20` 设置 `document.documentElement.style.fontSize`（rem 基准）。二者同时生效 → 用户调字号可能被双重放大。
- **要求**：**统一为单一缩放源**，或明确只保留一个。
  - **建议方案**：保留 naive-ui `themeOverrides` 缩放（naive-ui 组件大量使用），**根字号固定**（移除/固定 `document.documentElement.style.fontSize`）；自定义组件若依赖 rem，改用固定基准或不随根字号缩放。
- **验收**：字号 small/medium/large 三档实测**只产生一次缩放**；关键页面字号符合预期；`vue-tsc` 0 error。

#### B2 · JS 取色统一（P0）
- 现状：echarts（`Home.vue:350-365`）、PDF（`pdfExporter.ts:16` 取 `palette.light.cardBg`）、内联样式各自取色。
- **要求**：建主题服务 `useThemeTokens`（读当前生效 CSS 变量数值，供内联样式）与 `useChartTheme`（echarts 主题）；PDF **固定浅色**。
- **验收**：Home.vue 图表、pdfExporter、内联取色均走服务层；组件层无散落直接取色。

#### B3 · 图表 / PDF / 打印主题（P0）
- **要求**：深色模式下图表可读（轴/文字/tooltip/色块），PDF 固定浅色输出，新增 `@media print` 固定浅色。
- **验收**：深色模式下图表文字与背景对比可读；打印预览为浅色；导出 PDF 为浅色。

#### B4 · PWA / Tauri 分端更新策略（P0）
- 现状：`PWAUpdateBar.vue` 在 Tauri 桌面端可能无意义或与原生自动更新冲突。
- **要求**：检测 Tauri 运行环境，**Tauri 下不渲染 SW 更新条**；Web 端保持现状。
- **验收**：Tauri 下无"有新版本可用/立即更新"条；Web 端功能不变。

#### B5 · `App.vue` 拆分（P0）
- **要求**：抽 `ThemeProvider`（封装 `n-config-provider` + `themeOverrides` 计算）、`AppShell`（布局骨架）；`buildThemeOverrides` 已是 `palette.ts` 内纯函数，保持并补参。
- **验收**：`App.vue` 只负责组合；主题覆盖逻辑集中在 `ThemeProvider`；`vue-tsc` 0 error；无行为回归。

#### B6 · 防回潮门禁（P0）⚠️ **需新增依赖 · 沙箱风险高**
- **目标**：禁止 `src/views/**`、`src/modules/**`、`src/components/**` 内出现 `#hex` 与 `rgba(数字...)`；白名单仅 `theme.scss`、`variables.scss`、`palette.ts`。
- **首选方案**：Stylelint（+ `stylelint-declaration-strict-value` 或自定义规则/正则），接入 `npm run lint:styles`。
- **依赖风险**：需新增 `stylelint` 等 devDependency，沙箱内可能装不上。
- **降级方案（脚本门禁）**：新增本地脚本 `scripts/check-hex.mjs` + `npm run check:hex`——Node 递归扫描三目录下 `*.vue/*.ts/*.scss`，命中 `#hex` / `rgba(数字` 且不在白名单即 **exit code ≠ 0**，作为 `npm test` 之外的手动门禁。
- **现存例外**：经扫描，组件层当前仅 **1 处**存量命中——`Home.vue` 的 `drop-shadow(... rgba(0, 0, 0, 0.15))`。处理建议二选一：① 改走 `$shadow` token；② 在门禁中**放行纯黑阴影** `rgba(0, 0, 0,`（与 `theme.scss` 既有 `--shadow-up: ... rgba(0, 0, 0, 0.06)` 约定一致）。**需与实际做法保持一致，避免门禁一上来就红。**
- **验收**：首选版 `npm run lint:styles` 通过；降级版 `npm run check:hex` 对现存代码 exit 0，且人为引入硬编码时能报错并退非 0。

#### B7 · 视觉回归基线（P0）⚠️ **需新增依赖 + 浏览器内核 · 沙箱风险高**
- **目标**：Playwright 截图矩阵——浅/深 × {首页 / 报告 / 搜索 / 复习 / 错题 / 家长 / 学习子页 / 模块} × 关键状态。
- **依赖风险**：`package.json` 已存在 `test:e2e: "playwright test"` 脚本，但 **devDependencies 里没有 `@playwright/test`**；且需**下载浏览器内核（数百 MB）**，沙箱内失败概率高。
- **降级方案（人工基线）**：若内核装不上，改为「**可复现的人工核对清单 + 关键页截图留档**」——清单覆盖上述 8 类页面 × 浅/深，逐项人工核对并截图存入 `docs/screenshots/`，作为基线留档。
- **验收**：自动化版 `npm run test:e2e` 通过；降级版清单**全部项人工确认并留档**。

#### C1 · `git init` 工程化基线（P0）
- **要求**：`git init`（本地仓库）+ `.gitignore`（排除 `node_modules`、`dist`、`src-tauri/target`、根目录 `*.exe`、临时脚本）+ initial commit + 打 tag。
- **验收**：`git status` 干净；`git log` 有 initial commit；tag 存在且可检出；`node_modules/dist/*.exe` 未被纳入。

### P1 需求
- **P1-1**：学段主题的**可访问性核对**（关键文本对比度 ≥ 4.5:1，尤其小学暖色/高中蓝灰在深浅两态下的正文与按钮）——建议随 A1 一并交付，但允许"记录问题、下轮修"。
- **P1-2**：成就解锁时间戳存储（供成就墙显示"解锁日期"，见 §5.3 存储升级）。
- **P1-3**：`Report.vue` 报告页增加成就里程碑区块（与家长端呼应）。

### P2 需求
- **P2-1**：`--info-rgb` 等"预留无调用点"变量的清理或启用（现状 `theme.scss` 注释标明无调用点）。
- **P2-2**：成就"分享/导出"（打印成就墙图片）。

---

## 4. A1 多学段主题：交互与视觉规范

### 4.1 三套预设色板定义

**与现有松绿体系的继承关系**：
- **初中 = 现状原值，零改动**（`primary #2d6a4f` / 深色 `#4fa57f`），保证默认路径无回归。
- **小学 / 高中 = 保留现有 token 结构，仅替换色相**：沿用同一套槽位命名（primary / hover / pressed / suppl、success / warning / danger / info、bg / cardBg / textMain / textSub / textMuted / border）、同一套 `-light` / `-soft` / `-rgb` 派生规则、同一套 band 档位色与 gradient 命名。即"**换色不换骨架**"。
- 语义色（success/warning/danger/info）在两套新主题中**尽量复用**，但需在与新主色并置时做对比度核对（见 P1-1）。

> 下表为**建议值**（浅色 light / 深色 dark 成对）。所有值需通过 §P1-1 的可访问性核对后方可锁定。

| token | 小学·浅（暖亮活泼） | 小学·深 | 初中·浅（清新松绿·**现状**） | 初中·深（**现状**） | 高中·浅（沉静蓝灰） | 高中·深 |
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

> 说明：小学 primary 取**阳光橙**并与 warning 拉开（橙 vs 黄），避免与 danger 红冲突；高中 primary 取**沉静蓝灰**（低饱和蓝），与 info 蓝、初中绿均可区分。`*-light / *-soft / *-rgb / band-* / gradient-*` 按现有派生规则成套补齐。

### 4.2 设置页切换交互

- **位置**：设置页「🎨 外观设置」卡片内新增一段"**学习阶段主题**"（现有"主题模式""字号"保留）。
- **控件形态**：**预设卡片单选**（比下拉更直观，可展示配色）。
  - 三张卡片横排（移动端竖排），每张含：**顶部色带预览**（primary + bg + card 三色块）、**名称**（小学 / 初中 / 高中）、**一句话定位**（暖亮活泼 / 清新松绿 / 沉静蓝灰）、**选中态**（边框高亮 + 勾选）。
- **推荐提示条**：卡片下方一行小字，例：*"检测到孩子 4 年级，推荐「小学」主题 — [一键切换]"*；家长手动切换后，提示条消失，改为 *"已手动选择，不再自动推荐 · [恢复自动]"*。
- **正交性**：与"主题模式（浅色/深色/跟随系统）""字号（小/中/大）"是**三个独立控件**，互不联动。

**持久化（A1-0）**
- 存储三项：`preset`（primary|junior|senior）、`mode`（light|dark|system）、`fontSize`（small|medium|large），外加 `presetManual`（是否被手动覆盖）。
- **建议载体：`localStorage`**（同步，store 初始化即可应用，避免首屏 FOUC）；`db.settings` 作为可选备份。**理由**：`theme.ts` 的 `watchEffect` 需在首帧前生效，IndexedDB 为异步会闪色。（此点列入待确认，见 §8）

### 4.3 按年级自动推荐规则

- **年级数据源**：`packageStore.packages[].manifest.grade`（`number`；`ImportWizard.vue` 当前约束 1–9）。
- **推断规则**：
  1. 取已导入包 `grade` 的**众数**（出现次数最多者）；
  2. 并列时取**最近导入**（`manifest.updatedAt/createdAt` 最新）的 grade；
  3. 无学习包 → 走默认（见下）。
- **映射**：`grade ≤ 6 → 小学`；`7 ≤ grade ≤ 9 → 初中`；`grade ≥ 10 → 高中`。
- **触发时机**：仅当 `presetManual === false` 时应用；一旦家长手动切换，永久停止自动覆盖（可"恢复自动"）。
- **默认（无包）**：**初中**（= 现状主色，保证零回归）。⚠️ 待确认（§8）。

### 4.4 学段主题 × 明暗模式的正交结论

**明确结论：二维正交矩阵，共 3 × 2 = 6 组配色。**

```
学段预设 (preset)：小学 | 初中 | 高中        ← 维度 A（换"色相"）
明暗模式 (mode)  ：light | dark | system→resolve   ← 维度 B（换"明度"）
实际生效主题 = resolve(preset, mode) → 6 组之一
```

- **实现映射**：
  - `body.dark-mode` 继续控制明暗（现有点位）；
  - 新增 `body[data-theme-preset="primary|junior|senior"]` 控制学段；
  - CSS 组合选择器给出 6 组：`:root`（默认=初中浅）、`body.dark-mode`（初中深）、`body[data-theme-preset="primary"]`（小学浅）、`body[data-theme-preset="primary"].dark-mode`（小学深）、……高中两组。
  - `palette.ts` 由 `{light, dark}` 扩展为 `presets.{primary,junior,senior}.{light,dark}`；`buildThemeOverrides(palette, preset, theme, sizes)` 增加 `preset` 参数。
- ⚠️ **架构张力（如实指出）**：现有体系是"**一个布尔 `dark-mode` + 2 组变量**"。加学段后变成"**一个属性 + 一个布尔 → 6 组变量**"，**不是加一个变量，而是变量集 ×3**。这会影响：`theme.scss` 体积、`palette.ts` 结构、`palette-consistency.test.ts`（80 例 → 需扩展为 6 组）、`ThemeProvider` 取值逻辑。工作量按 **×3** 估算，不能按"加个选项"估。
- 若需**折中降级**（见 §8）：可让"学段预设只改 primary 主色相（及派生 hover/pressed/soft）"，明暗仍走原有明度变量——即 3 组主色 × 2 明暗，但只覆盖主色相关槽位，其余语义槽位复用明暗基色。这会显著降低维护成本，代价是新主题的"个性"弱于全槽位替换。

---

## 5. A2 成就体系清单（≥20 枚）

### 5.1 徽章清单（共 **28 枚**，含既有 9 枚）

类别：**M 精熟目标 / G 成长型思维 / B 行为塑造阶梯 / E 探索**。`隐藏` = 解锁前以剪影展示。`★` = 既有（保持 id 与语义不变）。

| # | id | 图标 | 名称 | 描述 | 判定条件 | 类别 | 隐藏 | 数据状态 |
|---|---|---|---|---|---|---|---|---|
| 1 ★ | `first-step` | 🌱 | 迈出第一步 | 掌握第 1 个知识点 | `masteredKp ≥ 1` | M | 否 | 已有 |
| 2 ★ | `ten-kp` | 📗 | 小试牛刀 | 掌握 10 个知识点 | `masteredKp ≥ 10` | M | 否 | 已有 |
| 3 ★ | `fifty-kp` | 📚 | 融会贯通 | 掌握 50 个知识点 | `masteredKp ≥ 50` | M | 否 | 已有 |
| 4 ★ | `hundred-kp` | 🎓 | 百炼成钢 | 掌握 100 个知识点 | `masteredKp ≥ 100` | M | 否 | 已有 |
| 5 | `kp-300` | 🏆 | 学富五车 | 掌握 300 个知识点 | `masteredKp ≥ 300` | M | 否 | 已有 |
| 6 | `subject-master-3` | 🌈 | 三科通才 | 数学/语文/英语各掌握 ≥10 个知识点 | 按学科分组统计 | M | 否 | 需 packages（学科） |
| 7 | `perfect-kp` | 🎯 | 一击即中 | 单个知识点连续答对 ≥10 题 | `max(correctStreak) ≥ 10` | M | 否 | 已有 |
| 8 | `mastery-half` | 📈 | 半程山巅 | 全库掌握率 ≥50%（总知识点 ≥20） | `mastered/total ≥ 0.5` | M | 否 | 需 packages（kp 总数） |
| 9 | `mistake-first` | 🧩 | 知错能改 | 首次攻克 1 道错题 | `clearedMistake ≥ 1` | G | 否 | 已有 |
| 10 ★ | `mistake-cleaner` | 🧹 | 错题清道夫 | 攻克 10 道错题 | `clearedMistake ≥ 10` | G | 否 | 已有 |
| 11 | `mistake-cleaner-50` | 🛠️ | 错题终结者 | 攻克 50 道错题 | `clearedMistake ≥ 50` | G | 否 | 已有 |
| 12 | `comeback` | 🌟 | 越挫越勇 | 某知识点曾答错 ≥3 次后转为"已掌握" | `progress: wrongCount≥3 && status=='已掌握'` | G | **是** | 已有 |
| 13 | `review-20` | 🔁 | 温故知新 | 复习答对累计 20 次 | `Σ reviewCorrectCount ≥ 20` | G | 否 | 已有（mistakes） |
| 14 | `patience` | 🐢 | 不厌其烦 | 单个知识点累计答题 ≥30 次 | `max(correctCount+wrongCount) ≥ 30` | G | 否 | 已有 |
| 15 ★ | `streak-master` | 💎 | 稳如磐石 | 单个知识点连续答对 5 题 | `max(correctStreak) ≥ 5` | G | 否 | 已有 |
| 16 ★ | `streak-3` | 🔥 | 三日之约 | 连续学习 3 天 | `bestStreak ≥ 3` | B | 否 | 已有 |
| 17 ★ | `streak-7` | ⚡ | 一周不断 | 连续学习 7 天 | `bestStreak ≥ 7` | B | 否 | 已有 |
| 18 ★ | `streak-30` | 🏔️ | 持之以恒 | 连续学习 30 天 | `bestStreak ≥ 30` | B | 否 | 已有 |
| 19 | `streak-60` | 🗓️ | 两月之志 | 连续学习 60 天 | `bestStreak ≥ 60` | B | 否 | 已有 |
| 20 | `streak-100` | 💯 | 百日不辍 | 连续学习 100 天 | `bestStreak ≥ 100` | B | 否 | 已有 |
| 21 | `early-bird` | 🌅 | 闻鸡起舞 | 在 07:00 前完成一次学习 | 时段埋点 | B | **是** | ⚠️ **需新增埋点** |
| 22 | `night-owl` | 🌙 | 挑灯夜读 | 在 21:00 后完成一次学习 | 时段埋点 | B | **是** | ⚠️ **需新增埋点** |
| 23 | `daily-20` | ⚡ | 今日之星 | 单日完成 ≥20 题 | 单日题量埋点 | B | 否 | ⚠️ **需新增埋点** |
| 24 | `explorer-3` | 🧭 | 初探门径 | 学习过 3 个不同学习包 | `distinct packageId ≥ 3` | E | 否 | 需 packages |
| 25 | `explorer-10` | 🗺️ | 博览群书 | 学习过 10 个不同学习包 | `distinct packageId ≥ 10` | E | 否 | 需 packages |
| 26 | `type-collector` | 🎲 | 题型收藏家 | 尝试过 5 种不同题型 | 题型集合去重 ≥5 | E | 否 | ⚠️ 需题库汇总（见下） |
| 27 | `term-cross` | 🌗 | 上下求索 | 上册与下册都学习过 | `distinct manifest.term == 2` | E | 否 | 需 packages（term） |
| 28 | `senior-new` | 🔭 | 另辟蹊径 | 首次学习非"数学"学科 | 存在 subject ≠ math 的进度 | E | 否 | 需 packages（学科） |

**统计**：M 8 枚 · G 7 枚 · B 8 枚 · E 5 枚 = **28 枚**（≥20 ✓）；隐藏 3 枚（`comeback` / `early-bird` / `night-owl`）。

**连环成就（Chain）**——解锁前置后，成就墙展示"下一环"目标与进度：

| 连环名 | 链条 |
|---|---|
| 坚持之链 | `streak-3 → streak-7 → streak-30 → streak-60 → streak-100` |
| 错题之链 | `mistake-first → mistake-cleaner → mistake-cleaner-50` |
| 精熟之链 | `first-step → ten-kp → fifty-kp → hundred-kp → kp-300` |
| 探索之链 | `explorer-3 → explorer-10` |

### 5.2 `AchievementContext` 扩展字段

现有：`{ progress: ProgressRecord[]; mistakes: MistakeRecord[]; streak: StreakState }`。需扩展为：

```ts
interface AchievementContext {
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  streak: StreakState
  // 新增：学习包元信息（学科/年级/学期/类型/知识点数）——供学科覆盖、探索类判定
  packages?: { packageId: string; subject: string; grade: number; term: string; packageType: string; kpCount: number }[]
  // 新增：每日学习统计（题量 + 首/末学习时刻）——供单日题量、时段类判定
  dailyStats?: { date: string; questionCount: number; firstStudyAt: number; lastStudyAt: number }[]
  // 新增：已尝试题型集合——供题型收藏家判定
  attemptedTypes?: string[]
}
```

**数据可得性评估**：

| 字段 | 来源 | 是否需要新埋点 |
|---|---|---|
| `packages[].subject/grade/term/packageType` | `packageStore.packages[].manifest`（**已存在**） | ❌ 不需要，只需在调用 `syncAchievements` 时传入汇总 |
| `packages[].kpCount` | `pkg.knowledgePoints.length`（**已有**） | ❌ 不需要 |
| `progress` 的 `correctCount/wrongCount/correctStreak/status` | `ProgressRecord`（**已有**） | ❌ 不需要 |
| `review-20`：复习完成数 | `MistakeRecord.reviewCorrectCount`（**已有**） | ❌ 不需要 |
| `dailyStats`（单日题量、时段） | **无**。现仅 `studySeconds` 累计于 `ProgressRecord`，无"每日题量/时刻" | ✅ **需新增埋点** |
| `attemptedTypes`（题型） | 需从 exercise/question 结构汇总；**`QuizQuestion` 是否有 `type` 字段待工程确认** | ⚠️ 待确认；若无则降级为"按 exerciseId 去重 ≥5" |

**建议埋点方案（dailyStats）**：新增 `src/core/motivation/dailyStats.ts`，在答题结算热路径（`userData.recordAnswer` / `QuizEngine` 提交处，与 `touchStudyDay` 同点位）累加当日 `questionCount`、更新 `firstStudyAt/lastStudyAt`（**本地时间**，沿用 `streak.ts` 的本地日期口径，勿用 UTC）；存 `db.settings` key `dailyStats`，**保留最近 N 天（建议 60 天）防膨胀**。
- ⚠️ 该埋点位于热路径，会增加 IndexedDB 写入频率；是否接受见 §8。

### 5.3 成就存储结构升级（P1-2）

- 现状：已解锁 id 存 `db.settings` 的 `achievements` 键，值为 `string[]`，**解锁不撤销**（`syncAchievements` 幂等合并）。
- 若要显示"解锁日期"，需升级为 `{ id: string; unlockedAt: string }[]`。
- **兼容要求**：读取时兼容旧 `string[]`（迁移为对象，`unlockedAt` 缺失则显示"—"或"较早"）；**新解锁即写入当前本地日期**；仍保持"只增不减"。

---

## 6. UI 设计稿要点

**主题切换页（设置页 · 外观设置）**
- 三段式：`学习阶段主题`（3 预设卡片）→ `主题模式`（浅/深/跟随系统）→ `字号`（小/中/大），自上而下。
- 预设卡片：顶部色带预览（primary + bg + card）、名称、定位语、选中勾；点击即时生效。
- 推荐提示条：见 §4.2，支持"一键切换"与"恢复自动"。

**成就墙（Home.vue · 我的成就区）**
- 顶部总览：`已解锁 N / 28` + 总进度条。
- 按四类**分段展示**（M/G/B/E 四个分段或四个小节），每类显示 `该类已解锁/该类总数`。
- 单枚卡片：图标、名称、描述；已解锁显示解锁日期；未解锁灰化 + 🔒。

**隐藏成就展示方式**
- 解锁前：**占位剪影**（灰底 + 🔒 或 `???`），名称/描述**模糊化**（如"？？？""达成后揭晓"），不泄露条件。
- 解锁后：完整展示图标/名称/描述 + 揭晓动效（"隐藏成就已解锁！"）。

**连环成就展示**
- 在链条已解锁项旁显示"下一环：<图标> <名称>"与进度提示；未解锁的后续环仅显示剪影。可选：链条以横向节点线串联。

**新解锁动效要求**
- 触发点：`syncAchievements` 返回 `newlyUnlocked`（**已有**）。
- 形态：居中/顶部弹出**徽章卡片**，轻微放大回弹（复用 `--ease-spring`）+ 光晕；多枚时依次播放或堆叠。
- 无障碍：**尊重 `prefers-reduced-motion`** → 退化为无动画静态提示。
- 现状：仅 `message.success('🏅 解锁新成就：...')` 文本，需升级。

**家长端可见**
- 家长端新增「🏅 成就概览」区块：孩子已解锁数 / 总数、四类分布、**最近解锁的 3 枚**。
- 报告页（P1-3，可选）：成就里程碑时间线。

---

## 7. 不做什么（明确排除项）

- ❌ **不做 V1.2 设计系统 2.0**：单源 token 生成、三层 token、组件级 token、UI 基元封装（AppButton/AppCard…）、Storybook/Histoire、WCAG AA 全量治理。
- ❌ **不做 V1.3 学习闭环增强**：FSRS/SM-2 算法升级、错题归因、掌握度推荐、报告周报月报、搜索全文索引。
- ❌ **不做 V1.4 工程化与平台化**：完整 CI/CD 流水线、性能预算、离线同步、Tauri 安全加固、国际化、插件化。
- ❌ **不做多孩子档案 / 云同步 / 家长通知**（虽与"按年级推荐"有关，但对数据模型影响大，明确延后）。
- ❌ **不做学科色改动**（`subject-chinese/english` 作为主题无关常量保留）。
- ❌ **不做排行榜 / 社交 / 名次类 / 天赋类成就**（违背"只奖行为与坚持"的激励原则）。
- ❌ **不做学段主题之外的额外模式**（高对比 / 护眼 / 色盲友好 → V1.2）。
- ❌ **不新增/改动学习内容与题库数据结构**（`type-collector` 若题型数据不可得则降级，不强推数据结构变更）。

---

## 8. 待确认问题（请主理人转用户拍板）

1. **主题持久化载体**：`localStorage`（同步、防 FOUC，但不与 `streak/achievements` 同库）vs `db.settings`（一致但异步、可能闪色）。**建议 localStorage**。
2. **自动推荐的行为**：只"提示建议不自动改"，还是"未手动设置时自动应用"？**建议：首次且未手动设置时自动应用，此后仅提示**。
3. **2D 矩阵的维护成本是否接受**：学段主题 × 明暗 = **6 组全量变量**（工作量大）vs **折中**（学段只替换主色相关槽位 + 明暗沿用基色）。请拍板取哪种（见 §4.4）。
4. **无学习包时的默认主题**：初中（= 现状，零回归）？
5. **版本号 / tag 命名冲突**：路线图称本轮为 **V1.1**，但 `package.json` 已是 `1.8.0`、侧栏显示 **V1.8**。tag 用 `iter-v1.1`？还是把 app 版本升到 `1.9.0`？（**两个版本体系并存，需统一口径**）
6. **成就存储结构升级**：`string[]` → `{id, unlockedAt}[]` 是否接受一次性迁移？旧数据无 `unlockedAt` 时如何显示？
7. **新增埋点**：`dailyStats`（每日题量/时段）写在答题热路径，是否接受额外 IndexedDB 写？保留天数取 **60 天**是否合适？
8. **B6/B7 的降级产物是否可接受**：B6 降级为 `npm run check:hex` 脚本门禁；B7 降级为"人工核对清单 + 截图留档"。若不可接受，则需为装包预留重试/授权窗口。
9. **连环/隐藏成就的规则确认**：隐藏 3 枚是否合适？隐藏成就是否给任何暗示（如"某个时段有惊喜"）？
10. **可访问性容差**：小学暖色/高中蓝灰在深色下若对比度不足，**是否允许对深色语义色做微调**以换可读性（路线图关键决策点之二）？

---

## 附：关键冲突与事实修正（如实上报，未自行掩盖）

1. **成就墙位置与事实不符**：团队说明称成就墙存在于 `Home.vue`、`Parent.vue`、`Report.vue`；经核对，**仅 `Home.vue` 有**，`Parent.vue`/`Report.vue` **零成就代码**。A2-5「家长端可见」实为**新建**，非改造 → 工作量需重估。
2. **`dark-mode` 单布尔 vs 三套预设**：现有主题是"一个布尔 + 2 组变量"；三套学段预设引入第二维，变量集从 **2 组 → 6 组**（×3），影响 `theme.scss` / `palette.ts` / 一致性测试 / `ThemeProvider`。**不是"加个选项"的工作量**（详见 §4.4）。
3. **版本号双轨**：路线图迭代号 **V1.1** 与 app 版本 **1.8.0（V1.8）** 并存，需统一（见 §8-5）。
4. **B7 依赖缺口**：`package.json` 已有 `test:e2e: "playwright test"` 脚本，但 **devDependencies 中并无 `@playwright/test`**——需补依赖 + 下载浏览器内核，沙箱风险高。
5. **B6 存量例外**：组件层现有 **1 处**硬编码命中（`Home.vue` 的 `drop-shadow(... rgba(0,0,0,0.15))`）。门禁上线前需先处置（改 token 或放行纯黑阴影），否则门禁一上来即红。
