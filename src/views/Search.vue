<template>
  <div class="page-container">
    <AppCard class="card">
      <n-input-group>
        <n-input
          v-model:value="keyword"
          placeholder="搜索当前学习包内的知识点、题目、错题..."
          size="large"
          clearable
          @keyup.enter="doSearch"
        />
        <AppButton type="primary" size="large" @click="doSearch"><IconBase name="search" size="1em" /> 搜索</AppButton>
      </n-input-group>

      <div class="scope-hint" v-if="currentPackage">
        <IconBase name="package" size="1em" /> 范围：{{ currentPackage.manifest.title }}
      </div>
      <div class="scope-hint empty" v-else>
        尚未选择学习包
      </div>
    </AppCard>

    <AppCard v-if="hasSearched" class="card result-card">
      <EmptyState
        v-if="groups.length === 0"
        icon="search"
        description="没有找到相关内容，试试换个关键词或学科？"
      />

      <div v-else class="result-list">
        <div class="result-summary">
          找到 <b>{{ totalCount }}</b> 条结果，涉及 <b>{{ groups.length }}</b> 个知识点
        </div>

        <div
          v-for="group in groups"
          :key="group.knowledgePointId"
          class="kp-group"
        >
          <div class="kp-header">
            <span class="kp-icon"><IconBase name="books" size="1em" /></span>
            <span class="kp-title">{{ group.knowledgePointTitle }}</span>
            <span class="kp-count">{{ group.items.length }} 条</span>
          </div>

          <div class="kp-items">
            <div
              v-for="(item, idx) in group.items"
              :key="idx"
              v-clickable:link
              class="item"
              @click="openItem(item)"
            >
              <span class="item-type" :class="'type-' + item.type">
                {{ typeLabel(item.type) }}
              </span>
              <div class="item-body">
                <div class="item-title" v-html="highlight(item.title)"></div>
                <div
                  v-if="item.snippet"
                  class="item-snippet"
                  v-html="highlight(item.snippet)"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppCard>

    <!-- 详情弹窗 -->
    <n-modal
      v-model:show="showDetail"
      preset="card"
      :title="detailTitle"
      style="max-width: 680px;"
    >
      <div v-if="detailType === 'knowledgePoint'" class="detail-body">
        <div class="detail-content">{{ detailRaw?.content }}</div>
        <div v-if="detailRaw?.metadata" class="detail-meta">
          <div v-for="(v, k) in detailRaw.metadata" :key="k">
            <b>{{ k }}：</b>{{ v }}
          </div>
        </div>
      </div>

      <div v-else-if="detailType === 'exercise'" class="detail-body">
        <div class="detail-question">{{ detailRaw?.question }}</div>
        <div v-if="detailRaw?.options" class="detail-options">
          <div v-for="opt in detailRaw.options" :key="opt">{{ opt }}</div>
        </div>
        <div class="detail-answer"><IconBase name="check-circle" size="1em" /> 正确答案：{{ detailRaw?.answer }}</div>
        <div v-if="detailRaw?.explanation" class="detail-explain">
          <IconBase name="bulb" size="1em" /> {{ detailRaw.explanation }}
        </div>
      </div>

      <div v-else-if="detailType === 'mistake'" class="detail-body">
        <div class="detail-question">{{ detailRaw?.questionData?.question }}</div>
        <div v-if="detailRaw?.questionData?.options" class="detail-options">
          <div v-for="opt in detailRaw.questionData.options" :key="opt">{{ opt }}</div>
        </div>
        <div class="detail-answer"><IconBase name="check-circle" size="1em" /> 正确答案：{{ detailRaw?.questionData?.answer }}</div>
        <div class="detail-explain">
          <IconBase name="x-circle" size="1em" /> 已错 {{ detailRaw?.wrongCount }} 次 · 状态：{{ detailRaw?.mastered ? '已掌握' : '未掌握' }}
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NInput, NInputGroup, NModal
} from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import {
  searchInPackage,
  type SearchGroup,
  type SearchResultItem,
} from '@core/search/searchService'

const packageStore = usePackageStore()
const userDataStore = useUserDataStore()

const keyword = ref('')
const groups = ref<SearchGroup[]>([])
const hasSearched = ref(false)

const showDetail = ref(false)
const detailType = ref<SearchResultItem['type']>('knowledgePoint')
const detailTitle = ref('')
const detailRaw = ref<any>(null)

const currentPackage = computed(() => packageStore.currentPackage)

const totalCount = computed(() =>
  groups.value.reduce((sum, g) => sum + g.items.length, 0)
)

onMounted(async () => {
  await packageStore.loadPackages()
  await userDataStore.loadUserData()
})

function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) return

  hasSearched.value = true
  groups.value = searchInPackage(
    packageStore.currentPackage,
    userDataStore.mistakes,
    kw
  )

  // ✅ P1-3：写入搜索历史（最多 10 条）
  const raw = localStorage.getItem('searchHistory')
  let history: string[] = []
  try { history = raw ? JSON.parse(raw) : [] } catch {}
  history = history.filter(h => h !== kw)
  history.unshift(kw)
  history = history.slice(0, 10)
  localStorage.setItem('searchHistory', JSON.stringify(history))
}



function typeLabel(type: SearchResultItem['type']): string {
  return type === 'knowledgePoint' ? '知识点'
    : type === 'exercise' ? '题目'
    : '错题'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlight(text: string): string {
  const safe = escapeHtml(text ?? '')
  const kw = keyword.value.trim()
  if (!kw) return safe
  const safeKw = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(safeKw, 'gi'), m => `<mark>${m}</mark>`)
}

function openItem(item: SearchResultItem) {
  detailType.value = item.type
  detailRaw.value = item.raw
  detailTitle.value = typeLabel(item.type) + '详情'
  showDetail.value = true
}
</script>

<style scoped lang="scss">
.page-container { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
/* `.card` 的圆角/阴影已由 AppCard 基元统一提供（radius-lg + shadow-sm），故移除重复声明。 */

.scope-hint {
  margin-top: 12px;
  font-size: var(--font-sm);
  color: $text-sub;
  &.empty { color: $danger-text; }
}

.result-card { min-height: 200px; }
.result-list { display: flex; flex-direction: column; gap: 20px; }
.result-summary { font-size: var(--font-sm); color: $text-sub; }

.kp-group {
  .kp-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: $primary-light;
    border-left: 3px solid $primary-color;
    border-radius: 6px;
    margin-bottom: 8px;

    .kp-icon { font-size: var(--font-lg); }
    .kp-title { font-weight: 700; color: $text-main; flex: 1; }
    .kp-count { font-size: var(--font-xs); color: $text-sub; }
  }

  .kp-items { display: flex; flex-direction: column; gap: 6px; }
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: $surface-2;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  &:hover { background: $bg-color-hover; }

  .item-type {
    flex-shrink: 0;
    font-size: var(--font-2xs);
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    margin-top: 2px;

    &.type-knowledgePoint { background: $info-light; color: $info-text; }
    &.type-exercise { background: $success-light; color: $success-text; }
    &.type-mistake { background: $danger-light; color: $danger-text; }
  }

  .item-body { flex: 1; min-width: 0; }
  .item-title {
    font-size: var(--font-base);
    font-weight: 600;
    color: $text-main;
    line-height: 1.5;
    word-break: break-word;
  }
  .item-snippet {
    font-size: var(--font-xs);
    color: $text-sub;
    margin-top: 4px;
    line-height: 1.5;
    word-break: break-word;
  }

  :deep(mark) {
    background: $warning-light;
    color: $warning-text;
    padding: 0 2px;
    border-radius: 2px;
  }
}

.detail-body { line-height: 1.7; }
.detail-content {
  white-space: pre-wrap;
  font-size: var(--font-md);
  color: $text-main;
}
.detail-meta {
  margin-top: 12px;
  padding: 10px 12px;
  background: $bg-color-hover;
  border-radius: 6px;
  font-size: var(--font-sm);
  color: $text-sub;

  > div { margin-bottom: 4px; }
}
.detail-question {
  font-size: var(--font-lg);
  font-weight: 700;
  margin-bottom: 12px;
}
.detail-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;

  > div { padding: 6px 10px; background: $bg-color-hover; border-radius: 4px; font-size: var(--font-base); }
}
.detail-answer {
  font-weight: 700;
  color: $success-text;
  margin-bottom: 8px;
}
.detail-explain {
  font-size: var(--font-sm);
  color: $text-sub;
  padding: 10px 12px;
  background: $bg-color-hover;
  border-radius: 6px;
}
</style>