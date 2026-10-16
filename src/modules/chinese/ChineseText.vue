<template>
  <n-card class="chinese-text-card">
    <template v-for="(kp, i) in kps" :key="i">
      <h3 class="text-title">{{ kp.title }}</h3>
      <div class="text-meta" v-if="kp.metadata?.author || kp.metadata?.source">
        <span v-if="kp.metadata?.author">{{ kp.metadata.author }}</span>
        <span v-if="kp.metadata?.source"> · {{ kp.metadata.source }}</span>
      </div>
      <div class="text-body" v-html="renderMarkdown(kp.content)"></div>
    </template>
    <n-empty v-if="kps.length === 0" description="暂无课文内容" />
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
.chinese-text-card { border-radius: $radius-lg; box-shadow: $shadow-sm; margin-bottom: 12px; }
.text-title { font-size: 18px; font-weight: 700; color: $subject-chinese-deep; margin-bottom: 4px; }
.text-meta { font-size: 12px; color: $subject-chinese; margin-bottom: 14px; }
.text-body {
  font-size: 15px;
  line-height: 1.9;
  color: $text-main;

  :deep(p) { margin: 8px 0; text-indent: 2em; }
  :deep(h1), :deep(h2), :deep(h3) { color: $subject-chinese-deep; margin: 12px 0 6px; }
  :deep(ul), :deep(ol) { padding-left: 24px; }
}
</style>