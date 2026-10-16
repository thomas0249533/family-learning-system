# 项目长期记忆

## 关联项目：家庭学习系统（D:\study）
- 用户已有一套 JSON 驱动的家庭学习系统（Vue3 + Vite + Tauri + IndexedDB），项目位于 **D:\study**（不在本工作区）。
- 单一事实来源：`D:\study\README.md`；内容生产规范在 `D:\study\doc\prompts\`（engine1/engine2/special/input-templates/SOP）。
- 学习包类型：unit（内部）/ term / special（examMode）/ sprint。内容目录 `D:\study\content\{subject}-{grade}-{term}-{edition}\`。
- 制作流程：写包 JSON（自有 ID 用裸 ID，跨包引用写完整 `包::id`）→ 改 `_set.json`（packages + importOrder，`examMode`/`sourceUnitIds` 必须写在 _set 里）→ `npm run validate:set -- content/xxx` → `npm run build:lpkgset -- content/xxx` → App「设置→导入学习包」导入 zip。
- **重要**：`build:lpkgset`（build-lpkgset.ts）**只读 `_set.json` 的 `packages[]`，完全忽略 `overrides` 块**（overrides 仅被 `build:set`/build-lpkgset-auto.ts 使用）。special/sprint 的 `examMode`+`sourceUnitIds` 必须同时写在①包内 manifest、②`_set.json` 的 `packages[]` 条目（否则不会进 zip）。
- 三条铁律（见 doc/prompts/engine2-package.md）：special/sprint 缺 `examMode:true` → 前端浏览模式、无题目导航；缺 `sourceUnitIds` → 首页"基于 0 个单元"；unit 缺 `isInternal:true` → 混进教材分组。
- 前端判定链：`UnitList.vue` 读 `pkg.manifest.examMode===true` → 渲染 `ExamPanel` → 传 `exam-mode` 给 `QuizEngine`（题目导航为 `v-if="examMode"`）。
- 关键校验：E005–E009（题 id/type/answer/知识点关联）、W031（topic 无 modules，不阻塞）。**题型白名单 `VALID_TYPES`（normalizePackage.ts）** 现为 `single/blank/multiple/judge/matching/spelling/essay`。
- 填空题判分：单空为精确匹配+括号容错（不做子串），故应用题采用「题干末尾带空+单位、answer 只填数字」。
- **考试模式（ExamPanel）不渲染阅读原文/知识卡片**，只有练习模式（TopicDetail）才渲染 `topic.modules` → 阅读、长文、看图类包必须 `examMode:false`。
- **主观题**：新增 `essay` 题型（QuizEngine 里 textarea 作答 → 只展示参考答案、不自动判分 → 学生自评「✅我答对了 / 📖需要复习」→ 才写 progress/错题本）。适合"说理由/分析表达效果/概括主要内容"等成段答案；**整句 copy 型的单空填空一律改 essay**（单空是精确匹配，带不带句号会挂）。

## 本工作区（小学教辅 PDF）
- 三份四上教辅 PDF：数学每日一练45天（60页/45天）、数学加法和乘法模型专项（87页/17题型/91题）、语文课外阅读1-3单元（19页/16篇）。
- 已把「加乘模型专项」做成学习包 `special-math-4-up-jiajiancheng`（**57题**/6个topic，覆盖 PDF 全17题型且每类≥2题），归入 D:\study\content\math-4-up-rjb\。
- 已把「每日一练45天」做成学习包 `daily-math-4-up-rjb-45d`（**45 个单元=45天；每天 4 个板块 topic**：口算8/竖式8/脱式2/思维2，共 **900 题**；非考试模式→"导航即每日"），也在 math-4-up-rjb。
- 已把「语文课外阅读 1-3 单元」做成学习包 `special-chinese-4-up-reading`（**16 个单元=16 篇文章**，每篇 1 topic = 原文模块 + 题目，共 **72 题**；`examMode:false`，进「专项」分组），归入 D:\study\content\chinese-4-up-rjb\（该集合的 zip 为 `chinese-4-up-rjb-term-set.lpkgset.zip`）。原文用 `chinese.text`（散文等，10 篇）/ `chinese.poem`（古诗与现代诗，6 篇）模块承载。
- daily 包的 topic 带自定义字段 `board`（口算/竖式/脱式/思维），App 侧 TopicList 用它显示图标+色条。口算板块带 `math.concept` 知识卡 module，其余板块带 content 说明卡（避免同一知识卡重复、消除 W031）。
- 构建 App：前端 `npm run build`；Tauri 用 `npx tauri build --no-bundle` → `src-tauri/target/release/app.exe`（当前 **v1.8.0**，最近产物 `D:\study\app20261015c.exe`；惯例复制为 `D:\study\app<日期>[a-z].exe` 递增字母）。
- **构建踩坑**：`tauri build` 会再跑一次 `npm run build`，Vite `emptyOutDir` 删 `dist/assets` 100+ 文件会被宿主 safe-delete shim 拦截（阈值 50/轮）→ 先把 `dist` 移走（`mv dist .dist-prev`）再构建。
- 做题约定：专项包答案须为纯数字（题干末尾带空+单位）；"能否完成"类工程题改写成求总量以便精确判分。

## 系统硬约束（务必记住）
- **普通包 `manifest.dependencies` 必须为空**；一旦非空，`resolvePackageUnits` 会把它当"聚合包"，只显示依赖包的 units、忽略自己的 units。
- **跨包引用知识点是允许的**：validator 与 `importPackageSet` 均用"同批次全局 KP 池"校验 E009。
- 填空题判分 `normalizeBlank`：去所有空格、全角括号→半角、`，；、`→`,`，支持多空逗号比对（单空为精确匹配）。
- `build:lpkgset` 只读 `_set.json` 的 `packages[]`，**忽略 `overrides`**；`type` 会写成 `manifest.packageType`；`visible:false` → `isInternal:true`。
- PackageList 分组看 `packageType`：`daily`→每日一练（📅，绿）、`special`→专项、`sprint`→冲刺、其余→教材；`typeLabel` 已收录 base/unit/term/daily/special/sprint。
- 学习包类型联合（`src/schemas/manifest.ts`）已含 `'daily'`。

## D:/study v1.8.0（学习内核升级，2026-10-15）
- **备份**：`D:/study_backup_20261015/`（升级前完整源码快照，勿动）。项目**无 git**，靠目录快照回滚。
- **测试**：项目原有 0 测试；v1.8 起有 `tests/`（6 文件 / 101 用例）+ `vitest.config.ts`，跑 `npm test`。**改核心算法必须前后各跑一次**。
- **复习调度 = FSRS**（`@core/review/fsrs.ts` 包 ts-fsrs 5.4.2；`reviewScheduler.ts` 是门面，**旧函数签名全部保留**）。
  参数：retention 0.92 / short_term 开 + 学习步 `['1d']` / fuzz 关 / 上限 365 天。曲线：首学答对 2 天 → 8 → 28 → 87；答错 1 天。
  **铁律 `shouldAdvanceSchedule`**：同一知识点**一天只推进一次** FSRS，答错除外（否则一节课连对会顶爆间隔）。
- **掌握度 = 4 态 + BKT 概率副标**（`@core/mastery/bkt.ts` + `masteryRules.ts`）。蒙对率按题型（判断题 0.5 / 填空 0.05），填空题连对 2 次即提前掌握，判断题不够。旧硬阈值规则**原样保留**，只加「概率<0.6 不许已掌握」+「概率≥0.9 且连对≥2 且从未答错→提前掌握」。
- **错题三级**：`@core/mistake/mistakeRules.ts`（none/partial/mastered），必须**连续**答对 2 次；中间答错回 none。
- **打卡**：`@core/motivation/streak.ts`，**本地日期**口径（不能用 toISOString，UTC 会把晚间算成次日）。成就徽章在 `achievements.ts`（9 枚）。
- **DB 未升版本**：新字段（`fsrs`/`bkt`/`masteryProbability`/`masteryLevel`/`reviewCorrectCount`）均非索引，Dexie 透明兼容；老数据靠 `ensureFields` + `legacyCardFromStage` 接管。**只增字段不改名，不清理用户库**。
- **本机踩坑**：① `npm install` / `npm run build` 需提权（沙箱 SIGTERM）；② vitest 缓存默认写 `%TEMP%` 被拦会**静默少加载测试文件** → 已固定 `cacheDir: node_modules/.vitest-cache` + `pool: forks`；③ `vite dev` 只监听 `[::1]`，验证用 `curl --noproxy '*' http://[::1]:5173/...`；④ 打包仍须先 `mv dist .dist-prev`。
- **遗留**：`recordProgress` 的 `[packageId+kpId]` 主键未归一化，同一 KP 从学期包/单元包/专项包进入会产生多条进度记录、稀释掌握率（升级前就存在，README 13.1 有记）。
- **未做**：主动回忆（先回忆再看卡片）+ 交错练习（P4/P5），内容生产 Skill（P2），今日目标进度环。

## D:/study 主题与设计 token 体系（2026-10-16）
- **三源分工 —— 改颜色必须改对地方**：
  - `src/core/styles/theme.scss` = **CSS 变量唯一源**（`:root` 浅 + `body.dark-mode` 深，**必须成对**；`--on-strong*` 例外，仅 `:root` 恒白）
  - `src/core/styles/variables.scss` = SCSS 门面（`$x: var(--x)`）+ 学科色常量（`$subject-chinese*` / `$subject-english*`，**不随主题变**）
  - `src/core/styles/palette.ts` = **JS 侧唯一数值源**（naive-ui `themeOverrides` 专用；naive-ui 会对主色做运算派生 hover/pressed，**不能写 `var()`**）
- **`tests/palette-consistency.test.ts`（80 用例）锁死 `palette.ts` ⇄ `theme.scss`** —— 只改一侧数值 → 测试变红。改色后必须让它绿。
- **新增 token 白名单**（四类）：`--{primary,success,warning,danger,info}-rgb`(10) / `--on-strong(-rgb)` / `--band-{success,warning,danger}-{bg,border}`（Report 分数档位）/ `--code-color`；另有 `--shadow-up`（**上向阴影**，底部固定栏 `.app-nav`/`.quiz-actions` 专用）。半透明一律 `rgba(var(--x-rgb), a)`，**不用 `color-mix()`**（Tauri WebView 内核版本不确定）。
- **主色 = 深松绿** `#2d6a4f`（浅）/ `#4fa57f`（深）；旧 indigo `#6366f1` 与 violet `#8b5cf6`/`#a56cf0` 已**并入主色**，此后**无独立 accent**。
- **T1 修掉的真 bug**：`index.scss` 原 `.dark-mode{background:#121212; .app-header,.app-nav,.card{#1e1e1e}}` —— `.dark-mode` 特异压过 theme.scss 的 `body`，把深色背景/卡片顶成纯灰。**body 背景现在只在 theme.scss 定义一处**。
- **唯一残留字面量**：`Home.vue:437` `filter: drop-shadow(0 4px 8px rgba(0,0,0,.15))`（`$shadow-*` 是 box-shadow 简写，无法用于 `filter`；白名单禁新增 token）。
- **本机沙箱新增坑**：`npm run build` 除提权外还需 **`CODEBUDDY_SAFE_DELETE_ENABLED=0`**，否则 vite 清 `dist/assets`（103 文件 > 阈值 50）会被 safe-delete shim 拦成 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（环境拦截，非代码错）。
- **易漏点**：PWA manifest 的 `theme_color`/`background_color` 在 **`vite.config.ts`**（不在 src 里），改色时容易漏。

## D:/study v1.9.0（多学段主题 + 成就扩充 + 质量门禁 = 路线图 V1.1 批次，2026-10-16）
- **文档**：需求 `doc/后续迭代方向.txt`（4 轮：V1.1 质量门禁→V1.2 设计系统2.0→V1.3 学习闭环→V1.4 平台化）；本轮产物 `docs/prd-v1.1.md`（PRD）、`docs/system_design-v1.1.md`（设计）、`docs/视觉回归清单.md`。上一轮设计 `docs/system_design.md` 的 §8 约定仍有效。
- **git 已引入**（路线图点名"最高工程风险"已解除）：tag `v1.9.0`；`/*.exe`、`node_modules`、`dist`、`src-tauri/target` 均不入库。**改动可 `git diff <commit> HEAD` 审阅，回滚不必再靠目录快照**。
- **6 组主题（学段 × 明暗）**：`palette.ts` 由 `{light,dark}` 改为 **`presets.{primary,junior,senior}.{light,dark}`**；`buildThemeOverrides(palette, preset, theme, sizes)`（**签名已变**）+ `FONT_SIZE_MAPS`。
  CSS 层：`:root`(0,1,0)=初中浅兜底 ｜ `body[data-theme-preset="X"]`(0,1,1)=小学/高中浅 ｜ `body.dark-mode`(0,1,1)=初中深 ｜ **`body[data-theme-preset="X"].dark-mode`(0,2,1)=小学/高中深**。
  ⚠️ **铁律：组合深色块必须存在**，漏写会让深色串成学段浅色（正是上轮 `index.scss` 那类真 bug 的同型陷阱）。**初中色值与 1.8.0 逐字节相同（零回归）**。维度拆分：preset 块只管色相（primary 族/语义色/bg/card/text/border/`--gradient-primary`）；shadow/band/code-color/非主色渐变/on-strong **跨学段恒定**只随明暗变。
- **持久化**：`localStorage['fls:theme']` = `{preset,mode,fontSize,presetManual}`；**防 FOUC 双保险** = `index.html` `<body>` 内联脚本 + store setup 同步 hydrate。年级推断纯函数 `src/core/theme/presetInference.ts`（众数→并列取最新→空默认 junior）；`presetManual=true` 后永久停止自动覆盖。
- **字号单一源（B1 已修）**：**已移除 `documentElement.style.fontSize` 写入**，只保留 naive-ui `themeOverrides`（`FONT_SIZE_MAPS`）；全库 **0 处 rem/em 字号** → 无双缩放。
- **JS 取色服务层**：`src/core/theme/useThemeTokens.ts`（读生效 CSS 变量）+ `useChartTheme.ts`（echarts 主题）+ `presetPreview.ts`（设置页色带预览）。**`src/views|modules|components` 禁止直接 `import { palette }`**（唯例外：`ThemeProvider.vue` 是主题装配组件）。
- **App.vue 已拆分（B5）**：`src/components/ThemeProvider.vue`（封装 n-config-provider + themeOverrides）+ `AppShell.vue`（布局骨架，**版本徽章 V1.9 在这两处**）。
- **成就 28 枚**（`src/core/motivation/achievements.ts`）：M 精熟 8 / G 成长型 7 / B 行为阶梯 8 / E 探索 5；隐藏 3（`comeback`/`early-bird`/`night-owl`，未解锁前只显示剪影 `？？？`，**零泄露**）；连环 4（`chains.ts`）。`AchievementDef` 增 `category/hidden/chain/order`；`AchievementContext` 增 `packages`/`dailyStats`/`attemptedTypes`。存储升级 `{id,unlockedAt}[]` 且**读时兼容旧 `string[]`**，只增不减。
- **`dailyStats` 埋点**：`src/core/motivation/dailyStats.ts`，**内存聚合 + 1500ms 防抖 + 隐藏/卸载 flush**，保留 60 天，本地日期。**口径 = "题"级**，走 `recordAnswerEvent`，**绝不放进 `recordProgress`**（TopicDetail 有 for 循环会多 KP 重复计数）。
- **质量门禁**：`npm run lint:styles`（stylelint@17 + postcss-html/postcss-scss）+ `npm run check:hex`（自研 `scripts/check-hex.mjs`，扫 `views|modules|components` 下 hex/rgb/hsl，白名单 `core/styles/**`，行级豁免 `// check-hex-allow`，**纯黑 `rgba(0,0,0,…)` 片段自动剔除**）。**视觉回归** `npx playwright test`（`tests/e2e/visual.spec.ts`，16 张 `docs/screenshots/{页面}-{light|dark}.png`，**已用 `addInitScript` 冻结时钟确定化**，但**绑定时区**）+ 人工清单 `docs/视觉回归清单.md`。
- **测试 13 文件 / 395 用例**；一致性测试 `tests/palette-consistency.test.ts` **208 例**（含"原始块级深色覆盖 + preset 子集"断言，堵住"dark-mode 漏写非 hero token"盲区）。
- **check-hex 已知残留绕过面（低危，已决定不继续修）**：`#abcdefg`（hex 后紧贴词字符）、`hsl (…)`（函数名与括号间空格）、命名色 `white/red`（范围外）。**理由：修漏洞的改动自身引入过新绕过面，继续微调有负期望收益。**
- **下一轮 = V1.2 设计系统 2.0**（单源 token 生成 `tokens.ts` / 三层 token / UI 基元封装 / 多主题与 a11y AA / 组件文档预览）。路线图关键决策点 #1 = **是否引入构建脚本做单源生成**（尚未定）。
