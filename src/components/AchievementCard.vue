<template>
  <li class="ach-card" :class="{ earned: item.earned, silhouette: item.silhouetted }">
    <span class="ach-icon" aria-hidden="true">{{ item.icon }}</span>

    <div class="ach-body">
      <div class="ach-title">{{ item.title }}</div>
      <div class="ach-desc">{{ item.desc }}</div>

      <!-- 已获得：显示解锁日期，不再显示进度（进度只对"还没拿到"的有意义） -->
      <div v-if="item.earned" class="ach-meta">已获得 · {{ item.unlockedAt || '较早' }}</div>

      <!-- 未获得（非隐藏）：进度条 + 一句达成提示 -->
      <template v-else-if="!item.silhouetted">
        <div
          class="ach-progress"
          role="progressbar"
          :aria-valuenow="item.current"
          aria-valuemin="0"
          :aria-valuemax="item.target"
          :aria-label="`${item.title} 进度 ${item.current}/${item.target}`"
        >
          <div class="ach-progress-fill" :style="{ width: item.percent + '%' }"></div>
        </div>
        <div class="ach-hint">{{ item.hint }}</div>
      </template>

      <!-- 隐藏成就：达成前不泄露任何信息 -->
      <div v-else class="ach-hint">达成后揭晓</div>
    </div>

    <span v-if="item.earned" class="ach-seal" aria-hidden="true">✓</span>
  </li>
</template>

<script setup lang="ts">
// =====================================================================
// AchievementCard · 单枚成就卡（图鉴用）
// ---------------------------------------------------------------------
// 三种形态：
//   已获得   → 彩色 + 解锁日期 + 打勾印记
//   未获得   → 灰化 + 进度条 + 一句达成提示（"还差 3 个知识点"）
//   隐藏未解锁 → 剪影（🔒 + ？？？），**不泄露标题/描述/进度**
// 语义用 <li>，由父级 <ul> 提供列表语义。
// =====================================================================
import type { AchievementItem } from '@core/motivation/achievementMeta'

defineProps<{ item: AchievementItem }>()
</script>

<style scoped lang="scss">
.ach-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: $space-3;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  padding: $space-3 $space-4;
  transition: border-color $duration-fast $ease-standard,
    box-shadow $duration-fast $ease-standard,
    transform $duration-fast $ease-standard;

  .ach-icon {
    font-size: $font-xl;
    line-height: 1.1;
    flex-shrink: 0;
    filter: grayscale(0.75);
    opacity: 0.7;
  }

  .ach-body {
    min-width: 0;
    flex: 1;
  }

  .ach-title {
    font-size: $font-sm;
    font-weight: 800;
    color: $text-sub;
    line-height: $leading-tight;
  }

  .ach-desc {
    font-size: $font-2xs;
    color: $text-muted;
    margin-top: 2px;
    line-height: $leading-normal;
  }

  .ach-meta {
    margin-top: $space-1;
    font-size: $font-2xs;
    font-weight: 700;
    color: $warning-text;
  }

  .ach-progress {
    margin-top: $space-2;
    height: 6px;
    background: $bg-color-hover;
    border-radius: $radius-full;
    overflow: hidden;

    .ach-progress-fill {
      height: 100%;
      background: $gradient-primary;
      border-radius: $radius-full;
      transition: width $duration-base $ease-decelerate;
    }
  }

  .ach-hint {
    margin-top: $space-1;
    font-size: $font-2xs;
    font-weight: 600;
    color: $text-muted;
    line-height: $leading-normal;
  }

  /* 已获得：去掉灰化，加暖色边框与轻微阴影 */
  &.earned {
    border-color: $warning-color;
    box-shadow: $shadow-xs;

    .ach-icon {
      filter: none;
      opacity: 1;
    }
    .ach-title {
      color: $text-main;
    }
  }

  /* 隐藏成就剪影：虚线 + 更淡 */
  &.silhouette {
    background: $bg-color-hover;
    border-style: dashed;

    .ach-icon {
      filter: grayscale(1);
      opacity: 0.55;
    }
    .ach-title {
      letter-spacing: 2px;
      color: $text-muted;
    }
  }

  &.earned:hover {
    transform: translateY(-1px);
    box-shadow: $shadow-sm;
  }

  .ach-seal {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: $radius-full;
    background: $success-light;
    color: $success-text;
    font-size: $font-2xs;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ach-card,
  .ach-card .ach-progress .ach-progress-fill {
    transition: none;
  }
  .ach-card.earned:hover {
    transform: none;
  }
}
</style>
