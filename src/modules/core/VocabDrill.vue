<template>
  <div class="vocab-drill">
    <!-- ============ 入口屏 ============ -->
    <div v-if="phase === 'intro'" class="intro-screen">
      <div class="intro-badge">🎴 词汇背记</div>
      <h2 class="intro-title">{{ topicTitle || '词汇背记' }}</h2>
      <div class="intro-count">共 {{ words.length }} 个词</div>

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

      <div class="intro-actions">
        <n-button type="primary" size="large" block @click="startDrill">
          ▶ 开始背记（{{ sessionSize }} 题）
        </n-button>
        <n-button block @click="emit('close')">取消</n-button>
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
          <n-button size="large" @click="markWrong">🔄 再练练</n-button>
          <n-button type="success" size="large" @click="markCorrect">✅ 我记住了</n-button>
        </template>
        <template v-else-if="!showFeedback">
          <n-button type="primary" size="large" block @click="submitAnswer" :disabled="!userInput.trim()">
            提交
          </n-button>
        </template>
        <template v-else>
          <n-button type="primary" size="large" block @click="nextWord">
            {{ currentIndex === sessionWords.length - 1 ? '🏁 完成' : '下一题 ➡️' }}
          </n-button>
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
      <div class="done-time">用时 {{ formatDuration(elapsedSeconds) }}</div>

      <div class="done-actions">
        <n-button type="primary" size="large" block @click="startDrill">🔁 再来一遍</n-button>
        <n-button block @click="emit('close')">← 返回词汇表</n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { speak } from '@core/audio/speechService'
import { useUserDataStore } from '@core/stores/userData'

type Mode = 'flip' | 'input' | 'listen' | 'choice'
type Phase = 'intro' | 'drilling' | 'done'

const props = withDefaults(defineProps<{
  words: any[]
  lang: 'chinese' | 'english'
  topicTitle?: string
  packageId: string
}>(), {
  topicTitle: '',
})

const emit = defineEmits<{
  (e: 'close'): void
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
let timer: number | null = null

const countOptions = computed(() => [
  { label: '10 题', value: 10 },
  { label: '20 题', value: 20 },
  { label: '全部', value: props.words.length || 999 },
])

const sessionSize = computed(() => Math.min(countPerSession.value, props.words.length))

const modeOptions = [
  { value: 'flip' as Mode, icon: '🎴', label: '翻面', desc: '提示→答案' },
  { value: 'input' as Mode, icon: '✍️', label: '输入', desc: '看中文写' },
  { value: 'listen' as Mode, icon: '🔊', label: '听音', desc: '听声音写' },
  { value: 'choice' as Mode, icon: '🔘', label: '选择', desc: '4 选 1' },
]

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
  if (props.words.length === 0) return
  const shuffled = [...props.words].sort(() => Math.random() - 0.5)
  const count = Math.min(countPerSession.value, props.words.length)
  sessionWords.value = shuffled.slice(0, count)
  currentIndex.value = 0
  correctCount.value = 0
  elapsedSeconds.value = 0
  userInput.value = ''
  flipped.value = false
  showFeedback.value = false
  phase.value = 'drilling'
  startTimer()
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
  speak({
    text,
    lang: props.lang === 'chinese' ? 'zh-CN' : 'en-US',
    rate: 0.9,
  })
}

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
    color: $primary-color;
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
  grid-template-columns: repeat(4, 1fr);
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

    &:hover { border-color: $primary-color; color: $primary-color; }

    &.active {
      background: $primary-color;
      border-color: $primary-color;
      color: $on-strong;
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

    &:hover { background: $danger-light; color: $danger-color; }
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
      color: $primary-color;
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
    background: rgba(var(--success-rgb), 0.12);
    border-color: $success-color;
    color: $success-color;
  }
  &.wrong {
    background: rgba(var(--danger-rgb), 0.12);
    border-color: $danger-color;
    color: $danger-color;
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
    background: rgba(var(--success-rgb), 0.12);
    color: $success-color;
  }
  &.no {
    background: rgba(var(--danger-rgb), 0.12);
    color: $danger-color;

    b { color: $danger-color; margin-left: 4px; }
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

    .done-num { font-size: 48px; font-weight: 900; color: $primary-color; }
    .done-div { font-size: 28px; color: $text-muted; }
    .done-total { font-size: 28px; font-weight: 700; color: $text-sub; }
  }
  .done-rate { font-size: 14px; color: $text-sub; margin-top: 8px; }
  .done-time { font-size: 12px; color: $text-muted; margin-top: 4px; }
}

.done-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 28px;
}

body.dark-mode {
  .flip-card.flipped { background: rgba(var(--primary-rgb), 0.15); }
  .choice-item.correct { background: rgba(var(--success-rgb), 0.15); }
  .choice-item.wrong { background: rgba(var(--danger-rgb), 0.15); }
  .drill-feedback.ok { background: rgba(var(--success-rgb), 0.15); }
  .drill-feedback.no { background: rgba(var(--danger-rgb), 0.15); }
}
</style>