<template>
  <section class="wall-col" :aria-labelledby="headingId">
    <header class="wall-col-head">
      <h2 :id="headingId" class="wall-col-name">{{ name }}</h2>
      <!-- 只报"已获得几枚"。**不出现百分比、不出现名次、不出现"最"字** ——
           家庭墙是给家长看"每个孩子走到哪了"，不是记分牌（AC-P2-8）。 -->
      <p class="wall-col-count">
        已获得 <b>{{ earnedCount }}</b> / {{ total }}
      </p>
    </header>

    <!-- 加载中：不给"0 / 28"这种像成绩单的中间态，家长会以为孩子的记录没了 -->
    <div v-if="loading" class="wall-col-loading" role="status" aria-live="polite">
      <span class="wall-col-skeleton" aria-hidden="true"></span>
      <span class="wall-col-skeleton wall-col-skeleton--short" aria-hidden="true"></span>
      <span class="wall-col-sr">正在读取 {{ name }} 的成就…</span>
    </div>

    <!-- 一枚都没解锁：给引导，不给零分成绩单 -->
    <EmptyState
      v-else-if="earnedCount === 0"
      icon="🌱"
      :description="`${name}还没有解锁成就，做几道题就会亮起来。`"
    />

    <div v-else class="wall-col-groups">
      <div v-for="group in groups" :key="group.category" class="wall-group">
        <h3 class="wall-group-title">
          <span class="wall-group-icon" aria-hidden="true">{{ group.icon }}</span>
          {{ group.label }}
          <span class="wall-group-count">{{ group.earned }} / {{ group.items.length }}</span>
        </h3>
        <ul class="wall-chips">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="wall-chip"
            :class="[{ 'is-earned': item.earned, 'is-silhouette': item.silhouetted }, `tier-${item.tier}`]"
            :aria-label="chipLabel(item)"
          >
            <span class="wall-chip-icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="wall-chip-title">{{ item.title }}</span>
            <!-- 重复印记（B6）：紧凑形态不铺"第 N 次"整句，只给 ×N 角标，
                 读屏文本里仍是完整的"第 N 次达成"（见 chipLabel） -->
            <span v-if="item.earned && item.repeatCount >= 2" class="wall-chip-repeat" aria-hidden="true">
              ×{{ item.repeatCount }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * AchievementWallColumn · 家庭墙上"一个孩子那一列"
 *
 * ## 为什么不用 `AchievementCard`
 * 那张卡是"一枚徽章一个故事"（证据、日期、连环、进度条、详情弹层入口）。
 * 墙上要一屏并列 4 个孩子，用大卡会变成 4 个长页面互相滚动 —— 家长反而看不出对比。
 * 所以墙用紧凑格子，**但数据一律来自 `buildAchievementItems`**：
 * 进度算法只有一份，墙上和图鉴里同一枚卡的数字永远一致。
 *
 * ## 语言约束（AC-P2-8）
 * 这一列是并列展示，任何"谁多谁少"的暗示都会把家庭墙变成攀比工具。
 * 所以：**只报自己的已获得数与总数**，不显示百分比、不显示名次、不显示"最高/领先"。
 * 连"平均"也不显示 —— 有平均就有高于平均。
 */
import { computed } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { CATEGORY_META, CATEGORY_ORDER, type AchievementItem } from '@core/motivation/achievementMeta'

const props = defineProps<{
  /** 档案显示名（家长可改，不用真名） */
  name: string
  /** 该档案的视图模型（由 `buildAchievementItems` 产出） */
  items: AchievementItem[]
  loading?: boolean
}>()

/** 标题的唯一 id：同一页多列，aria-labelledby 不能指向重复 id */
const headingId = computed(() => `wall-col-${props.name}`)

const earnedCount = computed(() => props.items.filter((i) => i.earned).length)
const total = computed(() => props.items.length)

const groups = computed(() =>
  CATEGORY_ORDER.map((category) => {
    const items = props.items.filter((i) => i.category === category)
    return {
      category,
      items,
      earned: items.filter((i) => i.earned).length,
      label: CATEGORY_META[category].label,
      icon: CATEGORY_META[category].icon,
    }
  }).filter((g) => g.items.length > 0),
)

/**
 * 格子的读屏文本。
 *
 * 视觉上只有"图标 + 标题 + 灰化"，读屏却必须知道"有没有拿到、第几次" ——
 * 否则这一列对读屏用户就是 28 个一模一样的名字。
 */
function chipLabel(item: AchievementItem): string {
  if (item.silhouetted) return `${item.title}，未解锁`
  const state = item.earned ? `已获得，${item.unlockedAt || '较早'}` : `未获得，${item.hint}`
  const repeat = item.earned && item.repeatCount >= 2 ? `，第 ${item.repeatCount} 次达成` : ''
  return `${item.title}，${state}${repeat}`
}
</script>

<style scoped lang="scss">
.wall-col {
  display: flex;
  flex-direction: column;
  min-width: 320px;
  max-width: 420px;
  padding: $space-4;
  background: $bg-color;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
}

.wall-col-head {
  margin-bottom: $space-3;
}

.wall-col-name {
  margin: 0;
  font-size: $font-md;
  font-weight: 700;
  color: $text-main;
  /* 名字过长不撑破列宽 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wall-col-count {
  margin: $space-1 0 0;
  font-size: $font-xs;
  color: $text-muted;

  b {
    font-size: $font-sm;
    color: $primary-text;
  }
}

.wall-col-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.wall-col-loading {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: $space-2;
}

/* 骨架：只是"正在读"，不给任何数字 —— 先闪一个 0 再跳到 12，家长会以为记录丢了 */
.wall-col-skeleton {
  height: 12px;
  border-radius: $radius-sm;
  background: $bg-color-hover;
  animation: wall-pulse 1.2s ease-in-out infinite;

  &--short {
    width: 60%;
  }
}

@keyframes wall-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.wall-col-groups {
  display: flex;
  flex-direction: column;
  gap: $space-3;
}

.wall-group-title {
  display: flex;
  align-items: center;
  gap: $space-1;
  margin: 0 0 $space-2;
  font-size: $font-xs;
  font-weight: 600;
  color: $text-muted;
}

.wall-group-count {
  margin-left: auto;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.wall-chips {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: $space-2;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wall-chip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: $space-2 $space-1;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-color-hover;
  /* 未获得：整体压暗，但**标题仍可读** —— 家庭墙不是图鉴，家长需要知道"还有哪些没拿" */
  opacity: 0.55;

  &.is-earned {
    opacity: 1;
    background: $bg-color;
  }

  /* 层级用边框粗细冗余表达（去色后仍能分辨，AC-P2-10 的墙侧同源）。
     只有 advanced / rare 两档加粗：common 是大多数，给它加粗等于没有层级。 */
  &.tier-advanced {
    border-width: 2px;
  }

  &.tier-rare {
    border-width: 2px;
    border-color: $primary-color;
  }

  &.is-silhouette {
    opacity: 0.4;
  }
}

.wall-chip-icon {
  font-size: $font-md;
  line-height: 1;
}

.wall-chip-title {
  font-size: $font-2xs;
  color: $text-main;
  text-align: center;
  line-height: $leading-tight;
  /* 两行截断：标题长也不破坏 3 列网格的等高 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wall-chip-repeat {
  position: absolute;
  top: 2px;
  right: 3px;
  font-size: $font-2xs;
  font-weight: 700;
  color: $warning-text;
}
</style>
