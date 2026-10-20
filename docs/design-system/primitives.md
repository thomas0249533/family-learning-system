# UI 基元

> 源码：`src/components/ui/`（8 个文件，**本文标题集合与目录文件名由测试双向锁定**）
> 展示页：`src/views/DesignSystem.vue`（`/design-system`，仅 DEV）
> token 定义见 [`tokens.md`](./tokens.md)；对比度实测见 [`a11y.md`](./a11y.md)

本文内容全部从 `.vue` 源码读出，不是设计稿复述。设计书 `docs/system_design-v1.2.md` §4 与本文件
冲突时，**以源码为准**（已知 3 处偏差在文末 §9 登记）。

---

## 0. 全体共用约定

1. **零硬编码色**：基元 `<style>` 只出现 `var(--x)`。`npm run check:hex` 会扫 `src/components`。
2. **焦点环统一写法**（三个值都走 token）：
   ```scss
   &:focus-visible {
     outline: var(--focus-ring-w) solid var(--focus-ring);
     outline-offset: var(--focus-ring-offset);
   }
   ```
   例外：`AppButton` 用 `--btn-focus-ring`（按钮专用环，语义上区分主按钮）。
3. **动效降级**：每个带 `transition`/`transform` 的基元都有
   `@media (prefers-reduced-motion: reduce)` 分支，把 `transition` 置 `none`
   （`hover` 抬升同时把 `transform` 置 `none`）。
4. **attrs 透传**：所有基元都是**单根节点**，未声明的 attrs 自动落到根元素。
   一旦某个事件被 `defineEmits` 声明（如 `AppButton` 的 `click`），它就不再作为原生监听透传，
   而是由组件显式 `emit`——两者不会重复触发。
5. **图标**：`icon` prop 接受 emoji / 字符，统一渲染在 `aria-hidden="true"` 的 span 里。
   图标**只做冗余**，语义必须同时由文字承载（§6.5 色盲要求）。
6. **色觉冗余内建**：`AppBadge`、`StatCard` 提供 `icon` slot；`icon` prop 优先于 slot。

---

## AppButton

**定位**：全站按钮唯一入口。**关系**：包 `n-button`，键盘、焦点、`disabled`/`loading` 语义全部继承 naive。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `type` | `'default' \| 'primary' \| 'info' \| 'success' \| 'warning' \| 'error'` | `'default'` | 注意是 naive 词表：**`error` 不叫 `danger`** |
| `size` | `'tiny' \| 'small' \| 'medium' \| 'large'` | `'medium'` | |
| `block` | `boolean` | `false` | 撑满容器宽 |
| `ghost` | `boolean` | `false` | 幽灵按钮（透明底 + 描边） |
| `dashed` | `boolean` | `false` | 虚线描边 |
| `quaternary` | `boolean` | `false` | 无底无边，仅文字 |
| `loading` | `boolean` | `false` | naive 自带 loading 图标与禁用态 |
| `disabled` | `boolean` | `false` | |
| `icon` | `string` | — | 前置图标（emoji/字符）；与 `icon` slot 二选一，**prop 优先** |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `default` | 按钮文字 |
| `icon` | 自定义图标节点（`icon` prop 为空时才生效） |
| `click`（event） | 参数 `MouseEvent`；显式 `emit`，不重复透传 |

### 消费的 token

| token | 用途 |
|---|---|
| `--radius-control` | 圆角（10px，与输入框统一） |
| `--btn-focus-ring` | 焦点环颜色 |
| `--focus-ring-w` / `--focus-ring-offset` | 焦点环宽 / 偏移 |

主按钮的**实际**前景/底色不来自本文件的 CSS，而来自 `palette.ts` 的 `buildThemeOverrides`：
`Button.colorPrimary = --primary-text`（比品牌色更深，保证白字达标）、`textColorPrimary = --text-on-primary`。
6 组实测见 [`a11y.md`](./a11y.md#主按钮实测浏览器-computed非推导)。

### a11y

- 键盘 / 焦点 / `aria-disabled` 由 `n-button` 提供，本组件只补 `:focus-visible` 样式；
- `loading` 时 naive 会阻止点击，但**不会**自动播报，需要文案提示时在调用处补 `aria-busy`；
- 动效降级：`prefers-reduced-motion` 下 `transition: none`。

### 示例

```vue
<AppButton type="primary" icon="＋" @click="addUnit">新增单元</AppButton>
<AppButton quaternary size="small" :loading="saving">保存中</AppButton>
<AppButton type="error" ghost>删除</AppButton>
```

### 坑（源码约定）

- `--btn-primary-bg`、`--btn-primary-bg-hover`、`--btn-primary-fg` 这三个"预留别名"**已于 2026-10
  V1.2 终验后从 `COMPONENT_TOKENS` / `components.scss` 删除**：它们全仓零 `var()` 消费者，
  且 `--btn-primary-bg` 编码的是 AA 不达标色（`#f2760c` 配白字 2.85:1），留着等于给后来人指坑。
  改主按钮色请改 `tokens.ts` 的 `brand/brandText`（经 `palette.ts` 的 `Button.colorPrimary`
  落到 `--primary-text`），**不要**自己新起一个按钮别名去接 `--primary-color`。
- `type` 用 `error`，而 token 侧叫 `danger`。写 `type="danger"` 会被类型拒绝（不属于该联合类型），
  运行时则会落到 naive 的未知值分支——两套词表的交界就在这一行。

---

## AppCard

**定位**：内容卡片。**关系**：包 `n-card`（标题栏 / 动作区透传）。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 标题；有 `title` 或 `icon` 时渲染内置标题栏 |
| `icon` | `string` | — | 标题前图标（`aria-hidden`） |
| `variant` | `'default' \| 'danger'` | `'default'` | `danger` 只改**边框色**为 `--danger-light` |
| `paddingless` | `boolean` | `false` | 去掉内容区内边距（表格/列表卡片用） |
| `hoverable` | `boolean` | `false` | hover 抬升 2px + 阴影 `sm → md` |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `header` | 完全替换内置标题栏（含 `icon`+`title` 那套） |
| `header-extra` | 标题栏右侧动作区 |
| `default` | 卡片内容 |

无 events。

### 消费的 token

| token | 用途 |
|---|---|
| `--radius-lg` | 圆角 16px |
| `--shadow-sm` / `--shadow-md` | 静止 / hover 阴影 |
| `--duration-base` / `--ease-standard` | 过渡 |
| `--danger-light` | `variant="danger"` 的边框色 |
| `--focus-ring` / `--focus-ring-w` / `--focus-ring-offset` | `hoverable` 的焦点环 |

### a11y

- 根标签是 `div`（naive `n-card` 的 `tag` prop 默认 `'div'`），**没有地标语义**；标题层级仍应由页面用
  `PageHeader` / `SectionTitle` 决定。需要 `<section>` 语义时可传 `tag="section"`（`tag` 未在 AppCard
  声明，但作为 attrs 透传给 `n-card`）；
- **`hoverable` 的卡片默认不可聚焦**（根元素没有 `tabindex`）。`:focus-visible` 规则挂在卡片自身，
  只在卡片内部子元素聚焦时不会命中——需要键盘可达时，请在调用处包一层 `<a>`/`<button>`
  或显式传 `tabindex="0"`；
- 动效降级：`prefers-reduced-motion` 下关过渡并取消 `translateY`。

### 示例

```vue
<AppCard title="本周概览" icon="📅" hoverable>
  <template #header-extra><AppButton quaternary size="tiny">详情</AppButton></template>
  <StatCard label="练习时长" value="128" />
</AppCard>

<AppCard variant="danger" paddingless>
  <MistakeTable :rows="rows" />
</AppCard>
```

### 坑（源码约定）

- **刻意不覆盖边框与标题栏底色**。源码注释写明：现有各页 `n-card` 用的是 naive 默认
  （边框 = `--border-color`，标题栏无底色），强行套 `--border-light` / 标题栏底色
  会让每一张被替换的卡片产生非预期可见变化。
- 因此原先那个"卡片标题栏底"别名（`--card-header-bg`）**从未被启用，已于 2026-10 终验后删除**。
- `paddingless` 通过 `:deep(.n-card__content)` 置 `padding: 0`，依赖 naive 的内部类名。

---

## AppBadge

**定位**：计数 / 状态标签（软色 pill）。**关系**：自建 `span`（不包 naive）。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `tone` | `'neutral' \| 'primary' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'neutral'` | |
| `soft` | `boolean` | `true` | `true` 软色底；`false` 实心态 |
| `size` | `'sm' \| 'md'` | `'md'` | |
| `closable` | `boolean` | `false` | 显示 ✕，点击 `emit('close')` |
| `icon` | `string` | — | 前置语义图标；与 `icon` slot 二选一，**prop 优先** |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `default` | 标签文字 |
| `icon` | 自定义图标（`icon` prop 为空时生效） |
| `close`（event） | 无参数；仅在 `closable` 时可触发 |

### 消费的 token

| token | 用途 |
|---|---|
| `--badge-{neutral,primary,success,warning,danger,info}-bg` | 软色底（= 对应 `-light`） |
| `--{tone}-text` | 软底上的文字（`neutral` 用 `--text-sub`） |
| `--text-on-primary` | 实心态文字（深浅自适应） |
| `--{tone}-text` | 实心态**背景**（用 AA 深色变体当底色） |
| `--space-1` / `--space-2` / `--space-3` | 内边距与间隙 |
| `--radius-full` | 胶囊圆角 |
| `--font-2xs` / `--font-xs` | 字号（sm 用 2xs，md 用 xs） |
| `--duration-fast` / `--ease-standard` | ✕ 按钮透明度过渡 |
| `--focus-ring` / `--focus-ring-w` / `--focus-ring-offset` | ✕ 按钮焦点环 |

### a11y

- 语义**不得只靠颜色**：`warning`/`danger` 等必须叠 `icon`（或文字本身已说明），这是 §6.5 色盲冗余；
- ✕ 按钮是真正的 `<button type="button">`，带 `aria-label="移除"`；`✕` 字形本身 `aria-hidden`；
- 只有 ✕ 可聚焦，pill 本体不可聚焦（这是有意的：徽章通常非交互）。

### 示例

```vue
<AppBadge tone="success" icon="✓">已掌握</AppBadge>
<AppBadge tone="warning" icon="!">待复习 3</AppBadge>
<AppBadge tone="primary" soft="false">P0</AppBadge>
<AppBadge tone="neutral" closable @close="remove">筛选：错题</AppBadge>
```

### 坑（源码约定）

- **文字色一律 `-text`，不是 `-color`**。这是批 6a-2 的修正；设计书 §4 里"`var(--{tone}-color)` 字"
  的写法已过时，照它写会过不了 `npm run check:text-color`（且对比度不足）。
- 实心态的底用的是 `-text`（更深的 AA 变体），不是 `-color`；`neutral` 实心态的底是 `--text-sub`。
- `soft` 传 `false` 时 `+ .app-badge--solid` 类，样式表里用双类选择器覆盖，单独一个 `--solid` 不生效。

---

## EmptyState

**定位**：空列表占位 + 可选单一主行动。**关系**：包 `n-empty`。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `description` | `string` | — | 说明文字 |
| `icon` | `string` | — | 大图标（emoji/字符），`aria-hidden` |
| `actionText` | `string` | — | 有值时渲染默认动作按钮（`AppButton type="primary" size="small"`） |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | 只影响描述文字字号 |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `default` | **落在图标区**（作为 `icon` prop 的 fallback），不是内容区 |
| `action` | 完全替换默认动作按钮 |
| `action`（event） | 点击默认动作按钮时触发；用 `action` slot 时不会触发 |

### 消费的 token

| token | 用途 |
|---|---|
| `--empty-icon-fg` | 大图标颜色 |
| `--text-sub` | 描述文字 |
| `--font-4xl` | 图标字号 |
| `--font-xs` / `--font-md` | 描述文字（small / large） |
| `--space-4` | 容器上下内边距 |

### a11y

- 图标 `aria-hidden="true"`，语义由 `description` 承载——**`description` 应写清"为什么空 + 下一步"**，
  只写"暂无数据"对读屏用户没有信息量；
- 默认动作是真实按钮（`AppButton`），键盘可达。

### 示例

```vue
<EmptyState
  icon="📚"
  description="还没有错题，去练习页做几道吧"
  action-text="去练习"
  @action="router.push('/learn')"
/>

<EmptyState icon="🔍" description="没有匹配的题目">
  <template #action><AppButton size="small" @click="reset">清空筛选</AppButton></template>
</EmptyState>
```

### 坑（源码约定）

- `default` slot 渲染在 `<n-empty #icon>` 里面（`<slot>{{ icon }}</slot>`）。想放正文内容，
  用 `description`，**不要**用默认插槽——那里的内容会被当作图标缩放。
- `size="medium"` 会加 `empty-state--medium` 类，但**没有对应样式**（只有 small/large 调字号），
  等于默认。
- 图标区只在 `icon` prop 或 default slot 存在时渲染。

---

## PageHeader

**定位**：页面标题区。**关系**：自建 `<header>`。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | `string` | **必填** | 页面标题 |
| `subtitle` | `string` | — | 副标题（`<p>`） |
| `icon` | `string` | — | 标题前图标（`aria-hidden`） |
| `level` | `'h1' \| 'h2'` | `'h1'` | 决定语义标签，保证文档大纲正确 |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `breadcrumb` | 标题上方面包屑（小号灰字） |
| `actions` | 标题右侧动作区（`margin-left: auto`） |

无 events。

### 消费的 token

| token | 用途 |
|---|---|
| `--text-main` | 标题 |
| `--text-sub` | 副标题 |
| `--text-muted` | 面包屑 |
| `--page-header-border` | 底边 |
| `--font-3xl` / `--font-sm` / `--font-xs` | 标题 / 副标题 / 面包屑字号 |
| `--space-2` / `--space-3` / `--space-4` | 间距与下内边距 |

### a11y

- 语义标签随 `level` 变（`h1`/`h2`），**一个页面只应有一个 `h1`**；
- 图标 `aria-hidden`，标题文字是唯一语义来源；
- 标题 22px + 字重 800，属 WCAG「大号文本」（阈值 3.0 而非 4.5）。

### 示例

```vue
<PageHeader title="错题本" subtitle="按知识点归档，支持重练" icon="📕" level="h1">
  <template #breadcrumb>首页 / 学习</template>
  <template #actions>
    <AppButton size="small" icon="↻" @click="reload">刷新</AppButton>
  </template>
</PageHeader>
```

### 坑（源码约定）

- `title` 必填，类型层面不给默认值——空标题会导致页面失去 `h1`；
- 底边是 `1px solid var(--page-header-border)`，不要在调用处再叠 `border-bottom`。

---

## ProgressBar

**定位**：掌握度 / 完成度条。**关系**：自建 `div`，`role="progressbar"`。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `value` | `number` | **必填** | 当前值；会被 clamp 到 `[0, max]` |
| `max` | `number` | `100` | `max <= 0` 时按 0 处理（pct 恒为 0） |
| `tone` | `'primary' \| 'success' \| 'warning' \| 'danger'` | `'primary'` | 填充色 |
| `size` | `'sm' \| 'md'` | `'md'` | 6px / 10px 高 |
| `gradient` | `boolean` | `false` | 用主色渐变填充（`--progress-fill-bg`） |
| `showLabel` | `boolean` | `false` | 右侧显示整数百分比 |

### Slots / Events

无 slots、无 events。

### 计算规则（源码）

```
clamped = max <= 0 ? 0 : Math.max(0, Math.min(value, max))
pct     = max <= 0 || clamped === 0 ? 0 : Math.round(clamped / max * 100)
```

即：**百分比是四舍五入整数**，`aria-valuenow` 用的是 `clamped`（原始量纲），不是百分比。

### 消费的 token

| token | 用途 |
|---|---|
| `--progress-track-bg` | 轨道底（= `--surface-2`） |
| `--primary-color` | 默认填充（图形色，合法） |
| `--success-color` / `--warning-color` / `--danger-color` | tone 填充 |
| `--progress-fill-bg` | `gradient` 填充 |
| `--radius-full` | 轨道与填充圆角 |
| `--duration-slow` / `--ease-decelerate` | 宽度过渡 |
| `--font-xs` / `--text-sub` | 右侧百分比 |
| `--space-2` | 条与标签间隙 |

### a11y

- `role="progressbar"` + `aria-valuenow` / `aria-valuemin="0"` / `aria-valuemax="max"`；
- **没有内建可访问名称**，且未声明的 attrs 落在**外层** `.progress-wrap` 上，而 `role="progressbar"`
  在**内层** `.progress` 上 → 直接写 `<ProgressBar aria-label="数学掌握度" />` 名称不会挂到进度条元素。
  需要读屏可读时，请用可见文字标签包一层 + `aria-labelledby` 指向它；
- 非交互元素，**不需要**焦点环（这是刻意的，不是遗漏）；
- 动效降级：`prefers-reduced-motion` 下取消宽度过渡。

### 示例

```vue
<ProgressBar :value="mastery" tone="success" show-label />
<ProgressBar :value="done" :max="total" size="sm" gradient />
```

### 坑（源码约定）

- 轨道高度 `6px` / `10px` 是常量尺寸（字号/间距阶梯里没有对应 token），不算硬编码色；
- `showLabel` 显示的是**四舍五入后的整数**，与 `aria-valuenow` 的量纲不同（后者是 `clamped`），
  自定义文案时别把两者混用。

---

## SectionTitle

**定位**：小节标题。**关系**：自建（语义标签随 `level`）。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | `string` | **必填** | 标题文字 |
| `icon` | `string` | — | 标题前图标（`aria-hidden`） |
| `count` | `string \| number` | — | 计数 pill；与 `count` slot 二选一 |
| `level` | `'h2' \| 'h3'` | `'h2'` | 语义标签 |
| `accent` | `boolean` | `false` | 左侧 4px 主色竖条（Report 风格） |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `count` | 自定义计数内容（优先于 `count` prop） |
| `default` | 右侧附加区（`margin-left: auto`），**不是正文** |

无 events。

### 消费的 token

| token | 用途 |
|---|---|
| `--text-main` | 标题文字 |
| `--primary-color` | `accent` 左竖条（图形色，合法） |
| `--badge-neutral-bg` | 计数 pill 底（复用徽章中性底，不另立 token） |
| `--text-sub` | 计数 pill 文字 |
| `--radius-full` | pill 圆角 |
| `--font-lg` / `--font-xl` / `--font-2xs` | 标题 / 图标 / 计数字号 |
| `--space-2` / `--space-3` | 间隙与 `accent` 左内边距 |

### a11y

- `level` 决定 `h2`/`h3`，**不要跳级**（`h1` 在 `PageHeader`，小节用 `h2`，子节用 `h3`）；
- 计数 pill 是纯展示信息，读屏会连着标题一起读，顺序为「标题 → 计数」。

### 示例

```vue
<SectionTitle title="最近错题" icon="📕" :count="mistakes.length" level="h2" accent>
  <AppButton quaternary size="tiny">全部 →</AppButton>
</SectionTitle>
```

### 坑（源码约定）

- 默认插槽落在 `.section-title__extra`（`margin-left: auto`），塞正文会被挤到最右侧；
- 计数 pill 直接借用 `--badge-neutral-bg`，所以它和 `AppBadge tone="neutral"` 视觉一致是**设计意图**，
  不是巧合；想改计数样式请改徽章中性 token，别在 `SectionTitle` 里另写色。

---

## StatCard

**定位**：统计数字卡。**关系**：自建 `div`。

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string` | **必填** | 指标名 |
| `value` | `string \| number` | — | 数值；可被 `default` slot 覆盖 |
| `icon` | `string` | — | 图标（emoji/字符）；与 `icon` slot 二选一，**prop 优先** |
| `tone` | `'neutral' \| 'primary' \| 'success' \| 'warning' \| 'danger'` | `'neutral'` | **只染数值颜色**，不染底/边框 |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | 竖排居中 / 横排左对齐 |
| `interactive` | `boolean` | `false` | hover 抬升 + `role="button"` + `tabindex="0"` |

### Slots / Events

| 名称 | 说明 |
|---|---|
| `default` | 覆盖 `value`（可放 `<AppBadge>` 等富内容） |
| `icon` | 自定义图标（`icon` prop 为空时生效） |
| `footer` | 数值下方补充行（小号 `--text-muted`） |

**无 events**（见下方"坑"，这是已知缺口）。

### 消费的 token

| token | 用途 |
|---|---|
| `--card-bg` / `--border-color` / `--shadow-sm` | 容器 |
| `--shadow-md` | `interactive` hover |
| `--radius-md` | 圆角 12px |
| `--stat-value-fg` | 默认数值色（= `--text-main`） |
| `--{tone}-text` | tone 数值色（`primary/success/warning/danger`） |
| `--text-sub` / `--text-muted` | label / footer |
| `--font-3xl` / `--font-xs` | 图标 / label |
| `--space-2` / `--space-3` / `--space-4` | 间距与内边距 |
| `--duration-base` / `--ease-standard` | hover 过渡 |
| `--focus-ring` / `--focus-ring-w` / `--focus-ring-offset` | `interactive` 焦点环 |

### a11y

- `icon` 为 `aria-hidden`，语义靠 `label` 承载；
- 色觉冗余：`tone` 只是**强化**，指标含义必须由 `label` 文字 + `icon` 表达（不能"红色=差"单信号）；
- 数值 26px + 字重 800 → 属「大号文本」（阈值 3.0）；
- 动效降级：`prefers-reduced-motion` 下关过渡、取消 `translateY`。

### 示例

```vue
<StatCard label="本周练习" value="128" icon="✍️" tone="primary" />

<StatCard label="正确率" tone="success" icon="✓" layout="horizontal">
  92<small>%</small>
  <template #footer>较上周 +4%</template>
</StatCard>
```

### 坑（源码约定）

- **`interactive` 只做了一半**：设了 `role="button"` + `tabindex="0"` + 焦点环，但组件
  **没有 `click` emit，也没有 Enter/Space 键处理**。`@click` 能通过 attrs 透传到根 `div` 而工作，
  **键盘激活不能**。真需要可点击卡片时，请在调用处包真实的 `<button>`/`<a>`，
  或先补 `@keydown.enter` / `@keydown.space` 再标 `interactive`。
- 数值字号 `26px` 是**文档化例外**：字号阶梯里没有 26px，源码按「常量尺寸」保留精确值以复刻
  Parent `.ov-value` / Report `.stat-value` 的既有观感。不要"顺手"换成 `--font-4xl`（24px）。
- `tone` 不影响背景与边框；想要带色底的卡片请用 `AppCard variant="danger"` 或自行组合。

---

## 9. 设计书 ⇄ 源码的已知偏差

写文档时逐文件对照发现 3 处 `docs/system_design-v1.2.md` §4 已过时，**以源码为准**：

| # | 设计书说法 | 源码实际 |
|---|---|---|
| 1 | AppBadge 软底文字用 `var(--{tone}-color)` | 用 `var(--{tone}-text)`（批 6a-2 修正；`-color` 会过不了 `check:text-color` 且对比度不足） |
| 2 | AppCard 用 `$radius-lg + $shadow-sm + var(--card-header-bg)`，`danger` 用 `$danger-light` 边框 | 前两项一致；`--card-header-bg` **未使用**（且刻意不覆盖 naive 默认边框/标题栏底色），`danger` 用的确实是 `--danger-light` |
| 3 | "所有可交互基元（AppButton/AppCard(hoverable)/AppBadge(closable)/ProgressBar(无)）内建焦点环" | 一致；但 `AppCard(hoverable)` 根元素默认不可聚焦（无 `tabindex`），焦点环实际只在内部子元素聚焦时命中自身——见 AppCard 的 a11y 段 |
