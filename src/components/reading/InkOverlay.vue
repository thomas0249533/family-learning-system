<template>
  <div ref="layerRef" class="ink-layer" :class="{ 'ink-layer--draw': mode !== 'browse' }">
    <!-- ===== 工具栏：正文顶部预留的一条（不压在正文上） ===== -->
    <div class="ink-toolbar" role="toolbar" aria-label="划线工具">
      <button
        type="button"
        class="ink-btn"
        :aria-pressed="mode === 'draw'"
        title="画笔：在正文上拖动画线"
        @click="setMode('draw')"
      >
        画笔
      </button>
      <button
        type="button"
        class="ink-btn"
        :aria-pressed="mode === 'browse'"
        title="浏览：正常阅读、可选中文字"
        @click="setMode('browse')"
      >
        浏览
      </button>
      <button
        type="button"
        class="ink-btn"
        :aria-pressed="mode === 'erase'"
        title="橡皮：点或拖过笔画即擦除"
        @click="setMode('erase')"
      >
        橡皮
      </button>

      <span class="ink-sep" aria-hidden="true"></span>

      <button
        v-for="tone in inkTones"
        :key="tone"
        type="button"
        class="ink-swatch"
        :style="{ '--ink-swatch-color': toneStroke(tone) }"
        :aria-pressed="color === tone"
        :aria-label="`${TONE_LABELS[tone]}笔`"
        :title="`${TONE_LABELS[tone]}笔`"
        @click="chooseTone(tone)"
      ></button>

      <span class="ink-sep" aria-hidden="true"></span>

      <button
        type="button"
        class="ink-btn ink-btn--clear"
        :disabled="strokes.length === 0"
        :aria-label="confirmingClear ? '确认清除本页全部笔迹' : '清除本页全部笔迹'"
        @click="onClearClick"
      >
        {{ confirmingClear ? '确认清除？' : '清除' }}
      </button>
    </div>

    <!-- ===== 画笔层：viewBox 0..1 等比压缩 → 用 non-scaling-stroke 保住线宽 ===== -->
    <svg
      class="ink-svg"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
    >
      <path
        v-for="p in paths"
        :key="p.key"
        class="ink-path"
        :d="p.d"
        :stroke="p.stroke"
        :stroke-width="p.width"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <path
        v-if="draftPath"
        class="ink-path ink-path--draft"
        :d="draftPath"
        :stroke="toneStroke(color)"
        :stroke-width="strokeWidthPx"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <!-- 屏幕阅读器播报（视觉隐藏）：笔画数量变化时读一次 -->
    <p class="ink-status" role="status" aria-live="polite">{{ statusText }}</p>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// InkOverlay · 阅读理解「划线辅助」画笔层（V1.6 · Stage D · D4）
// ---------------------------------------------------------------------
// ## 层叠方案（为什么这样挂）
// 一个 `position: absolute; inset: 0` 的 `<svg viewBox="0 0 1 1">`，挂在
// `ChineseText.vue` 的 `.text-host`（`position: relative`）里，**跟着正文一起在内容流
// 里排**。全仓的滚动其实是 `window` 在滚（AppShell 那层 `overflow-y: auto` 的 height
// 是 auto，不产生滚动上下文），所以只要画笔层和正文在**同一个盒子**里，滚动时天然
// 贴合 —— 不需要任何 scroll 同步，加了反而会因为事件顺序抖一帧。
//
// ## 为什么 viewBox 是 0..1 + preserveAspectRatio="none"
// 归一化坐标（0..1）让「痕迹」与容器像素尺寸解耦：换设备、折叠侧栏、resize 都不用换算。
// 代价是 viewBox 被非等比拉伸，**路径 stroke-width 会被拉成椭圆**，所以每条 path 必须带
// `vector-effect="non-scaling-stroke"`：此时 `stroke-width` 的单位变成屏幕像素
// （3 就是 3px），线宽在任何容器尺寸下都一致粗。
//
// ## 工具栏位置：正文顶部**预留一条**，不压在正文上
// 备选是"贴在正文右上角浮动"——但中文段落基本占满行宽，浮层一定会盖住第一行右侧的字，
// 而且被盖住的那几个字正好是孩子最可能想划的地方。所以选"预留一条"：
// 由 `ChineseText.vue` 的 `.text-host--ink .text-body { padding-top }` 让出 32px，
// 工具栏绝对定位在那一格里（右对齐）。代价是每张正文卡顶部多 32px 空白 ——
// 换来的是"永远不会挡住任何一个字"，且不随滚动位移。
//
// ## 两种/三种模式的 pointer 语义
//   浏览（默认）：`pointer-events: none` → 事件穿透，正文可正常选中复制；
//   画笔：`pointer-events: auto` + `touch-action: none`（**没有它手机上画线会带动页面滚动**），
//         同时给正文容器加 `.ink-drawing` 禁掉 `user-select`（否则拖动会顺带选中一片字）；
//   橡皮：同画笔的 pointer 语义，只是按下即命中删除。
//
// ## 持久化
// `sessionStorage`（按档案隔离，键见 `inkStorageKey`）。只在 `docKey` 变化时重读，
// 每次落笔后防抖 300ms 写入；`getItem`/`setItem` 全部 try/catch —— 隐私模式与配额满
// 都会抛，抛了也不能白屏，最多是"这次不保存"。
// =====================================================================
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentProfileId } from '@core/profile/currentProfile'
import {
  INK_DEFAULT_WIDTH,
  INK_TONES,
  deserializeStrokes,
  hitTestStroke,
  inkStorageKey,
  isFiniteNumber,
  serializeStrokes,
  toNormalized,
  toPathD,
} from '@core/reading/ink'
import type { InkPoint, InkStroke, ToneName } from '@core/reading/ink'

type InkMode = 'browse' | 'draw' | 'erase'

interface InkOverlayProps {
  /** 文档标识（`packageId:topicId` 一类）。为空时退化成"能画但不落盘" */
  docKey?: string
  /** 档案 id；不传则取 `currentProfileId()` */
  profileId?: string
  /** 默认颜色（进页面时的笔色） */
  defaultColor?: ToneName
  /** 线宽，屏幕像素 */
  strokeWidth?: number
  /** 橡皮命中半径，屏幕像素 */
  eraserSize?: number
}

const props = withDefaults(defineProps<InkOverlayProps>(), {
  docKey: '',
  profileId: '',
  defaultColor: 'warning',
  strokeWidth: 3,
  eraserSize: 14,
})

/** 落笔后写 sessionStorage 的防抖窗口 */
const SAVE_DEBOUNCE_MS = 300
/** 清除的二次确认窗口：超过这个时间自动退回"清除"（避免一直停在危险态） */
const CLEAR_CONFIRM_MS = 4000
/** 相邻采样点的最小间距（归一化）：太密的点没有信息量，还会让 `d` 变长 */
const MIN_POINT_DELTA = 0.0015

/** 色调 → 中文名（工具栏 aria-label / title 用） */
const TONE_LABELS: Record<ToneName, string> = {
  primary: '主色',
  warning: '高亮黄',
  danger: '批注红',
  success: '重点绿',
}

const inkTones = INK_TONES

const layerRef = ref<HTMLDivElement | null>(null)

const mode = ref<InkMode>('browse')
const color = ref<ToneName>(props.defaultColor)
const strokes = ref<InkStroke[]>([])
const draft = ref<InkPoint[]>([])
const confirmingClear = ref(false)

/** 画笔层盒子尺寸（ResizeObserver 维护） */
const box = ref<{ width: number; height: number }>({ width: 0, height: 0 })

/**
 * 指针状态。**必须在下面的 `watch(storageKey, …, { immediate: true })` 之前声明**：
 * immediate 的回调在 setup 里同步执行，声明在后面会撞 TDZ（`Cannot access before initialization`）。
 */
let activePointerId: number | null = null
let pendingClient: { x: number; y: number } | null = null
let rafHandle = 0

const strokeWidthPx = computed<number>(() => {
  const w = props.strokeWidth
  return isFiniteNumber(w) && w > 0 && w <= 48 ? w : INK_DEFAULT_WIDTH
})

/** 色调 → CSS 变量（**全仓不允许 hex / rgb，半透明一律走 rgb 三元组**） */
function toneStroke(tone: ToneName): string {
  return `var(--${tone}-color)`
}

const paths = computed(() =>
  strokes.value
    .map((stroke, index) => ({
      key: `s${index}`,
      d: toPathD(stroke.points),
      stroke: toneStroke(stroke.color),
      width: stroke.width,
    }))
    .filter((item) => item.d !== '')
)

const draftPath = computed(() => toPathD(draft.value))

const statusText = computed(() => {
  const base = `本页 ${strokes.value.length} 笔划线`
  if (mode.value === 'draw') return `${base}，画笔模式`
  if (mode.value === 'erase') return `${base}，橡皮模式`
  return `${base}，浏览模式`
})

// ---------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------

const resolvedProfileId = computed<string>(() =>
  props.profileId && props.profileId.trim() !== '' ? props.profileId : currentProfileId()
)

/** 当前文档的 storage 键；空串表示"不启用划线落盘" */
const storageKey = computed<string>(() =>
  props.docKey ? inkStorageKey(resolvedProfileId.value, props.docKey) : ''
)

let saveTimer = 0
/** 本次待写目标键（防抖期间固定，避免 docKey 中途变化把旧痕迹写到新文档里） */
let pendingSaveKey = ''

function writeStrokes(key: string, list: readonly InkStroke[]): void {
  if (!key || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(key, serializeStrokes(list))
  } catch {
    // 隐私模式 / 配额满：静默降级为"本次会话不保存"，绝不能因此白屏
  }
}

function readStrokes(key: string): InkStroke[] {
  if (!key || typeof sessionStorage === 'undefined') return []
  try {
    return deserializeStrokes(sessionStorage.getItem(key))
  } catch {
    return []
  }
}

function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (!pendingSaveKey) return
  writeStrokes(pendingSaveKey, strokes.value)
  pendingSaveKey = ''
}

function scheduleSave(): void {
  const key = storageKey.value
  if (!key) return
  pendingSaveKey = key
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS)
}

/** 立即落盘（清除笔迹、docKey 切换、组件卸载时用） */
function saveImmediately(): void {
  if (storageKey.value) pendingSaveKey = storageKey.value
  flushSave()
}

watch(
  storageKey,
  (next, prev) => {
    cancelPendingFrame()
    draft.value = []
    confirmingClear.value = false
    activePointerId = null
    // 先把上一份文档没写完的防抖尾部落盘（写的是**旧键**），再换数据
    if (prev) flushSave()
    strokes.value = readStrokes(next)
  },
  { immediate: true }
)

watch(
  () => props.defaultColor,
  (next) => {
    color.value = next
  }
)

// ---------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------

// 指针状态（activePointerId / pendingClient / rafHandle）声明在上面的 §持久化 之前，
// 原因是那里的 immediate watch 会在 setup 阶段同步执行。
function layerRect(): DOMRect | null {
  if (!layerRef.value) return null
  try {
    return layerRef.value.getBoundingClientRect()
  } catch {
    return null
  }
}

function localOf(clientX: number, clientY: number): InkPoint | null {
  const rect = layerRect()
  if (!rect) return null
  return toNormalized(clientX, clientY, rect)
}

function cancelPendingFrame(): void {
  if (rafHandle && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rafHandle)
  }
  rafHandle = 0
  pendingClient = null
}

/** 橡皮半径（归一化）：像素半径 / 盒子短边。各向异性下的折中，见文件头 */
function eraserRadius(): number {
  const rect = layerRect()
  const width = box.value.width > 0 ? box.value.width : (rect?.width ?? 0)
  const height = box.value.height > 0 ? box.value.height : (rect?.height ?? 0)
  const minSide = Math.min(width, height)
  if (!(minSide > 0)) return 0
  return props.eraserSize / minSide
}

function eraseAt(point: InkPoint): void {
  const radius = eraserRadius()
  if (!(radius > 0)) return
  const next = strokes.value.filter((stroke) => !hitTestStroke(stroke, point, radius))
  if (next.length === strokes.value.length) return
  strokes.value = next
  scheduleSave()
}

/** 把 pending 的那一个点落进草稿/橡皮（每帧最多一个点） */
function flushPoint(): void {
  const pending = pendingClient
  pendingClient = null
  if (!pending) return

  const point = localOf(pending.x, pending.y)
  if (!point) return

  if (mode.value === 'erase') {
    eraseAt(point)
    return
  }

  const last = draft.value[draft.value.length - 1]
  if (last && Math.abs(last.x - point.x) < MIN_POINT_DELTA && Math.abs(last.y - point.y) < MIN_POINT_DELTA) {
    return
  }
  draft.value.push(point)
}

function schedulePointFlush(): void {
  if (rafHandle !== 0) return
  // 没有 rAF（极老浏览器 / 测试环境）时退化成同步处理，功能不退化
  if (typeof requestAnimationFrame === 'undefined') {
    flushPoint()
    return
  }
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0
    flushPoint()
  })
}

function setHostSelecting(drawing: boolean): void {
  const host = layerRef.value?.parentElement
  if (!host) return
  host.classList.toggle('ink-drawing', drawing)
}

function commitDraft(): void {
  const points = draft.value
  draft.value = []
  // 单点（点一下没动）不落库：看不见的笔画存着只会让"清除"按钮莫名其妙亮着
  if (points.length < 2) return
  strokes.value.push({ color: color.value, width: strokeWidthPx.value, points: points.slice() })
  scheduleSave()
}

function onPointerDown(event: PointerEvent): void {
  if (mode.value === 'browse') return
  if (activePointerId !== null) return
  if (!event.isPrimary) return
  // 鼠标只认左键；触摸/手写的 button 恒为 0
  if (event.pointerType === 'mouse' && event.button !== 0) return

  const target = event.currentTarget as Element | null
  if (target && typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // 指针在 setPointerCapture 之前就失效（快速点按）：不影响本次绘制
    }
  }

  activePointerId = event.pointerId
  event.preventDefault()
  setHostSelecting(true)

  const point = localOf(event.clientX, event.clientY)
  if (!point) return

  if (mode.value === 'erase') {
    eraseAt(point)
    return
  }
  draft.value = [point]
}

function onPointerMove(event: PointerEvent): void {
  if (activePointerId === null || event.pointerId !== activePointerId) return
  pendingClient = { x: event.clientX, y: event.clientY }
  schedulePointFlush()
}

function onPointerEnd(event: PointerEvent): void {
  if (activePointerId === null || event.pointerId !== activePointerId) return

  // 收笔前补上最后一帧：否则每次抬笔都会少掉最后一小段
  flushPoint()
  cancelPendingFrame()

  const target = event.currentTarget as Element | null
  if (target && typeof target.releasePointerCapture === 'function') {
    try {
      target.releasePointerCapture(event.pointerId)
    } catch {
      // 已自动释放
    }
  }

  activePointerId = null
  setHostSelecting(false)

  if (mode.value === 'draw') commitDraft()
  else draft.value = []
}

// ---------------------------------------------------------------------
// 工具栏
// ---------------------------------------------------------------------

function setMode(next: InkMode): void {
  mode.value = next
  if (next !== 'draw') {
    // 切走模式时把草稿清掉，避免半截笔画停在屏幕上
    draft.value = []
  }
  cancelPendingFrame()
}

function chooseTone(tone: ToneName): void {
  color.value = tone
  // 选颜色隐含"要画"：顺手进入画笔模式，少一次点击
  mode.value = 'draw'
}

let clearTimer = 0

function onClearClick(): void {
  if (!confirmingClear.value) {
    if (strokes.value.length === 0) return
    confirmingClear.value = true
    if (clearTimer) clearTimeout(clearTimer)
    clearTimer = window.setTimeout(() => {
      confirmingClear.value = false
      clearTimer = 0
    }, CLEAR_CONFIRM_MS)
    return
  }
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = 0
  }
  confirmingClear.value = false
  strokes.value = []
  draft.value = []
  saveImmediately()
}

// ---------------------------------------------------------------------
// resize / 生命周期
// ---------------------------------------------------------------------

let observer: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !layerRef.value) return
  observer = new ResizeObserver((entries) => {
    const entry = entries[0]
    const rect = entry?.contentRect
    if (!rect) return
    // 坐标是归一化的，尺寸变化**不需要**换算路径；这里只更新盒子尺寸，
    // 供橡皮半径（像素 → 归一化）使用。这也正是选 SVG + 归一化坐标的收益。
    box.value = { width: rect.width, height: rect.height }
  })
  observer.observe(layerRef.value)
})

onBeforeUnmount(() => {
  cancelPendingFrame()
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = 0
  }
  // 卸载时把没写完的痕迹落盘（切换页面不该丢笔迹）
  saveImmediately()
  setHostSelecting(false)
  if (observer) {
    observer.disconnect()
    observer = null
  }
})
</script>

<style scoped lang="scss">
.ink-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  /* 浏览模式：事件穿透，正文可正常选中复制 */
  pointer-events: none;
}

.ink-svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ink-layer--draw .ink-svg {
  pointer-events: auto;
  /* 关键：没有它，手机上画线会带着页面一起滚 */
  touch-action: none;
  cursor: crosshair;
}

.ink-path {
  /* 描边色由 :stroke 内联给出（语义色 var(--x-color)） */
  opacity: 0.9;
}

.ink-path--draft {
  opacity: 0.55;
}

/* ===== 工具栏：坐在正文顶部预留的那一条里，右对齐 ===== */
.ink-toolbar {
  position: absolute;
  top: 2px;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 4px;
  background: var(--card-bg);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-xs);
  pointer-events: auto;
}

.ink-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 24px;
  padding: 0 8px;
  font-family: inherit;
  font-size: var(--font-xs);
  line-height: 1;
  color: var(--text-sub);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-full);
  cursor: pointer;
}

.ink-btn:hover:not(:disabled) {
  background: var(--primary-soft);
}

.ink-btn:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}

.ink-btn[aria-pressed='true'] {
  color: var(--primary-text);
  background: var(--primary-soft);
  border-color: var(--primary-color);
}

.ink-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ink-btn--clear {
  /* 危险动作用 danger 文字的克制版：只在 hover 时提示，平时保持中性 */
  color: var(--text-sub);
}

.ink-btn--clear:hover:not(:disabled) {
  color: var(--danger-text);
  background: var(--danger-soft);
  border-color: var(--danger-color);
}

.ink-swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  background: var(--ink-swatch-color, var(--border-color));
  border: 1px solid var(--border-color);
  border-radius: 50%;
  cursor: pointer;
}

.ink-swatch:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}

.ink-swatch[aria-pressed='true'] {
  box-shadow:
    0 0 0 2px var(--card-bg),
    0 0 0 3px var(--primary-color);
}

.ink-sep {
  width: 1px;
  height: 14px;
  background: var(--border-color);
}

/* 视觉隐藏但可被屏幕阅读器播报 */
.ink-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  clip-path: inset(50%);
}
</style>
