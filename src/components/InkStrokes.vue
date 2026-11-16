<template>
  <div class="ink-strokes" role="group" :aria-label="groupLabel">
    <div v-for="(raw, i) in cells" :key="i" class="ink-strokes__cell">
      <svg
        class="ink-strokes__svg"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        role="img"
        :aria-label="cellLabel(i)"
      >
        <rect x="0" y="0" width="1" height="1" class="ink-strokes__frame" />
        <line x1="0.5" y1="0" x2="0.5" y2="1" class="ink-strokes__axis" />
        <line x1="0" y1="0.5" x2="1" y2="0.5" class="ink-strokes__axis" />
        <path
          v-for="(p, j) in pathsOf(raw)"
          :key="j"
          class="ink-strokes__path"
          :d="p.d"
          :stroke-width="p.width"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <span v-if="isBlank(raw)" class="ink-strokes__blank">没写</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// InkStrokes · 只读笔迹回放（家长批改页 / 错题回看）
// ---------------------------------------------------------------------
// ## 为什么回放用 SVG，而书写用 canvas
//   · 回放要"任意缩放都清晰"（家长会把窗口拉大看笔画）+ "可断言 DOM"（测试数 path）；
//   · 书写要"落笔即出墨"（canvas 逐段描线最短路径）。
// 两边共用**同一份数据**（`core/reading/ink.ts` 的序列化串），只是渲染器不同
// —— 这是刻意的：数据一个真相，渲染按场景选最合适的那个。
//
// ## 为什么 stroke-width 配 non-scaling-stroke
// `viewBox="0 0 1 1"` 被拉伸到格子尺寸，线宽会被一起拉伸成椭圆。
// `vector-effect="non-scaling-stroke"` 让 `stroke-width` 的单位变回**屏幕像素**，
// 于是 6 就是 6px，与书写时的观感一致。
//
// ## 墨色不跟随 InkStroke.color
// 那个色槽（primary/success/warning/danger）是给"划线辅助"的语义色留的；
// 手写作答只有一种墨色。统一走 `--text-main`，换肤自动跟随，也就不需要色值字面量。
// =====================================================================
import { computed } from 'vue'
import { deserializeStrokes, toPathD } from '@core/reading/ink'

const props = withDefaults(defineProps<{
  /** 逐格序列化串（`serializeStrokes` 的产物，空态 `'[]'`） */
  cells: string[]
  /** 第几题的第几格起（只用于读屏编号） */
  startIndex?: number
}>(), {
  startIndex: 0,
})

interface CellPath {
  d: string
  width: number
}

/** 每格解析一次；父层用 v-for 渲染，重复调用由 Vue 的渲染缓存兜住 */
function pathsOf(raw: string): CellPath[] {
  const out: CellPath[] = []
  for (const stroke of deserializeStrokes(raw)) {
    const d = toPathD(stroke.points)
    // 少于 2 个点的笔画 toPathD 返回空串（画不出线），但单点笔迹是真实存在的
    // （手指点一下），这里退化成一个极短的"点"，否则家长会以为孩子没写那个字
    if (d) out.push({ d, width: stroke.width })
    else if (stroke.points.length === 1) {
      const p = stroke.points[0]
      out.push({ d: `M${p.x} ${p.y} l0.001 0`, width: stroke.width })
    }
  }
  return out
}

function isBlank(raw: string): boolean {
  return deserializeStrokes(raw).length === 0
}

const groupLabel = computed(() => `手写笔迹，共 ${props.cells.length} 格`)

function cellLabel(i: number): string {
  const raw = props.cells[i] ?? ''
  const n = props.startIndex + i + 1
  return isBlank(raw) ? `第 ${n} 格：没写` : `第 ${n} 格：已写`
}
</script>

<style scoped lang="scss">
.ink-strokes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: flex-start;

  &__cell {
    position: relative;
    width: 96px;
    height: 96px;
    flex-shrink: 0;
  }

  &__svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  &__frame {
    fill: none;
    stroke: $border-color;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  &__axis {
    stroke: $border-color;
    stroke-width: 1;
    stroke-dasharray: 3 4;
    opacity: 0.7;
    vector-effect: non-scaling-stroke;
  }

  &__path {
    stroke: $text-main;
    vector-effect: non-scaling-stroke;
  }

  &__blank {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-2xs);
    color: $text-muted;
    pointer-events: none;
  }
}
</style>
