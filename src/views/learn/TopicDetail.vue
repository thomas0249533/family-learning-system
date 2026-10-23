<template>
  <div>
    <n-spin v-if="!currentTopic" size="large" style="display: flex; justify-content: center; margin-top: 50px;" />

    <div v-else>
      <h3 style="margin-bottom: 16px;">{{ currentTopic?.title }}</h3>

      <!-- ============ P2 · 前置知识：诊断性补救（不是阻断，而是先热身） ============ -->
      <n-alert
        v-if="unmetPrerequisites.length > 0"
        type="warning"
        title="📌 先热一下身，再学本主题会更顺"
        style="margin-bottom: 16px;"
      >
        <div class="prereq-tip">这些前置知识点还没掌握，可以直接在这里练几道：</div>
        <div v-for="pre in unmetPrerequisites" :key="pre.id" class="prereq-item">
          <span class="prereq-title">{{ pre.title }}</span>
          <AppButton size="tiny" text type="primary" @click="goToPrerequisite(pre.id)">
            去学习 →
          </AppButton>
        </div>
        <div class="prereq-actions">
          <AppButton
            size="small"
            type="primary"
            ghost
            :disabled="warmupExercises.length === 0"
            @click="startWarmup"
          >
            🔥 先做 {{ warmupExercises.length }} 道前置热身
          </AppButton>
          <span class="prereq-actions-tip">做错也没关系，重点是先把思路找回来</span>
        </div>
      </n-alert>

      <AppCard v-if="warmupOpen" title="🔥 前置热身" class="warmup-card">
        <div class="warmup-intro">
          这些都是本主题的前置知识。做完会自动回到本主题，不会打乱你原来的进度。
        </div>
        <QuizEngine
          :questions="warmupExercises"
          :package-id="currentPackageId"
          :exit-focus-on-finish="false"
          @answer="handleWarmupAnswer"
          @finish="handleWarmupFinish"
        />
      </AppCard>

      <!-- ============ P1 · 掌握情况（保留 4 态，另加掌握度副标） ============ -->
      <AppCard v-if="topicMastery.length > 0" title="📈 本主题掌握情况" class="mastery-card">
        <div v-for="row in topicMastery" :key="row.id" class="mastery-row">
          <div class="mastery-head">
            <span class="mastery-title">{{ row.title }}</span>
            <span class="mastery-status" :class="'ms-' + row.key">{{ row.status }}</span>
          </div>
          <div class="mastery-bar">
            <div class="mastery-fill" :class="'mf-' + row.key" :style="{ width: (row.percent ?? 0) + '%' }"></div>
          </div>
          <div class="mastery-meta">
            <span class="mastery-percent">
              掌握度 <strong>{{ row.percent === null ? '—' : row.percent + '%' }}</strong>
            </span>
            <span v-if="row.nextReview" class="mastery-next">🔄 {{ row.nextReview }}</span>
            <span class="mastery-count">对 {{ row.correctCount }} · 错 {{ row.wrongCount }}</span>
          </div>
        </div>
      </AppCard>

      <!-- ============ 知识卡片区 ============ -->
      <!-- 场景 1：topic 有 modules（含兼容 knowledgePoints 字段名）-->
      <template v-if="currentTopic?.modules?.length">
        <div v-for="(mod, index) in currentTopic.modules" :key="index">
          <!-- 情况 1a：module 有 content 字段 → 直接渲染卡片 -->
          <AppCard
            v-if="mod.content"
            :title="mod.title || '知识卡片'"
            class="fallback-kp-card"
          >
            <div class="kp-content" v-html="renderMarkdown(mod.content)"></div>
          </AppCard>

          <!-- 情况 1b：module 有知识点引用 → 用模块组件渲染 -->
          <component
            v-else
            :is="getModuleComponent(mod.type)"
            :type="mod.type"
            :knowledge-point-ids="normalizeKpIds(mod)"
            :data="mod.data"
            :package-id="currentPackageId"
            :doc-key="inkDocKeyFor(mod.type)"
          />
        </div>
      </template>

      <!-- 场景 2：topic 没 modules，但有关联知识点 -->
      <template v-else-if="autoKnowledgePoints.length > 0">
        <div v-for="kp in autoKnowledgePoints" :key="kp.id" class="auto-kp-wrap">
          <component
            v-if="kp._moduleType"
            :is="getModuleComponent(kp._moduleType)"
            :type="kp._moduleType"
            :knowledge-point-ids="[kp.id]"
            :package-id="currentPackageId"
            :doc-key="inkDocKeyFor(kp._moduleType)"
          />
          <AppCard v-else :title="kp.title" class="fallback-kp-card">
            <div class="kp-content" v-html="renderMarkdown(kp.content)"></div>
          </AppCard>
        </div>
      </template>

      <EmptyState
        v-else
        description="该主题暂无知识点内容"
        style="padding: 40px 0;"
      />

      <!-- V1.6 · C3：复习模式提示条（仅 ?mode=review 时出现，渐进增强） -->
      <div v-if="reviewMode" class="review-mode-banner">复习模式 · 这个知识点需要加强，直接做下面的练习</div>

      <!-- 练习区 -->
      <AppCard
        v-if="topicExercises.length > 0"
        ref="practiceRef"
        title="🎮 同步练习"
        style="margin-top: 24px; border-radius: 14px;"
      >
        <!--
          V2.0 · 断点续传：QuizEngine 只在"断点检查完成"后才挂载。
          为什么必须等：它的 `initialIndex` / `initialAnswers` 只在 setup 里读一次
          （`currentIndex = ref(props.initialIndex)`），先挂载再从库里补数据是补不进去的。
        -->
        <QuizEngine
          v-if="practiceReady"
          :key="practiceKey"
          :questions="topicExercises"
          :package-id="currentPackageId"
          :initial-answers="practiceInitial.answers"
          :initial-index="practiceInitial.index"
          :exit-focus-on-finish="true"
          @answer="handleAnswer"
          @finish="handleQuizFinish"
          @save-progress="handleSaveProgress"
        />
        <div v-else class="practice-loading">正在检查上次的练习进度…</div>
      </AppCard>
      <EmptyState
        v-else-if="!isVocabTopic"
        description="本主题暂无配套练习"
        style="margin-top: 24px; padding: 20px 0;"
      />

      <!-- ============ V2.0 · 断点续传弹窗 ============ -->
      <n-modal
        v-model:show="resumeOpen"
        preset="card"
        title="🔄 继续上次练习"
        class="resume-modal"
        style="max-width: 420px;"
        :closable="false"
        :mask-closable="false"
      >
        <div class="resume-body">
          <p class="resume-tip">
            检测到上次未完成的练习，当前进度
            <strong class="resume-progress">{{ resumeProgress.answered }} / {{ resumeProgress.total }}</strong>，是否继续？
          </p>
          <div class="resume-actions">
            <AppButton type="primary" block size="large" @click="continuePractice">继续</AppButton>
            <AppButton block size="large" @click="restartPractice">从头开始</AppButton>
          </div>
        </div>
      </n-modal>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NSpin, NAlert, NModal, useMessage } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MarkdownIt from 'markdown-it'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import { getModuleComponent } from '@core/registry/moduleRegistry'
import { humanizeNextReview } from '@core/review/reviewScheduler'
import { finishFeedback } from '@core/motivation/encouragement'
import { currentProfileId } from '@core/profile/currentProfile'
import {
  accumulateAnswer,
  buildSnapshot,
  progressOf as topicProgressOf,
  validateSnapshot,
  type TopicAnswers,
} from '@core/session/topicSession'
import { db, type MasteryStatus, type TopicSessionRecord } from '@/db'
import QuizEngine, { type AnswerPayload } from '@modules/core/QuizEngine.vue'
import { useUiStore } from '@core/stores/ui'

const route = useRoute()
const router = useRouter()
const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
const message = useMessage()
const uiStore = useUiStore()

/**
 * V2.1 · 沉浸式专注模式生命周期铁律：离开练习页（本组件卸载）必须重置专注态，
 * 否则用户回首页会发现侧边栏没了、疑似"全局黑屏"。
 */
onUnmounted(() => uiStore.exitFocus())

/**
 * V1.6 · C3：复习模式。从首页「最需要复习」弱项行带 `?mode=review` 跳进来时为 true。
 * 渐进增强——没有该 query 时页面与现在完全一样（提示条不出现、不滚动）。
 */
const reviewMode = computed(() => route.query.mode === 'review')

/** 练习区 AppCard 引用。AppCard 根元素是 `n-card`（真实 DOM），`$el` 即卡片本身。 */
const practiceRef = ref<InstanceType<typeof AppCard> | null>(null)

/* =========================================================================
 * V2.0 · 断点续传（topicSessions）
 *
 * 判定链：挂载 → 按 `[profileId+topicId]` 查 ongoing 行 → `validateSnapshot`
 * 逐位比对当前题库 → 通过才弹「继续上次」。
 *
 * 三条不给商量的底线：
 *   1. 任何 db 异常 / 腐坏行都**静默从头开始**（只 console.warn）—— 一个坏行
 *      不能让专题页白屏，那会把"整页学习内容"一起拖垮；
 *   2. 写入去抖 ≥800ms：`save-progress` 在每次切题都会发，逐次写库等于
 *      每点一次"下一题"就一次事务；
 *   3. **完成后不再写 ongoing**：QuizEngine 卸载时还会发一次 `save-progress`，
 *      不挡住它，刚做完的练习会在下次进页面时弹"继续上次"。
 * ====================================================================== */

/** 断点按 `topicId` 归档；优先用题目本体的 id（与路由参数短名同源，跨刷新稳定） */
const practiceTopicId = computed(() => currentTopic.value?.id ?? String(route.params.topicId ?? ''))

/** 练习区是否已可以渲染（断点检查跑完 / 用户做完选择） */
const practiceReady = ref(false)
/** 强制重建 QuizEngine（切"继续 / 从头"时 props 变了，但只有重建才会重新读 initialIndex） */
const practiceKey = ref(0)
const practiceInitial = ref<{ answers: TopicAnswers; index: number }>({ answers: {}, index: 0 })

const resumeOpen = ref(false)
const resumeRow = ref<TopicSessionRecord | null>(null)
const resumeProgress = computed(() => topicProgressOf(resumeRow.value))

/** 本次练习在内存里的答案（`@answer` 累积；落库时整体写入） */
const sessionAnswers = ref<TopicAnswers>({})
/** 最近一次报告的题号（去抖写库时用它，而不是读组件内部状态） */
const pendingIndex = ref(0)
/** 本次练习的开始时间（"从头开始"要换新的，不能被上一次的行污染） */
const practiceStartedAt = ref('')
/** 已经点过"完成练习"——之后一律不再写 ongoing */
const practiceFinished = ref(false)

const SAVE_DEBOUNCE_MS = 800
let saveTimer: number | null = null

function currentQuestionIds(): string[] {
  const ids: string[] = []
  for (const q of topicExercises.value ?? []) {
    const id = (q as any)?.id
    if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id)
  }
  return ids
}

async function dropSessionRow(id?: number): Promise<void> {
  if (typeof id !== 'number') return
  try {
    await db.topicSessions.delete(id)
  } catch (err) {
    console.warn('[TopicDetail] 删除练习断点失败（忽略）', err)
  }
}

/** 挂载时的断点检查。**永远不 throw**：读不到就当作没有断点。 */
async function initPracticeProgress(): Promise<void> {
  practiceReady.value = false
  sessionAnswers.value = {}
  practiceInitial.value = { answers: {}, index: 0 }
  pendingIndex.value = 0
  practiceFinished.value = false
  practiceStartedAt.value = new Date().toISOString()

  const pid = currentProfileId()
  const tid = practiceTopicId.value
  const qids = currentQuestionIds()
  if (!pid || !tid || qids.length === 0) {
    practiceReady.value = true
    return
  }

  try {
    // 复合索引必须传满 2 元数组：少传在真库是"静默查不到"，在本仓 fakeDexie 会炸
    const row = await db.topicSessions
      .where('[profileId+topicId]')
      .equals([pid, tid])
      .first()

    if (row && row.status === 'ongoing') {
      const snapshot = validateSnapshot(row, qids)
      if (snapshot) {
        resumeRow.value = snapshot
        resumeOpen.value = true
        return // 等用户选择，练习区先不渲染（避免"边答边被弹窗覆盖"）
      }
      // 腐坏：题库变了 / 行是半截写入的 → 丢掉，从头开始
      console.warn('[TopicDetail] 练习断点与当前题库对不上，已丢弃并从头开始', { topicId: tid })
      await dropSessionRow(row.id)
    }
  } catch (err) {
    console.warn('[TopicDetail] 读取练习断点失败，从头开始', err)
  }

  practiceReady.value = true
}

function startFresh(): void {
  sessionAnswers.value = {}
  practiceInitial.value = { answers: {}, index: 0 }
  pendingIndex.value = 0
  practiceFinished.value = false
  practiceStartedAt.value = new Date().toISOString()
  practiceKey.value++
  practiceReady.value = true
}

function continuePractice(): void {
  const row = resumeRow.value
  resumeOpen.value = false
  if (!row) {
    startFresh()
    return
  }
  sessionAnswers.value = { ...row.answers }
  practiceInitial.value = { answers: { ...row.answers }, index: row.currentIndex }
  pendingIndex.value = row.currentIndex
  practiceStartedAt.value = row.startedAt
  practiceFinished.value = false
  resumeRow.value = null
  practiceKey.value++
  practiceReady.value = true
}

async function restartPractice(): Promise<void> {
  resumeOpen.value = false
  const row = resumeRow.value
  resumeRow.value = null
  if (row?.id !== undefined) await dropSessionRow(row.id)
  startFresh()
}

function scheduleSave(index: number): void {
  pendingIndex.value = index
  if (practiceFinished.value) return
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void flushProgress()
  }, SAVE_DEBOUNCE_MS)
}

/** 把内存里的答案 + 题号写进 `topicSessions`（按复合索引 upsert，绝不出现第二行 ongoing） */
async function flushProgress(status: TopicSessionRecord['status'] = 'ongoing'): Promise<void> {
  const pid = currentProfileId()
  const tid = practiceTopicId.value
  const qids = currentQuestionIds()
  if (!pid || !tid || qids.length === 0) return

  try {
    const existing = await db.topicSessions
      .where('[profileId+topicId]')
      .equals([pid, tid])
      .first()

    const snapshot = buildSnapshot({
      id: existing?.id,
      profileId: pid,
      packageId: currentPackageId.value,
      topicId: tid,
      questionIds: qids,
      answers: sessionAnswers.value,
      currentIndex: pendingIndex.value,
      startedAt: practiceStartedAt.value,
      status,
      now: new Date().toISOString(),
    })

    if (existing?.id !== undefined) await db.topicSessions.put(snapshot)
    else await db.topicSessions.add(snapshot)
  } catch (err) {
    // 写失败不能让孩子的练习中断：页面上还有内存态，下一次 save-progress 会重试
    console.warn('[TopicDetail] 保存练习断点失败（忽略）', err)
  }
}

function handleSaveProgress(patch: { currentIndex: number }): void {
  if (!practiceReady.value || practiceFinished.value) return
  scheduleSave(patch.currentIndex)
}

onUnmounted(() => {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  if (practiceReady.value && !practiceFinished.value) void flushProgress()
})

/** ✅ 纯词汇主题：不显示"暂无练习"提示 */
const isVocabTopic = computed(() => {
  const mods = currentTopic.value?.modules ?? []
  if (mods.length === 0) return false
  return mods.every((m: any) =>
    m.type === 'chinese.words' || m.type === 'english.vocab'
  )
})


const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
function renderMarkdown(s: string) { return md.render(s ?? '') }

/** 唯一 stripPrefix */
function stripPrefix(id: string): string {
  if (!id) return ''
  const idx = id.indexOf('::')
  return idx >= 0 ? id.slice(idx + 2) : id
}

/** ✅ 兼容 module 的两种字段名：knowledgePointIds / knowledgePoints */
function normalizeKpIds(mod: any): string[] {
  if (Array.isArray(mod?.knowledgePointIds) && mod.knowledgePointIds.length > 0) {
    return mod.knowledgePointIds
  }
  if (Array.isArray(mod?.knowledgePoints) && mod.knowledgePoints.length > 0) {
    return mod.knowledgePoints
  }
  return []
}

const currentPackageId = computed(() => route.params.packageId as string)

/**
 * 划线辅助的「文档标识」（V1.6 · Stage D · D4）：`packageId:topicId`。
 *
 * 为什么只给 `chinese.text` 传：其余模块组件没有这个 prop，`<component :is>` 上的
 * 未知属性会 fallthrough 到它们根节点上，DOM 里多一个 `doc-key="..."` 毫无意义
 * 还可能干扰快照；所以按模块类型显式决定传不传。
 */
const inkDocKey = computed(
  () => `${currentPackageId.value}:${String(route.params.topicId ?? '')}`
)

function inkDocKeyFor(moduleType: string): string | undefined {
  return moduleType === 'chinese.text' ? inkDocKey.value : undefined
}

onMounted(async () => {
  await packageStore.loadPackageById(currentPackageId.value)
  await packageStore.loadPackages()
  await userDataStore.loadUserData()

  // V2.0 · 断点检查必须在题库就绪之后（要逐位比对 questionIds）
  await initPracticeProgress()

  // V1.6 · C3：复习模式下把练习区滚进视野（渐进增强）。
  // 用元素自身的 scrollIntoView 而非 window.scrollTo：滚动容器可能是 AppShell 里
  // 那个可滚动的 div，scrollIntoView 会自己找最近的可滚动祖先一并滚动。
  // AppCard 根是 n-card（真实 DOM），$el 即卡片；拿不到（未挂载 / 非元素）就静默跳过，绝不抛异常。
  if (reviewMode.value) {
    await nextTick()
    const el = practiceRef.value?.$el
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
})

/** 全局知识点池 */
const globalKpMap = computed(() => {
  const map = new Map<string, any>()
  const mapShort = new Map<string, any>()
  for (const pkg of packageStore.packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      if (kp?.id) {
        map.set(kp.id, kp)
        mapShort.set(stripPrefix(kp.id), kp)
      }
    }
  }
  return { map, mapShort }
})

/** 全局题目池 */
const globalExercisePool = computed(() => {
  const pool: any[] = []
  for (const pkg of packageStore.packages) {
    for (const ex of pkg.exercises ?? []) {
      pool.push({ ex, pkgId: pkg.packageId })
    }
    for (const u of pkg.units ?? []) {
      for (const t of u.topics ?? []) {
        for (const ex of t.exercises ?? []) {
          pool.push({ ex, pkgId: pkg.packageId })
        }
      }
    }
  }
  return pool
})

const currentTopic = computed(() => {
  const pkg = packageStore.currentPackage
  if (!pkg) return null
  const unitId = route.params.unitId as string
  const topicId = route.params.topicId as string
  const unit = pkg.units.find((u: any) =>
    u.id === unitId || stripPrefix(u.id) === unitId
  )
  if (!unit) return null
  return unit.topics.find((t: any) =>
    t.id === topicId || stripPrefix(t.id) === topicId
  )
})

/** 根据学科 + kp.type 推断模块组件 */
function inferModuleType(kp: any, subject: string): string | null {
  const type = kp?.type ?? 'concept'
  const map: Record<string, Record<string, string>> = {
    chinese: {
      poem: 'chinese.poem',
      concept: 'chinese.text',
      word: 'chinese.words',
      writing: 'chinese.writing',
    },
    math: {
      formula: 'math.formula',
      concept: 'math.concept',
      life: 'math.life',
    },
    english: {
      word: 'english.vocab',
      grammar: 'english.grammar',
      concept: 'english.reading',
      writing: 'english.writing',
    },
  }
  return map[subject]?.[type] ?? null
}

/** 从全局池拉知识点 */
const autoKnowledgePoints = computed(() => {
  const topicKpIds: string[] = currentTopic.value?.knowledgePointIds ?? []
  if (topicKpIds.length === 0) return []

  const { map, mapShort } = globalKpMap.value

  return topicKpIds
    .map(id => {
      const kp = map.get(id) ?? mapShort.get(stripPrefix(id))
      if (!kp) return null
      const ownerPkg = packageStore.packages.find(p =>
        p.knowledgePoints?.some((k: any) => k.id === kp.id)
      )
      const subject = ownerPkg?.manifest.subject ?? ''
      return { ...kp, _moduleType: inferModuleType(kp, subject) }
    })
    .filter(Boolean)
})

/** 从全局题池筛题 */
const topicExercises = computed(() => {
  const topic = currentTopic.value
  if (!topic) return []

  if (Array.isArray(topic.exercises) && topic.exercises.length > 0) {
    return topic.exercises
  }

  // 从 modules 里汇总所有知识点 ID
  const filterKpIds: string[] = []
  for (const mod of topic.modules ?? []) {
    filterKpIds.push(...normalizeKpIds(mod))
  }
  if (topic.knowledgePointIds) filterKpIds.push(...topic.knowledgePointIds)

  const topicKpShortIds = new Set<string>(filterKpIds.map(stripPrefix))

  const result: any[] = []
  const seen = new Set<string>()
  for (const { ex } of globalExercisePool.value) {
    if (!ex?.id || seen.has(ex.id)) continue
    const exKpIds: string[] = ex.knowledgePointIds ?? []
    if (exKpIds.some(id => topicKpShortIds.has(stripPrefix(id)))) {
      result.push(ex)
      seen.add(ex.id)
    }
  }
  return result
})

/** 本主题涉及的全部知识点 ID（modules + knowledgePointIds，去重） */
const topicKpIds = computed(() => {
  const topic = currentTopic.value
  if (!topic) return []
  const ids: string[] = []
  for (const mod of topic.modules ?? []) ids.push(...normalizeKpIds(mod))
  if (topic.knowledgePointIds) ids.push(...topic.knowledgePointIds)
  return Array.from(new Set(ids))
})

/** 本地补全版的进度记录（老数据可能缺 masteryProbability） */
function progressOf(kpId: string) {
  const progress = userDataStore.progress
  return progress.find(x =>
    x.knowledgePointId === kpId ||
    stripPrefix(x.knowledgePointId) === stripPrefix(kpId)
  )
}

const STATUS_KEY: Record<MasteryStatus, string> = {
  未学: 'none',
  学习中: 'learning',
  已掌握: 'mastered',
  需复习: 'review',
}

/**
 * P1 · 掌握情况面板
 * 主标签沿用原来的 4 态（视觉语义不变），旁边加"掌握度 xx%"作为副标。
 */
const topicMastery = computed(() => {
  const { map, mapShort } = globalKpMap.value
  return topicKpIds.value.map(id => {
    const kp = map.get(id) ?? mapShort.get(stripPrefix(id))
    const p = progressOf(id)
    const status: MasteryStatus = p?.status ?? '未学'
    const prob = typeof p?.masteryProbability === 'number' ? p.masteryProbability : null
    return {
      id,
      title: kp?.title ?? id,
      status,
      key: STATUS_KEY[status] ?? 'none',
      percent: prob === null ? null : Math.round(prob * 100),
      nextReview: p?.nextReviewAt ? humanizeNextReview(p.nextReviewAt) : '',
      correctCount: p?.correctCount ?? 0,
      wrongCount: p?.wrongCount ?? 0,
    }
  })
})

/** 前置检查 */
const unmetPrerequisites = computed(() => {
  const { map, mapShort } = globalKpMap.value
  const progress = userDataStore.progress

  const seen = new Set<string>()
  const result: Array<{ id: string; title: string }> = []

  for (const kpId of topicKpIds.value) {
    const kp = map.get(kpId) ?? mapShort.get(stripPrefix(kpId))
    if (!kp) continue
    const prerequisites: string[] = kp.prerequisites ?? []
    for (const preId of prerequisites) {
      if (seen.has(preId)) continue
      seen.add(preId)
      const preKp = map.get(preId) ?? mapShort.get(stripPrefix(preId))
      const p = progress.find(x =>
        x.knowledgePointId === preId || stripPrefix(x.knowledgePointId) === stripPrefix(preId)
      )
      if (p?.status !== '已掌握') {
        result.push({ id: preId, title: preKp?.title ?? preId })
      }
    }
  }
  return result
})

/** 某个知识点归属的学习包（前置可能来自别的包） */
function ownerPackageIdOf(kpId: string): string {
  for (const pkg of packageStore.packages) {
    const hit = pkg.knowledgePoints?.some(
      (k: any) => k.id === kpId || stripPrefix(k.id) === stripPrefix(kpId)
    )
    if (hit) return pkg.packageId
  }
  return currentPackageId.value
}

/** P2 · 前置热身题：从全局题池里筛出前置知识点的题，最多 5 道 */
const WARMUP_LIMIT = 5
const warmupExercises = computed(() => {
  const ids = new Set(unmetPrerequisites.value.map(p => stripPrefix(p.id)))
  if (ids.size === 0) return []

  const out: any[] = []
  const seen = new Set<string>()
  for (const { ex } of globalExercisePool.value) {
    if (out.length >= WARMUP_LIMIT) break
    if (!ex?.id || seen.has(ex.id)) continue
    const exKpIds: string[] = ex.knowledgePointIds ?? []
    if (exKpIds.some(k => ids.has(stripPrefix(k)))) {
      out.push(ex)
      seen.add(ex.id)
    }
  }
  return out
})

const warmupOpen = ref(false)

function startWarmup() {
  if (warmupExercises.value.length === 0) return
  warmupOpen.value = true
}

/** 前置热身作答：进度记到"真正拥有该知识点"的那个包上 */
async function handleWarmupAnswer(payload: AnswerPayload) {
  const { exerciseId, knowledgePointIds, isCorrect, userAnswer, elapsedMs } = payload
  if (!knowledgePointIds || knowledgePointIds.length === 0) return

  const question = warmupExercises.value.find((ex: any) => ex.id === exerciseId)

  // 题目级埋点（每题一次）：每日题量 + 题型
  userDataStore.recordAnswerEvent({ exerciseId, questionType: question?.type })

  for (const kpId of knowledgePointIds) {
    await userDataStore.recordProgress(
      ownerPackageIdOf(kpId),
      kpId,
      isCorrect,
      {
        questionType: question?.type,
        optionCount: question?.options?.length,
        elapsedMs,
      }
    )
  }

  if (isCorrect) {
    await userDataStore.resolveMistake(exerciseId, true)
  } else if (question) {
    await userDataStore.addMistake(
      question,
      ownerPackageIdOf(knowledgePointIds[0]),
      knowledgePointIds,
      userAnswer
    )
  }
}

function handleWarmupFinish(correctCount: number) {
  const total = warmupExercises.value.length
  const fb = finishFeedback(correctCount, total)
  message[fb.type](fb.text, { duration: 4000 })
  warmupOpen.value = false
}

function goToPrerequisite(kpId: string) {
  for (const pkg of packageStore.packages) {
    for (const unit of pkg.units ?? []) {
      for (const topic of unit.topics ?? []) {
        const ids: string[] = topic.knowledgePointIds ?? []
        const modIds: string[] = []
        for (const mod of topic.modules ?? []) {
          modIds.push(...normalizeKpIds(mod))
        }
        const all = [...ids, ...modIds]
        if (all.some(id => id === kpId || stripPrefix(id) === stripPrefix(kpId))) {
          router.push(
            `/learn/${pkg.packageId}/unit/${stripPrefix(unit.id)}/topic/${stripPrefix(topic.id)}`
          )
          return
        }
      }
    }
  }
}

async function handleAnswer(payload: AnswerPayload) {
  const { exerciseId, knowledgePointIds, isCorrect, userAnswer, elapsedMs } = payload

  // ① 断点先记：**必须在 KP 早退之前**。没有知识点的题（合法的自测题）
  //    在掌握度链路里会被跳过，但它照样该出现在答题卡上、照样该能被续传。
  sessionAnswers.value = accumulateAnswer(sessionAnswers.value, exerciseId, {
    userAnswer,
    isCorrect,
  })
  scheduleSave(pendingIndex.value)

  if (!knowledgePointIds || knowledgePointIds.length === 0) {
    console.warn('[handleAnswer] 题目无知识点，状态机跳过', exerciseId)
    return
  }

  const question = topicExercises.value.find((ex: any) => ex.id === exerciseId)

  // 题目级埋点（每题一次）：每日题量 + 题型
  userDataStore.recordAnswerEvent({ exerciseId, questionType: question?.type })

  for (const kpId of knowledgePointIds) {
    await userDataStore.recordProgress(
      currentPackageId.value,
      kpId,
      isCorrect,
      {
        questionType: question?.type,
        optionCount: question?.options?.length,
        elapsedMs,
      }
    )
  }

  if (!isCorrect) {
    if (question) {
      await userDataStore.addMistake(
        question,
        currentPackageId.value,
        knowledgePointIds,
        userAnswer
      )
    }
  } else {
    // P3 · 这道题在错题本里 → 复习答对，推进三级状态
    await userDataStore.resolveMistake(exerciseId, true)
  }
}

function handleQuizFinish(correctCount: number) {
  const total = topicExercises.value.length
  const fb = finishFeedback(correctCount, total)
  message[fb.type](fb.text, { duration: 4000 })
  console.log(`🎉 练习结束，答对 ${correctCount} / ${total} 题`)

  // V2.0 · 断点收尾：标记 finished 并停止后续写入。
  // 不这样做的后果很具体：QuizEngine 卸载时还会发一次 `save-progress`，
  // 那一次会把刚做完的练习重新写成 ongoing → 下次进来又弹"继续上次"。
  practiceFinished.value = true
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  void flushProgress('finished')
}
</script>

<style scoped lang="scss">
/* V2.0 · 断点检查期间的占位（练习区不能整块消失，否则页面高度会跳一下） */
.practice-loading {
  padding: 24px 0;
  text-align: center;
  font-size: $font-sm;
  color: $text-sub;
}

/* V2.0 · 续传弹窗（全 token；文字色一律 -text） */
.resume-tip {
  margin: 0 0 $space-4;
  font-size: 15px;
  line-height: $leading-normal;
  color: $text-main;

  .resume-progress {
    color: $primary-text;
    font-weight: 800;
  }
}

.resume-actions {
  display: flex;
  flex-direction: column;
  gap: $space-2;
}

/* V1.6 · C3：复习模式提示条（全 token，禁硬编码色 / 文字色走 -text） */
.review-mode-banner {
  margin-top: 16px;
  margin-bottom: 16px;
  padding: $space-3 $space-4;
  background: $warning-light;
  border-radius: $radius-md;
  font-size: $font-sm;
  font-weight: 600;
  color: $warning-text;
  line-height: $leading-normal;
}

.prereq-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed $border-color;
  &:last-of-type { border-bottom: none; }
  .prereq-title { font-size: 15px; font-weight: 600; }
}

.prereq-tip {
  font-size: 13px;
  color: $text-sub;
  margin-bottom: 4px;
}

.prereq-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed $border-color;

  .prereq-actions-tip {
    font-size: 12px;
    color: $text-muted;
  }
}

.warmup-card {
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  margin-bottom: 16px;

  .warmup-intro {
    font-size: 13px;
    color: $text-sub;
    background: $primary-light;
    padding: 10px 14px;
    border-radius: 8px;
    margin-bottom: 14px;
    line-height: 1.6;
  }
}

/* ===== P1 · 掌握情况 ===== */
.mastery-card {
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  margin-bottom: 16px;
}

.mastery-row {
  padding: 10px 0;
  border-bottom: 1px dashed $border-light;
  &:last-child { border-bottom: none; }

  .mastery-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;

    .mastery-title {
      font-size: 14px;
      font-weight: 700;
      color: $text-main;
      flex: 1;
      min-width: 0;
    }

    .mastery-status {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 20px;
      background: $bg-color-hover;
      color: $text-sub;

      &.ms-mastered { background: var(--badge-success-bg); color: $success-text; }
      &.ms-learning { background: var(--badge-warning-bg); color: $warning-text; }
      &.ms-review { background: var(--badge-danger-bg); color: $danger-text; }
    }
  }

  .mastery-bar {
    height: 6px;
    background: $bg-color-hover;
    border-radius: 4px;
    overflow: hidden;

    .mastery-fill {
      height: 100%;
      width: 0;
      border-radius: 4px;
      background: $gradient-primary;
      transition: width 0.4s ease;

      &.mf-mastered { background: $gradient-success; }
      &.mf-review { background: $gradient-warm; }
      &.mf-none { background: $border-color; }
    }
  }

  .mastery-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 6px;
    font-size: 12px;
    color: $text-sub;

    .mastery-percent strong { color: $primary-text; font-weight: 800; }
    .mastery-next { color: $text-muted; }
    .mastery-count { color: $text-muted; }
  }
}

.auto-kp-wrap { margin-bottom: 16px; }

.fallback-kp-card {
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  margin-bottom: 16px;
}

/* ✅ 知识卡片正文：15→16，行高微调 */
.kp-content {
  font-size: 16px;
  line-height: 1.85;
  color: $text-main;

  :deep(p) { margin: 10px 0; }
  :deep(h1), :deep(h2), :deep(h3) {
    color: $text-main;
    margin: 14px 0 8px;
    font-size: 17px;
  }
  :deep(ul), :deep(ol) { padding-left: 26px; }
  :deep(li) { margin: 4px 0; }
  :deep(strong) { color: $primary-text; font-weight: 700; }
  :deep(code) {
    background: rgba(var(--primary-rgb), 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    color: $code-color;
    font-size: 15px;
  }
}

/* ✅ 卡片内边距加大 */
:deep(.n-card__content) {
  padding: 20px 24px;
  font-size: 16px;
  line-height: 1.85;
}

/* ✅ 卡片标题加大 */
:deep(.n-card-header__main) {
  font-size: 18px;
  font-weight: 700;
}
:deep(.n-card-header) {
  padding: 18px 24px 0;
}

/* ✅ 顶层标题（topic 标题） */
div > h3 {
  font-size: 22px;
  font-weight: 800;
  color: $text-main;
  line-height: 1.4;
}

/* 深色模式适配 */
body.dark-mode {
  .prereq-item { border-bottom-color: rgba(var(--on-strong-rgb), 0.08); }
  .prereq-actions { border-top-color: rgba(var(--on-strong-rgb), 0.08); }
  .kp-content :deep(code) { background: rgba(var(--on-strong-rgb), 0.08); }
  .mastery-row { border-bottom-color: rgba(var(--on-strong-rgb), 0.08); }
}
</style>
