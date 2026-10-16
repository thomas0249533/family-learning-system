<template>
  <span
    class="app-badge"
    :class="[
      `app-badge--${tone}`,
      `app-badge--${size}`,
      { 'app-badge--solid': !soft, 'app-badge--closable': closable },
    ]"
  >
    <span v-if="icon" class="app-badge__icon" aria-hidden="true">{{ icon }}</span>
    <span v-else-if="$slots.icon" class="app-badge__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="app-badge__label"><slot /></span>
    <button
      v-if="closable"
      type="button"
      class="app-badge__close"
      aria-label="移除"
      @click="onClose"
    >
      <span aria-hidden="true">✕</span>
    </button>
  </span>
</template>

<script setup lang="ts">
// =====================================================================
// AppBadge · 自建 span（软色 pill）—— 计数 / 状态标签
// ---------------------------------------------------------------------
// 关系：自建（§4）。tone → 软底（`--badge-{tone}-bg`）+ 语义色字；
// 实心态用语义色底 + `--on-strong` 字。零硬编码色，全 token。
// 色盲友好（§6.5）：语义**不得仅靠颜色** → 内建 `icon` slot 供叠图标。
// =====================================================================
interface AppBadgeProps {
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
  /** 软色底（默认）；false = 实心态 */
  soft?: boolean
  size?: 'sm' | 'md'
  closable?: boolean
  /** 前置语义图标（emoji / 字符）；与 `icon` slot 二选一，§6.5 色盲冗余 */
  icon?: string
}

withDefaults(defineProps<AppBadgeProps>(), {
  tone: 'neutral',
  soft: true,
  size: 'md',
  closable: false,
  icon: undefined,
})

const emit = defineEmits<{ (e: 'close'): void }>()

function onClose(): void {
  emit('close')
}
</script>

<style scoped lang="scss">
.app-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border-radius: var(--radius-full);
  font-size: var(--font-2xs);
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
  vertical-align: middle;
}

.app-badge--sm {
  padding: 0 var(--space-2);
}

.app-badge--md {
  padding: 2px var(--space-3);
  font-size: var(--font-xs);
}

.app-badge__icon {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

/* ---- 软色底（默认）---- */
.app-badge--neutral {
  background: var(--badge-neutral-bg);
  color: var(--text-sub);
}
.app-badge--primary {
  background: var(--badge-primary-bg);
  color: var(--primary-color);
}
.app-badge--success {
  background: var(--badge-success-bg);
  color: var(--success-color);
}
.app-badge--warning {
  background: var(--badge-warning-bg);
  color: var(--warning-color);
}
.app-badge--danger {
  background: var(--badge-danger-bg);
  color: var(--danger-color);
}
.app-badge--info {
  background: var(--badge-info-bg);
  color: var(--info-color);
}

/* ---- 实心态（--solid）---- */
.app-badge--solid {
  color: var(--on-strong);
}
.app-badge--solid.app-badge--neutral {
  background: var(--text-sub);
}
.app-badge--solid.app-badge--primary {
  background: var(--primary-color);
}
.app-badge--solid.app-badge--success {
  background: var(--success-color);
}
.app-badge--solid.app-badge--warning {
  background: var(--warning-color);
}
.app-badge--solid.app-badge--danger {
  background: var(--danger-color);
}
.app-badge--solid.app-badge--info {
  background: var(--info-color);
}
/* 实心态下语义色字在语义色底上不可读 → 统一白字（上面已设） */
.app-badge--solid.app-badge--primary,
.app-badge--solid.app-badge--success,
.app-badge--solid.app-badge--warning,
.app-badge--solid.app-badge--danger,
.app-badge--solid.app-badge--info {
  color: var(--on-strong);
}

.app-badge__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: var(--space-1);
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: inherit;
  font-size: var(--font-2xs);
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.app-badge__close:hover {
  opacity: 1;
}

/* 焦点可见（§6.4，AA） */
.app-badge__close:focus-visible {
  outline: var(--focus-ring-w) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}

/* 尊重 prefers-reduced-motion（§6.6） */
@media (prefers-reduced-motion: reduce) {
  .app-badge__close {
    transition: none;
  }
}
</style>
