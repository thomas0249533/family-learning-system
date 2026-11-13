<template>
  <AppCard class="english-sentence-card">
    <template v-for="(kp, i) in kps" :key="i">
      <div class="pattern-block" v-if="kp.metadata?.pattern">
        <div class="pattern-label"><IconBase name="ruler" size="1em" /> 句型</div>
        <div class="pattern-text">{{ kp.metadata.pattern }}</div>
      </div>

      <div class="example-block">
        <div class="example-en">{{ kp.content }}</div>
        <div class="example-cn" v-if="kp.metadata?.translation">{{ kp.metadata.translation }}</div>
      </div>

      <div class="usage-block" v-if="kp.metadata?.usage">
        <div class="usage-label"><IconBase name="bulb" size="1em" /> 用法</div>
        <div class="usage-text">{{ kp.metadata.usage }}</div>
      </div>
    </template>
    <EmptyState v-if="kps.length === 0" description="暂无句型内容" />
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
.english-sentence-card { margin-bottom: 12px; }

.pattern-block {
  background: $info-light;
  padding: 12px 14px;
  border-radius: 8px;
  margin-bottom: 14px;

  .pattern-label { font-size: var(--font-xs); color: $subject-english-light; font-weight: 700; margin-bottom: 4px; }
  .pattern-text {
    font-size: var(--font-lg);
    font-weight: 700;
    color: $subject-english;
    font-family: 'Times New Roman', serif;
  }
}

.example-block {
  margin-bottom: 14px;

  .example-en {
    font-size: var(--font-lg);
    font-family: 'Times New Roman', serif;
    color: $text-main;
    line-height: 1.6;
    margin-bottom: 4px;
  }
  .example-cn {
    font-size: var(--font-sm);
    color: $text-sub;
  }
}

.usage-block {
  background: $surface-2;
  padding: 10px 12px;
  border-radius: 6px;

  .usage-label { font-size: var(--font-xs); color: $subject-chinese; font-weight: 700; margin-bottom: 4px; }
  .usage-text { font-size: var(--font-sm); color: $text-main; line-height: 1.7; }
}
</style>