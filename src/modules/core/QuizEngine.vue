<template>
  <div class="quiz-engine">
    <template v-if="currentQuestion">
      <div class="quiz-scroll">
        <div class="quiz-header">
          <span class="progress-text">第 {{ currentIndex + 1 }} / {{ questions.length }} 题</span>
          <div class="header-right">
            <span v-if="timeLimit > 0" class="timer" :class="{ 'timer-warning': remainingSeconds <= 60 }">
              ⏱ {{ formatTime(remainingSeconds) }}
            </span>
            <span v-else class="timer">
              ⏱ {{ formatTime(elapsedSeconds) }}
            </span>
            <span class="level-tag" :class="'level-' + (currentQuestion.metadata?.difficulty || '基础')">
              {{ currentQuestion.metadata?.difficulty || '基础' }}
            </span>
            <button v-if="examMode" class="exit-btn" @click="handleExit">✕</button>
          </div>
        </div>

        <div v-if="examMode" class="question-nav">
          <button
            v-for="(q, i) in questions"
            :key="q.id"
            class="nav-dot"
            :class="{
              'active': i === currentIndex,
              'answered': isAnswered(q.id),
            }"
            :title="`第 ${i + 1} 题`"
            @click="jumpTo(i)"
          >
            {{ i + 1 }}
          </button>
        </div>

        <div v-if="currentQuestion.type === 'judge' && !judgeParts" class="judge-hint">请判断下列说法是否正确：</div>
        <QuestionText
          class="question-text"
          :text="judgeParts ? judgeParts.material : currentQuestion.question"
        />

        <div v-if="currentQuestion.type === 'single'" class="options">
          <n-radio-group v-model:value="userAnswer" name="quiz-single">
            <n-space vertical style="width: 100%;">
              <n-radio v-for="opt in currentQuestion.options" :key="opt" :value="opt.charAt(0)" class="opt-item">
                {{ opt }}
              </n-radio>
            </n-space>
          </n-radio-group>
        </div>

        <div v-else-if="currentQuestion.type === 'multiple'" class="options">
          <n-checkbox-group v-model:value="userAnswer">
            <n-space vertical style="width: 100%;">
              <n-checkbox v-for="opt in currentQuestion.options" :key="opt" :value="opt.charAt(0)" class="opt-item">
                {{ opt }}
              </n-checkbox>
            </n-space>
          </n-checkbox-group>
          <div class="multi-hint">💡 多选题：请选择所有正确答案</div>
        </div>

        <div v-else-if="currentQuestion.type === 'blank'" class="fill-blank">
          <n-input v-model:value="userAnswer" placeholder="请输入你的答案..." size="large" @keyup.enter="onInputEnter" />
        </div>

        <div v-else-if="currentQuestion.type === 'judge'" :class="['judge-group', judgeParts ? 'judge-group--multi' : '']">
          <!-- 多陈述判断题：逐句判断。judgeParts 解析失败时为 null → 降级成整块题干 -->
          <ol v-if="judgeParts" class="judge-stmts">
            <li v-for="(s, i) in judgeParts.statements" :key="i" class="judge-stmt">
              <span class="judge-stmt__idx">{{ i + 1 }}</span>
              <QuestionText class="judge-stmt__text" :text="s" />
              <n-button-group class="judge-stmt__btns">
                <n-button
                  size="small"
                  :type="userAnswer[i] === '对' ? 'success' : 'default'"
                  @click="setJudgeAt(i, '对')"
                >✅ {{ judgeLabel.t }}</n-button>
                <n-button
                  size="small"
                  :type="userAnswer[i] === '错' ? 'error' : 'default'"
                  @click="setJudgeAt(i, '错')"
                >❌ {{ judgeLabel.f }}</n-button>
              </n-button-group>
            </li>
          </ol>
          <n-button-group v-else>
            <n-button :type="userAnswer === '对' ? 'success' : 'default'" size="large" style="min-width: 120px;" @click="userAnswer = '对'">✅ {{ judgeLabel.t }}</n-button>
            <n-button :type="userAnswer === '错' ? 'error' : 'default'" size="large" style="min-width: 120px;" @click="userAnswer = '错'">❌ {{ judgeLabel.f }}</n-button>
          </n-button-group>
        </div>

        <div v-else-if="currentQuestion.type === 'matching'" class="matching-group">
          <div v-for="(leftItem, i) in currentQuestion.left" :key="i" class="matching-row">
            <span class="matching-left">{{ leftItem }}</span>
            <span class="matching-arrow">→</span>
            <n-select v-model:value="userAnswer[i]" :options="rightOptions" size="medium" placeholder="请选择" style="width: 200px;" />
          </div>
        </div>

        <div v-else-if="currentQuestion.type === 'spelling'" class="spelling-group">
          <div v-if="currentQuestion.hint" class="spelling-hint">提示：{{ currentQuestion.hint }}</div>
          <n-input v-model:value="userAnswer" placeholder="请输入完整单词..." size="large" @keyup.enter="onInputEnter" />
        </div>

        <div v-else-if="currentQuestion.type === 'essay'" class="essay-group">
          <div class="essay-hint">✍️ 主观题：请先写下你的答案，提交后对照参考答案自评</div>
          <n-input
            v-model:value="userAnswer"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 9 }"
            placeholder="在这里写下你的答案…"
          />
        </div>

        <div v-if="!examMode && showFeedback" class="feedback-box" :class="feedbackClass">
          <p class="feedback-title">{{ feedbackTitle }}</p>
          <p v-if="!isCorrect || isEssay" class="user-answer">你的答案：{{ userAnswerDisplay || '（未作答）' }}</p>
          <p class="correct-answer">{{ isEssay ? '参考答案' : '正确答案' }}：{{ correctAnswerDisplay }}</p>
          <p v-if="currentQuestion.explanation" class="explanation">💡 解析：{{ currentQuestion.explanation }}</p>

          <div v-if="isEssay && selfRating === null" class="self-rate">
            <span class="self-rate-tip">对照参考答案，你觉得自己答得怎么样？</span>
            <div class="self-rate-btns">
              <n-button size="small" type="success" @click="rateSelf(true)">✅ 我答对了</n-button>
              <n-button size="small" @click="rateSelf(false)">📖 需要复习</n-button>
            </div>
          </div>
          <p v-else-if="isEssay" class="self-rate-result">
            你的自评：{{ selfRating ? '✅ 答对了' : '📖 需要复习' }}
          </p>
        </div>

        <div v-if="examMode" class="exam-progress-hint">
          已作答 {{ localAnsweredCount }} / {{ questions.length }} 题
        </div>
      </div>

      <div class="quiz-actions">
        <template v-if="!examMode">
          <AppButton v-if="!showFeedback" type="primary" block size="large" @click="submitAnswer" :disabled="!canSubmit">
            提交答案
          </AppButton>
          <AppButton v-else type="success" block size="large" @click="nextQuestion">
            {{ currentIndex === questions.length - 1 ? '🏁 完成练习' : '下一题 ➡️' }}
          </AppButton>
        </template>

        <template v-else>
          <AppButton type="primary" block size="large" @click="examNext" :disabled="!canSubmit">
            {{ isLastQuestion ? '🏁 提交试卷' : '下一题 ➡️' }}
          </AppButton>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  NRadioGroup, NRadio, NCheckboxGroup, NCheckbox, NSpace,
  NButton, NButtonGroup, NInput, NSelect,
} from 'naive-ui'
import { correctFeedback, wrongFeedback } from '@core/motivation/encouragement'
import AppButton from '@/components/ui/AppButton.vue'
import QuestionText from '@/components/QuestionText.vue'
import {
  gradeJudge, isMultiJudge, judgeLabels, normalizeJudgeList,
  formatJudgeTokens, splitJudgeStatements,
} from '@core/quiz/judge'
// 填空判分已抽到纯函数 @core/quiz/blank（SFC 内部不可测，见该文件头）
import { gradeBlank } from '@core/quiz/blank'

export type QuizQuestionType = 'single' | 'blank' | 'multiple' | 'judge' | 'matching' | 'spelling' | 'essay'

export interface QuizQuestion {
  id: string
  type: QuizQuestionType
  question: string
  options?: string[]
  answer: string | string[] | number[]
  explanation: string
  knowledgePointIds?: string[]
  left?: string[]
  right?: string[]
  hint?: string
  metadata?: { difficulty?: string }
}

export interface AnswerPayload {
  exerciseId: string
  knowledgePointIds: string[]
  isCorrect: boolean
  userAnswer: string
  correctAnswer: string
  /** P0 · 本题作答耗时（毫秒）：用于 FSRS「轻松 / 记得」的自动推断 */
  elapsedMs?: number
}

/** ✅ 新增：考试详情 */
export interface ExamDetailItem {
  questionId: string
  question: string
  type: QuizQuestionType
  options?: string[]
  userAnswer: string
  correctAnswer: string
  isCorrect: boolean
  explanation: string
}
export interface ExamDetailPayload {
  items: ExamDetailItem[]
}

const props = withDefaults(defineProps<{
  questions: QuizQuestion[]
  packageId: string
  examMode?: boolean
  initialAnswers?: Record<string, { userAnswer: any; isCorrect: boolean }>
  initialIndex?: number
  startedAt?: number
  timeLimit?: number
  sessionId?: number
}>(), {
  examMode: false,
  initialAnswers: () => ({}),
  initialIndex: 0,
  startedAt: 0,
  timeLimit: 0,
  sessionId: undefined,
})

const emit = defineEmits<{
  (e: 'answer', payload: AnswerPayload): void
  (e: 'finish', correctCount: number): void
  (e: 'exam-detail', payload: ExamDetailPayload): void
  (e: 'save-progress', patch: { currentIndex: number; elapsedSeconds: number; examAnswers?: Record<string, any> }): void
  (e: 'exit'): void
}>()

const currentIndex = ref(props.initialIndex)
const userAnswer = ref<any>('')
const showFeedback = ref(false)
const isCorrect = ref(false)
const correctCount = ref(0)
const answeredSet = ref<Set<number>>(new Set())
const examAnswers = ref<Record<string, any>>({})

/** P0 · 当前这一题开始作答的时刻，用于算作答耗时 */
const questionStartedAt = ref<number>(Date.now())
/** 本题自开始作答起已经过去多少毫秒 */
function currentElapsedMs(): number {
  const ms = Date.now() - questionStartedAt.value
  return ms > 0 && ms < 3600000 ? ms : 0
}

const elapsedSeconds = ref(props.startedAt ?? 0)
const remainingSeconds = ref(props.timeLimit > 0 ? props.timeLimit - (props.startedAt ?? 0) : 0)
let timerHandle: number | null = null

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function startTimer() {
  stopTimer()
  timerHandle = window.setInterval(() => {
    elapsedSeconds.value++
    if (props.timeLimit > 0) {
      remainingSeconds.value = Math.max(0, props.timeLimit - elapsedSeconds.value)
      if (remainingSeconds.value <= 0) {
        stopTimer()
        handleTimeUp()
      }
    }
  }, 1000)
}

function stopTimer() {
  if (timerHandle !== null) {
    clearInterval(timerHandle)
    timerHandle = null
  }
}

function handleTimeUp() {
  if (props.examMode) finalizeExam()
}

/**
 * 判断题归一化/判分已抽到 `@core/quiz/judge`（纯函数，可单测）。
 * 旧实现在此处对数组做 `String(a)` 降级 → `"F,T,F,T"` 恒不匹配 → 多陈述判断题永远判错。
 */
/** 切题/重置时的空作答初值：多陈述判断题按句数建数组（与 `matching` 同型） */
function blankAnswerFor(q: QuizQuestion): any {
  if (q.type === 'multiple') return []
  if (q.type === 'matching') return new Array(q.left?.length ?? 0).fill(null)
  if (q.type === 'judge' && isMultiJudge(q.answer)) {
    return new Array(normalizeJudgeList(q.answer).length).fill(null)
  }
  return ''
}

/** 多陈述判断题：把题干切成「材料」+「陈述句列表」；解析不了返回 null（降级整块显示） */
const judgeParts = computed(() => {
  const q = currentQuestion.value
  if (!q || q.type !== 'judge' || !isMultiJudge(q.answer)) return null
  return splitJudgeStatements(q.question, normalizeJudgeList(q.answer).length)
})

/** 判断题按钮文案取自题目标签域：`options:["T","F"]` → T/F，否则 对/错 */
const judgeLabel = computed(() => judgeLabels(currentQuestion.value?.options))

function setJudgeAt(i: number, v: string) {
  if (!Array.isArray(userAnswer.value)) userAnswer.value = []
  userAnswer.value[i] = v
}

// 题干渲染已抽到 <QuestionText>（纯函数 @core/quiz/questionText）：
// 真实换行 → <br>、GFM 表格 → <table>，其余按纯文本转义。

// 填空判分（normalizeBlank / stripParentheses / gradeBlank）已抽到
// @core/quiz/blank —— 原实现埋在本 SFC 内，因 vitest 是 node 环境、
// 无 jsdom / @vue/test-utils，导致 1340 道填空题长期 0 条单测。

function gradeWith(q: QuizQuestion, ua: any): boolean {
  if (!q) return false
  switch (q.type) {
    case 'single':
    case 'spelling':
      return String(ua ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase()
    case 'blank':
      return gradeBlank(String(ua ?? ''), String(q.answer ?? ''))
    case 'multiple': {
      const correctRaw = Array.isArray(q.answer) ? q.answer : String(q.answer).split('')
      const correct = correctRaw.map(x => String(x).trim().toUpperCase()).sort()
      const given = (Array.isArray(ua) ? ua : []).map(x => String(x).trim().toUpperCase()).sort()
      if (correct.length !== given.length) return false
      return correct.every((v, i) => v === given[i])
    }
    case 'judge':
      // 多陈述（`answer` 为数组）与单陈述统一由 gradeJudge 处理；全对才算对
      return gradeJudge(ua, q.answer)
    case 'matching': {
      if (!Array.isArray(ua) || !Array.isArray(q.answer)) return false
      if (ua.length !== q.answer.length) return false
      return ua.every((v, i) => Number(v) === Number(q.answer[i]))
    }
    default:
      return false
  }
}

function formatUserAnswer(q: QuizQuestion, ua: any): string {
  if (!q) return ''
  switch (q.type) {
    case 'multiple':
      return Array.isArray(ua) ? ua.slice().sort().join('') : ''
    case 'judge':
      return formatJudgeTokens(normalizeJudgeList(ua), q.options)
    case 'matching':
      if (!Array.isArray(ua) || !q.left || !q.right) return ''
      return ua.map((idx, i) => `${q.left![i]} → ${q.right![idx] ?? '?'}`).join('；')
    default:
      return String(ua ?? '')
  }
}

const currentQuestion = computed(() => props.questions[currentIndex.value])
const isLastQuestion = computed(() => currentIndex.value === props.questions.length - 1)
const localAnsweredCount = computed(() => Object.keys(examAnswers.value).length)

/** ✅ 主观题（essay）自评：null = 未自评 */
const selfRating = ref<boolean | null>(null)
const isEssay = computed(() => currentQuestion.value?.type === 'essay')

const feedbackClass = computed(() => {
  if (isEssay.value) return selfRating.value === false ? 'review' : 'reference'
  return isCorrect.value ? 'correct' : 'wrong'
})

const feedbackTitle = computed(() => {
  if (isEssay.value) return '📖 参考答案 · 请对照自评'
  // 用题号做种子：同一题内文案稳定，不同题目之间会轮换
  return isCorrect.value ? correctFeedback(currentIndex.value) : wrongFeedback(currentIndex.value)
})

const rightOptions = computed(() => {
  const right = currentQuestion.value?.right ?? []
  return right.map((text, idx) => ({ label: text, value: idx }))
})

const canSubmit = computed(() => {
  const q = currentQuestion.value
  if (!q) return false
  switch (q.type) {
    case 'single':
    case 'blank':
    case 'spelling':
    case 'essay':
      return !!userAnswer.value && String(userAnswer.value).trim() !== ''
    case 'judge':
      // 多陈述：必须每一句都选了才允许提交（不允许漏句蒙对）
      if (isMultiJudge(q.answer)) {
        const n = normalizeJudgeList(q.answer).length
        return (
          Array.isArray(userAnswer.value) &&
          userAnswer.value.length === n &&
          userAnswer.value.every((v: any) => v !== null && v !== undefined)
        )
      }
      return !!userAnswer.value && String(userAnswer.value).trim() !== ''
    case 'multiple':
      return Array.isArray(userAnswer.value) && userAnswer.value.length > 0
    case 'matching':
      return Array.isArray(userAnswer.value) && userAnswer.value.length > 0 && userAnswer.value.every((v: any) => v !== null && v !== undefined)
    default:
      return false
  }
})

const userAnswerDisplay = computed(() => {
  const q = currentQuestion.value
  if (!q) return ''
  return formatUserAnswer(q, userAnswer.value)
})

const correctAnswerDisplay = computed(() => {
  const q = currentQuestion.value
  if (!q) return ''
  switch (q.type) {
    case 'multiple': {
      const arr = Array.isArray(q.answer) ? q.answer : String(q.answer).split('')
      return arr.slice().sort().join('')
    }
    case 'judge':
      return formatJudgeTokens(normalizeJudgeList(q.answer), q.options)
    case 'matching':
      if (!Array.isArray(q.answer) || !q.left || !q.right) return ''
      return q.answer.map((idx, i) => `${q.left![i]} → ${q.right![Number(idx)] ?? '?'}`).join('；')
    default:
      return String(q.answer)
  }
})

function isAnswered(qid: string): boolean {
  const ua = examAnswers.value[qid]
  if (ua === undefined || ua === null) return false
  if (Array.isArray(ua)) return ua.length > 0 && ua.every(v => v !== null && v !== undefined)
  return String(ua).trim() !== ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.code !== 'Space' && e.key !== ' ') return
  const q = currentQuestion.value
  if (!q) return

  if (q.type === 'blank' || q.type === 'spelling' || q.type === 'essay') {
    const target = e.target as HTMLElement | null
    if (target) {
      const tag = target.tagName
      if (tag === 'TEXTAREA' || target.isContentEditable) return
      if (tag === 'INPUT') {
        const t = (target as HTMLInputElement).type
        if (t === 'text' || t === 'number' || t === 'search' || t === 'password') return
      }
    }
  }

  e.preventDefault()
  e.stopPropagation()

  if (!props.examMode) {
    if (showFeedback.value) nextQuestion()
    else if (canSubmit.value) submitAnswer()
  } else {
    if (canSubmit.value) examNext()
  }
}

onMounted(() => {
  if (props.initialAnswers) {
    for (const [qid, data] of Object.entries(props.initialAnswers)) {
      if (props.examMode) examAnswers.value[qid] = data.userAnswer
    }
    if (!props.examMode) {
      props.questions.forEach((q, idx) => {
        if (props.initialAnswers![q.id]) answeredSet.value.add(idx)
      })
      correctCount.value = Object.values(props.initialAnswers).filter(a => a.isCorrect).length
    }
  }
  startTimer()
  window.addEventListener('keydown', onKeydown, true)
})

onUnmounted(() => {
  stopTimer()
  window.removeEventListener('keydown', onKeydown, true)
  emit('save-progress', {
    currentIndex: currentIndex.value,
    elapsedSeconds: elapsedSeconds.value,
    examAnswers: props.examMode ? { ...examAnswers.value } : undefined,
  })
})

watch(currentQuestion, (q) => {
  if (!q) return
  selfRating.value = null
  questionStartedAt.value = Date.now()

  if (props.examMode) {
    const saved = examAnswers.value[q.id]
    if (saved !== undefined) userAnswer.value = saved
    else {
      userAnswer.value = blankAnswerFor(q)
    }
  } else {
    const saved = props.initialAnswers?.[q.id]
    if (saved) {
      userAnswer.value = saved.userAnswer
      showFeedback.value = false
      return
    }
    if (q.type === 'multiple') userAnswer.value = []
    else if (q.type === 'matching') userAnswer.value = new Array(q.left?.length ?? 0).fill(null)
    else userAnswer.value = ''
  }
  showFeedback.value = false
}, { immediate: true })

watch(currentIndex, (idx) => {
  emit('save-progress', {
    currentIndex: idx,
    elapsedSeconds: elapsedSeconds.value,
    examAnswers: props.examMode ? { ...examAnswers.value } : undefined,
  })
})

function submitAnswer() {
  if (!currentQuestion.value || showFeedback.value || !canSubmit.value) return
  const q = currentQuestion.value
  showFeedback.value = true

  // 主观题：不自动判分，先展示参考答案，由学生自评
  if (q.type === 'essay') {
    isCorrect.value = true
    return
  }

  isCorrect.value = gradeWith(q, userAnswer.value)
  if (isCorrect.value) correctCount.value++

  if (!answeredSet.value.has(currentIndex.value)) {
    answeredSet.value.add(currentIndex.value)
    emit('answer', {
      exerciseId: q.id,
      knowledgePointIds: Array.isArray(q.knowledgePointIds) ? q.knowledgePointIds : [],
      isCorrect: isCorrect.value,
      userAnswer: userAnswerDisplay.value,
      correctAnswer: correctAnswerDisplay.value,
      elapsedMs: currentElapsedMs(),
    })
  }
}

/** ✅ 主观题自评：记录对错（自评「需要复习」进错题本，答对则计分） */
function rateSelf(ok: boolean) {
  const q = currentQuestion.value
  if (!q || q.type !== 'essay' || selfRating.value !== null) return
  selfRating.value = ok
  isCorrect.value = ok
  if (ok) correctCount.value++

  emit('answer', {
    exerciseId: q.id,
    knowledgePointIds: Array.isArray(q.knowledgePointIds) ? q.knowledgePointIds : [],
    isCorrect: ok,
    userAnswer: userAnswerDisplay.value,
    correctAnswer: correctAnswerDisplay.value,
    elapsedMs: currentElapsedMs(),
  })
}

function nextQuestion() {
  if (currentIndex.value < props.questions.length - 1) {
    currentIndex.value++
  } else {
    emit('finish', correctCount.value)
  }
}

function onInputEnter() {
  if (props.examMode) {
    if (canSubmit.value) examNext()
  } else {
    if (canSubmit.value && !showFeedback.value) submitAnswer()
  }
}

function jumpTo(index: number) {
  if (index === currentIndex.value) return
  const q = currentQuestion.value
  if (q && canSubmit.value) examAnswers.value[q.id] = userAnswer.value
  else if (q) delete examAnswers.value[q.id]
  currentIndex.value = index
}

function examNext() {
  if (!currentQuestion.value || !canSubmit.value) return
  examAnswers.value[currentQuestion.value.id] = userAnswer.value
  if (currentIndex.value < props.questions.length - 1) currentIndex.value++
  else finalizeExam()
}

/** ✅ 统一提交：判分 + 逐题 emit + exam-detail 事件 */
function finalizeExam() {
  const q = currentQuestion.value
  if (q && canSubmit.value) examAnswers.value[q.id] = userAnswer.value

  let correct = 0
  const items: ExamDetailItem[] = []

  for (const question of props.questions) {
    // 主观题不计入考试判分
    if (question.type === 'essay') continue

    const ua = examAnswers.value[question.id]
    const ok = gradeWith(question, ua)
    if (ok) correct++

    const userAnswerText = formatUserAnswer(question, ua)
    const correctAnswerText = String(question.answer)

    // 逐题上报（用于错题本）
    emit('answer', {
      exerciseId: question.id,
      knowledgePointIds: Array.isArray(question.knowledgePointIds) ? question.knowledgePointIds : [],
      isCorrect: ok,
      userAnswer: userAnswerText,
      correctAnswer: correctAnswerText,
    })

    // ✅ 收集详情
    items.push({
      questionId: question.id,
      question: question.question,
      type: question.type,
      options: question.options,
      userAnswer: userAnswerText,
      correctAnswer: correctAnswerText,
      isCorrect: ok,
      explanation: question.explanation,
    })
  }

  correctCount.value = correct
  stopTimer()

  // ✅ 先发详情，再发 finish
  emit('exam-detail', { items })
  emit('finish', correct)
}

function handleExit() {
  stopTimer()
  emit('exit')
}
</script>

<style scoped lang="scss">
.quiz-engine {
  display: flex;
  flex-direction: column;
  min-height: 320px;
  padding-bottom: 80px;
}

.quiz-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.progress-text { color: $text-sub; font-size: 14px; font-weight: 600; }

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  .timer {
    font-family: 'Consolas', monospace;
    font-size: 14px;
    font-weight: 700;
    color: $primary-text;
    padding: 3px 10px;
    background: $primary-light;
    border-radius: 6px;
    &.timer-warning {
      color: $danger-text;
      background: $danger-light;
      animation: pulse 1s infinite;
    }
  }
  .exit-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    background: $bg-color-hover;
    color: $text-sub;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
    &:hover { background: $danger-light; color: $danger-text; }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.question-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 0 12px;
  margin-bottom: 8px;
  border-bottom: 1px dashed $border-light;

  .nav-dot {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1.5px solid $border-color;
    background: $card-bg;
    color: $text-sub;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      border-color: $primary-color;
      color: $primary-text;
    }
    &.answered {
      background: $primary-light;
      border-color: $primary-color;
      color: $primary-text;
    }
    &.active {
      background: $primary-color;
      border-color: $primary-color;
      color: var(--text-on-primary);
      box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.35);
      transform: scale(1.08);
    }
    &.active.answered {
      background: $primary-hover;
    }
  }
}

.level-tag {
  font-size: 13px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 20px;
  &.level-基础 { background: $success-light; color: $success-text; }
  &.level-提高 { background: $warning-light; color: $warning-text; }
  &.level-挑战 { background: $danger-light; color: $danger-text; }
}

.judge-hint { font-size: 14px; color: $text-sub; margin-bottom: 6px; }

.question-text {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 16px;
  line-height: 1.55;
  color: $text-main;
}

.opt-item {
  margin-bottom: 8px;
  padding: 12px 16px;
  width: 100%;
  border: 2px solid $border-color;
  border-radius: 10px;
  transition: all 0.15s;
  font-size: 15px;
  line-height: 1.5;
  min-height: 52px;
  display: flex;
  align-items: center;

  &:hover { border-color: $primary-color; background: $primary-light; }
}

:deep(.n-space.n-space--vertical) {
  gap: 0 !important;
}

.multi-hint {
  font-size: 13px;
  color: $warning-text;
  margin-top: 8px;
  font-weight: 600;
}

.judge-group { display: flex; justify-content: center; padding: 16px 0; }
/* 多陈述：整块列表，不再居中 */
.judge-group--multi { display: block; }

/* ---- 多陈述判断题：逐句 T/F ---- */
.judge-stmts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.judge-stmt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid $border-color;
  border-radius: var(--radius-md);
  background: var(--card-bg);
}

.judge-stmt__idx {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  /* 实心语义底统一走 -text + text-on-primary（批 6a-2 约定） */
  background: var(--primary-text);
  color: var(--text-on-primary);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.judge-stmt__text {
  flex: 1;
  font-size: 15px;
  line-height: 1.6;
  color: $text-main;
}

.judge-stmt__btns { flex: none; }

.matching-group {
  display: flex; flex-direction: column; gap: 10px;
  .matching-row {
    display: flex; align-items: center; gap: 12px;
    .matching-left {
      flex: 1; font-size: 15px; font-weight: 600; color: $text-main;
      padding: 10px 14px; background: $bg-color-hover; border-radius: 6px;
    }
    .matching-arrow { color: $text-sub; font-size: 16px; }
  }
}

.spelling-group {
  .spelling-hint {
    font-size: 15px; color: $primary-text; background: $primary-light;
    padding: 8px 14px; border-radius: 6px; margin-bottom: 12px;
    font-family: 'Times New Roman', monospace; letter-spacing: 2px;
  }
}

.essay-group {
  .essay-hint {
    font-size: 13px; color: $primary-text; background: $primary-light;
    padding: 8px 14px; border-radius: 6px; margin-bottom: 10px;
  }
  :deep(.n-input) { font-size: 15px; line-height: 1.8; }
}

.feedback-box {
  margin-top: 16px;
  padding: 14px 18px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.65;
}
.feedback-box.correct { background: $success-light; border: 1px solid $success-color; }
.feedback-box.wrong { background: $danger-light; border: 1px solid $danger-color; }
.feedback-box.reference { background: $primary-light; border: 1px solid $primary-color; }
.feedback-box.review { background: $warning-light; border: 1px solid $warning-color; }

.self-rate {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed $border-color;

  .self-rate-tip {
    display: block;
    font-size: 13px;
    color: $text-sub;
    margin-bottom: 8px;
  }
  .self-rate-btns { display: flex; gap: 10px; flex-wrap: wrap; }
}
.self-rate-result {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 700;
  color: $text-main;
}

.feedback-title {
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 8px;
}
.user-answer {
  font-size: 14px;
  color: $text-sub;
  margin-bottom: 4px;
}
.correct-answer {
  font-weight: 700;
  color: $danger-text;
  margin-bottom: 8px;
  font-size: 15px;
}

.explanation {
  font-size: 14px;
  color: $text-main;
  line-height: 1.7;
  background: rgba(var(--on-strong-rgb), 0.65);
  padding: 10px 14px;
  border-radius: 8px;
  margin-top: 8px;
}

.exam-progress-hint {
  text-align: center;
  font-size: 13px;
  color: $text-sub;
  margin-top: 12px;
}

.quiz-actions {
  position: fixed;
  left: 240px;
  right: 0;
  bottom: 0;
  padding: 12px 24px;
  background: var(--card-bg);
  border-top: 1px solid $border-color;
  box-shadow: $shadow-up;
  z-index: 90;
  display: flex;
  justify-content: center;
}

.quiz-actions > :deep(.n-button) {
  max-width: 720px;
}

@media (max-width: 1023px) {
  .quiz-actions {
    left: 0;
    bottom: 68px;
    padding: 10px 16px;
  }
}

body.dark-mode {
  .feedback-box.correct { background: rgba(var(--success-rgb), 0.15); }
  .feedback-box.wrong { background: rgba(var(--danger-rgb), 0.15); }
  .feedback-box.reference { background: rgba(var(--primary-rgb), 0.15); }
  .feedback-box.review { background: rgba(var(--warning-rgb), 0.15); }
  .self-rate { border-top-color: rgba(var(--on-strong-rgb), 0.12); }
  .explanation { background: rgba(var(--on-strong-rgb), 0.06); }
  .question-nav .nav-dot {
    background: $card-bg;
    border-color: $border-color;
    color: $text-sub;
    &.answered {
      background: rgba(var(--primary-rgb), 0.2);
      border-color: $primary-color;
      color: $primary-text;
    }
    &.active {
      background: $primary-color;
      color: var(--text-on-primary);
    }
  }
}
</style>