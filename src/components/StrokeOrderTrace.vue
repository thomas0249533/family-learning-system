<template>
  <div class="stroke-trace">
    <div class="stroke-trace__head">
      <div class="stroke-trace__pinyin">{{ pinyin || '——' }}</div>
      <button class="stroke-trace__clear" type="button" @click="clear">清除重描</button>
    </div>

    <div class="stroke-trace__board">
      <canvas
        ref="canvasRef"
        class="stroke-trace__canvas"
        :width="size"
        :height="size"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointerleave="onUp"
      ></canvas>
    </div>

    <div class="stroke-trace__foot">
      <span class="stroke-trace__hint" aria-live="polite">{{ hintText }}</span>
      <span v-if="tier.label" class="stroke-trace__coverage" :class="`is-${tier.key}`">
        描红覆盖 {{ tier.label }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  coverageTier,
  isOutsideFrame,
  traceFrameInset,
  traceHintOf,
} from '@core/handwriting/trace'

const props = defineProps<{
  /** 要练习的汉字 */
  char: string
  /** 拼音（可选，来自知识点 metadata.pinyin） */
  pinyin?: string
  /** 画布边长（CSS 像素） */
  size?: number
}>()

const size = props.size ?? 300
const canvasRef = ref<HTMLCanvasElement | null>(null)
const coverage = ref(0)
/** 这一遍有没有笔画落在田字格之外（写飞了）；每次清除重描复位 */
const overflow = ref(false)

/** 覆盖度档位：徽标文案 + 建议文案都出自纯函数，见 `core/handwriting/trace.ts` */
const tier = computed(() => coverageTier(coverage.value))
/** 底部提示：溢出优先于覆盖度建议（写飞了是当下就能改的动作问题） */
const hintText = computed(
  () => traceHintOf({ coverage: coverage.value, overflow: overflow.value }) || '在田字格里描红，先描满再求准'
)

const GUIDE_COLOR = 'rgba(150, 160, 175, 0.32)' // check-hex-allow  canvas 描红引导色
const INK_COLOR = '#2d6a4f' // check-hex-allow  主色（与 tokens.ts #2d6a4f 同值），canvas 墨迹
const GRID_COLOR = 'rgba(120, 130, 145, 0.18)' // check-hex-allow  canvas 米字格

let ctx: CanvasRenderingContext2D | null = null
let drawing = false
let lastX = 0
let lastY = 0

/** 主色 + 设备像素比，画布才清晰 */
function setupCanvas(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = size * dpr
  canvas.height = size * dpr
  ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  drawGuide()
}

/**
 * 描红引导：**田字格 + 淡色大字**（外加更淡的米字对角线作辅助）。
 *
 * 为什么把中线改成虚线：实线十字会和孩子的笔画抢视觉，虚线读起来是"参考线"，
 * 而笔迹是实色 —— 一眼能分出"哪些是我写的"。对角线再淡一档，
 * 因为米字格的四条斜线在描红场景里只是辅助定位，不该抢中线的位置。
 */
function drawGuide(): void {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  const inset = traceFrameInset(size)
  ctx.clearRect(0, 0, size, size)

  // 米字格对角线（最淡，先画，会被后画的线压住）
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(inset, inset); ctx.lineTo(size - inset, size - inset)
  ctx.moveTo(size - inset, inset); ctx.lineTo(inset, size - inset)
  ctx.stroke()

  // 田字格：外框（实线）+ 十字中线（虚线）
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2)
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(size / 2, inset); ctx.lineTo(size / 2, size - inset)
  ctx.moveTo(inset, size / 2); ctx.lineTo(size - inset, size / 2)
  ctx.stroke()
  ctx.setLineDash([])

  // 引导大字
  ctx.fillStyle = GUIDE_COLOR
  ctx.font = `bold ${Math.floor(size * 0.62)}px "KaiTi", "STKaiti", "楷体", "SimSun", serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(props.char, size / 2, size / 2 + size * 0.02)
  coverage.value = 0
  overflow.value = false
}

function pointPos(e: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * size,
    y: ((e.clientY - rect.top) / rect.height) * size,
  }
}

function onDown(e: PointerEvent): void {
  if (!ctx) return
  drawing = true
  const p = pointPos(e)
  markOverflow(p)
  lastX = p.x; lastY = p.y
  // 起笔点
  ctx.fillStyle = INK_COLOR
  ctx.beginPath()
  ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
  ctx.fill()
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!drawing || !ctx) return
  const p = pointPos(e)
  markOverflow(p)
  ctx.strokeStyle = INK_COLOR
  ctx.lineWidth = Math.max(4, size * 0.02)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(lastX, lastY)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  lastX = p.x; lastY = p.y
}

/**
 * 记一次"写出格"。
 *
 * 只在**第一次**出去时置位（`if (overflow.value) return`）：一路拖出画面会
 * 触发几十次 pointermove，每次都写一遍 ref 只会让底部那句提示反复重排。
 */
function markOverflow(p: { x: number; y: number }): void {
  if (overflow.value) return
  if (isOutsideFrame(p.x, p.y, size)) overflow.value = true
}

function onUp(): void {
  if (!drawing) return
  drawing = false
  computeCoverage()
}

/** 统计描红覆盖度：墨迹像素 / 画布面积（粗略，仅作正反馈） */
function computeCoverage(): void {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  const w = canvas.width
  const h = canvas.height
  const data = ctx.getImageData(0, 0, w, h).data
  let ink = 0
  let total = 0
  for (let i = 0; i < data.length; i += 4 * 16) {
    total++
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // 墨迹主色 #2d6a4f ≈ (45,106,79)  // check-hex-allow 仅用于像素近似判定，非样式
    if (Math.abs(r - 45) < 60 && Math.abs(g - 106) < 60 && Math.abs(b - 79) < 60) ink++
  }
  coverage.value = total > 0 ? Math.min(100, Math.round((ink / total) * 100 * 6)) : 0
}

function clear(): void {
  drawGuide()
}

onMounted(setupCanvas)
watch(() => props.char, () => drawGuide())
</script>

<style scoped lang="scss">
.stroke-trace {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;

  &__head {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  &__pinyin {
    font-size: var(--font-lg);
    font-weight: 700;
    color: $primary-text;
    letter-spacing: 0.5px;
  }
  &__clear {
    padding: 4px 12px;
    border: 1px solid $border-color;
    border-radius: 8px;
    background: $card-bg;
    color: $text-sub;
    font-size: var(--font-xs);
    font-family: inherit;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-standard);
    &:hover { border-color: $primary-color; color: $primary-text; }
  }
  &__board {
    border-radius: 14px;
    background: $card-bg;
    box-shadow: $shadow-sm;
    padding: 8px;
    touch-action: none;
  }
  &__canvas {
    display: block;
    width: 100%;
    max-width: 320px;
    height: auto;
    cursor: crosshair;
    border-radius: 10px;
  }
  &__foot {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--font-xs);
    color: $text-muted;
  }
  &__coverage {
    font-weight: 700;
    padding: 2px 10px;
    border-radius: 20px;
    color: $primary-text;
    background: $primary-light;

    /* 档位只换色相，不改字号与结构：徽标长度稳定，孩子不会觉得"页面在变" */
    &.is-light { color: $text-sub; background: $bg-color-hover; }
    &.is-good,
    &.is-full { color: $success-text; background: $success-light; }
  }
}
</style>
