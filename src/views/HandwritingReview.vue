<template>
  <div class="hw-review-page">
    <PageHeader
      icon="pen"
      title="手写批改"
      subtitle="孩子在书写板上写的作业都在这里，逐份看一眼就能判定"
    />

    <div v-if="loading" class="hw-skeleton" aria-busy="true">
      <Skeleton v-for="n in 3" :key="n" variant="rect" height="150px" :label="n === 1 ? '正在加载待批改' : undefined" />
    </div>

    <template v-else>
      <n-alert v-if="error" type="error" class="hw-alert">
        {{ error }}
        <AppButton size="small" class="hw-alert__retry" @click="load">
          <IconBase name="refresh" size="1em" /> 重试
        </AppButton>
      </n-alert>

      <AppCard v-if="pending.length === 0" paddingless class="hw-empty">
        <EmptyState
          icon="pen"
          description="还没有待批改的手写作业。孩子在背记里选「手写板」写完提交，就会排到这里。"
        />
      </AppCard>

      <template v-else>
        <div class="hw-summary">
          <span class="hw-summary__count">待批改 <b>{{ pending.length }}</b> 份</span>
          <span v-if="gradedCount > 0" class="hw-summary__done">本次已批 {{ gradedCount }} 份</span>
        </div>

        <AppCard
          v-for="row in pending"
          :key="row.id"
          class="hw-item"
          :title="row.prompt"
        >
          <div class="hw-item__body">
            <InkStrokes :cells="row.cells" class="hw-item__ink" />
            <div class="hw-item__answer">
              <div class="hw-item__label">正确答案</div>
              <div class="hw-item__text">{{ row.correctAnswer }}</div>
              <div class="hw-item__meta">
                共 {{ actualCells(row) }} 格<template v-if="restatedCells(row)">（题面 {{ row.cellCount }} 格）</template> · 写于 {{ formatTime(row.createdAt) }}
              </div>
            </div>
          </div>

          <!--
            全空笔迹必须显式说出来。
            「有笔即得」：孩子什么都没写就点提交也会落一行 pending（`cells` 全 `'[]'`）。
            此时卡片就是一片空白 —— 家长无法分辨"孩子没写"和"笔迹没存上 / 渲染坏了"，
            而这两件事的处置完全相反：前者判错并提醒孩子，后者要报 bug 重试。
          -->
          <div v-if="isEmptyCells(row.cells)" class="hw-item__blank">
            <IconBase name="warning" size="1em" />
            <span>这份一个字都没写。孩子可能跳过了这题，可以问问他。</span>
          </div>

          <div class="hw-item__actions">
            <!-- 全空时只能判错：判「写对了」会把"没写"记成掌握，掌握度与错题本一起被污染 -->
            <AppButton
              type="success"
              size="large"
              :disabled="gradingId === row.id || isEmptyCells(row.cells)"
              @click="grade(row, 'correct')"
            >
              <template #icon><IconBase name="check-circle" size="1em" /></template>
              写对了
            </AppButton>
            <AppButton
              type="error"
              size="large"
              :disabled="gradingId === row.id"
              @click="grade(row, 'wrong')"
            >
              <template #icon><IconBase name="x-circle" size="1em" /></template>
              写错了
            </AppButton>
          </div>
        </AppCard>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// HandwritingReview · 家长批改页
// ---------------------------------------------------------------------
// ## 数据来源只有一个
// `listPendingHandwriting()`（`@core/stores/handwriting`）—— 页面不直接摸 db，
// 也不自己算"哪些算待批改"。批改调 `gradeHandwriting(id, verdict)`，它内部
// 负责把结论回流到 `progress` / `mistakes`（掌握度、错题本、FSRS 都在那一步生效）。
//
// ## 为什么批完就从列表里删，而不是重新拉一遍
// 重新拉会有一瞬间的"卡片还在原地但状态已变"（家长手快会点第二遍）。
// 本地删 + 顶部计数自增是即时反馈；下次进页面自然是权威数据。
//
// ## 五态
// 加载（骨架）/ 正常 / 空（EmptyState）/ 错误（n-alert + 重试）/ 无待批改时
// 也走空态 —— 本项目没有角色系统（`/parent` 同款约定），所以不存在"无权限"态。
//
// ## 不做的事
// · 不做"半对"：team-lead 的裁决是**小学默写按整词判分**（"奇观"写成"奇现"，
//   老师整词判错），系统加半对会比老师更宽松、反而误导家长判断掌握度。
//   store 里保留 `partial` 是给将来"整段句子 / 作文"批改留的，UI 未暴露。
// · 不做批量全对：家长逐份看一眼才是这一步的价值，一键全对等于没批。
//
// ## 「一个字都没写」要显式说出来
// 「有笔即得」意味着孩子什么都没写也会落一行 `pending`（`cells` 全 `'[]'`）。
// 若只是渲染成一片空白，家长分不清"孩子没写"和"笔迹没存上 / 渲染坏了" ——
// 前者该判错并提醒孩子，后者该报 bug 重试，处置完全相反。
// 所以命中全空时给一条显式提示，并把「写对了」禁用（判"没写"为掌握会污染统计）。
// 判定用 `isEmptyCells()`（内部走 `deserializeStrokes().length === 0`），
// **不做字符串比较** —— 序列化实现改一次，`=== '[]'` 那种写法就错了。
// =====================================================================
import { computed, onMounted, ref } from 'vue'
import { NAlert, useMessage } from 'naive-ui'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import IconBase from '@/components/ui/IconBase.vue'
import InkStrokes from '@/components/InkStrokes.vue'
import { isEmptyCells } from '@core/handwriting/pad'
import { gradeHandwriting, listPendingHandwriting } from '@core/stores/handwriting'
import type { HandwritingRecord } from '@/db'

// `useMessage` 必须在 setup 顶层调用：全局有 `<n-message-provider>`（App.vue），
// 这里只拿句柄。四种 outcome 里只有 replaced / ignored 会弹轻提示，
// already 静默、graded 走顶部计数，不让家长被连续 toast 淹没。
const message = useMessage()

const pending = ref<HandwritingRecord[]>([])
const loading = ref(true)
const error = ref('')
const gradedCount = ref(0)
const gradingId = ref<number | null>(null)

const total = computed(() => pending.value.length + gradedCount.value)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    pending.value = await listPendingHandwriting()
  } catch (e) {
    console.warn('[手写批改] 读取待批改失败', e)
    error.value = '读取待批改列表失败，可能是数据库一时不可用。'
  } finally {
    loading.value = false
  }
}

/**
 * 卡片按**实际提交的格数**渲染（`cells.length`），绝不按 `cellCount` 补空格。
 *
 * `cellCount` 是"这题应该有几格"，`cells` 是"孩子实际交了几格"。两者不一致时
 * 用 `cellCount` 补出来的空格会显示成"孩子漏写了这几格" —— 那是渲染系统在造谣，
 * 而真实情况可能是保存被截断（这才是要报的 bug）。
 */
function actualCells(row: HandwritingRecord): number {
  if (Array.isArray(row.cells)) return row.cells.length
  return typeof row.cellCount === 'number' && Number.isFinite(row.cellCount) ? row.cellCount : 0
}

/** 题面格数与实际格数不一致时返回题面那个数字（给一行说明，仍然不补格）；一致时返回 0 */
function restatedCells(row: HandwritingRecord): number {
  const n = typeof row.cellCount === 'number' && Number.isFinite(row.cellCount) ? row.cellCount : 0
  return n > 0 && n !== actualCells(row) ? n : 0
}

async function grade(row: HandwritingRecord, verdict: 'correct' | 'wrong'): Promise<void> {
  if (row.id === undefined || gradingId.value !== null) return
  gradingId.value = row.id
  // 每次点击先清上一条提示。`error` 原来只在 `load()` 里清过，于是
  // 「第 1 份失败 → 红条出现 → 第 2 份成功」之后屏幕上仍挂着
  // "这一份没批成功，请再点一次"，家长会去找那份根本不存在的作业。
  error.value = ''
  try {
    const outcome = await gradeHandwriting(row.id, verdict)

    // 四种结局都把这张卡从列表里移除：它已经不再是"待批改"了 ——
    // 真批了 / 被孩子的新作答顶掉 / 本来就批过 / 已被清理。
    // 留在列表里会让家长对着一份永远批不动的作业反复点。
    pending.value = pending.value.filter((r) => r.id !== row.id)

    if (outcome === 'graded') {
      // `gradedCount` 是「本次已批 N 份」的分子，**只有真的写库才算**。
      // 其余三种都没写库，计进去就是虚报。
      gradedCount.value++
      return
    }
    if (outcome === 'replaced') {
      // 孩子在这位家长打开批改页之后又重写了一遍，旧笔迹被 K=2 淘汰
      message.warning('这一份被孩子的新作答顶掉了，刷新后批最新那份')
    } else if (outcome === 'ignored') {
      message.info('这一份已经不在待批改里了（可能已被清理），未记入统计')
    }
    // `already` 刻意不提示：重复点击不该被骂，静默移除即可
  } catch (e) {
    console.warn('[手写批改] 批改失败', e)
    // 抛错 = 回流失败，store 已把这一行 `revertToPending` 退回待批改。
    // **绝不能移除卡片**：移除等于告诉家长"批完了"，而统计没记上、
    // 这份还得再批一次。同理不做任何自动重试 —— 回流是逐 kp 串行、
    // 非原子的，回滚只回滚 status 不回滚统计，自动重试会把已成功的
    // 那几个 kp 再计一遍。重试必须由家长手动、一份一份点。
    error.value = '这一份没批成功，请再点一次（笔迹没有丢）。'
  } finally {
    gradingId.value = null
  }
}

/** `2026-11-16T03:20:00.000Z` → `11-16 03:20`（本地时区；批改时家长看的是"哪天写的"） */
function formatTime(iso: string | undefined): string {
  if (!iso) return '——'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '——'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(load)

defineExpose({ total })
</script>

<style scoped lang="scss">
.hw-review-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-8);
}

.hw-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hw-alert {
  display: flex;
  align-items: center;
  gap: var(--space-3);

  &__retry {
    margin-left: var(--space-2);
  }
}

.hw-empty {
  padding: 60px 20px;
}

.hw-summary {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--font-sm);
  color: $text-sub;

  &__count b {
    font-size: var(--font-xl);
    color: $primary-text;
    margin: 0 2px;
  }

  &__done {
    font-size: var(--font-xs);
    color: $text-muted;
  }
}

.hw-item {
  &__body {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
    flex-wrap: wrap;
  }

  &__ink {
    flex-shrink: 0;
  }

  &__answer {
    flex: 1;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__label {
    font-size: var(--font-2xs);
    color: $text-muted;
  }

  &__text {
    font-size: var(--font-4xl);
    font-weight: 700;
    color: $text-main;
    letter-spacing: 2px;
  }

  &__meta {
    font-size: var(--font-2xs);
    color: $text-muted;
  }

  /*
   * 「一个字都没写」提示条。
   * 用橙色而不是红色：红色在这个页面已经被"写错了"按钮占用，而这条不是判决，
   * 是**给家长的观察线索**（孩子可能跳过了这题）。
   */
  &__blank {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: 10px;
    background: var(--badge-warning-bg);
    color: $warning-text;
    font-size: var(--font-sm);
    line-height: $leading-normal;
  }

  &__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-3);

    @media (max-width: 480px) {
      flex-direction: column;
    }
  }
}
</style>
