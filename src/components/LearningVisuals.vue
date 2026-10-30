<template>
  <div class="visuals">
    <!-- ========== 掌握热力图 ========== -->
    <section class="v-section">
      <SectionTitle title="🟩 知识点掌握热力图" accent />
      <p class="v-desc">每个色块是一个知识点，颜色代表掌握状态。点状分布越绿，整体越扎实。</p>

      <div v-if="loading" class="v-loading">正在统计…</div>
      <div v-else class="heat-by-subject">
        <div v-for="grp in subjectGroups" :key="grp.subject" class="heat-group">
          <div class="heat-group__title">
            {{ subjectLabel(grp.subject) }}
            <span class="heat-group__rate">{{ grp.mastered }}/{{ grp.total }} 已掌握</span>
          </div>
          <div class="heat-grid">
            <span
              v-for="cell in grp.cells"
              :key="cell.key"
              class="heat-cell"
              :class="'st-' + cell.status"
              :title="`${cell.title} · ${statusLabel(cell.status)}`"
            ></span>
          </div>
        </div>
      </div>

      <div class="legend">
        <span v-for="s in STATUS_ORDER" :key="s" class="legend__item">
          <i class="legend__swatch" :class="'st-' + s"></i>{{ statusLabel(s) }}
        </span>
      </div>
    </section>

    <!-- ========== 学习日历热力图 ========== -->
    <section class="v-section">
      <SectionTitle title="📅 学习日历" accent />
      <p class="v-desc">每天做题越多色块越深。连续打卡的小格子，是孩子坚持的证据。</p>
      <div v-if="loading" class="v-loading">正在统计…</div>
      <div v-else class="calendar">
        <div class="calendar__weekdays">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>
        <div class="calendar__grid" :style="{ gridTemplateColumns: `repeat(${calendarWeeks}, 1fr)` }">
          <span
            v-for="(d, i) in calendarCells"
            :key="i"
            class="calendar__cell"
            :class="'lv-' + d.level"
            :title="d.date ? `${d.date}：${d.count} 题` : ''"
          ></span>
        </div>
        <div class="calendar__legend">
          少
          <i class="calendar__dot lv-0"></i>
          <i class="calendar__dot lv-1"></i>
          <i class="calendar__dot lv-2"></i>
          <i class="calendar__dot lv-3"></i>
          <i class="calendar__dot lv-4"></i>
          多
        </div>
      </div>
    </section>

    <!-- ========== 准确率趋势 ========== -->
    <section class="v-section">
      <SectionTitle title="📈 练习准确率趋势" accent />
      <p class="v-desc">按「当日触及知识点」的累计正确率估算，反映近期练习的质量变化。</p>
      <div v-if="loading" class="v-loading">正在统计…</div>
      <div v-else-if="accuracySeries.length === 0" class="v-empty">还没有足够的学习记录</div>
      <svg v-else class="trend" :viewBox="`0 0 ${trendW} ${trendH}`" preserveAspectRatio="none">
        <polyline
          :points="trendPoints"
          fill="none"
          stroke="var(--primary-text)"
          stroke-width="2.5"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <circle
          v-for="(pt, i) in trendCircles"
          :key="i"
          :cx="pt.x"
          :cy="pt.y"
          r="2.6"
          fill="var(--primary-text)"
        />
      </svg>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import SectionTitle from '@/components/ui/SectionTitle.vue'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import { canonicalizeProgressRows, type CanonicalKp } from '@core/mastery/masterySummary'
import { loadDailyStats } from '@core/motivation/dailyStats'

type Status = 'mastered' | 'learning' | 'needReview' | 'unlearned' | 'notStarted'
const STATUS_ORDER: Status[] = ['mastered', 'learning', 'needReview', 'unlearned', 'notStarted']

const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
const loading = ref(true)

function statusLabel(s: Status): string {
  return { mastered: '已掌握', learning: '学习中', needReview: '需复习', unlearned: '未掌握', notStarted: '未学' }[s]
}
function subjectLabel(s?: string): string {
  return s === 'math' ? '数学' : s === 'chinese' ? '语文' : s === 'english' ? '英语' : (s ?? '其他')
}

interface Cell { key: string; title: string; status: Status }
interface Group { subject?: string; cells: Cell[]; total: number; mastered: number }

const subjectGroups = computed<Group[]>(() => {
  const packages = packageStore.packages
  const progress = userDataStore.progress
  const { entries, rowByKey } = canonicalizeProgressRows(packages, progress)
  const subjectOf = new Map<string, string>()
  for (const p of packages) {
    if (p.packageId && p.manifest?.subject) subjectOf.set(p.packageId, p.manifest.subject)
  }
  const bySubject = new Map<string, Cell[]>()
  for (const e of entries as CanonicalKp[]) {
    const row = rowByKey.get(e.key)
    const status: Status = !row ? 'notStarted'
      : (row.status as Status) ?? 'notStarted'
    const subj = subjectOf.get(e.packageId) ?? 'other'
    if (!bySubject.has(subj)) bySubject.set(subj, [])
    bySubject.get(subj)!.push({ key: e.key, title: e.title ?? '', status })
  }
  return [...bySubject.entries()].map(([subject, cells]) => ({
    subject,
    cells,
    total: cells.length,
    mastered: cells.filter((c) => c.status === 'mastered').length,
  }))
})

// -------- 学习日历 --------
const CALENDAR_DAYS = 119 // 17 周
const calendarWeeks = Math.ceil(CALENDAR_DAYS / 7)

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const calendarCells = computed(() => {
  // 取最近 CALENDAR_DAYS 天，按「周一」对齐成 7×weeks 网格
  const counts = new Map<string, number>()
  for (const s of dailyStats.value) counts.set(s.date, s.questionCount)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 让最后一天是今天，前面补到整周
  const end = today
  const start = new Date(end)
  start.setDate(end.getDate() - (CALENDAR_DAYS - 1))
  // 前移使 start 落在周一
  const startDow = (start.getDay() + 6) % 7 // 0=周一
  start.setDate(start.getDate() - startDow)

  const cells: { date: string; count: number; level: number }[] = []
  const total = calendarWeeks * 7
  for (let i = 0; i < total; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = localDayKey(d)
    const future = d > end
    const count = future ? 0 : counts.get(key) ?? 0
    cells.push({ date: future ? '' : key, count, level: future ? 0 : levelOf(count) })
  }
  return cells
})

function levelOf(count: number): number {
  if (count <= 0) return 0
  if (count < 5) return 1
  if (count < 10) return 2
  if (count < 20) return 3
  return 4
}

// -------- 准确率趋势 --------
const trendW = 600
const trendH = 140
const PAD = 8

const accuracySeries = computed(() => {
  const byDay = new Map<string, { correct: number; wrong: number }>()
  for (const row of userDataStore.progress) {
    const d = row.lastStudiedAt
    if (!d) continue
    const key = localDayKey(new Date(d))
    const cur = byDay.get(key) ?? { correct: 0, wrong: 0 }
    cur.correct += row.correctCount || 0
    cur.wrong += row.wrongCount || 0
    byDay.set(key, cur)
  }
  const days = [...byDay.entries()]
    .filter(([, v]) => v.correct + v.wrong > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
  return days.map(([, v]) => {
    const total = v.correct + v.wrong
    return total > 0 ? Math.round((v.correct / total) * 100) : 0
  })
})

const trendPoints = computed(() => {
  const n = accuracySeries.value.length
  if (n === 0) return ''
  return accuracySeries.value
    .map((rate, i) => {
      const x = PAD + (i / (n - 1)) * (trendW - 2 * PAD)
      const y = PAD + (1 - rate / 100) * (trendH - 2 * PAD)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

const trendCircles = computed(() => {
  const n = accuracySeries.value.length
  return accuracySeries.value.map((rate, i) => ({
    x: PAD + (i / (n - 1)) * (trendW - 2 * PAD),
    y: PAD + (1 - rate / 100) * (trendH - 2 * PAD),
  }))
})

const dailyStats = ref<{ date: string; questionCount: number }[]>([])

onMounted(async () => {
  await Promise.all([packageStore.loadPackages(), userDataStore.loadUserData()])
  dailyStats.value = await loadDailyStats()
  loading.value = false
})
</script>

<style scoped lang="scss">
.visuals { display: flex; flex-direction: column; gap: 28px; }

.v-section { }
.v-desc { font-size: 12px; color: $text-sub; margin: -4px 0 14px; }
.v-loading, .v-empty { font-size: 13px; color: $text-sub; padding: 16px 0; }

/* 掌握热力图 */
.heat-by-subject { display: flex; flex-direction: column; gap: 16px; }
.heat-group {
  &__title {
    font-size: 13px;
    font-weight: 700;
    color: $text-main;
    margin-bottom: 8px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  &__rate { font-size: 11px; color: $text-sub; font-weight: 500; }
}
.heat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16px, 1fr));
  gap: 4px;
  max-width: 720px;
}
.heat-cell {
  aspect-ratio: 1;
  border-radius: 4px;
  background: var(--badge-neutral-bg);
  &.st-mastered { background: var(--badge-success-bg); }
  &.st-learning { background: var(--badge-primary-bg); }
  &.st-needReview { background: var(--badge-warning-bg); }
  &.st-unlearned { background: var(--badge-danger-bg); }
  &.st-notStarted { background: var(--badge-neutral-bg); }
}
.legend {
  display: flex;
  gap: 14px;
  margin-top: 14px;
  font-size: 11px;
  color: $text-sub;
  &__item { display: inline-flex; align-items: center; gap: 5px; }
  &__swatch {
    width: 12px; height: 12px; border-radius: 3px; display: inline-block;
    background: var(--badge-neutral-bg);
    &.st-mastered { background: var(--badge-success-bg); }
    &.st-learning { background: var(--badge-primary-bg); }
    &.st-needReview { background: var(--badge-warning-bg); }
    &.st-unlearned { background: var(--badge-danger-bg); }
    &.st-notStarted { background: var(--badge-neutral-bg); }
  }
}

/* 学习日历 */
.calendar {
  &__weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
    font-size: 11px;
    color: $text-muted;
    margin-bottom: 6px;
    max-width: 720px;
  }
  &__grid {
    display: grid;
    gap: 4px;
    max-width: 720px;
  }
  &__cell {
    aspect-ratio: 1;
    border-radius: 3px;
    background: var(--badge-neutral-bg);
    &.lv-1 { background: rgba(var(--primary-rgb), 0.25); }
    &.lv-2 { background: rgba(var(--primary-rgb), 0.45); }
    &.lv-3 { background: rgba(var(--primary-rgb), 0.7); }
    &.lv-4 { background: var(--primary-text); }
  }
  &__legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    font-size: 11px;
    color: $text-sub;
    max-width: 720px;
  }
  &__dot {
    width: 12px; height: 12px; border-radius: 3px; display: inline-block;
    background: var(--badge-neutral-bg);
    &.lv-1 { background: rgba(var(--primary-rgb), 0.25); }
    &.lv-2 { background: rgba(var(--primary-rgb), 0.45); }
    &.lv-3 { background: rgba(var(--primary-rgb), 0.7); }
    &.lv-4 { background: var(--primary-text); }
  }
}

/* 准确率趋势 */
.trend {
  width: 100%;
  max-width: 720px;
  height: 140px;
  background: $bg-color;
  border-radius: 10px;
}
</style>
