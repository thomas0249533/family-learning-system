<template>
  <AppCard class="chinese-poem-card">
    <template v-for="(kp, i) in kps" :key="i">
      <div class="poem-header">
        <div class="poem-title-row">
          <h3 class="poem-title">《{{ kp.title }}》</h3>
          <button
            class="speak-btn"
            :class="{ speaking: speakingId === kp.id }"
            @click="toggleSpeak(kp)"
            :title="speakingId === kp.id ? '停止朗读' : '朗读全文'"
          >
            {{ speakingId === kp.id ? '⏸' : '🔊' }}
          </button>
        </div>
        <div class="poem-author" v-if="kp.metadata?.dynasty || kp.metadata?.author">
          {{ kp.metadata?.dynasty ?? '' }} · {{ kp.metadata?.author ?? '' }}
        </div>
      </div>

      <div class="poem-body">{{ kp.content }}</div>

      <div v-if="kp.metadata?.translation" class="poem-block">
        <div class="block-label">
          📖 译文
          <button class="speak-btn small" @click="speakText(kp.metadata.translation)">
            🔊
          </button>
        </div>
        <div class="block-content">{{ kp.metadata.translation }}</div>
      </div>

      <div v-if="kp.metadata?.appreciation" class="poem-block">
        <div class="block-label">✨ 赏析</div>
        <div class="block-content">{{ kp.metadata.appreciation }}</div>
      </div>
    </template>
    <EmptyState v-if="kps.length === 0" description="暂无古诗文内容" />
  </AppCard>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import { speak, stop, isSpeechAvailable } from '@core/audio/speechService'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))

const speakingId = ref<string | null>(null)

/** 朗读整首 */
function toggleSpeak(kp: any) {
  if (!isSpeechAvailable()) return

  if (speakingId.value === kp.id) {
    stop()
    speakingId.value = null
    return
  }

  speakingId.value = kp.id
  speak({
    text: kp.content,
    lang: 'zh-CN',
    rate: 0.85,
    onEnd: () => { speakingId.value = null },
    onError: () => { speakingId.value = null },
  })
}

/** 朗读片段 */
function speakText(text: string) {
  if (!isSpeechAvailable()) return
  stop()
  speak({
    text,
    lang: 'zh-CN',
    rate: 0.9,
  })
}

onUnmounted(() => {
  stop()
})
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.chinese-poem-card { margin-bottom: 12px; }

.poem-header {
  text-align: center;
  margin-bottom: 16px;
}
.poem-title-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.poem-title {
  font-family: KaiTi, STKaiti, '楷体', serif;
  font-size: 22px;
  font-weight: 700;
  color: $text-main;
  margin: 0;
}
.speak-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid $border-color;
  background: $card-bg;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;

  &:hover {
    background: $primary-light;
    border-color: $primary-color;
    transform: scale(1.05);
  }

  &.speaking {
    background: $primary-color;
    border-color: $primary-color;
    color: var(--text-on-primary);
    animation: pulse-speaking 1.2s infinite;
  }

  &.small {
    width: 24px;
    height: 24px;
    font-size: 12px;
    margin-left: 6px;
  }
}

@keyframes pulse-speaking {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(var(--primary-rgb), 0); }
}

.poem-author {
  font-size: 13px;
  color: $text-sub;
}

.poem-body {
  font-family: KaiTi, STKaiti, '楷体', serif;
  font-size: 18px;
  line-height: 2;
  color: $text-main;
  white-space: pre-wrap;
  text-align: center;
  background: $bg-color-hover;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid $border-light;
}

.poem-block {
  margin-top: 16px;
  background: $bg-color-hover;
  padding: 12px 14px;
  border-radius: 8px;

  .block-label {
    display: flex;
    align-items: center;
    font-size: 13px;
    font-weight: 700;
    color: $text-sub;
    margin-bottom: 6px;
  }
  .block-content {
    font-size: 14px;
    line-height: 1.8;
    color: $text-main;
    white-space: pre-wrap;
  }
}
</style>