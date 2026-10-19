<template>
  <section class="ach-section">
    <header class="ach-head">
      <div class="ach-head-left">
        <span class="ach-head-icon" aria-hidden="true">🏅</span>
        <h2 class="ach-head-name">成就图鉴</h2>
        <span class="ach-head-count">{{ view.earned }} / {{ view.total }}</span>
      </div>
      <button class="ach-head-toggle" type="button" @click="toggleAll">
        {{ allOpen ? '全部收起' : '全部展开' }}
      </button>
    </header>

    <!-- 总进度 -->
    <div class="ach-overall">
      <div
        class="ach-overall-bar"
        role="progressbar"
        :aria-valuenow="view.earned"
        aria-valuemin="0"
        :aria-valuemax="view.total"
        aria-label="成就总进度"
      >
        <div class="ach-overall-fill" :style="{ width: view.percent + '%' }"></div>
      </div>
      <span class="ach-overall-text">已获得 {{ view.percent }}%</span>
    </div>

    <!-- 正在接近：**不折叠**，保证"未获得的成就随时可看 + 有达成提示" -->
    <div v-if="view.closest.length > 0" class="ach-closest">
      <div class="ach-closest-title">正在接近</div>
      <ul class="ach-closest-list">
        <li v-for="c in view.closest" :key="c.id" class="ach-closest-item">
          <span class="closest-icon" aria-hidden="true">{{ c.icon }}</span>
          <span class="closest-body">
            <span class="closest-name">{{ c.title }}</span>
            <span class="closest-hint">{{ c.hint }}</span>
          </span>
          <span class="closest-pct">{{ c.percent }}%</span>
        </li>
      </ul>
    </div>

    <!-- 分组（默认全部收起，保持界面简洁） -->
    <div class="ach-groups">
      <div
        v-for="g in view.groups"
        :key="g.category"
        class="ach-group"
        :class="{ open: isOpen(g.category), 'all-done': g.earned === g.total }"
      >
        <button
          class="ach-group-head"
          type="button"
          :aria-expanded="isOpen(g.category)"
          :aria-controls="`ach-panel-${g.category}`"
          @click="toggleGroup(g.category)"
        >
          <span class="group-icon" aria-hidden="true">{{ g.icon }}</span>
          <span class="group-main">
            <span class="group-title">{{ g.label }}</span>
            <span class="group-desc">{{ g.desc }}</span>
          </span>
          <span class="group-count">{{ g.earned }} / {{ g.total }}</span>
          <span class="group-chevron" aria-hidden="true">▾</span>
        </button>

        <!-- 收起态也要给提示：组内最接近解锁的那一枚 -->
        <p v-if="!isOpen(g.category) && g.closest" class="group-teaser">
          最接近：{{ g.closest.icon }} {{ g.closest.title }} · {{ g.closest.hint }}
        </p>
        <p v-else-if="!isOpen(g.category)" class="group-teaser done">
          本组已全部获得 🎉
        </p>

        <ul v-if="isOpen(g.category)" :id="`ach-panel-${g.category}`" class="ach-list">
          <AchievementCard v-for="item in orderedItems(g)" :key="item.id" :item="item" />
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// =====================================================================
// AchievementSection · 成就图鉴（分组折叠）
// ---------------------------------------------------------------------
// 交互约定（V1.3 · T04）：
//   · 四个分类各一个折叠面板，**默认全部收起**（28 枚全铺开会把首页撑爆）；
//   · 右上角「全部展开 / 全部收起」一键切换；
//   · 收起时每个分组头仍显示"最接近解锁"的那一枚 + 进度提示 → 未获得的成就
//     不展开也能看到进展；
//   · 独立一块「正在接近」列出全局最接近的 3 枚，始终可见；
//   · 展开状态持久化到 localStorage['fls:achievementUi']，下次回来还是原样。
//
// 为什么用 localStorage 而不是 Dexie：这是**纯 UI 偏好**（跟设备/屏幕有关），
// 不该混进学习数据，也不该被"导出/恢复备份"带走。
// =====================================================================
import { computed, ref } from 'vue'
import AchievementCard from './AchievementCard.vue'
import type {
  AchievementCategory,
  AchievementGroup,
  AchievementItem,
  AchievementView,
} from '@core/motivation/achievementMeta'

defineProps<{ view: AchievementView }>()

const STORAGE_KEY = 'fls:achievementUi'
const CATS: AchievementCategory[] = ['M', 'G', 'B', 'E']

function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { open?: Record<string, boolean> }
    const out: Record<string, boolean> = {}
    for (const c of CATS) if (parsed.open?.[c] === true) out[c] = true
    return out
  } catch {
    // 隐私模式 / 存储被禁用 / 脏数据 → 回到"全部收起"，不影响使用
    return {}
  }
}

const open = ref<Record<string, boolean>>(loadOpen())

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: open.value }))
  } catch {
    /* 存不了就算了：本次会话内的折叠状态仍然有效 */
  }
}

function isOpen(cat: AchievementCategory): boolean {
  return open.value[cat] === true
}

function toggleGroup(cat: AchievementCategory): void {
  open.value = { ...open.value, [cat]: !isOpen(cat) }
  persist()
}

const allOpen = computed(() => CATS.every((c) => isOpen(c)))

function toggleAll(): void {
  const next = !allOpen.value
  const map: Record<string, boolean> = {}
  for (const c of CATS) map[c] = next
  open.value = map
  persist()
}

/** 组内排序：已获得在前（按日期倒序），未获得按进度倒序（越接近越靠前） */
function orderedItems(g: AchievementGroup): AchievementItem[] {
  return [...g.items].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1
    if (a.earned && b.earned) return b.unlockedAt.localeCompare(a.unlockedAt)
    if (a.silhouetted !== b.silhouetted) return a.silhouetted ? 1 : -1
    return b.percent - a.percent
  })
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

/* ---------- 正在接近（常驻，不折叠） ---------- */
.ach-closest {
  background: $primary-light;
  border: 1px solid $border-light;
  border-radius: $radius-md;
  padding: $space-3;

  .ach-closest-title {
    font-size: $font-2xs;
    font-weight: 800;
    color: $primary-text;
    letter-spacing: 0.4px;
    margin-bottom: $space-2;
  }

  .ach-closest-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: $space-2;
  }

  .ach-closest-item {
    display: flex;
    align-items: center;
    gap: $space-2;
  }

  .closest-icon {
    font-size: $font-base;
    line-height: 1;
    flex-shrink: 0;
  }

  .closest-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .closest-name {
    font-size: $font-xs;
    font-weight: 800;
    color: $text-main;
    line-height: $leading-tight;
  }

  .closest-hint {
    font-size: $font-2xs;
    color: $text-sub;
    line-height: $leading-normal;
  }

  .closest-pct {
    flex-shrink: 0;
    font-size: $font-2xs;
    font-weight: 800;
    color: $primary-text;
  }
}

/* ---------- 分组 ---------- */
.ach-groups {
  display: flex;
  flex-direction: column;
  gap: $space-2;
}

.ach-group {
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $card-bg;
  overflow: hidden;

  &.open {
    box-shadow: $shadow-xs;
  }

  &.all-done {
    border-color: $success-color;
  }
}

.ach-group-head {
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
  }

  .group-chevron {
    flex-shrink: 0;
    font-size: $font-xs;
    color: $text-muted;
    transition: transform $duration-fast $ease-standard;
    transform: rotate(-90deg);
  }
}

.ach-group.open .ach-group-head .group-chevron {
  transform: rotate(0deg);
}

.group-teaser {
  margin: 0;
  padding: 0 $space-4 $space-3;
  font-size: $font-2xs;
  color: $text-muted;
  line-height: $leading-normal;

  &.done {
    color: $success-text;
    font-weight: 700;
  }
}

.ach-list {
  list-style: none;
  margin: 0;
  padding: 0 $space-4 $space-4;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: $space-2;
}

@media (max-width: 640px) {
  .ach-list {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ach-overall-fill,
  .ach-group-head,
  .ach-group-head .group-chevron {
    transition: none;
  }
}
</style>
