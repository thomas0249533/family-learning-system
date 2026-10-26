<template>
  <div class="focus-panel" :class="{ 'focus-panel--focused': uiStore.isFocusMode }">
    <!-- 环境音源切换 -->
    <section class="focus-panel__section">
      <div class="focus-panel__label">环境音</div>
      <div class="noise-switch" role="group" aria-label="白噪音音源">
        <button
          v-for="opt in noiseOptions"
          :key="opt.value"
          type="button"
          class="noise-btn"
          :class="{ 'noise-btn--active': source === opt.value }"
          :aria-pressed="source === opt.value"
          @click="selectNoise(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- V2.7 · 轨道 B2：我的音频（本地 MP3，全部留在本机） -->
      <div class="local-sounds">
        <div class="local-sounds__head">
          <span class="local-sounds__title">我的音频</span>
          <button
            type="button"
            class="local-sounds__import"
            :disabled="importing"
            @click="fileInput?.click()"
          >{{ importing ? '导入中…' : '导入' }}</button>
          <input
            ref="fileInput"
            class="local-sounds__file"
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac"
            aria-label="导入本地音频文件"
            @change="onPickFile"
          />
        </div>

        <div v-if="sounds.length > 0" class="local-sounds__list">
          <span
            v-for="s in sounds"
            :key="s.soundId"
            class="sound-chip"
            :class="{ 'sound-chip--active': source === 'file' && activeSoundId === s.soundId }"
          >
            <button
              type="button"
              class="sound-chip__play"
              :aria-pressed="source === 'file' && activeSoundId === s.soundId"
              :title="`${s.name} · ${formatBytes(s.size)}`"
              @click="selectSound(s.soundId)"
            >🎵 {{ s.name }}</button>
            <button
              type="button"
              class="sound-chip__del"
              :aria-label="`删除 ${s.name}`"
              @click="removeSound(s.soundId)"
            >✕</button>
          </span>
        </div>

        <p v-if="importError" class="local-sounds__error" role="alert">{{ importError }}</p>
        <p v-else-if="sounds.length === 0" class="local-sounds__hint">
          可以把自家的雨声录音或轻音乐放进来（单个 ≤ 8MB，最多 5 个）
        </p>
      </div>
    </section>

    <!-- 音量（仅开启音源时显示） -->
    <section v-if="isPlaying" class="focus-panel__section">
      <div class="focus-panel__label">音量</div>
      <input
        type="range"
        class="vol-slider"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        aria-label="环境音音量"
        @input="onVolume"
      />
    </section>

    <!-- 番茄钟倒计时环 -->
    <section class="focus-panel__section pomodoro">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring__bg" cx="60" cy="60" r="52" />
          <circle
            class="ring__fg"
            cx="60"
            cy="60"
            r="52"
            transform="rotate(-90 60 60)"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
          />
        </svg>
        <div class="ring-center">
          <div class="pomo-time">{{ mmss }}</div>
          <div class="pomo-phase">{{ phaseText }}</div>
        </div>
      </div>

      <div class="pomo-controls">
        <button type="button" class="pomo-btn pomo-btn--primary" @click="togglePomo">
          {{ toggleLabel }}
        </button>
        <button type="button" class="pomo-btn" @click="resetPomo">重置</button>
      </div>

      <div class="pomo-rounds">已完成专注 {{ pomo.completedFocus }} 回合</div>
    </section>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// FocusMode · 专注模式悬浮面板（V2.2 · 轨道 H）
// ---------------------------------------------------------------------
// 固定定位、z-index:200，与 .focus-exit-btn 同级（在 AppShell 内挂载）。
// 面板自身状态（音源选择、番茄钟）均为临时态 —— 随专注模式销毁而消失，
// 退出专注模式即销毁 AudioContext，不影响主系统内存。
// =====================================================================
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useUiStore } from '@core/stores/ui'
import { NoiseGenerator, type NoiseKind } from '@core/focus/NoiseGenerator'
import {
  MAX_SOUNDS,
  deleteCustomSound,
  formatBytes,
  listCustomSounds,
  loadSoundBlob,
  saveCustomSound,
  type CustomSoundMeta,
  type SoundRejectReason,
} from '@core/focus/customSoundStore'
import {
  computeProgress,
  createInitialPomodoro,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
  tickTimer,
  type PomodoroState,
} from '@core/focus/pomodoro'

const uiStore = useUiStore()

/**
 * 音源选择共三种形态：内置合成噪音 / 本地音频（'file'）/ 关。
 * 之所以把"本地音频"也塞进同一个状态机，是为了让「同一时刻只有一处在响」
 * 由**一个 ref** 保证 —— 分成两套状态就一定会出现"两个按钮同时高亮"。
 */
type SourceOption = NoiseKind | 'off' | 'file'

const noiseOptions: { value: Exclude<SourceOption, 'file'>; label: string }[] = [
  { value: 'rain', label: '雨声' },
  { value: 'ocean', label: '海浪' },
  { value: 'stream', label: '溪流' },
  { value: 'campfire', label: '篝火' },
  { value: 'white', label: '纯白' },
  { value: 'off', label: '关' },
]

const source = ref<SourceOption>('off')
const isPlaying = computed(() => source.value !== 'off')
const activeSoundId = ref('')
const volume = ref(0.5)

// ---------- V2.7 · 轨道 B2：本地音频 ----------
const sounds = ref<CustomSoundMeta[]>([])
const importing = ref(false)
const importError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const REJECT_TEXT: Record<SoundRejectReason, string> = {
  empty: '这个文件是空的',
  'too-large': '文件太大了（单个最多 8MB）',
  'not-audio': '这不是音频文件',
  'too-many': `最多保存 ${MAX_SOUNDS} 段，先删掉一个再导入`,
  duplicate: '这段音频已经导入过了',
}

async function refreshSounds(): Promise<void> {
  try {
    sounds.value = await listCustomSounds()
  } catch (e) {
    // 读不出来不该让整个专注面板崩掉：当作"还没有导入过"
    console.warn('[本地音频] 读取列表失败', e)
    sounds.value = []
  }
}

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 清空 value：否则连续导入同一个文件时 change 不再触发（浏览器不会重复派发）
  input.value = ''
  if (!file) return

  importing.value = true
  importError.value = ''
  const result = await saveCustomSound(file)
  importing.value = false

  if (!result.ok) {
    importError.value = REJECT_TEXT[result.reason]
    return
  }

  await refreshSounds()
  await selectSound(result.meta.soundId)
}

async function selectSound(soundId: string): Promise<void> {
  importError.value = ''
  try {
    const blob = await loadSoundBlob(soundId)
    if (!blob) {
      importError.value = '这段音频已经不在了，请重新导入'
      return
    }
    const g = ensureGen()
    // 解码结果**用完即弃**：不缓存、不放进 ref，否则一段音频就是上百 MB 常驻内存
    const buffer = await g.decodeToBuffer(await blob.arrayBuffer())
    await g.startBuffer(buffer, { volume: volume.value })
    source.value = 'file'
    activeSoundId.value = soundId
  } catch (e) {
    console.warn('[本地音频] 解码失败', e)
    importError.value = '这段音频无法播放（格式不受支持或文件已损坏）'
  }
}

async function removeSound(soundId: string): Promise<void> {
  try {
    await deleteCustomSound(soundId)
  } catch (e) {
    console.warn('[本地音频] 删除失败', e)
  }
  if (activeSoundId.value === soundId) {
    gen?.fadeOutAndStop()
    source.value = 'off'
    activeSoundId.value = ''
  }
  await refreshSounds()
}

// ---------- 噪音引擎（懒创建，退出即销毁） ----------
let gen: NoiseGenerator | null = null
function ensureGen(): NoiseGenerator {
  if (!gen) gen = new NoiseGenerator({ volume: volume.value })
  return gen
}

function selectNoise(opt: Exclude<SourceOption, 'file'>): void {
  importError.value = ''
  activeSoundId.value = ''

  if (opt === 'off') {
    source.value = 'off'
    gen?.fadeOutAndStop()
    return
  }

  source.value = opt
  // 铁律：用户点击即恢复 AudioContext（suspended 状态下无声）
  void ensureGen().start(opt, { volume: volume.value })
}

function onVolume(e: Event): void {
  const target = e.target as HTMLInputElement
  volume.value = Number(target.value)
  gen?.setVolume(volume.value)
}

// ---------- 番茄钟 ----------
const RADIUS = 52
const circumference = 2 * Math.PI * RADIUS

const pomo = ref<PomodoroState>(createInitialPomodoro())
const frameNow = ref(Date.now())

const progress = computed(() => computeProgress(pomo.value, frameNow.value))
const ratio = computed(() =>
  progress.value.totalMs > 0 ? progress.value.remainingMs / progress.value.totalMs : 0,
)
const dashOffset = computed(() => circumference * (1 - ratio.value))

const mmss = computed(() => {
  const totalSec = Math.ceil(progress.value.remainingMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const phaseText = computed(() => {
  switch (pomo.value.phase) {
    case 'focus':
      return '专注'
    case 'shortBreak':
      return '短休息'
    case 'longBreak':
      return '长休息'
  }
})

const toggleLabel = computed(() => {
  if (pomo.value.status === 'running') return '暂停'
  if (pomo.value.status === 'paused') return '继续'
  return '开始'
})

function togglePomo(): void {
  const now = Date.now()
  if (pomo.value.status === 'running') {
    pomo.value = pauseTimer(pomo.value, now)
  } else if (pomo.value.status === 'paused') {
    pomo.value = resumeTimer(pomo.value, now)
  } else {
    pomo.value = startTimer(pomo.value, now)
  }
}

function resetPomo(): void {
  pomo.value = resetTimer(pomo.value)
}

// 动画帧循环：仅负责重算时间戳与自动切阶段。
// 即使后台标签页被节流，恢复时也能从绝对时间戳正确推导（绝不靠累加）。
let raf = 0
function loop(): void {
  frameNow.value = Date.now()
  if (pomo.value.status === 'running') {
    pomo.value = tickTimer(pomo.value, frameNow.value)
  }
  raf = requestAnimationFrame(loop)
}

onMounted(() => {
  raf = requestAnimationFrame(loop)
  void refreshSounds()
})

onUnmounted(() => {
  // 内存安全：退出专注模式即销毁 AudioContext，释放一切
  cancelAnimationFrame(raf)
  gen?.destroy()
  gen = null
})
</script>

<style lang="scss">
.focus-panel {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 200;
  width: 260px;
  padding: $space-4;
  display: flex;
  flex-direction: column;
  gap: $space-3;
  background: $card-bg;
  border: 1px solid $border-light;
  border-radius: $radius-lg;
  box-shadow: $shadow-md;
  color: $text-main;
  font-family: inherit;

  .focus-panel__section {
    display: flex;
    flex-direction: column;
    gap: $space-2;
  }

  .focus-panel__label {
    font-size: $font-xs;
    font-weight: 700;
    color: $text-sub;
    letter-spacing: 0.3px;
  }

  // 音源分段控件（V2.7 起 6 个音源 → 3 列两行）
  .noise-switch {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: $space-1;
  }

  .noise-btn {
    padding: 7px 4px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-color;
    color: $text-sub;
    font-size: $font-xs;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;

    &:hover {
      background: $bg-color-hover;
      color: $text-main;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: 2px;
    }
    &--active {
      background: var(--primary-text);
      color: var(--text-on-primary);
      border-color: var(--primary-text);
    }
  }

  // 音量滑块
  .vol-slider {
    width: 100%;
    accent-color: var(--primary-text);
    cursor: pointer;
  }

  /* ===== V2.7 · 轨道 B2：我的音频 ===== */
  .local-sounds {
    margin-top: $space-2;
    display: flex;
    flex-direction: column;
    gap: $space-1;
  }

  .local-sounds__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $space-2;
  }

  .local-sounds__title {
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-muted;
    letter-spacing: 0.3px;
  }

  .local-sounds__import {
    padding: 3px 10px;
    border: 1px dashed $border-color;
    border-radius: $radius-full;
    background: transparent;
    color: $primary-text;
    font-family: inherit;
    font-size: $font-2xs;
    font-weight: 700;
    cursor: pointer;
    transition: background $duration-fast $ease-standard;

    &:hover {
      background: $primary-light;
      border-color: $primary-color;
    }
    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: 2px;
    }
  }

  /* 原生 file input：视觉隐藏但保留可访问性（由上方按钮 click() 触发） */
  .local-sounds__file {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .local-sounds__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 108px;
    overflow-y: auto;
  }

  .sound-chip {
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-color;

    &--active {
      border-color: $primary-color;
      background: $primary-light;
    }
  }

  .sound-chip__play {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 0;
    background: transparent;
    color: $text-main;
    font-family: inherit;
    font-size: $font-2xs;
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: -2px;
    }
  }

  .sound-chip__del {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    margin-right: 3px;
    border: 0;
    border-radius: $radius-full;
    background: transparent;
    color: $text-muted;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;

    &:hover {
      background: $bg-color-hover;
      color: $danger-text;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: 1px;
    }
  }

  .local-sounds__hint,
  .local-sounds__error {
    margin: 0;
    font-size: $font-2xs;
    line-height: $leading-normal;
  }

  .local-sounds__hint { color: $text-muted; }
  .local-sounds__error { color: $danger-text; }

  // 番茄钟
  .pomodoro {
    align-items: center;
  }

  .ring-wrap {
    position: relative;
    width: 160px;
    height: 160px;
  }

  .ring {
    width: 100%;
    height: 100%;
  }

  .ring__bg {
    fill: none;
    stroke: $border-light;
    stroke-width: 8;
  }

  .ring__fg {
    fill: none;
    stroke: $primary-text;
    stroke-width: 8;
    stroke-linecap: round;
  }

  .ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  .pomo-time {
    font-size: $font-2xl;
    font-weight: 800;
    color: $text-main;
    font-variant-numeric: tabular-nums;
  }

  .pomo-phase {
    font-size: $font-sm;
    font-weight: 700;
    color: $primary-text;
  }

  .pomo-controls {
    display: flex;
    gap: $space-2;
    width: 100%;
  }

  .pomo-btn {
    flex: 1;
    padding: 8px 0;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-color;
    color: $text-main;
    font-size: $font-sm;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;

    &:hover {
      background: $bg-color-hover;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: 2px;
    }
    &--primary {
      background: var(--primary-text);
      color: var(--text-on-primary);
      border-color: var(--primary-text);

      &:hover {
        opacity: 0.94;
      }
    }
  }

  .pomo-rounds {
    font-size: $font-xs;
    color: $text-muted;
    font-weight: 600;
  }
}

// 尊重 prefers-reduced-motion：仅在用户未要求减少动效时声明过渡
@media (prefers-reduced-motion: no-preference) {
  .focus-panel {
    transition: opacity $duration-base var(--motion-ease, ease),
      transform $duration-base var(--motion-ease, ease);
  }
  .noise-btn,
  .pomo-btn {
    transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  }
  .ring__fg {
    transition: stroke-dashoffset $duration-base linear;
  }
}
</style>
