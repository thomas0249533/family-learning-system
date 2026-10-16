<template>
  <n-card class="chinese-words-card">
    <div class="card-header">
      <span class="header-title">📖 字词积累</span>
      <n-button v-if="!drilling && kps.length > 0" size="small" type="primary" @click="drilling = true">
        🎴 开始背记
      </n-button>
    </div>

    <VocabDrill
      v-if="drilling"
      :words="kps"
      :package-id="packageId"
      lang="chinese"
      @close="drilling = false"
    />

    <div v-else-if="kps.length > 0" class="words-list">
      <div v-for="(kp, i) in kps" :key="i" class="word-item">
        <div class="word-head">
          <span class="word-text">{{ kp.metadata?.word ?? kp.title }}</span>
          <span class="word-pinyin" v-if="kp.metadata?.pinyin">{{ kp.metadata.pinyin }}</span>
        </div>
        <div class="word-meaning" v-if="kp.content && kp.content !== kp.metadata?.word">{{ kp.content }}</div>
      </div>
    </div>

    <n-empty v-else description="暂无字词内容" />
  </n-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NCard, NButton, NEmpty } from 'naive-ui'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import VocabDrill from '@modules/core/VocabDrill.vue'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))
const drilling = ref(false)
</script>

<style scoped lang="scss">
.chinese-words-card { border-radius: $radius-lg; box-shadow: $shadow-sm; margin-bottom: 12px; }

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

.words-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.word-item {
  background: $bg-color-hover;
  border-left: 4px solid $subject-chinese-soft;
  border-radius: 6px;
  padding: 12px 14px;

  .word-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 4px;

    .word-text {
      font-size: 18px;
      font-weight: 700;
      color: $subject-chinese-deep;
    }
    .word-pinyin {
      font-size: 12px;
      color: $subject-chinese;
      font-family: 'Times New Roman', serif;
    }
  }

  .word-meaning {
    font-size: 13px;
    line-height: 1.6;
    color: $text-main;
  }
}
</style>