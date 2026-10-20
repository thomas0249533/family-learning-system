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

      <!-- 发现机制：一天一次机会，抽到的是**线索**不是成就；家长可关 -->
      <AppCard v-if="discoveryEnabled" class="discovery-card">
        <div class="discovery-body">
          <div class="discovery-emoji" aria-hidden="true">🔍</div>
          <div class="discovery-text">
            <h2 class="discovery-title">{{ discoveryTitle }}</h2>
            <p class="discovery-desc">{{ discoveryDesc }}</p>
            <p v-if="lastClue" class="discovery-clue" :class="{ fresh: lastClue.wasNew }">
              {{ CLUE_TEXT[lastClue.id] }}
            </p>
          </div>
          <AppButton v-if="canDiscover" size="small" type="primary" @click="useDiscovery">
            用掉一次机会
          </AppButton>
        </div>
      </AppCard>

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

      <!-- 筛选：搜索 + 状态 + 来源。筛选只影响"看哪些"，不影响总览的 28 口径 -->
      <div class="filters">
        <input
          v-model="filter.query"
          class="filter-search"
          type="search"
          placeholder="搜索成就名称或描述"
          aria-label="搜索成就"
        />
        <div class="filter-row">
          <span class="filter-label">状态</span>
          <button
            v-for="opt in STATE_OPTIONS"
            :key="opt.value"
            type="button"
            class="chip"
            :class="{ active: filter.state === opt.value }"
            :aria-pressed="filter.state === opt.value"
            @click="filter.state = opt.value"
          >{{ opt.label }}</button>
        </div>
        <div class="filter-row">
          <span class="filter-label">来源</span>
          <button
            v-for="opt in SOURCE_OPTIONS"
            :key="opt.value"
            type="button"
            class="chip"
            :class="{ active: filter.source === opt.value }"
            :aria-pressed="filter.source === opt.value"
            @click="filter.source = opt.value"
          >{{ opt.label }}</button>
        </div>
      </div>

      <!-- 筛空了要明确说"是筛空的"，不能说"还没有徽章"（那是另一回事） -->
      <EmptyState
        v-if="view.filteredTotal === 0"
        size="large"
        icon="🔍"
        :description="view.emptyHint"
      />

      <AppCard v-else>
        <AchievementSection :view="view" standalone />
      </AppCard>

      <!-- 打印与导出（V1.4 · B5）。放在图鉴页而不是设置页：
           "把这张墙打出来贴墙上"是看到成就之后的下一个念头。 -->
      <AppCard title="🖨️ 打印与导出">
        <div class="export-actions">
          <AppButton size="small" :loading="printing" @click="goPrint">打印 / 存成 PDF</AppButton>
          <AppButton size="small" :loading="exportingImage" @click="exportImages">导出图片（按小组 4 张）</AppButton>
          <AppButton size="small" :loading="exportingJson" @click="exportJson">导出成就记录（JSON）</AppButton>
        </div>
        <p class="export-hint">
          打印件按小组分页（每页 {{ PRINT_PER_PAGE }} 枚），固定浅色，黑白打印机也能看出层级；
          成就记录导的是 JSON，可以在另一台设备上导入合并，不会覆盖对方已有的徽章。
        </p>
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
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatCard from '@/components/ui/StatCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AchievementSection from '@/components/AchievementSection.vue'
import { useAchievementStore } from '@core/stores/achievement'
import { hasSeenCollection, markCollectionSeen } from '@core/motivation/achievementOverview'
import {
  buildAchievementViewFromItems,
  type AchievementFilter,
  type AchievementSource,
} from '@core/motivation/achievementMeta'
import { SOURCE_LABEL, SOURCE_ORDER } from '@core/motivation/achievementOverview'
import {
  CLUE_TEXT,
  canDraw,
  drawDiscovery,
  emptyDiscoveryState,
  grantDailyChance,
  loadDiscoveryEnabled,
  loadDiscoveryState,
  remainingUnrevealed,
  saveDiscoveryState,
  type DiscoveryState,
} from '@core/motivation/achievementDiscovery'
import { localDayKey } from '@core/motivation/streak'
import { PRINT_PER_PAGE } from '@core/report/printLayout'
import { exportAchievementImages } from '@core/report/exportImages'
import { exportAchievementsJson } from '@core/export/exportService'
import { currentProfile } from '@core/profile/currentProfile'

const achievementStore = useAchievementStore()

// ---- 打印与导出（B5）----
const router = useRouter()
const message = useMessage()
const printing = ref(false)
const exportingImage = ref(false)
const exportingJson = ref(false)

function goPrint(): void {
  printing.value = true
  router.push('/achievements/print').finally(() => {
    printing.value = false
  })
}

/**
 * 导出图片：4 张（某组超容量时该组是多张）。
 *
 * 失败必须报出来：`canvas.toBlob` 返回 null 或浏览器拦截下载时，
 * 静默失败会让用户以为"点了没反应"，然后反复点。
 */
async function exportImages(): Promise<void> {
  if (exportingImage.value) return
  exportingImage.value = true
  try {
    const files = await exportAchievementImages(achievementStore.items, currentProfile()?.name ?? '我')
    if (files.length === 0) message.warning('还没有成就可导出')
    else message.success(`已导出 ${files.length} 张图片`)
  } catch (e) {
    message.error('导出图片失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    exportingImage.value = false
  }
}

async function exportJson(): Promise<void> {
  if (exportingJson.value) return
  exportingJson.value = true
  try {
    const r = await exportAchievementsJson()
    message.success(`已导出 ${r.records} 条成就记录`)
  } catch (e) {
    message.error('导出成就记录失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    exportingJson.value = false
  }
}

/**
 * 筛选条件。**只影响可见集合，不影响 28 的总口径** ——
 * 总览卡上的"已获得 x / 28"不该因为搜了个词就变成"x / 3"。
 */
const filter = reactive<AchievementFilter>({ query: '', state: 'all', source: 'all' })

const STATE_OPTIONS: { value: 'all' | 'earned' | 'pending'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'earned', label: '已获得' },
  { value: 'pending', label: '待解锁' },
]

const SOURCE_OPTIONS: { value: AchievementSource | 'all'; label: string }[] = [
  { value: 'all', label: '全部来源' },
  ...SOURCE_ORDER.map((s) => ({ value: s, label: SOURCE_LABEL[s] })),
]

/**
 * 视图 = 缓存 items + 纯函数派生（不重读库、不重算进度）。
 * 未加载时 `items` 为空 → 回落到 store 的 view（null → 页面显示"正在加载"）。
 */
const view = computed(() => {
  if (achievementStore.items.length === 0) return achievementStore.view
  return buildAchievementViewFromItems(
    achievementStore.items,
    { noPackages: achievementStore.noPackages },
    filter,
  )
})

const subtitle = computed(() => {
  const v = view.value
  if (!v) return '正在加载成就…'
  if (v.filterActive) return `已获得 ${v.earned} / ${v.total} 枚 · 当前筛出 ${v.filteredTotal} 枚`
  return `已获得 ${v.earned} / ${v.total} 枚 · 点开任意一枚查看细节`
})

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

/* ---------------- 发现机制 ---------------- */

const discoveryEnabled = ref(false)
const discovery = ref<DiscoveryState>(emptyDiscoveryState())
/** 本次会话刚抽到的线索（刷新后清空：线索本身存在 revealed 里，不用再回放） */
const lastClue = ref<{ id: string; wasNew: boolean } | null>(null)

const canDiscover = computed(() => discoveryEnabled.value && canDraw(discovery.value))
const allRevealed = computed(() => remainingUnrevealed(discovery.value).length === 0)

const discoveryTitle = computed(() => {
  if (allRevealed.value) return '线索都找到了'
  if (canDiscover.value) return `有 ${discovery.value.chances} 次发现机会`
  return '今天的机会用完了'
})

const discoveryDesc = computed(() => {
  if (allRevealed.value) return '三枚隐藏成就的线索已经全部揭开，剩下的靠你自己做到。'
  if (canDiscover.value) return '抽到的是一句提示，不是成就本身 —— 成就还得真的做到才会解锁。'
  return '明天学习时会再给你一次。机会不累积，也不会因为没用来催你。'
})

async function useDiscovery(): Promise<void> {
  const result = drawDiscovery(discovery.value)
  if (!result.clueId) return
  discovery.value = result.state
  lastClue.value = { id: result.clueId, wasNew: result.wasNew }
  await saveDiscoveryState(result.state)
}

onMounted(async () => {
  collectionSeen.value = await hasSeenCollection()
  discoveryEnabled.value = await loadDiscoveryEnabled()
  if (discoveryEnabled.value) {
    const granted = grantDailyChance(await loadDiscoveryState(), localDayKey())
    discovery.value = granted.state
    if (granted.granted) await saveDiscoveryState(granted.state)
  }
  await achievementStore.refreshView()
})
</script>

<style scoped lang="scss">
.discovery-body {
  display: flex;
  align-items: center;
  gap: $space-3;
}

.discovery-emoji {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}

.discovery-text {
  flex: 1;
  min-width: 0;
}

.discovery-title {
  margin: 0;
  font-size: $font-sm;
  font-weight: 800;
  color: $text-main;
  line-height: $leading-tight;
}

.discovery-desc {
  margin: 2px 0 0;
  font-size: $font-2xs;
  color: $text-sub;
  line-height: $leading-normal;
}

/* 线索出现时淡入一次；新线索多一个描边强调（颜色不是唯一编码：还有"新"的文案差） */
.discovery-clue {
  margin: $space-2 0 0;
  padding: $space-2 $space-3;
  font-size: $font-2xs;
  font-weight: 700;
  color: $primary-text;
  background: $primary-soft;
  border-left: 3px solid $primary-color;
  border-radius: $radius-md;
  line-height: $leading-normal;
  animation: clue-in $duration-base $ease-decelerate;

  &.fresh {
    border-left-width: 6px;
  }
}

@keyframes clue-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .discovery-clue { animation: none; }
}

.filters {
  display: flex;
  flex-direction: column;
  gap: $space-2;
}

.filter-search {
  width: 100%;
  padding: 8px 12px;
  font: inherit;
  font-size: $font-2xs;
  color: $text-main;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;

  &::placeholder {
    color: $text-muted;
  }
  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 1px;
  }
}

.filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: $space-2;
}

.filter-label {
  font-size: $font-2xs;
  font-weight: 700;
  color: $text-muted;
}

.chip {
  padding: 3px 10px;
  font: inherit;
  font-size: $font-2xs;
  font-weight: 700;
  color: $text-sub;
  background: $bg-color-hover;
  border: 1px solid transparent;
  border-radius: $radius-full;
  cursor: pointer;
  transition: border-color $duration-fast $ease-standard, color $duration-fast $ease-standard;

  &:hover {
    border-color: $border-color;
  }
  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }
  &.active {
    color: $primary-text;
    background: $primary-soft;
    border-color: $primary-color;
  }
}

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

/* ========== 打印与导出（V1.4 · B5） ========== */
.export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: $space-2;
}

.export-hint {
  margin: $space-2 0 0;
  font-size: $font-xs;
  color: $text-muted;
  line-height: $leading-relaxed;
}
</style>
