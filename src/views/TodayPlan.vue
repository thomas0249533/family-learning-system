<template>
  <div class="page-container">
    <!-- ===================== 今日进度 ===================== -->
    <AppCard class="head-card">
      <div class="head">
        <div class="ring-wrap">
          <svg class="ring" viewBox="0 0 96 96" role="img" :aria-label="ringLabel">
            <circle class="ring-track" cx="48" cy="48" r="40" />
            <circle
              class="ring-fill"
              cx="48"
              cy="48"
              r="40"
              :style="{ strokeDashoffset: dashOffset }"
            />
          </svg>
          <div class="ring-text">
            <strong>{{ percent }}<span class="ring-unit">%</span></strong>
          </div>
        </div>

        <div class="head-body">
          <div class="head-title">
            {{ headerTitle }}
          </div>
          <div class="head-sub">{{ headerSub }}</div>
          <div class="head-goal">
            <span class="goal-label">每日目标</span>
            <button
              v-for="opt in modeOptions"
              :key="opt.value"
              type="button"
              class="goal-chip"
              :class="{ active: goalMode === opt.value }"
              :aria-pressed="goalMode === opt.value"
              @click="switchMode(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="head-actions">
        <AppButton
          v-if="!loading && progress && !progress.finished && nextItem"
          type="primary"
          size="large"
          block
          @click="startItem(nextItem)"
        >
          {{ progress.doneItems === 0 ? '开始今天的学习' : '继续下一项' }}
        </AppButton>
        <AppButton
          v-else-if="!loading && progress && progress.finished"
          type="success"
          size="large"
          block
          @click="scrollToSummary"
        >
          今天做完了，看总结
        </AppButton>
        <AppButton
          v-else-if="!loading"
          size="large"
          block
          @click="refresh"
        >
          再看看今天有什么
        </AppButton>
      </div>
    </AppCard>

    <!-- ===================== 今日安排 ===================== -->
    <AppCard class="list-card" paddingless>
      <template #header>
        <div class="list-header">
          <span>今天的学习</span>
          <AppBadge v-if="plan" size="sm">
            {{ progress?.doneItems ?? 0 }} / {{ plan.items.length }} 项
          </AppBadge>
        </div>
      </template>

      <div v-if="loading" class="loading">正在安排今天的任务…</div>

      <EmptyState
        v-else-if="!plan || plan.items.length === 0"
        :description="emptyHint"
        class="empty"
      />

      <div v-else class="item-list">
        <button
          v-for="(item, idx) in plan.items"
          :key="item.id"
          type="button"
          class="item"
          :class="[`item--${item.kind}`, { done: isDone(item.id) }]"
          @click="startItem(item)"
        >
          <span class="item-index" aria-hidden="true">{{ isDone(item.id) ? '✓' : idx + 1 }}</span>
          <span class="item-body">
            <span class="item-top">
              <AppBadge :tone="toneOf(item.kind)" size="sm">{{ kindLabel[item.kind] }}</AppBadge>
              <span class="item-title">{{ item.title }}</span>
            </span>
            <span class="item-meta">
              <span class="item-sub">{{ item.subtitle }}</span>
              <span class="item-dot" aria-hidden="true">·</span>
              <span class="item-reason">{{ item.reason }}</span>
            </span>
          </span>
          <span class="item-cost">{{ item.questions }} 题</span>
        </button>
      </div>
    </AppCard>

    <!-- ===================== 结算 ===================== -->
    <AppCard v-if="showSummary && progress" ref="summaryRef" class="summary-card">
      <template #header>
        <div class="list-header">
          <span>今天的总结</span>
          <AppBadge tone="success" size="sm" icon="✅">已完成</AppBadge>
        </div>
      </template>

      <div class="summary-grid">
        <div class="summary-cell">
          <div class="summary-value">{{ progress.doneItems }}<span class="summary-unit">项</span></div>
          <div class="summary-label">完成任务</div>
        </div>
        <div class="summary-cell">
          <div class="summary-value">{{ progress.doneQuestions }}<span class="summary-unit">题</span></div>
          <div class="summary-label">做了题目</div>
        </div>
        <div class="summary-cell">
          <div class="summary-value">{{ progress.totalItems }}<span class="summary-unit">项</span></div>
          <div class="summary-label">今日安排</div>
        </div>
      </div>

      <p class="summary-tip">{{ summaryTip }}</p>

      <div class="summary-actions">
        <AppButton type="primary" block @click="extraRound">再练一组（不占目标）</AppButton>
        <AppButton block @click="goReport">看看这周的报告</AppButton>
      </div>
    </AppCard>

    <!-- ===================== 今天还没有安排 ===================== -->
    <AppCard v-if="!loading && plan && plan.items.length === 0" class="hint-card">
      <p class="hint-text">没有可排的任务，通常是还没导入学习包。</p>
      <AppButton type="primary" @click="goLearn">去导入 / 选学习包</AppButton>
    </AppCard>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// 今日任务（V3.0 · M1）
// ---------------------------------------------------------------------
// 这个页面存在的唯一目的：**让"今天该做什么"只有一个答案**。
//
// 它不做任何编排计算（规则在 `core/plan/dailyPlan.ts`，IO 在
// `dailyPlanService.ts`），只负责三件事：显示队列、跳去答题、结算。
//
// 为什么做完一项要回到这里而不是直接进下一项：
// 孩子需要一个"我推进了"的节拍（进度环动一下）。直接串下去会让 8 项任务
// 变成一条看不见尽头的长题，做到第 3 项就开始逃。多一次点击换一个可见的
// 阶段感，这笔交易划算。
// =====================================================================
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import {
  KIND_LABEL,
  emptyPlanHint,
  nextPendingItem,
  planProgress,
  type DailyPlan,
  type DailyPlanItem,
  type GoalMode,
  type PlanItemKind,
} from '@core/plan/dailyPlan'
import {
  ensureDailyPlan,
  rebuildDailyPlan,
  setGoalMode,
  tomorrowPreview,
  type TomorrowPreview,
} from '@core/plan/dailyPlanService'

const router = useRouter()

const plan = ref<DailyPlan | null>(null)
const loading = ref(true)
const showSummary = ref(false)
const tomorrow = ref<TomorrowPreview | null>(null)
const summaryRef = ref<{ $el?: HTMLElement } | null>(null)

const kindLabel = KIND_LABEL

const modeOptions: Array<{ value: GoalMode; label: string }> = [
  { value: 'questions', label: '按题量' },
  { value: 'minutes', label: '按时长' },
]

const progress = computed(() => (plan.value ? planProgress(plan.value) : null))
const goalMode = computed<GoalMode>(() => plan.value?.goal.mode ?? 'questions')
const nextItem = computed<DailyPlanItem | null>(() =>
  plan.value ? nextPendingItem(plan.value) : null
)
const emptyHint = computed(() => emptyPlanHint(plan.value?.goal ?? { mode: 'questions', questions: 24, minutes: 20 }))

const percent = computed(() => Math.round((progress.value?.ratio ?? 0) * 100))
const ringLabel = computed(() => `今日进度 ${percent.value}%`)
/** 圆周长 2πr（r=40）≈ 251.33；SVG 用 stroke-dashoffset 表示剩余 */
const CIRC = 2 * Math.PI * 40
const dashOffset = computed(() => `${(CIRC * (1 - (progress.value?.ratio ?? 0))).toFixed(1)}`)

const headerTitle = computed(() => {
  const p = progress.value
  if (!p) return '正在安排今天的学习'
  if (p.finished) return '今天的任务全部完成 🎉'
  if (p.doneItems === 0) return `今天有 ${p.totalItems} 项，约 ${plan.value?.totals.minutes ?? 0} 分钟`
  return `还剩 ${p.totalItems - p.doneItems} 项`
})

const headerSub = computed(() => {
  const p = progress.value
  if (!p) return ''
  const goal = plan.value?.goal
  const budget = goal?.mode === 'minutes' ? `${goal.minutes} 分钟` : `${goal?.questions ?? 24} 题`
  return `今日目标 ${budget} · 已完成 ${p.doneQuestions} 题`
})

const summaryTip = computed(() => {
  const t = tomorrow.value
  if (!t) return '明天见 👋'
  const parts: string[] = []
  if (t.dueCards > 0) parts.push(`${t.dueCards} 张卡到期`)
  if (t.newUnits > 0) parts.push(`${t.newUnits} 个新单元可以开始`)
  if (parts.length === 0) return '明天暂时没有到期的内容，自由练习也很棒。'
  return `明天：${parts.join('，')}。`
})

function isDone(id: string): boolean {
  return plan.value?.doneIds.includes(id) ?? false
}

function toneOf(kind: PlanItemKind): 'primary' | 'warning' | 'danger' | 'info' {
  switch (kind) {
    case 'review':
      return 'primary'
    case 'mistake':
      return 'danger'
    case 'weak':
      return 'warning'
    default:
      return 'info'
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await ensureDailyPlan()
    plan.value = res.plan
    if (res.plan.items.length > 0 && res.plan.items.every((it) => res.plan.doneIds.includes(it.id))) {
      showSummary.value = true
      tomorrow.value = await tomorrowPreview()
    }
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  const res = await rebuildDailyPlan()
  plan.value = res.plan
  showSummary.value = false
}

async function switchMode(mode: GoalMode): Promise<void> {
  if (mode === goalMode.value) return
  await setGoalMode(mode)
  const res = await ensureDailyPlan()
  plan.value = res.plan
}

function startItem(item: DailyPlanItem): void {
  if (!item.topicId) {
    // 新学项偶尔没有主题（包的单元只有知识点、题在别处）→ 退到单元页
    void router.push({ path: `/learn/${item.packageId}/unit/${item.unitId}` })
    return
  }
  void router.push({
    path: `/learn/${item.packageId}/unit/${item.unitId}/topic/${item.topicId}`,
    query: {
      mode: 'session',
      session: item.id,
      limit: String(item.questions),
    },
  })
}

async function extraRound(): Promise<void> {
  const res = await rebuildDailyPlan()
  plan.value = res.plan
  showSummary.value = false
}

function scrollToSummary(): void {
  const el = summaryRef.value?.$el
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function goReport(): void {
  void router.push('/report')
}

function goLearn(): void {
  void router.push('/learn')
}

onMounted(load)
</script>

<style scoped lang="scss">
.page-container {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: center;
  gap: 18px;
}

.ring-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  flex-shrink: 0;
}

.ring {
  width: 96px;
  height: 96px;
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--border-color);
  stroke-width: 8;
}

.ring-fill {
  fill: none;
  stroke: var(--primary-color);
  stroke-width: 8;
  stroke-linecap: round;
  stroke-dasharray: 251.3;
  transition: stroke-dashoffset 0.4s ease;
}

.ring-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 800;
  color: $primary-text;

  .ring-unit {
    font-size: 12px;
    font-weight: 700;
    margin-left: 1px;
  }
}

.head-body {
  flex: 1;
  min-width: 0;
}

.head-title {
  font-size: 17px;
  font-weight: 800;
  color: $text-main;
  line-height: 1.35;
}

.head-sub {
  margin-top: 4px;
  font-size: 13px;
  color: $text-sub;
}

.head-goal {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;

  .goal-label {
    font-size: 12px;
    color: $text-muted;
  }
}

.goal-chip {
  border: 1px solid var(--border-color);
  background: transparent;
  color: $text-sub;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;

  &.active {
    border-color: var(--primary-color);
    color: $primary-text;
    background: $primary-light;
  }
}

.head-actions {
  display: flex;
  gap: 10px;
}

.list-card :deep(.n-card__content) {
  padding: 0;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-weight: 800;
}

.loading {
  padding: 28px 16px;
  text-align: center;
  color: $text-sub;
  font-size: 14px;
}

.empty {
  padding: 28px 16px;
}

.item-list {
  display: flex;
  flex-direction: column;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: $bg-color-hover;
  }

  &.done {
    opacity: 0.55;

    .item-title {
      text-decoration: line-through;
    }
  }
}

.item-index {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 50%;
  background: $primary-light;
  color: $primary-text;
  font-size: 13px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item--mistake .item-index {
  background: var(--danger-light);
  color: $danger-text;
}

.item--weak .item-index {
  background: $warning-light;
  color: $warning-text;
}

.item--new .item-index {
  background: var(--info-light);
  color: $info-text;
}

.item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.item-title {
  font-size: 15px;
  font-weight: 700;
  color: $text-main;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: $text-sub;
  min-width: 0;
}

.item-sub,
.item-reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-reason {
  color: $primary-text;
  font-weight: 700;
}

.item-cost {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: $text-muted;
}

.summary-grid {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}

.summary-cell {
  flex: 1;
  text-align: center;
  background: $surface-2;
  border-radius: $radius-md;
  padding: 12px 8px;
}

.summary-value {
  font-size: 24px;
  font-weight: 800;
  color: $primary-text;

  .summary-unit {
    font-size: 12px;
    font-weight: 700;
    margin-left: 2px;
    color: $text-sub;
  }
}

.summary-label {
  margin-top: 2px;
  font-size: 12px;
  color: $text-sub;
}

.summary-tip {
  margin: 0 0 14px;
  font-size: 13px;
  color: $text-sub;
  line-height: $leading-normal;
}

.summary-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hint-card {
  text-align: center;
}

.hint-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: $text-sub;
}
</style>
