<template>
  <n-card class="math-module-card" title="🏠 生活应用">
    <div class="life-box">
      <p>这里将展示数学知识在生活中的应用实例。</p>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { NCard } from 'naive-ui'
defineProps<{ type: string, knowledgePointIds?: string[], data?: any, packageId: string }>()
</script>
<style scoped>
.math-module-card { margin-bottom: 16px; border-radius: 14px; }
</style>