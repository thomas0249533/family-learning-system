<template>
  <AppCard class="english-vocab-card">
    <div class="card-header">
      <span class="header-title"><IconBase name="book-open" size="1em" /> 词汇</span>
      <AppButton v-if="!drilling && kps.length > 0" size="small" type="primary" @click="drilling = true">
        <IconBase name="card" size="1em" /> 开始背记
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
            :aria-label="speakingId === kp.id ? '停止朗读' : '朗读单词'"
            :title="speakingId === kp.id ? '停止朗读' : '朗读单词'"
          >
            <IconBase :name="speakingId === kp.id ? 'pause' : 'volume'" size="1em" />
          </button>
          <span class="phonetic" v-if="kp.metadata?.phonetic">{{ kp.metadata.phonetic }}</span>
          <span class="pos" v-if="kp.metadata?.partOfSpeech">{{ kp.metadata.partOfSpeech }}</span>
        </div>
        <div class="meaning" v-if="kp.content">{{ kp.content }}</div>
        <div v-if="kp.metadata?.example" class="example">
          <div class="example-en">
            <IconBase name="pen" size="1em" /> {{ kp.metadata.example }}
            <button
              type="button"
              class="speak-btn tiny"
              aria-label="朗读例句"
              @click="speakText(kp.metadata.example, 'en-US')"
            >
              <IconBase name="volume" size="1em" />
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
  void speak({
    text: word,
    lang: 'en-US',
    onEnd: () => { speakingId.value = null },
    onError: () => { speakingId.value = null },
  })
}

function speakText(text: string, lang = 'en-US') {
  if (!isSpeechAvailable()) return
  stop()
  void speak({ text, lang })
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
    font-size: var(--font-md);
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
      font-size: var(--font-2xl);
      font-weight: 700;
      color: $subject-english;
      font-family: 'Times New Roman', serif;
    }
    .phonetic {
      font-size: var(--font-sm);
      color: $subject-english-light;
      font-family: 'Times New Roman', serif;
    }
    .pos {
      font-size: var(--font-2xs);
      background: $subject-english-soft;
      color: $subject-english;
      padding: 1px 6px;
      border-radius: 4px;
      font-style: italic;
    }
  }

  .meaning {
    font-size: var(--font-base);
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
      font-size: var(--font-sm);
      color: $subject-english;
      font-family: 'Times New Roman', serif;
      margin-bottom: 2px;
    }
    .example-cn {
      font-size: var(--font-xs);
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
  font-size: var(--font-sm);
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
    /* V4.0 · D6：同 ChinesePoem —— 实心底 `-color` 上压 text-on-primary 只有 2.85:1，
       喇叭图标是「正在朗读」的唯一信号。改 `-text` → 5.12:1。 */
    background: var(--primary-text);
    border-color: $primary-color;
    color: var(--text-on-primary);
    animation: pulse-speaking 1.2s var(--ease-standard) infinite; /* check-motion-allow: 朗读脉冲循环 */
  }
  &.tiny {
    width: 22px;
    height: 22px;
    font-size: var(--font-2xs);
    margin-left: 6px;
  }
}

@keyframes pulse-speaking {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(var(--primary-rgb), 0); }
}
</style>