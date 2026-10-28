<template>
  <AppCard class="math-concept-card" title="📖 概念精讲">
    <template v-for="(kp, i) in kps" :key="i">
      <h3 class="concept-title">{{ kp.title }}</h3>
      <div class="concept-body" v-html="renderMarkdown(kp.content)"></div>
    </template>
    <EmptyState v-if="kps.length === 0" description="暂无概念讲解" />
  </AppCard>
</template>

<script setup lang="ts">
// =====================================================================
// MathConcept · 数学概念讲解（V2.12 修）
// ---------------------------------------------------------------------
// ## 这个组件之前是空壳
// 上一版只有一句硬编码的「这里展示概念讲解。」，props 也没接 —— 也就是说
// **所有 `type: "concept"` 的数学知识点在页面上都只显示这行占位文字**。
// 孩子点开"概念精讲"，看到的是"这里展示概念讲解"，而真正的讲解内容在库里躺着。
//
// 同门的 `MathFormula` / `MathLife` 也还是占位（前者 hardcode 了一组乘法分配律示例），
// 本次只修 concept：图形题的方法讲解全挂在这一类上，不修就等于这个包没有讲解。
//
// ## 为什么照抄 ChineseWriting 而不是自己查 store
// `useKnowledgePoints` 已经处理了「短 id / 带包前缀 id」「跨包合并」「响应式」三件事。
// 自己 `packageStore.packages.find(...)` 一遍，等于把这三个坑重新踩一次。
// =====================================================================
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{
  type?: string
  knowledgePointIds?: string[]
  data?: any
  packageId?: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
function renderMarkdown(s: string) {
  return md.render(s ?? '')
}
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.math-concept-card { margin-bottom: 16px; }

.concept-title {
  font-size: 15px;
  font-weight: 700;
  /* 文字色必须走 -text 变体（check:text-color 门禁），不能引用 $primary-color */
  color: $primary-text;
  margin: 12px 0 6px;

  &:first-child { margin-top: 0; }
}

.concept-body {
  font-size: 14px;
  line-height: 1.9;
  color: $text-main;

  :deep(p) { margin: 6px 0; }
  :deep(strong) { color: $primary-text; }
  :deep(ul),
  :deep(ol) { padding-left: 22px; }
  :deep(li) { margin: 2px 0; }
  :deep(code) {
    background: $bg-color-hover;
    border-radius: $radius-xs;
    padding: 1px 5px;
    font-size: 13px;
  }
}
</style>
