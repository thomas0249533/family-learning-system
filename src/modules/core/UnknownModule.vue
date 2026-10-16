<template>
  <n-card class="unknown-module" title="暂不支持该模块">
    <p>模块类型 <code>{{ type }}</code> 在当前模板中尚未实现，敬请期待！</p>
  </n-card>
</template>

<script setup lang="ts">
import { NCard } from 'naive-ui'
defineProps<{ type: string }>()
</script>

<style scoped lang="scss">
.unknown-module { border-left: 4px solid $warning-color; margin-bottom: 16px; }
</style>