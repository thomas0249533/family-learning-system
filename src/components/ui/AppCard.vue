<template>
  <n-card
    class="app-card"
    :class="[
      `app-card--${variant}`,
      { 'app-card--hoverable': hoverable, 'app-card--paddingless': paddingless },
    ]"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    <template v-else-if="title || icon" #header>
      <div class="app-card__header">
        <span v-if="icon" class="app-card__icon" aria-hidden="true">{{ icon }}</span>
        <span class="app-card__title">{{ title }}</span>
      </div>
    </template>
    <template v-if="$slots['header-extra']" #header-extra>
      <slot name="header-extra" />
    </template>
    <slot />
  </n-card>
</template>

<script setup lang="ts">
// =====================================================================
// AppCard · 包 naive `n-card`（标题栏 / 动作区透传）
// ---------------------------------------------------------------------
// 关系：包 `n-card`（§4）。样式：$radius-lg + $shadow-sm；
// variant=danger 用 danger-light 作边框。全走 token。
// =====================================================================
import { NCard } from 'naive-ui'

interface AppCardProps {
  title?: string
  icon?: string
  variant?: 'default' | 'danger'
  /** 去掉内容区内边距（表格/列表卡片用） */
  paddingless?: boolean
  /** hover 抬升（可交互卡片） */
  hoverable?: boolean
}

withDefaults(defineProps<AppCardProps>(), {
  title: undefined,
  icon: undefined,
  variant: 'default',
  paddingless: false,
  hoverable: false,
})
</script>

<style scoped lang="scss">
/* V2.11 · 多邻国风：去掉实线边框，改为「大圆角 + 柔和投影」把卡片"托"起来。
   为什么 border 必须去掉：3D 语汇里「厚度」只能由阴影表达，一旦同时存在 1px
   实线，同一个边就出现了两种材质，看着像贴了一层贴纸。
   圆角取 --radius-2xl（24px）：16px 在整页尺度上仍偏"办公软件"，24px 才有
   玩具积木的圆润感。 */
.app-card {
  border: 0;
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration-base) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);
}

.app-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.app-card__icon {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

/* danger 变体：边框没了，但"危险"的语义必须保留 → 改用 inset 描边，
   与外投影叠加（inset 画内描边不参与盒模型，不会像 border 那样撑开尺寸）。 */
.app-card--danger {
  box-shadow: inset 0 0 0 2px var(--danger-light), var(--shadow-sm);
}

.app-card--paddingless :deep(.n-card__content) {
  padding: 0;
}

.app-card--hoverable:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* 焦点可见（§6.4，AA） */
.app-card--hoverable:focus-visible {
  outline: var(--focus-ring-w) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}

/* 尊重 prefers-reduced-motion（§6.6） */
@media (prefers-reduced-motion: reduce) {
  .app-card {
    transition: none;
  }
  .app-card--hoverable:hover {
    transform: none;
  }
}
</style>
