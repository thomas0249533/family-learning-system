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
        <AppButton type="primary" size="large" @click="doSearch">🔍 搜索</AppButton>
      </n-input-group>

      <div class="scope-hint" v-if="currentPackage">
        📦 范围：{{ currentPackage.manifest.title }}
      </div>
      <div class="scope-hint empty" v-else>
        尚未选择学习包
      </div>
    </AppCard>

    <AppCard v-if="hasSearched" class="card result-card">
      <n-empty v-if="groups.length === 0" description="没有找到相关内容，试试换个关键词？" />

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
            <span class="kp-icon">📚</span>
            <span class="kp-title">{{ group.knowledgePointTitle }}</span>
            <span class="kp-count">{{ group.items.length }} 条</span>
          </div>

          <div class="kp-items">
            <div
              v-for="(item, idx) in group.items"
              :key="idx"
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
        <div class="detail-answer">✅ 正确答案：{{ detailRaw?.answer }}</div>
        <div v-if="detailRaw?.explanation" class="detail-explain">
          💡 {{ detailRaw.explanation }}
        </div>
      </div>

      <div v-else-if="detailType === 'mistake'" class="detail-body">
        <div class="detail-question">{{ detailRaw?.questionData?.question }}</div>
        <div v-if="detailRaw?.questionData?.options" class="detail-options">
          <div v-for="opt in detailRaw.questionData.options" :key="opt">{{ opt }}</div>
        </div>
        <div class="detail-answer">✅ 正确答案：{{ detailRaw?.questionData?.answer }}</div>
        <div class="detail-explain">
          ❌ 已错 {{ detailRaw?.wrongCount }} 次 · 状态：{{ detailRaw?.mastered ? '已掌握' : '未掌握' }}
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NInput, NInputGroup, NEmpty, NModal
} from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
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
  font-size: 13px;
  color: $text-sub;
  &.empty { color: $danger-text; }
}

.result-card { min-height: 200px; }
.result-list { display: flex; flex-direction: column; gap: 20px; }
.result-summary { font-size: 13px; color: $text-sub; }

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

    .kp-icon { font-size: 16px; }
    .kp-title { font-weight: 700; color: $text-main; flex: 1; }
    .kp-count { font-size: 12px; color: $text-sub; }
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
  transition: background 0.15s;

  &:hover { background: $bg-color-hover; }

  .item-type {
    flex-shrink: 0;
    font-size: 11px;
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
    font-size: 14px;
    font-weight: 600;
    color: $text-main;
    line-height: 1.5;
    word-break: break-word;
  }
  .item-snippet {
    font-size: 12px;
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
  font-size: 15px;
  color: $text-main;
}
.detail-meta {
  margin-top: 12px;
  padding: 10px 12px;
  background: $bg-color-hover;
  border-radius: 6px;
  font-size: 13px;
  color: $text-sub;

  > div { margin-bottom: 4px; }
}
.detail-question {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
}
.detail-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;

  > div { padding: 6px 10px; background: $bg-color-hover; border-radius: 4px; font-size: 14px; }
}
.detail-answer {
  font-weight: 700;
  color: $success-text;
  margin-bottom: 8px;
}
.detail-explain {
  font-size: 13px;
  color: $text-sub;
  padding: 10px 12px;
  background: $bg-color-hover;
  border-radius: 6px;
}
</style>