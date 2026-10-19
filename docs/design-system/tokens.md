# Token 体系

> 唯一手写源：`src/core/styles/tokens.ts`
> 生成物：`src/core/styles/theme.scss`、`src/core/styles/palette.ts`（**禁手改**）
> 手写别名：`src/core/styles/components.scss`（第 3 层）
> 门面：`src/core/styles/variables.scss`（`$x: var(--x)`）
> 载入口：`src/core/styles/index.scss` 依次 `@import` theme → components

---

## 1. 命名规则

| 层 | 形态 | 例子 | 备注 |
|---|---|---|---|
| primitive | TS 常量（camelCase 字段） | `HUES.junior.light.brand` | 不落成 CSS 变量，组件永不引用 |
| semantic | `--<role>` | `--primary-color`、`--text-main`、`--border-light` | 角色名，不带组件名 |
| semantic（成族） | `--<tone>-<variant>` | `--danger-light`、`--danger-text`、`--danger-soft`、`--danger-rgb` | tone ∈ `primary/success/warning/danger/info` |
| component | `--<component>-<element>-<property>` | `--btn-primary-bg`、`--badge-warning-bg`、`--progress-fill-bg` | 带组件名，值只能是 `var()` 或尺寸 |
| 尺寸/字号/动效 | `--radius-*` `--space-*` `--font-*` `--leading-*` `--duration-*` `--ease-*` | `--radius-control`、`--space-4` | 不随主题变 |

**反例（历史踩过）**：`--primaryColor`（不用 camelCase）、`--badge-bg`（缺 component 段，会和别的组件撞名）、
`--btn-primary-bg2`（不用数字后缀，改语义命名）。

## 2. 派生 vs 显式（`buildSemantic`）

规则：**可证等价者派生，手工调校者显式**。禁止「全量派生」——那会把现有手调色值改成公式结果，
造成全站可见变化。

**每组 `(preset, mode)` 只有 11 个派生 token**：

| 派生 | 数量 | 规则 |
|---|---|---|
| `--{tone}-rgb` | 5 | 由 `--{tone}-color` 转 `"r, g, b"` 三元组（逗号 + 空格） |
| `--{tone}-soft` | 5 | `rgba(<tone 的 rgb>, α)`，α = 浅 `0.10` / 深 `0.14` |
| `--primary-soft-strong` | 1 | `rgba(<primary rgb>, α)`，α = 浅 `0.18` / 深 `0.24` |

**其余全部显式**（手写进 `HUES` / `NEUTRALS`），尤其：

- `--{tone}-light`（浅底）与 `--{tone}-text`（**AA 手调文字色**）——`danger-text` 在浅色组比
  `danger-color` 更深，就是为了过 4.5；
- `--bg-color-hover`、`--surface-2`、`--text-on-primary`、`--border-light`、`--gradient-primary`；
- 维度 B 的 `--band-*`、`--code-color`、`--on-strong(-rgb)`、`--shadow-*`、四个非主色渐变。

## 3. 两个维度（改色前先判断属于哪个）

| 维度 | 内容 | 随什么变 | 载体 |
|---|---|---|---|
| **A** | 品牌色族、五语义色族、`--bg-color(-hover)`、`--card-bg`、`--surface-2`、`--text-*`、`--text-on-primary`、`--border-*`、`--gradient-primary` | **preset（色相）** × mode | `HUES[preset][mode]` |
| **B** | `--shadow-*`、`--band-*`、`--code-color`、`--on-strong(-rgb)`、`--gradient-warm/cool/success/sunset` | **只随 mode（明度/中性）**，跨学段恒定 | `NEUTRALS[mode]` / `ON_STRONG` |

> 判断口诀：**换学段该不该变色？** 该 → 维度 A；不该（只是深浅不同）→ 维度 B。
> 把学科无关的中性色写进 `HUES` = 三份重复 + 早晚不一致。

## 4. 6 组选择器与特异性（必须记住）

`theme.scss` 的六个块，顺序与特异性**不要改**：

| 选择器 | 特异性 | 作用域 | 内容 |
|---|---|---|---|
| `:root` | (0,1,0) | 全局恒定 | 尺寸/字号/动效 + **初中·浅全量** + 维度 B 浅 + `--on-strong(-rgb)` |
| `body[data-theme-preset="primary"]` | (0,1,1) | 小学·浅 | 维度 A 的 preset 覆盖（**子集**） |
| `body[data-theme-preset="senior"]` | (0,1,1) | 高中·浅 | 同上 |
| `body.dark-mode` | (0,1,1) | 初中·深 | **初中·深全量** + 维度 B 深 |
| `body[data-theme-preset="primary"].dark-mode` | (0,2,1) | 小学·深 | 维度 A 的 preset 深覆盖（**子集**） |
| `body[data-theme-preset="senior"].dark-mode` | (0,2,1) | 高中·深 | 同上 |

不变量：

1. 主题色变量**只**在 `theme.scss` 定义；`index.scss` 不得再引入任何定义主题变量的选择器
   （历史上 `.dark-mode` 冲突块特异性压过 `--bg-color`，导致深色背景被写死）。
2. `data-theme-preset="junior"` 或属性缺失时**不命中任何 preset 规则**，直接继承 `:root` 的初中值。
3. 深色 + 非默认学段必须命中 (0,2,1) 组合块；两个组合块**必须存在且非空**，否则串色。
4. preset 块只 emit 它**真正声明**的子集，不把从 `body.dark-mode` 继承来的值抄进去。

## 5. 新增 token 白名单（只有这 15 个）

V1.2 允许新增的 semantic token 就这些，**在白名单外新增 = 改设计**，需要走架构评审，
不允许「顺手加一个」。

| token | 维度 | 声明位置 | 用途 |
|---|---|---|---|
| `--primary-rgb` | A（派生） | 6 组全量 | `rgba(var(--primary-rgb), α)` 的唯一入口（焦点环、柔光） |
| `--success-rgb` | A（派生） | 6 组全量 | 同上 |
| `--warning-rgb` | A（派生） | 6 组全量 | 同上 |
| `--danger-rgb` | A（派生） | 6 组全量 | 同上 |
| `--info-rgb` | A（派生） | 6 组全量 | 同上 |
| `--on-strong` | B（恒定） | 仅 `:root` | 饱和色块（渐变 / 实心徽章）上的文字/图标，恒白 |
| `--on-strong-rgb` | B（恒定） | 仅 `:root` | `rgba(var(--on-strong-rgb), α)` |
| `--band-success-bg` | B | `:root` + `body.dark-mode` | Report 分数档位浅底（成功档） |
| `--band-success-border` | B | `:root` + `body.dark-mode` | 同上，边框 |
| `--band-warning-bg` | B | `:root` + `body.dark-mode` | 警告档浅底 |
| `--band-warning-border` | B | `:root` + `body.dark-mode` | 同上，边框 |
| `--band-danger-bg` | B | `:root` + `body.dark-mode` | 危险档浅底 |
| `--band-danger-border` | B | `:root` + `body.dark-mode` | 同上，边框 |
| `--code-color` | B | `:root` + `body.dark-mode` | 行内代码文字色（`<code>`） |
| `--shadow-up` | B | `:root` + `body.dark-mode` | 向上投影（底部停靠栏 / 吸底动作条） |

> `--band-*` 与 `--code-color` 是「档位语义」而不是「语义色」：它们不参与 `-color` / `-text` 分工，
> 也不得被用作一般文字色。
> `--on-strong` 与 `--text-on-primary` 的区别：前者**恒白**、只用于饱和色块；
> 后者随明暗变（深色下是深色字），用于主色实心底。

## 6. 为什么不用 `color-mix()`

- **浏览器基线**：本项目要跑在 WebView2 / 旧版 Chromium（Tauri 打包的桌面端）与部分国产内核浏览器上，
  `color-mix()` 属较新特性，没有可靠的运行时兜底手段（PostCSS 插件会把值固化，反而制造第二套真相）。
- **可静态审计**：`rgba(var(--x-rgb), α)` 的 α 是**字面常量**，对比度脚本（`npm run a11y:contrast`）
  与测试可以纯静态推导最终颜色；`color-mix(in srgb, var(--primary-color) 55%, transparent)` 需要
  运行时求值，审计脚本只能近似。
- **单一真相**：半透明必须建立在「已知 rgb 三元组」上，于是 `--{tone}-rgb` 成为唯一入口；
  混色一旦允许，就会出现 `rgba()` / `color-mix()` / `-soft` 三套等价写法，颜色开始漂移。
- **约定**：需要半透明就写 `rgba(var(--{tone}-rgb), α)`；需要固定浅底就用现成的 `--{tone}-light` /
  `--{tone}-soft` / `--band-*`，不要临时混。

## 7. 第 3 层：`components.scss` 的 `COMPONENT_TOKENS`

规则：**纯 `var()` 别名，零真值**（尺寸常量 `2px` 除外）。权威镜像在 `tokens.ts` 的
`COMPONENT_TOKENS`，`tests/tokens-generation.test.ts` 逐个键锁定「scss 声明 ⇄ 常量值」一致。

**为什么单独成文件而不塞进 `theme.scss`**：`theme.scss` 被一致性测试按「6 组变量块」解析
（键集合相等 / preset 子集 / 深色覆盖 / 逐字节生成比对）。塞进去会污染 `:root` 的键集合，
让「每个颜色类 token 必须被 `body.dark-mode` 覆盖」等断言误伤。

**作用域必须是 `body`，不能是 `:root`**（有静态守卫）：

> 自定义属性在**声明所在元素**的 computed-value 阶段就完成 `var()` 替换，子元素只继承替换后的结果。
> 主题覆盖全部落在 `body[...]` / `body.dark-mode`。若别名声明在 `:root`，它会在 `:root` 处被**提前**
> 求值成浅色值 → 深色/非主预设下不再跟随覆盖 → 表现为「深色卡片上深色字、徽章用浅色底、焦点环用错色相」。
> 声明在 `body` 上即与覆盖同元素，替换时取到覆盖后的值。

### 全量清单（19 项）

| # | token | 值（= `COMPONENT_TOKENS`） | 消费者 |
|---|---|---|---|
| 1 | `--btn-primary-bg` | `var(--primary-color)` | AppButton 主按钮底 |
| 2 | `--btn-primary-bg-hover` | `var(--primary-hover)` | AppButton hover |
| 3 | `--btn-primary-fg` | `var(--text-on-primary)` | AppButton 主按钮文字 |
| 4 | `--btn-focus-ring` | `var(--focus-ring)` | AppButton 焦点环（比通用环更贴按钮） |
| 5 | `--card-header-bg` | `var(--bg-color-hover)` | AppCard 标题栏底（**当前不启用**，见 primitives.md） |
| 6 | `--badge-neutral-bg` | `var(--bg-color-hover)` | AppBadge 中性软底；SectionTitle 计数 pill |
| 7 | `--badge-primary-bg` | `var(--primary-light)` | AppBadge 主色软底 |
| 8 | `--badge-success-bg` | `var(--success-light)` | AppBadge 成功软底 |
| 9 | `--badge-warning-bg` | `var(--warning-light)` | AppBadge 警告软底 |
| 10 | `--badge-danger-bg` | `var(--danger-light)` | AppBadge 危险软底 |
| 11 | `--badge-info-bg` | `var(--info-light)` | AppBadge 信息软底 |
| 12 | `--stat-value-fg` | `var(--text-main)` | StatCard 默认数值色 |
| 13 | `--progress-track-bg` | `var(--surface-2)` | ProgressBar 轨道 |
| 14 | `--progress-fill-bg` | `var(--gradient-primary)` | ProgressBar `gradient` 填充 |
| 15 | `--empty-icon-fg` | `var(--text-muted)` | EmptyState 大图标 |
| 16 | `--page-header-border` | `var(--border-light)` | PageHeader 底边 |
| 17 | `--focus-ring` | `rgba(var(--primary-rgb), 0.55)` | 全站 `:focus-visible` 环 |
| 18 | `--focus-ring-w` | `2px` | 焦点环宽度 |
| 19 | `--focus-ring-offset` | `2px` | 焦点环偏移（避免贴边裁切） |

> 本表由 `tests/design-system-docs.test.ts` 与 `COMPONENT_TOKENS` 双向锁定：
> 少一行 → 红；多一行（写了不存在的 token）→ 红。

## 8. 门面 `variables.scss`

所有 `$x` 都只是 `var(--x)`，**没有第二个值源**。要点：

- 通过 `vite.config.ts` 的 `additionalData` 全局注入，任何 `<style lang="scss">` 可直接用 `$x`；
- 新增变量 = 加一行 `$x: var(--x)`，**绝不在门面里给默认值**（给了就变成第二套真相）；
- 学科色（`$subject-chinese*` / `$subject-english*`）是**主题无关常量**，直接写值，
  同源镜像在 `tokens.ts` 的 `SUBJECTS`；
- `$subject-english-soft` 是唯一的字面 `rgba(…, 0.15)`，属历史遗留（词性徽章），
  新增代码请用 `--{tone}-soft` 一族，不要再加同类条目。

## 9. 常见错误对照

| 症状 | 根因 | 正解 |
|---|---|---|
| 深色下卡片上出现深色字 | 别名声明在 `:root`，被提前求值 | 别名块选择器写 `body` |
| 深色 + 小学时颜色串成初中浅色 | (0,2,1) 组合块缺失或为空 | 补齐组合块（生成器已保证） |
| 改了 `theme.scss` 重启后被还原 | 它是生成物，`predev` 会重建 | 改 `tokens.ts` 再 `tokens:build` |
| 徽章文字对比度不够 | 用了 `--{tone}-color` 当文字色 | 改 `--{tone}-text` |
| 加了个 `--foo-color` 但没人能解释属于哪层 | 白名单外新增 | 先评审：语义 or 组件别名 |
| 组件里 `import { palette }` 取色 | 越界（颜色只经 CSS 变量/服务层） | `useThemeTokens` / `useChartTheme` / `presetPreview` |
