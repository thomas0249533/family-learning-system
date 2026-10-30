<template>
  <div class="page-container">
    <AppCard class="card">
      <template #header>
        <div class="header-row">
          <span>📄 学习报告</span>
          <div class="header-actions">
            <AppButton size="small" @click="loadData" :loading="loading">🔄 刷新</AppButton>
            <AppButton type="primary" size="small" @click="exportPDF" :disabled="loading || !report">
              📥 导出 PDF
            </AppButton>
          </div>
        </div>
      </template>

      <div v-if="loading" class="loading">正在生成报告...</div>

      <div v-else-if="report" ref="reportRef" class="report-body">
        <!-- 报告头部 -->
        <div class="report-header">
          <h1 class="report-title">📘 家庭学习报告</h1>
          <div class="report-sub">{{ report.rangeLabel }}</div>
          <div class="report-date">生成于 {{ formatDate(report.generatedAt) }}</div>
        </div>

        <!-- 核心指标 · 成绩英雄横幅（借鉴渐变大数字 + 信息胶囊层级） -->
        <div class="report-hero">
          <div class="report-hero__score">
            <!-- V2.9 · 借鉴参考图3 的「80/100 圆环」：掌握率弧形进度，
                 track/arc 都走 on-strong 半透明体系（横幅渐变底上的高对比白），不引第二色调 -->
            <div class="report-hero__ring">
              <svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">
                <circle class="ring-track" cx="60" cy="60" r="52" />
                <circle
                  class="ring-arc"
                  cx="60"
                  cy="60"
                  r="52"
                  :stroke-dasharray="RING_CIRCUMFERENCE"
                  :stroke-dashoffset="ringOffset"
                />
              </svg>
              <div class="report-hero__value">
                {{ report.stats.masteryRate }}<span class="report-hero__unit">%</span>
              </div>
            </div>
            <div class="report-hero__grade">
              {{ masteryGrade.emoji }} {{ masteryGrade.label }}
            </div>
            <div class="report-hero__total">
              已掌握 {{ report.stats.mastered }} / {{ report.stats.totalKnowledgePoints }} 个知识点
            </div>
          </div>
          <div class="report-hero__meta">
            <div class="report-hero__pill"><span>📖</span>学习中 {{ report.stats.learning }}</div>
            <div class="report-hero__pill"><span>🔁</span>需复习 {{ report.stats.needReview }}</div>
            <div class="report-hero__pill"><span>⏱️</span>累计 {{ report.stats.totalStudyMinutes }} 分钟</div>
            <div class="report-hero__pill"><span>🔥</span>连续 {{ report.stats.continuousDays }} 天</div>
          </div>
        </div>

        <!-- V2.9 · 学习小贴士：模板化行动建议（借鉴参考图3「AI 智能点评」的零 AI 版） -->
        <div v-if="report.studyTip" class="study-tip" role="note">
          <span class="study-tip__icon" aria-hidden="true">💡</span>
          <div class="study-tip__body">
            <div class="study-tip__title">学习小贴士</div>
            <p class="study-tip__text">{{ report.studyTip }}</p>
          </div>
        </div>

        <!-- 学科分布 -->
        <div class="section" v-if="report.subjectBreakdown.length > 0">
          <SectionTitle title="📚 学科分布" accent />
          <div class="subject-list">
            <div v-for="s in report.subjectBreakdown" :key="s.subject" class="subject-row">
              <div class="subject-name">{{ s.label }}</div>
              <ProgressBar :value="s.masteryRate" />
              <div class="subject-stats">{{ s.mastered }} / {{ s.total }}（{{ s.masteryRate }}%）</div>
            </div>
          </div>
        </div>

        <!-- P3 · 掌握热力图 / 学习日历 / 准确率趋势（纯前端可视化，复用现有掌握度与每日统计） -->
        <div class="section">
          <LearningVisuals />
        </div>

        <!-- 错题统计 -->
        <div class="section">
          <SectionTitle title="📕 错题情况" accent />
          <div class="mistake-summary">
            <StatCard :value="report.mistakeStats.total" label="错题总数" />
            <StatCard tone="danger" :value="report.mistakeStats.unmastered" label="未掌握" />
            <StatCard tone="warning" :value="report.mistakeStats.partial" label="部分掌握" />
          </div>
          <div v-if="report.mistakeStats.topKnowledgePoints.length > 0" class="top-kps">
            <div class="top-kps-label">高频错题知识点：</div>
            <div v-for="(kp, i) in report.mistakeStats.topKnowledgePoints" :key="i" class="top-kp-row">
              <span class="top-kp-rank">{{ i + 1 }}.</span>
              <span class="top-kp-title">{{ kp.title }}</span>
              <span class="top-kp-count">错 {{ kp.count }} 次</span>
            </div>
          </div>
        </div>

        <!-- 复习安排 -->
        <div class="section">
          <SectionTitle title="🔄 复习安排" accent />
          <div class="review-row">
            <StatCard tone="danger" :value="report.reviewStats.dueToday" label="今天待复习" />
            <StatCard tone="warning" :value="report.reviewStats.dueThisWeek" label="本周待复习" />
          </div>
        </div>

        <!-- 近 7 天学习 -->
        <div class="section">
          <SectionTitle title="📅 近 7 天学习" accent />
          <div class="week-chart">
            <div v-for="d in report.recent7Days" :key="d.date" class="day-col">
              <div class="day-bar-wrap">
                <div
                  class="day-bar"
                  :style="{ height: barHeight(d.count) + '%' }"
                  :class="{ active: d.count > 0 }"
                ></div>
              </div>
              <div class="day-count" v-if="d.count > 0">{{ d.count }}</div>
              <div class="day-label">{{ dayLabel(d.date) }}</div>
            </div>
          </div>
        </div>

        <!-- 页脚 -->
        <div class="report-footer">
          —— 家庭学习系统 · 让学习更简单 ——
        </div>
      </div>
    </AppCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import SectionTitle from '@/components/ui/SectionTitle.vue'
import StatCard from '@/components/ui/StatCard.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import LearningVisuals from '@/components/LearningVisuals.vue'
import { generateReportData, type ReportData } from '@core/report/reportGenerator'
import { exportReportAsPDF } from '@core/report/pdfExporter'
import { localDayKey } from '@core/motivation/streak'

const message = useMessage()
const loading = ref(true)
const report = ref<ReportData | null>(null)
const reportRef = ref<HTMLElement | null>(null)

async function loadData() {
  loading.value = true
  try {
    report.value = await generateReportData()
  } catch (e: any) {
    message.error('生成报告失败：' + e.message)
  } finally {
    loading.value = false
  }
}

async function exportPDF() {
  if (!reportRef.value) return
  try {
    await nextTick()
    await exportReportAsPDF(reportRef.value, `学习报告-${localDayKey(new Date())}`)
    message.success('PDF 已导出')
  } catch (e: any) {
    message.error('导出失败：' + e.message)
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** V2.9 · 掌握率圆环（借鉴参考图3）：弧长 = 周长 × 百分比，从 12 点方向顺时针填充。 */
const RING_RADIUS = 52
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const ringOffset = computed(() => {
  const rate = Math.min(100, Math.max(0, report.value?.stats.masteryRate ?? 0))
  return RING_CIRCUMFERENCE * (1 - rate / 100)
})

/** 掌握率 → 等级评语（英雄横幅展示）。 */
const masteryGrade = computed(() => {
  const r = report.value?.stats.masteryRate ?? 0
  if (r >= 90) return { emoji: '🏆', label: '卓越' }
  if (r >= 75) return { emoji: '🌟', label: '优秀' }
  if (r >= 60) return { emoji: '💪', label: '良好' }
  if (r >= 40) return { emoji: '🚀', label: '继续加油' }
  return { emoji: '🌱', label: '稳步启程' }
})

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  return labels[d.getDay()]
}

function barHeight(count: number): number {
  const max = Math.max(...(report.value?.recent7Days.map(d => d.count) ?? [1]), 1)
  return Math.max((count / max) * 100, count > 0 ? 8 : 0)
}

onMounted(loadData)
</script>

<style scoped lang="scss">
.page-container { padding: 16px; }
/* `.card` 的圆角/阴影已由 AppCard 基元统一提供（radius-lg + shadow-sm）。 */

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header-actions { display: flex; gap: 8px; }

.loading { text-align: center; color: $text-sub; padding: 40px; }

.report-body {
  background: $card-bg;
  padding: 24px;
  border-radius: 12px;
}

.report-header {
  text-align: center;
  padding-bottom: 20px;
  border-bottom: 1px solid $border-light;
  margin-bottom: 24px;

  .report-title {
    font-size: 24px;
    font-weight: 800;
    color: $text-main;
    margin-bottom: 8px;
  }
  .report-sub { font-size: 14px; color: $text-sub; }
  .report-date { font-size: 12px; color: $text-sub; margin-top: 4px; }
}

/* ---- 成绩英雄横幅：渐变底 + 大数字 + 信息胶囊（对标参考报告首屏层级）---- */
.report-hero {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $space-6;
  background: $gradient-primary;
  border-radius: $radius-lg;
  padding: 28px 32px;
  margin-bottom: 24px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(var(--primary-rgb), 0.25);

  /* 右上大圆 + 左下小圆：克制的渐变装饰（与首页欢迎横幅同一语言） */
  &::before {
    content: '';
    position: absolute;
    right: -48px;
    top: -48px;
    width: 200px;
    height: 200px;
    background: rgba(var(--on-strong-rgb), 0.1);
    border-radius: 50%;
  }
  &::after {
    content: '';
    position: absolute;
    left: 32%;
    bottom: -72px;
    width: 150px;
    height: 150px;
    background: rgba(var(--on-strong-rgb), 0.08);
    border-radius: 50%;
  }

  .report-hero__score { position: relative; z-index: 1; color: $on-strong; }

  /* V2.9 · 掌握率圆环：数字嵌在环心，弧从 12 点方向顺时针填充。
     track/arc 都走 on-strong 半透明白 —— 横幅渐变底上的单一高对比色，
     不在状态色里再挑色（环本身已经是进度语义）。 */
  .report-hero__ring {
    position: relative;
    width: 148px;
    height: 148px;
    display: flex;
    align-items: center;
    justify-content: center;

    .ring-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);

      circle {
        fill: none;
        stroke-width: 9;
      }
      .ring-track {
        stroke: rgba(var(--on-strong-rgb), 0.2);
      }
      .ring-arc {
        stroke: $on-strong;
        stroke-linecap: round;
        transition: stroke-dashoffset var(--duration-slower) var(--ease-standard);
      }
    }
  }

  .report-hero__value {
    /* 48px：收进 148px 圆环内（§8.4 不变量 7 常量尺寸）。 */
    font-size: 48px;
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.02em;

    .report-hero__unit { font-size: 24px; font-weight: 700; margin-left: 2px; opacity: 0.9; }
  }
  .report-hero__grade {
    display: inline-flex;
    align-items: center;
    margin-top: $space-3;
    padding: 4px 14px;
    border-radius: $radius-full;
    background: rgba(var(--on-strong-rgb), 0.18);
    font-size: $font-sm;
    font-weight: 700;
  }
  .report-hero__total {
    margin-top: $space-2;
    font-size: $font-xs;
    font-weight: 500;
    color: rgba(var(--on-strong-rgb), 0.85);
  }

  .report-hero__meta {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(2, minmax(160px, auto));
    gap: $space-3;
  }
  .report-hero__pill {
    display: flex;
    align-items: center;
    gap: $space-2;
    padding: 10px 16px;
    border-radius: $radius-md;
    background: rgba(var(--on-strong-rgb), 0.14);
    border: 1px solid rgba(var(--on-strong-rgb), 0.22);
    color: $on-strong;
    font-size: $font-sm;
    font-weight: 600;
    white-space: nowrap;
  }
}

@media (max-width: 760px) {
  .report-hero {
    flex-direction: column;
    align-items: flex-start;
    padding: 24px;

    .report-hero__meta { grid-template-columns: 1fr; width: 100%; }
  }
}

/* V2.9 · 学习小贴士卡：主色软底、左侧图标圆块，与英雄横幅同一份呼吸感 */
.study-tip {
  display: flex;
  align-items: flex-start;
  gap: $space-3;
  padding: $space-4 $space-5;
  margin-bottom: 24px;
  background: $primary-light;
  border-radius: $radius-lg;

  .study-tip__icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    background: var(--card-bg);
    border-radius: $radius-full;
  }

  .study-tip__title {
    font-size: $font-sm;
    font-weight: 800;
    color: $primary-text;
    margin-bottom: 2px;
  }

  .study-tip__text {
    margin: 0;
    font-size: $font-sm;
    line-height: 1.7;
    color: $text-main;
  }
}

.section {
  margin-bottom: 24px;

  /* 保留 Report 原有的「标题—内容」12px 间距（SectionTitle 基元默认 margin: 0）。 */
  .section-title {
    margin-bottom: 12px;
  }
}

.subject-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.subject-row {
  .subject-name {
    font-size: 14px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 6px;
  }
  .subject-stats { font-size: 12px; color: $text-sub; margin-top: 4px; }
}

.mistake-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
}

.top-kps {
  background: $surface-2;
  padding: 12px 14px;
  border-radius: 8px;

  .top-kps-label {
    font-size: 12px;
    color: $text-sub;
    margin-bottom: 8px;
    font-weight: 700;
  }
  .top-kp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 13px;

    .top-kp-rank { color: $text-sub; font-weight: 700; width: 20px; }
    .top-kp-title { flex: 1; color: $text-main; }
    .top-kp-count { color: $danger-text; font-weight: 700; }
  }
}

.review-row {
  display: flex;
  gap: 16px;

  /* StatCard 基元自身无 flex:1；此处补等宽铺满（复刻原 .review-item { flex: 1 }）。 */
  > * { flex: 1; }
}

.week-chart {
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  height: 140px;
  padding: 12px 0;

  .day-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    height: 100%;
    justify-content: flex-end;

    .day-bar-wrap {
      width: 60%;
      height: 90px;
      display: flex;
      align-items: flex-end;

      .day-bar {
        width: 100%;
        background: $surface-2;
        border-radius: $radius-xs $radius-xs 2px 2px;
        transition: height 0.4s;

        &.active {
          background: $gradient-primary;
          box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.28);

          &:hover { filter: brightness(1.06); }
        }
      }
    }
    .day-count {
      font-size: 11px;
      color: $text-main;
      font-weight: 700;
      margin-top: 2px;
    }
    .day-label {
      font-size: 11px;
      color: $text-sub;
      margin-top: 2px;
    }
  }
}

.report-footer {
  text-align: center;
  font-size: 12px;
  color: $text-sub;
  padding-top: 20px;
  border-top: 1px dashed $border-color;
  margin-top: 24px;
}
</style>