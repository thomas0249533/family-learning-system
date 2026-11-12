<template>
  <div class="vocab-drill">
    <!-- ============ 入口屏 ============ -->
    <div v-if="phase === 'intro'" class="intro-screen">
      <div class="intro-badge">🎴 词汇背记</div>
      <h2 class="intro-title">{{ topicTitle || '词汇背记' }}</h2>
      <div class="intro-count">共 {{ words.length }} 个词</div>

      <!-- V2.4 · 任务2 · 当前单元掌握进度（派生，纯展示，降畏难） -->
      <div class="unit-progress" v-if="totalCount > 0">
        <div class="unit-progress-track">
          <div class="unit-progress-fill" :style="{ width: masteredPercent + '%' }"></div>
        </div>
        <div class="unit-progress-text">
          当前单元已掌握 <b>{{ masteredCount }}</b> / {{ totalCount }} 词
        </div>
      </div>

      <div class="config-block">
        <div class="config-label">背记模式</div>
        <div class="mode-grid">
          <button
            v-for="m in modeOptions"
            :key="m.value"
            class="mode-btn"
            :class="{ active: mode === m.value }"
            @click="mode = m.value"
          >
            <div class="mode-icon">{{ m.icon }}</div>
            <div class="mode-name">{{ m.label }}</div>
            <div class="mode-desc">{{ m.desc }}</div>
          </button>
        </div>
      </div>

      <div class="config-block">
        <div class="config-label">每次题数</div>
        <div class="count-chips">
          <button
            v-for="c in countOptions"
            :key="c.value"
            class="count-chip"
            :class="{ active: countPerSession === c.value }"
            @click="countPerSession = c.value"
          >
            {{ c.label }}
          </button>
        </div>
      </div>

      <div class="config-block" v-if="mode === 'dictation' || mode === 'paper'">
        <div class="config-label">听写设置</div>
        <label class="dictation-toggle">
          <input v-model="showPromptInDictation" type="checkbox" />
          <span>显示中文提示（默认关闭，关闭才是真听写）</span>
        </label>
        <div v-if="mode === 'paper'" class="mode-note">
          📝 孩子在纸上书写，写完对照答案自评；无需打字。
        </div>
      </div>

      <div class="config-block" v-if="mode === 'chunks'">
        <div class="mode-note">
          🧩 本单元有 {{ chunkableWords.length }} 个词可拆成偏旁/字根，点选字块按顺序拼出词语；单字词会自动跳过。
        </div>
      </div>

      <div class="intro-actions">
        <AppButton
          type="primary" size="large" block
          :disabled="mode === 'chunks' && chunkableWords.length === 0"
          @click="startDrill"
        >
          ▶ 开始背记（{{ mode === 'chunks' ? Math.min(countPerSession, chunkableWords.length) : sessionSize }} 题）
        </AppButton>
        <AppButton block @click="emit('close')">取消</AppButton>
      </div>
    </div>

    <!-- ============ 背记中 ============ -->
    <div v-else-if="phase === 'drilling'" class="drill-screen">
      <div class="drill-header">
        <span class="drill-progress">第 {{ currentIndex + 1 }} / {{ sessionWords.length }}</span>
        <span class="drill-mode">{{ currentModeLabel }}</span>
        <button class="drill-exit" @click="confirmExit">✕</button>
      </div>

      <!-- 翻面模式 -->
      <div v-if="mode === 'flip'" class="flip-area">
        <div class="flip-card" :class="{ flipped }" @click="flipped = !flipped">
          <div v-if="!flipped" class="flip-content front">
            <div class="flip-text">{{ currentPrompt }}</div>
            <div class="flip-hint">点击卡片翻面</div>
          </div>
          <div v-else class="flip-content back">
            <div class="flip-text big">{{ currentAnswer }}</div>
          </div>
        </div>
      </div>

      <!-- 输入 / 听音模式 -->
      <div v-else-if="mode === 'input' || mode === 'listen'" class="input-area">
        <div v-if="mode === 'listen'" class="listen-block">
          <button class="listen-btn" @click="playAudio">
            🔊 点击播放
          </button>
          <div class="listen-hint">听音后，写出{{ lang === 'chinese' ? '汉字' : '单词' }}</div>
        </div>
        <div v-else class="prompt-block">
          <div class="prompt-label">请写出对应的{{ lang === 'chinese' ? '汉字' : '英文单词' }}</div>
          <div class="prompt-content">{{ currentPrompt }}</div>
        </div>
        <n-input
          v-model:value="userInput"
          :placeholder="lang === 'chinese' ? '请输入汉字...' : '请输入英文单词...'"
          size="large"
          @keyup.enter="submitAnswer"
          :disabled="showFeedback"
        />
      </div>

      <!-- 听写模式：连续作答，作答过程中不判对错，最后统一批改 -->
      <div v-else-if="mode === 'dictation'" class="input-area">
        <div class="listen-block">
          <button class="listen-btn" @click="playAudio">🔊 再听一遍</button>
          <div class="listen-hint">
            听音写出{{ lang === 'chinese' ? '汉字' : '单词' }}，写完一起批改
          </div>
        </div>
        <div v-if="showPromptInDictation" class="prompt-block">
          <div class="prompt-label">提示</div>
          <div class="prompt-content">{{ currentPrompt }}</div>
        </div>
        <n-input
          v-model:value="userInput"
          :placeholder="lang === 'chinese' ? '请输入汉字...' : '请输入英文单词...'"
          size="large"
          @keyup.enter="submitDictation"
        />
      </div>

      <!-- 纸笔听写：听音 → 纸上写 → 亮答案 → 自评（全程零打字） -->
      <div v-else-if="mode === 'paper'" class="input-area paper-area">
        <div class="listen-block">
          <button class="listen-btn" @click="playAudio">🔊 再听一遍</button>
          <div class="listen-hint">听音后，在纸上写出{{ lang === 'chinese' ? '词语' : '单词' }}</div>
        </div>
        <div v-if="currentPrompt && showPromptInDictation" class="prompt-block">
          <div class="prompt-label">提示</div>
          <div class="prompt-content">{{ currentPrompt }}</div>
        </div>
        <div v-if="!paperRevealed" class="paper-write-hint">✍️ 写好了再点「看答案」</div>
        <div v-else class="paper-answer">
          <div class="prompt-label">正确答案</div>
          <div class="prompt-content">{{ currentAnswer }}</div>
        </div>
      </div>

      <!-- 拼字块：点选偏旁/词根块，按顺序拼出整个词（全程零打字） -->
      <div v-else-if="mode === 'chunks'" class="input-area chunk-area">
        <div class="prompt-block">
          <div class="prompt-label">请拼出「{{ currentPrompt }}」</div>
          <div class="chunk-slots">
            <span v-for="(c, i) in selectedChunks" :key="i" class="chunk-slot filled">{{ c }}</span>
            <span v-if="selectedChunks.length === 0" class="chunk-slot empty">点下方字块开始拼</span>
          </div>
        </div>
        <div class="chunk-choices">
          <button
            v-for="(c, i) in chunkChoices"
            :key="c + '-' + i"
            class="chunk-choice"
            :disabled="showFeedback"
            @click="pickChunk(i)"
          >{{ c }}</button>
        </div>
        <button v-if="selectedChunks.length > 0" class="chunk-undo" type="button" @click="undoChunk">↩ 撤销上一块</button>
      </div>

      <!-- 选择模式 -->
      <div v-else-if="mode === 'choice'" class="choice-area">
        <div class="prompt-block">
          <div class="prompt-label">请选择正确的{{ lang === 'chinese' ? '汉字' : '英文单词' }}</div>
          <div class="prompt-content">{{ currentPrompt }}</div>
        </div>
        <div class="choice-list">
          <button
            v-for="opt in choiceOptions"
            :key="opt"
            class="choice-item"
            :class="choiceItemClass(opt)"
            :disabled="showFeedback"
            @click="selectChoice(opt)"
          >
            {{ opt }}
          </button>
        </div>
      </div>

      <!-- 反馈 -->
      <div v-if="showFeedback" class="drill-feedback" :class="lastCorrect ? 'ok' : 'no'">
        <template v-if="lastCorrect">✅ 正确！</template>
        <template v-else>
          ❌ 答错了。正确答案：<b>{{ currentAnswer }}</b>
        </template>
      </div>

      <!-- 底部按钮 -->
      <div class="drill-actions">
        <template v-if="mode === 'flip'">
          <AppButton size="large" @click="markWrong">🔄 再练练</AppButton>
          <AppButton type="success" size="large" @click="markCorrect">✅ 我记住了</AppButton>
        </template>
        <!-- 听写模式：提交即进入下一题，全程不给对错，最后统一批改 -->
        <template v-else-if="mode === 'dictation'">
          <AppButton type="primary" size="large" block @click="submitDictation" :disabled="!userInput.trim()">
            {{ currentIndex === sessionWords.length - 1 ? '🏁 完成并批改' : '提交并下一题 ➡️' }}
          </AppButton>
        </template>
        <!-- 纸笔听写：先亮答案，再由孩子自评（不臆测手写内容） -->
        <template v-else-if="mode === 'paper'">
          <AppButton v-if="!paperRevealed" type="primary" size="large" block @click="paperRevealed = true">
            👀 看答案
          </AppButton>
          <template v-else>
            <AppButton size="large" @click="submitPaper('wrong')">❌ 写错了</AppButton>
            <AppButton type="success" size="large" @click="submitPaper('correct')">✅ 写对了</AppButton>
          </template>
        </template>
        <!-- 拼字块：拼好后提交 -->
        <template v-else-if="mode === 'chunks'">
          <AppButton type="primary" size="large" block @click="submitChunks" :disabled="selectedChunks.length === 0">
            {{ currentIndex === sessionWords.length - 1 ? '🏁 完成并批改' : '提交并下一题 ➡️' }}
          </AppButton>
        </template>
        <template v-else-if="!showFeedback">
          <AppButton type="primary" size="large" block @click="submitAnswer" :disabled="!userInput.trim()">
            提交
          </AppButton>
        </template>
        <template v-else>
          <AppButton type="primary" size="large" block @click="nextWord">
            {{ currentIndex === sessionWords.length - 1 ? '🏁 完成' : '下一题 ➡️' }}
          </AppButton>
        </template>
      </div>
    </div>

    <!-- ============ 完成 ============ -->
    <div v-else-if="phase === 'done'" class="done-screen">
      <div class="done-icon">{{ doneIcon }}</div>
      <div class="done-title">{{ doneTitle }}</div>
      <div class="done-score">
        <span class="done-num">{{ correctCount }}</span>
        <span class="done-div">/</span>
        <span class="done-total">{{ sessionWords.length }}</span>
      </div>
      <div class="done-rate">正确率 {{ doneRate }}%</div>
      <div class="done-unit" v-if="totalCount > 0">本单元已掌握 <b>{{ masteredCount }}</b> / {{ totalCount }} 词</div>
      <div class="done-time">用时 {{ formatDuration(elapsedSeconds) }}</div>

      <div class="done-actions">
        <AppButton type="primary" size="large" block @click="startDrill">🔁 再来一遍</AppButton>
        <AppButton block @click="emit('close')">← 返回词汇表</AppButton>
      </div>
    </div>

    <!-- ============ 听写批改（统一判分，逐词对照） ============ -->
    <div v-else-if="phase === 'review'" class="review-screen">
      <div class="review-head">
        <div class="review-icon">{{ doneIcon }}</div>
        <div class="review-title">听写批改</div>
        <div class="review-score">
          <span class="review-num">{{ correctCount }}</span>
          <span class="review-div">/</span>
          <span class="review-total">{{ dictationAnswers.length }}</span>
        </div>
        <div class="review-rate">
          正确率 {{ doneRate }}% · 用时 {{ formatDuration(elapsedSeconds) }}
        </div>
      </div>

      <div class="review-list">
        <div
          v-for="(a, i) in dictationAnswers"
          :key="a.wordId + '-' + i"
          class="review-row"
          :class="a.correct ? 'ok' : 'no'"
        >
          <span class="review-idx">{{ i + 1 }}</span>
          <span class="review-mark">{{ a.correct ? '✅' : '❌' }}</span>
          <span class="review-ans">
            <b>{{ a.answer }}</b>
            <span v-if="!a.correct && a.source === 'typed'" class="review-mine">你写的是「{{ a.input || '（空）' }}」</span>
            <span v-else-if="!a.correct && a.source === 'chunks'" class="review-mine">你拼的是「{{ a.input || '（空）' }}」</span>
            <span v-else-if="!a.correct" class="review-mine">纸上写的再对照一遍</span>
          </span>
          <button class="review-speak" type="button" title="朗读" @click="speakWord(a.answer)">
            🔊
          </button>
        </div>
      </div>

      <div class="review-actions">
        <AppButton
          v-if="wrongAnswers.length > 0"
          type="primary"
          size="large"
          block
          @click="retryWrong"
        >
          🔁 只重练这 {{ wrongAnswers.length }} 个
        </AppButton>
        <AppButton
          :type="wrongAnswers.length > 0 ? 'default' : 'primary'"
          size="large"
          block
          @click="startDrill"
        >
          🔁 整轮再来一遍
        </AppButton>
        <AppButton block @click="emit('close')">← 返回词汇表</AppButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NInput } from 'naive-ui'
import { speak } from '@core/audio/speechService'
import { gradeDictation } from '@core/quiz/dictationGrade'
import { chunksOf, buildChunkChoices, joinedChunks, chunksEqual, gradeSelfAssessed } from '@core/quiz/wordChunks'
import { useUserDataStore } from '@core/stores/userData'
import AppButton from '@/components/ui/AppButton.vue'

type Mode = 'flip' | 'input' | 'listen' | 'choice' | 'dictation' | 'paper' | 'chunks'
type Phase = 'intro' | 'drilling' | 'done' | 'review'
/** 一题的判据来源：键入 / 纸上自评 / 拼字块 */
type AnswerSource = 'typed' | 'self' | 'chunks'

/** 听写模式下的一题作答记录（统一批改用，作答过程中不判对错） */
interface DictationAnswer {
  wordId: string
  prompt: string
  answer: string
  input: string
  correct: boolean
  source: AnswerSource
}

const props = withDefaults(defineProps<{
  words: any[]
  lang: 'chinese' | 'english'
  topicTitle?: string
  packageId: string
  /** 自动开始：跳过入口屏，直接进入指定模式（今日任务的词语听写用） */
  autoStart?: boolean
  /** 自动开始的模式，默认 dictation（真听写：听音→写，不给看答案） */
  autoStartMode?: Mode
  /** 自动开始的题数（默 15），实际取 min(count, words.length) */
  autoCount?: number
  /** 听写时是否隐藏中文提示（默认 true = 真听写） */
  autoHidePrompt?: boolean
}>(), {
  topicTitle: '',
  autoStart: false,
  autoStartMode: 'dictation',
  autoCount: 15,
  autoHidePrompt: true,
})

const emit = defineEmits<{
  (e: 'close'): void
  /** 听写完整一轮批改完成时触发（今日任务在此记账，但不跳转，让孩子先看结果） */
  (e: 'finished', payload: { correctCount: number; total: number; elapsedSeconds: number }): void
}>()

const userDataStore = useUserDataStore()

const phase = ref<Phase>('intro')
const mode = ref<Mode>('flip')
const countPerSession = ref(10)

const sessionWords = ref<any[]>([])
const currentIndex = ref(0)
const userInput = ref('')
const flipped = ref(false)
const showFeedback = ref(false)
const lastCorrect = ref(false)
const correctCount = ref(0)
const elapsedSeconds = ref(0)
/** 听写模式：连续作答的答案在这里攒着，最后一起批改 */
const dictationAnswers = ref<DictationAnswer[]>([])
/** 听写时是否显示中文提示（默认关，才是真听写） */
const showPromptInDictation = ref(false)
/** 纸笔听写：是否已亮出答案（亮出后才允许自评） */
const paperRevealed = ref(false)
/** 拼字块模式：当前题的候选块与已选块 */
const chunkChoices = ref<string[]>([])
const selectedChunks = ref<string[]>([])
let timer: number | null = null

const countOptions = computed(() => [
  { label: '10 题', value: 10 },
  { label: '20 题', value: 20 },
  { label: '全部', value: props.words.length || 999 },
])

const sessionSize = computed(() => Math.min(countPerSession.value, props.words.length))

// V2.4 · 任务2 · 派生进度：当前单元「已掌握 / 总词数」。
// 依据与写入端同源：进度行 packageId = props.packageId、knowledgePointId = word.id
// （普通单元包 owner 解析到自身，canonicalKpId 原值返回，见 ownerIndex.ts）。
// 不引入新字段、不改 DB；「已掌握」口径与掌握度模型一致（masteryProbability ≥ 0.6 或 status=已掌握）。
const totalCount = computed(() => props.words.length)
const masteredCount = computed(() => {
  const masteredIds = new Set(
    userDataStore.progress
      .filter(
        p =>
          p.packageId === props.packageId &&
          ((p.masteryProbability ?? 0) >= 0.6 || p.status === '已掌握')
      )
      .map(p => p.knowledgePointId)
  )
  return props.words.filter(w => w?.id && masteredIds.has(w.id)).length
})
const masteredPercent = computed(() =>
  totalCount.value === 0 ? 0 : Math.round((masteredCount.value / totalCount.value) * 100)
)

const modeOptions = [
  { value: 'flip' as Mode, icon: '🎴', label: '翻面', desc: '提示→答案' },
  { value: 'input' as Mode, icon: '✍️', label: '输入', desc: '看中文写' },
  { value: 'listen' as Mode, icon: '🔊', label: '听音', desc: '听声音写' },
  { value: 'choice' as Mode, icon: '🔘', label: '选择', desc: '4 选 1' },
  { value: 'dictation' as Mode, icon: '🎧', label: '听写', desc: '连写后批改' },
  { value: 'paper' as Mode, icon: '📝', label: '纸笔听写', desc: '纸上写·自评' },
  { value: 'chunks' as Mode, icon: '🧩', label: '拼字块', desc: '点选偏旁/词根' },
]

/** 拼字块模式：能拆成 ≥2 块的词才参与，避免单字题硬凑 */
const chunkableWords = computed(() =>
  props.words.filter(w => chunksOf(w.metadata?.word ?? w.title ?? '', props.lang, w.metadata?.chunks) !== null)
)

const currentWord = computed(() => sessionWords.value[currentIndex.value])

const currentPrompt = computed(() => {
  const w = currentWord.value
  if (!w) return ''
  if (props.lang === 'chinese') {
    return w.metadata?.pinyin ?? w.title ?? ''
  }
  return w.content || w.metadata?.meaning || ''
})

const currentAnswer = computed(() => {
  const w = currentWord.value
  if (!w) return ''
  return w.metadata?.word ?? w.title ?? ''
})

const choiceOptions = computed(() => {
  const correct = currentAnswer.value
  const pool = props.words.filter(w => {
    const a = w.metadata?.word ?? w.title
    return a !== correct
  })
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  const wrongs = shuffled.slice(0, 3).map(w => w.metadata?.word ?? w.title)
  return [correct, ...wrongs].sort(() => Math.random() - 0.5)
})

const doneRate = computed(() => {
  const total = sessionWords.value.length
  return total === 0 ? 0 : Math.round((correctCount.value / total) * 100)
})

const doneIcon = computed(() => {
  const r = doneRate.value
  if (r >= 90) return '🏆'
  if (r >= 75) return '🎉'
  if (r >= 60) return '💪'
  return '📚'
})

const doneTitle = computed(() => {
  const r = doneRate.value
  if (r >= 90) return '出色表现！'
  if (r >= 75) return '表现良好！'
  if (r >= 60) return '大部分都记住了'
  return '这些词还没记牢，多认几遍就顺了'
})

const currentModeLabel = computed(() => {
  const m = modeOptions.find(x => x.value === mode.value)
  return m ? `${m.icon} ${m.label}` : ''
})

/** 当前题的正确拼字块（无数据返回空数组） */
const currentChunks = computed(() =>
  chunksOf(currentAnswer.value, props.lang, currentWord.value?.metadata?.chunks) ?? []
)

/** 拼字块干扰池：同批次其它词的块，避免把正确答案整块喂给孩子 */
const chunkDistractorPool = computed(() => {
  const out: string[] = []
  for (const w of props.words) {
    if (w === currentWord.value) continue
    const cs = chunksOf(w.metadata?.word ?? w.title ?? '', props.lang, w.metadata?.chunks)
    if (cs) out.push(...cs)
  }
  return out
})

/** 当前已选块拼出的词 */
const joinedSelected = computed(() => joinedChunks(selectedChunks.value))

/** 为一题生成候选块并清空选择 */
function prepareChunks(): void {
  const correct = currentChunks.value
  selectedChunks.value = []
  chunkChoices.value = correct.length >= 2
    ? buildChunkChoices(correct, chunkDistractorPool.value, Math.min(4, correct.length + 2))
    : []
}

function pickChunk(idx: number): void {
  if (showFeedback.value) return
  const c = chunkChoices.value[idx]
  if (c === undefined) return
  selectedChunks.value = [...selectedChunks.value, c]
  // 用过即从候选里摘掉，避免同一个块被无限复用
  chunkChoices.value = chunkChoices.value.filter((_, i) => i !== idx)
}

function undoChunk(): void {
  if (showFeedback.value || selectedChunks.value.length === 0) return
  const last = selectedChunks.value[selectedChunks.value.length - 1]
  selectedChunks.value = selectedChunks.value.slice(0, -1)
  chunkChoices.value = [...chunkChoices.value, last]
}

/** ✅ 写进度：不熟的词进"需复习"，熟悉的词累积升级 */
async function writeProgress(word: any, isCorrect: boolean) {
  if (!word?.id || !props.packageId) return
  try {
    // 题目级埋点（每题一次）：每日题量 + 题型
    userDataStore.recordAnswerEvent({ exerciseId: word.id, questionType: 'spelling' })
    // 背单词本质上不可能"蒙对"，蒙对率按拼写题取低值，掌握度才会随着真实回忆上升
    await userDataStore.recordProgress(props.packageId, word.id, isCorrect, {
      questionType: 'spelling',
    })
  } catch (e) {
    console.warn('[VocabDrill] 写进度失败', e)
  }
}

function startTimer() {
  stopTimer()
  timer = window.setInterval(() => elapsedSeconds.value++, 1000)
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function startDrill() {
  // 拼字块只从可拆词里抽；若一个都拆不出，给个可读提示而不是空会话
  const pool = mode.value === 'chunks' ? chunkableWords.value : props.words
  if (pool.length === 0) return
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  const count = Math.min(countPerSession.value, pool.length)
  beginSession(shuffled.slice(0, count))
}

/** 开一轮练习：所有模式共用，避免 startDrill / retryWrong 各写一套重置逻辑 */
function beginSession(words: any[]) {
  sessionWords.value = words
  currentIndex.value = 0
  correctCount.value = 0
  elapsedSeconds.value = 0
  userInput.value = ''
  flipped.value = false
  showFeedback.value = false
  dictationAnswers.value = []
  paperRevealed.value = false
  selectedChunks.value = []
  chunkChoices.value = []
  phase.value = 'drilling'
  startTimer()
  // 听写是连续作业：进来先把第一个词读出来，不让孩子每题点一次播放
  if (mode.value === 'dictation' || mode.value === 'paper') playAudio()
  if (mode.value === 'chunks') prepareChunks()
}

/**
 * 听写模式提交：记录答案 → 下一题；最后一题进入统一批改。全程不判对错。
 * 判分规则抽在 `core/quiz/dictationGrade`（纯函数，有单测），组件只负责流程。
 */
async function submitDictation() {
  const w = currentWord.value
  const typed = userInput.value.trim()
  if (!w || !typed) return
  const expected = currentAnswer.value.trim()
  dictationAnswers.value.push({
    wordId: w.id ?? '',
    prompt: currentPrompt.value,
    answer: expected,
    input: typed,
    correct: gradeDictation(typed, expected),
    source: 'typed',
  })
  userInput.value = ''
  if (currentIndex.value < sessionWords.value.length - 1) {
    currentIndex.value++
    playAudio()
  } else {
    await finishDictation()
  }
}

/**
 * 统一批改：**一次性**写进度。
 * 作答过程中刻意不写，否则"逐题判分 + 即时反馈"会把听写变成可试错的填空题，
 * 掌握度会被虚高的正确率带偏（这与 FSRS 的稳定性估计直接冲突）。
 */
async function finishDictation() {
  stopTimer()
  correctCount.value = dictationAnswers.value.filter(a => a.correct).length
  for (const a of dictationAnswers.value) {
    const w = sessionWords.value.find(x => x.id === a.wordId)
    if (w) await writeProgress(w, a.correct)
  }
  // 今日任务听写：完整一轮批改完成即记账（不跳转，让孩子先看对错清单）
  emit('finished', {
    correctCount: correctCount.value,
    total: dictationAnswers.value.length,
    elapsedSeconds: elapsedSeconds.value,
  })
  phase.value = 'review'
}

/** 连续作业模式的通用推进：记一题 → 下一题（自动播报/备块）或收尾批改 */
async function advanceContinuous(answer: Omit<DictationAnswer, 'wordId' | 'prompt' | 'answer'>) {
  const w = currentWord.value
  if (!w) return
  dictationAnswers.value.push({
    wordId: w.id ?? '',
    prompt: currentPrompt.value,
    answer: currentAnswer.value.trim(),
    ...answer,
  })
  userInput.value = ''
  paperRevealed.value = false
  selectedChunks.value = []
  if (currentIndex.value < sessionWords.value.length - 1) {
    currentIndex.value++
    if (mode.value === 'paper') playAudio()
    if (mode.value === 'chunks') prepareChunks()
    else if (mode.value === 'dictation') playAudio()
  } else {
    await finishDictation()
  }
}

/** 纸笔听写：孩子在纸上写完 → 亮出答案 → 自评对错 */
async function submitPaper(verdict: 'correct' | 'wrong') {
  if (!paperRevealed.value) return
  await advanceContinuous({
    input: '',
    correct: gradeSelfAssessed(verdict),
    source: 'self',
  })
}

/**
 * 拼字块：比较**块序列**（不是拼接字符串）。
 * 汉字偏旁拆开拼回来是「氵可」而非「河」，按拼接比会永远判错。
 */
async function submitChunks() {
  if (selectedChunks.value.length === 0) return
  await advanceContinuous({
    input: joinedSelected.value,
    correct: chunksEqual(selectedChunks.value, currentChunks.value),
    source: 'chunks',
  })
}

const wrongAnswers = computed(() => dictationAnswers.value.filter(a => !a.correct))

/** 只重练错词：把错的几个词单独再来一轮听写 */
function retryWrong() {
  const wrongIds = new Set(wrongAnswers.value.map(a => a.wordId))
  const words = sessionWords.value.filter(w => w?.id && wrongIds.has(w.id))
  if (words.length === 0) return
  beginSession(words)
}

/** 批改清单里单个词的朗读 */
function speakWord(text: string) {
  if (!text) return
  void speak({ text, lang: props.lang === 'chinese' ? 'zh-CN' : 'en-US' })
}

async function submitAnswer() {
  if (showFeedback.value) return
  if (!userInput.value.trim()) return

  const correct = currentAnswer.value.trim().toLowerCase()
  const ua = userInput.value.trim().toLowerCase()
  lastCorrect.value = ua === correct
  showFeedback.value = true
  if (lastCorrect.value) correctCount.value++
  await writeProgress(currentWord.value, lastCorrect.value)
}

async function selectChoice(opt: string) {
  if (showFeedback.value) return
  userInput.value = opt
  lastCorrect.value = opt === currentAnswer.value
  showFeedback.value = true
  if (lastCorrect.value) correctCount.value++
  await writeProgress(currentWord.value, lastCorrect.value)
}

function choiceItemClass(opt: string): string {
  if (!showFeedback.value) return ''
  if (opt === currentAnswer.value) return 'correct'
  if (opt === userInput.value && !lastCorrect.value) return 'wrong'
  return ''
}

async function markCorrect() {
  correctCount.value++
  await writeProgress(currentWord.value, true)
  nextWord()
}

async function markWrong() {
  await writeProgress(currentWord.value, false)
  nextWord()
}

function nextWord() {
  if (currentIndex.value < sessionWords.value.length - 1) {
    currentIndex.value++
    userInput.value = ''
    flipped.value = false
    showFeedback.value = false
  } else {
    finishDrill()
  }
}

function finishDrill() {
  stopTimer()
  phase.value = 'done'
}

function confirmExit() {
  if (!confirm('确定要退出背记吗？当前进度会丢失')) return
  stopTimer()
  emit('close')
}

function playAudio() {
  const text = currentAnswer.value
  if (!text) return
  const lang = props.lang === 'chinese' ? 'zh-CN' : 'en-US'
  // 内容包可带 `metadata.audio`（包内相对路径）；有则优先播离线音频，否则系统 TTS。
  // 不传 rate，让设置页的语速偏好与中文听写默认降速生效。
  const audioPath = currentWord.value?.metadata?.audio
  void speak({
    text,
    lang,
    ...(typeof audioPath === 'string' && audioPath
      ? { audio: { packageId: props.packageId, path: audioPath } }
      : {}),
  })
}

/** 自动开始（今日任务听写）：跳过入口屏，直接进入听写模式、关提示，立即开一轮 */
onMounted(() => {
  if (!props.autoStart) return
  if (props.words.length === 0) return
  mode.value = props.autoStartMode
  countPerSession.value = props.autoCount
  showPromptInDictation.value = !props.autoHidePrompt
  startDrill()
})

onUnmounted(() => {
  stopTimer()
})
</script>

<style scoped lang="scss">
.vocab-drill {
  padding: 4px 0;
}

/* ============ 入口屏 ============ */
.intro-screen {
  text-align: center;
  padding: 16px 8px;

  .intro-badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 20px;
    background: $primary-light;
    color: $primary-text;
    margin-bottom: 12px;
  }

  .intro-title {
    font-size: 20px;
    font-weight: 800;
    color: $text-main;
    margin: 0 0 6px;
  }

  .intro-count {
    font-size: 13px;
    color: $text-sub;
    margin-bottom: 24px;
  }
}

.config-block {
  text-align: left;
  margin-bottom: 20px;

  .config-label {
    font-size: 13px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 10px;
  }
}

.mode-grid {
  display: grid;
  // 5 种模式（含听写）：固定 4 列会把最后一个挤到第二行孤零零，改自适应列宽
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 8px;

  @media (max-width: 600px) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.mode-btn {
  padding: 12px 8px;
  border: 1.5px solid $border-color;
  border-radius: 10px;
  background: $card-bg;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;

  &:hover {
    border-color: $primary-color;
    background: $primary-light;
  }

  &.active {
    border-color: $primary-color;
    background: $primary-light;
    box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.15);
  }

  .mode-icon { font-size: 20px; margin-bottom: 4px; }
  .mode-name { font-size: 13px; font-weight: 700; color: $text-main; }
  .mode-desc { font-size: 11px; color: $text-sub; margin-top: 2px; }
}

.count-chips {
  display: flex;
  gap: 8px;

  .count-chip {
    padding: 8px 18px;
    border: 1.5px solid $border-color;
    border-radius: 20px;
    background: $card-bg;
    color: $text-sub;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;

    &:hover { border-color: $primary-color; color: $primary-text; }

    &.active {
      background: $primary-color;
      border-color: $primary-color;
      color: var(--text-on-primary);
    }
  }
}

.intro-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 24px;
}

/* ============ 背记中 ============ */
.drill-screen {
  padding: 4px 0;
  min-height: 360px;
  display: flex;
  flex-direction: column;
}

.drill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;

  .drill-progress {
    font-size: 14px;
    font-weight: 700;
    color: $text-main;
  }
  .drill-mode {
    font-size: 12px;
    color: $text-sub;
    background: $bg-color-hover;
    padding: 3px 10px;
    border-radius: 12px;
  }
  .drill-exit {
    width: 28px;
    height: 28px;
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

.flip-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 0;
}

.flip-card {
  width: 100%;
  max-width: 480px;
  min-height: 220px;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid $border-color;
  background: $card-bg;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  user-select: none;

  &:hover {
    border-color: $primary-color;
    box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.15);
    transform: translateY(-2px);
  }

  &.flipped {
    background: $primary-light;
    border-color: $primary-color;
  }

  .flip-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .flip-text {
    font-size: 32px;
    font-weight: 700;
    color: $text-main;
    line-height: 1.4;

    &.big {
      font-size: 40px;
      color: $primary-text;
    }
  }

  .flip-hint {
    font-size: 12px;
    color: $text-muted;
  }
}

.input-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
}

/* V3.1.7 · 纸笔听写 + 拼字块（零打字） */
.mode-note {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: $text-sub;
}

.paper-write-hint {
  padding: 24px 16px;
  text-align: center;
  font-size: 15px;
  color: $text-sub;
  border: 1px dashed $border-color;
  border-radius: 12px;
}

.paper-answer {
  padding: 20px;
  text-align: center;
  border: 1px solid $border-color;
  border-radius: 12px;

  .prompt-content {
    font-size: 28px;
    font-weight: 700;
    color: $text-main;
  }
}

.chunk-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 48px;
  align-items: center;
  margin-top: 10px;
}

.chunk-slot {
  min-width: 52px;
  padding: 10px 14px;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  border-radius: 10px;

  &.filled {
    color: $on-strong;
    background: $gradient-primary;
  }

  &.empty {
    font-size: 13px;
    font-weight: 400;
    color: $text-sub;
    border: 1px dashed $border-color;
  }
}

.chunk-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.chunk-choice {
  min-width: 56px;
  padding: 14px 18px;
  font-size: 20px;
  font-weight: 700;
  color: $text-main;
  background: $bg-color-hover;
  border: 1px solid $border-color;
  border-radius: 12px;
  cursor: pointer;

  &:active { transform: translateY(1px); }
  &:disabled { opacity: 0.5; }
}

.chunk-undo {
  align-self: center;
  font-size: 13px;
  color: $text-sub;
  background: transparent;
  border: none;
  cursor: pointer;
}

.listen-block {
  text-align: center;
  padding: 20px 0;

  .listen-btn {
    font-size: 18px;
    font-weight: 700;
    color: $on-strong;
    background: $gradient-primary;
    border: none;
    border-radius: 12px;
    padding: 16px 32px;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);

    &:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.4); }
    &:active { transform: translateY(0); }
  }
  .listen-hint {
    margin-top: 12px;
    font-size: 12px;
    color: $text-sub;
  }
}

.prompt-block {
  text-align: center;
  padding: 16px 0;

  .prompt-label {
    font-size: 12px;
    color: $text-sub;
    margin-bottom: 8px;
  }
  .prompt-content {
    font-size: 32px;
    font-weight: 700;
    color: $text-main;
    line-height: 1.3;
  }
}

.choice-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}

.choice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-item {
  padding: 14px 18px;
  border: 2px solid $border-color;
  border-radius: 10px;
  background: $card-bg;
  color: $text-main;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;

  &:hover:not(:disabled) {
    border-color: $primary-color;
    background: $primary-light;
  }

  &:disabled { cursor: default; }

  &.correct {
    background: var(--badge-success-bg);
    border-color: $success-color;
    color: $success-text;
  }
  &.wrong {
    background: var(--badge-danger-bg);
    border-color: $danger-color;
    color: $danger-text;
  }
}

.drill-feedback {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  text-align: center;

  &.ok {
    background: var(--badge-success-bg);
    color: $success-text;
  }
  &.no {
    background: var(--badge-danger-bg);
    color: $danger-text;

    b { color: $danger-text; margin-left: 4px; }
  }
}

/* ✅ 修复：flex 布局 + 按钮自适应 */
.drill-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;

  > :deep(.n-button) {
    flex: 1;
    width: auto;
  }
}

.done-screen {
  text-align: center;
  padding: 24px 8px;

  .done-icon { font-size: 56px; margin-bottom: 8px; }
  .done-title {
    font-size: 20px;
    font-weight: 800;
    color: $text-main;
    margin-bottom: 20px;
  }
  .done-score {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;

    .done-num { font-size: 48px; font-weight: 900; color: $primary-text; }
    .done-div { font-size: 28px; color: $text-muted; }
    .done-total { font-size: 28px; font-weight: 700; color: $text-sub; }
  }
  .done-rate { font-size: 14px; color: $text-sub; margin-top: 8px; }
  .done-time { font-size: 12px; color: $text-muted; margin-top: 4px; }
}

.dictation-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: $text-sub;
  cursor: pointer;

  input {
    width: 16px;
    height: 16px;
    accent-color: $primary-color;
    cursor: pointer;
  }
}

/* ============ 听写批改 ============ */
.review-screen {
  padding: 4px 0;
}

.review-head {
  text-align: center;
  padding: 8px 0 16px;

  .review-icon { font-size: 48px; }
  .review-title {
    font-size: 18px;
    font-weight: 800;
    color: $text-main;
    margin: 4px 0 8px;
  }
  .review-score {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;

    .review-num { font-size: 40px; font-weight: 900; color: $primary-text; }
    .review-div { font-size: 24px; color: $text-muted; }
    .review-total { font-size: 24px; font-weight: 700; color: $text-sub; }
  }
  .review-rate {
    margin-top: 6px;
    font-size: 13px;
    color: $text-sub;
  }
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 2px;
}

.review-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid $border-color;
  background: $card-bg;

  &.ok {
    background: var(--badge-success-bg);
    border-color: $success-color;
  }
  &.no {
    background: var(--badge-danger-bg);
    border-color: $danger-color;
  }

  .review-idx {
    min-width: 20px;
    font-size: 12px;
    font-weight: 700;
    color: $text-muted;
  }
  .review-mark { font-size: 14px; }
  .review-ans {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    b {
      font-size: 16px;
      color: $text-main;
      word-break: break-word;
    }
    .review-mine {
      font-size: 12px;
      color: $danger-text;
      word-break: break-word;
    }
  }
  .review-speak {
    flex: none;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: $bg-color-hover;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s;

    &:hover { background: $primary-light; }
  }
}

.review-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}

.done-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 28px;
}

body.dark-mode {
  // .choice-item.correct/.wrong、.drill-feedback.ok/.no 的背景已改由
  // var(--badge-{tone}-bg) 承载（随主题解析），故移除本地的深色 rgba 覆盖。
  .flip-card.flipped { background: rgba(var(--primary-rgb), 0.15); }
}
/* V2.4 · 任务2 · 当前单元掌握进度条（派生展示，零硬编码） */
.unit-progress {
  margin: 4px auto 20px;
  max-width: 320px;

  .unit-progress-track {
    height: 8px;
    border-radius: 999px;
    background: $bg-color-hover;
    overflow: hidden;
  }
  .unit-progress-fill {
    height: 100%;
    border-radius: 999px;
    background: $gradient-primary;
    transition: width 0.4s ease;
  }
  .unit-progress-text {
    margin-top: 8px;
    font-size: 12px;
    color: $text-sub;
    b { color: $primary-text; }
  }
}

/* 完成页也给出本单元掌握口径，闭环反馈 */
.done-unit {
  font-size: 13px;
  color: $text-sub;
  margin-top: 4px;
  b { color: $primary-text; }
}
</style>