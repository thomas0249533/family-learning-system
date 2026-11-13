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
            :aria-label="speakingId === kp.id ? '停止朗读' : '朗读全文'"
            :title="speakingId === kp.id ? '停止朗读' : '朗读全文'"
          >
            <IconBase :name="speakingId === kp.id ? 'pause' : 'volume'" size="1em" />
          </button>
        </div>
        <div class="poem-author" v-if="kp.metadata?.dynasty || kp.metadata?.author">
          {{ kp.metadata?.dynasty ?? '' }} · {{ kp.metadata?.author ?? '' }}
        </div>
      </div>

      <div class="poem-body">{{ kp.content }}</div>

      <div v-if="kp.metadata?.translation" class="poem-block">
        <div class="block-label">
          <IconBase name="book-open" size="1em" /> 译文
          <button
            type="button"
            class="speak-btn small"
            aria-label="朗读译文"
            @click="speakText(kp.metadata.translation)"
          >
            <IconBase name="volume" size="1em" />
          </button>
        </div>
        <div class="block-content">{{ kp.metadata.translation }}</div>
      </div>

      <div v-if="kp.metadata?.appreciation" class="poem-block">
        <div class="block-label"><IconBase name="sparkle" size="1em" /> 赏析</div>
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
  void speak({
    text: kp.content,
    lang: 'zh-CN',
    onEnd: () => { speakingId.value = null },
    onError: () => { speakingId.value = null },
  })
}

/** 朗读片段 */
function speakText(text: string) {
  if (!isSpeechAvailable()) return
  stop()
  void speak({ text, lang: 'zh-CN' })
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
  font-size: var(--font-3xl);
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
  font-size: var(--font-base);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;

  &:hover {
    background: $primary-light;
    border-color: $primary-color;
    transform: scale(1.05);
  }

  &.speaking {
    /* V4.0 · D6：朗读中的实心底原为 `-color`（图形色），喇叭图标只有 2.85:1 ——
       图标是「正在朗读」的唯一信号，必须 ≥3:1。改 `-text` → 5.12:1；
       边框保留 `-color` 作一圈高亮描边（描边是图形，不受此约束）。 */
    background: var(--primary-text);
    border-color: $primary-color;
    color: var(--text-on-primary);
    animation: pulse-speaking 1.2s var(--ease-standard) infinite; /* check-motion-allow: 朗读脉冲循环 */
  }

  &.small {
    width: 24px;
    height: 24px;
    font-size: var(--font-xs);
    margin-left: 6px;
  }
}

@keyframes pulse-speaking {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(var(--primary-rgb), 0); }
}

.poem-author {
  font-size: var(--font-sm);
  color: $text-sub;
}

.poem-body {
  font-family: KaiTi, STKaiti, '楷体', serif;
  font-size: var(--font-xl);
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
    font-size: var(--font-sm);
    font-weight: 700;
    color: $text-sub;
    margin-bottom: 6px;
  }
  .block-content {
    font-size: var(--font-base);
    line-height: 1.8;
    color: $text-main;
    white-space: pre-wrap;
  }
}
</style>