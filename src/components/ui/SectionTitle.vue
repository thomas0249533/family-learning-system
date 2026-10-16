<template>
  <component
    :is="level"
    class="section-title"
    :class="{ 'section-title--accent': accent }"
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
}

withDefaults(defineProps<SectionTitleProps>(), {
  icon: undefined,
  count: undefined,
  level: 'h2',
  accent: false,
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
  padding-left: var(--space-3);
  border-left: 4px solid var(--primary-color);
}

.section-title__icon {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-lg);
  line-height: 1;
}

.section-title__text {
  min-width: 0;
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
