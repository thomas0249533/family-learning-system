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
  font-size: var(--font-3xl);
  font-weight: 800;
  line-height: 1.25;
  color: var(--text-main);
  letter-spacing: 0.3px;
}

.page-header__icon {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-3xl);
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

/* V2.9 · 深色模式标题柔浮雕（豆包「高级文字效果」场景表：深色所有标题→柔浮雕）。
   多层浅影模拟纸张印刷浮起，不是厚重 3D；浅色模式不动。 */
body.dark-mode .page-header__text {
  /* check-hex-allow: 深色柔浮雕的纯黑下影，浅深同值、无主题价值 */
  text-shadow:
    0 -1px 0 rgba(var(--on-strong-rgb), 0.07),
    0 2px 8px rgba(0, 0, 0, 0.38);
}
</style>
