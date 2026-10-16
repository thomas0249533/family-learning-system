<template>
  <div class="unit-list-page">
    <ExamPanel v-if="isExamMode && currentPackage" :pkg="currentPackage" />

    <template v-else>
      <n-spin v-if="loading" size="large" class="loading-spin" />

      <template v-else>
        <n-alert
          v-if="missingDeps.length > 0"
          type="warning"
          style="margin-bottom: 16px;"
        >
          以下依赖包未找到：{{ missingDeps.join('、') }}。请一并导入这些包。
        </n-alert>

        <div v-if="resolvedUnits.length > 0" class="unit-grid">
          <div
            v-for="(ru, idx) in resolvedUnits"
            :key="ru.unit.id"
            class="unit-card"
            @click="selectUnit(ru)"
          >
            <div class="unit-card-index">{{ idx + 1 }}</div>
            <div class="unit-card-body">
              <h3 class="unit-card-title">{{ ru.unit.title }}</h3>
              <p v-if="ru.unit.desc" class="unit-card-desc">{{ ru.unit.desc }}</p>
              <div class="unit-card-foot">
                <span v-if="isAggregate" class="unit-card-source">
                  📚 {{ ru.sourcePackageTitle }}
                </span>
                <span class="unit-card-meta">
                  {{ ru.unit.topics?.length ?? 0 }} 个主题
                </span>
              </div>
            </div>
            <div class="unit-card-arrow">→</div>
          </div>
        </div>

        <EmptyState v-else description="该学习包内暂无单元数据" class="empty-card" />
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NSpin, NAlert } from 'naive-ui'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePackageStore } from '@core/stores/package'
import { resolvePackageUnits, type ResolvedUnit } from '@core/importer/resolvePackageUnits'
import ExamPanel from './ExamPanel.vue'

const packageStore = usePackageStore()
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const resolvedUnits = ref<ResolvedUnit[]>([])
const missingDeps = ref<string[]>([])
const isAggregate = ref(false)

const currentPackage = computed(() => packageStore.currentPackage)
const isExamMode = computed(() => (currentPackage.value?.manifest as any)?.examMode === true)

onMounted(async () => {
  await packageStore.loadPackageById(route.params.packageId as string)
  const pkg = currentPackage.value
  if (pkg && (pkg.manifest as any).examMode !== true) {
    const result = await resolvePackageUnits(pkg)
    resolvedUnits.value = result.units
    missingDeps.value = result.missing
    isAggregate.value = result.isAggregate
  }
  loading.value = false
})



function stripPrefix(id: string): string {
  const idx = id.indexOf('::')
  return idx >= 0 ? id.slice(idx + 2) : id
}

function selectUnit(ru: ResolvedUnit) {
  // ✅ URL 里只带短 ID，避免 :: 编码问题
  router.push(`/learn/${ru.sourcePackageId}/unit/${stripPrefix(ru.unit.id)}`)
}

</script>

<style scoped lang="scss">
.unit-list-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-spin {
  display: flex;
  justify-content: center;
  margin-top: 40px;
}

.unit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}

.unit-card {
  display: flex;
  align-items: stretch;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s ease;
  min-height: 96px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
    border-color: $primary-color;

    .unit-card-arrow {
      transform: translateX(4px);
      color: $primary-text;
    }

    .unit-card-index {
      background: var(--primary-text);
      color: var(--text-on-primary);
    }
  }

  .unit-card-index {
    flex-shrink: 0;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $primary-light;
    color: $primary-text;
    font-size: 18px;
    font-weight: 800;
    transition: all 0.2s;
  }

  .unit-card-body {
    flex: 1;
    min-width: 0;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
  }

  .unit-card-title {
    font-size: 15px;
    font-weight: 700;
    color: $text-main;
    margin: 0;
    line-height: 1.4;
  }

  .unit-card-desc {
    font-size: 12px;
    color: $text-sub;
    line-height: 1.5;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .unit-card-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: $text-muted;
    margin-top: 2px;

    .unit-card-source {
      color: $primary-text;
      font-weight: 600;
    }
  }

  .unit-card-arrow {
    display: flex;
    align-items: center;
    padding: 0 16px;
    color: $text-muted;
    font-size: 18px;
    transition: all 0.2s;
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