<template>
  <component
    :is="level"
    class="section-title"
    :class="{ 'section-title--accent': accent, 'section-title--gradient': gradient }"
  >
    <span v-if="icon" class="section-title__icon" aria-hidden="true">{{ icon }}</span>
    <span class="section-title__text">{{ title }}</span>
    <span v-if="count !== undefined || $slots.count" class="section-title__count">
      <slot name="count">{{ count }}</slot>
    </span>
    <span v-if="$slots.default" class="section-title__extra"><slot /></span>
  </component>
</template>

<script setup lang="ts">
// =====================================================================
// SectionTitle · 自建小节标题（统一 `.section-header` / `.section-title`）
// ---------------------------------------------------------------------
// 关系：自建（§4）。文字用 `--text-main`；`accent` 左竖条用 `--primary-color`。
// `level` 决定语义标签（h2/h3），保证文档大纲正确。零硬编码色。
// =====================================================================
interface SectionTitleProps {
  icon?: string
  title: string
  count?: string | number
  level?: 'h2' | 'h3'
  /** 左侧主色竖条（Report 风格） */
  accent?: boolean
  /** 渐变标题文字（V2.9 · 借鉴豆包「高级文字效果」方案）：
   *  浅色 = 低饱和品牌渐变文字（background-clip:text）；深色 = 柔浮雕（多层浅影）。
   *  护眼克制：仅用于一级模块标题，opt-in；正文/题干禁用。 */
  gradient?: boolean
}

withDefaults(defineProps<SectionTitleProps>(), {
  icon: undefined,
  count: undefined,
  level: 'h2',
  accent: false,
  gradient: false,
})
</script>

<style scoped lang="scss">
.section-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--font-lg);
  font-weight: 800;
  line-height: 1.3;
  color: var(--text-main);
}

.section-title--accent {
  position: relative;
  padding-left: var(--space-4);

  /* 渐变圆角短条替代直角 border：与英雄横幅同一渐变语言，更柔和 */
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--gradient-primary);
  }
}

.section-title__icon {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-xl);
  line-height: 1;
}

.section-title__text {
  min-width: 0;
}

/* V2.9 · 渐变标题文字（豆包「高级文字效果」：低饱和、护眼、静态优先）。
   浅色 = 品牌文字色系低饱和渐变（两端均为 a11y 达标文字色，深浅主题自适应）；
   深色 = 切回纯文字色 + 柔浮雕（多层浅影、纸张浮起感，非厚重 3D）。 */
.section-title--gradient .section-title__text {
  background: linear-gradient(115deg, var(--primary-text) 15%, var(--success-text) 85%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;

  body.dark-mode & {
    background: none;
    -webkit-text-fill-color: currentcolor;
    color: var(--text-main);
    /* check-hex-allow: 深色柔浮雕的纯黑下影，浅深同值、无主题价值（豆包方案：多层浅影非厚重 3D） */
    text-shadow:
      0 -1px 0 rgba(var(--on-strong-rgb), 0.07),
      0 2px 8px rgba(0, 0, 0, 0.38);
  }
}

.section-title__count {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--badge-neutral-bg);
  color: var(--text-sub);
  font-size: var(--font-2xs);
  font-weight: 600;
  line-height: 1.7;
}

.section-title__extra {
  margin-left: auto;
}
</style>
