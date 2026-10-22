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
          :class="[topic.board ? 'board-' + boardKey(topic.board) : '', cardStatusClass(topicStatus(topic))]"
          @click="selectTopic(topic)"
        >
          <div class="topic-card-head">
            <span class="topic-card-index">{{ idx + 1 }}</span>
            <h3 class="topic-card-title">
              <span v-if="boardIcon(topic.board)" class="topic-card-emoji">{{ boardIcon(topic.board) }}</span>{{ topic.title }}
            </h3>
            <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
            <span class="topic-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[topicStatus(topic)] }}</span>
            <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[topicStatus(topic)] }}</span>
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
import { useUserDataStore } from '@core/stores/userData'
import {
  CARD_STATUS_LABEL,
  CARD_STATUS_MARK,
  cardStatusClass,
  topicCardStatusOf,
  type CardStatus,
} from '@core/learning/cardStatus'

const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
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
  await Promise.all([
    packageStore.loadPackageById(route.params.packageId as string),
    userDataStore.loadUserData(),
  ])
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

/** 本页主题的归属包：`currentUnit` 是从当前包里找的，故包 ID 就是当前包 */
const packageId = computed(() => packageStore.currentPackage?.packageId ?? (route.params.packageId as string))

/**
 * D1 · 主题 → 卡片状态。一次算完一屏，模板只查表（避免每个角标各建一次状态表）。
 * 读 `userDataStore.progress` 即建立响应式依赖：学完返回本页状态自动更新。
 */
const statusByTopicId = computed<Map<string, CardStatus>>(() => {
  const map = new Map<string, CardStatus>()
  for (const topic of currentUnit.value?.topics ?? []) {
    map.set(topic.id, topicCardStatusOf(topic, packageId.value, userDataStore.progress))
  }
  return map
})

function topicStatus(topic: { id: string }): CardStatus {
  return statusByTopicId.value.get(topic.id) ?? 'none'
}

function selectTopic(topic: any) {
  // ✅ URL 里只带短 ID
  router.push(`/learn/${route.params.packageId}/unit/${route.params.unitId}/topic/${stripPrefix(topic.id)}`)
}
</script>

<style scoped lang="scss">
@import '@/core/styles/card-status';

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

  /* ===== D1 · 掌握状态 =====
     底色只用 --badge-{tone}-bg（= -light），配合 --{tone}-text 角标；
     这一对是 contrast-report.ts 的 MUST_PASS 成员。
     板块色只占 border-left，所以「背景」是空的、可以安全承载状态色，两者不打架。
     未学（none）不改底色：本页多数主题未学，全染中性色会让整页发灰。 */
  &.is-learning { @include card-status-surface(learning); }
  &.is-review   { @include card-status-surface(review); }
  &.is-mastered { @include card-status-surface(mastered); }

  /* 有状态底色时把脚注 metadata 提一档（text-muted 在 tone-light 上 junior 预设仅 4.20～4.33） */
  &.is-learning .topic-card-meta,
  &.is-review .topic-card-meta,
  &.is-mastered .topic-card-meta {
    color: $text-sub;
  }

  /* 角标排在标题行末尾的固定槽位：不覆盖标题、不加高卡片 */
  .topic-status-mark {
    @include card-status-mark-slot;
    @include card-status-ink(none);
    margin-top: 2px;
  }

  &.is-learning .topic-status-mark { @include card-status-ink(learning); }
  &.is-review .topic-status-mark { @include card-status-ink(review); }
  &.is-mastered .topic-status-mark { @include card-status-ink(mastered); }

  /* 读屏专用文本：视觉不可见，但「掌握状态：需复习」会被读出来 */
  .sr-only { @include sr-only; }

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
    color: $primary-text;
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
    color: $primary-text;

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