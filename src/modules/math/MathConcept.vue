<template>
  <n-card class="math-module-card" title="📖 概念精讲">
    <p>这里展示概念讲解。</p>
  </n-card>
</template>

<script setup lang="ts">
import { NCard } from 'naive-ui'
defineProps<{ type: string, knowledgePointIds?: string[], data?: any, packageId: string }>()
</script>
<style scoped>
.math-module-card { margin-bottom: 16px; border-radius: 14px; }
</style>