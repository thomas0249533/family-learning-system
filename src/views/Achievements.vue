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

      <!-- 全收集总结卡：**只弹一次**（db.settings 里的 achievement:collectionSeen）。
           规则来源是 view.complete（buildAchievementView 算的），这里不另算一遍口径。 -->
      <AppCard v-if="showCollection" class="collection-card">
        <div class="collection-body">
          <div class="collection-emoji" aria-hidden="true">🏆</div>
          <div class="collection-text">
            <h2 class="collection-title">全部 {{ view.total }} 枚成就已收集</h2>
            <p class="collection-desc">
              这一张不是奖励你"运气好"，是你把该练的都练了。往下翻可以看到每一枚的证据。
            </p>
          </div>
          <AppButton size="small" @click="dismissCollection">知道了</AppButton>
        </div>
      </AppCard>

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
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatCard from '@/components/ui/StatCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AchievementSection from '@/components/AchievementSection.vue'
import { useAchievementStore } from '@core/stores/achievement'
import { hasSeenCollection, markCollectionSeen } from '@core/motivation/achievementOverview'

const achievementStore = useAchievementStore()
const view = computed(() => achievementStore.view)

const subtitle = computed(() =>
  view.value
    ? `已获得 ${view.value.earned} / ${view.value.total} 枚 · 点开任意一枚查看细节`
    : '正在加载成就…',
)

/**
 * 总结卡是否还要显示。
 * 默认 `true`（= 已看过 → 不显示）：先读库再决定会出现"渲染完闪一下才消失"，
 * 宁可晚一帧出现，也不要在刚打开页面时抖一下。
 */
const collectionSeen = ref(true)
const showCollection = computed(() => view.value?.complete === true && !collectionSeen.value)

async function dismissCollection(): Promise<void> {
  collectionSeen.value = true
  await markCollectionSeen()
}

onMounted(async () => {
  collectionSeen.value = await hasSeenCollection()
  await achievementStore.refreshView()
})
</script>

<style scoped lang="scss">
.collection-body {
  display: flex;
  align-items: center;
  gap: $space-3;
}

.collection-emoji {
  font-size: 32px;
  line-height: 1;
  flex-shrink: 0;
}

.collection-text {
  flex: 1;
  min-width: 0;
}

.collection-title {
  margin: 0;
  font-size: $font-sm;
  font-weight: 800;
  color: $text-main;
  line-height: $leading-tight;
}

.collection-desc {
  margin: 2px 0 0;
  font-size: $font-2xs;
  color: $text-sub;
  line-height: $leading-normal;
}

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
