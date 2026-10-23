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
          :class="{ 'noise-btn--active': currentNoise === opt.value }"
          :aria-pressed="currentNoise === opt.value"
          @click="selectNoise(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- 音量（仅开启非关闭音源时显示） -->
    <section v-if="currentNoise !== 'off'" class="focus-panel__section">
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

type NoiseOption = NoiseKind | 'off'
const noiseOptions: { value: NoiseOption; label: string }[] = [
  { value: 'rain', label: '雨声' },
  { value: 'campfire', label: '篝火' },
  { value: 'white', label: '纯白' },
  { value: 'off', label: '关' },
]

const currentNoise = ref<NoiseOption>('off')
const volume = ref(0.5)

// ---------- 噪音引擎（懒创建，退出即销毁） ----------
let gen: NoiseGenerator | null = null
function ensureGen(): NoiseGenerator {
  if (!gen) gen = new NoiseGenerator({ volume: volume.value })
  return gen
}

async function selectNoise(opt: NoiseOption): Promise<void> {
  currentNoise.value = opt
  if (opt === 'off') {
    gen?.fadeOutAndStop()
    return
  }
  const g = ensureGen()
  // 铁律：用户点击即恢复 AudioContext（suspended 状态下无声）
  await g.start(opt, { volume: volume.value })
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

  // 音源分段控件
  .noise-switch {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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
