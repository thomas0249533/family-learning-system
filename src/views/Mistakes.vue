<template>
  <div class="mistakes-page">
    <!-- 顶部统计 -->
    <div class="stats-banner">
      <div class="stat-block">
        <div class="stat-num">{{ totalCount }}</div>
        <div class="stat-label">错题总数</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-block">
        <div class="stat-num danger">{{ noneCount }}</div>
        <div class="stat-label">未掌握</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-block">
        <div class="stat-num warning">{{ partialCount }}</div>
        <div class="stat-label">部分掌握</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-block">
        <div class="stat-num success">{{ masteredCount }}</div>
        <div class="stat-label">已掌握</div>
      </div>
      <div class="stats-actions">
        <AppButton size="small" :disabled="totalCount === 0" @click="handleExport">
          📤 导出
        </AppButton>
      </div>
    </div>

    <!-- ✅ 筛选栏 -->
    <div class="filter-bar">
      <!-- 时间筛选 -->
      <div class="filter-group">
        <span class="filter-label">时间：</span>
        <div class="chip-group">
          <button
            v-for="opt in timeOptions"
            :key="opt.value"
            class="chip"
            :class="{ active: timeFilter === opt.value }"
            @click="timeFilter = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- 视图切换 -->
      <div class="filter-group">
        <span class="filter-label">视图：</span>
        <div class="chip-group">
          <button
            v-for="opt in viewOptions"
            :key="opt.value"
            class="chip"
            :class="{ active: viewMode === opt.value }"
            @click="viewMode = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- 搜索 -->
      <div class="filter-group search-group">
        <n-input
          v-model:value="keyword"
          placeholder="🔍 搜索题干 / 答案"
          size="small"
          clearable
        />
      </div>
    </div>

    <EmptyState
      v-if="filteredMistakes.length === 0"
      :description="emptyText"
      class="empty-card"
    />

    <!-- 按知识点视图 -->
    <div v-else-if="viewMode === 'knowledge'" class="group-list">
      <section v-for="group in groupedMistakes" :key="group.kpId" class="kp-group">
        <header class="kp-group-header">
          <div class="kp-group-title-wrap">
            <span class="kp-group-icon">{{ group.kpId === '__uncategorized__' ? '❓' : '📚' }}</span>
            <h2 class="kp-group-title">{{ group.kpTitle }}</h2>
          </div>
          <span class="kp-group-count">{{ group.items.length }} 题</span>
        </header>

        <div class="mistake-cards">
          <div v-for="m in group.items" :key="m.id" class="mistake-card" :class="'ml-' + levelOf(m)">
            <!-- 卡片内容（抽成同一个渲染逻辑） -->
            <div class="mistake-card-head">
            <span class="level-badge" :class="'lb-' + levelOf(m)">{{ levelBadge(m) }}</span>
              <span class="mistake-date">{{ formatDate(m.wrongAt) }}</span>
            </div>
            <h3 class="question-text">{{ m.questionData?.question || '题目数据已过期' }}</h3>

            <div v-if="m.questionData?.options && m.questionData.options.length > 0" class="options-preview">
              <div
                v-for="opt in m.questionData.options"
                :key="opt"
                class="opt-line"
                :class="{
                  'correct-opt': opt.charAt(0) === m.questionData.answer,
                  'wrong-opt': m.lastUserAnswer && opt.charAt(0) === m.lastUserAnswer && m.lastUserAnswer !== m.questionData.answer,
                }"
              >
                {{ opt }}
                <span v-if="m.lastUserAnswer && opt.charAt(0) === m.lastUserAnswer" class="user-mark">
                  ← 你的选择
                </span>
              </div>
            </div>
            <div v-else-if="m.questionData?.type === 'blank'" class="options-preview">
              <div v-if="m.lastUserAnswer" class="wrong-opt">你的答案：{{ m.lastUserAnswer }}</div>
              <div class="correct-opt">正确答案：{{ m.questionData.answer }}</div>
            </div>

            <div v-if="m.questionData?.explanation" class="explanation">
              <span class="explain-label">💡 解析</span>
              <span class="explain-text">{{ m.questionData.explanation }}</span>
            </div>

            <div class="card-actions">
              <span v-if="levelOf(m) === 'partial'" class="partial-hint">
                再答对 {{ remainingToMaster(m) }} 次就彻底掌握了
              </span>
              <AppButton size="small" type="success" ghost @click="markMastered(m.id!)">
                ✅ 我已掌握
              </AppButton>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 按时间 / 按错误次数视图（无分组） -->
    <div v-else class="flat-list">
      <div v-for="m in filteredMistakes" :key="m.id" class="mistake-card" :class="'ml-' + levelOf(m)">
        <div class="mistake-card-head">
          <span class="level-badge" :class="'lb-' + levelOf(m)">{{ levelBadge(m) }}</span>
          <span class="mistake-date">{{ formatDate(m.wrongAt) }}</span>
        </div>
        <h3 class="question-text">{{ m.questionData?.question || '题目数据已过期' }}</h3>

        <div v-if="m.questionData?.options && m.questionData.options.length > 0" class="options-preview">
          <div
            v-for="opt in m.questionData.options"
            :key="opt"
            class="opt-line"
            :class="{
              'correct-opt': opt.charAt(0) === m.questionData.answer,
              'wrong-opt': m.lastUserAnswer && opt.charAt(0) === m.lastUserAnswer && m.lastUserAnswer !== m.questionData.answer,
            }"
          >
            {{ opt }}
            <span v-if="m.lastUserAnswer && opt.charAt(0) === m.lastUserAnswer" class="user-mark">
              ← 你的选择
            </span>
          </div>
        </div>
        <div v-else-if="m.questionData?.type === 'blank'" class="options-preview">
          <div v-if="m.lastUserAnswer" class="wrong-opt">你的答案：{{ m.lastUserAnswer }}</div>
          <div class="correct-opt">正确答案：{{ m.questionData.answer }}</div>
        </div>

        <div v-if="m.questionData?.explanation" class="explanation">
          <span class="explain-label">💡 解析</span>
          <span class="explain-text">{{ m.questionData.explanation }}</span>
        </div>

        <div class="card-actions">
          <span v-if="levelOf(m) === 'partial'" class="partial-hint">
            再答对 {{ remainingToMaster(m) }} 次就彻底掌握了
          </span>
          <AppButton size="small" type="success" ghost @click="markMastered(m.id!)">
            ✅ 我已掌握
          </AppButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput, useMessage } from 'naive-ui'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import { exportMistakes } from '@core/export/exportService'
import {
  MISTAKE_LEVEL_ICON,
  MISTAKE_LEVEL_LABEL,
  MISTAKE_REQUIRED_CORRECT,
  mistakeLevel,
  mistakeReviewCount,
  needsReview,
} from '@core/mistake/mistakeRules'
import type { MistakeMasteryLevel } from '@/db'

const message = useMessage()
const userDataStore = useUserDataStore()
const packageStore = usePackageStore()

type TimeFilter = 'all' | 'today' | 'week' | 'month'
type ViewMode = 'knowledge' | 'time' | 'wrong'

const timeFilter = ref<TimeFilter>('all')
const viewMode = ref<ViewMode>('knowledge')
const keyword = ref('')

const timeOptions = [
  { label: '全部', value: 'all' as TimeFilter },
  { label: '今天', value: 'today' as TimeFilter },
  { label: '本周', value: 'week' as TimeFilter },
  { label: '本月', value: 'month' as TimeFilter },
]
const viewOptions = [
  { label: '按知识点', value: 'knowledge' as ViewMode },
  { label: '按时间', value: 'time' as ViewMode },
  { label: '按错误次数', value: 'wrong' as ViewMode },
]

/** P3 · 三级状态的展示工具 */
function levelOf(m: any): MistakeMasteryLevel {
  return mistakeLevel(m)
}
function levelBadge(m: any): string {
  const lv = levelOf(m)
  return `${MISTAKE_LEVEL_ICON[lv]} ${MISTAKE_LEVEL_LABEL[lv]} · 错 ${m.wrongCount} 次`
}
/** 再答对几次才算掌握 */
function remainingToMaster(m: any): number {
  return Math.max(0, MISTAKE_REQUIRED_CORRECT - mistakeReviewCount(m))
}

const LEVEL_ORDER: Record<MistakeMasteryLevel, number> = { none: 0, partial: 1, mastered: 2 }

/** 待复习 = 未掌握 + 部分掌握（已掌握的不再出现在这里） */
const pendingMistakes = computed(() =>
  userDataStore.mistakes.filter(m => needsReview(levelOf(m)))
)

const totalCount = computed(() => userDataStore.mistakes.length)
const noneCount = computed(() => userDataStore.mistakes.filter(m => levelOf(m) === 'none').length)
const partialCount = computed(() => userDataStore.mistakes.filter(m => levelOf(m) === 'partial').length)
const masteredCount = computed(() => userDataStore.mistakes.filter(m => levelOf(m) === 'mastered').length)

/** ✅ 时间过滤 */
function matchTime(m: any): boolean {
  const now = new Date()
  const wrongAt = new Date(m.wrongAt)

  if (timeFilter.value === 'all') return true
  if (timeFilter.value === 'today') {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return wrongAt >= todayStart
  }
  if (timeFilter.value === 'week') {
    const weekStart = new Date(now.getTime() - 7 * 86400000)
    return wrongAt >= weekStart
  }
  if (timeFilter.value === 'month') {
    const monthStart = new Date(now.getTime() - 30 * 86400000)
    return wrongAt >= monthStart
  }
  return true
}

/** ✅ 关键词过滤 */
function matchKeyword(m: any): boolean {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return true
  const q = String(m.questionData?.question ?? '').toLowerCase()
  const ans = String(m.questionData?.answer ?? '').toLowerCase()
  const ua = String(m.lastUserAnswer ?? '').toLowerCase()
  return q.includes(kw) || ans.includes(kw) || ua.includes(kw)
}

/** ✅ 过滤后的错题（用于"按时间" / "按错误次数"视图） */
const filteredMistakes = computed(() => {
  const list = pendingMistakes.value.filter(m => matchTime(m) && matchKeyword(m))

  // 未掌握永远排在部分掌握前面；组内再按所选维度排序
  return [...list].sort((a, b) => {
    const lv = LEVEL_ORDER[levelOf(a)] - LEVEL_ORDER[levelOf(b)]
    if (lv !== 0) return lv
    if (viewMode.value === 'time') {
      return String(b.wrongAt).localeCompare(String(a.wrongAt))
    }
    if (viewMode.value === 'wrong') {
      return b.wrongCount - a.wrongCount
    }
    return 0
  })
})

/** ✅ 按知识点分组视图 */
const groupedMistakes = computed(() => {
  const kpMap = new Map<string, string>()
  for (const pkg of packageStore.packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      kpMap.set(kp.id, kp.title)
    }
  }

  const groups = new Map<string, { kpId: string; kpTitle: string; items: any[] }>()

  const list = filteredMistakes.value // 已应用时间和关键词过滤
  for (const m of list) {
    const kpIds: string[] = m.knowledgePointIds?.length
      ? m.knowledgePointIds
      : ['__uncategorized__']

    for (const kpId of kpIds) {
      if (!groups.has(kpId)) {
        groups.set(kpId, {
          kpId,
          kpTitle: kpId === '__uncategorized__' ? '未分类错题' : (kpMap.get(kpId) ?? '（未知知识点）'),
          items: [],
        })
      }
      groups.get(kpId)!.items.push(m)
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.kpId === '__uncategorized__') return 1
    if (b.kpId === '__uncategorized__') return -1
    return 0
  })
})

const emptyText = computed(() => {
  if (keyword.value.trim()) return `没有找到与"${keyword.value}"相关的错题`
  if (timeFilter.value !== 'all') return '当前时间段内没有错题'
  return '太棒了！当前没有未掌握的错题 🎉'
})

onMounted(async () => {
  await packageStore.loadPackages()
  await userDataStore.loadUserData()
})

async function markMastered(id: number) {
  await userDataStore.markAsMastered(id)
}

async function handleExport() {
  const count = await exportMistakes()
  if (count === 0) message.warning('没有可导出的错题')
  else message.success(`已导出 ${count} 条错题`)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<style scoped lang="scss">
.mistakes-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 16px;
}

.stats-banner {
  display: flex;
  align-items: center;
  gap: 20px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 20px 24px;
  box-shadow: $shadow-sm;

  @media (max-width: 640px) { flex-wrap: wrap; }

  .stat-block {
    text-align: center;
    min-width: 72px;
    .stat-num {
      font-size: 26px;
      font-weight: 800;
      color: $text-main;
      line-height: 1.1;
      letter-spacing: -0.5px;
      &.danger { color: $danger-color; }
      &.warning { color: $warning-color; }
      &.success { color: $success-color; }
    }
    .stat-label {
      font-size: 12px;
      color: $text-sub;
      margin-top: 6px;
      font-weight: 600;
    }
  }
  .stat-divider {
    width: 1px;
    height: 36px;
    background: $border-light;
    @media (max-width: 640px) { display: none; }
  }
  .stats-actions { margin-left: auto; }
}

/* ✅ 筛选栏 */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 12px 16px;
  box-shadow: $shadow-sm;

  .filter-group {
    display: flex;
    align-items: center;
    gap: 8px;

    .filter-label {
      font-size: 13px;
      color: $text-sub;
      font-weight: 600;
      white-space: nowrap;
    }

    &.search-group {
      flex: 1;
      min-width: 180px;
      margin-left: auto;
    }
  }

  .chip-group {
    display: flex;
    gap: 4px;
    background: $bg-color-hover;
    padding: 3px;
    border-radius: 8px;

    .chip {
      padding: 5px 12px;
      border: none;
      background: transparent;
      color: $text-sub;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.15s;

      &:hover { color: $text-main; }

      &.active {
        background: $card-bg;
        color: $primary-color;
        box-shadow: $shadow-xs;
      }
    }
  }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
    .filter-group { flex-wrap: wrap; }
  }
}

.empty-card {
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 60px 20px;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.kp-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kp-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-left: 4px solid $primary-color;
  border-radius: 10px;

  .kp-group-title-wrap {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .kp-group-icon { font-size: 16px; }
  .kp-group-title {
    font-size: 15px;
    font-weight: 800;
    color: $text-main;
    margin: 0;
  }
  .kp-group-count {
    font-size: 12px;
    font-weight: 700;
    color: $primary-color;
    background: $primary-light;
    padding: 3px 10px;
    border-radius: 20px;
  }
}

.mistake-cards,
.flat-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;

  @media (max-width: 720px) { grid-template-columns: 1fr; }
}

.mistake-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-left: 4px solid $danger-color;
  border-radius: $radius-md;
  padding: 16px 18px;
  box-shadow: $shadow-sm;
  transition: all 0.15s;

  &:hover { box-shadow: $shadow-md; }

  /* P3 · 三级状态用左侧色条区分 */
  &.ml-none { border-left-color: $danger-color; }
  &.ml-partial { border-left-color: $warning-color; }
  &.ml-mastered { border-left-color: $success-color; }

  .mistake-card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;

    .level-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 20px;
      background: rgba(var(--danger-rgb), 0.12);
      color: $danger-color;

      &.lb-partial {
        background: rgba(var(--warning-rgb), 0.14);
        color: $warning-color;
      }
      &.lb-mastered {
        background: rgba(var(--success-rgb), 0.14);
        color: $success-color;
      }
    }
    .mistake-date {
      font-size: 11px;
      color: $text-muted;
    }
  }

  .question-text {
    font-size: 14px;
    font-weight: 700;
    color: $text-main;
    margin: 0 0 10px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .options-preview {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .opt-line {
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 6px;
      background: $bg-color-hover;
      color: $text-sub;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .correct-opt {
      background: rgba(var(--success-rgb), 0.12);
      color: $success-color;
      font-weight: 700;
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 6px;
    }
    .wrong-opt {
      background: rgba(var(--danger-rgb), 0.12);
      color: $danger-color;
      font-weight: 700;
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 6px;
    }
    .user-mark {
      font-size: 11px;
      color: $text-muted;
      font-weight: 500;
    }
  }

  .explanation {
    margin-top: 10px;
    padding: 10px 12px;
    background: $bg-color-hover;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.6;

    .explain-label {
      font-weight: 700;
      color: $text-main;
      margin-right: 6px;
    }
    .explain-text { color: $text-sub; }
  }

  .card-actions {
    margin-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;

    .partial-hint {
      font-size: 11.5px;
      color: $warning-color;
      font-weight: 700;
      line-height: 1.4;
    }
  }
}
</style>