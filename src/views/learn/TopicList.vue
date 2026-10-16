<template>
  <div class="topic-list-page">
    <n-spin v-if="loading" size="large" class="loading-spin" />

    <template v-else>
      <div v-if="currentUnit" class="unit-header">
        <h2 class="unit-header-title">{{ currentUnit.title }}</h2>
        <p v-if="currentUnit.desc" class="unit-header-desc">{{ currentUnit.desc }}</p>
      </div>

      <div v-if="currentUnit?.topics?.length" class="topic-grid">
        <div
          v-for="(topic, idx) in currentUnit.topics"
          :key="topic.id"
          class="topic-card"
          :class="topic.board ? 'board-' + boardKey(topic.board) : ''"
          @click="selectTopic(topic)"
        >
          <div class="topic-card-head">
            <span class="topic-card-index">{{ idx + 1 }}</span>
            <h3 class="topic-card-title">
              <span v-if="boardIcon(topic.board)" class="topic-card-emoji">{{ boardIcon(topic.board) }}</span>{{ topic.title }}
            </h3>
          </div>
          <p v-if="topic.desc" class="topic-card-desc">{{ topic.desc }}</p>
          <div class="topic-card-foot">
            <span class="topic-card-meta">
              <span class="meta-item">📝 {{ topic.knowledgePointIds?.length ?? 0 }} 个知识点</span>
              <span class="meta-item">✏️ {{ topic.exercises?.length ?? 0 }} 道题</span>
              <span v-if="difficultyOf(topic)" class="meta-item meta-chip">{{ difficultyOf(topic) }}</span>
            </span>
            <span class="topic-card-cta">
              {{ topic.board ? '开始刷题' : '开始学习' }}
              <span class="cta-arrow">→</span>
            </span>
          </div>
        </div>
      </div>

      <EmptyState v-else description="该单元暂无主题数据" class="empty-card" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NSpin } from 'naive-ui'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePackageStore } from '@core/stores/package'

const packageStore = usePackageStore()
const router = useRouter()
const route = useRoute()

const loading = ref(true)

/** ✅ 板块（口算 / 竖式 / 脱式 / 思维）图标与配色 */
const BOARD_ICON: Record<string, string> = { '口算': '🧮', '竖式': '📐', '脱式': '✍️', '思维': '💡' }
const BOARD_KEY: Record<string, string> = { '口算': 'kou', '竖式': 'shu', '脱式': 'tuo', '思维': 'si' }

function boardIcon(board?: string): string {
  return board ? (BOARD_ICON[board] ?? '📘') : ''
}
function boardKey(board?: string): string {
  return board ? (BOARD_KEY[board] ?? 'other') : ''
}

/** ✅ 汇总 topic 内题目的难度（去重后按 基础→提高→挑战 排序） */
function difficultyOf(topic: any): string {
  const order = ['基础', '提高', '挑战']
  const set = new Set<string>()
  for (const ex of topic?.exercises ?? []) {
    const d = ex?.metadata?.difficulty
    if (d) set.add(d)
  }
  if (set.size === 0) return ''
  return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(' / ')
}

/** ✅ 剥 :: 前缀 */
function stripPrefix(id: string): string {
  const idx = id.indexOf('::')
  return idx >= 0 ? id.slice(idx + 2) : id
}

onMounted(async () => {
  await packageStore.loadPackageById(route.params.packageId as string)
  loading.value = false
})

const currentUnit = computed(() => {
  const pkg = packageStore.currentPackage
  if (!pkg) return null
  const targetId = route.params.unitId as string
  // ✅ 兼容带前缀 / 不带前缀的 id
  return pkg.units.find((u: any) =>
    u.id === targetId || stripPrefix(u.id) === targetId
  )
})

function selectTopic(topic: any) {
  // ✅ URL 里只带短 ID
  router.push(`/learn/${route.params.packageId}/unit/${route.params.unitId}/topic/${stripPrefix(topic.id)}`)
}
</script>

<style scoped lang="scss">
.topic-list-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.loading-spin {
  display: flex;
  justify-content: center;
  margin-top: 40px;
}

.unit-header {
  padding: 4px 0;

  .unit-header-title {
    font-size: 20px;
    font-weight: 800;
    color: $text-main;
    margin: 0 0 6px;
    letter-spacing: 0.2px;
  }

  .unit-header-desc {
    font-size: 13px;
    color: $text-sub;
    line-height: 1.6;
    margin: 0;
  }
}

.topic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}

.topic-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  padding: 16px 18px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
    border-color: $primary-color;

    .topic-card-cta .cta-arrow {
      transform: translateX(4px);
    }

    .topic-card-index {
      background: var(--primary-text);
      color: var(--text-on-primary);
    }
  }

  /* ✅ 每日一练板块配色（左侧色条） */
  &.board-kou { border-left: 3px solid $primary-color; }
  &.board-shu { border-left: 3px solid $success-color; }
  &.board-tuo { border-left: 3px solid $warning-color; }
  &.board-si  { border-left: 3px solid $primary-color; }
  &.board-other { border-left: 3px solid $border-color; }

  .topic-card-emoji {
    margin-right: 6px;
    font-size: 16px;
  }

  .topic-card-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .topic-card-index {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $primary-light;
    color: $primary-color;
    font-size: 12px;
    font-weight: 800;
    border-radius: 8px;
    transition: all 0.2s;
  }

  .topic-card-title {
    font-size: 15px;
    font-weight: 700;
    color: $text-main;
    margin: 0;
    line-height: 1.4;
    flex: 1;
  }

  .topic-card-desc {
    font-size: 12px;
    color: $text-sub;
    line-height: 1.55;
    margin: 0;
  }

  .topic-card-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 10px;
    border-top: 1px dashed $border-light;
    margin-top: auto;
    gap: 12px;
  }

  .topic-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
    color: $text-muted;
    flex: 1;
    min-width: 0;

    .meta-item {
      white-space: nowrap;
    }

    .meta-chip {
      padding: 1px 8px;
      border-radius: 10px;
      background: $bg-color-hover;
      color: $text-sub;
      font-weight: 600;
    }
  }

  .topic-card-cta {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 700;
    color: $primary-color;

    .cta-arrow {
      font-size: 13px;
      transition: transform 0.2s;
    }
  }
}

.empty-card {
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 60px 20px;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
}
</style>