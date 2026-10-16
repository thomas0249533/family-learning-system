<template>
  <n-button
    class="app-button"
    :type="type"
    :size="size"
    :block="block"
    :ghost="ghost"
    :dashed="dashed"
    :quaternary="quaternary"
    :loading="loading"
    :disabled="disabled"
    @click="onClick"
  >
    <template v-if="icon" #icon>
      <span class="app-button__icon">{{ icon }}</span>
    </template>
    <template v-else-if="$slots.icon" #icon>
      <slot name="icon" />
    </template>
    <slot />
  </n-button>
</template>

<script setup lang="ts">
// =====================================================================
// AppButton · 包 naive `n-button`（继承键盘/焦点/a11y），行为透传
// ---------------------------------------------------------------------
// 关系：包 `n-button`（§4）。事件 `click` 透传；其余 attrs 由 Vue 自动
// 透传到根 n-button（行为兼容优先）。颜色由 ThemeProvider 的
// buildThemeOverrides 统一驱动；本组件只补圆角与焦点环，全部走 token。
// =====================================================================
import { NButton } from 'naive-ui'

interface AppButtonProps {
  type?: 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error'
  size?: 'tiny' | 'small' | 'medium' | 'large'
  block?: boolean
  ghost?: boolean
  dashed?: boolean
  quaternary?: boolean
  loading?: boolean
  disabled?: boolean
  /** 前置图标（emoji / 字符）；与 `icon` slot 二选一 */
  icon?: string
}

withDefaults(defineProps<AppButtonProps>(), {
  type: 'default',
  size: 'medium',
  block: false,
  ghost: false,
  dashed: false,
  quaternary: false,
  loading: false,
  disabled: false,
  icon: undefined,
})

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()

function onClick(ev: MouseEvent): void {
  emit('click', ev)
}
</script>

<style scoped lang="scss">
.app-button {
  border-radius: var(--radius-control);
  font-weight: 600;
}

.app-button__icon {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

/* 焦点可见（§6.4，AA） */
.app-button:focus-visible {
  outline: var(--focus-ring-w) solid var(--btn-focus-ring);
  outline-offset: var(--focus-ring-offset);
}

/* 尊重 prefers-reduced-motion（§6.6） */
@media (prefers-reduced-motion: reduce) {
  .app-button {
    transition: none;
  }
}
</style>
