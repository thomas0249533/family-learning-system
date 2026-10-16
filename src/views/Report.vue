<template>
  <div class="page-container">
    <n-card class="card">
      <template #header>
        <div class="header-row">
          <span>📄 学习报告</span>
          <div class="header-actions">
            <n-button size="small" @click="loadData" :loading="loading">🔄 刷新</n-button>
            <n-button type="primary" size="small" @click="exportPDF" :disabled="loading || !report">
              📥 导出 PDF
            </n-button>
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

        <!-- 核心指标 -->
        <div class="section">
          <h2 class="section-title">📊 核心指标</h2>
          <div class="stat-grid">
            <div class="stat-box primary">
              <div class="stat-value">{{ report.stats.masteryRate }}%</div>
              <div class="stat-label">整体掌握率</div>
            </div>
            <div class="stat-box success">
              <div class="stat-value">{{ report.stats.mastered }}</div>
              <div class="stat-label">已掌握</div>
            </div>
            <div class="stat-box warning">
              <div class="stat-value">{{ report.stats.learning }}</div>
              <div class="stat-label">学习中</div>
            </div>
            <div class="stat-box danger">
              <div class="stat-value">{{ report.stats.needReview }}</div>
              <div class="stat-label">需复习</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">{{ report.stats.totalStudyMinutes }}</div>
              <div class="stat-label">学习分钟</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">{{ report.stats.continuousDays }}</div>
              <div class="stat-label">连续天数</div>
            </div>
          </div>
        </div>

        <!-- 学科分布 -->
        <div class="section" v-if="report.subjectBreakdown.length > 0">
          <h2 class="section-title">📚 学科分布</h2>
          <div class="subject-list">
            <div v-for="s in report.subjectBreakdown" :key="s.subject" class="subject-row">
              <div class="subject-name">{{ s.label }}</div>
              <div class="subject-bar">
                <div class="subject-bar-fill" :style="{ width: s.masteryRate + '%' }"></div>
              </div>
              <div class="subject-stats">{{ s.mastered }} / {{ s.total }}（{{ s.masteryRate }}%）</div>
            </div>
          </div>
        </div>

        <!-- 错题统计 -->
        <div class="section">
          <h2 class="section-title">📕 错题情况</h2>
          <div class="mistake-summary">
            <div class="mistake-item">
              <span class="mistake-label">错题总数</span>
              <span class="mistake-value">{{ report.mistakeStats.total }}</span>
            </div>
            <div class="mistake-item">
              <span class="mistake-label">未掌握</span>
              <span class="mistake-value danger">{{ report.mistakeStats.unmastered }}</span>
            </div>
            <div class="mistake-item">
              <span class="mistake-label">部分掌握</span>
              <span class="mistake-value warning">{{ report.mistakeStats.partial }}</span>
            </div>
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
          <h2 class="section-title">🔄 复习安排</h2>
          <div class="review-row">
            <div class="review-item">
              <div class="review-num danger">{{ report.reviewStats.dueToday }}</div>
              <div class="review-label">今天待复习</div>
            </div>
            <div class="review-item">
              <div class="review-num warning">{{ report.reviewStats.dueThisWeek }}</div>
              <div class="review-label">本周待复习</div>
            </div>
          </div>
        </div>

        <!-- 近 7 天学习 -->
        <div class="section">
          <h2 class="section-title">📅 近 7 天学习</h2>
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
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { NCard, NButton, useMessage } from 'naive-ui'
import { generateReportData, type ReportData } from '@core/report/reportGenerator'
import { exportReportAsPDF } from '@core/report/pdfExporter'

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
    await exportReportAsPDF(reportRef.value, `学习报告-${new Date().toISOString().slice(0, 10)}`)
    message.success('PDF 已导出')
  } catch (e: any) {
    message.error('导出失败：' + e.message)
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
.card { border-radius: $radius-lg; box-shadow: $shadow-sm; }

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
  border-bottom: 2px solid $border-color;
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

.section {
  margin-bottom: 24px;

  .section-title {
    font-size: 16px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 12px;
    padding-left: 8px;
    border-left: 4px solid $primary-color;
  }
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;

  .stat-box {
    padding: 16px;
    border-radius: 10px;
    text-align: center;
    background: $surface-2;
    border: 1px solid $border-color;

    &.primary { background: $band-danger-bg; border-color: $band-danger-border; }
    &.success { background: $band-success-bg; border-color: $band-success-border; }
    &.warning { background: $band-warning-bg; border-color: $band-warning-border; }
    &.danger { background: $band-danger-bg; border-color: $band-danger-border; }

    .stat-value {
      font-size: 26px;
      font-weight: 800;
      color: $text-main;
      line-height: 1.2;
    }
    .stat-label {
      font-size: 12px;
      color: $text-sub;
      margin-top: 4px;
    }
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
  .subject-bar {
    height: 10px;
    background: $surface-2;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 4px;

    .subject-bar-fill {
      height: 100%;
      background: $gradient-warm;
      border-radius: 6px;
      transition: width 0.4s;
    }
  }
  .subject-stats { font-size: 12px; color: $text-sub; }
}

.mistake-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;

  .mistake-item {
    display: flex;
    flex-direction: column;

    .mistake-label { font-size: 12px; color: $text-sub; }
    .mistake-value {
      font-size: 22px;
      font-weight: 800;
      color: $text-main;

      &.danger { color: $danger-color; }
      &.warning { color: $warning-color; }
    }
  }
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
    .top-kp-count { color: $danger-color; font-weight: 700; }
  }
}

.review-row {
  display: flex;
  gap: 16px;

  .review-item {
    flex: 1;
    text-align: center;
    padding: 16px;
    border-radius: 10px;
    background: $surface-2;

    .review-num {
      font-size: 28px;
      font-weight: 800;
      color: $text-main;

      &.danger { color: $danger-color; }
      &.warning { color: $warning-color; }
    }
    .review-label {
      font-size: 12px;
      color: $text-sub;
      margin-top: 4px;
    }
  }
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
        border-radius: 4px 4px 0 0;
        transition: height 0.4s;

        &.active { background: $gradient-warm; }
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