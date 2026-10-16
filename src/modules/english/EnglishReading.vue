<template>
  <AppCard class="english-reading-card">
    <template v-for="(kp, i) in kps" :key="i">
      <h3 class="reading-title">📖 {{ kp.title }}</h3>

      <div class="reading-meta" v-if="kp.metadata?.wordCount">
        {{ kp.metadata.wordCount }} words
      </div>

      <div class="reading-body">{{ kp.content }}</div>

      <div v-if="kp.metadata?.translation" class="reading-translation">
        <div class="trans-label">📝 译文</div>
        <div class="trans-text">{{ kp.metadata.translation }}</div>
      </div>
    </template>
    <EmptyState v-if="kps.length === 0" description="暂无阅读内容" />
  </AppCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.english-reading-card { margin-bottom: 12px; }
.reading-title { font-size: 16px; font-weight: 700; color: $subject-english; margin-bottom: 4px; font-family: 'Times New Roman', serif; }
.reading-meta { font-size: 12px; color: $subject-english-light; margin-bottom: 12px; }
.reading-body {
  font-size: 15px;
  line-height: 1.9;
  color: $text-main;
  font-family: 'Times New Roman', serif;
  white-space: pre-wrap;
  padding: 12px 14px;
  background: $surface-2;
  border-radius: 8px;
  margin-bottom: 12px;
}
.reading-translation {
  background: $surface-2;
  padding: 10px 12px;
  border-radius: 6px;

  .trans-label { font-size: 12px; color: $subject-chinese; font-weight: 700; margin-bottom: 4px; }
  .trans-text { font-size: 13px; color: $text-main; line-height: 1.7; white-space: pre-wrap; }
}
</style>