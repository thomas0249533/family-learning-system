<template>
  <section class="wall-col" :aria-labelledby="headingId">
    <header class="wall-col-head">
      <h2 :id="headingId" class="wall-col-name">{{ name }}</h2>
      <!-- 中性鼓励语：叙事性、无数字、确定性（同数据同文案，推导见 core/motivation/familyWall.ts）。
           它先于徽章出现 —— 这一列的"语气"是"最近在怎样"，不是"拿到几个"。 -->
      <p class="wall-col-encourage">{{ encouragement }}</p>
    </header>

    <!-- 加载中：不给"0 / 28"这种像成绩单的中间态，家长会以为孩子的记录没了 -->
    <div v-if="loading" class="wall-col-loading" role="status" aria-live="polite">
      <span class="wall-col-skeleton" aria-hidden="true"></span>
      <span class="wall-col-skeleton wall-col-skeleton--short" aria-hidden="true"></span>
      <span class="wall-col-sr">正在读取 {{ name }} 的成就…</span>
    </div>

    <template v-else>
      <!-- 一枚都没解锁：给引导，不给零分成绩单 -->
      <EmptyState
        v-if="recent.length === 0"
        icon="🌱"
        :description="`${name}还没有解锁成就，做几道题就会亮起来。`"
      />

      <!-- 默认视野只有"最近解锁的几枚"（C7）。28 枚格子矩阵收进各自图鉴页：
           并排的完整矩阵 + 每组"x / y"计数是最强的比较诱饵。 -->
      <ul v-else class="wall-chips">
        <li
          v-for="item in recent"
          :key="item.id"
          class="wall-chip is-earned"
          :class="`tier-${item.tier}`"
          :aria-label="chipLabel(item)"
        >
          <span class="wall-chip-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="wall-chip-title">{{ item.title }}</span>
          <!-- 重复印记（B6）：紧凑形态不铺"第 N 次"整句，只给 ×N 角标，
               读屏文本里仍是完整的"第 N 次达成"（见 chipLabel） -->
          <span v-if="item.repeatCount >= 2" class="wall-chip-repeat" aria-hidden="true">
            ×{{ item.repeatCount }}
          </span>
        </li>
      </ul>

      <!-- 数字汇总默认折叠（C7）：标量并排 = 比较诱饵，家长一眼就会比出
           "老大 12 枚、老二才 5 枚"。想看数字可以点开，但只在本列内展开，
           不排成跨孩子的一行让大家比。连续天数也只住在这里 —— 默认视野里
           没有它；它在首页/孩子端继续活着，墙只是让家长按需核对。
           原生 <details>：无需 JS、键盘可达、读屏器能播报展开状态。 -->
      <details class="wall-col-details">
        <summary class="wall-col-summary">查看数字</summary>
        <div class="wall-col-numbers">
          <p class="wall-col-count">
            已获得 <b>{{ earnedCount }}</b> / {{ total }}
          </p>
          <p class="wall-col-num">{{ streakLine }}</p>
          <p class="wall-col-num">已掌握 {{ mastered ?? 0 }} 个知识点</p>
        </div>
      </details>
    </template>
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
 * ## 语言约束（AC-P2-8 → V1.6 · C7 收窄）
 * 这一列是并列展示，任何"谁多谁少"的暗示都会把家庭墙变成攀比工具。
 * C7 起默认视野进一步收窄，只保留**非标量**内容：
 *   - 最近解锁的几枚徽章 + 一句中性鼓励语（叙事、无数字、确定性）；
 *   - 已解锁数 / 连续天数 / 掌握数全部默认折叠（原生 `<details>`），
 *     家长点开才出现，且只在本列内 —— 不排成跨孩子的一行让大家比。
 * 旧红线一条不减：不排序、不显示名次、不显示"最高/领先/落后"、
 * 不显示百分比、不显示"平均"（有平均就有高于平均）。
 */
import { computed } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { AchievementItem } from '@core/motivation/achievementMeta'
import { encouragementLine, recentUnlocked } from '@core/motivation/familyWall'
import { EMPTY_STREAK, streakText, type StreakState } from '@core/motivation/streak'

const props = defineProps<{
  /** 档案显示名（家长可改，不用真名） */
  name: string
  /** 该档案的视图模型（由 `buildAchievementItems` 产出） */
  items: AchievementItem[]
  loading?: boolean
  /** 连续学习状态。展示口径与首页同源（`streakText`：断档归零）。
   *  只出现在"查看数字"折叠区内 —— 默认视野里没有它（C7）。 */
  streak?: StreakState
  /** 已掌握知识点数（去重口径，同家长页/报告）。同样只进折叠区。 */
  mastered?: number
}>()

/** 标题的唯一 id：同一页多列，aria-labelledby 不能指向重复 id */
const headingId = computed(() => `wall-col-${props.name}`)

/** 默认视野：最近解锁的几枚（纯函数在 core，测试在 tests/family-wall.test.ts） */
const recent = computed(() => recentUnlocked(props.items))

const encouragement = computed(() => encouragementLine(props.items))

const earnedCount = computed(() => props.items.filter((i) => i.earned).length)
const total = computed(() => props.items.length)

const streakLine = computed(() => streakText(props.streak ?? EMPTY_STREAK))

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

/* 中性鼓励语：副标字号、弱化色 —— 它是"语气"，不是指标 */
.wall-col-encourage {
  margin: $space-1 0 0;
  font-size: $font-xs;
  color: $text-sub;
  line-height: $leading-relaxed;
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

/* ---- 数字汇总折叠区（C7）----
   默认收起：标量并排是最强的比较诱饵。原生 <details> 自带键盘可达与
   展开态播报；`margin-top: auto` 让各列的摘要行贴在列底，视觉成排的是
   "查看数字"这个动作，不是任何数字。 */
.wall-col-details {
  margin-top: auto;
  padding-top: $space-3;
  border-top: 1px solid $border-color;
}

.wall-col-summary {
  font-size: $font-xs;
  font-weight: 600;
  color: $text-sub;
  cursor: pointer;
  /* 焦点环不必在这里再写一遍：components.scss 已有全局 :focus-visible */
}

.wall-col-numbers {
  display: flex;
  flex-direction: column;
  gap: $space-1;
  margin-top: $space-2;
}

.wall-col-count {
  margin: 0;
  font-size: $font-xs;
  color: $text-muted;

  b {
    font-size: $font-sm;
    color: $primary-text;
  }
}

.wall-col-num {
  margin: 0;
  font-size: $font-xs;
  color: $text-muted;
}
</style>
