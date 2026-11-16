<template>
  <div class="hw-pad">
    <div class="hw-pad__prompt">
      <span class="hw-pad__label">看拼音写词语</span>
      <span class="hw-pad__pinyin">{{ pinyin || '（无拼音提示）' }}</span>
      <span class="hw-pad__count">共 {{ count }} 个字</span>
    </div>

    <div class="hw-pad__cells">
      <InkCell
        v-for="(cellPinyin, i) in pinyins"
        :key="i"
        :ref="(el) => setCellRef(el, i)"
        :index="i"
        :total="count"
        :pinyin="cellPinyin"
        :size="cellSize"
        :active="activeIndex === i"
        :disabled="disabled"
        @change="(n) => onCellChange(n, i)"
        @activate="activeIndex = i"
      />
    </div>

    <div class="hw-pad__tools">
      <AppButton size="small" :disabled="disabled || !hasInkOnActive" @click="undoActive">
        <IconBase name="undo" size="1em" /> 撤销本格
      </AppButton>
      <AppButton size="small" :disabled="disabled || !hasInkOnActive" @click="clearActive">
        <IconBase name="refresh" size="1em" /> 清空本格
      </AppButton>
      <span class="hw-pad__hint">在书写板上写，笔迹会显示在上面</span>
    </div>

    <AppButton
      type="primary"
      size="large"
      block
      :disabled="disabled || !hasInk"
      @click="onSubmit"
    >
      <IconBase name="pen" size="1em" /> {{ submitText }}
    </AppButton>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// HandwritingPad · 手写板作答区（N 个单字格 + 工具条 + 提交）
// ---------------------------------------------------------------------
// ## 组件边界：只产笔迹，不写库
// 这里 `emit('submit', cells)` 之后什么都不做 —— 落库、判定、结算都是父层
// （VocabDrill / 以后的 QuizEngine）的事。原因很实际：同一块板会被
// "背记听写""同步练习""家长批改回放"三处复用，把 store 调用焊进来就复用不了。
//
// ## 为什么笔迹只在提交时序列化
// `pointermove` 每帧都可能触发，逐帧 `JSON.stringify` 会把主线程拖住（手写最怕掉帧）。
// 所以 `change` 事件只传**笔数**，父层据此判断"写了没有"；真正的
// `serializeStrokes()` 只在点提交时每人格一次。
//
// ## 格子尺寸为什么按字数硬编码
// 手写板的板面只有 4×3 英寸，映射到整屏后"格子越小越写不进去"。
// 1 个字给 220px、4 个字给 132px 是把手掌/手腕的定位误差算进去后的经验值。
// 靠 flex-wrap，窄屏会自动换行，不需要 ResizeObserver 去量。
// =====================================================================
import { computed, ref, watch } from 'vue'
import InkCell from './InkCell.vue'
import AppButton from './ui/AppButton.vue'
import IconBase from './ui/IconBase.vue'
import { cellCountOf, cellPinyinOf, isEmptyCells } from '@core/handwriting/pad'

const props = withDefaults(defineProps<{
  /** 正确答案：只用来算格数，**不会显示给孩子**（显示答案等于把题做完了） */
  answer: string
  /** 整词的拼音（如「qí guān」），按空格均分到各格 */
  pinyin?: string
  /** 父层正在提交（锁住按钮，防连点产生两行记录） */
  disabled?: boolean
  submitText?: string
}>(), {
  pinyin: '',
  disabled: false,
  submitText: '提交手写',
})

const emit = defineEmits<{
  /** 提交：`cells[i]` 是第 i 格的序列化笔迹（空态 `'[]'`） */
  (e: 'submit', cells: string[]): void
  /** 只传"有没有墨"，父层不该在这里做序列化 */
  (e: 'change', hasInk: boolean): void
}>()

const cells = ref<Array<InstanceType<typeof InkCell> | null>>([])
const strokeCounts = ref<number[]>([])
const activeIndex = ref(0)

const count = computed(() => cellCountOf(props.answer))
const pinyins = computed(() => cellPinyinOf(props.pinyin, count.value))

/** 一次只写一格时给大格；4 个字挤一行时缩到 132px —— 再小就写不进格子 */
const cellSize = computed(() => {
  switch (count.value) {
    case 1: return 220
    case 2: return 176
    case 3: return 148
    case 4: return 132
    default: return 116
  }
})

const hasInk = computed(() => strokeCounts.value.some((n) => n > 0))
const hasInkOnActive = computed(() => (strokeCounts.value[activeIndex.value] ?? 0) > 0)

function setCellRef(el: unknown, i: number): void {
  cells.value[i] = (el as InstanceType<typeof InkCell> | null) ?? null
}

function onCellChange(strokes: number, i: number): void {
  const next = [...strokeCounts.value]
  next[i] = strokes
  strokeCounts.value = next
  emit('change', hasInk.value)
}

function undoActive(): void {
  cells.value[activeIndex.value]?.undo()
}

function clearActive(): void {
  cells.value[activeIndex.value]?.clear()
}

function serializeAll(): string[] {
  const out: string[] = []
  for (let i = 0; i < count.value; i++) {
    out.push(cells.value[i]?.serialize() ?? '[]')
  }
  return out
}

function onSubmit(): void {
  if (props.disabled) return
  const all = serializeAll()
  // 空板不提交（按钮已 disabled，这里是防"程序化触发"的第二道）
  if (isEmptyCells(all)) return
  emit('submit', all)
}

/** 换词后清空：v-for 复用同一个组件实例，不重置会把上一个词的笔迹带到新格子 */
function reset(): void {
  cells.value.forEach((c) => c?.clear())
  strokeCounts.value = []
  activeIndex.value = 0
}

watch(
  () => props.answer,
  () => reset()
)

defineExpose({ serializeAll, reset })
</script>

<style scoped lang="scss">
.hw-pad {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: stretch;

  &__prompt {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: $primary-light;
    border-radius: $radius-sm;
  }

  &__label {
    font-size: var(--font-2xs);
    font-weight: 700;
    color: $primary-text;
  }

  &__pinyin {
    font-size: var(--font-lg);
    font-weight: 800;
    color: $text-main;
    letter-spacing: 0.5px;
  }

  &__count {
    font-size: var(--font-2xs);
    color: $text-sub;
  }

  &__cells {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }

  &__tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  &__hint {
    font-size: var(--font-2xs);
    color: $text-muted;
  }
}
</style>
