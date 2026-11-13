<template>
  <!-- V3.1.7 · 语音朗读设置：音色 / 语速 / 试听。
       自治组件（与 LocalAiCard / SyncSettings 同约定），状态自己管，避免被 Tab 卸载重建。 -->
  <AppCard title="语音朗读" class="card voice-card">
    <n-space vertical size="large">
      <p class="voice-desc">
        用于生字生词听写、课文朗读。孩子听不清时可以换一个声音、把语速调慢。
      </p>

      <div class="voice-field">
        <h4 class="setting-label">朗读声音</h4>
        <n-select
          v-model:value="selectedVoice"
          :options="voiceOptions"
          placeholder="自动选择（推荐）"
          clearable
          @update:value="onVoiceChange"
        />
        <p class="voice-hint">
          {{ voiceStatus }}
        </p>
      </div>

      <div class="voice-field">
        <h4 class="setting-label">语速 <span class="voice-rate-value">{{ rateLabel }}</span></h4>
        <n-slider
          v-model:value="rate"
          :min="0.5"
          :max="1.3"
          :step="0.02"
          :marks="{ 0.5: '很慢', 0.82: '听写推荐', 1: '正常', 1.3: '快' }"
          @update:value="onRateChange"
        />
        <p class="voice-hint">中文听写默认 0.82 倍速，留出写字时间。</p>
      </div>

      <div class="voice-actions">
        <n-button type="primary" @click="preview"><IconBase name="volume" size="1em" /> 试听中文</n-button>
        <n-button @click="previewEn"><IconBase name="volume" size="1em" /> 试听英文</n-button>
        <n-button quaternary @click="resetToDefault">恢复默认</n-button>
      </div>

      <p class="voice-hint voice-note">
        <IconBase name="package" size="1em" /> 已兼容离线语音包：学习包内若带有词的音频文件，会优先播放该音频；没有则使用上面的系统声音。
      </p>
    </n-space>
  </AppCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NSelect, NSlider, NButton, NSpace } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import {
  listVoices,
  loadVoicePreferences,
  saveVoicePreferences,
  effectiveRate,
  speak,
  type VoicePreferences,
} from '@core/audio/speechService'

const prefs = ref<VoicePreferences>(loadVoicePreferences())
const selectedVoice = ref<string | null>(prefs.value.voiceName || null)
const rate = ref<number>(prefs.value.rate ?? 0.82)
const voices = ref<SpeechSynthesisVoice[]>([])

const voiceOptions = computed(() => [
  { label: '自动选择（推荐）', value: '' },
  ...voices.value.map(v => ({
    label: `${v.name}${v.localService ? '（本地）' : ''}`,
    value: v.name,
  })),
])

const voiceStatus = computed(() => {
  if (voices.value.length === 0) {
    return '当前设备未列出可选声音，将使用系统默认语音。'
  }
  return `检测到 ${voices.value.length} 个系统声音；带「本地」的离线也能用。`
})

const rateLabel = computed(() => `${rate.value.toFixed(2)}×`)

function persist() {
  const p: VoicePreferences = {
    voiceName: selectedVoice.value || '',
    rate: Math.round(rate.value * 100) / 100,
  }
  prefs.value = p
  saveVoicePreferences(p)
}

function onVoiceChange(v: string | null) {
  selectedVoice.value = v || null
  persist()
  if (v) void speak({ text: '你好，我是新的朗读声音', lang: 'zh-CN' })
}

function onRateChange(v: number) {
  rate.value = v
  persist()
}

function preview() {
  void speak({ text: '奇观，据说，逐渐，人山人海', lang: 'zh-CN', rate: rate.value })
}

function previewEn() {
  void speak({ text: 'building, honeybee, supermarket', lang: 'en-US', rate: rate.value })
}

function resetToDefault() {
  selectedVoice.value = null
  rate.value = 0.82
  saveVoicePreferences({ voiceName: '', rate: null })
  prefs.value = loadVoicePreferences()
}

onMounted(async () => {
  // WebView 首次 getVoices() 常为空，稍后再取一次
  voices.value = listVoices()
  window.setTimeout(() => { voices.value = listVoices() }, 500)
  // 语速未设置过时展示按语种推算的默认值
  if (prefs.value.rate === null) rate.value = effectiveRate('zh-CN')
})
</script>

<style scoped lang="scss">
.voice-card {
  margin-top: 16px;
}

.voice-desc,
.voice-hint {
  margin: 0;
  font-size: var(--font-xs);
  line-height: 1.7;
  color: $text-sub;
}

.voice-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voice-rate-value {
  font-weight: 700;
  color: $text-main;
}

.voice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.voice-note {
  padding: 10px 12px;
  border-radius: 8px;
  background: $bg-color-hover;
}
</style>
