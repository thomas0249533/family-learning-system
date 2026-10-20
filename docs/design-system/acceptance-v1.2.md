# V1.2「设计系统 2.0」独立终验报告

- 验收人：Edward（QA · 独立终验，未参与实现）
- 日期：2026-10-20
- 对象：批1 单源 token 生成地基 → 批3/4/5 页面与模块替换 → 批6a a11y AA → 三·补（组件文档 / 主题预设覆盖 / 基元 a11y 修复）
- 方法：跑真命令 + 反向证明门禁会红 + 逐基元消费者核查 + 人眼比对三套预设截图 + 独立读源码复核转述结论。**全程未改任何源码、未 commit**；反向验证的所有临时改动均已还原（见 A.4 工作区核验）。

---

## 0. 总结论

**有条件通过。**

- 门禁、反向证明、基元落地、主题预设、a11y AA 审计**全部独立复跑通过，零功能性/阻塞性缺陷**。实现方对门禁结果的自报（32 文件 / 2078 用例、69 e2e）**属实**。
- 但本版的核心主张是「文档即真相源」（三·补 交付了组件文档 + 防漂移测试），而独立核查发现**四处文档与源码互相矛盾**（见缺陷 D1），其中 a11y 证据文档里对 PageHeader「大号文本判据」的描述与源码不符（转述属实，且经我读源码独立确认）。这些不影响任何运行时行为与门禁结果，但违背本版自己立的原则，**必须修**（均为文档/生成器一行级修改）。
- 另有 3 条低危项（D2/D3/D4），建议修，不作为通过条件。

---

## A. 门禁全绿

### A.1 `npm run verify`（exit 0）

```
[tokens:check] ✓ src/core/styles/theme.scss
[tokens:check] ✓ src/core/styles/palette.ts
[tokens:check] OK — 2 产物均与 tokens.ts 逐字节一致
[check:hex] OK — 已扫描 46 个组件层文件，未发现硬编码颜色。
[check:text-color] OK — 已扫描 46 个组件层文件，color: 未引用语义 -color。
 Test Files  32 passed (32)
      Tests  2078 passed (2078)
   Start at  08:42:27
   Duration  7.72s
```

typecheck（vue-tsc --noEmit）与 lint:styles 无输出即无违规，链条 `&&` 走到末尾 exit 0。与自报的「32 文件 / 2078 用例」一致。

### A.2 `PW_TRACE=off npx playwright test`

```
  69 passed (2.7m)
```

与自报一致。按本机已知坑关闭 trace 后无 EPERM 误报；失败判据复核：全部为 `ok`，无 error-context。

### A.3 `npm run a11y:contrast`

```
[a11y:contrast] 配对总数 660；非通过 111（例外 3；其余均已判不适用）
[a11y:contrast] MUST_PASS 失败 0；例外「不得变差」失败 0；未分类失败 0
[a11y:contrast] ✓ MUST_PASS 全达标 + 例外表未变差 + 无未分类失败项
```

MUST_PASS 36 对 × 6 组全达标；3 个例外（`text-muted ↔ bg-color-hover`，4.06 / 4.30 / 4.23）有登记与「不得变差」下限。复跑为确定性的：重跑后 `git status` 对 `a11y.md` 无 diff。

### A.4 工作区核验（终验结束时）

```
$ git status --short
 M docs/memory/2026-10-19-v1.3-impl.md
```

仅此一条，且**是终验开始前就存在的工作区改动**（V1.3 实施记录，非本验收产生），`git diff` 为 +23/-1 行的记录追加。除此之外无任何源码/测试/文档改动残留。

---

## B. 反向证明门禁不是摆设（四条全部「先红后绿」）

### B.1 tokens:check —— **会红** ✅

改动：`src/core/styles/tokens.ts:137` junior.light `brand: '#2d6a4f'` → `'#2d6a50'`（手改唯一手写色源）。

```
[tokens:check] ✗ 漂移：src/core/styles/theme.scss
   首个不等 offset=2969
   磁盘 : … --primary-color: #2d6a4f; …
   生成 : … --primary-color: #2d6a50; …
[tokens:check] ✗ 漂移：src/core/styles/palette.ts
   首个不等 offset=5434
[tokens:check] FAILED — 生成物与 tokens.ts 不一致，请运行 npm run tokens:build
```

还原（`git checkout -- src/core/styles/tokens.ts`）后：

```
[tokens:check] ✓ src/core/styles/theme.scss
[tokens:check] ✓ src/core/styles/palette.ts
[tokens:check] OK — 2 产物均与 tokens.ts 逐字节一致
```

### B.2 check:hex —— **会红** ✅

改动：`src/views/Review.vue:233` 注入 `.card { color: #123456; }`。

```
[check:hex] 发现 1 处组件层硬编码颜色：
  src/views/Review.vue:233  /* tampered */ .card { color: #123456; }
```
（exit 1）

还原后：`[check:hex] OK — 已扫描 46 个组件层文件，未发现硬编码颜色。`（exit 0）

### B.3 check:text-color —— **会红** ✅

改动：`src/views/Review.vue:233` 注入 `.card { color: var(--primary-color); }`。

```
[check:text-color] 发现 1 处 color: 引用语义 -color（应用 -text）：
  src/views/Review.vue:233  /* tampered */ .card { color: var(--primary-color); }
```
（exit 1）

还原后：`[check:text-color] OK — 已扫描 46 个组件层文件，color: 未引用语义 -color。`

### B.4 design-system-docs 防漂移 —— **会红** ✅

改动：向 `docs/design-system/primitives.md` 追加 `## AppGhost` 章节（源码不存在的基元）。

```
× primitives.md ⇄ src/components/ui/*.vue（双向锁定） > primitives.md 的二级标题集合 === 目录里的基元集合（写了不存在的基元 → 红）
  → primitives.md 提到了源码里不存在的基元：AppGhost。…: expected [ 'AppGhost' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
```

还原后：`Test Files 1 passed (1) / Tests 19 passed (19)`。

**结论：四道内容性门禁全部具备真实检出能力，不是摆设。** 临时文件均已删除，`git status` 回到 A.4 状态。

---

## C. 8 基元真实消费者核查

方法：`grep -rn "<Name"` + import 语句，排除基元自身文件与演示页 `src/views/DesignSystem.vue`，逐文件数 `<Name` 出现次数。**8 个基元全部有真实消费者，无零消费者死代码。**

| 基元 | 真实消费者文件数 | 明细（文件：模板出现次数） |
|---|---|---|
| AppButton | 14 | QuizEngine 3、VocabDrill 8、ExamPanel 7、Settings 12、ImportWizard 5、Mistakes 3、Report 2、TopicDetail 2、AchievementDetailModal 1、EmptyState(基元内) 1、ChineseWords 1、EnglishVocab 1、Parent 1、Search 1 |
| AppCard | 20 | TopicDetail 5、Settings 6、Review 2、Search 2、Report 1、Achievements 1、ExamPanel 1、ImportWizard 1 + 中文 4 模块、英语 6 模块、数学 3 模块 各 1 |
| AppBadge | 3 | Settings 3、AchievementDetailModal 1、Home 1 |
| StatCard | 4 | Report 11、Parent 6、Achievements 3、Home 3 |
| ProgressBar | 3 | AchievementDetailModal 1、Parent 1、Report 1 |
| EmptyState | 18 | TopicDetail 2、PackageList/TopicList/UnitList/Home/Mistakes/Settings/Achievements/UnknownModule 各 1 + 中文 4、英语 6 模块 各 1 |
| PageHeader | **2（最薄）** | Achievements 1、Parent 1 |
| SectionTitle | 3 | Home 3、Parent 6、Report 5 |

判定：
- **无零消费者基元**；也没有「只有演示页在用」的基元。
- **PageHeader 采用偏薄**（仅 2 页），但不算缺陷：全站页头由 `AppShell.vue:34`（`.page-title-desktop`）统一承载，PageHeader 服务于需要在页面内带 actions/subtitle/breadcrumb 的场景（Parent 的「管理学习包」按钮、Achievements 的副标题），设计自洽。建议在设计文档里写明这个分工，避免后来人误以为漏替换。

### C.b `--btn-primary-bg` 等四个别名复核（转述结论：属实）

独立 grep 复核（`var(--btn-primary-bg)` / `var(--btn-primary-bg-hover)` / `var(--btn-primary-fg)` / `var(--card-header-bg)` 全仓扫描）：

- 真实 `var()` 消费者：**0 个**。仅存在于声明处（`components.scss:29-35`、`tokens.ts:421-426` COMPONENT_TOKENS 镜像）、注释与文档。基元 CSS 里唯一被消费的 `--btn-*` 是 `--btn-focus-ring`（AppButton.vue:80）。
- 主按钮实际颜色来自 `palette.ts:334` `Button.colorPrimary: c.primaryText`（= `--primary-text`），文字 `textColorPrimary: c.textOnPrimary`。与 a11y.md「主按钮实测」表逐组吻合（我另用脚本独立复算：`#ae5509` 上白字 = 5.12，与表一致）。

**我的判断：这不是良性的「预留别名」，而是「token 表里有会咬人的垃圾」。** 理由：
1. `--btn-primary-bg: var(--primary-color)`，而 primary.light 下 `--primary-color = #f2760c`、实际按钮底是 `--primary-text = #ae5509`。谁按 `tokens.md:135` 的说明（「AppButton 主按钮底」）真的去消费它，就会得到**白字对 #f2760c = 2.85:1 的 AA 不达标按钮**——正好复活批 6a 刚修掉的缺陷，且现有门禁（check:hex / check:text-color / a11y:contrast）**都拦不住**这种用法。
2. `primitives.md:90` 的「坑」段落已诚实披露，但 `tokens.md:135-137` 仍把用途写成「AppButton 主按钮底 / AppButton hover」，两份文档自相矛盾，后者更危险（清单形态、更像规格）。
3. `--card-header-bg` 同为零消费者，且 `docs/system_design-v1.2.md:257` 声称「AppCard：… + `var(--card-header-bg)`」，与源码（AppCard 标题栏无底色）不符（见 D1-c）。

**建议（二选一，非阻塞）**：a) 把三个 `--btn-primary-*` 别名重指到与实际一致的值（bg→`--primary-text`、fg→`--text-on-primary`），让别名变真；或 b) 从 COMPONENT_TOKENS/components.scss 删除四个别名并同步 tokens.md。另须修 tokens.md:135-137 的用途描述（归入 D1）。

---

## D. 三套主题预设

### D.1 命令结果

- `tests/e2e/theme-presets.spec.ts`：primary/senior × light/dark × home/report/learn = **12 例全过**（`ok 25 … ok 48` 区段）。
- `tests/e2e/visual.spec.ts`：junior 8 页 × 浅深 = **14 例全过**（`ok 49 … ok 69` 区段）。
- 该 spec 不是纯截图：每例先断言 `body[data-theme-preset]` 与 `getComputedStyle(body).getPropertyValue('--primary-color')` 等于 theme.scss 真值（primary.light=#f2760c / senior.light=#3b5b7a 等），预设不生效会红。

### D.2 人眼比对（Read 直看 PNG）

- `docs/screenshots/primary/home-light.png`（小学·暖橙）：hero 橙色渐变、全局暖橙点缀、侧栏选中橙色，成就卡层级色与主题呼应。
- `docs/screenshots/senior/home-light.png`（高中·蓝灰）：hero 蓝灰渐变、整体冷灰克制、点缀转蓝灰。
- `docs/screenshots/home-light.png`（默认 junior·松绿）：hero 深松绿、中性绿点缀。

**三套一眼可辨**（色相、hero 渐变、选中态、图表配色均随预设切换），未见文字不清、对比度明显不足、卡片错位或溢出。另抽查 `primary/home-dark.png`：深色下橙字/图标在深底上清晰，hero 白字可读。report 页两套预设同样区分明显、数值/标签清晰。

结论：**主题预设为真实覆盖，渲染质量人眼复核通过。**

---

## E. a11y AA 复核

### E.1 审计结果

见 A.3：MUST_PASS（36 对 × 6 组）0 失败，例外 3 条均有「不得变差」下限。**抽值独立复算**：6 组 `primary-text ↔ card-bg` 我用独立脚本重算为 5.12 / 8.66 / 6.39 / 6.07 / 7.09 / 6.36，与报告口径一致、全部 ≥4.5。

### E.2 PageHeader「大号文本判据」转述复核（**属实**）

自己读源码确认（非转述）：
- `src/components/ui/PageHeader.vue:67-68`：`.page-header__title { font-size: var(--font-3xl); font-weight: 800; }`，`tokens.ts:276` `'3xl': '22px'` → **实际 22px + 800**。
- `docs/design-system/a11y.md:10`（及生成器 `scripts/a11y/contrast-report.ts:247`）：写的是 **`--font-2xl` 20px + 700**。文档过时。

**结论会不会变？不会。** WCAG 大号文本判据 = ≥18pt(24px) 常规 或 ≥14pt(≈18.66px) 粗体。20px+700 与 22px+800 都满足「粗体 ≥18.66px」，两档均属大号文本，**阈值 3.0 依旧成立**，审计的通过/失败判定不受影响。需要修的是文档的事实准确性（属 D1-a）。

### E.3 生成器定位（只定位，未改）

- 修改点：`scripts/a11y/contrast-report.ts:247`——`md.push('- `PageHeader.vue` 标题（`--font-2xl` 20px + 700）')`，应改为 `--font-3xl` 22px + 800（该文件是 `npm run a11y:contrast` 生成 `docs/design-system/a11y.md` 的唯一来源，改 md 无效）。
- 连带发现（同一缺陷族，见 D1-b）：`contrast-report.ts:228` 硬编码的消费者行号已漂移——`Home.vue:534/575/823` 与 `Parent.vue:476`；现源码 `Home.vue` 共 805 行（823 行已不存在），实际 `on-strong`×渐变消费点在 `Home.vue:416/567`、`Parent.vue:451`、`VocabDrill.vue:621`。**对比度数值本身仍算得对**（审计按 token 配对计算、不依赖行号），但报告里的「证据位置」指向了不存在/错误的行，影响可追溯性。
- 附带观察（非缺陷）：`contrast-report.ts:184` 把 `primary-text ↔ card-bg` 单独按大号 3.0 审（为 StatCard 26px/800 放宽），但该配对 6 组实测全部 ≥4.5，放宽阈值今天不掩盖任何风险。

---

## F. 三处遗留的独立判断（只判断，未改）

### F.1 `migrateV3Recovery.ts:157` 单飞锁类型混淆 —— **理论风险，低危（P3）**

定位属实：`ensureE1Migrated` 在 `inflight` 非空时 `return (await inflight) as MergeStats | null`，而 `inflight` 与 `recoverV3IfNeeded()`（返回 `MigrationMarker | null`）共用。若补偿在飞，会把 `{status:'ok-recovered', at, stats}` 形状的 MigrationMarker 当 MergeStats 返回，并**静默跳过本次重归因**。

我的判断：**「用户真会撞到」的概率接近于零，但代码谎言是真的。**
1. 两个启动入口已被 `main.ts:33-39` 用 `.then()` 串行化，启动内部不会互撞；
2. 唯一撞锁窗口 = `recoverV3IfNeeded` 在飞 ∩ 用户完成「设置→学习包管理→选文件→确认导入」。marker 为 `ok`/null 时该函数只做一条 settings 读（毫秒级）；只有 `failed` 补偿才扫表（亚秒级）。人工交互不可能快过它；
3. 现有两个「窗口内可撞」的调用点（`importService.ts:113`、`exportService.ts:213`）都**只 await、不读返回值**，被跳过的一次重归因是自愈的（下次导入/次日启动兜底），无数据损坏；
4. 真正的隐患是 `as MergeStats` 这个**返回值类型谎言**：今天无人消费，将来谁读 `stats.total` 就拿到 `undefined`，且编译器不会报。

**结论：不阻塞验收；建议顺手修（把锁的返回契约统一，或让 `ensureE1Migrated` 撞到补偿锁时改为 `await awaitE1Settled()` 后自己再跑一次）。**

### F.2 成就卡 `<button>` 内嵌 `<div>` —— **真实但不紧迫；建议低成本修（P3）**

定位属实：`src/components/AchievementCard.vue:4-60`，`<component :is="clickable ? 'button' : 'div'">` 内部是 `<div class="ach-body">` 等块级元素。HTML 语义上 button 的内容模型是 phrasing content，W3C 校验器会报；浏览器容错渲染正常，DOM/键盘/焦点行为不受影响。

**要不要修：建议修，非阻塞。** 理由：
1. 修法便宜且零行为风险：把内层 `div` 换成 `span` + CSS `display:block`（模板与样式各几行），保住原生 button 语义又通过校验；
2. 有一个比 HTML 合规更值得关注的点：ARIA 里 `button` 的后代按 presentational children 处理，卡内 `role="progressbar"`（`AchievementCard.vue:39-44`）的语义**有被读屏扁平化、只进 accessible name 的风险**，而按钮 `aria-label`（`110-116` 行）目前**不含 current/target 数字**。建议修复时顺带把「进度 x/y」并进 aria-label（或用真实 AT 实测一次），这比 phrasing-content 校验更影响实际无障碍体验。
3. 不修的现实后果：仅严格校验器报警 + 潜在的读屏进度信息缺失，无功能性破坏。

### F.3 设计书 §4「软底用 `-color`」—— **确认过时，存在误导风险（P2，归入 D1-c）**

确认属实：`docs/system_design-v1.2.md:258`（§4「8 个 UI 基元逐个设计」·样式来源）写「AppBadge：`tone` → `var(--{tone}-light)` 底 + `var(--{tone}-color)` 字（soft）」，而 `AppBadge.vue:93-112` 软底文字实际是 `color: var(--{tone}-text)`。同块 `:257` 还写「AppCard：… + `var(--card-header-bg)`」——该 token 实际零消费者（见 C.b）。

会不会误导后来人：**会**。照 §4 抄会写出 `color: var(--primary-color)`，虽然 `check:text-color` 会当场打回（门禁兜底，损害可控），但这属于「文档教人写会被门禁拒绝的代码」，且与本版自己的 `index.md`/`a11y.md`（批 6a-2 不变量）直接矛盾。建议在 v1.2 设计书这两行加勘误注（指向批 6a-2 的语义色分工），不必重写全文。

---

## 缺陷清单（按严重程度排序）

| # | 严重度 | 缺陷 | 证据/定位 | 影响 |
|---|---|---|---|---|
| D1 | **中低（必须修，均在文档/生成器，零运行时风险）** | 「文档即真相源」四处与源码矛盾 | 见下 a–d | 后来人按文档写代码/改样式会被门禁打回或做出错误决策；a11y 证据文档含错误事实 |
| D1-a | 中低 | a11y.md:10 PageHeader 判据写 `--font-2xl` 20px+700，源码为 `--font-3xl` 22px+800 | `PageHeader.vue:67-68`；生成器 `scripts/a11y/contrast-report.ts:247` | a11y 证据文档事实错误（结论幸而不变，见 E.2） |
| D1-b | 中低 | 对比度报告硬编码的消费者行号漂移（Home.vue:823 已不存在；实际 Home.vue:416/567、Parent.vue:451） | `contrast-report.ts:228`（另 229-232 同族）；`wc -l src/views/Home.vue` = 805 | 审计证据不可追溯；数值仍正确 |
| D1-c | 中低 | `system_design-v1.2.md:258` AppBadge 软底字写 `-color`（实际 `-text`）；`:257` 称 AppCard 消费 `--card-header-bg`（实际零消费） | `AppBadge.vue:93-112`、C.b grep | 教人写会被 check:text-color 打回的代码；见 F.3 |
| D1-d | 中低 | `tokens.md:135-137` 把零消费且与实际不符的 `--btn-primary-bg/-hover/-fg` 写成「AppButton 主按钮底/hover」 | `palette.ts:334`（实际 `Button.colorPrimary = --primary-text`）；`primitives.md:90` 自认零消费 | 与 primitives.md 互相矛盾；诱导错误消费（见 D2） |
| D2 | 低（建议修） | 4 个零消费者组件别名，其中 `--btn-primary-bg` 编码的是 AA 不达标色（白字 2.85:1，实际按钮 5.12:1） | `components.scss:29-35`、`tokens.ts:421-426`；独立对比度复算 | 一旦被消费即复活批 6a 修掉的缺陷，且现有门禁拦不住；二选一：重指到真值或删除 |
| D3 | 低（建议修） | `ensureE1Migrated` 撞启动补偿锁时把 MigrationMarker `as MergeStats` 返回并静默跳过本次重归因 | `migrateV3Recovery.ts:157`、`:70`；调用点 `importService.ts:113`、`exportService.ts:213` | 现实撞锁概率≈0 且后果自愈（见 F.1）；风险在于返回值类型谎言埋雷 |
| D4 | 低（建议修） | 成就卡 `<button>` 含 `<div>`（phrasing content 违规）；且 button 后代 presentational children 可能使内嵌 progressbar 语义对读屏失效，aria-label 未含进度数字 | `AchievementCard.vue:4-60`（progressbar :39-44，aria-label :110-116） | 严格校验报警；读屏可能拿不到 current/target（见 F.2） |

---

## 「必须修」条目（有条件通过的条件）

1. **D1-a**：修生成器 `scripts/a11y/contrast-report.ts:247`（`--font-2xl` 20px+700 → `--font-3xl` 22px+800），重新生成 a11y.md。
2. **D1-b**：更新 `contrast-report.ts:228-232` 的消费者行号到当前源码（Home.vue:416/567、Parent.vue:451、VocabDrill.vue:621），消除指向不存在行的证据。
3. **D1-c**：`docs/system_design-v1.2.md:257-258` 加勘误：AppBadge 软底文字为 `--{tone}-text`（批 6a-2 不变量）、AppCard 不消费 `--card-header-bg`。
4. **D1-d**：`docs/design-system/tokens.md:135-137` 更正三个 `--btn-primary-*` 别名的用途描述（或按 D2 一并删除/重指后同步）。

均为文档/生成器一行级修改，不触碰运行时代码；修完跑 `npm run verify` + `npm run a11y:contrast` 即可闭环。

## 建议修（非条件）

- D2：删除或重指 4 个零消费别名（重指方案：`--btn-primary-bg→var(--primary-text)`、`--btn-primary-bg-hover→var(--primary-text)` 或 `--primary-hover` 按实际 hover 实测、`--btn-primary-fg→var(--text-on-primary)`；`--card-header-bg` 建议直接删）。
- D3：统一单飞锁返回契约（`migrateV3Recovery.ts:70/157`）。
- D4：成就卡内层 div→span(display:block)，并把「进度 x/y」并入按钮 aria-label；用真实读屏验证一次。

## 复现命令备忘

```powershell
npm run verify                      # 门禁全绿（A）
$env:PW_TRACE='off'; npx playwright test   # 69 passed（A/D）
npm run a11y:contrast               # MUST_PASS 0 失败（E）
```
反向验证（B）：改 `tokens.ts:137` 一个色值 / 在 `Review.vue` 注入 `color: #123456` / 注入 `color: var(--primary-color)` / 向 `primitives.md` 追加 `## AppGhost`，各自对应门禁必红；还原后必绿（本报告已逐步执行并记录输出）。
