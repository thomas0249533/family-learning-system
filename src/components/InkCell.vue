<template>
  <div class="ink-cell" :class="{ 'is-active': active, 'is-disabled': disabled }">
    <div class="ink-cell__pinyin" aria-hidden="true">{{ pinyin || '\u00a0' }}</div>
    <div class="ink-cell__board">
      <canvas
        ref="canvasRef"
        class="ink-cell__canvas"
        :style="{ width: size + 'px', height: size + 'px' }"
        role="img"
        :aria-label="label"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @pointerleave="onUp"
      ></canvas>
    </div>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// InkCell · 手写板的**一格**（单字画布）
// ---------------------------------------------------------------------
// ## 为什么是 canvas 而不是 SVG
// 手写要的是"笔一落下就出墨"的即时感：canvas 逐段描线是最短路径，
// 而 Vue 驱动的 SVG path 列表每加一个点就要过一次 diff。只读回放（批改页）
// 才用 SVG（`InkStrokes.vue`）—— 那边要的是"任意缩放都清晰 + 可断言 DOM"。
// 两边共用同一套数据（`core/reading/ink.ts` 的 InkStroke），不共用渲染器。
//
// ## 笔迹数据结构不在这里发明
// 点坐标一律过 `toNormalized()` 归一化到 0..1，序列化走 `serializeStrokes()`
// （`core/reading/ink.ts`，脏输入零抛 + 45 条单测）。本组件只负责"把指针变成点"。
//
// ## 为什么每格一个 canvas，而不是整块板一个大 canvas
// 半对批改要逐字判定、撤销要逐格撤销、清空要逐格清空。整块板一个画布之后，
// "这一笔属于哪个字"只能靠 x 坐标反推，边界字必然归属模糊。
//
// ## 门禁
// 画布必须写字面色值（canvas API 只吃字符串），两处都带 `check-hex-allow`；
// 优先从 CSS 变量读（换肤跟随），读不到才用兜底值。
// =====================================================================
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  INK_DEFAULT_WIDTH,
  isFiniteNumber,
  serializeStrokes,
  toNormalized,
  type InkPoint,
  type InkStroke,
} from '@core/reading/ink'
import { cellAriaLabel, deserializeCell, isEmptyCells } from '@core/handwriting/pad'

const props = withDefaults(defineProps<{
  /** 第几格（0 基，只用于读屏与"当前格"高亮） */
  index?: number
  /** 共几格 */
  total?: number
  /** 该格的拼音提示（看拼音写词语时逐格给） */
  pinyin?: string
  /** 画布 CSS 边长（px）。手写板场景下越小越难写，见 HandwritingPad 的取值说明 */
  size?: number
  /** 提交后锁死 */
  disabled?: boolean
  /** 是否为当前活动格（只影响描边高亮，不影响事件） */
  active?: boolean
  /** 线宽（屏幕像素）。默认取 ink.ts 常量的 2 倍：3px 在汉字笔画上偏细 */
  strokeWidth?: number
}>(), {
  index: 0,
  total: 1,
  pinyin: '',
  size: 120,
  disabled: false,
  active: false,
  strokeWidth: INK_DEFAULT_WIDTH * 2,
})

const emit = defineEmits<{
  /** 每一次落笔/抬笔都通知父层（父层据此算 hasInk） */
  (e: 'change', strokes: number): void
  /** 指针进入本格（父层据此切换"当前格"，撤销/清空作用在这一格） */
  (e: 'activate'): void
}>()

/** 兜底色值：换肤正常时不会用到，只在 `getComputedStyle` 拿不到变量（测试/极端环境）时生效 */
const FALLBACK_INK = '#16261f' // check-hex-allow  canvas 墨色兜底（= --text-main 的浅色预设）
const FALLBACK_GRID = '#cfdcd5' // check-hex-allow  canvas 田字格兜底（= --border-color 的浅色预设）

const SWATCH_INK = '--text-main'
const SWATCH_GRID = '--border-color'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const strokes = ref<InkStroke[]>([])

let ctx: CanvasRenderingContext2D | null = null
let drawing = false
let lastX = 0
let lastY = 0
/** 设备像素比：只在挂载时读一次（窗口跨屏拖动导致的 dpr 变化不值得重设画布） */
let dpr = 1
let inkColor = FALLBACK_INK
let gridColor = FALLBACK_GRID

const label = computed(() => cellAriaLabel(props.index, props.total, strokes.value.length))

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

function setupCanvas(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = props.size * dpr
  canvas.height = props.size * dpr
  ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  inkColor = cssVar(SWATCH_INK, FALLBACK_INK)
  gridColor = cssVar(SWATCH_GRID, FALLBACK_GRID)
  redraw()
}

/** 田字格：外框 + 横竖中线（小学习字标准）。对角线（米字格）留给描红页 */
function drawGrid(c: CanvasRenderingContext2D): void {
  const s = props.size
  c.save()
  c.strokeStyle = gridColor
  c.lineWidth = 1
  c.strokeRect(0.5, 0.5, s - 1, s - 1)
  // 中线用虚线：实线会和孩子的笔画抢视觉权重
  c.setLineDash([4, 4])
  c.beginPath()
  c.moveTo(s / 2, 0)
  c.lineTo(s / 2, s)
  c.moveTo(0, s / 2)
  c.lineTo(s, s / 2)
  c.stroke()
  c.restore()
}

/**
 * 一条笔画 → 路径。
 *
 * 用「相邻点中点」的二次贝塞尔（`Q` 到中点、控制点是原始采样点），而不是
 * 直接把点连成折线：折线在 60Hz 采样下能看出棱角，而贝塞尔**不改变首尾点**
 * —— 起笔与收笔仍与真实笔尖重合（描红/写字场景必须如此，不能像抽象曲线那样外鼓）。
 */
function traceStroke(c: CanvasRenderingContext2D, stroke: InkStroke): void {
  const pts = stroke.points
  if (!Array.isArray(pts) || pts.length === 0) return
  const s = props.size
  const px = (p: InkPoint): [number, number] => {
    const x = isFiniteNumber(p?.x) ? p.x : 0
    const y = isFiniteNumber(p?.y) ? p.y : 0
    return [x * s, y * s]
  }
  c.beginPath()
  if (pts.length === 1) {
    const [x, y] = px(pts[0])
    // 单点也要看得见（手指点一下就产生 1 点笔迹）
    c.arc(x, y, Math.max(1, stroke.width / 2), 0, Math.PI * 2)
    c.fillStyle = inkColor
    c.fill()
    return
  }
  const [x0, y0] = px(pts[0])
  c.moveTo(x0, y0)
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, y1] = px(pts[i])
    const [x2, y2] = px(pts[i + 1])
    c.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2)
  }
  const [xl, yl] = px(pts[pts.length - 1])
  c.lineTo(xl, yl)
  c.strokeStyle = inkColor
  c.lineWidth = stroke.width
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.stroke()
}

function redraw(): void {
  const c = ctx
  if (!c) return
  c.clearRect(0, 0, props.size, props.size)
  drawGrid(c)
  for (const stroke of strokes.value) traceStroke(c, stroke)
}

function pointOf(e: PointerEvent): InkPoint {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return toNormalized(e.clientX, e.clientY, rect)
}

function onDown(e: PointerEvent): void {
  if (props.disabled || !ctx) return
  // 只认主键/笔尖：右键与掌托（被系统报成非 primary）不该落墨
  if (e.button !== undefined && e.button !== 0) return
  emit('activate')
  drawing = true
  const p = pointOf(e)
  lastX = p.x
  lastY = p.y
  strokes.value.push({ color: 'primary', width: props.strokeWidth, points: [p] })
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  redraw()
  emit('change', strokes.value.length)
}

function onMove(e: PointerEvent): void {
  if (!drawing || !ctx) return
  const p = pointOf(e)
  // 抽稀：相邻点太近没有信息量，只会让序列化串变长
  if (Math.abs(p.x - lastX) < 0.002 && Math.abs(p.y - lastY) < 0.002) return
  lastX = p.x
  lastY = p.y
  const current = strokes.value[strokes.value.length - 1]
  if (!current) return
  current.points.push(p)
  redraw()
}

function onUp(): void {
  if (!drawing) return
  drawing = false
  emit('change', strokes.value.length)
}

/* ---------------- 暴露给 HandwritingPad 的最小接口 ---------------- */

function isEmpty(): boolean {
  return isEmptyCells([serialize()])
}

/** 本格的序列化串（空态是 `'[]'`，与 pad.ts 的 EMPTY_CELL 一致） */
function serialize(): string {
  return serializeStrokes(strokes.value)
}

/** 恢复（从断点/批改页回填时用；也用于"清空后撤销"） */
function restore(raw: string): void {
  strokes.value = deserializeCell(raw)
  redraw()
  emit('change', strokes.value.length)
}

function clear(): void {
  if (props.disabled) return
  if (strokes.value.length === 0) return
  strokes.value = []
  redraw()
  emit('change', 0)
}

/** 撤销**最后一笔**（不是最后一个点：孩子的心智是"这一笔写坏了"） */
function undo(): void {
  if (props.disabled) return
  if (strokes.value.length === 0) return
  strokes.value.pop()
  redraw()
  emit('change', strokes.value.length)
}

function strokeCount(): number {
  return strokes.value.length
}

defineExpose({ isEmpty, serialize, restore, clear, undo, strokeCount })

onMounted(setupCanvas)

watch(
  () => props.size,
  () => setupCanvas()
)

onBeforeUnmount(() => {
  ctx = null
})
</script>

<style scoped lang="scss">
.ink-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  &__pinyin {
    font-size: var(--font-2xs);
    color: $text-muted;
    line-height: 1.4;
    min-height: 1.4em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 卡片外观交给"背景 + 描边"，**不给 box-shadow**：
     `background: $card-bg` + `border-radius` + `box-shadow` 三件套同时出现
     会被 check:primitives（R1）判成"视图里自绘第二个 AppCard"。
     这里也不需要阴影 —— 一格纸不需要浮起来。 */
  &__board {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-color;
    padding: 2px;
    touch-action: none;
    transition: border-color var(--duration-fast) var(--ease-standard);
  }

  &__canvas {
    display: block;
    cursor: crosshair;
    border-radius: var(--radius-xs);
  }

  &.is-active &__board {
    border-color: $primary-color;
  }

  &.is-disabled &__canvas {
    cursor: default;
    opacity: 0.72;
  }
}
</style>
