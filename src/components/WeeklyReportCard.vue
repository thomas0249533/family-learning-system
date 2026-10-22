<template>
  <!--
    E3 · 家长周报卡片（摘要版式，行数封顶）
    ------------------------------------------------------------------
    设计约束（都来自"这张卡会被截图发给家人"这个用途）：
      1. **行数封顶**：学科行 ≤4、高频错题 ≤5（数据侧 weeklyCard.ts 已截断，
         导出侧 weeklyCardExporter.ts 还有 DOM 计数防线）—— 截图源必须
         尺寸有界，这是 OOM 预防的一部分；
      2. **配色全走 token**：深浅主题都靠 CSS 变量切换（`npm run check:hex`
         会拦字面色值），截图固定浅色输出由导出侧临时摘 dark-mode 保证；
      3. **日期本地口径**：卡片上的生成日期是本地日键，不用 UTC；
      4. 组件零计算：所有数字（含柱高百分比、星期标签）都由
         `weeklyCard.ts` 装配好，这里只画 —— 口径不许出现第二套。
  -->
  <div class="weekly-card">
    <!-- 卡头：标题 + 档案 + 时间范围 -->
    <header class="weekly-card__head">
      <div class="weekly-card__title">学习周报</div>
      <div class="weekly-card__meta">
        <span class="weekly-card__profile">👧 {{ data.profileName }}</span>
        <span class="weekly-card__range">{{ data.rangeLabel }} · {{ data.generatedAt }}</span>
      </div>
    </header>

    <!-- 核心数字区（四态同屏：掌握 / 掌握率 / 连续 / 时长） -->
    <div class="weekly-card__stats">
      <div class="weekly-stat">
        <div class="weekly-stat__value">{{ data.stats.mastered }}<span class="weekly-stat__unit">/{{ data.stats.totalKnowledgePoints }}</span></div>
        <div class="weekly-stat__label">已掌握知识点</div>
      </div>
      <div class="weekly-stat">
        <div class="weekly-stat__value">{{ data.stats.masteryRate }}<span class="weekly-stat__unit">%</span></div>
        <div class="weekly-stat__label">掌握率</div>
      </div>
      <div class="weekly-stat">
        <div class="weekly-stat__value">{{ data.stats.continuousDays }}<span class="weekly-stat__unit">天</span></div>
        <div class="weekly-stat__label">连续学习</div>
      </div>
      <div class="weekly-stat">
        <div class="weekly-stat__value">{{ data.stats.totalStudyMinutes }}<span class="weekly-stat__unit">分钟</span></div>
        <div class="weekly-stat__label">累计时长</div>
      </div>
    </div>

    <!-- 学科掌握（≤4 行） -->
    <section v-if="data.subjects.length > 0" class="weekly-card__section">
      <div class="weekly-card__label">学科掌握</div>
      <div v-for="s in data.subjects" :key="s.subject" class="weekly-subject-item">
        <span class="weekly-subject-name">{{ s.label }}</span>
        <span class="weekly-subject-count">{{ s.mastered }} / {{ s.total }}</span>
        <div class="weekly-subject-bar">
          <div class="weekly-subject-fill" :style="{ width: s.masteryRate + '%' }" />
        </div>
      </div>
    </section>

    <!-- 近 7 天学习（恒定 7 根柱） -->
    <section class="weekly-card__section">
      <div class="weekly-card__label">近 7 天学习</div>
      <div class="weekly-week">
        <div v-for="d in data.days" :key="d.date" class="weekly-day">
          <div class="weekly-day-bar-wrap">
            <div
              class="weekly-day-bar"
              :class="{ active: d.count > 0 }"
              :style="{ height: d.heightPct + '%' }"
            />
          </div>
          <div v-if="d.count > 0" class="weekly-day-count">{{ d.count }}</div>
          <div v-else class="weekly-day-count weekly-day-count--empty">&nbsp;</div>
          <div class="weekly-day-label">{{ d.label }}</div>
        </div>
      </div>
      <div class="weekly-week-total">本周共学习 <b>{{ data.weekTotal }}</b> 个知识点</div>
    </section>

    <!-- 高频错题 Top N（≤5 行；无数据整段不画） -->
    <section v-if="data.topMistakes.length > 0" class="weekly-card__section">
      <div class="weekly-card__label">高频错题 Top {{ data.topMistakes.length }}</div>
      <div v-for="(t, i) in data.topMistakes" :key="t.kpId" class="weekly-top-item">
        <span class="weekly-top-rank">{{ i + 1 }}</span>
        <span class="weekly-top-title" :title="t.title">{{ t.title }}</span>
        <span class="weekly-top-count">错 {{ t.count }} 次</span>
      </div>
    </section>

    <!-- 卡脚：成就 + 错题存量 + 一句原则性文案 -->
    <footer class="weekly-card__foot">
      <div class="weekly-card__ach">🏅 成就 {{ data.achievements.unlocked }} / {{ data.achievements.total }}</div>
      <div class="weekly-card__motto">成就只记录自己做过的事，不和别人比。</div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import type { WeeklyCardData } from '@core/report/weeklyCard'

defineProps<{ data: WeeklyCardData }>()
</script>

<style scoped lang="scss">
/* ========== 卡片容器：截图源，宽度必须有界（scale:2 后约 1120px，PNG 尺寸可预期） ========== */
.weekly-card {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ========== 卡头 ========== */
.weekly-card__head {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .weekly-card__title {
    font-size: $font-xl;
    font-weight: 800;
    color: $text-main;
    line-height: $leading-tight;
  }
  .weekly-card__meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    font-size: $font-xs;
    color: $text-sub;
    font-weight: 600;
  }
  .weekly-card__range {
    color: $text-muted;
    font-variant-numeric: tabular-nums;
  }
}

/* ========== 核心数字区：四张等宽小卡 ========== */
.weekly-card__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;

  @media (max-width: 480px) { grid-template-columns: repeat(2, 1fr); }
}

.weekly-stat {
  text-align: center;
  padding: 10px 4px;
  background: $bg-color-hover;
  border-radius: $radius-md;

  .weekly-stat__value {
    font-size: $font-xl;
    font-weight: 800;
    color: $primary-text;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .weekly-stat__unit {
    font-size: $font-xs;
    font-weight: 700;
    color: $text-sub;
    margin-left: 1px;
  }
  .weekly-stat__label {
    font-size: $font-2xs;
    color: $text-sub;
    margin-top: 4px;
    font-weight: 600;
  }
}

/* ========== 小节 ========== */
.weekly-card__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.weekly-card__label {
  font-size: $font-xs;
  font-weight: 800;
  color: $text-muted;
  letter-spacing: 0.5px;
}

/* ========== 学科行（≤4） ========== */
.weekly-subject-item {
  display: grid;
  grid-template-columns: 3em 4.5em 1fr;
  align-items: center;
  gap: 10px;

  .weekly-subject-name {
    font-size: $font-sm;
    font-weight: 700;
    color: $text-main;
  }
  .weekly-subject-count {
    font-size: $font-xs;
    color: $text-sub;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
}

.weekly-subject-bar {
  height: 8px;
  background: $bg-color-hover;
  border-radius: $radius-full;
  overflow: hidden;

  .weekly-subject-fill {
    height: 100%;
    background: $gradient-primary;
    border-radius: $radius-full;
  }
}

/* ========== 近 7 天柱状（恒定 7 根） ========== */
.weekly-week {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 4px;
  height: 96px;
  padding: 0 4px;
}

.weekly-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  height: 100%;
  justify-content: flex-end;
  gap: 2px;

  .weekly-day-bar-wrap {
    width: 60%;
    height: 64px;
    display: flex;
    align-items: flex-end;
  }
  .weekly-day-bar {
    width: 100%;
    background: $bg-color-hover;
    border-radius: 4px 4px 0 0;
    transition: height 0.4s;

    &.active { background: $gradient-primary; }
  }
  .weekly-day-count {
    font-size: 10px;
    color: $primary-text;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .weekly-day-label {
    font-size: 10px;
    color: $text-sub;
    font-weight: 600;
  }
}

.weekly-week-total {
  font-size: $font-xs;
  color: $text-sub;
  text-align: center;
  padding-top: 8px;
  border-top: 1px dashed $border-light;

  b {
    color: $primary-text;
    font-size: $font-base;
    margin: 0 3px;
  }
}

/* ========== 高频错题 Top（≤5） ========== */
.weekly-top-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
  border-bottom: 1px dashed $border-light;

  &:last-child { border-bottom: none; }

  .weekly-top-rank {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $bg-color-hover;
    color: $text-sub;
    font-weight: 800;
    font-size: $font-xs;
    flex-shrink: 0;
  }
  .weekly-top-title {
    flex: 1;
    min-width: 0;
    font-size: $font-sm;
    font-weight: 600;
    color: $text-main;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .weekly-top-count {
    font-size: $font-xs;
    color: $danger-text;
    font-weight: 700;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
}

/* ========== 卡脚 ========== */
.weekly-card__foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid $border-color;

  .weekly-card__ach {
    font-size: $font-sm;
    font-weight: 800;
    color: $text-main;
    font-variant-numeric: tabular-nums;
  }
  .weekly-card__motto {
    font-size: $font-2xs;
    color: $text-muted;
  }
}
</style>
