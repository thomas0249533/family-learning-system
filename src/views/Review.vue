<template>
  <div class="page-container">
    <AppCard class="card">
      <template #header>
        <div class="header-row">
          <span>🔄 今日复习计划</span>
          <span class="due-badge" v-if="dueItems.length > 0">{{ dueItems.length }} 个待复习</span>
        </div>
      </template>

      <div v-if="loading" class="loading">正在加载...</div>

      <div v-else-if="droppedCount > 0" class="dropped-hint">
        有 {{ droppedCount }} 条学习记录无法定位到单元（对应学习包可能已删除或重新导入）
      </div>
      <template v-if="!loading">

        <n-empty v-if="dueItems.length === 0" description="太棒了！今天没有需要复习的知识点 🎉" />

        <div v-else class="review-list">
          <div
            v-for="item in dueItems"
            :key="item.knowledgePointId"
            class="review-item"
            :class="'stage-' + (item.reviewStage ?? 0)"
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
            <!-- V2.4 · 任务1 · 双通道：有错题→去攻克；无错题→虚拟「已复习」 -->
            <div class="item-actions">
              <button
                v-if="hasPendingMistakes(item.knowledgePointId)"
                class="review-btn review-btn--attack"
                type="button"
                @click="attackMistakes(item)"
              >
                🎯 去攻克错题
              </button>
              <button
                v-else
                class="review-btn review-btn--done"
                type="button"
                @click="markReviewed(item)"
              >
                ✅ 标记已复习
              </button>
            </div>
          </div>
        </div>
      </template>
    </AppCard>

    <AppCard title="📅 未来 7 天复习安排" class="card" v-if="upcomingItems.length > 0">
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
    </AppCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NEmpty, NTag, useMessage } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import { db, type ProgressRecord, type LearningPackageRecord } from '@/db'
import { useUserDataStore } from '@core/stores/userData'
import { isDueForReview, humanizeNextReview, memoryStrengthLabel, retrievabilityPercent, stageLabel } from '@core/review/reviewScheduler'
import { findUnitByKnowledgePoint } from '@core/importer/resolvePackageUnits'
import { stripPrefix } from '@core/progress/ownerIndex'
import { localDayKey } from '@core/motivation/streak'
import { needsReview, mistakeLevel } from '@core/mistake/mistakeRules'

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
const message = useMessage()

/** V2.4 · 任务1 · 每个 KP 是否有"待复习"的错题（未掌握/部分掌握）。用于双通道判定。 */
const kpWithPendingMistakes = computed(() => {
  const set = new Set<string>()
  for (const m of userDataStore.mistakes) {
    if (needsReview(mistakeLevel(m))) {
      for (const kpId of m.knowledgePointIds ?? []) set.add(kpId)
    }
  }
  return set
})
function hasPendingMistakes(kpId: string): boolean {
  return kpWithPendingMistakes.value.has(kpId)
}

/** 通道 A：跳到错题本，按知识点深链过滤（Mistakes.vue 读 ?kp= 参数） */
function attackMistakes(item: ReviewItem) {
  router.push({ path: '/mistakes', query: { kp: item.knowledgePointId } })
}

/** 通道 B：虚拟「已复习」（无做题数据，只推进 FSRS）。见 userData.markReviewedVirtual。 */
async function markReviewed(item: ReviewItem) {
  await userDataStore.markReviewedVirtual(item.sourcePackageId, item.knowledgePointId)
  message.success('已标记为复习！知识点的熟练度将在下次练习中更新。')
  await loadReviewItems()
}

const loading = ref(true)
const dueItems = ref<ReviewItem[]>([])
const upcomingItems = ref<ReviewItem[]>([])
/** 无法定位到单元的进度行数（V1.3 · E-01 · D3：**不许静默丢**，要显示出来） */
const droppedCount = ref(0)

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

    // 分组键用本地日：分组本身按 `diff`（本地时间差）算标签，键必须同口径，
    // 否则 UTC 日键会让 key 与 label 差一天（旧实现用 toISOString）。
    const key = localDayKey(d)
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

  // kp 标题索引：键 = `(packageId, kpId)` 二元组，与 progress 口径一致（V1.3 · E-01 · D3）。
  // 旧的裸 kpId 索引在多包共用同 id 时「后者覆盖前者」→ 标题与学科都会串到别的包上。
  // 分隔符用 `\u0000`（与 `ownerIndex.KEY_SEP` 相同）：kpId 自身含 `::`，空格也可能出现在标题里。
  const kpTitleMap = new Map<string, { title: string; pkgId: string }>()
  for (const p of packages) {
    for (const kp of p.knowledgePoints ?? []) {
      kpTitleMap.set(`${p.packageId}\u0000${kp.id}`, { title: kp.title, pkgId: p.packageId })
    }
  }

  // 兜底：短 id 且**全库唯一**时才用（歧义即删，绝不猜）。
  // 历史行可能只写了短 id（老版本 strip 过前缀），这条路径把它们救回来。
  const kpTitleByShort = new Map<string, { title: string; pkgId: string }>()
  {
    const seen = new Map<string, number>()
    for (const p of packages) {
      for (const kp of p.knowledgePoints ?? []) {
        const short = stripPrefix(kp.id)
        seen.set(short, (seen.get(short) ?? 0) + 1)
        kpTitleByShort.set(short, { title: kp.title, pkgId: p.packageId })
      }
    }
    for (const [short, n] of seen) if (n > 1) kpTitleByShort.delete(short)
  }

  const all = userDataStore.progress
  const due: ReviewItem[] = []
  const upcoming: ReviewItem[] = []
  let dropped = 0

  for (const p of all) {
    const kpInfo =
      kpTitleMap.get(`${p.packageId}\u0000${p.knowledgePointId}`) ??
      kpTitleByShort.get(stripPrefix(p.knowledgePointId))
    // 学科 / 包标题取自**声明了这个知识点的包**（归属包），不是进度行上的入口包
    const pkg = kpInfo ? pkgMap.get(kpInfo.pkgId) ?? pkgMap.get(p.packageId) : pkgMap.get(p.packageId)
    if (!kpInfo || !pkg) {
      dropped++
      continue
    }

    const found = await findUnitByKnowledgePoint(pkg, p.knowledgePointId)
    if (!found) {
      dropped++
      continue
    }

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
  // 同格式（UTC 全时刻）下字典序 = 时间序，逾期最久的排前面。
  // 依赖写入口格式契约：见 tests/review-time-contract.test.ts。
  due.sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''))
  dueItems.value = due
  upcomingItems.value = upcoming
  droppedCount.value = dropped
  loading.value = false
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
/* `.card` 的圆角/阴影已由 AppCard 基元统一提供（radius-lg + shadow-sm），故移除重复声明。 */

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .due-badge {
    font-size: 12px;
    font-weight: 700;
    background: $warning-light;
    color: $warning-text;
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
      color: $primary-text;
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

    .overdue { color: $danger-text; font-weight: 700; }
  }

  .item-stats {
    font-size: 12px;
    color: $text-sub;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;

    .stat-mastery { color: $primary-text; font-weight: 700; }
    .stat-memory { color: $text-muted; }
  }

  .item-actions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }

  .review-btn {
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    border: 1.5px solid transparent;
    transition: all 0.15s;

    &--attack {
      background: $primary-light;
      color: $primary-text;
      border-color: $primary-color;
      &:hover { background: $primary-color; color: var(--text-on-primary); }
    }
    &--done {
      background: $bg-color-hover;
      color: $text-sub;
      border-color: $border-color;
      &:hover { color: $text-main; border-color: $text-sub; }
    }
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