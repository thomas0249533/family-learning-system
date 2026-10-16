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
          <n-button size="tiny" text type="primary" @click="goToPrerequisite(pre.id)">
            去学习 →
          </n-button>
        </div>
        <div class="prereq-actions">
          <n-button
            size="small"
            type="primary"
            ghost
            :disabled="warmupExercises.length === 0"
            @click="startWarmup"
          >
            🔥 先做 {{ warmupExercises.length }} 道前置热身
          </n-button>
          <span class="prereq-actions-tip">做错也没关系，重点是先把思路找回来</span>
        </div>
      </n-alert>

      <n-card v-if="warmupOpen" title="🔥 前置热身" class="warmup-card">
        <div class="warmup-intro">
          这些都是本主题的前置知识。做完会自动回到本主题，不会打乱你原来的进度。
        </div>
        <QuizEngine
          :questions="warmupExercises"
          :package-id="currentPackageId"
          @answer="handleWarmupAnswer"
          @finish="handleWarmupFinish"
        />
      </n-card>

      <!-- ============ P1 · 掌握情况（保留 4 态，另加掌握度副标） ============ -->
      <n-card v-if="topicMastery.length > 0" title="📈 本主题掌握情况" class="mastery-card">
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
      </n-card>

      <!-- ============ 知识卡片区 ============ -->
      <!-- 场景 1：topic 有 modules（含兼容 knowledgePoints 字段名）-->
      <template v-if="currentTopic?.modules?.length">
        <div v-for="(mod, index) in currentTopic.modules" :key="index">
          <!-- 情况 1a：module 有 content 字段 → 直接渲染卡片 -->
          <n-card
            v-if="mod.content"
            :title="mod.title || '知识卡片'"
            class="fallback-kp-card"
          >
            <div class="kp-content" v-html="renderMarkdown(mod.content)"></div>
          </n-card>

          <!-- 情况 1b：module 有知识点引用 → 用模块组件渲染 -->
          <component
            v-else
            :is="getModuleComponent(mod.type)"
            :type="mod.type"
            :knowledge-point-ids="normalizeKpIds(mod)"
            :data="mod.data"
            :package-id="currentPackageId"
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
          />
          <n-card v-else :title="kp.title" class="fallback-kp-card">
            <div class="kp-content" v-html="renderMarkdown(kp.content)"></div>
          </n-card>
        </div>
      </template>

      <n-empty
        v-else
        description="该主题暂无知识点内容"
        style="padding: 40px 0;"
      />

      <!-- 练习区 -->
      <n-card
        v-if="topicExercises.length > 0"
        title="🎮 同步练习"
        style="margin-top: 24px; border-radius: 14px;"
      >
        <QuizEngine
          :questions="topicExercises"
          :package-id="currentPackageId"
          @answer="handleAnswer"
          @finish="handleQuizFinish"
        />
      </n-card>
      <n-empty
        v-else-if="!isVocabTopic"
        description="本主题暂无配套练习"
        style="margin-top: 24px; padding: 20px 0;"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NSpin, NCard, NAlert, NButton, NEmpty, useMessage } from 'naive-ui'
import MarkdownIt from 'markdown-it'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import { getModuleComponent } from '@core/registry/moduleRegistry'
import { humanizeNextReview } from '@core/review/reviewScheduler'
import { finishFeedback } from '@core/motivation/encouragement'
import type { MasteryStatus } from '@/db'
import QuizEngine, { type AnswerPayload } from '@modules/core/QuizEngine.vue'

const route = useRoute()
const router = useRouter()
const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
const message = useMessage()

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

onMounted(async () => {
  await packageStore.loadPackageById(currentPackageId.value)
  await packageStore.loadPackages()
  await userDataStore.loadUserData()
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

  if (!knowledgePointIds || knowledgePointIds.length === 0) {
    console.warn('[handleAnswer] 题目无知识点，状态机跳过', exerciseId)
    return
  }

  const question = topicExercises.value.find((ex: any) => ex.id === exerciseId)

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
}
</script>

<style scoped lang="scss">
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

      &.ms-mastered { background: rgba(var(--success-rgb), 0.14); color: $success-color; }
      &.ms-learning { background: rgba(var(--warning-rgb), 0.14); color: $warning-color; }
      &.ms-review { background: rgba(var(--danger-rgb), 0.14); color: $danger-color; }
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

    .mastery-percent strong { color: $primary-color; font-weight: 800; }
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
  :deep(strong) { color: $primary-color; font-weight: 700; }
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
