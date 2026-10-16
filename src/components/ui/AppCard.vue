<template>
  <n-card
    class="app-card"
    :class="[
      `app-card--${variant}`,
      { 'app-card--hoverable': hoverable, 'app-card--paddingless': paddingless },
    ]"
  >
    <template v-if="title || icon || $slots.header" #header>
      <div class="app-card__header">
        <span v-if="icon" class="app-card__icon">{{ icon }}</span>
        <slot name="header">{{ title }}</slot>
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
.app-card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  background: var(--card-bg);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration-base) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);
}

.app-card:deep(.n-card-header),
.app-card :deep(.n-card-header) {
  background: var(--card-header-bg);
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
