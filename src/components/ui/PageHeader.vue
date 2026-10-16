<template>
  <header class="page-header">
    <div v-if="$slots.breadcrumb" class="page-header__breadcrumb">
      <slot name="breadcrumb" />
    </div>

    <div class="page-header__row">
      <component :is="level" class="page-header__title">
        <span v-if="icon" class="page-header__icon" aria-hidden="true">{{ icon }}</span>
        <span class="page-header__text">{{ title }}</span>
      </component>
      <div v-if="$slots.actions" class="page-header__actions">
        <slot name="actions" />
      </div>
    </div>

    <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
  </header>
</template>

<script setup lang="ts">
// =====================================================================
// PageHeader · 自建页头（统一 `.page-title`）
// ---------------------------------------------------------------------
// 关系：自建（§4）。标题 `--text-main`、副标题 `--text-sub`、底边
// `--page-header-border`。`level` 决定语义标签（h1/h2）。零硬编码色。
// =====================================================================
interface PageHeaderProps {
  title: string
  subtitle?: string
  icon?: string
  level?: 'h1' | 'h2'
}

withDefaults(defineProps<PageHeaderProps>(), {
  subtitle: undefined,
  icon: undefined,
  level: 'h1',
})
</script>

<style scoped lang="scss">
.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--page-header-border);
}

.page-header__breadcrumb {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.page-header__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.page-header__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--font-2xl);
  font-weight: 700;
  line-height: 1.25;
  color: var(--text-main);
}

.page-header__icon {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-2xl);
  line-height: 1;
}

.page-header__text {
  min-width: 0;
}

.page-header__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.page-header__subtitle {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--text-sub);
}
</style>
