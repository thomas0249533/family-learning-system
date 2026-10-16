<template>
  <AppCard class="math-module-card" title="📖 概念精讲">
    <p>这里展示概念讲解。</p>
  </AppCard>
</template>

<script setup lang="ts">
import AppCard from '@/components/ui/AppCard.vue'
defineProps<{ type: string, knowledgePointIds?: string[], data?: any, packageId: string }>()
</script>
<style scoped>
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.math-module-card { margin-bottom: 16px; }
</style>