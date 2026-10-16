<template>
  <n-card class="english-writing-card">
    <template v-for="(kp, i) in kps" :key="i">
      <h3 class="writing-title">✍️ {{ kp.title }}</h3>
      <div class="writing-body" v-html="renderMarkdown(kp.content)"></div>
    </template>
    <n-empty v-if="kps.length === 0" description="暂无写作内容" />
  </n-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NEmpty } from 'naive-ui'
import MarkdownIt from 'markdown-it'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
function renderMarkdown(s: string) { return md.render(s ?? '') }
</script>

<style scoped lang="scss">
.english-writing-card { border-radius: $radius-lg; box-shadow: $shadow-sm; margin-bottom: 12px; }
.writing-title { font-size: 16px; font-weight: 700; color: $subject-english; margin-bottom: 12px; }
.writing-body {
  font-size: 14px;
  line-height: 1.9;
  color: $text-main;

  :deep(p) { margin: 6px 0; }
  :deep(strong) { color: $subject-english; }
  :deep(ul), :deep(ol) { padding-left: 24px; }
  :deep(code) { background: $bg-color-hover; padding: 1px 6px; border-radius: 4px; color: $code-color; }
}
</style>