<template>
  <div class="dictation-page">
    <div class="dictation-bar">
      <button class="back-btn" type="button" @click="goBack">‹ 返回</button>
      <div class="dictation-title">{{ title }}</div>
      <div class="dictation-meta">{{ words.length }} 词</div>
    </div>

    <div v-if="loading" class="dictation-loading">正在准备听写词表…</div>

    <VocabDrill
      v-else-if="words.length > 0"
      :words="words"
      :package-id="packageId"
      :lang="lang"
      :initial-count="words.length"
      @finished="onFinished"
      @close="onClose"
    />

    <div v-else class="dictation-loading">没有可听写的词语，请返回今日任务。</div>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// 每日词语背记任务（方案 B · 接入每日任务队列）
// ---------------------------------------------------------------------
// 今日任务里点「背记」项 → 跳到这里。它把这批词交给 VocabDrill 的**入口屏**，
// 由孩子自己选背记方式（翻面/听音/选择/纸笔听写/拼字块/输入/听写）——
// 不再像 3.1.8 之前那样硬锁「键入听写」。默认预置整批词数，孩子可自行减少。
//
// 完成记账的时机：VocabDrill 一轮做完（单题模式到 done / 连续模式到 review）都会
// emit `finished` —— 这里据此把今日队列项标完成（写实际词数与真实耗时）但**不跳转**，
// 让孩子先看对错。之后点「返回词汇表 / ✕」才回今日页结算。
//
// 中途退出（✕ 放弃）不记账：要"做完一轮"才算数，半途而废不该点亮。
// =====================================================================
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePackageStore } from '@core/stores/package'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import { completePlanItem } from '@core/plan/dailyPlanService'
import VocabDrill from '@modules/core/VocabDrill.vue'

const route = useRoute()
const router = useRouter()
const packageStore = usePackageStore()

const packageId = computed(() => String(route.query.packageId ?? ''))
const itemId = computed(() => String(route.query.item ?? ''))
const kpIds = computed(() =>
  String(route.query.kp ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)
const loading = ref(true)

const words = useKnowledgePoints(kpIds)

const lang = computed<'chinese' | 'english'>(() => {
  const pkg = packageStore.packages.find((p) => p.packageId === packageId.value)
  const subject = (pkg?.manifest as any)?.subject
  return subject === 'english' ? 'english' : 'chinese'
})

const title = computed(() => (lang.value === 'english' ? '单词背记' : '词语背记'))

/** 完整一轮批改后只记账一次（idempotent 兜底） */
let marked = false
async function ensureMarked(total: number, elapsedSeconds: number): Promise<void> {
  if (marked || !itemId.value) return
  marked = true
  const minutes = Math.max(1, Math.round((elapsedSeconds || 0) / 60))
  try {
    await completePlanItem(itemId.value, { questions: total, minutes })
  } catch (err) {
    // 记账失败不能让结果丢失：词本身的进度已经写进 progress 了
    console.warn('[DictationSession] 今日任务记账失败（忽略）', err)
  }
}

function onFinished(payload: { correctCount: number; total: number; elapsedSeconds: number }): void {
  void ensureMarked(payload.total, payload.elapsedSeconds)
}

function goBack(): void {
  void router.push('/today')
}

/** VocabDrill 的「返回词汇表 / ✕」：已完成则已记账，直接回今日页 */
function onClose(): void {
  void router.push('/today')
}

onMounted(async () => {
  try {
    await packageStore.loadPackages()
    if (packageId.value) await packageStore.loadPackageById(packageId.value)
  } catch (err) {
    console.warn('[DictationSession] 加载词表失败（忽略）', err)
  }
  loading.value = false
})
</script>

<style scoped lang="scss">
.dictation-page {
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dictation-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0 12px;
  border-bottom: 1px solid $border-color;

  .back-btn {
    border: 1px solid $border-color;
    background: $card-bg;
    color: $text-sub;
    font-size: 14px;
    font-weight: 700;
    padding: 6px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: $primary-color;
      color: $primary-text;
      background: $primary-light;
    }
  }

  .dictation-title {
    flex: 1;
    font-size: 17px;
    font-weight: 800;
    color: $text-main;
  }

  .dictation-meta {
    font-size: 12px;
    font-weight: 700;
    color: $text-muted;
  }
}

.dictation-loading {
  padding: 40px 16px;
  text-align: center;
  color: $text-sub;
  font-size: 14px;
}
</style>
