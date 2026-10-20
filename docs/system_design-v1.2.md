# 家庭学习系统 · 设计系统 2.0 增量设计 + 任务分解（路线图 V1.2 批次）

> 角色：架构师 高见远 ｜ 目标工程：`D:\study`（当前 tag `v1.9.0` → `fd40ba8`）
> 权威输入：`doc/后续迭代方向.txt`（V1.2 六项 + P1 清单）、`docs/system_design-v1.1.md`（**§8 跨文件约定、§2.1 六组选择器特异性表继续有效，本文件全部沿用**）。
> 纪律：**只写设计文档，不写实现代码、不改源码、不打包**（工程师正并行打包 v1.9.0）。
> 用户已拍板（**不可更改**）：①引入单源生成（`tokens.ts` 为唯一源，构建期生成 `theme.scss`/`palette.ts`，一致性测试降级为"生成校验"但**不得弱化**）；②UI 基元**全套 8 个 + 全站替换**；③组件文档与预览 = **Markdown + 复用 Playwright 截图**（不引 Storybook/Histoire）；④本轮含三层 token + WCAG AA；⑤**不做**高对比/护眼主题（6 组不扩到 12 组）、多孩子/云同步/i18n/插件化。

---

## 0. 现状核查（设计前提，先摆事实）

| # | 事实 | 证据 | 对本轮的影响 |
|---|---|---|---|
| 1 | 六组选择器与特异性**已落地**，维度 A/B 已拆分 | `theme.scss:13-370`；`:root`(0,1,0) / `body[data-theme-preset=X]`(0,1,1) / `body.dark-mode`(0,1,1) / `body[data-theme-preset=X].dark-mode`(0,2,1) | **沿用**，生成器必须复刻此结构，不得改选择器/顺序 |
| 2 | `palette.ts` = 6 组 + `buildThemeOverrides(preset,theme,sizes)` + `FONT_SIZE_MAPS` | `palette.ts:116-321` | 生成物之一，签名不变 |
| 3 | `variables.scss` = 94 个 `$x: var(--x)` 门面 + 学科常量（**上轮未改动**） | `variables.scss` | **保持手写**（门面引用 `var(--x)`，无真值，天然随主题），**不纳入生成** |
| 4 | 一致性测试 **208 例**，含 A 数值/B 齐全/C 结构/D buildThemeOverrides + 原始块级深色覆盖 + preset 子集 | `tests/palette-consistency.test.ts`（498 行） | **降级为生成校验**：断言"生成物 ⇄ `tokens.ts`" + 保留全部结构不变量 |
| 5 | 门禁齐备：`lint:styles`(stylelint@17) / `check:hex` / `playwright`(16 截图，确定性时钟) | `package.json:13-14`、`scripts/check-hex.mjs`、`playwright.config.ts`、`tests/e2e/visual.spec.ts` | 每批 5 道门直接复用；`check:hex` 扫 `views/modules/components` |
| 6 | 服务层已存在：`useThemeTokens` / `useChartTheme` / `presetPreview` | `src/core/theme/*` | 基元与页面迁移沿用，不重造 |
| 7 | 装配层已拆：`ThemeProvider.vue` / `AppShell.vue` | `src/components/` | 8 基元将新建于 `src/components/ui/` |
| 8 | **全库无 `rem`**；字号单一源 = naive 覆盖（B1） | `system_design-v1.1.md §4.1` | 基元字号一律走 token，**不得引入 `rem` 缩放** |
| 9 | 页面/模块清单：views 14 个（含 learn 5、settings 1）、modules 15 个 | `find src/views src/modules` | 迁移映射见 §5 |
| 10 | 现有 UI 原子存在大量**重复手写**：`.section-title`（Home/Report/Parent 各一套）、`.stat-box/.ov-card/.stat-item`（三套）、`.subject-bar`（两套）、`n-empty`、`n-card`（6 处）、`n-button`（大量） | 逐文件核对 | 8 基元的替换目标就是这些重复原子 |

> **与路线图的张力（先声明）**：路线图 §V1.2-4 写"浅/深/跟随系统/**高对比**/**护眼**"，用户已裁定**只做前三维度**，故本文件**不设计**高对比/护眼（否则 6 组→12 组，与"单源生成 + 三层 token"收益相抵）。这是**主动缩范围**，非遗漏。

---

## 1. `tokens.ts` 数据模型设计（本轮核心）

### 1.1 设计目标与四条约束

一个 JS 模块 `src/core/styles/tokens.ts` 必须同时表达：
1. **6 组**（preset × mode）；
2. **三层**（primitive → semantic → component）；
3. **维度 A/B 拆分**（A=随 preset 变色相；B=跨学段恒定、只随明暗变）；
4. **派生规则**（`-rgb`/`-light`/`-soft`/`band-*`/gradient 是显式还是计算）。

### 1.2 关键决策：**"可证等价者派生，手工调校者显式"**（混合式）

逐值核对了现有 6 组数据，得出**哪些是纯函数、哪些是手调**（这决定"派生会不会改变视觉"）：

| token 族 | 现状 | 结论 |
|---|---|---|
| `--{primary,success,warning,danger,info}-rgb` | 例：`--primary-rgb: 45, 106, 79` = `rgb(#2d6a4f)` **精确相等** | ✅ **派生**（`rgbTuple(hero)`） |
| `--{x}-soft` | 浅 `rgba(hero-rgb, 0.10)` / 深 `0.14`，**与 hero 精确对应** | ✅ **派生**（`rgba(rgb(hero), α[mode])`） |
| `--primary-soft-strong` | 浅 `0.18` / 深 `0.24` | ✅ **派生** |
| `--gradient-primary` | `linear-gradient(135deg, <a> 0%, <b> 100%)`，a/b 为手挑 | ⚠️ **显式**（不同学段 a/b 非同一公式） |
| `--{x}-light` | 例 `#e7f3ed` ≠ `mix(#2d6a4f, white, 10%)`(=#eaf0ed) | ❌ **显式**（手调） |
| `--band-*` / `--shadow-*` / `--code-color` / `--on-strong` / 非主色 gradient | 全为手调/模式常量 | ❌ **显式**（维度 B） |
| `--bg-color-hover` / `--surface-2` / `--text-on-primary` / `--border-light` | 手调 | ❌ **显式**（维度 A） |

**意义**：把 `-rgb`（5）+ `-soft`（5）+ `-soft-strong`（1）= **11 个/组** 由公式生成（共 66 行），**其余显式**。既获得真实价值去重，又**保证生成产物与现状逐字节相同（零视觉变化）**。
> 若强行"全量派生"（如 `-light = mix(hero, white, 0.1)`），会**改变现有手调色值 → 破坏视觉零变化**。故**拒绝全量派生**。

### 1.3 结构示例（真实值示意）

```ts
// src/core/styles/tokens.ts —— 唯一源（手写，不要放进生成产物）
export type ThemePreset = 'primary' | 'junior' | 'senior'
export type ThemeMode = 'light' | 'dark'
export const PRESETS: ThemePreset[] = ['primary', 'junior', 'senior']
export const MODES: ThemeMode[] = ['light', 'dark']

/* ---------- 第 1 层：primitive（原始，最小不可再分） ---------- */
/** 维度 A · 随 preset 变（hero 色相 + 手调浅底 + 主渐变）；含 3 学段 × 2 明暗 */
export interface HuePrimitives {
  brand: string; brandHover: string; brandPressed: string; brandSuppl: string
  brandLight: string                       // 手调浅底（显式）
  success: string; warning: string; danger: string; info: string
  successLight: string; warningLight: string; dangerLight: string; infoLight: string
  bg: string; bgHover: string; card: string; surface2: string
  textMain: string; textSub: string; textMuted: string; textOnPrimary: string
  border: string; borderLight: string
  gradientPrimary: string
}
export const HUES: Record<ThemePreset, Record<ThemeMode, HuePrimitives>> = {
  junior: {
    light: {
      brand: '#2d6a4f', brandHover: '#245741', brandPressed: '#1c4633', brandSuppl: '#245741',
      brandLight: '#e7f3ed',
      success: '#15803d', warning: '#b45309', danger: '#dc2626', info: '#2563eb',
      successLight: '#e9f8ef', warningLight: '#fdf4e7', dangerLight: '#fdeded', infoLight: '#eaf1fe',
      bg: '#f6f8f5', bgHover: '#ebf0ec', card: '#ffffff', surface2: '#f9fbf9',
      textMain: '#16261f', textSub: '#3f574c', textMuted: '#5f756a', textOnPrimary: '#ffffff',
      border: '#cfdcd5', borderLight: '#e5ede8',
      gradientPrimary: 'linear-gradient(135deg, #2d6a4f 0%, #4fa57f 100%)',
    },
    dark: { /* …初中深（现状原值）… */ },
  },
  primary: { light: { brand: '#f2760c', /* …小学… */ }, dark: { /* … */ } },
  senior:  { light: { brand: '#3b5b7a', /* …高中… */ }, dark: { /* … */ } },
}

/** 维度 B · 跨学段恒定，只随明暗变 */
export interface ModeNeutrals {
  shadowXs: string; shadowSm: string; shadow: string; shadowMd: string; shadowLg: string; shadowUp: string
  bandSuccessBg: string; bandSuccessBorder: string
  bandWarningBg: string; bandWarningBorder: string
  bandDangerBg: string; bandDangerBorder: string
  codeColor: string
  gradientWarm: string; gradientCool: string; gradientSuccess: string; gradientSunset: string
}
export const NEUTRALS: Record<ThemeMode, ModeNeutrals> = {
  light: { shadowXs: '0 1px 2px rgba(22, 38, 31, 0.06)', /* … */ codeColor: '#c7254e', /* … */ },
  dark:  { /* …深色一套… */ },
}
/** 主题无关（仅 :root 定义一次） */
export const ON_STRONG = { color: '#ffffff', rgb: '255, 255, 255' } as const

/** 半径 / 间距 / 字号 / 行高 / 动效（不随主题变） */
export const RADIUS = { xs: '6px', sm: '8px', md: '12px', lg: '16px', xl: '20px', control: '10px', full: '999px' } as const
export const SPACE  = { 1: '4px', 2: '8px', /* … */ 16: '64px' } as const
export const FONT   = { '2xs': '11px', /* … */ '5xl': '32px' } as const
export const LEADING = { tight: '1.25', /* … */ relaxed: '1.7' } as const
export const MOTION  = { easeStandard: 'cubic-bezier(0.2, 0, 0, 1)', /* … */ durationSlower: '450ms' } as const
/** 学科色（主题无关常量，与 variables.scss 一致） */
export const SUBJECTS = { chinese: '#8a6b4a', /* … */ englishLight: '#4a90d9' } as const

/* ---------- 第 2 层：semantic（角色名 = theme.scss 的 --var 名） ---------- */
export const SOFT_ALPHA = { light: 0.10, dark: 0.14 } as const
export const SOFT_STRONG_ALPHA = { light: 0.18, dark: 0.24 } as const

const rgbTuple = (hex: string): string => /* '#2d6a4f' → '45, 106, 79' */

export interface SemanticTokens extends Record<string, string> {}   // 键 = CSS 变量名（不含 --）
/** 由 primitive 派生某 (preset,mode) 的完整 semantic 表。**派生规则集中于此**。 */
export function buildSemantic(preset: ThemePreset, mode: ThemeMode): SemanticTokens {
  const h = HUES[preset][mode], n = NEUTRALS[mode]
  return {
    'primary-color': h.brand, 'primary-hover': h.brandHover, 'primary-pressed': h.brandPressed,
    'primary-light': h.brandLight,                                   // 显式
    'primary-rgb': rgbTuple(h.brand),                                // 派生
    'primary-soft': `rgba(${rgbTuple(h.brand)}, ${SOFT_ALPHA[mode]})`,        // 派生
    'primary-soft-strong': `rgba(${rgbTuple(h.brand)}, ${SOFT_STRONG_ALPHA[mode]})`,
    'success-color': h.success, 'success-light': h.successLight,
    'success-rgb': rgbTuple(h.success), 'success-soft': `rgba(${rgbTuple(h.success)}, ${SOFT_ALPHA[mode]})`,
    // …warning/danger/info 同构…
    'bg-color': h.bg, 'bg-color-hover': h.bgHover, 'card-bg': h.card, 'surface-2': h.surface2,
    'text-main': h.textMain, 'text-sub': h.textSub, 'text-muted': h.textMuted, 'text-on-primary': h.textOnPrimary,
    'border-color': h.border, 'border-light': h.borderLight,
    'gradient-primary': h.gradientPrimary,
    // 维度 B 注入（跨学段恒定）
    'shadow-xs': n.shadowXs, /* …shadow-sm/shadow/shadow-md/shadow-lg/shadow-up… */
    'band-success-bg': n.bandSuccessBg, /* …band-* ×6… */ 'code-color': n.codeColor,
    'gradient-warm': n.gradientWarm, /* …warm/cool/success/sunset… */
  }
}

/* ---------- 第 3 层：component（组件级 token，见 §3） ---------- */
export const COMPONENT_TOKENS: Record<string, string> = {
  'btn-primary-bg': 'var(--primary-color)',
  'btn-primary-fg': 'var(--on-strong)',
  'btn-focus-ring': 'var(--focus-ring)',
  'card-header-bg': 'var(--bg-color-hover)',
  'badge-success-bg': 'var(--success-light)',
  'stat-value-fg': 'var(--text-main)',
  'progress-track-bg': 'var(--surface-2)',
  'progress-fill-bg': 'var(--gradient-primary)',
  // …（详见 §3，一次性在 :root 声明，纯 var() 引用，天然随 6 组）
}
```

**随机抽查（结构自洽性）**：`buildSemantic('junior','light')['primary-rgb']` → `rgbTuple('#2d6a4f')` → `'45, 106, 79'` ✔ 与现状 `theme.scss:114` 一致；`primary-soft` → `rgba(45, 106, 79, 0.1)` ✔（`normalizeColor` 后等价 `rgba(45, 106, 79, 0.10)`）。

---

## 2. 生成管线设计

### 2.1 脚本与命令

| 项 | 设计 |
|---|---|
| 生成脚本 | `scripts/tokens/generate.ts`（TS，用**已在 devDeps 的 `vite-node`** 运行，复用现有脚本范式 `vite-node scripts/validate.ts`） |
| 命令 | `"tokens:build": "vite-node scripts/tokens/generate.ts"` |
| 校验脚本 | `scripts/tokens/check.ts` → `"tokens:check": "vite-node scripts/tokens/check.ts"`（**不写盘**，生成到内存字符串，与磁盘文件逐字节比对，漂移即 `exit 1`） |
| 触发 | `"predev": "npm run tokens:build"`、`"prebuild": "npm run tokens:build"`（现有 `build` 前自动跑）、`"pretest": "npm run tokens:build"`；**并**保留手动入口 |
| 生成物 | ①`src/core/styles/theme.scss`（CSS 变量，6 组选择器）②`src/core/styles/palette.ts`（JS 对象 + `buildThemeOverrides` + `FONT_SIZE_MAPS`） |

> **为何用 `vite-node` 而非新装 `tsx`/`esbuild`**：`vite-node@2.1.9` 已在 `devDependencies`（沙箱装包风险高），可直接 `import` 本项目 `tokens.ts`（含 `import type { GlobalThemeOverrides } from 'naive-ui'` 亦可解析）。**零新增依赖**。

### 2.2 生成文件头 banner（防手改）

生成器在两个产物**首行**写入：

```ts
// ⚠️ AUTO-GENERATED FILE — DO NOT EDIT.
// Source of truth : src/core/styles/tokens.ts
// Regenerate      : npm run tokens:build
// Drift is caught by: npm run tokens:check  AND  tests/tokens-generation.test.ts
```
（SCSS 用 `//` 注释同款文案。）

### 2.3 如何防止手改生成文件（**三重防护**，直击"改完忘了重新生成"这一最大坑）

| 防护 | 机制 | 触发时机 |
|---|---|---|
| **① 自动再生成** | `predev`/`prebuild`/`pretest` 钩子 | 开发/构建/测试前**自动**重生成 → 手改被覆盖 |
| **② 漂移校验** | `tokens:check`：内存生成 vs 磁盘逐字节比对（**含规范化行尾**，见 §10 风险） | 纳入"5 道门"独立跑；CI/收尾必跑 |
| **③ 测试内嵌守卫** | `tests/tokens-generation.test.ts`：a) 磁盘文件 === 内存生成；b) 两个产物含 `DO NOT EDIT` banner；c) **若有人删掉 banner 或改值 → 红**（+ `palette-consistency` 的 tokens ⇄ theme 生成校验） | **绕过 `pretest` 的直接 vitest 运行**（`npx vitest run`）/ CI 显式跑 `tokens:check`。⚠️ 裸 `npm test` 会先跑 `pretest`→`tokens:build` **自愈覆盖手改**，故 ③ 的检测必须靠 `tokens:check`（排在 `tokens:build` 之前）或直连 vitest |

> **① ② 是「自愈」（重生成覆盖脏值），③ + `tokens:check` 才是「检测」（会红）。** 因此每批门禁必须把 `tokens:check` 排在 `tokens:build` **之前**，否则后者自愈后前者形同虚设（§5.2/§8.4.13）。

### 2.4 生成物是否入库？——**结论：入库（commit），并靠 ①②③ 守漂移**

**理由**：
1. **diff 审阅**（用户倾向）：token 改动 → 生成物 diff 直接可读，评审者能看见"6 组各改了什么"。
2. **鲁棒**：沙箱/CI 若 `vite-node` 因故失败，`npm run dev`/Playwright/vitest 仍能读到已入库的 `theme.scss`（不必先成功生成）。
3. **零成本**：生成物是**派生物**，冲突时以 `tokens.ts` 为准重生成即可。
**代价与缓解**：入库的手改风险 → 由 §2.3 三重防护消除。`.gitignore` **不**新增忽略项（保持入库）。

### 2.5 生成器契约（**必须复刻现状结构**，否则既有测试崩）

- `theme.scss` 选择器**顺序与形式**必须与现状**逐一对应**（`:root`×2[尺寸块+初中浅] / `body[data-theme-preset="primary"]` / `...senior` / `body.dark-mode`[变量块+组件微调块] / 两个组合块），使 208 例测试的 `extractBlocks` 仍能抽到。
- `:root` **尺寸/字号/动效块**保持独立 `:root {}`（`NON_COLOR_PREFIXES` 断言依赖）。
- **全局基底 `body{}`、深色组件微调 `body.dark-mode{}`、`@media print` 块**：**是否也生成？** → **决策：这些"非变量声明"用「模板常量」写在生成器里**（保持单一出口），或**保留为 `index.scss` 手写**。**采用后者**：仅"变量声明块"由生成器产出；`body` 基底/微调/print 留在手写 `index.scss`/`theme.scss` 之外的伴生文件，减少生成器复杂度。
  - 落到细节：`theme.scss` = **纯变量文件**（生成）；`index.scss` = 手写基底（已 `@import './theme.scss'`）+ 追加 `@import './components.scss'`。
  - ⚠️ 现状 `theme.scss` 尾部含 `body{}`/微调/`@media print`（`theme.scss:372-427`）→ 生成时**迁出**到 `index.scss`。这是一次**结构性搬迁**（内容零变化），需在批次 1 单独核对。

---

## 3. 三层 token 落地方式

| 层 | 载体 | 是否生成 | 组件如何用 |
|---|---|---|---|
| **primitive** | `tokens.ts` 内部常量（`HUES`/`NEUTRALS`/`RADIUS`…） | — | **组件永不直接引用**（仅 semantic 引擎与生成器用） |
| **semantic** | `theme.scss` 的 CSS 变量（`--primary-color`…） + `palette.ts`（JS 真值） | ✅ 生成 | 组件用 `var(--x)` / SCSS 门面 `$x`（`variables.scss`）；JS 取色经 `useThemeTokens`/`useChartTheme`/`presetPreview` |
| **component** | **新建 `src/core/styles/components.scss`**（手写，纯 `var()` 别名，`@import` 于 `index.scss`） | ❌ 手写（无真值，天然随 6 组） | 基元 `<style>` 用 `var(--btn-primary-bg)` 等；naive 组件级仍走 `buildThemeOverrides` |
| **naive-ui 组件覆盖** | `palette.ts` 内 `buildThemeOverrides(...)` 的 `Card/Button/Input/Tag/Menu` | ✅ 生成 | `ThemeProvider` 注入 |

**命名规范**：
- semantic：`--<role>`（`--primary-color`、`--text-main`、`--border-light`）；
- component：`--<component>-<element>-<property>`：`--btn-focus-ring`、`--badge-warning-bg`、`--stat-value-fg`、`--progress-track-bg`、`--progress-fill-bg`、`--empty-icon-fg`、`--page-header-border`。
  > **勘误（2026-10 · 终验后清理，原文保留作决策记录）**：本节早先列出的 `--btn-primary-bg`、
  > `--btn-primary-bg-hover`、`--card-header-bg` 已于 2026-10 删除 —— 三者全仓零 `var()` 消费者，
  > 且 `--btn-primary-bg` 编码的是 AA 不达标色（配白字 2.85:1）。现状与理由见
  > [`docs/design-system/tokens.md`](./design-system/tokens.md) 的「注 1」与全量清单（现为 15 项）。
- **组件级 token 只允许**：引用 semantic（`var(--x)`）或常量尺寸；**禁止**写 `#hex`/`rgba(数字)`（`components.scss` 虽不在 `check:hex` 扫描目录，但**沿用 §8 不变量，靠评审 + 可选把 styles 目录纳入自检**）。

**为什么 component token 不放进 `theme.scss`**：`theme.scss` 被一致性测试按"6 组变量块"解析。若在 `:root` 追加 `--btn-*`（`var()` 引用、6 组同值），实测会变红的**不是**"键集合相等"断言（该断言因 `:root` 传播到 6 组而恒等、不触发），而是 **「每个颜色类 token 必须也被 `body.dark-mode` 覆盖」断言**与**生成物逐字节比对**（`--btn-*` 既未出现在 `body.dark-mode`、也不在生成产物里）。故**独立成 `components.scss`**，保持 `theme.scss` 的 6 组纯净。

---

## 4. 8 个 UI 基元逐个设计（`src/components/ui/`）

**总原则**：①只引用 token（零硬编码，且 `check:hex`/`lint:styles` 会扫 `src/components` → **自证**）；②**和 naive-ui 的关系 = 「能包则包、缺则自建」**；③事件/props **尽量透传**，**行为兼容**优先（降低回归）。

| 基元 | 载体 | 关系 | props | slots | events |
|---|---|---|---|---|---|
| **AppButton** | `AppButton.vue` | **包 `n-button`**（继承键盘/焦点/a11y） | `type`(primary/default/error/warning/success/info) · `size`(tiny/small/medium/large) · `block` · `ghost` · `dashed` · `quaternary` · `loading` · `disabled` · `icon?(string)` | `default` · `icon` | `click`(透传) |
| **AppCard** | `AppCard.vue` | **包 `n-card`** | `title?` · `icon?` · `variant`(default/danger) · `paddingless?` · `hoverable?` | `header` · `header-extra`（动作区） · `default` | — |
| **AppBadge** | `AppBadge.vue` | **自建 span**（软色 pill） | `tone`(neutral/primary/success/warning/danger/info) · `soft?` · `size`(sm/md) · `closable?` | `default` · `icon` | `close` |
| **StatCard** | `StatCard.vue` | **自建**（统一 `.ov-card`/`.stat-box`/`.stat-item`） | `icon?` · `value`(string\|number) · `label` · `tone`(neutral/primary/success/warning/danger) · `layout`(vertical/horizontal) · `interactive?` | `default`(覆盖 value) · `icon` · `footer` | — |
| **SectionTitle** | `SectionTitle.vue` | **自建**（统一 `.section-header/.section-title/.section-count`） | `icon?` · `title` · `count?`(string\|number) · `level`(h2/h3) · `accent?`（Report 左竖条） | `count` · `default` | — |
| **ProgressBar** | `ProgressBar.vue` | **自建**（统一 `.subject-bar`；`role="progressbar"`） | `value`(0-100) · `max?` · `tone`(primary/success/warning/danger) · `size`(sm/md) · `gradient?` · `showLabel?` | — | — |
| **EmptyState** | `EmptyState.vue` | **包 `n-empty`** + token 容器 + 可选动作 | `description?` · `icon?` · `actionText?` · `size?` | `default` · `action` | `action` |
| **PageHeader** | `PageHeader.vue` | **自建**（统一 `.page-title`） | `title` · `subtitle?` · `icon?` · `level?` | `actions` · `breadcrumb` | — |

**样式来源（全部 token）**：
- AppButton：naive `Button` 覆盖（`buildThemeOverrides`）+ `var(--btn-*)` 补圆角/焦点环。
- AppCard：`$radius-lg` + `$shadow-sm` + `var(--card-header-bg)`；`variant=danger` 用 `$danger-light` 边框。
  > **勘误（2026-10 · 终验补充，原文保留作决策记录）**：`--card-header-bg` 实际**零 `var()` 消费者** ——
  > 全仓只剩 `components.scss:35` 的声明与 `tokens.ts` 的定义，`AppCard` **刻意不使用它**：
  > 见 `src/components/ui/AppCard.vue:56` 的注释（边框 = `--border-color`，标题栏**不铺底色**）。
  > 照原文理解成"AppCard 已消费该 token"是错的。
  > **后续**：该 token 已于 2026-10 终验后从 `tokens.ts` / `components.scss` **删除**（零消费者 + 无真实语义）。
- AppBadge：`tone` → `var(--{tone}-light)` 底 + `var(--{tone}-color)` 字（soft）；实心态用 `var(--{tone}-color)` 底 + `var(--on-strong)` 字。
  > **勘误（2026-10 · 终验补充，原文保留作决策记录）**：批 6a-2「语义色分工」后实际实现是
  > （`src/components/ui/AppBadge.vue:89-131`）：软底的**文字**是 `var(--{tone}-text)`（不是 `-color`）；
  > 实心态的**底色**是 `var(--{tone}-text)`、**文字**是 `var(--text-on-primary)`（不是 `--on-strong`）。
  > 即 `color:` 一律 `-text`，`-color` 只用于图形/填充。**照原文写字色会被 `npm run check:text-color` 直接打回。**
- StatCard：`$card-bg`/`$border-color`/`$shadow-sm` + `tone` → `--stat-value-fg`（默认 `--text-main`，tone 时取语义色）。
- SectionTitle：`--text-main` + `accent` 用 `$primary-color` 左条。
- ProgressBar：`var(--progress-track-bg)` / `var(--progress-fill-bg)`。
- EmptyState：`n-empty` 的 `description` 用 `--text-sub`。
- PageHeader：`--text-main`/`--text-sub` + `var(--page-header-border)`。

**焦点态（AA，见 §6）**：所有可交互基元（AppButton/AppCard(hoverable)/AppBadge(closable)/ProgressBar(无)）内建 `:focus-visible { outline: var(--focus-ring-w) solid var(--focus-ring); outline-offset: 2px }`。

**与 naive-ui 的关系总结**：包 = AppButton/AppCard/EmptyState（3）；自建 = AppBadge/StatCard/SectionTitle/ProgressBar/PageHeader（5）。**不改 naive 的 `n-radio-group`/`n-form`/`n-upload`/`n-modal`/`n-select`/`n-input-number`**（表单/模态属功能件，非视觉原子，替换风险高、收益低）。

---

## 5. 全站替换迁移映射 + 分批顺序

### 5.1 逐文件映射（`→` 目标基元；`· 保留` = 明确不改）

**views/**
| 文件 | 迁移 |
|---|---|
| `Home.vue` | `n-empty`→EmptyState；4×`.section-header`→SectionTitle；`.section-count`→AppBadge；`.stat-item`（进度三行）→StatCard；`.review-card`/`.rec-card`/`.ach-card` **· 保留**（专属交互卡，视觉保真，仅确保零硬编码） |
| `Report.vue` | `n-card`→AppCard；`n-button`×2→AppButton；`.section-title`(带左条)→SectionTitle(accent)；`.stat-box`×6→StatCard(tone)；`.subject-bar`→ProgressBar；`.mistake-item`/`.review-item`→StatCard |
| `Parent.vue` | `.page-title`→PageHeader；`.section-title`→SectionTitle；`.ov-card`×6→StatCard；`.subject-bar`→ProgressBar；`n-button`→AppButton；`.week-chart` **· 保留**（自绘柱状） |
| `Search.vue` | `n-card`→AppCard；`n-button`→AppButton；`n-tag`/高亮 **· 保留**（文本高亮逻辑） |
| `Review.vue` | `n-card`→AppCard；`n-button`→AppButton；`.action-pill` **· 保留**（或抽为 AppButton 变体，见批次 3 决策） |
| `Mistakes.vue` | `n-card`→AppCard；`n-button`→AppButton；空态→EmptyState |
| `Learn.vue` | `n-card`→AppCard；`n-button`→AppButton；页头→PageHeader |
| `Settings.vue` | `n-card`→AppCard；`n-button`→AppButton；`.preset-card` **· 保留**（专属控件，已 token 化）；`.preset-advice`/`.empty-hint`→AppBadge/EmptyState；`n-radio-group` **· 保留** |
| `learn/ExamPanel.vue` | `n-card`→AppCard；`n-button`→AppButton；**QuizEngine 交互区 · 保留** |
| `learn/TopicDetail.vue` | `n-card`→AppCard；`n-button`→AppButton；**QuizEngine 交互区 · 保留** |
| `learn/TopicList.vue` / `PackageList.vue` / `UnitList.vue` | `n-card`→AppCard；`n-button`→AppButton；空态→EmptyState |
| `settings/ImportWizard.vue` | `n-card`→AppCard；`n-button`→AppButton；**`n-form`/`n-modal`/`n-upload`/`n-select`/`n-input-number` · 保留** |

**modules/**
| 文件 | 迁移 |
|---|---|
| `chinese/ChineseText·Words·Poem·Writing.vue` | `n-card`→AppCard；`n-button`→AppButton；学科专属块 **· 保留** |
| `english/EnglishVocab·Reading·Sentence·Grammar·Writing.vue` | 同上 |
| `math/MathConcept·Formula·Life.vue` | 同上 |
| `core/VocabDrill.vue` | `n-card`→AppCard；翻卡/选项交互 **· 保留** |
| `core/QuizEngine.vue` | **· 保留**（判题/选项/主观题自评强交互；如迁移仅"提交/下一题/退出"等**普通按钮**→AppButton，**选项按钮不动**） |
| `core/UnknownModule.vue` | EmptyState |

> **"哪些不改"清单（硬约定）**：`n-radio-group/radio-button`、`n-form`、`n-modal`、`n-upload`、`n-select`、`n-input-number`、QuizEngine 选项/反馈区、echarts 容器、PDF 导出 DOM、`.week-chart` 自绘、`.preset-card`、`.rec-card`/`.ach-card`/`.review-card` 等专属交互卡。

### 5.2 分批（每批**可独立**跑 5 门后 commit）

| 批 | 内容 | 门禁（每批都跑） |
|---|---|---|
| **批1 单源生成地基** | `tokens.ts` + `scripts/tokens/{generate,check}.ts` + 生成 `theme.scss`/`palette.ts` + `components.scss` + 改造测试 + `package.json` hooks | `tokens:check` → `vue-tsc` → `vitest` → `lint:styles` → `check:hex` → `playwright`（**视觉应完全不变**） |
| **批2 8 基元** | `src/components/ui/*`（8 个）+ showcase 页 + 基元截图 + 基元单测 | 同上（页面未改 → 16 张旧截图应不变） |
| **批3 低风险页** | Report / Parent / Settings / Search / Mistakes / Review | 同上；重点比对这 6 页截图 |
| **批4 中风险页** | Home / Learn / learn/*（5） | 同上 |
| **批5 模块层** | modules/chinese·english·math·core + ImportWizard | 同上 |
| **批6 a11y + 文档 + 收尾** | 对比度修正（可见变化登记）、`docs/design-system/*`、最终基线截图 | 同上 + 对比度报告脚本 |

> **"改一批 → 门禁 → commit"**：命令固定为（**`tokens:check` 必须在 `tokens:build` 之前** —— 后者会自愈脏值，排在前面才拦得住）
> `npm run tokens:check && npm run tokens:build && npx vue-tsc --noEmit && npm test && npm run lint:styles && npm run check:hex && npx playwright test`

---

## 6. 可访问性 AA 方案（含诚实的"预计不达标"清单）

### 6.1 审计方法

新增 `scripts/a11y/contrast-report.ts`（`vite-node`，零依赖）：从 `tokens.ts` 的 `buildSemantic(p,m)` 取 6 组真实值，对**关键前景/背景对**计算 WCAG 对比度：
- 正文/次级/弱化文字 对 **bg 与 card**（阈值 **4.5:1**，大号文本 3.0:1）；
- `--on-strong`(#fff) 对 **primary**（按钮底）；
- `--text-on-primary` 对 **primary**；
- 语义色（success/warning/danger/info）作**文字** 对 bg/card；
- primary 作**文字**（链接/激活态）对 bg/card。
输出 6 组表格 + `PASS/FAIL`，写入 `docs/design-system/a11y.md`。**fail 即列为待修**。

### 6.2 预计不达标的组合/token（**如实预判**，工程以脚本实测为准）

| 组合 | 对 | 预估比值 | 判定 | 处置 |
|---|---|---|---|---|
| **小学·浅** | `--text-muted #877665` on `--bg #fff8f1` | ≈ 3.9 | ❌ <4.5 | 加一个"文本专用"加深值 |
| **小学·浅** | `--primary #f2760c` 作**文字** on 白卡 | ≈ 3.0 | ❌ | 引入 `--primary-text`（加深橙，≥4.5） |
| **小学·浅** | `--on-strong #fff` on `--primary #f2760c`（按钮底） | ≈ 3.0 | ❌（按钮文字 13px 非大号） | 引入 `--primary-strong`（按钮底加深）或按钮字转深色 |
| **小学·浅** | `--warning #c9820a` 作文字 on 白 | ≈ 3.4 | ❌ | 引入 `--warning-text` |
| **初中·浅/高中·浅** | primary 作文字/按钮底 | ≈ 5.9 / 6.6 | ✅ | 无需变（**零变化**） |
| 深色三组 | text/sub/muted on card | ≥5.0（粗估） | ✅ | 无需变 |
| 深色三组 | 语义色 on card | 大体 ✅；个别临界以脚本为准 | 待测 | 用户已授权**可微调深色语义色** |

### 6.3 处置设计（**最小可见变化**）

- 新增**文本/按钮专用派生色**（不替换品牌色，仅新增 token；仍由 `tokens.ts` 派生或显式）：
  - `--primary-text`：primary 的"可读文本"变体（对 card/bg ≥4.5）；初中/高中 = `--primary-color`（**零变化**），小学 = 加深橙。
  - `--primary-strong`：primary 作**按钮底**且叠白字时的加深变体（对 `--on-strong` ≥4.5）；初/高 = 现值，小学 = 加深。
  - `--warning-text` / `--danger-text` / `--success-text` / `--info-text`：同名语义色的"可读文本"变体（初/高多等于现值）。
- **可见变化清单（单独列出，附理由）**：
  1. 小学·浅的"主色文字"（激活导航、链接、`.rec-cta`）由 `#f2760c` → `--primary-text`（更深），**为达 AA 正文 4.5:1**；
  2. 小学·浅的主按钮底色由 `#f2760c` → `--primary-strong`（更深），**为白字达 4.5:1**；
  3. 小学·浅的弱化文字 `--text-muted` 加深，**为达 4.5:1**；
  4. 小学·浅的 warning 文字加深。
  > 其余页面**视觉零变化**。以上 4 处**必须**在 `docs/design-system/a11y.md` 登记（改了哪 6 组中的哪几组、原值/新值/实测比值/理由），并**更新 Playwright 基线**（属"预期基线变更"，非回归）。

### 6.4 `focus-visible` 规范

- 新增 token：`--focus-ring: rgba(var(--primary-rgb), 0.55)`、`--focus-ring-w: 2px`、`--focus-ring-offset: 2px`（`components.scss`，纯 var 引用）。
- 全局规则（`index.scss` 或 `components.scss`）：
  ```css
  :focus-visible { outline: var(--focus-ring-w) solid var(--focus-ring); outline-offset: var(--focus-ring-offset); }
  :focus:not(:focus-visible) { outline: none; }
  ```
- **禁止**移除 outline 而不给替代（审查约定）；naive 组件焦点走其内置 + `themeOverrides`。

### 6.5 色盲友好（红绿色盲）

- **不以颜色为唯一信号**：正确/错误、成功/失败**必须**同时有**图标或形状或文字**（✓/✕、`isCorrect` 文案）。
- 现状：QuizEngine 反馈已有对错文字/状态；本轮**规则化**：新增/替换的基元中，`AppBadge`/`StatCard` 的语义 `tone` **必须**可叠加图标（`icon` slot），组件文档标注"语义不得仅靠颜色"。
- 语义色在红绿色盲模拟（deuteranopia）下区分度依赖**明度差**：保留现有 `success#15803d / danger#dc2626` 的明度差异；`a11y.md` 记录模拟结论。

### 6.6 `prefers-reduced-motion`

- 复用既有约定（成就动效已实现）；全局补一条：
  ```css
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
  ```
  （或按元素精简，避免影响必要反馈；工程按批次评估。）基元动效（hover 提升、ProgressBar 过渡）在 reduced-motion 下退化静态。

---

## 7. 组件文档（Markdown + Playwright 截图复用）

```
docs/design-system/
├── README.md          # 索引 + 如何跑预览/生成/门禁
├── tokens.md          # 三层 token 结构 + 6 组数值表 + 派生规则 + 生成管线（§1–2）
├── primitives.md      # 8 基元：props/slots/events/示例 + 内嵌截图
├── a11y.md            # 对比度审计表（6 组）+ focus-visible + 色盲 + reduced-motion + 可见变化登记
├── migration.md       # §5 逐文件映射 + 分批进度勾选
└── assets/            # 截图（符号链接或复制自 docs/screenshots/ds/）
```

**预览 = 复用 Playwright（不引 Storybook/Histoire）**：
- 新增**开发专用**展示页 `src/views/DesignSystem.vue`（路由 `/design-system`，仅 `import.meta.env.DEV` 注册，**生产路由不含**）。
- 新增 `tests/e2e/primitives.spec.ts`：对该页 × 浅/深 × 各状态（default/hover/disabled/selected/empty）截图 → `docs/screenshots/ds/{primitive}-{state}-{light|dark}.png`（沿用 §现有"冻结时钟 + 预置 `fls:theme`"范式）。
- `primitives.md` 用相对路径内嵌这些 PNG；**零新增依赖**。

---

## 8. 文件清单 + 任务分解 + 风险 + 共享知识

### 8.1 文件清单

**新增**
```
src/core/styles/tokens.ts                     # ★ 唯一源（手写）
src/core/styles/components.scss               # 组件级 token（手写，var() 别名）
scripts/tokens/generate.ts                    # 生成器（vite-node）
scripts/tokens/check.ts                       # 漂移校验（vite-node）
scripts/a11y/contrast-report.ts               # 对比度审计（vite-node）
tests/tokens-generation.test.ts               # 生成一致性 + banner
tests/e2e/primitives.spec.ts                  # 基元截图
src/components/ui/AppButton.vue               # 8 基元
src/components/ui/AppCard.vue
src/components/ui/AppBadge.vue
src/components/ui/StatCard.vue
src/components/ui/SectionTitle.vue
src/components/ui/ProgressBar.vue
src/components/ui/EmptyState.vue
src/components/ui/PageHeader.vue
src/views/DesignSystem.vue                    # 开发专用展示页
docs/design-system/README.md · tokens.md · primitives.md · a11y.md · migration.md
docs/system_design-v1.2.md                    # 本文件
```
**改动**
```
src/core/styles/theme.scss                    # 改为「生成物」（纯变量；基底/微调/print 迁出到 index.scss）
src/core/styles/palette.ts                    # 改为「生成物」
src/core/styles/index.scss                    # 承接 body 基底/深色微调/@media print；@import './components.scss'
tests/palette-consistency.test.ts             # 改造为「生成校验」（保留全部结构不变量）
package.json                                  # tokens:build / tokens:check / a11y:contrast 脚本 + predev/prebuild/pretest
（5.1 表内 views/modules 各文件）              # 分批替换
```
> **不变**：`variables.scss`（门面）、`ThemeProvider.vue`、`AppShell.vue`、`useThemeTokens/useChartTheme/presetPreview`、`check-hex.mjs`、`.stylelintrc.json`、`playwright.config.ts`。

### 8.2 任务分解（≤5，含依赖与并行）

| ID | 任务 | 源文件 | 依赖 | 优先级 |
|---|---|---|---|---|
| **T01** | **单源生成地基**（`tokens.ts` + 生成器/校验 + 生成 `theme.scss`/`palette.ts` + `components.scss` + 测试改造 + hooks） | §8.1 批1 全部 | — | P0 |
| **T02** | **8 UI 基元 + 展示页 + 基元截图** | `src/components/ui/*`(8)、`src/views/DesignSystem.vue`、`tests/e2e/primitives.spec.ts` | T01 | P0 |
| **T03** | **全站替换·低风险页**（Report/Parent/Settings/Search/Mistakes/Review） | 6 个 view | T02 | P0 |
| **T04** | **全站替换·中高风险**（Home/Learn/learn×5/modules×15/ImportWizard） | 其余 view+module | T02 | P0 |
| **T05** | **a11y（AA）+ 文档 + 视觉基线 + 收尾** | `scripts/a11y/contrast-report.ts`、`docs/design-system/*`、对比度修正、基线截图 | T03、T04 | P0 |

- **并行**：`T01 → T02 → { T03 ∥ T04 } → T05`。T03 与 T04 **互不共享文件**（不同页面）→ 可并行；其余线性（T05 依赖两者）。
- ⚠️ **共享文件冲突**：`index.scss` 仅 T01 动；`tests/e2e/visual.spec.ts` 若 T05 更新基线需串行于 T03/T04。

### 8.3 风险登记

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| **生成管线一致性**（"改完忘生成"） | 高 | 手改生成物 / 忘跑生成器 | `predev`/`prebuild`/`pretest` 自动再生成 + `tokens:check` + `tests/tokens-generation.test.ts`（三重防护，§2.3） |
| **生成器未复刻结构 → 208 例崩** | 高 | 生成器改了选择器顺序/基底块会让解析失配 | 生成器契约（§2.5）：变量块生成、基底/print 迁出 `index.scss`；先"生成后跑 208 例应全绿"再继续 |
| **`theme.scss` 行尾（CRLF/LF）漂移** | 中 | 本机工具可能写入 CRLF → 逐字节比对误报 | 生成器统一写 `\n`；`tokens:check`/测试比对前 `\r\n → \n` 规范化；`.gitattributes` 声明 `*.scss/*.ts text eol=lf`（可选，建议加） |
| **全站替换回归** | 高 | 基元替换可能改布局/间距/交互 | 分批（6 批）小步提交；每批 5 门 + Playwright 截图比对；**包 naive 组件**保行为；"不改清单"冻结高危交互 |
| **a11y 修正导致可见变化** | 中 | 小学 primary/muted 对比度不足 | **单列 4 处可见变化**（§6.3）并登记；更新基线（属预期）；其余零变化 |
| **沙箱 `npm install` 风险** | 中 | 历史 SIGTERM | **本轮零新增依赖**（`vite-node`/Playwright/stylelint 均已装）；生成/审计脚本用 Node 内置 |
| **`vite-node` 导入 `tokens.ts`（含 naive 类型）失败** | 中 | 类型导入/路径别名 | 生成器只 `import` 值导出（`type` 导入被擦除），必要时 `import type` 显式；失败则退化为"生成器内联读取 TS 常量" |
| **component token 污染 6 组断言** | 中 | `--btn-*` 进 `:root` → 触发「颜色类 token 须被 `body.dark-mode` 覆盖」断言 + 生成物逐字节比对（**非**"键集合相等"——该断言恒等不触发） | component token 独立 `components.scss`（§3），不入 `theme.scss` |
| **三层 token 与现有 naive 覆盖重复** | 低 | 圆角在 naive/SCSS/token 三处 | 以 token 为准，naive 覆盖引用相同值；文档标注单一来源 |

### 8.4 共享知识（跨文件硬约定）

1. **`tokens.ts` 是唯一源**；`theme.scss`/`palette.ts` 是**生成物**，禁止手改（banner + 三重防护）。
2. **`variables.scss` 保持手写门面**（`$x: var(--x)`），不纳入生成。
3. **六组选择器与特异性表（v1.1 §2.1）继续有效**：`:root`(0,1,0) / preset 浅(0,1,1) / `body.dark-mode`(0,1,1) / preset 深组合 **(0,2,1)**；组合块**必须存在且非空**；主题变量**只**在 `theme.scss`（生成）定义。
4. **维度 A/B**：preset 块只管色相族；shadow/band/code/on-strong/非主色 gradient 跨学段恒定（只在 `:root`/`body.dark-mode`）。
5. **组件零硬编码**：`src/views/**`、`src/modules/**`、`src/components/**` 禁 `#hex`/`rgba(数字)`（纯黑阴影放行；`check-hex-allow` 豁免）；基元**只引用 token**。
6. **组件取色边界**：组件不 `import palette`；JS 取色经 `useThemeTokens`/`useChartTheme`/`presetPreview`；PDF/打印固定浅色。
7. **组件级 token 命名**：`--<component>-<element>-<property>`；只引用 semantic/尺寸，禁字面量色。
8. **语义不靠颜色单信号**（色盲）：正确/错误、成功/失败须有图标/形状/文字冗余。
9. **焦点可见**：`:focus-visible` 环（token 化）；禁止无替代地去掉 outline。
10. **尊重 `prefers-reduced-motion`**。
11. **字号单一源**：naive 覆盖（`FONT_SIZE_MAPS`）；**不引入 `rem` 缩放**。
12. **不复刻选择器/顺序**以外不得改 `theme.scss` 之外定义主题变量的文件；`index.scss` 不得再引入主题变量。
13. **门禁顺序（每批）**：`tokens:check → tokens:build → vue-tsc → vitest → lint:styles → check:hex → playwright`（**`tokens:check` 先于 `tokens:build`**：前者「检测」、后者「自愈」；顺序反了则检测被自愈掩盖）。
14. **生成物入库**；改 `tokens.ts` → `npm run tokens:build` → diff 审阅 → commit。
15. **测试同步**：改 token/基元/结构，同步维护 `palette-consistency.test.ts`/`tokens-generation.test.ts`/基元截图，不得留红或空洞。

---

## 9. 待明确事项（需主理人转用户）

| # | 事项 | 我的默认 | 是否需确认 |
|---|---|---|---|
| 1 | **a11y 可见变化授权**：小学·浅的 primary 文字/按钮底、muted、warning 文字需加深才达 AA（§6.3 四处）。**是否接受这 4 处可见变化**（换取 AA）？ | 接受（否则 AA 不成立） | **需确认**（这是唯一"必须可见变化"处，用户此前只授权"深色语义色微调"，未明确浅色） |
| 2 | 生成物**入库**（commit） | 入库 + 三重防漂移 | 已按用户倾向（可确认） |
| 3 | 是否加 `.gitattributes`（`eol=lf`）防行尾漂移 | 建议加 | 低风险，可确认 |
| 4 | `PRESETS` 常量与 v1.1 `presetInference` 的 `ThemePreset` 是否合并到 `tokens.ts` 单点 | 合并（单一源） | 建议确认 |
| 5 | 展示页路由 `/design-system` 仅 DEV | 仅 DEV（生产剔除） | 否 |
| 6 | `Review.vue` 的 `.action-pill` 是否抽为 AppButton 变体 | **本批先保留**，批 3 评估 | 否 |

---

## 10. 与路线图/用户决策的张力（如实上报）

1. **"视觉零变化" vs "WCAG AA"**：小学学段浅色下，brand 橙作**正文/按钮底**在数学上**不可能同时**既保持 `#f2760c` 又达 4.5:1。故**必有一处可见变化**（§6.3 四处）。这是硬约束冲突，**不可两全**；已给出"最小变化"方案（只加深小学浅色的文本/按钮用色，其余 5 组合零变化）。
2. **三层 token 的第 3 层"是否必要"**：现有 `semantic` 已覆盖 90% 需求；component 层收益主要在"统一 8 基元 + naive 一致性"。若追求极简可只做两层——**但用户已拍板三层，按三层交付**，并把 component 层控制在"轻量别名"（不引入第三套真值，避免第 4 个真相源）。
3. **路线图的"高对比/护眼"**：用户裁定**不做**（否则 6→12 组）。若未来要做，`tokens.ts` 的 `MODES` 需扩为含 `high-contrast`/`eye-care`——**当前设计已预留**（`buildSemantic(preset, mode)` 的 `mode` 参数化），故不影响本轮且未来可扩展。
4. **组件文档用 Markdown 而非 Storybook**：牺牲"交互式 playground"，但**零新增依赖 + 复用既有 Playwright**，与沙箱约束一致；成本是"文档更新需手动跑截图"。

---

*本文件由架构师高见远产出，仅含设计与任务清单，不含实现代码。*
