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
                <!-- V2.12.3 · 完成度提示：这摊内容里还有几道题没攻克（错题本里未掌握） -->
                <span v-if="pendingMistakes(ru) > 0" class="unit-card-pending">
                  还有 {{ pendingMistakes(ru) }} 道待攻克
                </span>
                <!-- V2.12.3 · 手动「全部完成」：自动判定覆盖不到时的兜底（可撤销） -->
                <button
                  v-if="unitStatus(ru) !== 'mastered' || isManualComplete(ru)"
                  class="unit-card-flag"
                  type="button"
                  :aria-pressed="isManualComplete(ru)"
                  :title="isManualComplete(ru) ? '取消「全部完成」标记' : '标记为已全部掌握'"
                  @click.stop="toggleComplete(ru)"
                >
                  {{ isManualComplete(ru) ? '✓ 已标记' : '✓ 全完成' }}
                </button>
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
  type CardStatus,
} from '@core/learning/cardStatus'
import {
  completionStatusOf,
  pendingMistakeCount,
  scopeOfUnit,
} from '@core/learning/completion'
import { buildOwnerIndex, type OwnerIndex } from '@core/progress/ownerIndex'
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
 * 归属包索引：状态查表时按 kpId 反查真实落库的包，与 `recordProgress` 写入端同源。
 * 每日一练自包含包（knowledgePoints 为空、进度记到教材单元归属包）靠它才能点亮状态。
 * 仅依赖已加载的包列表，进度变化不影响它；进度变化由下方 computed 重算触发。
 */
const ownerIndex = computed<OwnerIndex>(() => buildOwnerIndex(packageStore.packages))

/**
 * D1 · 单元 → 卡片状态。**一次算完一整屏**，模板只查表。
 *
 * 三个细节：
 *   1. 归属包用 `ru.sourcePackageId` 而非路由上的入口包 —— 学期/专项包会把依赖包的
 *      单元聚合进来，进度行落在**归属包**上，拿入口包去查会一律「未学」。
 *   2. `userDataStore.progress` 在 computed 里被读到 → 学习记录变化会自动重算，
 *      不需要手动刷新（从单元里学完返回本页即可见状态变化）。
 *   3. 聚合走 **`progress` 模式**（`completionStatusOf` 内部固定传）：单元是「任务」，
 *      用户问的是「这个单元我推进到哪了」，不是「里面有没有一个知识点到期了」。
 *      混着未学时不会因为一个到期项就整卡变红 —— 理由见 `cardStatus.ts` 文件头。
 *
 * ## V2.12.3 · 「全部完成」判定
 *
 * 单元状态现在多了一条**题目级**通道（见 `@core/learning/completion` 的文件头）：
 * 所有知识点都学过 + 范围内没有未掌握的错题 → 判「已掌握」。
 * 这条通道解决的是「没全做对就得把整天从头重做一遍」的老毛病。
 */
const statusByUnitId = computed<Map<string, CardStatus>>(() => {
  const map = new Map<string, CardStatus>()
  for (const ru of resolvedUnits.value) {
    const scope = scopeOfUnit(ru.unit)
    map.set(
      ru.unit.id,
      completionStatusOf({
        entryPackageId: ru.sourcePackageId,
        kpIds: scope.kpIds,
        exerciseIds: scope.exerciseIds,
        progress: userDataStore.progress,
        mistakes: userDataStore.mistakes,
        ownerIndex: ownerIndex.value,
        manual: userDataStore.isCardManuallyComplete('unit', ru.unit.id),
      })
    )
  }
  return map
})

function unitStatus(ru: ResolvedUnit): CardStatus {
  return statusByUnitId.value.get(ru.unit.id) ?? 'none'
}

/**
 * 这张卡里还有几道题没攻克（错题本里尚未连对 2 次的题）。
 *
 * 用途：**告诉用户差什么**。原来「没变绿」是个黑箱，用户只能把整天重做一遍；
 * 现在他能直接看到「还有 3 道待攻克」，知道去错题本攻哪几道就能变绿。
 */
function pendingMistakes(ru: ResolvedUnit): number {
  const scope = scopeOfUnit(ru.unit)
  return pendingMistakeCount({
    entryPackageId: ru.sourcePackageId,
    kpIds: scope.kpIds,
    exerciseIds: scope.exerciseIds,
    progress: userDataStore.progress,
    mistakes: userDataStore.mistakes,
    ownerIndex: ownerIndex.value,
  })
}

/** 是否被手动标记为「全部完成」 */
function isManualComplete(ru: ResolvedUnit): boolean {
  return userDataStore.isCardManuallyComplete('unit', ru.unit.id)
}

/**
 * 手动「全部完成」的开关。
 *
 * 只写 `cardCompletions` 表，**绝不**碰 `progress.status` —— 掌握度统计要保持干净
 * （理由见 `@core/learning/completion` 的文件头与 `userData.ts` 的同名方法注释）。
 */
function toggleComplete(ru: ResolvedUnit) {
  if (isManualComplete(ru)) {
    void userDataStore.unmarkCardComplete('unit', ru.unit.id)
  } else {
    void userDataStore.markCardComplete('unit', ru.sourcePackageId, ru.unit.id)
  }
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

  /* 序号条：**中性底，不随状态染色**。
     序号是序数、不承载状态语义；一旦按状态上色，卡片上就出现第二种色调
     （旧实现用 `$primary-light`，它与 `--success-light` 几乎同色，于是在「需复习」的
     粉红卡上是一条淡绿竖条 = 绿/红两种状态信号互相打架；具体色值见
     `src/core/styles/_card-status.scss` 的硬约束第 6 条 —— 那里是唯一允许写字面量色
     的地方，因为它不在这个门禁的扫描范围内）。
     底色用 `--badge-neutral-bg`（= `bg-color-hover`），字用 `text-main`；
     这一对已登记进 `scripts/a11y/contrast-report.ts` 的 MUST_PASS，对比度真的被算。
     hover 时变实心主色块仍保留（那是原有交互语言，见上方 `&:hover`）。 */
  .unit-card-index {
    flex-shrink: 0;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--badge-neutral-bg);
    color: $text-main;
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
    flex-wrap: wrap;
    gap: 8px;
    font-size: 11px;
    color: $text-muted;
    margin-top: 2px;

    /* V2.8 · 来源包软底胶囊（对标参考图3 标签系统）：
       聚合页里「这单元来自哪本包」是扫视时的第一锚点，值得一个 chip */
    .unit-card-source {
      display: inline-flex;
      align-items: center;
      padding: 2px 9px;
      border-radius: 10px;
      background: var(--badge-primary-bg);
      color: $primary-text;
      font-weight: 700;
      line-height: 1.6;
    }

    .unit-card-meta { white-space: nowrap; }

    /* V2.12.3 · 「还有 N 道待攻克」提示：告诉用户差什么，而不是让他把整天重做一遍 */
    .unit-card-pending {
      white-space: nowrap;
      color: var(--warning-text, $text-muted);
    }

    /* V2.12.3 · 手动「全部完成」开关。视觉语言对齐包列表里的分享按钮（小圆角方块） */
    .unit-card-flag {
      flex-shrink: 0;
      padding: 2px 8px;
      display: inline-flex;
      align-items: center;
      border: 1px solid $border-color;
      border-radius: var(--radius-sm);
      background: transparent;
      color: $text-muted;
      font-size: 11px;
      line-height: 1.6;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: var(--bg-color-hover);
        color: $primary-text;
        border-color: $primary-color;
      }

      &:focus-visible {
        outline: var(--focus-ring-w) solid var(--focus-ring);
      }

      &[aria-pressed='true'] {
        background: var(--badge-success-bg);
        color: var(--success-text);
        border-color: transparent;
      }
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