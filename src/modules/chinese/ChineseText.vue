<template>
  <AppCard class="chinese-text-card">
    <template v-for="(kp, i) in kps" :key="i">
      <h3 class="text-title">{{ kp.title }}</h3>
      <div class="text-meta" v-if="kp.metadata?.author || kp.metadata?.source">
        <span v-if="kp.metadata?.author">{{ kp.metadata.author }}</span>
        <span v-if="kp.metadata?.source"> · {{ kp.metadata.source }}</span>
      </div>
      <div class="text-body" v-html="renderMarkdown(kp.content)"></div>
    </template>
    <EmptyState v-if="kps.length === 0" description="暂无课文内容" />
  </AppCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

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
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.chinese-text-card { margin-bottom: 12px; }
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