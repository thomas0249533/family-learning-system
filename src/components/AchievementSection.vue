<template>
  <section class="ach-section">
    <header class="ach-head">
      <div class="ach-head-left">
        <span class="ach-head-icon" aria-hidden="true">🏅</span>
        <h2 class="ach-head-name">成就图鉴</h2>
        <span class="ach-head-count" :class="{ done: view.complete }">{{ overallText }}</span>
      </div>
      <button v-if="!view.complete" class="ach-head-toggle" type="button" @click="onToggleAll">
        {{ allExpanded ? '全部收起' : '全部展开' }}
      </button>
    </header>

    <!-- 总进度：0 枚时也显示（0% 本身是真实状态，不算误导） -->
    <div class="ach-overall">
      <div
        class="ach-overall-bar"
        role="progressbar"
        :aria-valuenow="view.earned"
        aria-valuemin="0"
        :aria-valuemax="view.total"
        :aria-label="`成就总进度 ${view.earned}/${view.total}`"
      >
        <div class="ach-overall-fill" :style="{ width: view.percent + '%' }"></div>
      </div>
      <span class="ach-overall-text">{{ view.percent }}%</span>
    </div>

    <!-- 0 枚：不渲染「已获得」区，只给一句引导 -->
    <p v-if="view.empty" class="ach-empty-hint">{{ view.emptyHint }}</p>

    <!-- 两个分区：已获得（默认收起）/ 待解锁（默认展开） -->
    <div class="ach-sections">
      <div v-for="sec in view.sections" :key="sec.key" class="ach-part" :class="sec.key">
        <button
          :id="`ach-head-${sec.key}`"
          class="ach-part-head"
          type="button"
          :aria-expanded="!isSectionCollapsed(sec.key)"
          :aria-controls="`ach-panel-${sec.key}`"
          @click="onToggleSection(sec.key)"
        >
          <span class="part-chevron" aria-hidden="true">▾</span>
          <span class="part-title">{{ sec.label }}</span>
          <span class="part-count">{{ sec.count }}</span>
        </button>

        <div
          v-if="!isSectionCollapsed(sec.key)"
          :id="`ach-panel-${sec.key}`"
          class="ach-part-panel"
          role="region"
          :aria-labelledby="`ach-head-${sec.key}`"
        >
          <div v-for="g in sec.groups" :key="g.category" class="ach-group">
            <button
              :id="`ach-head-${sec.key}-${g.category}`"
              class="ach-group-head"
              type="button"
              :aria-expanded="!isGroupCollapsed(sec.key, g.category)"
              :aria-controls="`ach-panel-${sec.key}-${g.category}`"
              @click="onToggleGroup(sec.key, g.category)"
            >
              <span class="group-icon" aria-hidden="true">{{ g.icon }}</span>
              <span class="group-main">
                <span class="group-title">{{ g.label }}</span>
                <span class="group-desc">{{ g.desc }}</span>
              </span>
              <span class="group-count">
                {{ g.count }}<template v-if="sec.key === 'pending'"> 枚未得</template>
              </span>
              <span class="group-chevron" aria-hidden="true">▾</span>
            </button>

            <!-- 收起态也留一条线索：不展开也能知道"最接近哪一枚" -->
            <template v-if="isGroupCollapsed(sec.key, g.category)">
              <p v-if="g.closest" class="group-teaser">
                最接近：{{ g.closest.icon }} {{ g.closest.title }} · {{ g.closest.hint }}
              </p>
              <p v-else class="group-teaser done">本组已全部获得 🎉</p>
            </template>

            <p v-if="g.guide" class="group-guide">{{ g.guide }}</p>

            <div
              v-if="!isGroupCollapsed(sec.key, g.category)"
              :id="`ach-panel-${sec.key}-${g.category}`"
              role="region"
              :aria-labelledby="`ach-head-${sec.key}-${g.category}`"
            >
              <ul class="ach-list">
                <AchievementCard v-for="item in g.items" :key="item.id" :item="item" />
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// =====================================================================
// AchievementSection · 成就图鉴（两级折叠：区 + 组）
// ---------------------------------------------------------------------
// 交互规格（V1.3 · A-04 / A-05，对应 PRD §5.1–§5.4）：
//   · 两个区：「已获得」/「待解锁」；每组四个：M/G/B/E。
//   · 默认态：已获得**收起**、待解锁**展开**；组跟随所在区。
//   · 右上角「全部展开 / 全部收起」作用于**全部区 + 全部组**，一次写入。
//   · 状态持久化到 db.settings['achievementUi']，读到脏数据静默降级为默认态。
//   · 区头 / 组头都是原生 <button>，带 aria-expanded / aria-controls；
//     Enter / Space 由原生按钮提供，**不自写 keydown**。
//   · 收起时面板整个不渲染（v-if），屏幕阅读器自然跳过，也不占内存。
//   · 0 枚：只渲染「待解锁」区 + 一行引导；28 枚全解锁：隐藏「待解锁」区与一键按钮。
//
// 这里**不做任何成就相关的计算**（进度、排序、分区、文案全部来自视图模型），
// 只负责折叠状态与 DOM 结构。折叠状态的算法在 `@core/motivation/achievementUi`。
// =====================================================================
import { computed, onMounted, ref } from 'vue'
import AchievementCard from './AchievementCard.vue'
import type { AchievementView } from '@core/motivation/achievementMeta'
import {
  DEFAULT_COLLAPSED,
  groupKey,
  groupKeysOf,
  isAllExpanded,
  isCollapsed,
  loadCollapsed,
  saveCollapsed,
  toggleAll,
  toggleGroup,
  toggleSection,
  type UiSection,
} from '@core/motivation/achievementUi'

const props = defineProps<{ view: AchievementView }>()

/** 折叠键集合（收起态） */
const collapsed = ref<string[]>([...DEFAULT_COLLAPSED])

// 先渲染默认态，读到持久化值后再应用 —— 绝不阻塞首屏
onMounted(async () => {
  collapsed.value = await loadCollapsed()
})

function persist(): void {
  void saveCollapsed(collapsed.value)
}

function isSectionCollapsed(sec: UiSection): boolean {
  return isCollapsed(collapsed.value, sec)
}

function isGroupCollapsed(sec: UiSection, cat: string): boolean {
  return isCollapsed(collapsed.value, groupKey(sec, cat))
}

/** 当前 DOM 里真实存在的折叠键（用于「全部展开/收起」的作用范围） */
const visibleKeys = computed(() => {
  const keys: string[] = []
  for (const sec of props.view.sections) {
    keys.push(sec.key)
    keys.push(...groupKeysOf(sec.key))
  }
  return keys
})

const allExpanded = computed(() => isAllExpanded(collapsed.value, visibleKeys.value))

const overallText = computed(() =>
  props.view.complete
    ? `${props.view.total} / ${props.view.total} · 全部收集完成`
    : `${props.view.earned} / ${props.view.total}`,
)

function onToggleSection(sec: UiSection): void {
  collapsed.value = toggleSection(collapsed.value, sec)
  persist()
}

function onToggleGroup(sec: UiSection, cat: string): void {
  collapsed.value = toggleGroup(collapsed.value, sec, cat)
  persist()
}

function onToggleAll(): void {
  collapsed.value = toggleAll(collapsed.value, visibleKeys.value)
  persist()
}
</script>

<style scoped lang="scss">
.ach-section {
  display: flex;
  flex-direction: column;
  gap: $space-3;
}

.ach-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-3;

  .ach-head-left {
    display: flex;
    align-items: center;
    gap: $space-2;
    min-width: 0;
  }

  .ach-head-icon {
    font-size: $font-lg;
    line-height: 1;
  }

  .ach-head-name {
    margin: 0;
    font-size: $font-md;
    font-weight: 800;
    color: $text-main;
    letter-spacing: 0.2px;
  }

  .ach-head-count {
    font-size: $font-xs;
    font-weight: 800;
    color: $primary-text;
    background: $primary-light;
    border-radius: $radius-full;
    padding: 2px $space-2;
    white-space: nowrap;

    &.done {
      color: $success-text;
      background: $success-light;
    }
  }

  .ach-head-toggle {
    flex-shrink: 0;
    font-family: inherit;
    font-size: $font-xs;
    font-weight: 700;
    color: $primary-text;
    background: transparent;
    border: 1px solid $border-color;
    border-radius: $radius-control;
    padding: 6px $space-3;
    cursor: pointer;
    transition: background $duration-fast $ease-standard,
      border-color $duration-fast $ease-standard;

    &:hover {
      background: $primary-light;
      border-color: $primary-color;
    }
    &:focus-visible {
      outline: 2px solid $primary-color;
      outline-offset: 2px;
    }
  }
}

.ach-overall {
  display: flex;
  align-items: center;
  gap: $space-3;

  .ach-overall-bar {
    flex: 1;
    height: 10px;
    background: $bg-color-hover;
    border-radius: $radius-full;
    overflow: hidden;
  }

  .ach-overall-fill {
    height: 100%;
    background: $gradient-primary;
    border-radius: $radius-full;
    transition: width $duration-slow $ease-decelerate;
  }

  .ach-overall-text {
    flex-shrink: 0;
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-sub;
  }
}

.ach-empty-hint {
  margin: 0;
  font-size: $font-xs;
  color: $text-sub;
  line-height: $leading-normal;
}

/* ---------- 两层折叠 ---------- */
.ach-sections {
  display: flex;
  flex-direction: column;
  gap: $space-3;
}

.ach-part {
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $card-bg;
  overflow: hidden;
}

.ach-part-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: $space-2;
  padding: $space-3 $space-4;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background $duration-fast $ease-standard;

  &:hover {
    background: $bg-color-hover;
  }
  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: -2px;
  }

  .part-chevron {
    flex-shrink: 0;
    font-size: $font-xs;
    color: $text-muted;
    transition: transform $duration-fast $ease-standard;
    transform: rotate(-90deg);
  }

  .part-title {
    flex: 1;
    min-width: 0;
    font-size: $font-sm;
    font-weight: 800;
    color: $text-main;
  }

  .part-count {
    flex-shrink: 0;
    font-size: $font-2xs;
    font-weight: 800;
    color: $text-sub;
    background: $bg-color-hover;
    border-radius: $radius-full;
    padding: 1px $space-2;
  }
}

/* 展开态：箭头朝下。收起态由上面的 -90deg 表达 */
.ach-part-head[aria-expanded='true'] .part-chevron {
  transform: rotate(0deg);
}

.ach-part-panel {
  padding: 0 $space-3 $space-3;
  display: flex;
  flex-direction: column;
  gap: $space-2;
}

/* ---------- 组 ---------- */
.ach-group {
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $card-bg;
  overflow: hidden;
}

.ach-group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: $space-2;
  padding: $space-2 $space-3;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background $duration-fast $ease-standard;

  &:hover {
    background: $bg-color-hover;
  }
  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: -2px;
  }

  .group-icon {
    font-size: $font-base;
    line-height: 1;
    flex-shrink: 0;
  }

  .group-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .group-title {
    font-size: $font-sm;
    font-weight: 800;
    color: $text-main;
  }

  .group-desc {
    font-size: $font-2xs;
    color: $text-muted;
    line-height: $leading-normal;
  }

  .group-count {
    flex-shrink: 0;
    font-size: $font-2xs;
    font-weight: 800;
    color: $text-sub;
    white-space: nowrap;
  }

  .group-chevron {
    flex-shrink: 0;
    font-size: $font-xs;
    color: $text-muted;
    transition: transform $duration-fast $ease-standard;
    transform: rotate(-90deg);
  }
}

.ach-group-head[aria-expanded='true'] .group-chevron {
  transform: rotate(0deg);
}

.group-teaser {
  margin: 0;
  padding: 0 $space-3 $space-2;
  font-size: $font-2xs;
  color: $text-muted;
  line-height: $leading-normal;

  &.done {
    color: $success-text;
    font-weight: 700;
  }
}

.group-guide {
  margin: 0;
  padding: 0 $space-3 $space-2;
  font-size: $font-2xs;
  color: $text-sub;
  line-height: $leading-normal;
}

.ach-list {
  list-style: none;
  margin: 0;
  padding: 0 $space-3 $space-3;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: $space-2;
}

@media (max-width: 640px) {
  .ach-list {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ach-overall-fill,
  .ach-part-head,
  .ach-part-head .part-chevron,
  .ach-group-head,
  .ach-group-head .group-chevron {
    transition: none;
  }
}
</style>
