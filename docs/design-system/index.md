# 设计系统 · 入口

> 状态：**V1.2 已落地**（8 基元 + 三层 token + 6 组主题）
> 本文只做「怎么读、改哪里、先跑什么」。逐项细节见：
> - [`tokens.md`](./tokens.md) —— token 分层、命名、全量组件级别名、新增白名单
> - [`primitives.md`](./primitives.md) —— 8 个基元的 props / slots / events / token / a11y
> - [`a11y.md`](./a11y.md) —— 对比度实测（6 组）、语义色分工、可见变化登记

---

## 1. 一句话版本

**颜色只有一个手写源：`src/core/styles/tokens.ts`。** 其余样式文件要么是它的生成物（禁手改），
要么是只写 `var()` 的别名（零真值）。组件永远不写色值，只写 token 名。

```
tokens.ts  ──tokens:build──▶  theme.scss  (CSS 变量，6 组主题)
           └──tokens:build──▶  palette.ts   (naive-ui themeOverrides 的数值)
                    │
                    ▼
           components.scss  (第 3 层：组件级别名，纯 var()，手写)
                    │
                    ▼
           variables.scss   (SCSS 门面 $x: var(--x)；组件只引它或直接 var())
                    │
                    ▼
           src/components/ui/*.vue   (8 基元，零硬编码色)
```

## 2. 三层 token：各层能写什么、不能写什么

| 层 | 载体 | 谁生成 | 允许的写法 | 组件可否直接引用 |
|---|---|---|---|---|
| **1 · primitive** | `tokens.ts` 里的 `HUES` / `NEUTRALS` / `RADIUS` / `SPACE` / `FONT` / `LEADING` / `MOTION` / `SUBJECTS` | 手写（**唯一色源**） | 字面值 + 成对（浅/深、三学段） | **不可**，只有 `buildSemantic` 与生成器用 |
| **2 · semantic** | `theme.scss` 的 `--x` + `palette.ts` 的数值 | ✅ `npm run tokens:build`（**禁手改**） | 由第 1 层派生或显式给出 | 可以：`var(--x)` / `$x` |
| **3 · component** | `components.scss` 的 `--<component>-<element>-<property>` | 手写（`tokens.ts` 的 `COMPONENT_TOKENS` 是权威镜像，测试锁定双写一致） | **只允许** `var(--语义token)` 或常量尺寸 | 可以：`var(--badge-warning-bg)` |
| naive 组件覆盖 | `palette.ts` 的 `buildThemeOverrides` | ✅ 生成 | — | 由 `ThemeProvider` 注入 |

**两条铁律**

1. 第 2、3 层**没有任何真值**。看到 `#hex` / `rgba(数字…)` 出现在 `theme.scss`、`components.scss`、
   基元 `<style>` 里，就是 bug（`theme.scss` 由生成器产生，出现即说明有人手改了）。
2. 第 3 层**不是**唯一可选层。只有「一个语义 token 被 ≥2 个基元以同一语义复用」才值得起组件别名；
   单个基元内部用的语义 token 直接 `var(--primary-light)` 即可，不要为它造 `--badge-foo-bg`。

## 3. 改色 / 加色：唯一正确路径

```
1) 改 src/core/styles/tokens.ts      ← 只改这里（HUES / NEUTRALS / 常量）
2) npm run tokens:build              ← 重新生成 theme.scss + palette.ts
3) git diff 审阅两个生成物            ← 确认「只有预期的键变了」
4) npm run tokens:check              ← 磁盘产物 === 内存生成
```

**不要做的事**

- ❌ 直接改 `theme.scss` / `palette.ts`：首行有 `DO NOT EDIT` banner，`tokens:check` 与
  `tests/tokens-generation.test.ts` 会逐字节比对内存生成结果，必红。
- ❌ 在 `variables.scss` 里写死值：它是门面，全部是 `$x: var(--x)`。
- ❌ 在 `components.scss` 里写死值：第 3 层零真值。
- ❌ 在组件里 `import { palette }`：组件取色只走 CSS 变量或 `useThemeTokens` / `useChartTheme` /
  `presetPreview`（服务层封装）。

## 4. 门禁顺序（**顺序本身是设计的一部分**）

`package.json` 的 `verify` 顺序：

```
npm run tokens:check
  && npm run typecheck
  && npm run lint:styles
  && npm run check:hex
  && npm run check:text-color
  && npm run test
```

**为什么 `tokens:check` 必须最先**：

`pretest` / `predev` / `prebuild` 都会先跑 `npm run tokens:build`（自愈）。也就是说，如果有人手改了
`theme.scss` 却没改 `tokens.ts`，那么 `npm test` 会**先把脏值覆盖掉**，随后 `tests/tokens-generation.test.ts`
自然通过——**漂移被掩盖，永远抓不到**。`tokens:check` 是唯一「只检测、不自愈」的门，
必须排在所有会触发 `tokens:build` 的命令之前。

| 脚本 | 作用 | 会自愈吗 |
|---|---|---|
| `npm run tokens:check` | 内存生成 ⇄ 磁盘逐字节比对 | **否**（先跑它） |
| `npm run tokens:build` | 由 `tokens.ts` 写回两个产物 | 是 |
| `npm run check:hex` | 禁止 `src/{views,modules,components}` 出现字面量色 | 否 |
| `npm run check:text-color` | 禁止裸 `color:` 引用 `--{tone}-color` | 否 |
| `npm run lint:styles` | stylelint（选择器/属性顺序等） | 否 |
| `npm run typecheck` | `vue-tsc --noEmit` | 否 |
| `npm run test` | vitest（含 `tests/design-system-docs.test.ts` 文档防漂移） | 只自愈 token 产物 |

## 5. 8 个基元索引

全部位于 `src/components/ui/`。「包」= 内部代理 naive-ui 同名组件（键盘/焦点/a11y 继承自 naive）；
「自建」= 自己写的语义结构。

| 基元 | 关系 | 用途 | 最关键 token | 详见 |
|---|---|---|---|---|
| `AppButton` | 包 `n-button` | 所有按钮入口，统一圆角与焦点环 | `--btn-focus-ring`（主按钮底色来自 `palette.ts` 的 `Button.colorPrimary`） | [primitives.md#appbutton](./primitives.md#appbutton) |
| `AppCard` | 包 `n-card` | 内容卡片；`hoverable` 可抬升、`paddingless` 去内边距 | `--radius-lg` `--shadow-sm` `--danger-light` | [primitives.md#appcard](./primitives.md#appcard) |
| `AppBadge` | 自建 `span` | 计数 / 状态标签（软色 pill，可关闭） | `--badge-{tone}-bg` `--{tone}-text` | [primitives.md#appbadge](./primitives.md#appbadge) |
| `EmptyState` | 包 `n-empty` | 空列表占位，可选一个主行动 | `--empty-icon-fg` `--text-sub` | [primitives.md#emptystate](./primitives.md#emptystate) |
| `PageHeader` | 自建 `header` | 页面标题区（面包屑 / 图标 / 动作 / 副标题） | `--text-main` `--page-header-border` | [primitives.md#pageheader](./primitives.md#pageheader) |
| `ProgressBar` | 自建 `div` | 掌握度 / 完成度条，`role="progressbar"` | `--progress-track-bg` `--progress-fill-bg` | [primitives.md#progressbar](./primitives.md#progressbar) |
| `SectionTitle` | 自建 | 小节标题（可选左竖条 / 计数 / 右侧插槽） | `--text-main` `--badge-neutral-bg` | [primitives.md#sectiontitle](./primitives.md#sectiontitle) |
| `StatCard` | 自建 `div` | 统计数字卡（竖排/横排、可交互） | `--stat-value-fg` `--card-bg` | [primitives.md#statcard](./primitives.md#statcard) |

> 展示页：`src/views/DesignSystem.vue`，路由 `/design-system`，**仅 `import.meta.env.DEV` 注册**
> （生产构建里不存在）。改基元先在这里过一遍浅色/深色。

## 6. 主题预设

三套学段预设，`ThemePreset` = `'primary' | 'junior' | 'senior'`，默认 **junior（初中）**。
元数据在 `src/core/theme/presetPreview.ts`（`PRESET_META` + `presetPreview()`，供设置页色带预览）。

| preset | 学段 | 定位 | 主色 · 浅 | 主色 · 深 | 图标 |
|---|---|---|---|---|---|
| `primary` | 小学 | 暖亮活泼 | `#f2760c` | `#ffa447` | 🌞 |
| `junior` | 初中 | 清新松绿 | `#2d6a4f` | `#4fa57f` | 🌿 |
| `senior` | 高中 | 沉静蓝灰 | `#3b5b7a` | `#7fa3c4` | 🏔️ |

切换方式：`src/core/stores/theme.ts` 把预设写到 **`document.body` 的 `data-theme-preset`**
（`body.dataset.themePreset`），深色是 `body` 上的 `dark-mode` class。`theme.scss` 用 6 组选择器
按特异性叠加（`:root` (0,1,0) → preset 浅 (0,1,1) → `body.dark-mode` (0,1,1) → preset 深组合 **(0,2,1)**）。
**组合块必须存在且非空**，否则「深色 + 非默认学段」会串成学段浅色。详见 [`tokens.md`](./tokens.md#4-6-组选择器与特异性必须记住)。

预设默认 `junior`；未手动选择（`presetManual === false`）时由 `src/core/theme/presetInference.ts`
按学习包年级**自动推断**，年级无效则回落 `junior`（`usedFallback: true`）。家长在设置页手动选择后
`presetManual = true`，自动推断停止。

## 7. 两条语义不变量

1. **`-color` 是图形色，`-text` 是文字色。**
   `--{primary,success,warning,danger,info}-color` 只能用于边框 / 描边 / 背景 / 渐变 / 图形填充；
   一切 `color:` 必须用 `-text`（对自身 `-light` 也 ≥4.5，6 组全过）。由 `npm run check:text-color` 强制。
2. **半透明一律 `rgba(var(--x-rgb), a)`，不用 `color-mix()`。**
   例：焦点环 `rgba(var(--primary-rgb), 0.55)`。理由见 [`tokens.md`](./tokens.md#6-为什么不用-color-mix)。

## 8. 我要加东西，该改哪个文件？

| 我想… | 改这里 | 别忘了 |
|---|---|---|
| 换某个学段的品牌色 | `tokens.ts` 的 `HUES[preset][mode].brand*` | `npm run tokens:build` + diff 审阅 |
| 换阴影 / band / code 色 | `tokens.ts` 的 `NEUTRALS[mode]` | 同上（维度 B：跨学段恒定） |
| 加一个语义 token | 先在 [`tokens.md`](./tokens.md#5-新增-token-白名单只有这-15-个) 白名单里查 | 白名单外的新增 = 改设计，不允许顺手加 |
| 加一个组件级别名 | `components.scss` + `tokens.ts` 的 `COMPONENT_TOKENS`（**双写**） | `tests/design-system-docs.test.ts` 会要求写进 `tokens.md` |
| 加一个新基元 | `src/components/ui/`、展示页、`primitives.md` | 同上测试要求 `primitives.md` 出现该文件名 |
| 新增一个可用变量到组件 | `variables.scss`（门面） | 只加 `$x: var(--x)`，不写值 |

## 9. 文档防漂移

`tests/design-system-docs.test.ts` 用 node 环境静态读文件，保证「改了代码忘了改文档」会红：

- 新增/删除 `src/components/ui/*.vue` → `primitives.md` 的基元标题集合必须同步；
- 新增/删除 `COMPONENT_TOKENS` 键 → `tokens.md` 必须同步；
- 文档里出现源码中不存在的基元文件名 → 红；
- 文档里出现「CSS 属性名 + 字面色值」形态的写法（属性名与色值紧邻、中间只有冒号）→ 红
  （说明性正文里孤立地写 `#2d6a4f` 不算，见该测试顶部注释）；
- 文档里提到的 `npm run <x>` 必须在 `package.json` 里真实存在 → 防止文档停留在已删除的命令上。
