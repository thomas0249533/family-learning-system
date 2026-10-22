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
        <!-- E3 · 一键生成练习卷（E2 引擎入口）。已有临时包时先确认覆盖；
             错题本为空时禁用（与导出同一道判空闸）。 -->
        <AppButton
          size="small"
          type="primary"
          :loading="generating"
          :disabled="generating || totalCount === 0"
          @click="handleGenerate"
        >
          🎯 一键生成练习卷
        </AppButton>
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
            <div v-if="pkgLabel(m)" class="mistake-pkg" :title="pkgLabel(m)">📦 {{ pkgLabel(m) }}</div>
            <!-- C1 · 错因归因（手动打标）。4 个原生 radio。
                 name 必须按**渲染实例**唯一（group.kpId + m.id）：同一道错题会按
                 knowledgePointIds 被 push 进多个分组，而 radio 的 name 在整份文档内
                 唯一即同组 —— 只按 mistake 命名会让多个分组的实例共用一个 radio 组，
                 键盘方向键会跨分组跳焦点。点已选中项 = 取消打标（见 onCauseClick）。 -->
            <div class="mistake-cause" role="radiogroup" aria-label="错题原因">
              <span class="cause-title">错因</span>
              <label
                v-for="c in MISTAKE_CAUSE_ORDER"
                :key="c"
                class="cause-opt"
                :class="{ on: m.mistakeCause === c }"
              >
                <input
                  type="radio"
                  :name="'cause-' + group.kpId + '-' + m.id"
                  :checked="m.mistakeCause === c"
                  @change="onCauseChange(m, c)"
                  @click="onCauseClick(m, c)"
                />
                <span>{{ MISTAKE_CAUSE_LABELS[c] }}</span>
              </label>
              <span v-if="!m.mistakeCause" class="cause-unset">{{ mistakeCauseLabelOf(m) }}</span>
            </div>
            <QuestionText class="question-text" :text="m.questionData?.question || '题目数据已过期'" />

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
              <div class="card-actions-btns">
                <AppButton
                  size="small"
                  :loading="hintingId === m.id"
                  :disabled="hintLoading && hintingId !== m.id"
                  @click="handleHint(m)"
                >
                  💡 启发一下
                </AppButton>
                <AppButton size="small" type="success" ghost @click="markMastered(m.id!)">
                  ✅ 我已掌握
                </AppButton>
              </div>
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
        <div v-if="pkgLabel(m)" class="mistake-pkg" :title="pkgLabel(m)">📦 {{ pkgLabel(m) }}</div>
        <!-- C1 · 错因归因（手动打标）。与知识点视图同源；本视图每道题只渲染一次，
             name 按 mistake 即可（且与分组视图的 name 生成式不同，不会互串）。 -->
        <div class="mistake-cause" role="radiogroup" aria-label="错题原因">
          <span class="cause-title">错因</span>
          <label
            v-for="c in MISTAKE_CAUSE_ORDER"
            :key="c"
            class="cause-opt"
            :class="{ on: m.mistakeCause === c }"
          >
            <input
              type="radio"
              :name="'cause-' + m.id"
              :checked="m.mistakeCause === c"
              @change="onCauseChange(m, c)"
              @click="onCauseClick(m, c)"
            />
            <span>{{ MISTAKE_CAUSE_LABELS[c] }}</span>
          </label>
          <span v-if="!m.mistakeCause" class="cause-unset">{{ mistakeCauseLabelOf(m) }}</span>
        </div>
        <QuestionText class="question-text" :text="m.questionData?.question || '题目数据已过期'" />

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
          <div class="card-actions-btns">
            <AppButton
              size="small"
              :loading="hintingId === m.id"
              :disabled="hintLoading && hintingId !== m.id"
              @click="handleHint(m)"
            >
              💡 启发一下
            </AppButton>
            <AppButton size="small" type="success" ghost @click="markMastered(m.id!)">
              ✅ 我已掌握
            </AppButton>
          </div>
        </div>
      </div>
    </div>

    <!-- F1 · AI 启发式讲评抽屉。
         `n-drawer` + `n-drawer-content`（naive-ui 自带，仓库此前没有抽屉用法可抄，
         故按 naive 官方范式写：v-model:show 控制开关，closable 交给组件）。
         关闭即中断（见 watch(hintOpen)）—— 抽屉被关掉后还在往里吐字是明显的 bug。 -->
    <n-drawer v-model:show="hintOpen" :width="440" placement="right">
      <n-drawer-content title="💡 启发一下" closable>
        <div class="ai-hint">
          <div class="ai-hint-question">{{ hintQuestion || '题目数据已过期' }}</div>

          <div v-if="hintEngine" class="ai-hint-engine">
            来自：{{ AI_ENGINE_LABEL[hintEngine] }}
          </div>

          <!-- 降级提示：三级失败各有一句不同的人话（不是统一的"出错了"） -->
          <div v-if="hintNotice" class="ai-hint-notice">{{ hintNotice }}</div>

          <div class="ai-hint-text">
            <span v-if="!hintText && hintLoading" class="ai-hint-placeholder">正在想怎么提示你…</span>
            <span v-else>{{ hintText }}</span>
            <span v-if="hintLoading" class="ai-hint-caret" aria-hidden="true"></span>
          </div>

          <div class="ai-hint-foot">
            <span class="ai-hint-tip">启发只给思路，不给答案——看懂了就回卡片上再做一遍。</span>
            <AppButton v-if="hintLoading" size="small" type="error" ghost @click="stopHint">
              ⏹ 停止
            </AppButton>
            <AppButton v-else size="small" @click="hintOpen = false">关闭</AppButton>
          </div>
        </div>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NInput, NDrawer, NDrawerContent, useDialog, useMessage } from 'naive-ui'
import AppButton from '@/components/ui/AppButton.vue'
import QuestionText from '@/components/QuestionText.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import { exportMistakes } from '@core/export/exportService'
import { WEAKPOINTS_PACKAGE_ID } from '@core/weakpoints/weakpointsEngine'
import { generateWeakpointsPackage, weakpointsPackageExists } from '@core/weakpoints/generateWeakpoints'
import {
  MISTAKE_LEVEL_ICON,
  MISTAKE_LEVEL_LABEL,
  MISTAKE_REQUIRED_CORRECT,
  mistakeLevel,
  mistakeReviewCount,
  needsReview,
} from '@core/mistake/mistakeRules'
import {
  MISTAKE_CAUSE_LABELS,
  MISTAKE_CAUSE_ORDER,
  mistakeCauseLabelOf,
  mistakeCauseOf,
  type MistakeCause,
} from '@core/mistake/mistakeCause'
import { AI_ENGINE_LABEL, describeAiFailure, describeDegradation, type AiEngine } from '@core/ai/aiMessages'
import { AiHintError, requestAiHint } from '@core/ai/aiClient'
import { currentApiKey, hasRememberedKey, loadAiConfig } from '@core/ai/aiConfig'
import type { MistakeMasteryLevel } from '@/db'

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
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

/**
 * 包元数据 + 知识点 → 归属包（与 Review.vue 同源口径：`knowledgePoints` 里
 * **声明**了这个 kpId 的包）。多个包声明同一个 kpId 时保留全部候选，
 * 由 `pkgLabel` 按"唯一才用"裁决 —— 与写入端的零 tie-break 是同一条纪律。
 */
const pkgMeta = computed(() => {
  // F1：顺带带出 grade —— AI 讲评要知道"这是几年级的题"才能说对口的话
  const byId = new Map<string, { title: string; subject?: string; grade?: number }>()
  const kpOwners = new Map<string, string[]>()
  for (const pkg of packageStore.packages) {
    byId.set(pkg.packageId, {
      title: pkg.manifest?.title ?? '',
      subject: pkg.manifest?.subject,
      grade: pkg.manifest?.grade,
    })
    for (const kp of pkg.knowledgePoints ?? []) {
      const list = kpOwners.get(kp.id) ?? []
      if (!list.includes(pkg.packageId)) list.push(pkg.packageId)
      kpOwners.set(kp.id, list)
    }
  }
  return { byId, kpOwners }
})

const subjectLabel = (s?: string) =>
  s === 'math' ? '数学' : s === 'chinese' ? '语文' : s === 'english' ? '英语' : s ?? ''

/**
 * 卡片上的「学科 · 归属包标题」（V1.6 · A4）。
 *
 * 优先用行上的 `packageId` —— A4 起它就是归属包（写入端已归一化），
 * 老行则是入口包；那个包已经被删掉时，按第一个知识点反查归属包
 * （与 Review.vue 同源）。两者都找不到 → 空串，由模板 `v-if` 掉：
 * **绝不显示裸 packageId**，那对家长没有任何意义。
 */
function pkgLabel(m: any): string {
  const meta = pkgMeta.value
  const direct = meta.byId.get(m.packageId)
  if (direct?.title) return `${subjectLabel(direct.subject)} · ${direct.title}`
  const kpId = m.knowledgePointIds?.[0]
  const owners = kpId ? meta.kpOwners.get(kpId) ?? [] : []
  if (owners.length === 1) {
    const viaOwner = meta.byId.get(owners[0])
    if (viaOwner?.title) return `${subjectLabel(viaOwner.subject)} · ${viaOwner.title}`
  }
  return ''
}

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

/* ===========================================================================
 * F1 · 错题 AI 启发式讲评（「💡 启发一下」→ 抽屉 + 打字机流式）
 * ---------------------------------------------------------------------------
 * 三条纪律：
 *   1. **只发当前这一道题**（`buildHintPrompt` 的入参就是这个边界：没有档案、
 *      没有姓名、没有其它题目），题干是外部内容，进 Prompt 前先消毒。
 *   2. **三级降级必须有不同的人话**：`describeDegradation` 只报最后一级的原因，
 *      但三级（云端 / 本地 / 静态）在 UI 上要显示"这条提示是谁给的"。
 *   3. **可中断**：抽屉关掉或点「停止」→ `AbortController.abort()`；
 *      中断**不降级**（用户自己按的停止，给他一段静态解析属于答非所问）。
 *
 * 打字机为什么是"队列 + 定时吐字"而不是直接拼：流式 chunk 常常一口气来十几个字，
 * 直接拼出来观感是"卡一下然后蹦一段"。把增量压进队列、按固定节奏吐字，
 * 才像有人在写字 —— 这也是 e2e 能断言"文字在增长"的前提。
 * ======================================================================== */

/** 打字机：每 tick 吐出的字数与间隔 */
const TYPEWRITER_CHARS_PER_TICK = 2
const TYPEWRITER_INTERVAL_MS = 24

const hintOpen = ref(false)
const hintLoading = ref(false)
/** 正在请求的那张卡（同一时刻只允许一个讲评在跑） */
const hintingId = ref<number | null>(null)
const hintText = ref('')
const hintQuestion = ref('')
const hintEngine = ref<AiEngine | null>(null)
const hintNotice = ref('')

let hintAbort: AbortController | null = null
let hintQueue = ''
let hintTimer: ReturnType<typeof setInterval> | null = null

function startTypewriter(): void {
  if (hintTimer !== null) return
  hintTimer = setInterval(() => {
    if (!hintQueue) return
    hintText.value += hintQueue.slice(0, TYPEWRITER_CHARS_PER_TICK)
    hintQueue = hintQueue.slice(TYPEWRITER_CHARS_PER_TICK)
  }, TYPEWRITER_INTERVAL_MS)
}

/** flush=true 时把队列里剩下的字一次补完（正常结束要补齐，被中断则不必） */
function stopTypewriter(flush: boolean): void {
  if (hintTimer !== null) {
    clearInterval(hintTimer)
    hintTimer = null
  }
  if (flush && hintQueue) {
    hintText.value += hintQueue
    hintQueue = ''
  }
}

/** 学科 / 年级：只从归属包上取，取不到就不传（不猜） */
function aiSubjectOf(m: any): string | undefined {
  return pkgMeta.value.byId.get(m.packageId)?.subject
}
function aiGradeOf(m: any): number | undefined {
  return pkgMeta.value.byId.get(m.packageId)?.grade
}

async function handleHint(m: any): Promise<void> {
  if (hintLoading.value) return
  hintingId.value = typeof m.id === 'number' ? m.id : null
  hintText.value = ''
  hintQueue = ''
  hintNotice.value = ''
  hintEngine.value = null
  hintQuestion.value = String(m.questionData?.question ?? '')
  hintOpen.value = true
  hintLoading.value = true
  hintAbort = new AbortController()
  startTypewriter()

  let aborted = false
  try {
    const cfg = await loadAiConfig()
    const out = await requestAiHint(
      {
        prompt: {
          question: hintQuestion.value,
          correctAnswer: String(m.questionData?.answer ?? ''),
          userAnswer: String(m.lastUserAnswer ?? ''),
          // 未打标按 knowledge 兜底（逻辑层口径，见 mistakeCause.ts）
          cause: mistakeCauseOf(m),
          subject: aiSubjectOf(m),
          grade: aiGradeOf(m),
          explanation: String(m.questionData?.explanation ?? ''),
        },
        apiKey: currentApiKey(),
        model: cfg.model,
        ollamaModel: cfg.ollamaModel,
      },
      {
        signal: hintAbort.signal,
        onDelta: (delta) => {
          hintQueue += delta
        },
      },
    )
    hintEngine.value = out.engine
    if (out.engine === 'static') {
      // 三级全失败：云端 / 本地模型都没用上，落到题库自带解析。
      // 给一句人话而不是干巴巴的"解析"，家长才知道"AI 这一档为什么没生效"。
      hintNotice.value = 'AI 助手正在休息，我们来看看这道题原本的解析：'
    } else {
      hintNotice.value = describeDegradation(out.failures)
      // 没填 Key 但本机存过：给一条"去哪儿解锁"的指引（比干说没配 Key 有用）
      if (out.failures.some((f) => f.reason === 'no-key') && hasRememberedKey(cfg)) {
        hintNotice.value += '（本机保存过一个 Key，到「设置 → 🤖 AI 助手设置」用家长口令解锁后就能用）'
      }
    }
  } catch (e) {
    aborted = e instanceof AiHintError && e.code === 'aborted'
    hintNotice.value = describeAiFailure(e instanceof AiHintError ? e.code : 'network')
  } finally {
    hintLoading.value = false
    hintingId.value = null
    // 被中断时不补齐队列：用户按的是"停止"，把剩下的字补完等于没停
    stopTypewriter(!aborted)
    hintAbort = null
  }
}

/** 手动停止：中断不降级，UI 只提示"已停止" */
function stopHint(): void {
  hintAbort?.abort()
}

// 抽屉关掉 = 放弃这次讲评：中断请求、停掉打字机
watch(hintOpen, (open) => {
  if (!open) stopHint()
})

/**
 * C1 · 错因归因。只需要这两个字段 —— 两处卡片布局的 `m` 分别是 any（分组视图）
 * 与 MistakeRecord（平铺视图），结构化参数对两者都成立。
 */
type CauseRow = { exerciseId: string; mistakeCause?: MistakeCause }

/**
 * 选中（或键盘方向键切到）某个归因 → 打标。
 * 鼠标点击与键盘选择都会触发原生 `change`，所以"改成新的"走这里。
 */
function onCauseChange(m: CauseRow, cause: MistakeCause) {
  void userDataStore.setMistakeCause(m.exerciseId, cause)
}

/**
 * 点**已选中**的项 = 取消打标（给误点的人一条退路）。
 * 原生 radio 重复点击不会触发 `change`，取消语义只能挂在 `click` 上；
 * 未选中项的点击会先走 `onCauseChange` 打标，那时 `mistakeCause` 还是旧值，
 * 这里 `!==` 直接返回，不会把刚打的标又擦掉。
 */
function onCauseClick(m: CauseRow, cause: MistakeCause) {
  if (m.mistakeCause !== cause) return
  void userDataStore.setMistakeCause(m.exerciseId, null)
}

async function handleExport() {
  const count = await exportMistakes()
  if (count === 0) message.warning('没有可导出的错题')
  else message.success(`已导出 ${count} 条错题`)
}

/* ===========================================================================
 * E3 · 一键生成练习卷（E2 智能错题重组引擎的 UI 入口）
 * ---------------------------------------------------------------------------
 * 顺序即安全边界（调换顺序会出事故）：
 *   1. `generating` 闸 + 按钮 loading/disabled 双保险防连点；
 *   2. 已有临时包 → **先确认再覆盖**（包 id 稳定，再次生成 = 覆盖同一个
 *      `special-weakpoints-auto`；孩子/家长要明确知道旧卷被换掉了）；
 *   3. 引擎不成卷（`generated: false`）→ 只说原因，**旧包不被覆盖**
 *      （不拿空卷覆盖旧卷，旧卷的题目仍然是有效练习材料）；
 *   4. 成卷 → 刷新包列表与错题本 → 跳进试卷。
 *
 * 入参纪律：**不下传错题筛选**。本页的时间/关键词过滤只是查看视角，
 * 传给引擎会让它按过滤后的子集算配额与主导学科（题量、学科分布全错）；
 * 引擎自读全量 pool 才是对的。真要限学科只能传 `opts.subject`（引擎口径）。
 *
 * 为什么必须 `loadPackages()`：引擎绕过 store 直接 `db.packages.put`，
 * store 内存里的 `packages` 不会自己更新。为什么必须 `loadUserData()`：
 * 归属回流会改 mistakes 行的归属包信息，卡片上的「学科 · 归属包标题」要刷新。
 * ======================================================================== */

/** 生成中（防连点 + 按钮 loading） */
const generating = ref(false)

/** 引擎"没成卷"的两句人话（`generated: false` 时旧包不动） */
const WEAKPOINTS_REASON_TEXT: Record<'no-mistakes' | 'no-weakness', string> = {
  'no-mistakes': '错题本是空的，先去练习吧',
  'no-weakness': '暂无可重组的弱项（已掌握的错题不会进卷）',
}

async function handleGenerate() {
  if (generating.value) return
  generating.value = true
  try {
    // 覆盖确认：临时包 id 稳定，再次生成就是覆盖同一个 special-weakpoints-auto
    if (await weakpointsPackageExists()) {
      const ok = await confirmRegenerate()
      if (!ok) return
    }

    const result = await generateWeakpointsPackage()
    if (!result.generated) {
      message.warning(WEAKPOINTS_REASON_TEXT[result.reason ?? 'no-weakness'])
      return
    }

    message.success(`已生成练习卷：${result.questionCount} 题`)
    if (result.skippedCount > 0) {
      // 归属解析失败（KP 无唯一 owner / 源包已删）的行永不入卷 —— 宁少一题，
      // 不要一张会把进度写错地方的卷。跳过几条要说出来，不能静默。
      message.warning(`有 ${result.skippedCount} 道错题因缺少归属信息未卷入`)
    }

    await packageStore.loadPackages()
    await userDataStore.loadUserData()
    // examMode 包进 UnitList 直接渲染 ExamPanel，无需单元导航
    router.push(`/learn/${WEAKPOINTS_PACKAGE_ID}`)
  } catch (e) {
    message.error('生成失败：' + (e as Error).message)
  } finally {
    generating.value = false
  }
}

/**
 * 覆盖确认（照 Parent.vue 档案删除的 naive-ui dialog 范式，不自创）。
 *
 * 取消 / Esc / 点遮罩关闭全部按"不生成"处理 —— 覆盖是不可逆的 UI 动作，
 * 任何关闭路径都必须是保守的那一个。
 */
function confirmRegenerate(): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.warning({
      title: '重新生成练习卷？',
      content: '将重新生成练习卷（覆盖旧卷），按错题本的最新状态重新选题。已获得的掌握进度不受影响。',
      positiveText: '重新生成',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
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
      &.danger { color: $danger-text; }
      &.warning { color: $warning-text; }
      &.success { color: $success-text; }
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
  .stats-actions {
    margin-left: auto;
    display: flex;
    gap: $space-2;
    /* 窄屏与统计数字一起换行时，按钮组不再贴着右边缘 */
    @media (max-width: 640px) { margin-left: 0; }
  }
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
        color: $primary-text;
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
    color: $primary-text;
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
      background: var(--badge-danger-bg);
      color: $danger-text;

      &.lb-partial {
        background: var(--badge-warning-bg);
        color: $warning-text;
      }
      &.lb-mastered {
        background: var(--badge-success-bg);
        color: $success-text;
      }
    }
    .mistake-date {
      font-size: 11px;
      color: $text-muted;
    }
  }

  /* V1.6 · A4 · 「学科 · 归属包标题」。放在卡片头与题干之间：
     家长一眼能看出这道错题属于哪本书，专项包删掉之后也不会变成悬空行。*/
  .mistake-pkg {
    font-size: 12px;
    color: $text-sub;
    margin: -2px 0 10px;
    /* V1.6 · 方案对齐：归属包标题可能很长（跨包 + 长标题）。
       单行截断加省略号，不折行把卡片撑高 —— 与 V1.5"组件极简，
       不引入多余配置"同一条思路；全名走原生 title 提示，不加浮层组件。 */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* C1 · 错因归因（手动打标）。窄列里 4 个选项必须能换行不溢出。
     焦点环走 components.scss 的全局 :focus-visible，不在这里重复写 outline。 */
  .mistake-cause {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: $space-1 $space-2;
    margin: 0 0 $space-2;

    .cause-title {
      font-size: 12px;
      font-weight: 600;
      color: $text-sub;
    }
    .cause-opt {
      display: inline-flex;
      align-items: center;
      gap: $space-1;
      font-size: 12px;
      color: $text-sub;
      cursor: pointer;
      padding: 2px $space-2;
      border-radius: $radius-xs;
      background: $bg-color-hover;

      /* 选中态要可见：文字转主色 + 加粗（radio 自身的勾选态之外的第二重提示） */
      &.on {
        color: $primary-text;
        font-weight: 700;
      }
    }
    .cause-unset {
      font-size: $font-2xs;
      color: $text-muted;
    }
  }

  .question-text {
    font-size: 14px;
    font-weight: 700;
    color: $text-main;
    margin: 0 0 10px;
    line-height: 1.5;
    /* 换行已由 <QuestionText> 转成 <br>，这里再加 pre-wrap 会变成双倍行距 */
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
      background: var(--badge-success-bg);
      color: $success-text;
      font-weight: 700;
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 6px;
    }
    .wrong-opt {
      background: var(--badge-danger-bg);
      color: $danger-text;
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
      color: $warning-text;
      font-weight: 700;
      line-height: 1.4;
    }

    /* F1 · 「💡 启发一下」+「我已掌握」并排。窄卡片里按钮组自己换行，
       不让两个按钮把提示文字挤掉。 */
    .card-actions-btns {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: $space-2;
      margin-left: auto;
    }
  }
}

/* F1 · AI 启发抽屉。全部走 token，不写死颜色（stylelint color-no-hex）。 */
.ai-hint {
  display: flex;
  flex-direction: column;
  gap: $space-3;

  .ai-hint-question {
    font-size: 14px;
    font-weight: 700;
    color: $text-main;
    line-height: 1.6;
    padding-bottom: $space-2;
    border-bottom: 1px dashed $border-color;
  }

  .ai-hint-engine {
    align-self: flex-start;
    font-size: $font-2xs;
    font-weight: 700;
    color: $primary-text;
    background: $primary-light;
    padding: 3px 10px;
    border-radius: $radius-full;
  }

  .ai-hint-notice {
    font-size: $font-xs;
    line-height: 1.6;
    color: $warning-text;
    background: var(--badge-warning-bg);
    border-radius: $radius-sm;
    padding: $space-2 $space-3;
  }

  .ai-hint-text {
    font-size: 14px;
    line-height: 1.8;
    color: $text-main;
    white-space: pre-wrap;
    min-height: 120px;

    .ai-hint-placeholder {
      color: $text-muted;
    }

    /* 打字机光标。动画只做透明度：不引发动画抖动，也不影响文字测量
       （e2e 断言的是 textContent 增长，光标是空 span）。 */
    .ai-hint-caret {
      display: inline-block;
      width: 6px;
      height: 1em;
      margin-left: 2px;
      vertical-align: text-bottom;
      background: $primary-color;
      animation: ai-caret-blink 1s steps(2, start) infinite;
    }
  }

  .ai-hint-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: $space-2;

    .ai-hint-tip {
      flex: 1;
      min-width: 160px;
      font-size: $font-2xs;
      color: $text-sub;
      line-height: 1.5;
    }
  }
}

@keyframes ai-caret-blink {
  to { visibility: hidden; }
}
</style>