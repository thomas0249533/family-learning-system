<template>
  <div class="page-container">
    <n-card class="card">
      <template #header>
        <div class="header-row">
          <span>🔄 今日复习计划</span>
          <span class="due-badge" v-if="dueItems.length > 0">{{ dueItems.length }} 个待复习</span>
        </div>
      </template>

      <div v-if="loading" class="loading">正在加载...</div>

      <template v-else>
        <n-empty v-if="dueItems.length === 0" description="太棒了！今天没有需要复习的知识点 🎉" />

        <div v-else class="review-list">
          <div
            v-for="item in dueItems"
            :key="item.knowledgePointId"
            class="review-item"
            :class="'stage-' + (item.reviewStage ?? 0)"
            @click="goToTopic(item)"
          >
            <div class="item-head">
              <span class="kp-title">{{ item.kpTitle }}</span>
              <span class="stage-tag">{{ stageLabel(item.reviewStage) }}</span>
            </div>
            <div class="item-meta">
              <span>{{ item.subjectLabel }} · {{ item.pkgTitle }}</span>
              <span class="overdue">{{ overdueText(item.nextReviewAt) }}</span>
            </div>
            <div class="item-stats">
              <span>答对 {{ item.correctCount }} · 答错 {{ item.wrongCount }}</span>
              <span v-if="masteryPercent(item) !== null" class="stat-mastery">
                掌握度 {{ masteryPercent(item) }}%
              </span>
              <span v-if="memoryPercent(item) !== null" class="stat-memory">
                {{ memoryStrengthLabel(memoryPercent(item)) }} {{ memoryPercent(item) }}%
              </span>
            </div>
          </div>
        </div>
      </template>
    </n-card>

    <n-card title="📅 未来 7 天复习安排" class="card" v-if="upcomingItems.length > 0">
      <div v-for="day in upcomingDays" :key="day.date" class="upcoming-day">
        <div class="upcoming-date">{{ day.label }}</div>
        <div class="upcoming-chips">
          <n-tag
            v-for="it in day.items"
            :key="it.knowledgePointId"
            size="small"
            type="info"
          >
            {{ it.kpTitle }}
          </n-tag>
        </div>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NEmpty, NTag } from 'naive-ui'
import { db, type ProgressRecord, type LearningPackageRecord } from '@/db'
import { useUserDataStore } from '@core/stores/userData'
import { isDueForReview, humanizeNextReview, memoryStrengthLabel, retrievabilityPercent, stageLabel } from '@core/review/reviewScheduler'
import { findUnitByKnowledgePoint } from '@core/importer/resolvePackageUnits'

interface ReviewItem extends ProgressRecord {
  kpTitle: string
  pkgTitle: string
  subjectLabel: string
  sourcePackageId: string
  unitId: string
  topicId: string
}

const router = useRouter()
const userDataStore = useUserDataStore()

const loading = ref(true)
const dueItems = ref<ReviewItem[]>([])
const upcomingItems = ref<ReviewItem[]>([])

const upcomingDays = computed(() => {
  const map = new Map<string, { date: string; label: string; items: ReviewItem[] }>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const it of upcomingItems.value) {
    if (!it.nextReviewAt) continue
    const d = new Date(it.nextReviewAt)
    d.setHours(0, 0, 0, 0)
    const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
    if (diff < 0 || diff > 7) continue

    const key = d.toISOString().slice(0, 10)
    if (!map.has(key)) {
      const label = diff === 0 ? '今天' : diff === 1 ? '明天' : `${diff} 天后`
      map.set(key, { date: key, label, items: [] })
    }
    map.get(key)!.items.push(it)
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
})

const subjectLabel = (s?: string) =>
  s === 'math' ? '数学' : s === 'chinese' ? '语文' : s === 'english' ? '英语' : s ?? ''

function overdueText(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return humanizeNextReview(iso)
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `逾期 ${days} 天`
  const hours = Math.floor(ms / 3600000)
  if (hours >= 1) return `逾期 ${hours} 小时`
  return '刚刚到期'
}

async function loadReviewItems() {
  loading.value = true

  const packages = await db.packages.toArray()
  const pkgMap = new Map<string, LearningPackageRecord>()
  for (const p of packages) pkgMap.set(p.packageId, p)

  // kp → title 索引
  const kpTitleMap = new Map<string, { title: string; pkgId: string }>()
  for (const p of packages) {
    for (const kp of p.knowledgePoints ?? []) {
      kpTitleMap.set(kp.id, { title: kp.title, pkgId: p.packageId })
    }
  }

  const all = userDataStore.progress
  const due: ReviewItem[] = []
  const upcoming: ReviewItem[] = []

  for (const p of all) {
    const kpInfo = kpTitleMap.get(p.knowledgePointId)
    if (!kpInfo) continue
    const pkg = pkgMap.get(p.packageId)
    if (!pkg) continue

    const found = await findUnitByKnowledgePoint(pkg, p.knowledgePointId)
    if (!found) continue

    const item: ReviewItem = {
      ...p,
      kpTitle: kpInfo.title,
      pkgTitle: pkg.manifest.title,
      subjectLabel: subjectLabel(pkg.manifest.subject),
      sourcePackageId: found.sourcePackageId,
      unitId: found.unitId,
      topicId: found.topicId,
    }

    if (isDueForReview(p)) due.push(item)
    else upcoming.push(item)
  }

  // 逾期最久的排前面
  due.sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''))
  dueItems.value = due
  upcomingItems.value = upcoming
  loading.value = false
}

function goToTopic(item: ReviewItem) {
  router.push(`/learn/${item.sourcePackageId}/unit/${item.unitId}/topic/${item.topicId}`)
}

/** P1 · 掌握度（BKT 概率），没采集到时返回 null 而不是 0 */
function masteryPercent(item: ReviewItem): number | null {
  return typeof item.masteryProbability === 'number'
    ? Math.round(item.masteryProbability * 100)
    : null
}

/** P0 · 记忆强度（FSRS 可提取性），未复习过返回 null */
function memoryPercent(item: ReviewItem): number | null {
  return retrievabilityPercent(item.fsrs ?? null)
}

onMounted(async () => {
  await userDataStore.loadUserData()
  await loadReviewItems()
})
</script>

<style scoped lang="scss">
.page-container { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.card { border-radius: $radius-lg; box-shadow: $shadow-sm; }

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .due-badge {
    font-size: 12px;
    font-weight: 700;
    background: $warning-light;
    color: $warning-color;
    padding: 2px 10px;
    border-radius: 12px;
  }
}

.loading { text-align: center; color: $text-sub; padding: 20px; }

.review-list { display: flex; flex-direction: column; gap: 10px; }

.review-item {
  border-left: 4px solid $primary-color;
  background: $surface-2;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { background: $primary-light; transform: translateX(2px); }

  &.stage-0 { border-left-color: $danger-color; }
  &.stage-1 { border-left-color: $warning-color; }
  &.stage-2 { border-left-color: $warning-color; }
  &.stage-3 { border-left-color: $success-color; }
  &.stage-4, &.stage-5, &.stage-6 { border-left-color: $info-color; }

  .item-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;

    .kp-title {
      font-size: 15px;
      font-weight: 700;
      color: $text-main;
      flex: 1;
    }
    .stage-tag {
      font-size: 11px;
      background: $primary-light;
      color: $primary-color;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 700;
    }
  }

  .item-meta {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: $text-sub;
    margin-bottom: 4px;

    .overdue { color: $danger-color; font-weight: 700; }
  }

  .item-stats {
    font-size: 12px;
    color: $text-sub;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;

    .stat-mastery { color: $primary-color; font-weight: 700; }
    .stat-memory { color: $text-muted; }
  }
}

.upcoming-day {
  padding: 8px 0;
  border-bottom: 1px dashed $border-color;
  &:last-child { border-bottom: none; }

  .upcoming-date {
    font-size: 13px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 6px;
  }
  .upcoming-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
}
</style>