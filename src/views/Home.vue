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
      <header class="section-header">
        <h2 class="section-title">
          <span class="section-icon">🔄</span>
          <span>今日复习</span>
        </h2>
      </header>

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
      <header class="section-header">
        <h2 class="section-title">
          <span class="section-icon">✨</span>
          <span>今日推荐</span>
        </h2>
        <span v-if="recommendations.length > 0" class="section-count">
          {{ recommendations.length }} 项
        </span>
      </header>

      <n-empty
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
      <header class="section-header">
        <h2 class="section-title">
          <span class="section-icon">🏅</span>
          <span>我的成就</span>
        </h2>
        <span class="section-count">{{ unlockedCount }} / {{ allAchievements.length }}</span>
      </header>

      <div class="ach-grid">
        <div
          v-for="a in allAchievements"
          :key="a.id"
          class="ach-card"
          :class="{ unlocked: a.unlocked }"
        >
          <span class="ach-icon">{{ a.unlocked ? a.icon : '🔒' }}</span>
          <div class="ach-body">
            <div class="ach-title">{{ a.title }}</div>
            <div class="ach-desc">{{ a.desc }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 学习进度 ========== -->
    <section class="section">
      <header class="section-header">
        <h2 class="section-title">
          <span class="section-icon">📊</span>
          <span>学习进度</span>
        </h2>
      </header>

      <div class="progress-card">
        <div class="chart-wrap">
          <div ref="chartRef" class="chart-container"></div>
          <div class="chart-center">
            <div class="chart-rate">{{ stats.masteryRate }}<span class="rate-unit">%</span></div>
            <div class="chart-rate-label">掌握率</div>
          </div>
        </div>
        <div class="progress-stats">
          <div class="stat-item">
            <span class="stat-dot" style="background: var(--primary-color);"></span>
            <div class="stat-info">
              <div class="stat-value">{{ stats.total }}</div>
              <div class="stat-label">总知识点</div>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-dot" style="background: var(--success-color);"></span>
            <div class="stat-info">
              <div class="stat-value">{{ stats.mastered }}</div>
              <div class="stat-label">已掌握</div>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-dot" style="background: var(--warning-color);"></span>
            <div class="stat-info">
              <div class="stat-value">{{ stats.learning }}</div>
              <div class="stat-label">学习中</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NEmpty, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import { generateRecommendations, type Recommendation } from '@core/recommendation/rulesEngine'
import { findUnitByKnowledgePoint } from '@core/importer/resolvePackageUnits'
import { isDueForReview, humanizeNextReview } from '@core/review/reviewScheduler'
import { ACHIEVEMENTS, syncAchievements } from '@core/motivation/achievements'
import { EMPTY_STREAK, loadStreak, streakText, studiedToday, type StreakState } from '@core/motivation/streak'
import { palette } from '@core/styles/palette'

interface AggregatedRec extends Recommendation {
  sourcePackageId: string
  sourcePkgTitle: string
}

const userDataStore = useUserDataStore()
const packageStore = usePackageStore()
const router = useRouter()
const message = useMessage()

const recommendations = ref<AggregatedRec[]>([])
const chartRef = ref<HTMLElement | null>(null)

/** 体验激励：连续打卡 + 成就徽章 */
const streak = ref<StreakState>({ ...EMPTY_STREAK })
const unlockedIds = ref<string[]>([])

const streakLabel = computed(() => streakText(streak.value))
const studiedTodayFlag = computed(() => studiedToday(streak.value))
const allAchievements = computed(() =>
  ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlockedIds.value.includes(a.id) }))
)
const unlockedCount = computed(() => allAchievements.value.filter(a => a.unlocked).length)

const stats = computed(() => {
  let total = 0
  for (const pkg of packageStore.packages) {
    total += pkg.knowledgePoints?.length ?? 0
  }
  const mastered = userDataStore.progress.filter(p => p.status === '已掌握').length
  const learning = userDataStore.progress.filter(p => p.status === '学习中' || p.status === '需复习').length
  const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0
  return { total, mastered, learning, masteryRate }
})

const dueCount = computed(() =>
  userDataStore.progress.filter(p => isDueForReview(p)).length
)

const nextUpText = computed(() => {
  const future = userDataStore.progress
    .filter(p => p.nextReviewAt && new Date(p.nextReviewAt).getTime() > Date.now())
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

  // ✅ 剥前缀工具
  const stripPrefix = (id: string) => {
    const idx = id?.indexOf('::') ?? -1
    return idx >= 0 ? id.slice(idx + 2) : id
  }

  // ✅ 构建全局知识点索引（两种键）
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

      // ✅ 全局查 title
      const kp = globalKpMap.get(rec.knowledgePointId)
        ?? globalKpMapShort.get(stripPrefix(rec.knowledgePointId))

      // ✅ 找不到就跳过（宁缺毋滥）
      if (!kp?.title) continue

      // ✅ 找到真正拥有该 kp 的包（用于跳转）
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

onMounted(async () => {
  await userDataStore.loadUserData()
  await packageStore.loadPackages()

  // 体验激励：读取连续打卡；结算成就，新解锁的当场祝贺
  streak.value = await loadStreak()
  const achResult = await syncAchievements({
    progress: userDataStore.progress,
    mistakes: userDataStore.mistakes,
    streak: streak.value,
  })
  unlockedIds.value = achResult.unlocked
  if (achResult.newlyUnlocked.length > 0) {
    const names = achResult.newlyUnlocked.map(a => `${a.icon} ${a.title}`).join('、')
    message.success(`🏅 解锁新成就：${names}`, { duration: 5000 })
  }

  recommendations.value = generateAllRecommendations()

  if (chartRef.value) {
    const chart = echarts.init(chartRef.value)
    const isDark = document.body.classList.contains('dark-mode')
    const themeColors = isDark ? palette.dark : palette.light
    const borderColor = themeColors.cardBg

    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['65%', '88%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 10, borderColor, borderWidth: 3 },
        label: { show: false },
        data: [
          { value: stats.value.mastered, name: '已掌握', itemStyle: { color: themeColors.success } },
          { value: stats.value.learning, name: '学习中', itemStyle: { color: themeColors.warning } },
          { value: Math.max(stats.value.total - stats.value.mastered - stats.value.learning, 0), name: '未学', itemStyle: { color: themeColors.border } }
        ]
      }]
    })
  }
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
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
      display: inline-block;
    }
  }

  /* 体验激励：连续打卡 */
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
.ach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.ach-card {
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
}

/* ========== 分区通用 ========== */
.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 800;
  color: $text-main;
  margin: 0;
  letter-spacing: 0.2px;

  .section-icon {
    font-size: 18px;
    line-height: 1;
  }
}

.section-count {
  font-size: 12px;
  font-weight: 600;
  color: $text-sub;
  background: $bg-color-hover;
  padding: 3px 10px;
  border-radius: 20px;
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
      color: $warning-color;
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

  /* 左侧色条 */
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
    color: $primary-color;
    letter-spacing: 0.2px;
  }

  &.rec-mistake .rec-badge { background: rgba(var(--danger-rgb), 0.12); color: $danger-color; }
  &.rec-review .rec-badge { background: rgba(var(--warning-rgb), 0.12); color: $warning-color; }
  &.rec-new .rec-badge { background: rgba(var(--success-rgb), 0.12); color: $success-color; }
  &.rec-prerequisite .rec-badge { background: rgba(var(--primary-rgb), 0.12); color: $primary-color; }

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
    color: $primary-color;
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
      color: $primary-color;
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
    gap: 4px;
    min-width: 0;

    .stat-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      transition: background 0.15s;

      &:hover { background: $bg-color-hover; }

      .stat-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .stat-info {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }

      .stat-value {
        font-size: 20px;
        font-weight: 800;
        color: $text-main;
        line-height: 1;
        min-width: 32px;
      }
      .stat-label {
        font-size: 13px;
        color: $text-sub;
        font-weight: 500;
      }
    }
  }
}
</style>