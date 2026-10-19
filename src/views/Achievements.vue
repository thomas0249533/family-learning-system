<template>
  <div class="achievements-page">
    <PageHeader icon="🏅" title="我的成就" :subtitle="subtitle" />

    <template v-if="view">
      <!-- 整体进度：图鉴完成度 + 枚数（28 从 view.total 取，不写死） -->
      <div class="overview">
        <StatCard tone="primary" icon="🏅" :value="`${view.percent}%`" label="图鉴完成度" />
        <StatCard icon="✅" :value="`${view.earned} / ${view.total}`" label="已获得" />
        <StatCard icon="🔒" :value="view.total - view.earned" label="待解锁" />
      </div>

      <AppCard>
        <AchievementSection :view="view" standalone />
      </AppCard>
    </template>

    <EmptyState v-else size="large" icon="🏅" description="正在加载成就…" />
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// Achievements · 独立成就图鉴页（V1.3 · P1）
// ---------------------------------------------------------------------
// 只是 Home「成就区」的**放大版**：同一个 `AchievementSection`（同一份视图模型、
// 同一套折叠状态、同一个详情弹层），外面加页头与三张总览卡。
// 所以不存在"首页显示 A、图鉴页显示 B"的第二套口径。
//
// 数据：`useAchievementStore().view`；Home 在 onMounted 里做的那一步这里照做
// （`refreshView()` 只重建视图、不写库，多次调用无副作用）。
// 未加载完：给一句占位，而不是渲染空图鉴 —— 空图鉴会被误读成"一枚都没有"。
// =====================================================================
import { computed, onMounted } from 'vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatCard from '@/components/ui/StatCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AchievementSection from '@/components/AchievementSection.vue'
import { useAchievementStore } from '@core/stores/achievement'

const achievementStore = useAchievementStore()
const view = computed(() => achievementStore.view)

const subtitle = computed(() =>
  view.value
    ? `已获得 ${view.value.earned} / ${view.value.total} 枚 · 点开任意一枚查看细节`
    : '正在加载成就…',
)

onMounted(async () => {
  await achievementStore.refreshView()
})
</script>

<style scoped lang="scss">
.achievements-page {
  display: flex;
  flex-direction: column;
  gap: $space-4;
  padding-bottom: $space-4;
}

.overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: $space-3;
}

@media (max-width: 640px) {
  .overview {
    grid-template-columns: 1fr;
  }
}
</style>
