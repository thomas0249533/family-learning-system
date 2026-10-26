<template>
  <div class="achievements-page">
    <PageHeader icon="🏅" title="我的成就" :subtitle="subtitle" />

    <template v-if="view">
      <!-- 整体进度：图鉴完成度 + 枚数。
           ★ 分母一律取 `view.total` = **可收集口径**（27 + 自定义），
           绝不是定义总数 28（`night-owl` 不参与收集，见 PRD §11.2 / C6）。 -->
      <div class="overview">
        <StatCard tone="primary" icon="🏅" :value="`${view.percent}%`" label="图鉴完成度" />
        <StatCard icon="✅" :value="`${view.earned} / ${view.total}`" label="已获得" />
        <StatCard icon="🔒" :value="view.total - view.earned" label="待解锁" />
      </div>

      <!-- 分类进度（V2.8.1 · E2）：来源维度（core/subject/habit/hidden）各一条。
           ★ 与总览同一套可收集口径（sourceProgressOf 内部过滤 night-owl），
           四项 total 相加 = view.total，不出现第二套分母。
           hidden 只给"有 2 枚剪影"这一层信息 —— 剪影本来就可见，泄底的是标题，由剪影守卫管住。 -->
      <div v-if="catProgress.length > 0" class="cat-progress">
        <div
          v-for="c in catProgress"
          :key="c.source"
          class="cat-progress__item"
          :aria-label="`${c.label} ${c.earned} / ${c.total}`"
        >
          <span class="cat-progress__label">{{ c.label }}</span>
          <div
            class="cat-progress__bar"
            role="progressbar"
            :aria-valuenow="c.earned"
            aria-valuemin="0"
            :aria-valuemax="c.total"
            :aria-label="`${c.label}进度 ${c.earned}/${c.total}`"
          >
            <div class="cat-progress__fill" :style="{ width: c.percent + '%' }"></div>
          </div>
          <span class="cat-progress__count">{{ c.earned }}/{{ c.total }}</span>
        </div>
      </div>

      <!-- 最近解锁（V2.8.1 · E1）：数据来自视图模型现成的 view.recent
           （全集口径、unlockedAt 倒序、最多 3 枚 —— 与家长端同一套排序）。
           点击直接打开详情弹窗（复用 AchievementSection 暴露的同一入口）。 -->
      <div v-if="view.recent.length > 0" class="recent-strip">
        <h2 class="recent-strip__title">最近解锁</h2>
        <div class="recent-strip__rows">
          <button
            v-for="r in view.recent"
            :key="r.id"
            type="button"
            class="recent-row"
            @click="openRecent(r)"
          >
            <span class="recent-row__icon" aria-hidden="true">{{ r.icon }}</span>
            <span class="recent-row__name">{{ r.title }}</span>
            <span class="recent-row__date">{{ r.unlockedAt || '较早解锁' }}</span>
          </button>
        </div>
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
           规则来源是 view.complete（buildAchievementView 算的），这里不另算一遍口径。
           ★ 措辞必须落在「可收集」口径上：PRD §11.2 明确禁止写"共 27 枚成就"
           （因为还有一枚不参与收集的定义存在，说"共 27 枚"是既不准也泄底的）。 -->
      <AppCard v-if="showCollection" class="collection-card">
        <div class="collection-body">
          <div class="collection-emoji" aria-hidden="true">🏆</div>
          <div class="collection-text">
            <h2 class="collection-title">可收集的 {{ view.total }} 枚成就已全部收集</h2>
            <p class="collection-desc">
              这一张不是奖励你"运气好"，是你把该练的都练了。往下翻可以看到每一枚的证据。
            </p>
          </div>
          <AppButton size="small" @click="dismissCollection">知道了</AppButton>
        </div>
      </AppCard>

      <!-- 筛选：搜索 + 状态 + 来源。筛选只影响"看哪些"，不影响总览的分母口径
           （分母 = view.total 的可收集枚数，见 achievementMeta 的口径分层注释） -->
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
        <AchievementSection ref="sectionRef" :view="view" standalone />
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatCard from '@/components/ui/StatCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AchievementSection from '@/components/AchievementSection.vue'
import { useAchievementStore } from '@core/stores/achievement'
import { hasSeenCollection, markCollectionSeen } from '@core/motivation/achievementOverview'
import { SOURCE_LABEL, SOURCE_ORDER } from '@core/motivation/achievementOverview'
import {
  buildAchievementViewFromItems,
  sourceProgressOf,
  type AchievementFilter,
  type AchievementItem,
  type AchievementSource,
} from '@core/motivation/achievementMeta'
import {
  CLUE_TEXT,
  HIDDEN_POOL,
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
import { isCollectible } from '@core/motivation/achievements'
import { localDayKey } from '@core/motivation/streak'
import { PRINT_PER_PAGE } from '@core/report/printLayout'
import { exportAchievementImages } from '@core/report/exportImages'
import { exportAchievementsJson } from '@core/export/exportService'
import { currentProfile } from '@core/profile/currentProfile'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'

const achievementStore = useAchievementStore()
const userDataStore = useUserDataStore()
const packageStore = usePackageStore()

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
 * 筛选条件。**只影响可见集合，不影响分母口径** ——
 * 总览卡上的"已获得 x / 27"不该因为搜了个词就变成"x / 3"。
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
  // ★ 措辞走「可收集」口径：`view.total` 已是不含 night-owl 的枚数（27 + 自定义）。
  //   不要写"共 N 枚成就"（PRD §11.2 禁止），也不要把分母写成定义总数。
  if (v.filterActive) return `可收集 ${v.total} 枚 · 已获得 ${v.earned} 枚 · 当前筛出 ${v.filteredTotal} 枚`
  return `可收集 ${v.total} 枚 · 已获得 ${v.earned} 枚 · 点开任意一枚查看细节`
})

/* ---------------- 分类进度与最近解锁（V2.8.1 · E1/E2） ---------------- */

/** 图鉴本体的 ref：最近解锁行与 Toast 跳转都要打开它内部的详情弹窗 */
const sectionRef = ref<InstanceType<typeof AchievementSection> | null>(null)
const route = useRoute()

/** 分类进度：数据与总览同源（store.items 全集 + isCollectible 过滤），顺序/文案用现成常量。
 *  0 枚解锁时不渲染 —— 此时 overview 三卡已完整表达"0/37"，四条 0/n 是空壳。 */
const catProgress = computed(() => {
  if (achievementStore.items.length === 0) return []
  const p = sourceProgressOf(achievementStore.items)
  const rows = SOURCE_ORDER.map((s) => ({
    source: s as AchievementSource,
    label: SOURCE_LABEL[s],
    earned: p[s].earned,
    total: p[s].total,
    percent: p[s].total > 0 ? Math.round((p[s].earned / p[s].total) * 100) : 0,
  }))
  return rows.some((r) => r.earned > 0) ? rows : []
})

/** 最近解锁行点击 → 打开同一套详情弹窗（走剪影守卫，与卡片点击无差别） */
function openRecent(item: AchievementItem): void {
  sectionRef.value?.openDetail(item)
}

/** 按 id 打开详情：item 从**未筛选全集**解析（不能被筛选条件挡住） */
async function openAchievementById(id: string): Promise<void> {
  if (!id) return
  if (achievementStore.items.length === 0) await achievementStore.refreshView()
  const item = achievementStore.items.find((i) => i.id === id)
  if (item && !item.silhouetted) {
    // 等一拍：items 刚就绪时 AppCard/Section 可能还没挂出来，ref 还是 null
    await new Promise<void>((r) => setTimeout(r, 0))
    sectionRef.value?.openDetail(item)
  }
}

/**
 * Toast 点击跳转落点（V2.8.1 · E3）：`/achievements?focus=<id>` 直开详情。
 * 处理完立刻 replace 清参 —— 刷新/后退不会重复弹窗。
 * `focusHandled` 挡住 replace 本身触发的 watch 回环。
 */
let focusHandled = ''
async function handleFocusQuery(): Promise<void> {
  const v = route.query.focus
  const id = typeof v === 'string' ? v : ''
  if (!id || id === focusHandled) return
  focusHandled = id
  await openAchievementById(id)
  void router.replace({ query: { ...route.query, focus: undefined } })
}
watch(() => route.query.focus, () => void handleFocusQuery())

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

/**
 * 抽签池 = 隐藏成就池里**参与收集**的那些（V1.6 · C6）。
 *
 * 为什么不在 `achievementDiscovery.ts` 里改 `HIDDEN_POOL` 本身：
 * 那个常量是"定义真相"的一部分（`tests/achievement-progress.test.ts` 断言它有 3 枚），
 * 而"参不参与收集"是**收集体系的口径**，属于视图层。在调用处过滤，
 * 两个职责各自独立 —— 将来再加一枚彩蛋只需改 `NON_COLLECTIBLE_IDS`。
 *
 * 不滤的后果不是"多抽到一次"，而是**把彩蛋的存在泄出来**：
 * 池里留着 3 枚，`allRevealed` 就要求集齐 3 条线索，孩子会一直在找第 3 条；
 * 而现在池里只有 comeback / early-bird 两枚 —— 线索文案《它只属于某个很晚的夜晚》
 * 也再不会出现（那句本身就是"熬夜有惊喜"的暗示）。
 */
const discoveryPool = computed<string[]>(() => HIDDEN_POOL.filter((id) => isCollectible(id)))

const canDiscover = computed(() => discoveryEnabled.value && canDraw(discovery.value, discoveryPool.value))
const allRevealed = computed(
  () => remainingUnrevealed(discovery.value, discoveryPool.value).length === 0,
)

const discoveryTitle = computed(() => {
  if (allRevealed.value) return '线索都找到了'
  if (canDiscover.value) return `有 ${discovery.value.chances} 次发现机会`
  return '今天的机会用完了'
})

const discoveryDesc = computed(() => {
  // ★ "几枚"必须由池子长度算出来，不能写死「三枚」：池子已经只剩 2 枚，
  //   写死会让孩子去找一条永远不存在的线索（也等于暗示还有一枚藏着）。
  if (allRevealed.value) {
    return `${discoveryPool.value.length} 枚隐藏成就的线索已经全部揭开，剩下的靠你自己做到。`
  }
  if (canDiscover.value) return '抽到的是一句提示，不是成就本身 —— 成就还得真的做到才会解锁。'
  return '明天学习时会再给你一次。机会不累积，也不会因为没用来催你。'
})

async function useDiscovery(): Promise<void> {
  const result = drawDiscovery(discovery.value, discoveryPool.value)
  if (!result.clueId) return
  discovery.value = result.state
  lastClue.value = { id: result.clueId, wasNew: result.wasNew }
  await saveDiscoveryState(result.state)
}

onMounted(async () => {
  // ★ 先补齐进度与包元信息，再重建视图。
  //
  // 之前这里只调 `refreshView()`，默认"用户是从首页点进来的"——
  // 直接从链接进 /achievements（或在这个路由上刷新）时 `userDataStore.progress`
  // 与 `packageStore.packages` 都还是空数组，于是：
  //   · 待解锁 26 枚的进度全部显示 0（"目标 50 个知识点"），
  //   · 故事卡的「现在的记录」整段为空。
  // 两者都**不报错**，只是安静地显示成"这孩子的数据是空的"——
  // 而 Home 与 TopicDetail 一直是先 `loadUserData()` 的，只有这个路由漏了。
  await userDataStore.loadUserData()
  await packageStore.loadPackages()

  collectionSeen.value = await hasSeenCollection()
  discoveryEnabled.value = await loadDiscoveryEnabled()
  if (discoveryEnabled.value) {
    const granted = grantDailyChance(await loadDiscoveryState(), localDayKey())
    discovery.value = granted.state
    if (granted.granted) await saveDiscoveryState(granted.state)
  }
  await achievementStore.refreshView()

  // Toast 跳转进入本页时 query 里已带 focus —— watch 建立之前就该处理这一次
  await handleFocusQuery()
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

/* ========== 分类进度（V2.8.1 · E2） ========== */
.cat-progress {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: $space-3;
}

.cat-progress__item {
  display: flex;
  flex-direction: column;
  gap: $space-1;
  padding: $space-2 $space-3;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.cat-progress__label {
  font-size: $font-2xs;
  font-weight: 800;
  color: $text-sub;
}

.cat-progress__bar {
  height: 6px;
  background: $bg-color-hover;
  border-radius: $radius-full;
  overflow: hidden;
}

.cat-progress__fill {
  height: 100%;
  background: $gradient-primary;
  border-radius: $radius-full;
  transition: width $duration-slow $ease-decelerate;
}

.cat-progress__count {
  font-size: $font-2xs;
  font-weight: 700;
  color: $text-muted;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .cat-progress {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ========== 最近解锁（V2.8.1 · E1） ========== */
.recent-strip {
  display: flex;
  flex-direction: column;
  gap: $space-2;
  padding: $space-3;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  animation: recent-in $duration-base $ease-decelerate;
}

.recent-strip__title {
  margin: 0;
  font-size: $font-xs;
  font-weight: 800;
  color: $text-sub;
}

.recent-strip__rows {
  display: flex;
  flex-direction: column;
  gap: $space-1;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: $space-2;
  padding: $space-2 $space-3;
  font: inherit;
  text-align: left;
  background: $bg-color-hover;
  border: 1px solid transparent;
  border-radius: $radius-md;
  cursor: pointer;
  transition: border-color $duration-fast $ease-standard;

  &:hover {
    border-color: $primary-color;
  }
  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 1px;
  }
}

.recent-row__icon {
  flex-shrink: 0;
  font-size: $font-base;
  line-height: 1;
}

.recent-row__name {
  flex: 1;
  min-width: 0;
  font-size: $font-2xs;
  font-weight: 700;
  color: $text-main;
}

.recent-row__date {
  flex-shrink: 0;
  font-size: $font-2xs;
  font-weight: 600;
  color: $text-muted;
  font-variant-numeric: tabular-nums;
}

@keyframes recent-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .recent-strip { animation: none; }
  .cat-progress__fill { transition: none; }
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
