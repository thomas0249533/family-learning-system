<template>
  <AppCard class="math-module-card" title="🏠 生活应用">
    <div class="life-box">
      <p>这里将展示数学知识在生活中的应用实例。</p>
    </div>
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