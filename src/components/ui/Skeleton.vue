<template>
  <span
    class="skeleton"
    :class="[`skeleton--${variant}`, { 'skeleton--animated': animated }]"
    :style="sizeStyle"
    :aria-hidden="label ? undefined : 'true'"
    :role="label ? 'status' : undefined"
  >
    <span v-if="label" class="skeleton__label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
// =====================================================================
// Skeleton · 骨架屏占位块（V4.0 · D4）
// ---------------------------------------------------------------------
// 关系：**不包 naive**（n-skeleton 只有 1 个 rect 形态，无法表达「圆形头像 +
//       多行文字 + 卡片块」的组合），是本仓自建的纯布局基元。
//
// 设计取舍：用**透明度脉冲**而非扫光渐变。
//   理由是本仓禁写字面量色、也不允许 color-mix（tokens.md §6），
//   而 `--bg-color-hover → --surface-2` 在暗色下几乎同色，扫光根本看不见；
//   脉冲只动 opacity，两套主题下都可读，且只需合成层、无重绘。
//
// a11y：默认 `aria-hidden`（纯装饰）。需要播报时传 `label`
//   —— 此时元素变成 `role="status"`，读屏会读出「正在加载…」这类文案。
//   一屏多处骨架只给**一处**传 label，否则会重复播报。
// =====================================================================
import { computed } from 'vue'

interface SkeletonProps {
  /** text=细线（正文行）/ rect=块（卡片、图）/ circle=圆（头像） */
  variant?: 'text' | 'rect' | 'circle'
  /** CSS 长度，如 '60%'、'120px'；不给则撑满父级 */
  width?: string
  /** CSS 长度；不给则用 variant 的默认高度 */
  height?: string
  /** 是否脉冲动画（减弱动效偏好下自动关闭） */
  animated?: boolean
  /** 给读屏的加载文案；不传则整个元素对辅助技术不可见 */
  label?: string
}

const props = withDefaults(defineProps<SkeletonProps>(), {
  variant: 'text',
  width: undefined,
  height: undefined,
  animated: true,
  label: undefined,
})

const sizeStyle = computed(() => ({
  width: props.width,
  height: props.height,
}))
</script>

<style scoped lang="scss">
.skeleton {
  display: block;
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--bg-color-hover);
  border-radius: var(--radius-sm);
}

/* 暗色微调（与 PageHeader / SectionTitle 同做法）：
   暗色下中性色区间被压缩，`--bg-color-hover` 与卡片底色几乎同色，骨架会"看不见"；
   抬到 `--border-color` 才够辨识。 */
body.dark-mode .skeleton {
  background: var(--border-color);
}

/* 正文行：高度跟随字号，宽度默认撑满（多行时由调用方给每行不同宽度） */
.skeleton--text {
  height: var(--font-base);
  border-radius: var(--radius-xs);
}

/* 块：卡片、图片占位 */
.skeleton--rect {
  height: 88px;
  border-radius: var(--radius-md);
}

/* 圆：头像、图标位 */
.skeleton--circle {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
}

.skeleton--animated {
  animation: skeleton-pulse 1.4s var(--ease-standard) infinite; /* check-motion-allow: 骨架屏脉冲循环，非交互反馈 */
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

/* 读屏专用：视觉不可见但可被辅助技术读出（本仓无全局 .sr-only，就地实现） */
.skeleton__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .skeleton--animated {
    animation: none;
  }
}
</style>
