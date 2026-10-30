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
        <!-- 技能树入口（V1.12 · G1）：跳 /graph 看学科 → 单元 → 知识点全景 -->
        <div class="graph-entry">
          <AppButton size="small" icon="🌳" @click="goToGraph">技能树</AppButton>
        </div>
      </div>
      <div class="welcome-decor">
        <span class="decor-emoji">📚</span>
      </div>
    </div>

    <!-- ========== 今日任务（V3.0 · M1：首页的**唯一主入口**）
         三块并列的推荐列表收进下方「更多推荐」，默认折叠。
         理由很具体：并列的列表让人选择困难，孩子会点第一个顺眼的做两题就退，
         系统于是永远不知道"今天完成了多少"。一条队列 + 一个目标才有节奏。 ========== -->
    <section class="section">
      <SectionTitle title="今天的学习" icon="🎯" accent gradient />
      <div class="today-card" @click="goToday">
        <div class="today-head">
          <div class="today-title">{{ todayTitle }}</div>
          <div class="today-sub">{{ todaySub }}</div>
        </div>
        <!-- 自建细进度条：共享 ProgressBar 的轨道色是 `--surface-2`，与卡片底色几乎同色，
             0% 时整条「消失」。这里用 `--border-color` 作轨道，任何主题下都看得见。 -->
        <div
          class="today-bar"
          role="progressbar"
          :aria-valuenow="todayPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="今日任务进度"
        >
          <div class="today-bar__fill" :style="{ width: `${todayPercent}%` }" />
        </div>
        <div class="today-foot">
          <span class="today-count">{{ todayCountText }}</span>
          <span class="action-pill primary">
            {{ todayActionText }}
            <span class="action-arrow">→</span>
          </span>
        </div>
      </div>
    </section>

    <!-- ========== 更多推荐（原三块并列内容，现在默认折叠） ========== -->
    <section class="section">
      <button type="button" class="more-toggle" :aria-expanded="showMore" @click="showMore = !showMore">
        <span>{{ showMore ? '收起推荐' : '更多推荐' }}</span>
        <span class="more-arrow" :class="{ open: showMore }">▾</span>
      </button>

      <template v-if="showMore">
        <!-- 今日复习 -->
        <div class="plan-block">
          <SectionTitle level="h3" title="今日复习" />

          <div class="review-card" :class="{ 'has-due': dueCount > 0 }" @click="goToReview">
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
        </div>

        <!-- 最需要复习（弱项推荐，§11.4：只展事实不露分数） -->
        <div v-if="weakPoints.length > 0" class="plan-block">
          <SectionTitle level="h3" title="最需要复习">
            <AppBadge size="md">{{ weakPoints.length }} 个</AppBadge>
          </SectionTitle>
          <div class="weak-list">
            <div
              v-for="wp in weakPoints"
              :key="wp.knowledgePointId"
              class="weak-row"
              @click="goToWeakPoint(wp)"
            >
              <div class="weak-body">
                <div class="weak-title">{{ wp.title }}</div>
                <div class="weak-reason">{{ wp.reason }}</div>
              </div>
              <div class="weak-cta">
                去练习
                <span class="weak-arrow">→</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 今日推荐 -->
        <div class="plan-block">
          <SectionTitle level="h3" title="今日推荐">
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
        </div>
      </template>
    </section>


    <!-- ========== 荣誉勋章墙（V2.7 · 轨道 A2：大图标 + 分类 Tab + 点击详情）
         完整图鉴（两级折叠 + 证据）仍在独立页 /achievements —— 首页要陈列感，
         独立页要"查得到每一枚的证据"，两者共用同一个 view 模型。 ========== -->
    <section v-if="achView" class="section">
      <AchievementHall :view="achView" />
    </section>

    <!-- ========== 盲盒入口（V2.8 · C3：触发条件满足时悬浮出现，含开箱动画）
         组件自带触发判定与降级，Home 只负责挂载；挂在勋章墙之后 ——
         它是激励层的延伸，位置语义上紧挨着成就。 ========== -->
    <BlindBoxEntrance />

    <!-- ========== 学习进度 ========== -->
    <section class="section">
      <SectionTitle title="学习进度" icon="📊" accent gradient />

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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watchEffect, nextTick } from 'vue'
import SectionTitle from '@/components/ui/SectionTitle.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatCard from '@/components/ui/StatCard.vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import { useThemeStore } from '@core/stores/theme'
import { generateRecommendations, type Recommendation } from '@core/recommendation/rulesEngine'
import { findUnitByKnowledgePoint } from '@core/importer/resolvePackageUnits'
import { isDueForReview, humanizeNextReview } from '@core/review/reviewScheduler'
import { useAchievementStore } from '@core/stores/achievement'
import { computeMasterySummary } from '@core/mastery/masterySummary'
import { computeWeakPoints, type WeakPoint } from '@core/recommendation/weakPoints'
import AchievementHall from '@/components/AchievementHall.vue'
import BlindBoxEntrance from '@/components/BlindBoxEntrance.vue'
import { EMPTY_STREAK, loadRepair, loadStreak, repairLeft, streakText, studiedToday, type StreakState } from '@core/motivation/streak'
import { useChartTheme } from '@core/theme/useChartTheme'
import { planProgress, type DailyPlan } from '@core/plan/dailyPlan'
import { ensureDailyPlan } from '@core/plan/dailyPlanService'

interface AggregatedRec extends Recommendation {
  sourcePackageId: string
  sourcePkgTitle: string
}

const userDataStore = useUserDataStore()
const packageStore = usePackageStore()
const themeStore = useThemeStore()
const router = useRouter()

const recommendations = ref<AggregatedRec[]>([])
const weakPoints = ref<WeakPoint[]>([])
const chartRef = ref<HTMLElement | null>(null)

/**
 * 今日任务（V3.0 · M1）：首页只摆一个"今天做到哪了"。
 *
 * 这里**不自己编排**：`ensureDailyPlan()` 读的是今日页/答题页同一份落盘队列，
 * 所以首页看到的 3/8 与今日页完全一致（自己再算一遍必然会出现两处数字不一致）。
 */
const dailyPlan = ref<DailyPlan | null>(null)
const showMore = ref(false)

const todayProgress = computed(() => (dailyPlan.value ? planProgress(dailyPlan.value) : null))
const todayPercent = computed(() => Math.round((todayProgress.value?.ratio ?? 0) * 100))

const todayTitle = computed(() => {
  const p = todayProgress.value
  if (!dailyPlan.value) return '正在安排今天的学习'
  if (dailyPlan.value.items.length === 0) return '今天没有排任务'
  if (p?.finished) return '今天的任务全部完成 🎉'
  if (!p || p.doneItems === 0) {
    return `今天有 ${p?.totalItems ?? 0} 项，约 ${dailyPlan.value.totals.minutes} 分钟`
  }
  return `还剩 ${p.totalItems - p.doneItems} 项`
})

const todaySub = computed(() => {
  const p = todayProgress.value
  if (!p) return ''
  const goal = dailyPlan.value?.goal
  const budget = goal?.mode === 'minutes' ? `${goal.minutes} 分钟` : `${goal?.questions ?? 24} 题`
  return `今日目标 ${budget} · 已完成 ${p.doneQuestions} 题`
})

const todayCountText = computed(() => {
  const p = todayProgress.value
  if (!p) return ''
  return `${p.doneItems} / ${p.totalItems} 项`
})

const todayActionText = computed(() => {
  const p = todayProgress.value
  if (dailyPlan.value && dailyPlan.value.items.length === 0) return '去看看'
  if (p?.finished) return '看总结'
  return p && p.doneItems > 0 ? '继续' : '开始'
})

function goToday(): void {
  void router.push('/today')
}

/** 体验激励：连续打卡 */
const streak = ref<StreakState>({ ...EMPTY_STREAK })
/**
 * 本月剩余补签次数（V1.6 · C5）。首页**只用来改文案**，不放补签按钮 ——
 * 补签需要家长作证，入口只在家长端（详见 Parent.vue 的补签卡）。
 */
const repairLeftCount = ref(0)

const streakLabel = computed(() =>
  streakText(streak.value, new Date(), repairLeftCount.value),
)
const studiedTodayFlag = computed(() => studiedToday(streak.value))

/**
 * 成就图鉴：数据来自 achievement store（V1.3 · T03）。
 * 页面**不再自己结算** —— 结算统一由 AppShell 的后台触发器负责，
 * 否则会出现"首页结算一次、别的页面又各自结算一次"的重复弹窗。
 */
const achievementStore = useAchievementStore()
const achView = computed(() => achievementStore.view)

const stats = computed(() => {
  // V1.3 · T04：掌握率统一走 computeMasterySummary（去重口径）。
  // 旧实现用 "已掌握行数 / Σ kpCount"：分母把重复登记的知识点数了两遍、
  // 分子却是裸行数（同一知识点在多包有记录会被重复计），于是出现过 >100% 的掌握率。
  const s = computeMasterySummary(packageStore.packages, userDataStore.progress)
  return {
    total: s.total,
    mastered: s.mastered,
    // 页面只有一个"学习中"卡片：把「需复习」也算进"还在推进中"，不丢人
    learning: s.learning + s.needReview,
    masteryRate: s.rate,
  }
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

/** 技能树入口（V1.12 · G1） */
function goToGraph() {
  router.push('/graph')
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

/** C3 · 弱项行点击：跳 TopicDetail 并拉起复习模式（?mode=review），直接进入练习区 */
async function goToWeakPoint(wp: WeakPoint) {
  const pkg = packageStore.packages.find(p => p.packageId === wp.sourcePackageId)
  if (!pkg) {
    router.push('/learn')
    return
  }
  const found = await findUnitByKnowledgePoint(pkg, wp.knowledgePointId)
  if (found) {
    router.push({
      path: `/learn/${found.sourcePackageId}/unit/${found.unitId}/topic/${found.topicId}`,
      query: { mode: 'review' },
    })
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
  // 补签额度：只影响 pill 上的文案（"可请家长补签 1 次"），本页不提供补签入口
  repairLeftCount.value = repairLeft(await loadRepair())

  // 成就图鉴：只刷新只读视图（结算与持久化由 AppShell 的触发器统一负责）
  await achievementStore.refreshView()

  recommendations.value = generateAllRecommendations()

  // 今日任务：读（或生成）今日队列。失败不阻塞首页 —— 下面三块推荐仍可用
  try {
    dailyPlan.value = (await ensureDailyPlan()).plan
  } catch (err) {
    console.warn('[Home] 今日任务加载失败（忽略）', err)
  }

  // C3 · 弱项推荐：与今日推荐的 mistake/review 类去重后，取最需要练的知识点（§11.4）。
  // 同一屏不得重复出现同一知识点；弱项只作首页行动入口，不进报告页（落报告 = 推迟行动）。
  const takenByRecs = new Set(
    recommendations.value
      .filter(r => r.type === 'mistake' || r.type === 'review')
      .map(r => r.knowledgePointId)
  )
  weakPoints.value = computeWeakPoints(packageStore.packages, userDataStore.progress, {
    excludeKpIds: takenByRecs,
  })

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
/* ========== 今日任务卡（V3.0 · M1） ========== */
.today-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-xl;
  box-shadow: $shadow-sm;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
  }
}

.today-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.today-title {
  font-size: 17px;
  font-weight: 800;
  color: $text-main;
}

.today-sub {
  font-size: 13px;
  color: $text-sub;
}

.today-bar {
  height: 8px;
  border-radius: 999px;
  background: $border-color;
  overflow: hidden;
}

.today-bar__fill {
  height: 100%;
  border-radius: 999px;
  background: $gradient-primary;
  transition: width 0.3s ease;
}

.today-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .today-count {
    font-size: 13px;
    font-weight: 700;
    color: $text-sub;
  }

  .action-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 700;
    color: $text-sub;
    padding: 8px 14px;
    border-radius: 20px;
    background: $bg-color-hover;

    &.primary {
      background: $primary-color;
      color: var(--text-on-primary);
    }
  }
}

/* 更多推荐折叠开关（原三块并列内容不能消失，只能降级） */
.more-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: transparent;
  color: $text-sub;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    color: $primary-text;
    border-color: $primary-color;
  }

  .more-arrow {
    transition: transform 0.2s;

    &.open {
      transform: rotate(180deg);
    }
  }
}

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
    /* V2.9 · 欢迎语入场：低速淡入上浮（一次性，非循环；豆包方案「焦点柔显」轻量版） */
    animation: welcome-rise 0.9s var(--ease-standard) both;
  }
  .welcome-sub {
    color: rgba(var(--on-strong-rgb), 0.92);
    font-size: 13px;
    margin: 0;
    font-weight: 500;
    animation: welcome-rise 0.9s var(--ease-standard) 0.12s both;
  }

  .welcome-decor {
    position: relative;
    z-index: 1;
    .decor-emoji {
      /* 毛玻璃圆角徽章：装饰 emoji 不再裸排，与 streak-pill 同一玻璃质感 */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 88px;
      height: 88px;
      border-radius: $radius-lg;
      background: rgba(var(--on-strong-rgb), 0.14);
      border: 1px solid rgba(var(--on-strong-rgb), 0.22);
      backdrop-filter: blur(4px);
      font-size: 48px;
      animation: decor-bob 4.5s $ease-standard infinite;
      /* check-hex-allow: 渐变横幅装饰 emoji 的纯黑投影，浅深同值、无主题价值 */
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
    }
  }

  @keyframes decor-bob {
    0%,
    100% {
      transform: translateY(0) rotate(-3deg);
    }
    50% {
      transform: translateY(-6px) rotate(-3deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .decor-emoji {
      animation: none;
      transform: rotate(-3deg);
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

  /* 技能树入口（V1.12 · G1）：白底小按钮压在渐变横幅上，对比由 n-button 主题保证 */
  .graph-entry {
    position: relative;
    z-index: 1;
    margin-top: 12px;

    /* V2.9 · hover 流光扫过文字/按钮（豆包方案：hover 触发、离开重置，禁自动循环）。
       一道柔和白色光泽从左滑过；reduced-motion 下整段禁用。 */
    .n-button,
    button {
      position: relative;
      overflow: hidden;

      &::after {
        content: '';
        position: absolute;
        top: 0;
        left: -80%;
        width: 50%;
        height: 100%;
        pointer-events: none;
        background: linear-gradient(
          105deg,
          transparent,
          rgba(255, 255, 255, 0.45), /* check-hex-allow: 流光高光的纯白扫光，浅深同值、无主题价值 */
          transparent
        );
        transform: skewX(-18deg);
        transition: left 0.65s var(--ease-standard);
      }

      &:hover::after {
        left: 130%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .n-button,
      button {
        &::after {
          transition: none;
          display: none;
        }
      }
    }
  }
}

/* ========== 分区通用 ========== */
.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 分区标题 / 计数徽章 已由 SectionTitle + AppBadge 基元承载。 */

/* ========== 今日计划：子块容器（复习 / 弱项 / 推荐收在同一分区下） ========== */
.plan-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ========== 最需要复习（弱项推荐）紧凑行 ==========
   刻意不用 .rec-card 的 170px 大卡——弱项是"今天先练这几个"的紧凑清单，
   与推荐大卡并列会造成视觉打架。整行可点、hover 有反馈，样式全走既有 token。 */
.weak-list {
  display: flex;
  flex-direction: column;
  background: $card-bg;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
  overflow: hidden;
}

.weak-row {
  display: flex;
  align-items: center;
  gap: $space-3;
  padding: $space-3 $space-4;
  cursor: pointer;
  transition: background $duration-fast $ease-standard;

  /* 行间分隔线（最后一行不加） */
  & + .weak-row {
    border-top: 1px solid $border-light;
  }

  &:hover {
    background: $bg-color-hover;
  }

  .weak-body {
    flex: 1;
    min-width: 0;
  }

  .weak-title {
    font-size: $font-sm;
    font-weight: 700;
    color: $text-main;
    line-height: $leading-snug;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .weak-reason {
    font-size: $font-xs;
    color: $text-sub;
    line-height: $leading-normal;
    margin-top: 2px;
  }

  .weak-cta {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: $font-xs;
    font-weight: 700;
    color: $primary-text;

    .weak-arrow {
      font-size: $font-sm;
      transition: transform $duration-fast $ease-standard;
    }
  }

  &:hover .weak-cta .weak-arrow {
    transform: translateX(3px);
  }
}

/* 尊重 prefers-reduced-motion（§6.6） */
@media (prefers-reduced-motion: reduce) {
  .weak-row,
  .weak-row .weak-cta .weak-arrow {
    transition: none;
  }
  .weak-row:hover .weak-cta .weak-arrow {
    transform: none;
  }
}

/* V2.9 · 欢迎语入场动画（低速淡入上浮，一次性非循环）+ reduced-motion 禁用 */
@keyframes welcome-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-hi,
  .welcome-sub {
    animation: none;
  }
}

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
