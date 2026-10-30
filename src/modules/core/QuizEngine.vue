<template>
  <!--
    V1.6 · Stage D · D3 —— 键盘交互挂在**根容器**上，不再挂 window（capture）。

    为什么必须换挂载点：`TopicDetail.vue` 会同时挂两个 QuizEngine（前置热身
    `v-if="warmupOpen"` + 常驻的同步练习）。window 级监听无法区分实例，一次按键
    两个引擎的处理器都会跑（`stopPropagation` 拦不住同一节点上的其它监听）→
    「按一次空格推进两题」。容器级监听天生按实例隔离：事件只有从本实例的子树里
    冒泡上来才会被处理。

    `tabindex="-1"`：让根容器可以被**编程**聚焦（submit / 切题后把焦点收回来，
    否则交卷瞬间"提交"按钮被销毁、"下一题"按钮新建，焦点掉到 body，后续按键
    根本冒泡不到这里），但**不进入 Tab 序列**，不影响键盘导航顺序。
  -->
  <div
    ref="rootRef"
    class="quiz-engine"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <template v-if="currentQuestion">
      <div ref="scrollRef" class="quiz-scroll">
        <div class="quiz-header">
          <span class="progress-text">第 {{ currentIndex + 1 }} / {{ questions.length }} 题</span>
          <div class="header-right">
            <span v-if="timeLimit > 0" class="timer" :class="timerTone">
              ⏱ {{ formatTime(remainingSeconds) }}
            </span>
            <span v-else class="timer">
              ⏱ {{ formatTime(elapsedSeconds) }}
            </span>
            <span class="level-tag" :class="'level-' + (currentQuestion.metadata?.difficulty || '基础')">
              {{ currentQuestion.metadata?.difficulty || '基础' }}
            </span>
            <!--
              V2.1 · 沉浸式专注模式入口：进入后隐藏布局外壳（AppShell 响应 isFocusMode），
              并尝试浏览器全屏（被拒/不支持时静默降级，仅隐藏侧栏）。
            -->
            <button
              class="focus-btn"
              type="button"
              data-testid="focus-toggle"
              :aria-pressed="uiStore.isFocusMode"
              @click="toggleFocusMode"
            >{{ uiStore.isFocusMode ? '✕ 退出专注' : '⛶ 专注模式' }}</button>
            <!--
              V2.0 · 答题卡入口。考试模式不显示：那里已经有常驻的 `.question-nav`
              题号条（ExamPanel 的布局不能动），再放一个入口只会多一层弹窗。
            -->
            <button v-if="!examMode" class="sheet-btn" type="button" @click="sheetOpen = true">
              📇 答题卡
            </button>
            <button v-if="examMode" class="exit-btn" aria-label="退出练习" @click="handleExit">✕</button>
          </div>
        </div>

        <div v-if="examMode" class="question-nav">
          <!-- V2.8 · 对标参考图3 答题卡：图例 + 数字网格 + 已答进度微条 -->
          <div class="nav-head">
            <span class="nav-caption">答题卡</span>
            <span class="nav-legend" aria-hidden="true">
              <i class="legend-swatch swatch-done" />已答 {{ navAnsweredCount }}
              <i class="legend-swatch swatch-todo" />未答 {{ questions.length - navAnsweredCount }}
            </span>
          </div>
          <div class="nav-grid">
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
          <div class="nav-progress" role="presentation">
            <div class="nav-progress-fill" :style="{ width: navProgressPercent + '%' }" />
          </div>
        </div>

        <div v-if="currentQuestion.type === 'judge' && !judgeParts" class="judge-hint">请判断下列说法是否正确：</div>
        <QuestionText
          class="question-text"
          :text="judgeParts ? judgeParts.material : currentQuestion.question"
          :package-id="currentQuestion.packageId || packageId"
          :image="currentQuestion.image"
          :image-alt="currentQuestion.imageAlt"
        />

        <div v-if="currentQuestion.type === 'single'" class="options">
          <n-radio-group v-model:value="userAnswer" name="quiz-single">
            <n-space vertical style="width: 100%;">
              <n-radio v-for="opt in currentQuestion.options" :key="opt" :value="opt.charAt(0)" class="opt-item" :class="optionState(opt)">
                {{ opt }}
              </n-radio>
            </n-space>
          </n-radio-group>
        </div>

        <div v-else-if="currentQuestion.type === 'multiple'" class="options">
          <n-checkbox-group v-model:value="userAnswer">
            <n-space vertical style="width: 100%;">
              <n-checkbox v-for="opt in currentQuestion.options" :key="opt" :value="opt.charAt(0)" class="opt-item" :class="optionState(opt)">
                {{ opt }}
              </n-checkbox>
            </n-space>
          </n-checkbox-group>
          <div class="multi-hint">💡 多选题：请选择所有正确答案</div>
        </div>

        <div v-else-if="currentQuestion.type === 'blank'" class="fill-blank">
          <div class="answer-row">
            <n-input
              ref="answerInputRef"
              v-model:value="userAnswer"
              placeholder="请输入你的答案..."
              size="large"
              @keyup.enter="onInputEnter"
            />
            <n-button
              v-if="canSpeak && speechSupported"
              class="speak-btn"
              secondary
              type="primary"
              @click="speakAnswer"
            >🔊 听发音</n-button>
          </div>
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
            <n-select v-model:value="userAnswer[i]" :options="rightOptions" size="medium" placeholder="请选择" class="matching-select" />
          </div>
        </div>

        <div v-else-if="currentQuestion.type === 'spelling'" class="spelling-group">
          <div v-if="currentQuestion.hint" class="spelling-hint">提示：{{ currentQuestion.hint }}</div>
          <div class="answer-row">
            <n-input
              ref="answerInputRef"
              v-model:value="userAnswer"
              placeholder="请输入完整单词..."
              size="large"
              @keyup.enter="onInputEnter"
            />
            <n-button
              v-if="canSpeak && speechSupported"
              class="speak-btn"
              secondary
              type="primary"
              @click="speakAnswer"
            >🔊 听发音</n-button>
          </div>
        </div>

        <div v-else-if="currentQuestion.type === 'essay'" class="essay-group">
          <div class="essay-hint">
            ✍️ 主观题：请先写下你的答案，提交后系统会按得分点自动判分，并展示参考答案供对照
            <!-- 主观题用 Ctrl/Cmd + Enter 提交：普通 Enter 必须留给换行 -->
            <span class="essay-kbd-hint">（写完按 Ctrl / ⌘ + Enter 提交）</span>
          </div>
          <n-input
            ref="essayInputRef"
            v-model:value="userAnswer"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 9 }"
            placeholder="在这里写下你的答案…"
          />
        </div>

        <!--
          V1.6 · D3 · 解析播报：live region 必须**常驻**在 DOM 里，`v-if` 只加在内层
          `.feedback-box` 上。若把 `aria-live` 加在会被 `v-if` 新建的节点上，
          节点"新生"时读屏器往往不朗读（本仓范式见 ImportPreview.vue 的 `.import-live`）。
          首行 `.sr-only` 是给读屏器的确定结论（鼓励语文案本身不含"对/错"字样）。
        -->
        <div class="quiz-live" aria-live="polite" aria-atomic="true">
          <div v-if="!examMode && showFeedback" class="feedback-box" :class="feedbackClass">
            <p class="sr-only">{{ announceHead }}</p>
            <p class="feedback-title">{{ feedbackTitle }}</p>
            <p v-if="!isCorrect || isSubjectiveQ" class="user-answer">你的答案：{{ userAnswerDisplay || '（未作答）' }}</p>
            <p class="correct-answer">{{ isSubjectiveQ ? '参考答案' : '正确答案' }}：{{ correctAnswerDisplay }}</p>

            <!-- 主观题：得分点清单 + 系统判定 + 手动纠错 -->
            <div v-if="isSubjectiveQ && displayGrade" class="keypoints">
              <p class="keypoints-title">🎯 得分点（命中 {{ displayGrade.covered }}/{{ displayGrade.total }}）</p>
              <ul>
                <li
                  v-for="(kp, i) in displayGrade.keyPoints"
                  :key="i"
                  :class="displayGrade.missing.includes(kp) ? 'kp-miss' : 'kp-hit'"
                >
                  {{ displayGrade.missing.includes(kp) ? '✗' : '✓' }} {{ kp }}
                </li>
              </ul>
            </div>

            <p v-if="isSubjectiveQ" class="grade-verdict">
              系统判定：{{ displayGrade && displayGrade.correct ? '✅ 答对了' : '📖 还需努力' }}
            </p>
            <div v-if="isSubjectiveQ" class="override-btns">
              <span class="override-tip">判错了？可手动纠正：</span>
              <n-button size="small" type="success" @click="overrideGrade(true)">实际答对了</n-button>
              <n-button size="small" @click="overrideGrade(false)">实际还需复习</n-button>
            </div>

            <p v-if="currentQuestion.explanation" class="explanation">💡 解析：{{ currentQuestion.explanation }}</p>
          </div>
        </div>

        <div v-if="examMode" class="exam-progress-hint">
          已作答 {{ localAnsweredCount }} / {{ questions.length }} 题
        </div>
      </div>

      <!-- ============ V2.0 · 答题卡（仅练习模式） ============ -->
      <n-modal
        v-model:show="sheetOpen"
        preset="card"
        title="📇 答题卡"
        class="sheet-modal"
        style="max-width: 460px;"
      >
        <div class="sheet-legend">
          <span class="legend-item legend-correct">✅ 正确 {{ sheetStats.correct }}</span>
          <span class="legend-item legend-wrong">❌ 错误 {{ sheetStats.wrong }}</span>
          <span class="legend-item legend-todo">⬜ 未做 {{ sheetStats.todo }}</span>
        </div>
        <div class="sheet-grid">
          <button
            v-for="(q, i) in questions"
            :key="q.id"
            type="button"
            class="sheet-cell"
            :class="sheetCellClass(i)"
            :title="`第 ${i + 1} 题`"
            @click="openFromSheet(i)"
          >
            {{ i + 1 }}
          </button>
        </div>
        <p class="sheet-hint">点击已作答的题回看解析，点击未作答的题直接跳过去。</p>
      </n-modal>

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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  NRadioGroup, NRadio, NCheckboxGroup, NCheckbox, NSpace,
  NButton, NButtonGroup, NInput, NSelect, NModal,
} from 'naive-ui'
import { correctFeedback, wrongFeedback } from '@core/motivation/encouragement'
// V2.11 · 即时反馈（音效 + 震动）。考试模式不发声，见 submitAnswer 内的注释。
import { playCorrectFeedback, playWrongFeedback } from '@core/feedback'
// 听写朗读走统一的语音服务（含音色匹配与语种推断），不在组件里重复实现一套
import { isSpeechAvailable, speak as speakText } from '@core/audio/speechService'
import AppButton from '@/components/ui/AppButton.vue'
import QuestionText from '@/components/QuestionText.vue'
import {
  gradeJudge, isMultiJudge, judgeLabels, normalizeJudgeList,
  formatJudgeTokens, splitJudgeStatements,
} from '@core/quiz/judge'
// 填空判分已抽到纯函数 @core/quiz/blank（SFC 内部不可测，见该文件头）
import { gradeBlank } from '@core/quiz/blank'
// 主观题（essay + 标为主观的填空/拼写）按得分点覆盖度判分
import { gradeEssay, type EssayGradeResult } from '@core/quiz/essayGrade'
import { useUiStore } from '@core/stores/ui'

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
  /**
   * 主观题得分点（可选）。作者显式给出最准；缺省由参考答案自动抽取。
   * 用于 essay 及 `subjective: true` 的填空/拼写：按覆盖度判分 + 展示"你漏了哪几点"。
   * 每个得分点内部可用 `/` 或 `／` 写同义备选（如 "比喻/比拟"）。
   */
  keyPoints?: string[]
  /**
   * 把本题当主观题判分（仅对 blank / spelling 有意义）。
   * 语文阅读里的"短答填空"常需用词灵活，精确匹配会误判；标 true 后改走
   * `gradeEssay` 的得分点覆盖度判分，而非精确匹配。essay 类型恒为主观，无需标。
   */
  subjective?: boolean
  /**
   * 题干配图（V2.12）：包内相对路径，如 `assets/shape-01.png`。
   * 图片本体存在 IndexedDB 的 packageAssets 表，由 <QuestionImage> 按
   * `[packageId, image]` 取用；这里只留一个路径。
   */
  image?: string
  /** 画面描述（无障碍 / 朗读）；导入校验会为缺它的配图题发 W034 */
  imageAlt?: string
  /**
   * 本题**所属**包（V2.12，导入时由 normalizePackage 写入）。
   * 与 `props.packageId`（路由里的入口包）可能不同：依赖包的单元被合并进当前视图时，
   * 图片资产仍存在它自己的包里。缺省时回退到入口包，旧包没有这个字段也能跑。
   */
  packageId?: string
  /**
   * 听写朗读文本（P1，可选）：🔊 按钮优先朗读它，缺省则朗读 `answer`。
   * 用于"听音写词"场景想读与答案不同的内容（如读整句、读音标）。
   */
  dictationText?: string
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
  /** 配图路径（V2.12）：交卷后的详情页也要显示图，否则"数图形"题在复盘时等于没题 */
  image?: string
  imageAlt?: string
  /** 配图所属包（跨包时与入口包不同） */
  packageId?: string
  /**
   * 听写朗读文本（P1，可选）：🔊 按钮优先朗读它，缺省则朗读 `answer`。
   * 用于"听音写词"场景想读与答案不同的内容（如读整句、读音标）。
   */
  dictationText?: string
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
  /** V2.1 · 专注模式：本实例完成后是否自动退出专注（热身练习传 false，避免提前退出主练习的专注态） */
  exitFocusOnFinish?: boolean
}>(), {
  examMode: false,
  initialAnswers: () => ({}),
  initialIndex: 0,
  startedAt: 0,
  timeLimit: 0,
  sessionId: undefined,
  exitFocusOnFinish: true,
})

const emit = defineEmits<{
  (e: 'answer', payload: AnswerPayload): void
  (e: 'finish', correctCount: number): void
  (e: 'exam-detail', payload: ExamDetailPayload): void
  (e: 'save-progress', patch: { currentIndex: number; elapsedSeconds: number; examAnswers?: Record<string, any> }): void
  (e: 'exit'): void
}>()

const uiStore = useUiStore()

/** V2.1 · 沉浸式专注模式：进入并尝试全屏（失败静默降级），退出时一并退出全屏 */
function tryEnterFullscreen(): void {
  try {
    const el = document.documentElement
    const fn = el.requestFullscreen?.bind(el)
    if (fn) fn().catch(() => { /* 浏览器拒绝 / 不支持 → 仅隐藏侧栏 */ })
  } catch {
    /* 无 requestFullscreen（极旧环境）→ 静默降级 */
  }
}

function toggleFocusMode(): void {
  if (uiStore.isFocusMode) {
    uiStore.exitFocus()
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) } catch {}
  } else {
    uiStore.enterFocus()
    tryEnterFullscreen()
  }
}

/** 练习完成（finish）时按 prop 决定是否自动退出专注 */
function maybeExitFocusOnFinish(): void {
  if (props.exitFocusOnFinish) uiStore.exitFocus()
}

const currentIndex = ref(props.initialIndex)
const userAnswer = ref<any>('')
const showFeedback = ref(false)
const isCorrect = ref(false)
const correctCount = ref(0)
const answeredSet = ref<Set<number>>(new Set())
const examAnswers = ref<Record<string, any>>({})

/**
 * V2.0 · 练习模式的作答留档（`questionId → {userAnswer,isCorrect}`）。
 *
 * 为什么不能复用 `answeredSet`：那只是"第几题点过提交"的下标集合，没有对错，
 * 而答题卡要按题显示 正确 / 错误 / 未做 三态。
 * 为什么不复用 `examAnswers`：那张表只在考试模式维护，且**只有**原始答案
 * （对错要等到 `finalizeExam` 才算）—— 练习模式是逐题即时判分的，
 * 两者语义不同，混用会让考试判分与答题卡互相污染。
 *
 * 续传时由 `props.initialAnswers` 播种（与 `answeredSet` / `correctCount` 同源）。
 */
const practiceAnswers = ref<Record<string, { userAnswer: any; isCorrect: boolean }>>({})

/** 答题卡弹窗 */
const sheetOpen = ref(false)

/* ---------------------------------------------------------------------
 * V1.6 · D3 焦点管理（此前全仓 `src/` 零 `.focus()`，键盘用户交卷后焦点掉 body）
 * ------------------------------------------------------------------- */

/** 根容器（`tabindex="-1"`）：非输入型题目的焦点落点 + 键盘监听的挂载点 */
const rootRef = ref<HTMLElement | null>(null)
/** 题干滚动容器：切题后滚回题首 */
const scrollRef = ref<HTMLElement | null>(null)
/** 填空 / 拼写的输入框（两种题型只会渲染其一，共用一个 ref） */
const answerInputRef = ref<InstanceType<typeof NInput> | null>(null)
/** 主观题 textarea */
const essayInputRef = ref<InstanceType<typeof NInput> | null>(null)

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
      // 普通拼写 = 精确匹配；标为主观的拼写 = 按得分点覆盖度判分
      if (q.type === 'spelling' && q.subjective === true) {
        return gradeEssay(String(ua ?? ''), String(q.answer ?? ''), q.keyPoints).correct
      }
      return String(ua ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase()
    case 'blank':
      // 传原始值（不做 String 归一）：数组答案要靠 Array.isArray 按元素边界切段，
      // 斜杠备选（`aren't / are not`）要在空格被删前按 `\s+\/\s+` 切分。
      // 标为主观的填空（语文阅读短答）= 按得分点覆盖度判分，而非精确匹配。
      if (q.subjective === true) {
        return gradeEssay(String(ua ?? ''), String(q.answer ?? ''), q.keyPoints).correct
      }
      return gradeBlank(ua, q.answer)
    case 'essay':
      // 主观题：按得分点覆盖度（含整段相似度回退）判分，不再依赖孩子自评
      return gradeEssay(String(ua ?? ''), String(q.answer ?? ''), q.keyPoints).correct
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

/**
 * 🔊 听写/默写朗读（P1）：仅 blank / spelling 题型显示朗读按钮。
 * 朗读内容取 `answer`（英文单词默写场景里 answer 就是单词本身，
 * 听音写词正好用这个答案），有显式 `dictationText` 时优先用它。
 * 语种推断与音色匹配交给 `core/audio/speechService`：纯 ASCII → en-US，
 * 含中文 → zh-CN；`speak()` 内部已 feature-detect 并 cancel 上一段朗读。
 */
const canSpeak = computed(
  () => currentQuestion.value?.type === 'blank' || currentQuestion.value?.type === 'spelling',
)
const speechSupported = isSpeechAvailable()

function speakAnswer() {
  if (!currentQuestion.value) return
  const q = currentQuestion.value
  const text =
    (typeof q.dictationText === 'string' && q.dictationText.trim()) ||
    (Array.isArray(q.answer) ? String(q.answer[0]) : String(q.answer || ''))
  if (!text) return
  // 0.9 倍速：比默认慢一点，孩子听音写词跟得上
  speakText({ text, rate: 0.9 })
}
const isLastQuestion = computed(() => currentIndex.value === props.questions.length - 1)
const localAnsweredCount = computed(() => Object.keys(examAnswers.value).length)

/** ✅ 主观题（essay + 标为主观的填空/拼写）判分：自动按得分点覆盖度判，允许手动纠错 */
const essayOverride = ref<boolean | null>(null)

/** 本题是否按主观题判分（essay 恒为主观；blank/spelling 需 `subjective:true`） */
function isSubjective(q: QuizQuestion): boolean {
  return q.type === 'essay' || ((q.type === 'blank' || q.type === 'spelling') && q.subjective === true)
}
const isSubjectiveQ = computed(() => (currentQuestion.value ? isSubjective(currentQuestion.value) : false))

/* ---------- V2.11 · 选项框的提交后染色（多邻国风） ----------
 * 只用于单选/多选的**视觉反馈**，不参与判分：正确选项染绿、选错的染红。
 * 判分真相仍在上面的 gradeWith / gradeEssay，这里纯展示，改错不影响对错。
 *
 * 为什么染"正确选项"而不只染"选中的"：孩子答错时最想知道的是"那正确答案
 * 是哪个"，把正确项直接点亮比读一行"正确答案：B"快得多。
 */
function toLetterSet(raw: unknown): Set<string> {
  const arr = Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw ?? '').split('')
  return new Set(arr.map((x) => x.trim().toUpperCase()).filter(Boolean))
}

const answerLetters = computed(() => toLetterSet(currentQuestion.value?.answer))
const userLetters = computed(() => toLetterSet(userAnswer.value))

/**
 * 返回选项的反馈类名（空串 = 无状态）。
 * 仅在提交后生效；未提交时一律空串，避免"还没答就剧透答案"。
 */
function optionState(opt: string): string {
  if (!showFeedback.value) return ''
  const t = currentQuestion.value?.type
  if (t !== 'single' && t !== 'multiple') return ''
  const letter = String(opt ?? '').trim().charAt(0).toUpperCase()
  if (!letter) return ''
  if (answerLetters.value.has(letter)) return 'opt-item--correct'
  if (userLetters.value.has(letter)) return 'opt-item--wrong'
  return ''
}

/** 当前主观题的实时判分结果（有作答时才算） */
const liveEssayGrade = computed<EssayGradeResult | null>(() => {
  const q = currentQuestion.value
  if (!q || !isSubjective(q)) return null
  const ua = String(userAnswer.value ?? '')
  if (!ua.trim()) return null
  return gradeEssay(ua, String(q.answer ?? ''), q.keyPoints)
})

/** 用于展示的判分结果：手动纠错后以纠错值为准 */
const displayGrade = computed<EssayGradeResult | null>(() => {
  const g = liveEssayGrade.value
  if (!g) return null
  if (essayOverride.value !== null) {
    return { ...g, correct: essayOverride.value, missing: essayOverride.value ? [] : g.missing }
  }
  return g
})

const feedbackClass = computed(() => {
  // 主观题与客观题统一用 correct/wrong 配色（覆盖度达标即 correct）
  return isCorrect.value ? 'correct' : 'wrong'
})

const feedbackTitle = computed(() => {
  if (isSubjectiveQ.value) return '📖 参考答案 · 系统已按得分点判分'
  // 用题号做种子：同一题内文案稳定，不同题目之间会轮换
  return isCorrect.value ? correctFeedback(currentIndex.value) : wrongFeedback(currentIndex.value)
})

/**
 * 读屏播报的**结论行**（视觉隐藏，见模板 `.sr-only`）。
 * 鼓励语文案是"太棒了 / 差一点点"这类口语，不含"对 / 错"字样，
 * 读屏用户需要先听到一句确定的判定，再听正确答案与解析。
 */
const announceHead = computed(() => {
  if (isSubjectiveQ.value) return '参考答案与得分点已展示，请对照。'
  return isCorrect.value ? '回答正确。' : '回答错误。'
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

/**
 * V2.8 · 题号条「已答」计数：**与 .nav-dot 的 answered 态同口径**（`isAnswered`）。
 * 不能用 `answeredSet` —— 那是练习模式逐题判分的下标集合，考试模式「下一题」
 * 只暂存答案不判分，answeredSet 不更新，图例就会和绿色格子对不上（真踩过）。
 */
const navAnsweredCount = computed(() => {
  let n = 0
  for (const q of props.questions) if (isAnswered(q.id)) n++
  return n
})

/** V2.8 · 答题卡已答进度（0–100），驱动题号条底部的微进度条 */
const navProgressPercent = computed(() =>
  props.questions.length === 0 ? 0 : Math.round((navAnsweredCount.value / props.questions.length) * 100)
)

/**
 * V2.9 · 剩余时间紧迫色阶（借鉴参考图2 顶栏倒计时）：
 * 按剩余**比例**分级而不是固定 60s —— 20 分钟卷剩 90 秒和 2 分钟卷剩 90 秒
 * 的紧迫感完全不同。>20% 平静（主色），≤20% 预警（橙），≤10% 危急（红+脉冲）。
 */
const timerTone = computed(() => {
  if (props.timeLimit <= 0) return ''
  const remain = remainingSeconds.value / props.timeLimit
  if (remain <= 0.1) return 'timer-critical'
  if (remain <= 0.2) return 'timer-warning'
  return ''
})

function isAnswered(qid: string): boolean {
  const ua = examAnswers.value[qid]
  if (ua === undefined || ua === null) return false
  if (Array.isArray(ua)) return ua.length > 0 && ua.every(v => v !== null && v !== undefined)
  return String(ua).trim() !== ''
}

/* ---------------------------------------------------------------------
 * V2.0 · 答题卡（练习模式）
 * ------------------------------------------------------------------- */

/**
 * 把"从库里恢复出来的答案"整成当前题型能吃的形状。
 *
 * 为什么需要：练习模式的断点里存的是**展示串**（`TopicDetail` 的
 * `AnswerPayload.userAnswer` 就是 `formatUserAnswer()` 的结果），
 * 而多选题 / 连线题 / 多陈述判断题的 `v-model` 必须是数组 —— 直接把
 * `"AB"` 塞进 `n-checkbox-group` 会抛类型错误、整页白掉。
 * 这里只做"能渲染"的降级，不试图还原顺序（还原不出来就留空，题目照看）。
 */
function coerceAnswer(q: QuizQuestion, v: any): any {
  switch (q.type) {
    case 'multiple':
      if (Array.isArray(v)) return v
      // 展示串形如 `AB`（`formatUserAnswer` 把选项字母排序后拼起来）
      return typeof v === 'string' && /^[A-Za-z]+$/.test(v) ? v.split('') : []
    case 'matching':
      return Array.isArray(v) ? v : new Array(q.left?.length ?? 0).fill(null)
    case 'judge':
      if (isMultiJudge(q.answer)) {
        return Array.isArray(v) ? v : new Array(normalizeJudgeList(q.answer).length).fill(null)
      }
      return typeof v === 'string' ? v : ''
    default:
      return v ?? ''
  }
}

/** 答题卡三态计数（图例用） */
const sheetStats = computed(() => {
  let correct = 0
  let wrong = 0
  for (const q of props.questions) {
    const rec = practiceAnswers.value[q.id]
    if (!rec) continue
    if (rec.isCorrect) correct++
    else wrong++
  }
  return { correct, wrong, todo: props.questions.length - correct - wrong }
})

function sheetCellClass(i: number): Record<string, boolean> {
  const q = props.questions[i]
  const rec = q ? practiceAnswers.value[q.id] : undefined
  return {
    'is-correct': !!rec && rec.isCorrect,
    'is-wrong': !!rec && !rec.isCorrect,
    'is-todo': !rec,
    'is-current': i === currentIndex.value,
  }
}

/**
 * 点答题卡里的一格：
 *   - 已作答 → 跳过去并**直接展开解析**（回看，不重新判分、不重复 emit 'answer'）
 *   - 未作答 → 跳过去，正常作答
 *
 * 为什么回看必须绕开 `submitAnswer()`：那条路会 `correctCount++` 并 emit
 * `answer`（掌握度 / 错题本会记第二遍）。回看是只读行为。
 */
function openFromSheet(i: number): void {
  const q = props.questions[i]
  if (!q) return
  sheetOpen.value = false

  const rec = practiceAnswers.value[q.id]
  if (i !== currentIndex.value) currentIndex.value = i

  if (!rec) {
    afterQuestionMoved()
    return
  }

  // watch(currentQuestion) 在切题时会把 showFeedback 复位，等它跑完再铺解析
  void nextTick(() => {
    userAnswer.value = coerceAnswer(q, rec.userAnswer)
    isCorrect.value = rec.isCorrect
    // 主观题续传：把已存对错当作最终判定（不再要求重新自评）
    essayOverride.value = isSubjective(q) ? rec.isCorrect : null
    showFeedback.value = true
    focusAfterSubmit()
  })
}

/**
 * 「让路」白名单（V1.6 · D3）。
 *
 * 这是本文件最容易被改坏的一条：**先判断该不该让路，再决定接不接管**。
 * 旧实现把 `e.preventDefault()` 无条件写在分支之前，结果是焦点在「退出 ✕」、
 * 题号导航 `.nav-dot`、判断题 T/F 按钮、主观题自评按钮、以及 naive `Radio`
 * （渲染成 `<input type="radio">`，type 不在旧白名单里）上时，空格无法激活它们，
 * 全被当成"提交 / 下一题"。
 */
const NATIVE_SPACE_TARGETS = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="link"]',
].join(',')

/**
 * Enter 的让路面比 Space **窄一格**：`<input type="radio|checkbox">` 上 Enter
 * 本来就没有原生语义（Space 才是它们的激活键），所以这里让它们落到引擎手里。
 *
 * 为什么必须这么做（实测依据）：点一下选项，焦点会落到 naive 那个 0×0 的隐藏
 * radio input 上（`document.activeElement` = `INPUT.n-radio-input`）。若 Enter
 * 也对这些元素让路，"点选项 → 回车提交"这条最常用的键盘捷径在单选 / 多选 /
 * 判断上就彻底失效 —— 而 Space 在这些元素上必须让路（那是原生激活），
 * 两条键位加起来才算完整。
 *
 * 文本框（`input:not([type=radio]):not([type=checkbox])`）继续让路：它们的 Enter
 * 由模板上的 `@keyup.enter="onInputEnter"` 负责，这里再接一手会变成"提交后立刻
 * 跳下一题"（keydown 提交 + keyup 进下一题）。
 */
const NATIVE_ENTER_TARGETS = [
  'input:not([type="radio"]):not([type="checkbox"])',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="link"]',
].join(',')

/** 焦点是否落在交互控件上（命中则本次按键完全属于该控件） */
function isNativeTarget(target: HTMLElement | null, selector: string): boolean {
  if (!target || typeof target.closest !== 'function') return false
  return target.closest(selector) !== null
}

/**
 * 当前这一题的主操作（提交 / 下一题 / 考试下一题）。
 * 键盘两条路径（Space、Enter）与容器级处理共用同一份分支，避免两处判定漂移。
 */
function runPrimaryAction(): void {
  if (props.examMode) {
    if (canSubmit.value) examNext()
    return
  }
  if (showFeedback.value) nextQuestion()
  else if (canSubmit.value) submitAnswer()
}

/**
 * 根容器上的键盘处理（取代原来的 `window.addEventListener('keydown', …, true)`）。
 *
 * 顺序不可调换：① Ctrl/⌘+Enter（主观题显式提交）→ ② 让路 → ③ 接管。
 * 用 keydown 而不是 keyup 处理 Space：原生按钮的 Space 激活发生在 **keyup**
 * 派发 click 那一刻，只有 keydown 上的 `preventDefault` 能压住它 —— 所以
 * 「Space 交给引擎」与「Space 留给按钮」这件事，必须在同一点判断完。
 */
function onKeydown(e: KeyboardEvent): void {
  const isSpace = e.key === ' ' || e.code === 'Space'
  const isEnter = e.key === 'Enter'
  if (!isSpace && !isEnter) return
  if (!currentQuestion.value) return

  const target = e.target instanceof HTMLElement ? e.target : null

  // ① Ctrl / ⌘ + Enter：主观题（textarea 里普通 Enter 必须只换行）
  if (isEnter && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    runPrimaryAction()
    return
  }

  // ② 让路：焦点在交互控件上时，不 preventDefault、不接管
  if (isNativeTarget(target, isSpace ? NATIVE_SPACE_TARGETS : NATIVE_ENTER_TARGETS)) return

  // ③ 接管。两条键都必须 preventDefault：
  //    Space —— 原生按钮的激活在 keyup 派发 click，只有 keydown 上压住才有效；
  //    Enter —— 浏览器在**事件派发结束、微任务跑完之后**才执行默认动作。本处理器
  //      交卷后会（nextTick 里）把焦点挪到新出现的"下一题"按钮上，若不压住，
  //      这一次回车会顺带"激活"那个刚拿到焦点的按钮 → 一次按键提交 + 跳题
  //      （e2e 用例 ① 实测踩中过）。
  e.preventDefault()
  runPrimaryAction()
}

/* ---------------------------------------------------------------------
 * V1.6 · D3 焦点转移 / 滚动
 * ------------------------------------------------------------------- */

/**
 * 把焦点送到"这一题该操作的地方"。
 *
 * 为什么必须有：`.quiz-actions` 是两个 `v-if / v-else` 互斥节点 —— 交卷瞬间
 * "提交答案"按钮被销毁、"下一题"按钮新建，焦点必然掉到 `document.body`；
 * 而键盘监听挂在根容器上（冒泡），焦点一旦离开子树，后续按键就再也收不到。
 *
 * @param options `preventScroll` 用于挂载时聚焦：不能因为自动聚焦把页面滚走
 *                （专题页练习区在知识卡片下面，一进来就跳下去会显得页面乱动）。
 */
function focusPrimary(options: FocusOptions = {}): void {
  const q = currentQuestion.value
  if (!q) return
  const preventScroll = options.preventScroll === true

  if (q.type === 'blank' || q.type === 'spelling') {
    answerInputRef.value?.focus()
    return
  }
  if (q.type === 'essay') {
    essayInputRef.value?.focus()
    return
  }
  rootRef.value?.focus({ preventScroll })
}

/**
 * 交卷后的焦点落点：**新出现的操作按钮**（"下一题 ➡️" / "🏁 完成练习"）。
 *
 * 选它而不是"聚焦题干"的原因：交卷后用户唯一该做的就是继续，焦点直接落在主操作上，
 * 回车 / 空格一次就到下一题；若聚焦题干（根容器），用户还得再 Tab 一跳到按钮，
 * 反而多一次按键。主观题自评未完成时，主操作是自评按钮，同样聚焦它。
 */
function focusAfterSubmit(): void {
  void nextTick(() => {
    const root = rootRef.value
    if (!root) return
    const selfRateBtn =
      isSubjectiveQ.value && essayOverride.value === null
        ? root.querySelector<HTMLElement>('.override-btns button')
        : null
    const actionBtn = root.querySelector<HTMLElement>('.quiz-actions button')
    const el = selfRateBtn ?? actionBtn
    el?.focus({ preventScroll: true })
  })
}

/**
 * 切题（下一题 / 跳题 / 考试下一题）后的收尾：聚焦 + 滚回题首。
 * 只在这三处显式调用，不放进 `watch(currentQuestion)` —— 那个 watcher 带
 * `immediate: true`，挂载时也会跑，会把"挂载"和"切题"两种语义搅在一起。
 */
function afterQuestionMoved(): void {
  void nextTick(() => {
    focusPrimary()
    scrollRef.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
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
      // V2.0 · 答题卡的初始态：续传回来的答案也要算"已作答"
      practiceAnswers.value = { ...props.initialAnswers }
    }
  }
  startTimer()

  // 键盘用户一进页面就能直接操作：把焦点放到根容器（不滚动、不抢 Tab 顺序）。
  // 注意这里**只聚焦容器、不聚焦输入框**：专题页的练习区在知识卡片下面，
  // 挂载即聚焦 input 会把页面自动滚下去。
  void nextTick(() => {
    rootRef.value?.focus({ preventScroll: true })
  })
})

onUnmounted(() => {
  stopTimer()
  emit('save-progress', {
    currentIndex: currentIndex.value,
    elapsedSeconds: elapsedSeconds.value,
    examAnswers: props.examMode ? { ...examAnswers.value } : undefined,
  })
})

watch(currentQuestion, (q) => {
  if (!q) return
  essayOverride.value = null
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
      // 断点里的 userAnswer 是展示串，按题型整成 v-model 能吃的形状（见 coerceAnswer）
      userAnswer.value = coerceAnswer(q, saved.userAnswer)
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

  // 主观题（essay + 标为主观的填空/拼写）：按得分点覆盖度自动判分；其余走精确/容错判分
  const subj = isSubjective(q)
  isCorrect.value = subj
    ? gradeEssay(String(userAnswer.value ?? ''), String(q.answer ?? ''), q.keyPoints).correct
    : gradeWith(q, userAnswer.value)
  if (subj) essayOverride.value = null
  if (isCorrect.value) correctCount.value++

  // V2.0 · 答题卡留档（每次提交都更新，允许改了再提交覆盖旧值）
  if (!props.examMode) {
    practiceAnswers.value[q.id] = { userAnswer: userAnswer.value, isCorrect: isCorrect.value }
  }

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

  // 交卷后立即把焦点送到"下一题"（那个按钮刚被 v-else 新建出来）
  focusAfterSubmit()

  // V2.11 · 即时反馈：先出判定再出声，顺序不能反——声音是"确认"，不是"预告"。
  // 考试模式（examMode）不发声：它是"交卷后统一判"的场景，逐题叮/嗡会打断答题，
  // 且此时页面本就不显示对错（feedback-box 有 !examMode 门禁）。
  if (!props.examMode) {
    if (isCorrect.value) playCorrectFeedback()
    else playWrongFeedback()
  }
}

/**
 * ✅ 主观题手动纠错：自动判分仅按关键词/得分点，可能误判（同义改写、长难句）。
 * 孩子/家长觉得判错了，可一键改为"答对/复习"，更新掌握度与错题本。
 * 仅在已提交且当前题为主观题时可用；重复点同一结论不重复计数。
 */
function overrideGrade(ok: boolean) {
  const q = currentQuestion.value
  if (!q || !isSubjective(q) || essayOverride.value === ok) return
  const prev = isCorrect.value
  essayOverride.value = ok
  isCorrect.value = ok
  // 纠正计数：答对↑/复习↓，避免 correctCount 重复累加
  if (ok && !prev) correctCount.value++
  if (!ok && prev) correctCount.value--

  emit('answer', {
    exerciseId: q.id,
    knowledgePointIds: Array.isArray(q.knowledgePointIds) ? q.knowledgePointIds : [],
    isCorrect: ok,
    userAnswer: userAnswerDisplay.value,
    correctAnswer: correctAnswerDisplay.value,
    elapsedMs: currentElapsedMs(),
  })

  // 纠错也是一次"判定"，同样给即时反馈（孩子点了「我答对了」要有回应）
  if (ok) playCorrectFeedback()
  else playWrongFeedback()
}

function nextQuestion() {
  if (currentIndex.value < props.questions.length - 1) {
    currentIndex.value++
    afterQuestionMoved()
  } else {
    emit('finish', correctCount.value)
    maybeExitFocusOnFinish()
  }
}

/**
 * 输入框里的 Enter（由模板 `@keyup.enter` 触发）。
 *
 * 旧实现 `canSubmit && !showFeedback` 在已交卷时是**死分支**：此时焦点还留在
 * 已判分的输入框里，再按空格会被白名单 return、直接输入进答案框。现在补上
 * "已交卷 → 下一题"，让"输入 → 回车提交 → 再回车进下一题"连成一条链路。
 *
 * 主观题不挂这个处理器（textarea 的 Enter 必须只换行），提交走 Ctrl/⌘ + Enter。
 */
function onInputEnter() {
  if (props.examMode) {
    if (canSubmit.value) examNext()
    return
  }
  if (showFeedback.value) nextQuestion()
  else if (canSubmit.value) submitAnswer()
}

function jumpTo(index: number) {
  if (index === currentIndex.value) return
  const q = currentQuestion.value
  if (q && canSubmit.value) examAnswers.value[q.id] = userAnswer.value
  else if (q) delete examAnswers.value[q.id]
  currentIndex.value = index
  afterQuestionMoved()
}

function examNext() {
  if (!currentQuestion.value || !canSubmit.value) return
  examAnswers.value[currentQuestion.value.id] = userAnswer.value
  if (currentIndex.value < props.questions.length - 1) {
    currentIndex.value++
    afterQuestionMoved()
  } else {
    finalizeExam()
  }
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
      image: question.image,
      imageAlt: question.imageAlt,
      packageId: question.packageId || props.packageId,
    })
  }

  correctCount.value = correct
  stopTimer()

  // ✅ 先发详情，再发 finish
  emit('exam-detail', { items })
  emit('finish', correct)
  maybeExitFocusOnFinish()
}

function handleExit() {
  stopTimer()
  emit('exit')
}
</script>

<style scoped lang="scss">
/* `.sr-only` mixin 来自 D1 的卡片状态 partial（零 CSS 输出，只有 mixin） */
@import '@/core/styles/card-status';

.quiz-engine {
  display: flex;
  flex-direction: column;
  min-height: 320px;
  padding-bottom: 80px;

  /* 根容器是 tabindex="-1" 的编程聚焦目标：只在"键盘触发的聚焦"时显示焦点环，
     鼠标点击后聚焦（Chrome 的 :focus-visible 启发式）不会留下多余描边 */
  &:focus-visible {
    outline: var(--focus-ring-w) solid var(--btn-focus-ring);
    outline-offset: var(--focus-ring-offset);
    border-radius: $radius-md;
  }
}

.sr-only { @include sr-only; }

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
      color: $warning-text;
      background: $warning-light;
    }
    &.timer-critical {
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
  padding: 12px 0 14px;
  margin-bottom: 8px;
  border-bottom: 1px dashed $border-light;

  /* V2.8 · 对标参考图3：图例行 + 数字网格 + 进度微条 */
  .nav-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .nav-caption {
    font-size: 12px;
    font-weight: 800;
    color: $text-sub;
    letter-spacing: 0.05em;
  }
  .nav-legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: $text-muted;

    .legend-swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      margin-left: 8px;
      &.swatch-done { background: $primary-color; }
      &.swatch-todo { background: $card-bg; border: 1.5px solid $border-color; }
    }
  }
  .nav-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nav-dot {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1.5px solid $border-color;
    background: $card-bg;
    color: $text-sub;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    cursor: pointer;
    transition: transform var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard),
      background var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      border-color: $primary-color;
      color: $primary-text;
      transform: translateY(-2px);
      box-shadow: 0 4px 10px rgba(var(--primary-rgb), 0.18);
    }
    &.answered {
      background: $primary-light;
      border-color: $primary-color;
      color: $primary-text;
    }
    /* 当前题：渐变实底 + 外发光环（对标参考图3 的高亮格子） */
    &.active {
      background: $gradient-primary;
      border-color: transparent;
      color: var(--text-on-primary);
      box-shadow:
        0 0 0 3px rgba(var(--primary-rgb), 0.22),
        0 4px 12px rgba(var(--primary-rgb), 0.35);
      transform: scale(1.1);
    }
    &.active.answered {
      background: $gradient-primary;
    }
    &:focus-visible {
      outline: var(--focus-ring-w) solid var(--btn-focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  .nav-progress {
    height: 4px;
    border-radius: 2px;
    background: $border-light;
    margin-top: 12px;
    overflow: hidden;

    .nav-progress-fill {
      height: 100%;
      border-radius: 2px;
      background: $gradient-primary;
      transition: width var(--duration-slow) var(--ease-standard);
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

/* ===== V2.0 · 答题卡 ===== */

.sheet-btn {
  border: none;
  background: $bg-color-hover;
  color: $text-sub;
  font-size: 13px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover { background: $primary-light; color: $primary-text; }
  &:focus-visible {
    outline: var(--focus-ring-w) solid var(--btn-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
}

/* V2.1 · 沉浸式专注模式入口按钮（与答题卡入口同款样式语言） */
.focus-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid $border-color;
  background: $card-bg;
  color: $text-main;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover { background: $bg-color-hover; border-color: $primary-color; }
  &:active { transform: scale(0.97); }
  &:focus-visible {
    outline: var(--focus-ring-w) solid var(--btn-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
}

.sheet-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: $space-3;
  font-size: 13px;
  font-weight: 700;

  /* 三态文字色只走 -text（`--{tone}-color` 是图形色，check:text-color 会抓） */
  .legend-correct { color: $success-text; }
  .legend-wrong { color: $danger-text; }
  /* 未做：本仓没有 `--text-tertiary`，三级文字语义统一由 `--text-muted` 承担 */
  .legend-todo { color: $text-muted; }
}

.sheet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
  gap: $space-2;
}

.sheet-cell {
  height: 42px;
  border-radius: 10px;
  border: 1.5px solid $border-color;
  background: $card-bg;
  color: $text-muted;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { border-color: $primary-color; }
  &:focus-visible {
    outline: var(--focus-ring-w) solid var(--btn-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }

  &.is-correct {
    background: var(--badge-success-bg);
    border-color: $success-color;
    color: $success-text;
  }
  &.is-wrong {
    background: var(--badge-danger-bg);
    border-color: $danger-color;
    color: $danger-text;
  }
  /* 当前题：只加描边，不改变三态的底色语义 */
  &.is-current { box-shadow: 0 0 0 2px $primary-color; }
}

.sheet-hint {
  margin-top: $space-3;
  font-size: 12px;
  line-height: $leading-normal;
  color: $text-sub;
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
  border-radius: var(--radius-lg);
  transition: all 0.15s;
  font-size: 15px;
  line-height: 1.5;
  min-height: 52px;
  display: flex;
  align-items: center;

  &:hover { border-color: $primary-color; background: $primary-light; }
}

/* ---------- V2.11 · 提交后选项染色 + 物理反馈 ----------
 * 用**双类选择器**（.opt-item.opt-item--x）而不是单类：上面 `&:hover` 编译成
 * `.opt-item:hover`（特异性 0,2,0），单类 .opt-item--correct 只有 0,1,0，
 * 会输给 hover —— 出现"鼠标还停在选项上时，绿色又被主色盖掉"的闪烁。
 */
.opt-item.opt-item--correct {
  border-color: var(--success-color);
  background: var(--success-light);
  animation: opt-pop var(--duration-slow) var(--ease-spring);
}

.opt-item.opt-item--wrong {
  border-color: var(--danger-color);
  background: var(--danger-light);
  animation: opt-shake 320ms var(--ease-standard);
}

/* 答对：弹性放大再回弹（多邻国式"奖励"） */
@keyframes opt-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.035); }
  100% { transform: scale(1); }
}

/* 答错：左右衰减抖动。幅度逐次收敛，像真的撞了一下 */
@keyframes opt-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-7px); }
  30% { transform: translateX(6px); }
  45% { transform: translateX(-4px); }
  60% { transform: translateX(3px); }
  80% { transform: translateX(-1px); }
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
    /*
     * 选择框宽度自适应，不再写死 200px。
     * 语文「按顺序排步骤」这类连线题的右项是一整句话（如"沿画好的线剪出半边蝴蝶的形状"），
     * 200px 只能露出一半，孩子看不见完整选项就没法判断对错。
     */
    .matching-select { flex: 1 1 200px; max-width: 380px; }
  }
}

.spelling-group {
  .spelling-hint {
    font-size: 15px; color: $primary-text; background: $primary-light;
    padding: 8px 14px; border-radius: 6px; margin-bottom: 12px;
    font-family: 'Times New Roman', monospace; letter-spacing: 2px;
  }
}

/* 🔊 听写/默写：输入框与朗读按钮并排 */
.answer-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
  .n-input { flex: 1; }
  .speak-btn {
    flex: 0 0 auto;
    white-space: nowrap;
    align-self: center;
  }
}

.essay-group {
  .essay-hint {
    font-size: 13px; color: $primary-text; background: $primary-light;
    padding: 8px 14px; border-radius: 6px; margin-bottom: 10px;
  }
  .essay-kbd-hint {
    font-size: 12px;
    color: $text-sub;
    margin-left: 4px;
  }
  :deep(.n-input) { font-size: 15px; line-height: 1.8; }
}

.feedback-box {
  margin-top: 16px;
  padding: 14px 18px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  line-height: 1.65;
  /* V2.11：判定结果要"浮"在页面上（多邻国的高调奖励），不能只靠换底色 */
  box-shadow: var(--shadow-sm);
}
/* 判定类反馈才弹入；reference / review 是"参考答案 / 需复习"的静态说明，不该抢戏 */
.feedback-box.correct {
  background: $success-light;
  border: 2px solid $success-color;
  animation: fb-rise var(--duration-slow) var(--ease-spring);
}
.feedback-box.wrong {
  background: $danger-light;
  border: 2px solid $danger-color;
  animation: fb-rise var(--duration-slow) var(--ease-spring);
}
.feedback-box.reference { background: $primary-light; border: 1px solid $primary-color; }
.feedback-box.review { background: $warning-light; border: 1px solid $warning-color; }

@keyframes fb-rise {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.keypoints {
  margin-top: 12px;
  padding: 10px 14px;
  background: $bg-color-hover;
  border-radius: 8px;

  .keypoints-title {
    font-size: 13px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 6px;
  }
  ul {
    margin: 0;
    padding-left: 4px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    font-size: 14px;
    line-height: 1.5;
    color: $text-sub;
  }
  li.kp-hit { color: $success-text; }
  li.kp-miss { color: $danger-text; }
}

.grade-verdict {
  margin-top: 10px;
  font-size: 14px;
  font-weight: 700;
  color: $text-main;
}

.override-btns {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;

  .override-tip {
    font-size: 12px;
    color: $text-sub;
  }
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
  .keypoints { background: rgba(var(--on-strong-rgb), 0.06); }
  .keypoints li.kp-hit { color: var(--success-text); }
  .keypoints li.kp-miss { color: var(--danger-text); }
  .override-tip { color: var(--text-sub); }
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
      background: $gradient-primary;
      border-color: transparent;
      color: var(--text-on-primary);
      box-shadow:
        0 0 0 3px rgba(var(--primary-rgb), 0.3),
        0 4px 12px rgba(var(--primary-rgb), 0.4);
    }
  }
}

/* ---------------------------------------------------------------------
 * V2.11 · 动效降级（§6.6）
 * 弹跳/抖动是"奖励与惩罚"的强化手段，对前庭敏感用户（晕动症）会不适，
 * 系统开了「减少动态效果」就必须全部关掉 —— 但**染色与文案保留**：
 * 反馈信息一点都不能少，只是不动。
 * --------------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .opt-item.opt-item--correct,
  .opt-item.opt-item--wrong,
  .feedback-box.correct,
  .feedback-box.wrong {
    animation: none;
  }
}
</style>