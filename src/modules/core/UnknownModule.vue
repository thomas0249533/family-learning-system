<template>
  <EmptyState
    class="unknown-module"
    icon="🧩"
    :description="`模块类型 ${type} 在当前模板中尚未实现，敬请期待！`"
  />
</template>

<script setup lang="ts">
// =====================================================================
// UnknownModule · 未实现模块的兜底占位（§5.1：→ EmptyState）
// ---------------------------------------------------------------------
// 关系：用 EmptyState（包 n-empty）。原先的告警左边框卡片改由 EmptyState
// 统一承载；`type` 仍插值进描述文案，语义不变。
// =====================================================================
import EmptyState from '@/components/ui/EmptyState.vue'

defineProps<{ type: string }>()
</script>

<style scoped lang="scss">
.unknown-module {
  margin-bottom: 16px;
}
</style>
