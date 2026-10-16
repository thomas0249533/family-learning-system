<template>
  <div class="parent-page">
    <!-- 顶部标题 -->
    <div class="page-title">
      <h1>👨‍👩‍👧 家长视图</h1>
      <p class="page-sub">查看孩子的学习情况 · 数据只读</p>
    </div>

    <!-- 总览指标 -->
    <section class="section">
      <h2 class="section-title">📊 学习总览</h2>
      <div class="overview-grid">
        <div class="ov-card">
          <div class="ov-icon">📖</div>
          <div class="ov-value">{{ stats.totalKp }}</div>
          <div class="ov-label">知识点总数</div>
        </div>
        <div class="ov-card success">
          <div class="ov-icon">✅</div>
          <div class="ov-value">{{ stats.mastered }}</div>
          <div class="ov-label">已掌握</div>
        </div>
        <div class="ov-card warning">
          <div class="ov-icon">🔄</div>
          <div class="ov-value">{{ stats.learning }}</div>
          <div class="ov-label">学习中</div>
        </div>
        <div class="ov-card danger">
          <div class="ov-icon">❌</div>
          <div class="ov-value">{{ stats.needReview }}</div>
          <div class="ov-label">需复习</div>
        </div>
        <div class="ov-card">
          <div class="ov-icon">⏱️</div>
          <div class="ov-value">{{ stats.studyMinutes }}</div>
          <div class="ov-label">累计分钟</div>
        </div>
        <div class="ov-card">
          <div class="ov-icon">🔥</div>
          <div class="ov-value">{{ stats.continuousDays }}</div>
          <div class="ov-label">连续天数</div>
        </div>
      </div>
    </section>

    <!-- 学科分布 -->
    <section class="section" v-if="subjectStats.length > 0">
      <h2 class="section-title">📚 学科分布</h2>
      <div class="subject-list">
        <div v-for="s in subjectStats" :key="s.subject" class="subject-item">
          <div class="subject-head">
            <span class="subject-name">{{ s.label }}</span>
            <span class="subject-count">
              {{ s.mastered }} / {{ s.total }}（{{ s.rate }}%）
            </span>
          </div>
          <div class="subject-bar">
            <div
              class="subject-bar-fill"
              :style="{ width: s.rate + '%' }"
            ></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 高频错题 Top 5 -->
    <section class="section" v-if="topMistakes.length > 0">
      <h2 class="section-title">❌ 高频错题 Top 5</h2>
      <div class="top-list">
        <div v-for="(item, i) in topMistakes" :key="item.kpId" class="top-item">
          <div class="top-rank">{{ i + 1 }}</div>
          <div class="top-info">
            <div class="top-title">{{ item.title }}</div>
            <div class="top-meta">错 {{ item.count }} 次</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 近 7 天学习 -->
    <section class="section">
      <h2 class="section-title">📅 近 7 天学习</h2>
      <div class="week-card">
        <div class="week-chart">
          <div v-for="d in weekDays" :key="d.date" class="day-col">
            <div class="day-bar-wrap">
              <div
                class="day-bar"
                :style="{ height: barHeight(d.count) + '%' }"
                :class="{ active: d.count > 0 }"
              ></div>
            </div>
            <div class="day-count" v-if="d.count > 0">{{ d.count }}</div>
            <div class="day-label">{{ d.label }}</div>
          </div>
        </div>
        <div class="week-summary">
          本周共学习 <b>{{ weekTotal }}</b> 个知识点
        </div>
      </div>
    </section>

    <!-- 学习包管理 -->
    <section class="section">
      <h2 class="section-title">📦 学习包管理</h2>
      <div class="pkg-card">
        <div class="pkg-info">
          <div class="pkg-title">已导入 {{ packageStore.packages.length }} 个学习包</div>
          <div class="pkg-desc">管理学习内容、导入新包、导出备份</div>
        </div>
        <n-button type="primary" @click="goToImport">📥 管理学习包</n-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NButton } from 'naive-ui'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'

const router = useRouter()
const userDataStore = useUserDataStore()
const packageStore = usePackageStore()

onMounted(async () => {
  await userDataStore.loadUserData()
  await packageStore.loadPackages()
})

/** 总览统计 */
const stats = computed(() => {
  let totalKp = 0
  for (const pkg of packageStore.packages) {
    totalKp += pkg.knowledgePoints?.length ?? 0
  }

  const progress = userDataStore.progress
  const mastered = progress.filter(p => p.status === '已掌握').length
  const learning = progress.filter(p => p.status === '学习中').length
  const needReview = progress.filter(p => p.status === '需复习').length
  const studySeconds = progress.reduce((sum, p) => sum + (p.studySeconds ?? 0), 0)
  const studyMinutes = Math.round(studySeconds / 60)

  // 连续天数
  const days = new Set<string>()
  for (const p of progress) {
    if (p.lastStudiedAt) days.add(p.lastStudiedAt.slice(0, 10))
  }
  const sorted = Array.from(days).sort().reverse()
  let continuousDays = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < sorted.length; i++) {
    const expect = new Date(today.getTime() - i * 86400000)
    if (sorted[i] === expect.toISOString().slice(0, 10)) continuousDays++
    else break
  }

  return { totalKp, mastered, learning, needReview, studyMinutes, continuousDays }
})

/** 学科分布 */
const subjectStats = computed(() => {
  const labelMap: Record<string, string> = { math: '数学', chinese: '语文', english: '英语' }
  const kpToSubject = new Map<string, string>()
  const perSubject = new Map<string, { total: number; mastered: number }>()

  for (const pkg of packageStore.packages) {
    const subj = pkg.manifest.subject
    if (!subj) continue
    for (const kp of pkg.knowledgePoints ?? []) {
      kpToSubject.set(kp.id, subj)
      if (!perSubject.has(subj)) perSubject.set(subj, { total: 0, mastered: 0 })
      perSubject.get(subj)!.total++
    }
  }

  for (const p of userDataStore.progress) {
    if (p.status !== '已掌握') continue
    const subj = kpToSubject.get(p.knowledgePointId)
    if (subj && perSubject.has(subj)) perSubject.get(subj)!.mastered++
  }

  return Array.from(perSubject.entries())
    .map(([subject, s]) => ({
      subject,
      label: labelMap[subject] ?? subject,
      total: s.total,
      mastered: s.mastered,
      rate: s.total > 0 ? Math.round((s.mastered / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
})

/** 高频错题 Top 5 */
const topMistakes = computed(() => {
  const kpMap = new Map<string, string>()
  for (const pkg of packageStore.packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      kpMap.set(kp.id, kp.title)
    }
  }

  const countMap = new Map<string, number>()
  for (const m of userDataStore.mistakes) {
    if (m.mastered) continue
    for (const kpId of m.knowledgePointIds ?? []) {
      countMap.set(kpId, (countMap.get(kpId) ?? 0) + m.wrongCount)
    }
  }

  return Array.from(countMap.entries())
    .map(([kpId, count]) => ({ kpId, title: kpMap.get(kpId) ?? kpId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
})

/** 近 7 天 */
const weekDays = computed(() => {
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const result: Array<{ date: string; label: string; count: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const dateStr = d.toISOString().slice(0, 10)
    const count = userDataStore.progress.filter(
      p => p.lastStudiedAt?.slice(0, 10) === dateStr
    ).length
    result.push({ date: dateStr, label: labels[d.getDay()], count })
  }
  return result
})

const weekTotal = computed(() => weekDays.value.reduce((sum, d) => sum + d.count, 0))

function barHeight(count: number): number {
  const max = Math.max(...weekDays.value.map(d => d.count), 1)
  return Math.max((count / max) * 100, count > 0 ? 10 : 0)
}

function goToImport() {
  router.push('/settings/import')
}
</script>

<style scoped lang="scss">
.parent-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 24px;
}

.page-title {
  .page-title h1,
  h1 {
    font-size: 22px;
    font-weight: 800;
    color: $text-main;
    margin: 0 0 6px;
    letter-spacing: 0.3px;
  }
  .page-sub {
    font-size: 13px;
    color: $text-sub;
    margin: 0;
  }
}

.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
  color: $text-main;
  margin: 0;
  letter-spacing: 0.2px;
}

/* ========== 总览 ========== */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;

  @media (max-width: 1200px) { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
}

.ov-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  padding: 16px 12px;
  text-align: center;
  transition: all 0.15s;
  box-shadow: $shadow-sm;

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
  }

  &.success .ov-value { color: $success-color; }
  &.warning .ov-value { color: $warning-color; }
  &.danger .ov-value { color: $danger-color; }

  .ov-icon {
    font-size: 22px;
    margin-bottom: 8px;
    line-height: 1;
  }
  .ov-value {
    font-size: 26px;
    font-weight: 800;
    color: $text-main;
    line-height: 1;
    letter-spacing: -0.5px;
    margin-bottom: 6px;
  }
  .ov-label {
    font-size: 12px;
    color: $text-sub;
    font-weight: 600;
  }
}

/* ========== 学科分布 ========== */
.subject-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px 20px;
  box-shadow: $shadow-sm;
}

.subject-item {
  .subject-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .subject-name {
      font-size: 14px;
      font-weight: 700;
      color: $text-main;
    }
    .subject-count {
      font-size: 12px;
      color: $text-sub;
      font-weight: 600;
    }
  }

  .subject-bar {
    height: 8px;
    background: $bg-color-hover;
    border-radius: 8px;
    overflow: hidden;

    .subject-bar-fill {
      height: 100%;
      background: $gradient-primary;
      border-radius: 8px;
      transition: width 0.4s;
    }
  }
}

/* ========== 错题 Top ========== */
.top-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 12px 16px;
  box-shadow: $shadow-sm;
}

.top-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 4px;
  border-bottom: 1px dashed $border-light;

  &:last-child { border-bottom: none; }

  .top-rank {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $bg-color-hover;
    color: $text-sub;
    font-weight: 800;
    font-size: 13px;
    flex-shrink: 0;

    &:first-child {
      background: $gradient-warm;
      color: $on-strong;
    }
  }

  .top-info {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;

    .top-title {
      font-size: 14px;
      font-weight: 600;
      color: $text-main;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .top-meta {
      font-size: 12px;
      color: $danger-color;
      font-weight: 700;
      flex-shrink: 0;
    }
  }
}

/* ========== 近 7 天 ========== */
.week-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 20px 24px;
  box-shadow: $shadow-sm;

  .week-chart {
    display: flex;
    justify-content: space-around;
    align-items: flex-end;
    height: 160px;
    padding: 8px 0 20px;

    .day-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      height: 100%;
      justify-content: flex-end;

      .day-bar-wrap {
        width: 50%;
        height: 100px;
        display: flex;
        align-items: flex-end;

        .day-bar {
          width: 100%;
          background: $bg-color-hover;
          border-radius: 6px 6px 0 0;
          transition: height 0.4s;

          &.active {
            background: $gradient-primary;
          }
        }
      }
      .day-count {
        font-size: 11px;
        color: $primary-color;
        font-weight: 700;
        margin-top: 4px;
      }
      .day-label {
        font-size: 11px;
        color: $text-sub;
        margin-top: 4px;
      }
    }
  }

  .week-summary {
    font-size: 13px;
    color: $text-sub;
    text-align: center;
    padding-top: 12px;
    border-top: 1px dashed $border-light;

    b {
      color: $primary-color;
      font-size: 16px;
      margin: 0 3px;
    }
  }
}

/* ========== 学习包管理 ========== */
.pkg-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px 20px;
  box-shadow: $shadow-sm;

  .pkg-info {
    .pkg-title {
      font-size: 15px;
      font-weight: 700;
      color: $text-main;
      margin-bottom: 4px;
    }
    .pkg-desc {
      font-size: 12px;
      color: $text-sub;
    }
  }
}
</style>