<template>
  <div class="stroke-page">
    <AppCard class="card">
      <template #header>
        <div class="header-row">
          <span>✍️ 笔顺描红</span>
          <span class="header-sub">跟着虚线大字练写，巩固生字书写</span>
        </div>
      </template>

      <div class="stroke-body">
        <!-- 左：汉字选择 -->
        <div class="char-picker">
          <div class="picker-filter">
            <n-input v-model:value="keyword" placeholder="🔍 搜索汉字 / 拼音" size="small" clearable />
          </div>
          <div class="char-grid">
            <button
              v-for="item in filteredChars"
              :key="item.key"
              class="char-chip"
              :class="{ on: active?.key === item.key }"
              type="button"
              @click="active = item"
            >
              <span class="char-chip__glyph">{{ item.char }}</span>
              <span class="char-chip__py">{{ item.pinyin }}</span>
            </button>
            <EmptyState v-if="filteredChars.length === 0" description="没有可导出的汉字（请先导入语文词汇包）" />
          </div>
        </div>

        <!-- 右：描红画布 -->
        <div class="trace-area">
          <template v-if="active">
            <StrokeOrderTrace :char="active.char" :pinyin="active.pinyin" :size="320" />
            <div class="trace-meta">
              <div class="trace-meta__title">{{ active.title }}</div>
              <div class="trace-meta__src">来自：{{ active.sourceTitle }}</div>
            </div>
          </template>
          <EmptyState v-else description="← 从左侧选择一个汉字开始描红" />
        </div>
      </div>
    </AppCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StrokeOrderTrace from '@/components/StrokeOrderTrace.vue'
import { usePackageStore } from '@core/stores/package'

interface CharItem {
  key: string
  char: string
  pinyin: string
  title: string
  sourceTitle: string
}

const packageStore = usePackageStore()
const keyword = ref('')
const active = ref<CharItem | null>(null)

/** 从已导入的语文包里收集中文汉字（带拼音的知识点）。 */
const chars = computed<CharItem[]>(() => {
  const out: CharItem[] = []
  for (const pkg of packageStore.packages) {
    if (pkg.manifest?.subject !== 'chinese') continue
    const title = pkg.manifest?.title ?? pkg.packageId
    for (const kp of pkg.knowledgePoints ?? []) {
      const py = (kp.metadata as any)?.pinyin
      const glyph = kp.content ?? kp.title ?? ''
      // 只要「看起来像汉字」的内容（含至少一个 CJK 字符）
      if (!py || !/[一-鿿]/.test(glyph)) continue
      out.push({
        key: `${pkg.packageId}::${kp.id}`,
        char: glyph,
        pinyin: py,
        title: kp.title ?? glyph,
        sourceTitle: title,
      })
    }
  }
  return out
})

const filteredChars = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return chars.value
  return chars.value.filter(
    (c) => c.char.includes(kw) || c.pinyin.toLowerCase().includes(kw) || c.title.toLowerCase().includes(kw),
  )
})

onMounted(async () => {
  await packageStore.loadPackages()
  if (chars.value.length > 0) active.value = chars.value[0]
})
</script>

<style scoped lang="scss">
.stroke-page { padding: 16px; }

.header-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 16px;
  font-weight: 800;
  color: $text-main;
}
.header-sub { font-size: 12px; font-weight: 500; color: $text-sub; }

.stroke-body {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(320px, 420px);
  gap: 20px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
}

.char-picker { display: flex; flex-direction: column; gap: 12px; }

.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
  align-content: start;
}

.char-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: 1px solid $border-color;
  border-radius: 10px;
  background: $card-bg;
  cursor: pointer;
  transition: all 0.15s;

  &__glyph {
    font-size: 24px;
    font-weight: 700;
    color: $text-main;
    font-family: "KaiTi", "STKaiti", "楷体", serif;
    line-height: 1.1;
  }
  &__py {
    font-size: 10px;
    color: $text-muted;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &:hover { border-color: $primary-color; transform: translateY(-1px); }
  &.on {
    border-color: $primary-color;
    background: $primary-light;
    .char-chip__glyph { color: $primary-text; }
  }
}

.trace-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: $bg-color;
  border-radius: $radius-lg;
}

.trace-meta {
  text-align: center;
  &__title { font-size: 15px; font-weight: 700; color: $text-main; }
  &__src { font-size: 12px; color: $text-sub; margin-top: 2px; }
}
</style>
