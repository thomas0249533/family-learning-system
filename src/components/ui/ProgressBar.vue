<template>
  <div class="progress-wrap" :class="`progress-wrap--${size}`">
    <div
      v-bind="$attrs"
      class="progress"
      :class="[
        `progress--${tone}`,
        `progress--${size}`,
        { 'progress--gradient': gradient },
      ]"
      role="progressbar"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="pct"
      :aria-valuetext="valuetext"
    >
      <div class="progress__fill" :style="{ width: `${pct}%` }" />
    </div>
    <span v-if="showLabel" class="progress-wrap__label">{{ pct }}%</span>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// ProgressBar · 自建进度条（统一 `.subject-bar`；role="progressbar"）
// ---------------------------------------------------------------------
// 关系：自建（§4）。轨道 `--progress-track-bg`；填充默认主色，`gradient`
// 时用 `--progress-fill-bg`（主色渐变），tone 时取语义色。零硬编码色。
// =====================================================================
import { computed } from 'vue'

// 无障碍名称（aria-label 等）必须落在带 role="progressbar" 的内层本体上，
// 故关闭 attrs 继承、由内层 v-bind="$attrs" 接住（外层 wrap 只吃不到 attrs，
// 调用方如需定位外层请用内层 class 语义）。
defineOptions({ inheritAttrs: false })

interface ProgressBarProps {
  /** 当前值（0–100 语义，超过 max 会被裁剪） */
  value: number
  max?: number
  tone?: 'primary' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md'
  gradient?: boolean
  showLabel?: boolean
  /** 进度条的人类可读名称（aria-valuetext 前缀，如「今日进度」） */
  label?: string
}

const props = withDefaults(defineProps<ProgressBarProps>(), {
  max: 100,
  tone: 'primary',
  size: 'md',
  gradient: false,
  showLabel: false,
  label: undefined,
})

const clamped = computed(() => {
  const m = props.max <= 0 ? 0 : props.max
  return Math.max(0, Math.min(props.value, m))
})

const pct = computed(() => {
  const m = props.max <= 0 ? 0 : props.max
  if (m === 0) return 0
  return Math.round((clamped.value / m) * 100)
})

// 读屏朗读文案：label 时「今日进度 60%」；非百分比量纲（max≠100）时给
// 「原始值 / 目标值」，比一个裸数字更有信息量。
const valuetext = computed(() => {
  const display =
    props.max === 100 ? `${pct.value}%` : `${clamped.value} / ${props.max}`
  return props.label ? `${props.label} ${display}` : display
})
</script>

<style scoped lang="scss">
.progress-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.progress {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--progress-track-bg);
}

.progress--sm {
  height: 6px;
}

.progress--md {
  height: 10px;
}

.progress__fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--primary-color);
  transition: width var(--duration-slow) var(--ease-decelerate);
}

.progress--gradient .progress__fill {
  background: var(--progress-fill-bg);
}

.progress--success .progress__fill {
  background: var(--success-color);
}

.progress--warning .progress__fill {
  background: var(--warning-color);
}

.progress--danger .progress__fill {
  background: var(--danger-color);
}

.progress-wrap__label {
  flex: none;
  min-width: 3ch;
  text-align: right;
  font-size: var(--font-xs);
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
}

/* 尊重 prefers-reduced-motion（§6.6） */
@media (prefers-reduced-motion: reduce) {
  .progress__fill {
    transition: none;
  }
}
</style>
