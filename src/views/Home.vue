<template>
  <div class="home-page">
    <!-- ========== 欢迎横幅 ========== -->
    <div class="welcome-banner">
      <div class="welcome-content">
        <h1 class="welcome-hi">👋 欢迎回来！</h1>
        <p class="welcome-sub">今天也要元气满满地学习哦～</p>
        <div class="streak-pill" :class="{ active: studiedTodayFlag }">
          <span class="streak-flame">🔥</span>
          <span class="streak-text">{{ streakLabel }}</span>
        </div>
      </div>
      <div class="welcome-decor">
        <span class="decor-emoji">📚</span>
      </div>
    </div>

    <!-- ========== 今日复习 ========== -->
    <section class="section">
      <SectionTitle title="今日复习" icon="🔄" />

      <div
        class="review-card"
        :class="{ 'has-due': dueCount > 0 }"
        @click="goToReview"
      >
        <div class="review-icon-wrap">
          <span class="review-icon">{{ dueCount > 0 ? '🔥' : '✅' }}</span>
        </div>
        <div class="review-body">
          <div class="review-main">
            <template v-if="dueCount > 0">
              今天有 <strong>{{ dueCount }}</strong> 个知识点待复习
            </template>
            <template v-else>
              今天没有待复习的知识点
            </template>
          </div>
          <div class="review-sub">
            <span v-if="nextUpText">{{ nextUpText }}</span>
            <span v-else>继续保持，稳扎稳打 ✨</span>
          </div>
        </div>
        <div class="review-action">
          <span class="action-pill" :class="{ primary: dueCount > 0 }">
            {{ dueCount > 0 ? '开始复习' : '查看' }}
            <span class="action-arrow">→</span>
          </span>
        </div>
      </div>
    </section>

    <!-- ========== 今日推荐 ========== -->
    <section class="section">
      <SectionTitle title="今日推荐" icon="✨">
        <AppBadge v-if="recommendations.length > 0" size="md">
          {{ recommendations.length }} 项
        </AppBadge>
      </SectionTitle>

      <EmptyState
        v-if="recommendations.length === 0"
        description="暂无推荐，去导入学习包并开始学习吧！"
        class="empty-card"
      />

      <div v-else class="rec-grid">
        <div
          v-for="rec in recommendations"
          :key="rec.knowledgePointId"
          class="rec-card"
          :class="'rec-' + rec.type"
          @click="goToRecommendation(rec)"
        >
          <div class="rec-accent"></div>
          <div class="rec-content">
            <div class="rec-badge-row">
              <span class="rec-badge">{{ recBadge(rec.type) }}</span>
            </div>
            <h3 class="rec-title">{{ rec.title }}</h3>
            <p class="rec-reason">{{ rec.reason }}</p>
            <div class="rec-footer">
              <span class="rec-source">
                <span class="source-icon">📖</span>
                <span class="source-text">{{ rec.sourcePkgTitle }}</span>
              </span>
              <span class="rec-cta">
                去学习
                <span class="cta-arrow">→</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 我的成就 ========== -->
    <section class="section">
      <SectionTitle title="我的成就" icon="🏅">
        <AppBadge size="md">{{ unlockedCount }} / {{ totalCount }}</AppBadge>
      </SectionTitle>

      <!-- 总进度条 -->
      <div class="ach-overview">
        <div class="ach-bar">
          <div class="ach-bar-fill" :style="{ width: achPercent + '%' }"></div>
        </div>
        <span class="ach-overview-text">已解锁 {{ unlockedCount }} / {{ totalCount }}</span>
      </div>

      <!-- 四类分段 -->
      <div v-for="g in groups" :key="g.cat" class="ach-group">
        <div class="ach-group-header">
          <span class="ach-group-title">{{ g.icon }} {{ g.label }}</span>
          <span class="ach-group-count">{{ g.unlocked }} / {{ g.total }}</span>
        </div>
        <div class="ach-grid">
          <div
            v-for="a in g.items"
            :key="a.id"
            class="ach-card"
            :class="{ unlocked: a.unlocked, silhouette: a.hidden && !a.unlocked }"
          >
            <!-- 隐藏成就：未解锁前只显示灰底剪影 + 🔒 + ？？？，不泄露任何信息 -->
            <template v-if="a.hidden && !a.unlocked">
              <span class="ach-icon">🔒</span>
              <div class="ach-body">
                <div class="ach-title">？？？</div>
                <div class="ach-desc">达成后揭晓</div>
              </div>
            </template>
            <template v-else>
              <span class="ach-icon">{{ a.unlocked ? a.icon : '🔒' }}</span>
              <div class="ach-body">
                <div class="ach-title">{{ a.title }}</div>
                <div class="ach-desc">{{ a.desc }}</div>
                <div v-if="a.unlocked" class="ach-date">解锁于 {{ a.unlockedAt || '较早' }}</div>
              </div>
            </template>

            <!-- 连环：在最高已解锁环旁提示「下一环」 -->
            <div v-if="a.nextRing" class="ach-next">
              下一环：{{ a.nextRing.icon }} {{ a.nextRing.title }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 学习进度 ========== -->
    <section class="section">
      <SectionTitle title="学习进度" icon="📊" />

      <div class="progress-card">
        <div class="chart-wrap">
          <div ref="chartRef" class="chart-container"></div>
          <div class="chart-center">
            <div class="chart-rate">{{ stats.masteryRate }}<span class="rate-unit">%</span></div>
            <div class="chart-rate-label">掌握率</div>
          </div>
        </div>
        <div class="progress-stats">
          <StatCard layout="horizontal" :value="stats.total" label="总知识点">
            <template #icon>
              <span class="stat-dot" style="background: var(--primary-color);"></span>
            </template>
          </StatCard>
          <StatCard layout="horizontal" :value="stats.mastered" label="已掌握">
            <template #icon>
              <span class="stat-dot" style="background: var(--success-color);"></span>
            </template>
          </StatCard>
          <StatCard layout="horizontal" :value="stats.learning" label="学习中">
            <template #icon>
              <span class="stat-dot" style="background: var(--warning-color);"></span>
            </template>
          </StatCard>
        </div>
      </div>
    </section>

    <AchievementToast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watchEffect, nextTick } from 'vue'
import SectionTitle from '@/components/ui/SectionTitle.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatCard from '@/components/ui/StatCard.vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import { useThemeStore } from '@core/stores/theme'
import { generateRecommendations, type Recommendation } from '@core/recommendation/rulesEngine'
import { findUnitByKnowledgePoint } from '@core/importer/resolvePackageUnits'
import { packageTypeOf } from '@/schemas/manifest'
import { isDueForReview, humanizeNextReview } from '@core/review/reviewScheduler'
import {
  ACHIEVEMENTS,
  syncAchievements,
  type AchievementCategory,
  type AchievementDef,
  type PackageMeta,
} from '@core/motivation/achievements'
import { CHAINS, chainNextOf } from '@core/motivation/chains'
import { loadDailyStats } from '@core/motivation/dailyStats'
import { loadAttemptedTypes } from '@core/motivation/attemptedTypes'
import { EMPTY_STREAK, loadStreak, streakText, studiedToday, type StreakState } from '@core/motivation/streak'
import { useChartTheme } from '@core/theme/useChartTheme'
import AchievementToast from '@/components/AchievementToast.vue'

interface AggregatedRec extends Recommendation {
  sourcePackageId: string
  sourcePkgTitle: string
}

const userDataStore = useUserDataStore()
const packageStore = usePackageStore()
const themeStore = useThemeStore()
const router = useRouter()

const recommendations = ref<AggregatedRec[]>([])
const chartRef = ref<HTMLElement | null>(null)
const toastRef = ref<InstanceType<typeof AchievementToast> | null>(null)

/** 体验激励：连续打卡 + 成就徽章 */
const streak = ref<StreakState>({ ...EMPTY_STREAK })
const unlockedRecords = ref<Array<{ id: string; unlockedAt: string }>>([])

const streakLabel = computed(() => streakText(streak.value))
const studiedTodayFlag = computed(() => studiedToday(streak.value))

const unlockedIds = computed(() => unlockedRecords.value.map((r) => r.id))
const unlockedAtMap = computed(() => {
  const m = new Map<string, string>()
  for (const r of unlockedRecords.value) m.set(r.id, r.unlockedAt)
  return m
})

const totalCount = ACHIEVEMENTS.length
const unlockedCount = computed(() => unlockedRecords.value.length)
const achPercent = computed(() =>
  totalCount > 0 ? Math.round((unlockedCount.value / totalCount) * 100) : 0,
)

/** 类别元数据 */
const CAT_ORDER: AchievementCategory[] = ['M', 'G', 'B', 'E']
const CAT_META: Record<AchievementCategory, { label: string; icon: string }> = {
  M: { label: '精熟目标', icon: '🎯' },
  G: { label: '成长型思维', icon: '🌱' },
  B: { label: '行为塑造', icon: '⏱️' },
  E: { label: '探索', icon: '🧭' },
}

/** 「下一环」映射：最高已解锁环 → 下一环成就 */
const nextRingMap = computed(() => {
  const map = new Map<string, AchievementDef>()
  for (const chain of CHAINS) {
    const nextId = chainNextOf(chain, unlockedIds.value)
    if (!nextId) continue
    const lastUnlocked = [...chain.ids].reverse().find((id) => unlockedIds.value.includes(id))
    const nextDef = ACHIEVEMENTS.find((a) => a.id === nextId)
    if (lastUnlocked && nextDef) map.set(lastUnlocked, nextDef)
  }
  return map
})

const groups = computed(() =>
  CAT_ORDER.map((cat) => {
    const items = ACHIEVEMENTS.filter((a) => a.category === cat).map((a) => ({
      ...a,
      unlocked: unlockedIds.value.includes(a.id),
      unlockedAt: unlockedAtMap.value.get(a.id) ?? '',
      nextRing: nextRingMap.value.get(a.id) ?? null,
    }))
    const unlocked = items.filter((i) => i.unlocked).length
    return { cat, ...CAT_META[cat], items, unlocked, total: items.length }
  }),
)

const stats = computed(() => {
  let total = 0
  for (const pkg of packageStore.packages) {
    total += pkg.knowledgePoints?.length ?? 0
  }
  const mastered = userDataStore.progress.filter((p) => p.status === '已掌握').length
  const learning = userDataStore.progress.filter((p) => p.status === '学习中' || p.status === '需复习').length
  const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0
  return { total, mastered, learning, masteryRate }
})

const dueCount = computed(() =>
  userDataStore.progress.filter((p) => isDueForReview(p)).length,
)

const nextUpText = computed(() => {
  const future = userDataStore.progress
    .filter((p) => p.nextReviewAt && new Date(p.nextReviewAt).getTime() > Date.now())
    .sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''))
  if (future.length === 0) return ''
  return `下次复习：${humanizeNextReview(future[0].nextReviewAt)}`
})

function recBadge(type: Recommendation['type']): string {
  switch (type) {
    case 'mistake': return '❌ 错题复习'
    case 'review': return '🔄 需复习'
    case 'prerequisite': return '⛓️ 前置知识'
    case 'new': return '🚀 新知识'
    default: return ''
  }
}

function generateAllRecommendations(): AggregatedRec[] {
  const all: AggregatedRec[] = []
  const usedKpIds = new Set<string>()

  const stripPrefix = (id: string) => {
    const idx = id?.indexOf('::') ?? -1
    return idx >= 0 ? id.slice(idx + 2) : id
  }

  const globalKpMap = new Map<string, any>()
  const globalKpMapShort = new Map<string, any>()
  for (const pkg of packageStore.packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      if (kp?.id) {
        globalKpMap.set(kp.id, kp)
        globalKpMapShort.set(stripPrefix(kp.id), kp)
      }
    }
  }

  for (const pkg of packageStore.packages) {
    const hasUnits = (pkg.units?.length ?? 0) > 0
    const isAggregate = (pkg.manifest.dependencies?.length ?? 0) > 0
    if (!hasUnits && isAggregate) continue
    if ((pkg.knowledgePoints?.length ?? 0) === 0) continue

    const recs = generateRecommendations(pkg, userDataStore.mistakes, userDataStore.progress)
    for (const rec of recs) {
      if (usedKpIds.has(rec.knowledgePointId)) continue
      usedKpIds.add(rec.knowledgePointId)

      const kp = globalKpMap.get(rec.knowledgePointId)
        ?? globalKpMapShort.get(stripPrefix(rec.knowledgePointId))

      if (!kp?.title) continue

      const sourcePkg = packageStore.packages.find(
        p => p.knowledgePoints?.some((k: any) => k.id === kp.id)
      )
      if (!sourcePkg) continue

      all.push({
        ...rec,
        title: kp.title,
        sourcePackageId: sourcePkg.packageId,
        sourcePkgTitle: sourcePkg.manifest.title,
      })
    }
  }

  const order = { mistake: 0, prerequisite: 1, review: 2, new: 3 }
  all.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))

  return all.slice(0, 6)
}

function goToReview() {
  router.push('/review')
}

async function goToRecommendation(rec: AggregatedRec) {
  const pkg = packageStore.packages.find(p => p.packageId === rec.sourcePackageId)
  if (!pkg) {
    router.push('/learn')
    return
  }
  const found = await findUnitByKnowledgePoint(pkg, rec.knowledgePointId)
  if (found) {
    router.push(`/learn/${found.sourcePackageId}/unit/${found.unitId}/topic/${found.topicId}`)
    return
  }
  router.push('/learn')
}

// ---------- 图表（随主题即时重绘，B2/B3）----------
const chartTheme = useChartTheme()
let chart: echarts.ECharts | null = null

function renderChart() {
  if (!chart) return
  const t = chartTheme.value
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: t.tooltipBg,
      textStyle: { color: t.tooltipText },
      borderColor: t.border,
    },
    series: [{
      type: 'pie',
      radius: ['65%', '88%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 10, borderColor: t.cardBg, borderWidth: 3 },
      label: { show: false },
      data: [
        { value: stats.value.mastered, name: '已掌握', itemStyle: { color: t.success } },
        { value: stats.value.learning, name: '学习中', itemStyle: { color: t.warning } },
        { value: Math.max(stats.value.total - stats.value.mastered - stats.value.learning, 0), name: '未学', itemStyle: { color: t.border } },
      ],
    }],
  })
  chart.resize()
}

function onResize() {
  chart?.resize()
}

// 主题 / 学段切换 → 等一帧（body 上的 state 已应用）后重绘
watchEffect(async () => {
  void chartTheme.value
  await nextTick()
  if (chart) renderChart()
})

onMounted(async () => {
  await userDataStore.loadUserData()
  await packageStore.loadPackages()

  // 学段主题：按孩子年级自动推荐（仅当未手动选择时）
  themeStore.reconcilePreset(
    packageStore.packages.map((pkg) => ({
      grade: pkg.manifest.grade,
      updatedAt: pkg.manifest.updatedAt,
      createdAt: pkg.manifest.createdAt,
    })),
  )

  // 体验激励：读取连续打卡；结算成就，新解锁的当场播放徽章动效
  streak.value = await loadStreak()

  const packages: PackageMeta[] = packageStore.packages.map((pkg) => ({
    packageId: pkg.packageId,
    subject: pkg.manifest.subject,
    grade: pkg.manifest.grade,
    term: pkg.manifest.term,
    // 运行时 JSON 只写 `type`（`packageType` 是历史别名）→ 统一走 packageTypeOf，避免拿到 undefined
    packageType: packageTypeOf(pkg.manifest) ?? '',
    kpCount: pkg.knowledgePoints?.length ?? 0,
  }))
  const dailyStats = await loadDailyStats()
  const attemptedTypes = await loadAttemptedTypes()

  const achResult = await syncAchievements({
    progress: userDataStore.progress,
    mistakes: userDataStore.mistakes,
    streak: streak.value,
    packages,
    dailyStats,
    attemptedTypes,
  })
  unlockedRecords.value = achResult.unlockedRecords
  if (achResult.newlyUnlocked.length > 0) {
    toastRef.value?.enqueue(achResult.newlyUnlocked)
  }

  recommendations.value = generateAllRecommendations()

  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    renderChart()
    window.addEventListener('resize', onResize)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<style scoped lang="scss">
.home-page {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 8px;
}

/* ========== 欢迎横幅 ========== */
.welcome-banner {
  position: relative;
  background: $gradient-primary;
  border-radius: $radius-xl;
  padding: 28px 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 12px 32px rgba(var(--primary-rgb), 0.25);
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    right: -40px;
    top: -40px;
    width: 180px;
    height: 180px;
    background: rgba(var(--on-strong-rgb), 0.1);
    border-radius: 50%;
  }
  &::after {
    content: '';
    position: absolute;
    right: 60px;
    bottom: -60px;
    width: 120px;
    height: 120px;
    background: rgba(var(--on-strong-rgb), 0.08);
    border-radius: 50%;
  }

  .welcome-content {
    position: relative;
    z-index: 1;
  }
  .welcome-hi {
    color: $on-strong;
    font-size: 22px;
    font-weight: 800;
    margin: 0 0 6px;
    letter-spacing: 0.3px;
  }
  .welcome-sub {
    color: rgba(var(--on-strong-rgb), 0.92);
    font-size: 13px;
    margin: 0;
    font-weight: 500;
  }

  .welcome-decor {
    position: relative;
    z-index: 1;
    .decor-emoji {
      font-size: 52px;
      /* check-hex-allow: 渐变横幅装饰 emoji 的纯黑投影，浅深同值、无主题价值 */
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
      display: inline-block;
    }
  }

  .streak-pill {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    padding: 6px 14px;
    border-radius: 20px;
    background: rgba(var(--on-strong-rgb), 0.18);
    border: 1px solid rgba(var(--on-strong-rgb), 0.28);
    backdrop-filter: blur(4px);

    .streak-flame { font-size: 15px; line-height: 1; }
    .streak-text {
      font-size: 12.5px;
      font-weight: 700;
      color: $on-strong;
      letter-spacing: 0.2px;
    }

    &.active {
      background: rgba(var(--on-strong-rgb), 0.28);
      box-shadow: $shadow;
    }
  }
}

/* ========== 我的成就 ========== */
.ach-overview {
  display: flex;
  align-items: center;
  gap: 12px;

  .ach-bar {
    flex: 1;
    height: 10px;
    background: $bg-color-hover;
    border-radius: 8px;
    overflow: hidden;

    .ach-bar-fill {
      height: 100%;
      background: $gradient-primary;
      border-radius: 8px;
      transition: width 0.4s ease;
    }
  }

  .ach-overview-text {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    color: $text-sub;
  }
}

.ach-group {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .ach-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .ach-group-title {
      font-size: 13px;
      font-weight: 800;
      color: $text-main;
    }
    .ach-group-count {
      font-size: 12px;
      font-weight: 600;
      color: $text-muted;
    }
  }
}

.ach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.ach-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  padding: 12px 14px;
  box-shadow: $shadow-sm;
  opacity: 0.62;
  transition: all 0.2s ease;

  .ach-icon {
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
    filter: grayscale(0.6);
  }

  .ach-body { min-width: 0; }

  .ach-title {
    font-size: 13px;
    font-weight: 800;
    color: $text-sub;
    line-height: 1.3;
  }

  .ach-desc {
    font-size: 11px;
    color: $text-muted;
    margin-top: 2px;
    line-height: 1.4;
  }

  .ach-date {
    font-size: 10px;
    color: $text-muted;
    margin-top: 3px;
    font-weight: 600;
  }

  /* 隐藏成就剪影：不泄露 icon/title/desc */
  &.silhouette {
    background: $bg-color-hover;
    border-style: dashed;

    .ach-icon { filter: grayscale(1) brightness(0.7); }
    .ach-title { letter-spacing: 2px; }
  }

  &.unlocked {
    opacity: 1;
    border-color: rgba(var(--warning-rgb), 0.45);
    background: linear-gradient(135deg, rgba(var(--warning-rgb), 0.08), rgba(var(--primary-rgb), 0.06));

    .ach-icon { filter: none; }
    .ach-title { color: $text-main; }

    &:hover {
      transform: translateY(-2px);
      box-shadow: $shadow-md;
    }
  }

  .ach-next {
    position: absolute;
    right: 10px;
    bottom: 8px;
    font-size: 10px;
    font-weight: 700;
    color: $primary-text;
    background: $primary-light;
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
  }
}

/* ========== 分区通用 ========== */
.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 分区标题 / 计数徽章 已由 SectionTitle + AppBadge 基元承载。 */

/* ========== 今日复习卡片 ========== */
.review-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 18px 20px;
  box-shadow: $shadow-sm;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid $border-color;
  border-left: 4px solid $success-color;
  position: relative;

  &.has-due {
    border-left-color: $warning-color;
    background: linear-gradient(90deg, rgba(var(--warning-rgb), 0.06) 0%, $card-bg 40%);
  }

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
    border-color: $primary-color;
  }

  .review-icon-wrap {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $bg-color-hover;
    border-radius: 12px;

    .review-icon {
      font-size: 24px;
      line-height: 1;
    }
  }

  &.has-due .review-icon-wrap {
    background: rgba(var(--warning-rgb), 0.15);
  }

  .review-body {
    flex: 1;
    min-width: 0;
  }

  .review-main {
    font-size: 15px;
    font-weight: 600;
    color: $text-main;
    margin-bottom: 4px;
    line-height: 1.4;

    strong {
      color: $warning-text;
      font-size: 20px;
      font-weight: 800;
      margin: 0 3px;
      vertical-align: -2px;
    }
  }
  .review-sub {
    font-size: 12px;
    color: $text-sub;
    line-height: 1.4;
  }

  .review-action {
    flex-shrink: 0;
  }

  .action-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    color: $text-sub;
    padding: 8px 14px;
    border-radius: 20px;
    background: $bg-color-hover;
    transition: all 0.2s;

    &.primary {
      background: $gradient-primary;
      color: $on-strong;
      box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
    }

    .action-arrow {
      font-size: 14px;
      transition: transform 0.2s;
    }
  }

  &:hover .action-pill .action-arrow {
    transform: translateX(3px);
  }
}

/* ========== 推荐网格 ========== */
.rec-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.rec-card {
  position: relative;
  display: flex;
  background: $card-bg;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
  border: 1px solid $border-color;
  min-height: 170px;

  &:hover {
    transform: translateY(-3px);
    box-shadow: $shadow-md;
    border-color: $primary-color;
  }

  .rec-accent {
    flex-shrink: 0;
    width: 4px;
    background: $primary-color;
  }

  &.rec-mistake .rec-accent { background: $danger-color; }
  &.rec-review .rec-accent { background: $warning-color; }
  &.rec-new .rec-accent { background: $success-color; }
  &.rec-prerequisite .rec-accent { background: $primary-color; }

  .rec-content {
    flex: 1;
    min-width: 0;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
  }

  .rec-badge-row {
    margin-bottom: 8px;
  }

  .rec-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 20px;
    background: $primary-light;
    color: $primary-text;
    letter-spacing: 0.2px;
  }

  &.rec-mistake .rec-badge { background: var(--badge-danger-bg); color: $danger-text; }
  &.rec-review .rec-badge { background: var(--badge-warning-bg); color: $warning-text; }
  &.rec-new .rec-badge { background: var(--badge-success-bg); color: $success-text; }
  &.rec-prerequisite .rec-badge { background: var(--badge-primary-bg); color: $primary-text; }

  .rec-title {
    font-size: 15px;
    font-weight: 700;
    color: $text-main;
    margin: 0 0 8px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .rec-reason {
    font-size: 13px;
    color: $text-sub;
    line-height: 1.55;
    margin: 0 0 12px;
    flex: 1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .rec-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 10px;
    border-top: 1px dashed $border-light;
    gap: 12px;
  }

  .rec-source {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 1;

    .source-icon {
      font-size: 12px;
      flex-shrink: 0;
    }
    .source-text {
      font-size: 11px;
      color: $text-muted;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .rec-cta {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 700;
    color: $primary-text;
    transition: all 0.2s;

    .cta-arrow {
      font-size: 13px;
      transition: transform 0.2s;
    }
  }

  &:hover .rec-cta .cta-arrow {
    transform: translateX(3px);
  }
}

.empty-card {
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 40px 20px;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
}

/* ========== 学习进度卡片 ========== */
.progress-card {
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 24px;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
  display: flex;
  align-items: center;
  gap: 32px;

  @media (max-width: 768px) {
    flex-direction: column;
    gap: 20px;
  }

  .chart-wrap {
    position: relative;
    width: 200px;
    height: 200px;
    flex-shrink: 0;

    .chart-container {
      width: 100%;
      height: 100%;
    }

    .chart-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    .chart-rate {
      font-size: 32px;
      font-weight: 800;
      color: $primary-text;
      line-height: 1;
      letter-spacing: -0.5px;

      .rate-unit {
        font-size: 16px;
        font-weight: 700;
        margin-left: 2px;
        vertical-align: top;
      }
    }

    .chart-rate-label {
      font-size: 11px;
      color: $text-sub;
      margin-top: 6px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
  }

  .progress-stats {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;

    /* 圆点作为 StatCard `icon` slot 的内容（原 .stat-item 三行已替换为 StatCard）。 */
    .stat-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  }
}
</style>
