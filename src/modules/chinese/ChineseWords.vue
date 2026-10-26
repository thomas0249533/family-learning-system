<template>
  <AppCard class="chinese-words-card">
    <div class="card-header">
      <span class="header-title">📖 字词积累</span>
      <AppButton v-if="!drilling && kps.length > 0" size="small" type="primary" @click="drilling = true">
        🎴 开始背记
      </AppButton>
    </div>

    <!-- V2.6 · 任务1：词语表切换（下拉）。默认收起词语明细后，这里就是唯一入口 -->
    <div v-if="!drilling && units.length > 1" class="unit-switcher">
      <label class="unit-switcher__label" for="vocab-unit-select">词语表</label>
      <select id="vocab-unit-select" v-model="selectedUnitId" class="unit-switcher__select">
        <option v-for="u in units" :key="u.id" :value="u.id">{{ u.title }}</option>
      </select>
      <span class="unit-switcher__meta">{{ kps.length }} 个词</span>
    </div>

    <VocabDrill
      v-if="drilling"
      :words="kps"
      :package-id="packageId"
      lang="chinese"
      @close="drilling = false"
    />

    <!-- V2.6 · 任务1：词语明细默认折叠，让「开始背记」第一屏可见 -->
    <details v-else-if="kps.length > 0" class="words-details">
      <summary class="words-summary">
        <span class="words-summary__text">📋 查看全部 {{ kps.length }} 个词语</span>
      </summary>
      <div class="words-list">
        <div v-for="(kp, i) in kps" :key="i" class="word-item">
          <div class="word-head">
            <span class="word-text">{{ kp.metadata?.word ?? kp.title }}</span>
            <span class="word-pinyin" v-if="kp.metadata?.pinyin">{{ kp.metadata.pinyin }}</span>
          </div>
          <div class="word-meaning" v-if="kp.content && kp.content !== kp.metadata?.word">{{ kp.content }}</div>
        </div>
      </div>
    </details>

    <EmptyState v-else description="暂无字词内容" />
  </AppCard>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import { usePackageStore } from '@core/stores/package'
import { deriveUnitKnowledgePointIds } from '@core/content/unitKnowledge'
import VocabDrill from '@modules/core/VocabDrill.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const packageStore = usePackageStore()

/**
 * V2.6 · 任务1：从 pkg.units 构建词语表切换器。
 *
 * 关键坑（根因）：本仓词汇包的 `unit.knowledgePointIds` 是**空数组**，
 * 真正的词在 `unit.topics[].modules[].knowledgePointIds`。旧代码用
 * `u.knowledgePointIds ?? props.knowledgePointIds`，空数组不是 null，
 * `??` 不兜底 → 选中单元后拿到 `[]`，列表清空 / 切换失效。
 * 因此这里统一用 `deriveUnitKnowledgePointIds()` 从 topics/modules 兜底推导。
 */
const pkg = computed(() => packageStore.packages.find(p => p.packageId === props.packageId))
const units = computed<any[]>(() => (pkg.value?.units as any[]) ?? [])

const selectedUnitId = ref<string>('')

/**
 * 跟随「当前主题所属单元」自动选中；用户手动下拉后不会被反复覆盖
 * （本 watchEffect 不读 selectedUnitId 作为依赖，只在 units / 当前 KP 变化时重跑）。
 */
watchEffect(() => {
  const list = units.value
  if (list.length === 0) return
  const current = props.knowledgePointIds?.[0]
  const match = current ? list.find(u => deriveUnitKnowledgePointIds(u).includes(current)) : undefined
  selectedUnitId.value = (match ?? list[0]).id
})

const selectedKpIds = computed<string[]>(() => {
  const u = units.value.find(x => x.id === selectedUnitId.value)
  if (!u) return props.knowledgePointIds ?? []
  const ids = deriveUnitKnowledgePointIds(u)
  return ids.length > 0 ? ids : (props.knowledgePointIds ?? [])
})

const kps = useKnowledgePoints(computed(() => selectedKpIds.value))
const drilling = ref(false)
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.chinese-words-card { margin-bottom: 12px; }

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

/* V2.6 · 任务1：词语表切换（下拉） */
.unit-switcher {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;

  &__label {
    font-size: 13px;
    font-weight: 700;
    color: $text-sub;
    flex-shrink: 0;
  }

  &__select {
    flex: 1;
    min-width: 0;
    max-width: 320px;
    padding: 7px 12px;
    border: 1.5px solid $border-color;
    border-radius: 10px;
    background: $card-bg;
    color: $text-main;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s ease;

    &:hover { border-color: $primary-color; }
    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: 2px;
    }
  }

  &__meta {
    flex-shrink: 0;
    font-size: 12px;
    color: $text-muted;
  }
}

/* V2.6 · 任务1：词语明细折叠面板（默认收起） */
.words-details {
  border: 1px dashed $border-light;
  border-radius: 10px;
  padding: 2px 12px;

  .words-summary {
    cursor: pointer;
    padding: 10px 0;
    font-size: 13px;
    font-weight: 700;
    color: $primary-text;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;

    &::-webkit-details-marker { display: none; }
    &::before {
      content: '▸';
      display: inline-block;
      transition: transform 0.15s ease;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-text);
      outline-offset: 2px;
      border-radius: 6px;
    }
  }

  &[open] .words-summary::before { transform: rotate(90deg); }

  .words-list { margin-bottom: 12px; }
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
