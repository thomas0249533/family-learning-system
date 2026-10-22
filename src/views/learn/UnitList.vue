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
            :class="cardStatusClass(unitStatus(ru))"
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
            <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
            <span class="unit-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[unitStatus(ru)] }}</span>
            <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[unitStatus(ru)] }}</span>
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
import { useUserDataStore } from '@core/stores/userData'
import { resolvePackageUnits, type ResolvedUnit } from '@core/importer/resolvePackageUnits'
import {
  CARD_STATUS_LABEL,
  CARD_STATUS_MARK,
  cardStatusClass,
  unitCardStatusOf,
  type CardStatus,
} from '@core/learning/cardStatus'
import ExamPanel from './ExamPanel.vue'

const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const resolvedUnits = ref<ResolvedUnit[]>([])
const missingDeps = ref<string[]>([])
const isAggregate = ref(false)

const currentPackage = computed(() => packageStore.currentPackage)
const isExamMode = computed(() => (currentPackage.value?.manifest as any)?.examMode === true)

/**
 * D1 · 单元 → 卡片状态。**一次算完一整屏**，模板只查表。
 *
 * 两个细节：
 *   1. 归属包用 `ru.sourcePackageId` 而非路由上的入口包 —— 学期/专项包会把依赖包的
 *      单元聚合进来，进度行落在**归属包**上，拿入口包去查会一律「未学」。
 *   2. `userDataStore.progress` 在 computed 里被读到 → 学习记录变化会自动重算，
 *      不需要手动刷新（从单元里学完返回本页即可见状态变化）。
 *   3. 聚合走 **`progress` 模式**（`unitCardStatusOf` 内部固定传）：单元是「任务」，
 *      用户问的是「这个单元我推进到哪了」，不是「里面有没有一个知识点到期了」。
 *      混着未学时不会因为一个到期项就整卡变红 —— 理由见 `cardStatus.ts` 文件头。
 */
const statusByUnitId = computed<Map<string, CardStatus>>(() => {
  const map = new Map<string, CardStatus>()
  for (const ru of resolvedUnits.value) {
    map.set(ru.unit.id, unitCardStatusOf(ru.unit, ru.sourcePackageId, userDataStore.progress))
  }
  return map
})

function unitStatus(ru: ResolvedUnit): CardStatus {
  return statusByUnitId.value.get(ru.unit.id) ?? 'none'
}

onMounted(async () => {
  // 进度与包并行读，少一次串行等待；loadUserData 只读当前档案（profileId 过滤在 store 内）
  await Promise.all([
    packageStore.loadPackageById(route.params.packageId as string),
    userDataStore.loadUserData(),
  ])
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
@import '@/core/styles/card-status';

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
  position: relative; /* D1 · 状态角标的定位基准 */
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

  /* ===== D1 · 掌握状态：底色只用 --badge-{tone}-bg（= -light），
     与 --{tone}-text 同属对比度门禁 MUST_PASS 的白名单组合；
     未学（none）刻意不改底色，保持 $card-bg ===== */
  &.is-learning { @include card-status-surface(learning); }
  &.is-review   { @include card-status-surface(review); }
  &.is-mastered { @include card-status-surface(mastered); }

  /* 有状态底色时把弱化的脚注文字提一档：text-muted 压在 tone-light 上
     junior 预设只有 4.20～4.33（低于它自己 4.30 的例外下限），
     提到 text-sub 后是 6.9～7.6，稳过 AA。 */
  &.is-learning .unit-card-foot,
  &.is-review .unit-card-foot,
  &.is-mastered .unit-card-foot {
    color: $text-sub;
  }

  .unit-status-mark {
    @include card-status-mark-slot;
    @include card-status-mark-corner;
    @include card-status-ink(none);
  }

  &.is-learning .unit-status-mark { @include card-status-ink(learning); }
  &.is-review .unit-status-mark { @include card-status-ink(review); }
  &.is-mastered .unit-status-mark { @include card-status-ink(mastered); }

  /* 读屏专用文本：视觉不可见，但「掌握状态：需复习」会被读出来 */
  .sr-only { @include sr-only; }

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