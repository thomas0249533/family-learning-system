<template>
  <n-button
    class="app-button"
    :class="{ 'app-button--3d': isSolid }"
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
// buildThemeOverrides 统一驱动；本组件只补圆角、焦点环与 3D 厚度，全部走 token。
//
// V2.11 · 「积木」3D 物理感（多邻国风）
//   只在**有实体底色**的按钮上生效（primary / success / default 等）。
//   ghost / dashed / quaternary / text / tertiary 这些"无面"变体不加厚度——
//   给一张"空气"画厚度会立刻穿帮。
//
//   厚度用 `box-shadow: 0 4px 0`（--shadow-3d）而不是 border：border 会参与
//   盒模型、把内边距吃掉，且按下时无法"消失"；阴影可以一键归零。
//   **按压位移必须与阴影 y 偏移严格相等（都是 4px）**，否则按下去会「穿模」：
//   位移小于厚度 → 按钮悬在阴影里；大于厚度 → 按钮掉到阴影下方。
//   改 --shadow-3d 的 y 偏移时，务必同步改下面的 translateY。
// =====================================================================
import { computed, useAttrs } from 'vue'
import { NButton } from 'naive-ui'
import { playClickFeedback } from '@core/feedback'

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

const props = withDefaults(defineProps<AppButtonProps>(), {
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

// `text` / `tertiary` 不在 props 里（由 attrs 透传给 n-button），
// 只能从 attrs 判断——它们是"无面"变体，不能加积木厚度。
const attrs = useAttrs()
const isSolid = computed(() => {
  const a = attrs as Record<string, unknown>
  const hasText = a.text !== undefined && a.text !== false && a.text !== ''
  const hasTertiary = a.tertiary !== undefined && a.tertiary !== false
  return !props.ghost && !props.quaternary && !props.dashed && !hasText && !hasTertiary
})

function onClick(ev: MouseEvent): void {
  // 触感确认（设置里可关）。disabled / loading 时 naive 不会派发 click，
  // 所以这里不需要再判一次。
  playClickFeedback()
  emit('click', ev)
}
</script>

<style scoped lang="scss">
.app-button {
  border-radius: var(--radius-control);
  font-weight: 700;
}

/* ---------- V2.11 · 积木厚度 ---------- */

.app-button--3d {
  /* naive 的 1px 实线边框会把"厚度"读成两层，且按下时无法消失 */
  border: 0;
  box-shadow: var(--shadow-3d);
  transition:
    transform var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  /* 物理按压：位移 4px == --shadow-3d 的 y 偏移 */
  &:not(:disabled):active {
    transform: translateY(4px);
    box-shadow: none;
  }
}

/* 不可按：没有厚度，视觉上就"不该被按下去" */
.app-button--3d:disabled,
.app-button--3d[disabled] {
  box-shadow: none;
  transform: none;
}

.app-button__icon {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

/* 焦点可见（§6.4，AA）—— 3D 按钮的焦点环要向外描，不能压在阴影上 */
.app-button:focus-visible {
  outline: var(--focus-ring-w) solid var(--btn-focus-ring);
  outline-offset: var(--focus-ring-offset);
}

/* 尊重 prefers-reduced-motion（§6.6）：位移取消，但保留阴影与"按下即无阴影"的
   静态对比——反馈仍在，只是不"动"。 */
@media (prefers-reduced-motion: reduce) {
  .app-button {
    transition: none;
  }
  .app-button--3d:not(:disabled):active {
    transform: none;
  }
}
</style>
