<template>
  <n-card class="exam-panel">
    <!-- 入口屏 -->
    <div v-if="phase === 'intro'" class="exam-intro">
      <div class="exam-badge">🎯 {{ examTypeLabel }}</div>
      <h2 class="exam-title">{{ pkg.manifest.title }}</h2>

      <div class="exam-meta">
        <div class="meta-item">
          <div class="meta-value">{{ allQuestions.length }}</div>
          <div class="meta-label">总题数</div>
        </div>
        <div class="meta-item">
          <div class="meta-value">{{ answeredCount }}</div>
          <div class="meta-label">已作答</div>
        </div>
        <div class="meta-item">
          <div class="meta-value">{{ remainingCount }}</div>
          <div class="meta-label">未作答</div>
        </div>
      </div>

      <div class="exam-config">
        <div class="config-row">
          <span class="config-label">每卷题数</span>
          <n-input-number v-model:value="perSessionCount" :min="5" :max="50" :step="5" style="width: 120px;" />
        </div>
        <div class="config-row">
          <span class="config-label">限时（分钟，0=不限）</span>
          <n-input-number v-model:value="timeLimitMinutes" :min="0" :max="120" :step="5" style="width: 120px;" />
        </div>
      </div>

      <n-space vertical style="margin-top: 20px;">
        <n-button type="primary" size="large" block @click="startNewSession">
          ▶ 开始新会话（{{ Math.min(perSessionCount, remainingCount) }} 题）
        </n-button>
        <n-button v-if="ongoingSession" type="warning" size="large" block @click="continueSession">
          🔄 继续上次（{{ Object.keys(ongoingSession.answers).length }} / {{ ongoingSession.totalCount }}）
        </n-button>
      </n-space>

      <div v-if="sessions.length > 0" class="session-history">
        <div class="history-title">📋 历史会话（{{ sessions.length }}）</div>
        <div v-for="s in sessions" :key="s.id" class="history-item">
          <div class="history-info">
            <span class="history-index">第 {{ s.sessionIndex }} 卷</span>
            <span class="history-progress">
              {{ Object.keys(s.answers).length }} / {{ s.totalCount }}
            </span>
            <span v-if="s.status === 'finished'" class="history-rate" :class="rateColor(s.finalRate || 0)">
              {{ s.finalRate }}%
            </span>
            <span v-else class="history-status">未完成</span>
          </div>
          <n-button size="tiny" text type="error" @click="removeSession(s.id!)">删除</n-button>
        </div>
      </div>
    </div>

    <!-- 答题中 -->
    <div v-else-if="phase === 'running' && currentSession">
      <QuizEngine
        :questions="currentSessionQuestions"
        :package-id="sourcePackageId"
        :initial-answers="currentSession.answers"
        :initial-index="currentSession.currentIndex"
        :started-at="currentSessionElapsed"
        :time-limit="currentSession.timeLimit"
        :session-id="currentSession.id!"
        exam-mode
        @answer="handleAnswer"
        @finish="handleFinish"
        @exam-detail="handleExamDetail"
        @save-progress="handleSaveProgress"
        @exit="handleExit"
      />
    </div>

    <!-- 完成 -->
    <div v-else-if="phase === 'done'" class="exam-result">
      <div class="result-header">
        <div class="result-icon">{{ scoreLevel.icon }}</div>
        <div class="result-title">{{ scoreLevel.title }}</div>
        <div class="result-score">
          <span class="score-num">{{ correctCount }}</span>
          <span class="score-div">/</span>
          <span class="score-total">{{ sessionTotal }}</span>
        </div>
        <div class="result-rate">正确率 {{ accuracyPercent }}%</div>
        <div class="result-time">用时 {{ formatDuration(sessionElapsed) }}</div>
      </div>

      <!-- ✅ 错题清单（默认展开） -->
      <div v-if="examWrongItems.length > 0" class="result-section">
        <div class="section-head">
          <span class="section-title wrong-title">❌ 错题清单（{{ examWrongItems.length }} 题）</span>
          <n-button size="tiny" text @click="showWrong = !showWrong">
            {{ showWrong ? '收起' : '展开' }}
          </n-button>
        </div>
        <div v-show="showWrong" class="detail-list">
          <div v-for="item in examWrongItems" :key="item.questionId" class="detail-card wrong">
            <div class="detail-head">
              <span class="detail-badge wrong-badge">错</span>
              <span class="detail-question" v-html="renderQuestionText(item.question)"></span>
            </div>

            <!-- 选择题 -->
            <div v-if="item.options?.length" class="detail-options">
              <div
                v-for="opt in item.options"
                :key="opt"
                class="detail-opt"
                :class="{
                  'opt-correct': opt.charAt(0) === item.correctAnswer,
                  'opt-wrong': item.userAnswer && opt.charAt(0) === item.userAnswer && item.userAnswer !== item.correctAnswer,
                }"
              >
                {{ opt }}
                <span v-if="item.userAnswer && opt.charAt(0) === item.userAnswer" class="opt-mark">
                  ← 你的选择
                </span>
              </div>
            </div>

            <!-- 填空/其他 -->
            <div v-else class="detail-answers">
              <div class="answer-row wrong-row">
                <span class="answer-label">你的答案：</span>
                <span class="answer-value">{{ item.userAnswer || '（未作答）' }}</span>
              </div>
              <div class="answer-row correct-row">
                <span class="answer-label">正确答案：</span>
                <span class="answer-value">{{ item.correctAnswer }}</span>
              </div>
            </div>

            <div v-if="item.explanation" class="detail-explain">
              💡 {{ item.explanation }}
            </div>
          </div>
        </div>
      </div>

      <!-- ✅ 正确题目（默认折叠） -->
      <div v-if="examCorrectItems.length > 0" class="result-section">
        <div class="section-head">
          <span class="section-title correct-title">✅ 答对题目（{{ examCorrectItems.length }} 题）</span>
          <n-button size="tiny" text @click="showCorrect = !showCorrect">
            {{ showCorrect ? '收起' : '展开' }}
          </n-button>
        </div>
        <div v-show="showCorrect" class="detail-list">
          <div v-for="item in examCorrectItems" :key="item.questionId" class="detail-card correct">
            <div class="detail-head">
              <span class="detail-badge correct-badge">对</span>
              <span class="detail-question" v-html="renderQuestionText(item.question)"></span>
            </div>
            <div class="detail-answers">
              <div class="answer-row correct-row">
                <span class="answer-label">正确答案：</span>
                <span class="answer-value">{{ item.correctAnswer }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <n-button v-if="remainingCount > 0" type="primary" size="large" block style="margin-top: 24px;" @click="startNewSession">
        ▶ 继续下一卷（剩 {{ remainingCount }} 题）
      </n-button>
      <n-button block style="margin-top: 10px;" @click="backToIntro">
        ← 返回列表
      </n-button>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NCard, NButton, NInputNumber, NSpace, useMessage } from 'naive-ui'
import QuizEngine, { type AnswerPayload, type ExamDetailItem, type ExamDetailPayload } from '@modules/core/QuizEngine.vue'
import { useUserDataStore } from '@core/stores/userData'
import { useExamStore } from '@core/stores/exam'
import { db } from '@/db'
import type { LearningPackageRecord, ExamSessionRecord } from '@/db'

const props = defineProps<{ pkg: LearningPackageRecord }>()

const message = useMessage()
const userDataStore = useUserDataStore()
const examStore = useExamStore()

type Phase = 'intro' | 'running' | 'done'
const phase = ref<Phase>('intro')

const perSessionCount = ref(10)
const timeLimitMinutes = ref(0)

const currentSession = ref<ExamSessionRecord | null>(null)
const correctCount = ref(0)

/** ✅ 考试详情 */
const examDetailItems = ref<ExamDetailItem[]>([])
const showWrong = ref(true)
const showCorrect = ref(false)

const examWrongItems = computed(() => examDetailItems.value.filter(i => !i.isCorrect))
const examCorrectItems = computed(() => examDetailItems.value.filter(i => i.isCorrect))

const allQuestions = computed(() => {
  const all: any[] = []
  for (const u of props.pkg.units ?? []) {
    for (const t of u.topics ?? []) {
      for (const ex of t.exercises ?? []) all.push(ex)
    }
  }
  return all
})

const answeredCount = computed(() => {
  const ids = new Set<string>()
  for (const s of examStore.sessions) {
    for (const qid of Object.keys(s.answers)) ids.add(qid)
  }
  return ids.size
})
const remainingCount = computed(() => Math.max(0, allQuestions.value.length - answeredCount.value))

const sessions = computed(() => examStore.sessions)
const ongoingSession = computed(() => sessions.value.find(s => s.status === 'ongoing') ?? null)

const currentSessionQuestions = computed(() => {
  if (!currentSession.value) return []
  const map = new Map(allQuestions.value.map(q => [q.id, q]))
  return currentSession.value.questionIds.map(id => map.get(id)).filter(Boolean)
})

const currentSessionElapsed = computed(() => currentSession.value?.elapsedSeconds ?? 0)
const sessionTotal = computed(() => currentSession.value?.totalCount ?? 0)
const sessionElapsed = computed(() => currentSession.value?.elapsedSeconds ?? 0)

const accuracyPercent = computed(() => {
  const total = sessionTotal.value
  return total === 0 ? 0 : Math.round((correctCount.value / total) * 100)
})

const scoreLevel = computed(() => {
  const p = accuracyPercent.value
  if (p >= 90) return { icon: '🏆', title: '出色表现！' }
  if (p >= 75) return { icon: '🎉', title: '表现良好！' }
  if (p >= 60) return { icon: '💪', title: '稳扎稳打，进步看得见' }
  // 措辞刻意落在"题目有挑战"上，不落在"你不行"上
  if (p > 0) return { icon: '🌱', title: '这套题有点挑战，一起看解析' }
  return { icon: '🤝', title: '别急，先理一理思路' }
})

const examTypeLabel = computed(() =>
  props.pkg.manifest.packageType === 'sprint' || (props.pkg.manifest as any).type === 'sprint'
    ? '冲刺模拟卷' : '专项测验'
)

const sourcePackageId = computed(() => {
  const deps: string[] = props.pkg.manifest.dependencies ?? []
  return deps[0] ?? props.pkg.packageId
})

function rateColor(rate: number): string {
  if (rate >= 80) return 'rate-good'
  if (rate >= 60) return 'rate-mid'
  return 'rate-bad'
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 题干换行渲染 */
function renderQuestionText(text: string): string {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(/\\n/g, '<br>')
}

onMounted(async () => {
  await examStore.loadSessions(props.pkg.packageId)
})

async function startNewSession() {
  if (allQuestions.value.length === 0) {
    message.warning('本卷暂无题目')
    return
  }

  const answered = await examStore.getAllAnsweredIds(props.pkg.packageId)
  const unAnswered = allQuestions.value.filter(q => !answered.has(q.id))
  const pool = unAnswered.length >= perSessionCount.value ? unAnswered : allQuestions.value

  const count = Math.min(perSessionCount.value, pool.length)
  const picked = pool.slice(0, count).map(q => q.id)

  const timeLimit = timeLimitMinutes.value > 0 ? timeLimitMinutes.value * 60 : 0
  const id = await examStore.createSession({
    packageId: props.pkg.packageId,
    questionIds: picked,
    timeLimit,
  })
  const s = await examStore.sessions.find(x => x.id === id)
  if (!s) return
  currentSession.value = s
  correctCount.value = 0
  examDetailItems.value = []
  phase.value = 'running'
}

async function continueSession() {
  if (!ongoingSession.value) return
  currentSession.value = ongoingSession.value
  correctCount.value = Object.values(ongoingSession.value.answers).filter(a => a.isCorrect).length
  examDetailItems.value = []
  phase.value = 'running'
}

async function handleAnswer(payload: AnswerPayload) {
  const question = currentSessionQuestions.value.find(q => q.id === payload.exerciseId)
  const kpIds = payload.knowledgePointIds ?? []

  // 题目级埋点（每题一次）：每日题量 + 题型
  userDataStore.recordAnswerEvent({ exerciseId: payload.exerciseId, questionType: question?.type })

  // P0/P1 · 专项/冲刺包也要喂给掌握度与复习调度。
  // 否则孩子大量练习都发生在专项包里，掌握度与复习计划却完全没反应。
  for (const kpId of kpIds) {
    await userDataStore.recordProgress(
      sourcePackageId.value,
      kpId,
      payload.isCorrect,
      {
        questionType: question?.type,
        optionCount: question?.options?.length,
        elapsedMs: payload.elapsedMs,
      }
    )
  }

  if (!payload.isCorrect) {
    if (question) {
      await userDataStore.addMistake(
        question,
        sourcePackageId.value,
        kpIds,
        payload.userAnswer
      )
    }
  } else {
    // P3 · 这道题在错题本里 → 复习答对，推进三级状态
    await userDataStore.resolveMistake(payload.exerciseId, true)
  }
}

/** ✅ 接收考试详情 */
function handleExamDetail(payload: ExamDetailPayload) {
  examDetailItems.value = payload.items
}

async function handleSaveProgress(patch: {
  currentIndex: number
  elapsedSeconds?: number
  examAnswers?: Record<string, any>
}) {
  const sid = currentSession.value?.id
  if (!sid) return

  const update: any = { currentIndex: patch.currentIndex }
  if (patch.elapsedSeconds !== undefined) update.elapsedSeconds = patch.elapsedSeconds

  if (patch.examAnswers) {
    const s = await db.examSessions.get(sid)
    if (s) {
      const answers = { ...(s.answers ?? {}) }
      for (const [qid, ua] of Object.entries(patch.examAnswers)) {
        const prev = answers[qid]
        answers[qid] = {
          userAnswer: ua,
          isCorrect: prev?.isCorrect ?? false,
        }
      }
      update.answers = answers
    }
  }

  await examStore.updateSession(sid, update)
  const updated = await examStore.sessions.find(s => s.id === sid)
  if (updated) currentSession.value = updated
}

async function handleExit() {
  if (!currentSession.value) return
  await handleSaveProgress({
    currentIndex: currentSession.value.currentIndex,
    elapsedSeconds: currentSession.value.elapsedSeconds,
  })
  message.info('已保存进度，可稍后继续')
  phase.value = 'intro'
  currentSession.value = null
  await examStore.loadSessions(props.pkg.packageId)
}

async function handleFinish(correct: number) {
  const sid = currentSession.value?.id
  if (!sid) return
  correctCount.value = correct
  await examStore.finishSession(sid, correct)
  const updated = await examStore.sessions.find(s => s.id === sid)
  if (updated) currentSession.value = updated
  phase.value = 'done'
}

async function removeSession(id: number) {
  await examStore.deleteSession(id)
}

function backToIntro() {
  phase.value = 'intro'
  currentSession.value = null
  examDetailItems.value = []
}
</script>

<style scoped lang="scss">
.exam-panel { border-radius: $radius-lg; box-shadow: $shadow-sm; }

.exam-intro {
  text-align: center;
  padding: 20px 0;

  .exam-badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 20px;
    background: $warning-light;
    color: $warning-color;
    margin-bottom: 16px;
  }
  .exam-title {
    font-size: 22px;
    font-weight: 800;
    color: $text-main;
    margin: 0 0 24px;
  }
}

.exam-meta {
  display: flex;
  justify-content: space-around;
  padding: 20px 0;
  border-top: 1px solid $border-light;
  border-bottom: 1px solid $border-light;
  margin-bottom: 20px;

  .meta-item {
    text-align: center;
    .meta-value { font-size: 24px; font-weight: 800; color: $primary-color; }
    .meta-label { font-size: 12px; color: $text-sub; margin-top: 4px; }
  }
}

.exam-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  background: $bg-color-hover;
  border-radius: 10px;
  margin-bottom: 20px;

  .config-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    .config-label { font-size: 13px; color: $text-main; }
  }
}

.session-history {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px dashed $border-light;
  text-align: left;

  .history-title {
    font-size: 13px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 10px;
  }

  .history-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-radius: 8px;
    background: $bg-color-hover;
    margin-bottom: 6px;
    font-size: 13px;

    .history-info {
      display: flex;
      gap: 12px;
      align-items: center;

      .history-index { color: $text-main; font-weight: 600; }
      .history-progress { color: $text-sub; }
      .history-rate {
        font-weight: 700;
        &.rate-good { color: $success-color; }
        &.rate-mid { color: $warning-color; }
        &.rate-bad { color: $danger-color; }
      }
      .history-status { color: $warning-color; font-size: 12px; }
    }
  }
}

.exam-result {
  text-align: center;
  padding: 20px 0;

  .result-icon { font-size: 56px; margin-bottom: 8px; }
  .result-title { font-size: 18px; font-weight: 700; color: $text-main; margin-bottom: 20px; }

  .result-score {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    .score-num { font-size: 48px; font-weight: 900; color: $primary-color; }
    .score-div { font-size: 28px; color: $text-muted; }
    .score-total { font-size: 28px; font-weight: 700; color: $text-sub; }
  }
  .result-rate { font-size: 13px; color: $text-sub; margin-top: 8px; }
  .result-time { font-size: 12px; color: $text-muted; margin-top: 4px; }
}

/* ✅ 结果详情 */
.result-section {
  margin-top: 24px;
  text-align: left;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  .section-title {
    font-size: 15px;
    font-weight: 800;
    &.wrong-title { color: $danger-color; }
    &.correct-title { color: $success-color; }
  }
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-card {
  border-radius: 10px;
  padding: 14px 16px;
  border-left: 4px solid $border-color;

  &.wrong {
    background: rgba(var(--danger-rgb), 0.04);
    border-left-color: $danger-color;
  }
  &.correct {
    background: rgba(var(--success-rgb), 0.04);
    border-left-color: $success-color;
  }
}

.detail-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;

  .detail-badge {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
    &.wrong-badge { background: $danger-color; color: $on-strong; }
    &.correct-badge { background: $success-color; color: $on-strong; }
  }

  .detail-question {
    font-size: 14px;
    font-weight: 600;
    color: $text-main;
    line-height: 1.5;
    flex: 1;
  }
}

.detail-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;

  .detail-opt {
    font-size: 13px;
    padding: 6px 10px;
    border-radius: 6px;
    background: $bg-color-hover;
    color: $text-sub;
    display: flex;
    align-items: center;
    gap: 8px;

    &.opt-correct {
      background: rgba(var(--success-rgb), 0.12);
      color: $success-color;
      font-weight: 700;
    }
    &.opt-wrong {
      background: rgba(var(--danger-rgb), 0.12);
      color: $danger-color;
      font-weight: 700;
    }

    .opt-mark {
      font-size: 11px;
      color: $text-muted;
      font-weight: 500;
    }
  }
}

.detail-answers {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .answer-row {
    font-size: 13px;
    padding: 6px 10px;
    border-radius: 6px;

    .answer-label {
      font-weight: 700;
      margin-right: 4px;
    }

    &.wrong-row {
      background: rgba(var(--danger-rgb), 0.1);
      color: $danger-color;
    }
    &.correct-row {
      background: rgba(var(--success-rgb), 0.1);
      color: $success-color;
    }
  }
}

.detail-explain {
  margin-top: 10px;
  padding: 8px 12px;
  background: $bg-color-hover;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: $text-sub;
}
</style>