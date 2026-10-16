<template>
  <n-empty
    class="empty-state"
    :class="`empty-state--${size}`"
    :description="description"
  >
    <template v-if="icon || $slots.default" #icon>
      <span class="empty-state__icon" aria-hidden="true">
        <slot>{{ icon }}</slot>
      </span>
    </template>
    <template v-if="actionText || $slots.action" #extra>
      <slot name="action">
        <AppButton type="primary" size="small" @click="onAction">{{ actionText }}</AppButton>
      </slot>
    </template>
  </n-empty>
</template>

<script setup lang="ts">
// =====================================================================
// EmptyState · 包 naive `n-empty` + token 容器 + 可选动作
// ---------------------------------------------------------------------
// 关系：包 `n-empty`（§4）。图标色 `--empty-icon-fg`、描述色 `--text-sub`。
// 默认动作用 AppButton，全 token。零硬编码色。
// =====================================================================
import { NEmpty } from 'naive-ui'
import AppButton from './AppButton.vue'

interface EmptyStateProps {
  description?: string
  icon?: string
  actionText?: string
  size?: 'small' | 'medium' | 'large'
}

withDefaults(defineProps<EmptyStateProps>(), {
  description: undefined,
  icon: undefined,
  actionText: undefined,
  size: 'medium',
})

const emit = defineEmits<{ (e: 'action'): void }>()

function onAction(): void {
  emit('action')
}
</script>

<style scoped lang="scss">
.empty-state {
  padding: var(--space-4) 0;
}

.empty-state__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-4xl);
  line-height: 1;
  color: var(--empty-icon-fg);
}

.empty-state :deep(.n-empty__description) {
  color: var(--text-sub);
}

.empty-state--small :deep(.n-empty__description) {
  font-size: var(--font-xs);
}

.empty-state--large :deep(.n-empty__description) {
  font-size: var(--font-md);
}
</style>
