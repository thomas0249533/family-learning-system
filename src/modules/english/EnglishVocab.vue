<template>
  <AppCard class="english-vocab-card">
    <div class="card-header">
      <span class="header-title">📖 词汇</span>
      <AppButton v-if="!drilling && kps.length > 0" size="small" type="primary" @click="drilling = true">
        🎴 开始背记
      </AppButton>
    </div>

    <VocabDrill
      v-if="drilling"
      :words="kps"
      :package-id="packageId"
      lang="english"
      @close="drilling = false"
    />

    <div v-else-if="kps.length > 0" class="vocab-list">
      <div v-for="(kp, i) in kps" :key="i" class="vocab-item">
        <div class="vocab-head">
          <span class="word">{{ kp.metadata?.word ?? kp.title }}</span>
          <button
            class="speak-btn"
            :class="{ speaking: speakingId === kp.id }"
            @click="toggleSpeak(kp)"
            :title="speakingId === kp.id ? '停止朗读' : '朗读单词'"
          >
            {{ speakingId === kp.id ? '⏸' : '🔊' }}
          </button>
          <span class="phonetic" v-if="kp.metadata?.phonetic">{{ kp.metadata.phonetic }}</span>
          <span class="pos" v-if="kp.metadata?.partOfSpeech">{{ kp.metadata.partOfSpeech }}</span>
        </div>
        <div class="meaning" v-if="kp.content">{{ kp.content }}</div>
        <div v-if="kp.metadata?.example" class="example">
          <div class="example-en">
            📝 {{ kp.metadata.example }}
            <button class="speak-btn tiny" @click="speakText(kp.metadata.example, 'en-US')">
              🔊
            </button>
          </div>
          <div class="example-cn" v-if="kp.metadata?.exampleCn">{{ kp.metadata.exampleCn }}</div>
        </div>
      </div>
    </div>

    <EmptyState v-else description="暂无词汇内容" />
  </AppCard>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import { speak, stop, isSpeechAvailable } from '@core/audio/speechService'
import VocabDrill from '@modules/core/VocabDrill.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))
const drilling = ref(false)
const speakingId = ref<string | null>(null)

function toggleSpeak(kp: any) {
  if (!isSpeechAvailable()) return
  const word = kp.metadata?.word ?? kp.title
  if (speakingId.value === kp.id) {
    stop()
    speakingId.value = null
    return
  }
  speakingId.value = kp.id
  speak({
    text: word,
    lang: 'en-US',
    rate: 0.85,
    onEnd: () => { speakingId.value = null },
    onError: () => { speakingId.value = null },
  })
}

function speakText(text: string, lang = 'en-US') {
  if (!isSpeechAvailable()) return
  stop()
  speak({ text, lang, rate: 0.9 })
}

onUnmounted(() => { stop() })
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.english-vocab-card { margin-bottom: 12px; }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px dashed $border-light;

  .header-title {
    font-size: 15px;
    font-weight: 800;
    color: $text-main;
  }
}

.vocab-list { display: flex; flex-direction: column; gap: 12px; }

.vocab-item {
  background: $bg-color-hover;
  border-left: 4px solid $subject-english-light;
  border-radius: 6px;
  padding: 12px 14px;

  .vocab-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
    flex-wrap: wrap;

    .word {
      font-size: 20px;
      font-weight: 700;
      color: $subject-english;
      font-family: 'Times New Roman', serif;
    }
    .phonetic {
      font-size: 13px;
      color: $subject-english-light;
      font-family: 'Times New Roman', serif;
    }
    .pos {
      font-size: 11px;
      background: $subject-english-soft;
      color: $subject-english;
      padding: 1px 6px;
      border-radius: 4px;
      font-style: italic;
    }
  }

  .meaning {
    font-size: 14px;
    line-height: 1.7;
    color: $text-main;
    margin-bottom: 8px;
  }

  .example {
    background: $card-bg;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px dashed $border-light;

    .example-en {
      display: flex;
      align-items: center;
      font-size: 13px;
      color: $subject-english;
      font-family: 'Times New Roman', serif;
      margin-bottom: 2px;
    }
    .example-cn {
      font-size: 12px;
      color: $text-sub;
    }
  }
}

.speak-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid $border-color;
  background: $card-bg;
  cursor: pointer;
  font-size: 13px;
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
    color: $on-strong;
    animation: pulse-speaking 1.2s infinite;
  }
  &.tiny {
    width: 22px;
    height: 22px;
    font-size: 11px;
    margin-left: 6px;
  }
}

@keyframes pulse-speaking {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(var(--primary-rgb), 0); }
}
</style>