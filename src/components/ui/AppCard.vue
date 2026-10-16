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
// 关系：包 `n-card`（§4）。样式：$radius-lg + $shadow-sm +
// --card-header-bg；variant=danger 用 danger-light 作边框。全走 token。
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
/* 复刻现有观感的「最主流的那一套」：radius-lg + shadow-sm。
   刻意 **不** 覆盖 border 与 header 背景 —— 现有各页的 n-card 用的是 naive 默认
   （边框 = --border-color，标题栏无底色）；强行上 --border-light / --card-header-bg
   会让每一张被替换的卡片产生非预期可见变化（批3/批4 铁律：差异只应出现在
   「原本各页就不一致」的地方）。 */
.app-card {
  border-radius: var(--radius-lg);
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

.app-card--danger {
  border-color: var(--danger-light);
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
