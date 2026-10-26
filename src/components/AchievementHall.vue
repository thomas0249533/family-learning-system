<template>
  <!-- =====================================================================
       AchievementHall · 荣誉勋章墙（V2.7 · 轨道 A2）
       ---------------------------------------------------------------------
       为什么不是把 AchievementSection 改一改：那个组件是**图鉴**（两级折叠 +
       证据 + 进度条明细），独立页 `/achievements` 需要它。首页要的是"陈列室"——
       一眼看到几枚大勋章、能按类别扫、想细看再点开。

       所以：图鉴原封不动留给独立页，首页换成这里。两者共用同一个视图模型
       （`store.view`）与同一个详情弹层（`AchievementDetailModal`），
       口径与文案不会分叉。
       ==================================================================== -->
  <section class="hall">
    <header class="hall-head">
      <div class="hall-head-left">
        <span class="hall-head-icon" aria-hidden="true">🏅</span>
        <h2 class="hall-head-title">荣誉勋章墙</h2>
        <span class="hall-head-count" :class="{ done: view.complete }">{{ overallText }}</span>
      </div>
      <RouterLink class="hall-head-link" to="/achievements">全部勋章 →</RouterLink>
    </header>

    <div class="hall-progress">
      <div
        class="hall-progress-bar"
        role="progressbar"
        :aria-valuenow="view.earned"
        aria-valuemin="0"
        :aria-valuemax="view.total"
        :aria-label="`成就总进度 ${view.earned}/${view.total}`"
      >
        <div class="hall-progress-fill" :style="{ width: view.percent + '%' }"></div>
      </div>
      <span class="hall-progress-text">{{ view.percent }}%</span>
    </div>

    <!-- 分类 Tab：只在真有该类成就时出现（自定义包删掉某类也不会留下空 Tab） -->
    <div class="hall-tabs" role="tablist" aria-label="勋章分类">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        role="tab"
        class="hall-tab"
        :class="{ active: active === t.key }"
        :aria-selected="active === t.key"
        @click="active = t.key"
      >
        <span class="tab-icon" aria-hidden="true">{{ t.icon }}</span>
        <span class="tab-label">{{ t.label }}</span>
        <span class="tab-count">{{ t.earned }}/{{ t.count }}</span>
      </button>
    </div>

    <p v-if="view.empty" class="hall-empty">{{ view.emptyHint }}</p>

    <!-- 0 枚时**仍然摆出**可解锁的勋章：陈列室的空墙也要让人看见"有哪些可以拿"，
         只给一句"还没有徽章"等于把目标藏起来了。 -->
    <ul class="hall-grid">
      <li v-for="item in shownItems" :key="item.id" class="hall-cell">
        <button
          type="button"
          class="hall-tile"
          :class="{ earned: item.earned, locked: !item.earned, silhouette: item.silhouetted }"
          :aria-label="ariaOf(item)"
          @click="open(item)"
        >
          <span class="tile-medal">
            <span class="tile-icon" aria-hidden="true">{{ item.silhouetted ? '?' : item.icon }}</span>
            <span v-if="item.earned" class="tile-seal" aria-hidden="true">✓</span>
            <span v-if="item.stars > 0" class="tile-stars" aria-hidden="true">
              <span v-for="n in item.stars" :key="n">★</span>
            </span>
          </span>
          <span class="tile-title">{{ item.silhouetted ? '？？？' : item.title }}</span>
          <span class="tile-meta">{{ item.earned ? item.unlockedAt || '已收集' : item.silhouetted ? '继续探索' : item.hint }}</span>

          <!-- 悬停/聚焦提示：内容与 aria-label 同源，纯视觉增强，读屏不再读一遍 -->
          <span class="tile-tip" aria-hidden="true">
            <strong class="tip-title">{{ item.silhouetted ? '？？？' : item.title }}</strong>
            <span class="tip-desc">{{ item.silhouetted ? '隐藏成就：解锁前不透露任何线索' : item.desc }}</span>
            <span class="tip-hint">{{ item.earned ? `解锁于 ${item.unlockedAt || '未知日期'}` : item.hint }}</span>
          </span>
        </button>
      </li>
    </ul>

    <p v-if="hasMore" class="hall-more">
      <RouterLink class="hall-more-link" to="/achievements">
        还有 {{ restCount }} 枚在成就图鉴里 →
      </RouterLink>
    </p>

    <AchievementDetailModal v-model:show="detailOpen" :item="selected" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AchievementDetailModal from './AchievementDetailModal.vue'
import type { AchievementItem, AchievementView } from '@core/motivation/achievementMeta'
import { CATEGORY_META, CATEGORY_ORDER } from '@core/motivation/achievementMeta'

const props = defineProps<{ view: AchievementView }>()

/** 墙上一屏最多摆这么多枚（再多就退化成"列表"，失去陈列感） */
const MAX_TILES = 8

const active = ref<string>('all')

const selected = ref<AchievementItem | null>(null)
const detailOpen = ref(false)

/**
 * 视图里的条目按「已获得 / 待解锁」两区排布，首页需要的是**平铺**。
 * 用 Map 去重是防御性的：两区理论上互斥，但自定义包若出现同 id 重复，
 * 这里去重比在模板里 `:key` 冲突要体面。
 */
const allItems = computed<AchievementItem[]>(() => {
  const map = new Map<string, AchievementItem>()
  for (const sec of props.view.sections) {
    for (const g of sec.groups) {
      for (const item of g.items) map.set(item.id, item)
    }
  }
  return [...map.values()]
})

/**
 * 分类 Tab：`CATEGORY_META` 是分类名与图标的**唯一真相**（独立页的图鉴也用同一份），
 * 这里只补"该类有几枚 / 已得几枚"。某类一枚都没有就不出 Tab（自定义包可删类）。
 */
const tabs = computed(() => {
  const list = [
    { key: 'all', label: '全部', icon: '✨', count: allItems.value.length, earned: props.view.earned },
  ]
  for (const cat of CATEGORY_ORDER) {
    const items = allItems.value.filter((i) => i.category === cat)
    if (items.length === 0) continue
    const meta = CATEGORY_META[cat]
    list.push({
      key: cat,
      label: meta.label,
      icon: meta.icon,
      count: items.length,
      earned: items.filter((i) => i.earned).length,
    })
  }
  return list
})

/**
 * 排序：已获得在前（新解锁的更靠前），待解锁按"离解锁有多近"倒序。
 * 陈列室的心理学：先让人看见"我已经有的"，再给"只差一点点的"。
 */
const orderedItems = computed<AchievementItem[]>(() => {
  const pool = active.value === 'all'
    ? allItems.value
    : allItems.value.filter((i) => i.category === active.value)

  const earned = pool
    .filter((i) => i.earned)
    .sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''))
  const pending = pool
    .filter((i) => !i.earned)
    .sort((a, b) => b.percent - a.percent)

  return [...earned, ...pending]
})

const shownItems = computed(() => orderedItems.value.slice(0, MAX_TILES))
const hasMore = computed(() => orderedItems.value.length > MAX_TILES)
const restCount = computed(() => Math.max(orderedItems.value.length - MAX_TILES, 0))

const overallText = computed(() =>
  props.view.complete
    ? `${props.view.total} / ${props.view.total} · 全部收集完成`
    : `${props.view.earned} / ${props.view.total}`,
)

/** 隐藏成就的 aria-label 也不能泄底 */
function ariaOf(item: AchievementItem): string {
  if (item.silhouetted) return '隐藏成就，解锁前不透露信息'
  return `${item.title}：${item.earned ? `已解锁，${item.unlockedAt || '日期未知'}` : item.hint}`
}

function open(item: AchievementItem): void {
  // 剪影卡点不开（与 AchievementCard 的守卫同一条规则，绝不让人从弹层里看出内容）
  if (item.silhouetted) return
  selected.value = item
  detailOpen.value = true
}
</script>

<style scoped lang="scss">
.hall {
  display: flex;
  flex-direction: column;
  gap: $space-3;
}

/* ---------- 头部 ---------- */
.hall-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-3;
  flex-wrap: wrap;

  .hall-head-left {
    display: flex;
    align-items: center;
    gap: $space-2;
    min-width: 0;
  }

  .hall-head-icon {
    font-size: $font-lg;
    line-height: 1;
  }

  .hall-head-title {
    margin: 0;
    font-size: $font-md;
    font-weight: 800;
    color: $text-main;
    letter-spacing: 0.2px;
  }

  .hall-head-count {
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

  .hall-head-link {
    flex-shrink: 0;
    font-size: $font-xs;
    font-weight: 700;
    color: $primary-text;
    text-decoration: none;
    white-space: nowrap;
    border-radius: $radius-control;
    padding: 4px $space-1;

    &:hover { text-decoration: underline; }
    &:focus-visible {
      outline: 2px solid $primary-color;
      outline-offset: 2px;
    }
  }
}

/* ---------- 总进度 ---------- */
.hall-progress {
  display: flex;
  align-items: center;
  gap: $space-3;

  .hall-progress-bar {
    flex: 1;
    height: 10px;
    background: $bg-color-hover;
    border-radius: $radius-full;
    overflow: hidden;
  }

  .hall-progress-fill {
    height: 100%;
    background: $gradient-primary;
    border-radius: $radius-full;
    transition: width $duration-slow $ease-decelerate;
  }

  .hall-progress-text {
    flex-shrink: 0;
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-sub;
  }
}

/* ---------- 分类 Tab ---------- */
.hall-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: $space-2;
}

.hall-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px $space-3;
  border: 1px solid $border-color;
  border-radius: $radius-full;
  background: $card-bg;
  font-family: inherit;
  font-size: $font-xs;
  font-weight: 700;
  color: $text-sub;
  cursor: pointer;
  transition: background $duration-fast $ease-standard,
    border-color $duration-fast $ease-standard, color $duration-fast $ease-standard;

  &:hover {
    border-color: $primary-color;
    color: $primary-text;
  }

  &.active {
    background: $primary-light;
    border-color: $primary-color;
    color: $primary-text;
  }

  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }

  .tab-icon {
    font-size: $font-base;
    line-height: 1;
  }

  .tab-count {
    font-size: $font-2xs;
    font-weight: 800;
    color: $text-muted;
    padding-left: 2px;
  }

  &.active .tab-count { color: $primary-text; }
}

/* ---------- 勋章网格 ---------- */
.hall-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: $space-3;
}

.hall-cell {
  position: relative;
  min-width: 0;
}

.hall-tile {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: $space-3 $space-2;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  background: $card-bg;
  font-family: inherit;
  cursor: pointer;
  transition: transform $duration-fast $ease-standard,
    box-shadow $duration-fast $ease-standard, border-color $duration-fast $ease-standard;

  &:hover,
  &:focus-visible {
    transform: translateY(-3px);
    box-shadow: $shadow-md;
    border-color: $primary-color;
    z-index: 3;
  }

  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }

  /* 未解锁：整体降饱和 + 虚线边框，绝不靠"只是颜色浅一点"来表达 */
  &.locked {
    border-style: dashed;
    background: $surface-2;

    .tile-icon { filter: grayscale(1); opacity: 0.55; }
    .tile-title { color: $text-sub; }
  }

  &.silhouette .tile-icon { opacity: 0.35; }

  .tile-medal {
    position: relative;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: $bg-color-hover;
    border: 2px solid $border-light;
  }

  &.earned .tile-medal {
    background: $gradient-primary;
    border-color: transparent;
    box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.28);
  }

  .tile-icon {
    font-size: 30px;
    line-height: 1;
  }

  /* 已收集印章：字形是"颜色之外"的第二重信号（色弱 / 灰度打印可分辨） */
  .tile-seal {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: $success-color;
    color: var(--text-on-primary);
    font-size: 11px;
    font-weight: 800;
    border: 2px solid $card-bg;
  }

  .tile-stars {
    position: absolute;
    top: -8px;
    display: inline-flex;
    gap: 1px;
    font-size: 9px;
    color: $warning-text;
    background: $card-bg;
    border-radius: $radius-full;
    padding: 0 4px;
  }

  .tile-title {
    font-size: $font-xs;
    font-weight: 800;
    color: $text-main;
    line-height: $leading-snug;
    text-align: center;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tile-meta {
    font-size: $font-2xs;
    color: $text-muted;
    line-height: $leading-normal;
    text-align: center;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-width: 100%;
  }

  /* ---------- 悬停提示 ---------- */
  .tile-tip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%) translateY(4px);
    width: 208px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: $space-2 $space-3;
    border-radius: $radius-md;
    background: $card-bg;
    border: 1px solid $border-color;
    box-shadow: $shadow-md;
    text-align: left;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity $duration-fast $ease-standard, transform $duration-fast $ease-standard;
    z-index: 4;

    .tip-title {
      font-size: $font-xs;
      font-weight: 800;
      color: $text-main;
    }
    .tip-desc {
      font-size: $font-2xs;
      color: $text-sub;
      line-height: $leading-normal;
    }
    .tip-hint {
      font-size: $font-2xs;
      font-weight: 700;
      color: $primary-text;
    }
  }

  &:hover .tile-tip,
  &:focus-visible .tile-tip {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(0);
  }
}

/* ---------- 空态 / 更多 ---------- */
.hall-empty {
  margin: 0;
  font-size: $font-xs;
  color: $text-sub;
  line-height: $leading-normal;
}

.hall-more {
  margin: 0;
  text-align: center;

  .hall-more-link {
    font-size: $font-xs;
    font-weight: 700;
    color: $primary-text;
    text-decoration: none;

    &:hover { text-decoration: underline; }
  }
}

@media (max-width: 640px) {
  .hall-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: $space-2;
  }

  /* 窄屏没有真正的 hover，提示条会挡住邻居 —— 直接不渲染视觉提示（点击弹层仍在） */
  .hall-tile .tile-tip { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .hall-tile,
  .hall-tile .tile-tip,
  .hall-progress-fill {
    transition: none;
  }

  .hall-tile:hover,
  .hall-tile:focus-visible {
    transform: none;
  }
}
</style>
