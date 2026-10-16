<template>
  <div
    class="stat-card"
    :class="[
      `stat-card--${tone}`,
      `stat-card--${layout}`,
      { 'stat-card--interactive': interactive },
    ]"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
  >
    <span v-if="icon" class="stat-card__icon" aria-hidden="true">{{ icon }}</span>
    <span v-else-if="$slots.icon" class="stat-card__icon" aria-hidden="true">
      <slot name="icon" />
    </span>

    <div class="stat-card__body">
      <div class="stat-card__value">
        <slot>{{ value }}</slot>
      </div>
      <div class="stat-card__label">{{ label }}</div>
    </div>

    <div v-if="$slots.footer" class="stat-card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// StatCard · 自建统计卡（统一 `.ov-card` / `.stat-box` / `.stat-item`）
// ---------------------------------------------------------------------
// 关系：自建（§4）。容器用 `--card-bg` / `--border-color` / `--shadow-sm`；
// 数值色默认 `--stat-value-fg`，带 tone 时取语义色。零硬编码色。
// 色盲友好（§6.5）：语义不得仅靠颜色 → 内建 `icon` slot。
// =====================================================================
interface StatCardProps {
  icon?: string
  value?: string | number
  label: string
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
  layout?: 'vertical' | 'horizontal'
  /** 可交互（hover 抬升 + 可聚焦） */
  interactive?: boolean
}

withDefaults(defineProps<StatCardProps>(), {
  icon: undefined,
  value: undefined,
  tone: 'neutral',
  layout: 'vertical',
  interactive: false,
})
</script>

<style scoped lang="scss">
.stat-card {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration-base) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);
}

/* 竖向（默认）：居中排布 —— 复刻 Parent `.ov-card` / Report `.stat-box` 的既有观感 */
.stat-card--vertical {
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.stat-card--horizontal {
  flex-direction: row;
  align-items: center;
  text-align: left;
}

.stat-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-3xl);
  line-height: 1;
}

.stat-card__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat-card--horizontal .stat-card__body {
  flex: 1;
}

.stat-card__value {
  /* 26px：复刻 Parent `.ov-value` / Report `.stat-value` 的既有字号。
     字号阶梯无 26px 取值，故按 §8.4 不变量 7「常量尺寸」保留精确值。 */
  font-size: 26px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--stat-value-fg);
}

.stat-card--primary .stat-card__value {
  color: var(--primary-color);
}
.stat-card--success .stat-card__value {
  color: var(--success-color);
}
.stat-card--warning .stat-card__value {
  color: var(--warning-color);
}
.stat-card--danger .stat-card__value {
  color: var(--danger-color);
}

.stat-card__label {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

.stat-card__footer {
  margin-top: var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
}

/* ---- 可交互 ---- */
.stat-card--interactive {
  cursor: pointer;
}

.stat-card--interactive:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* 焦点可见（§6.4，AA） */
.stat-card--interactive:focus-visible {
  outline: var(--focus-ring-w) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}

/* 尊重 prefers-reduced-motion（§6.6） */
@media (prefers-reduced-motion: reduce) {
  .stat-card {
    transition: none;
  }
  .stat-card--interactive:hover {
    transform: none;
  }
}
</style>
