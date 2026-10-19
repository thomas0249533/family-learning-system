<template>
  <div class="qtext" v-html="html"></div>
</template>

<script setup lang="ts">
// =====================================================================
// QuestionText · 题干渲染（最小 Markdown 子集：换行 + GFM 表格）
// ---------------------------------------------------------------------
// 解析逻辑全在纯函数 `@core/quiz/questionText` 里（node 单测覆盖），
// 这里只负责：
//   1. 把渲染结果塞进 v-html（内容已 HTML 转义，`<img onerror>` 只会是文字）；
//   2. 给表格一组只消费 token 的样式 —— 窄屏靠外层 div 横向滚动，
//      页面本身不出现横向滚动条。
//
// 用组件而不是在四个页面各写一份 v-html + 样式，是因为表格样式（边框 / 表头底色 /
// 滚动容器）如果漏一处，那一处的表格就会撑破卡片 —— 而这种漏很难被发现。
// =====================================================================
import { computed } from 'vue'
import { renderQuestionText } from '@core/quiz/questionText'

const props = defineProps<{ text: string | null | undefined }>()

const html = computed(() => renderQuestionText(props.text ?? ''))
</script>

<style scoped lang="scss">
.qtext {
  /* 换行已经由 <br> 承担，这里**不能再加 pre-wrap**，否则会出现双倍行距 */
  word-break: break-word;

  :deep(.q-table-wrap) {
    max-width: 100%;
    overflow-x: auto;
    margin: $space-2 0;
    -webkit-overflow-scrolling: touch;
  }

  :deep(.q-table) {
    border-collapse: collapse;
    /* 宽屏铺满、窄屏按内容撑开（再由外层滚动），两者都不撑破卡片 */
    min-width: 100%;
    font-size: $font-2xs;
    font-weight: 400;
    line-height: 1.5;
  }

  :deep(.q-table th),
  :deep(.q-table td) {
    border: 1px solid $border-color;
    padding: $space-1 $space-2;
    text-align: left;
    white-space: nowrap;
    color: $text-main;
  }

  :deep(.q-table th) {
    background: $bg-color-hover;
    font-weight: 800;
  }
}
</style>
