<template>
  <div class="package-list-page">
    <n-spin v-if="loading" size="large" class="loading-spin" />

    <template v-else>
      <!-- V2.7 · 轨道 A3：顶部搜索（标题 / 学科 / 年级 / 版本 / 类型） -->
      <div class="list-toolbar">
        <label class="search-box">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input
            v-model="search"
            class="search-input"
            type="search"
            placeholder="搜索学习包：标题、学科、年级、版本…"
            aria-label="搜索学习包"
          />
        </label>
        <button
          v-if="searching"
          class="search-clear"
          type="button"
          @click="search = ''"
        >清除</button>
        <span v-if="searching" class="search-count">找到 {{ totalVisible }} 个</span>
      </div>

      <!-- V2.12.5 · 按学科筛选：顶部一排学科标签，点了只看那一科；
           「全部」恢复按学科分区的完整视图。窄屏横向滚动。 -->
      <div class="subject-filter" role="tablist" aria-label="按学科筛选">
        <button
          v-for="opt in subjectFilterOptions"
          :key="opt.value"
          class="subject-chip-btn"
          :class="[{ active: subjectFilter === opt.value }, `sf-${opt.value}`]"
          type="button"
          role="tab"
          :aria-selected="subjectFilter === opt.value"
          @click="subjectFilter = opt.value"
        >
          <span class="sf-icon" aria-hidden="true">{{ opt.icon }}</span>
          <span class="sf-label">{{ opt.label }}</span>
          <span class="sf-count">{{ subjectCounts[opt.value] ?? 0 }}</span>
        </button>
      </div>

      <!-- 按学科分区：每个学科一个面板，面板内再按「教材 / 每日一练 / 专项 / 冲刺」折叠 -->
      <div
        v-for="g in visibleSubjects"
        :key="g.subject"
        class="subject-panel"
        :class="`panel-${g.subject}`"
      >
        <header class="subject-header" @click="toggleSubject(g.subject)">
          <span class="subject-bar" aria-hidden="true"></span>
          <span class="subject-icon" aria-hidden="true">{{ subjectIcon(g.subject) }}</span>
          <span class="subject-name">{{ g.label }}</span>
          <span class="subject-count">{{ g.textbook.length + g.daily.length + g.special.length + g.sprint.length }}</span>
          <button
            class="subject-toggle"
            type="button"
            :aria-expanded="!isSubjectCollapsed(g.subject)"
            :aria-label="isSubjectCollapsed(g.subject) ? `展开${g.label}` : `收起${g.label}`"
            @click.stop="toggleSubject(g.subject)"
          >▾</button>
        </header>

        <div v-show="!isSubjectCollapsed(g.subject)" class="subject-body">
          <section v-for="blk in subjectBlocks(g)" :key="blk.type" class="type-section">
            <header class="type-header" @click="toggleSection(g.subject, blk.type)">
              <span class="type-title">
                <span class="type-icon" aria-hidden="true">{{ blk.icon }}</span>
                {{ blk.title }}
              </span>
              <span class="type-count">{{ blk.items.length }}</span>
              <span class="type-chevron" :class="{ collapsed: isSectionCollapsed(g.subject, blk.type) }" aria-hidden="true">▾</span>
            </header>

            <div v-show="!isSectionCollapsed(g.subject, blk.type)" class="type-body">
              <!-- 每日一练：按周分桶（多周才显示周头） -->
              <template v-if="blk.type === 'daily'">
                <div v-for="b in dailyBucketsOf(g.daily)" :key="b.label" class="week-block">
                  <button
                    v-if="b.showHead"
                    class="week-head"
                    type="button"
                    :aria-expanded="!isWeekCollapsed(`${g.subject}:${b.label}`)"
                    @click="toggleWeek(`${g.subject}:${b.label}`)"
                  >
                    <span class="week-label">{{ b.label }}</span>
                    <span class="week-count">{{ b.items.length }} 个</span>
                    <span class="week-chevron" aria-hidden="true">▾</span>
                  </button>
                  <div v-show="!b.showHead || !isWeekCollapsed(`${g.subject}:${b.label}`)" class="package-grid">
                    <PackageCard
                      v-for="row in b.items"
                      :key="row.pkg.packageId"
                      :pkg="row.pkg"
                      mode="daily"
                      :status="pkgStatus(row.pkg)"
                      @share="openShare"
                    />
                  </div>
                </div>
              </template>

              <!-- 其余类型：直接卡片网格 -->
              <div v-else class="package-grid">
                <PackageCard
                  v-for="pkg in blk.items"
                  :key="pkg.packageId"
                  :pkg="pkg"
                  :mode="blk.mode"
                  :status="pkgStatus(pkg)"
                  @share="openShare"
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <EmptyState
        v-if="totalVisible === 0"
        :description="searching ? `没有匹配「${search.trim()}」的学习包` : '暂无学习包，请先导入'"
        class="empty-card"
      />
    </template>

    <!-- G3 · 分享弹窗：二维码 + 后缀码（手输兜底） -->
    <n-modal v-model:show="showShareModal" preset="card" title="📤 分享学习包" style="max-width: 420px;">
      <div class="share-body">
        <p class="share-hint">
          在另一台设备上打开「导入学习包 → 扫码导入」扫描此二维码；
          摄像头不可用时，可把下方分享码手动输入到那台设备。
        </p>
        <canvas ref="shareCanvasRef" class="share-canvas" aria-label="学习包分享二维码"></canvas>
        <p v-if="shareDrawError" class="share-error" role="alert">{{ shareDrawError }}</p>
        <div class="share-code">
          <div class="share-code-label">分享码（手输用）</div>
          <code class="share-code-text">{{ shareString }}</code>
        </div>
        <p class="share-note">
          二维码只包含包 id 与校验和，不含任何口令或密钥，可放心拍照传输。
        </p>
      </div>
      <template #footer>
        <n-space justify="end">
          <AppButton @click="showShareModal = false">关闭</AppButton>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { NSpin, NModal, NSpace } from 'naive-ui'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import PackageCard from './PackageCard.vue'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import { type CardStatus } from '@core/learning/cardStatus'
import { completionStatusOf, scopeOfPackage } from '@core/learning/completion'
import { buildOwnerIndex, type OwnerIndex } from '@core/progress/ownerIndex'
import { buildShareString, drawQrToCanvas } from '@core/share/qrcode'
import { groupByWeek, resolveWeekOf } from '@core/learning/weekBucket'
import type { LearningPackageRecord } from '@/db'

const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
const loading = ref(true)

// ==================== V2.7 · 轨道 A3：搜索 + 折叠 ====================
const search = ref('')
/** 搜索态（去掉空白后非空）。搜索时强制展开：命中的内容藏在折叠里等于没搜到 */
const searching = computed(() => search.value.trim().length > 0)

const SUBJECT_COLLAPSE_KEY = 'packageListSubjectCollapsed'
const SECTION_COLLAPSE_KEY = 'packageListSectionCollapsed'
const WEEK_COLLAPSE_KEY = 'packageListWeekCollapsed'

/** localStorage 里的字符串数组（脏数据静默降级为空 = 全部展开） */
function loadKeys(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveKeys(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额满：折叠偏好存不下不影响功能，下次进来是默认展开 */
  }
}

/**
 * 双层折叠：
 * - collapsedSubjects：学科面板是否整块收起（默认全空 = 学科面板全展开）。
 * - collapsedSections：学科内「教材/每日一练/专项/冲刺」小节是否收起
 *   （默认全空 = 全折叠，首屏只看到小节标题，不堆叠卡片）。
 * - collapsedWeeks：每日一练周分桶（key 带学科前缀区分不同学科）。
 */
const collapsedSubjects = ref<string[]>(loadKeys(SUBJECT_COLLAPSE_KEY))
const collapsedSections = ref<string[]>(loadKeys(SECTION_COLLAPSE_KEY))
const collapsedWeeks = ref<string[]>(loadKeys(WEEK_COLLAPSE_KEY))

function isSubjectCollapsed(subject: string): boolean {
  if (searching.value) return false
  return collapsedSubjects.value.includes(subject)
}

function toggleSubject(subject: string): void {
  collapsedSubjects.value = collapsedSubjects.value.includes(subject)
    ? collapsedSubjects.value.filter((k) => k !== subject)
    : [...collapsedSubjects.value, subject]
  saveKeys(SUBJECT_COLLAPSE_KEY, collapsedSubjects.value)
}

function isSectionCollapsed(subject: string, type: string): boolean {
  // 搜索态、或选中具体某一科时，强制展开小节，便于直接看到包
  if (searching.value || subjectFilter.value !== 'all') return false
  return collapsedSections.value.includes(`${subject}:${type}`)
}

function toggleSection(subject: string, type: string): void {
  const k = `${subject}:${type}`
  collapsedSections.value = collapsedSections.value.includes(k)
    ? collapsedSections.value.filter((x) => x !== k)
    : [...collapsedSections.value, k]
  saveKeys(SECTION_COLLAPSE_KEY, collapsedSections.value)
}

function isWeekCollapsed(label: string): boolean {
  if (searching.value || subjectFilter.value !== 'all') return false
  return collapsedWeeks.value.includes(label)
}

function toggleWeek(label: string): void {
  collapsedWeeks.value = collapsedWeeks.value.includes(label)
    ? collapsedWeeks.value.filter((k) => k !== label)
    : [...collapsedWeeks.value, label]
  saveKeys(WEEK_COLLAPSE_KEY, collapsedWeeks.value)
}

// ==================== V2.12.5 · 按学科筛选 ====================
/** 学科顺序即分区渲染顺序；other = 无学科 / 未知学科 */
const SUBJECT_ORDER = ['math', 'chinese', 'english', 'other'] as const

const subjectFilter = ref<string>('all')

/** 顶部筛选条选项（含数量徽标）。顺序：全部 → 数学 → 语文 → 英语 → 其他 */
const subjectFilterOptions = [
  { value: 'all', label: '全部', icon: '🗂️' },
  { value: 'math', label: '数学', icon: '📐' },
  { value: 'chinese', label: '语文', icon: '📖' },
  { value: 'english', label: '英语', icon: '🔤' },
  { value: 'other', label: '其他', icon: '📦' },
] as const

function subjectLabel(subject: string): string {
  switch (subject) {
    case 'math': return '数学'
    case 'chinese': return '语文'
    case 'english': return '英语'
    default: return '其他'
  }
}

function subjectIcon(subject: string): string {
  switch (subject) {
    case 'math': return '📐'
    case 'chinese': return '📖'
    case 'english': return '🔤'
    default: return '📦'
  }
}

// ==================== G3 · 跨设备分享 ====================
const showShareModal = ref(false)
const shareCanvasRef = ref<HTMLCanvasElement | null>(null)
const shareDrawError = ref('')
const shareString = ref('')
/** 分享码的展示行宽有限，太长的 url 会撑破弹窗 —— 生成时就不带 url 的场景不存在 */
const SHARE_CANVAS_SIZE = 240

function openShare(pkg: LearningPackageRecord): void {
  try {
    shareString.value = buildShareString({ packageId: pkg.packageId })
    shareDrawError.value = ''
    showShareModal.value = true
  } catch (e) {
    shareString.value = ''
    showShareModal.value = false
    console.error('[分享] 载荷组装失败', e)
  }
}

// 弹窗内容是 teleport 渲染，开弹窗后下一帧 canvas 才挂载，必须 nextTick 后再画
watch(showShareModal, (show) => {
  if (!show) return
  void nextTick(() => {
    const canvas = shareCanvasRef.value
    if (!canvas || !shareString.value) return
    try {
      drawQrToCanvas(canvas, shareString.value, SHARE_CANVAS_SIZE)
      shareDrawError.value = ''
    } catch (e) {
      // 画布失败不阻断弹窗：后缀码手输仍然可用
      shareDrawError.value = e instanceof Error ? e.message : '二维码渲染失败，请改用下方分享码手动输入'
    }
  })
})

onMounted(async () => {
  await Promise.all([packageStore.loadPackages(), userDataStore.loadUserData()])
  loading.value = false
})

/**
 * D1 · 学习包 → 卡片状态（每日一练的「打卡」落到这里：仓库没有日历格子，
 * 每日包本来就是卡片列表）。状态由该包的进度行反演：没有进度行 = 今天还没练 = none。
 * 一次算完一整屏，模板只查表。
 *
 * 聚合走 **`progress` 模式**（`completionStatusOf` 内部固定传）：这一格问的是
 * 「这天做了没做完」，所以「练了一部分」必须留在 `learning`（黄），不能因为有一个
 * 知识点到期就整格挂红。45 天的包有几百个知识点，「全部同时已掌握」不可达 ——
 * 用 `attention` 口径会让包卡几乎永不变绿（详见 `cardStatus.ts` 文件头）。
 *
 * ## V2.12.3 · 「全部完成」通道
 *
 * 除了掌握度聚合，包卡现在还多一条**题目级**判定（`@core/learning/completion`）：
 * 该包范围内所有知识点都学过 + 没有未掌握的错题 → 判「已掌握」。
 * 这一层让「做完了但没连对 3 次」的情况也能正确变绿。
 */
/**
 * 归属包索引：状态查表时按 kpId 反查真实落库的包，与 `recordProgress` 写入端同源。
 * 每日一练自包含包（knowledgePoints 为空、进度记到教材单元归属包）靠它才能点亮状态。
 */
const ownerIndex = computed<OwnerIndex>(() => buildOwnerIndex(packageStore.packages))

const statusByPackageId = computed<Map<string, CardStatus>>(() => {
  const map = new Map<string, CardStatus>()
  for (const pkg of packageStore.packages) {
    const scope = scopeOfPackage(pkg)
    map.set(
      pkg.packageId,
      completionStatusOf({
        entryPackageId: pkg.packageId,
        kpIds: scope.kpIds,
        exerciseIds: scope.exerciseIds,
        progress: userDataStore.progress,
        mistakes: userDataStore.mistakes,
        ownerIndex: ownerIndex.value,
        manual: userDataStore.isCardManuallyComplete('package', pkg.packageId),
      })
    )
  }
  return map
})

function pkgStatus(pkg: LearningPackageRecord): CardStatus {
  return statusByPackageId.value.get(pkg.packageId) ?? 'none'
}

function getPackageType(pkg: LearningPackageRecord): string {
  const m = pkg.manifest as any
  return m.packageType ?? m.type ?? ''
}

function isInternal(pkg: LearningPackageRecord): boolean {
  const m = pkg.manifest as any
  return m.isInternal === true
}

/**
 * 搜索命中判定：标题 / 学科（中英文都认）/ 年级 / 上下册 / 版本 / 包类型。
 * 刻意不做拼音首字母匹配 —— 需要一张拼音表，且"shuxue"这种输入命中率并不高。
 */
function matchesSearch(pkg: LearningPackageRecord): boolean {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return true
  const m = pkg.manifest as any
  const hay = [
    m.title,
    subjectLabel(m.subject),
    m.subject,
    `${m.grade}年级`,
    m.term === 'up' ? '上册' : '下册',
    m.edition,
    typeLabel(getPackageType(pkg)),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(kw)
}

function typeLabel(type?: string): string {
  switch (type) {
    case 'base': return '基础包'
    case 'unit': return '单元包'
    case 'term': return '学期包'
    case 'daily': return '每日一练'
    case 'special': return '专项'
    case 'sprint': return '冲刺'
    default: return '包'
  }
}

/**
 * V2.12.5 · 先按学科分、再按类型分的两级结构。
 * 内部包（isInternal）不出现在学习页；搜索词先过滤；其余按 subject 落入对应学科分区，
 * 学科内再按包类型归到 textbook/daily/special/sprint 四档。
 */
interface SubjectGroup {
  subject: string
  label: string
  textbook: LearningPackageRecord[]
  daily: LearningPackageRecord[]
  special: LearningPackageRecord[]
  sprint: LearningPackageRecord[]
}

const emptyGroup = (subject: string): SubjectGroup => ({
  subject,
  label: subjectLabel(subject),
  textbook: [],
  daily: [],
  special: [],
  sprint: [],
})

const bySubject = computed<SubjectGroup[]>(() => {
  const map: Record<string, SubjectGroup> = {}
  for (const s of SUBJECT_ORDER) map[s] = emptyGroup(s)

  for (const pkg of packageStore.packages) {
    if (isInternal(pkg)) continue
    if (!matchesSearch(pkg)) continue
    const subj = (pkg.manifest as any).subject as string | undefined
    const key: string = subj && (SUBJECT_ORDER as readonly string[]).includes(subj) ? subj : 'other'
    const g = map[key]
    const type = getPackageType(pkg)
    if (type === 'daily') g.daily.push(pkg)
    else if (type === 'special') g.special.push(pkg)
    else if (type === 'sprint') g.sprint.push(pkg)
    else g.textbook.push(pkg)
  }

  return SUBJECT_ORDER.map((s) => map[s]).filter(
    (g) => g.textbook.length || g.daily.length || g.special.length || g.sprint.length,
  )
})

/** 顶部筛选条的数量徽标：all = 总数，其余 = 各学科包数 */
const subjectCounts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = { all: 0 }
  for (const g of bySubject.value) {
    const n = g.textbook.length + g.daily.length + g.special.length + g.sprint.length
    c[g.subject] = n
    c.all += n
  }
  return c
})

/** 当前筛选下要渲染的学科面板（选具体学科时只显示那一个） */
const visibleSubjects = computed<SubjectGroup[]>(() => {
  if (subjectFilter.value === 'all') return bySubject.value
  return bySubject.value.filter((g) => g.subject === subjectFilter.value)
})

/** 学科面板内要渲染的类型小节（过滤掉空档） */
function subjectBlocks(g: SubjectGroup) {
  return [
    { type: 'textbook', mode: 'textbook' as const, icon: '📚', title: '教材', items: g.textbook },
    { type: 'daily', mode: 'daily' as const, icon: '📅', title: '每日一练', items: g.daily },
    { type: 'special', mode: 'special' as const, icon: '🎯', title: '专项突破', items: g.special },
    { type: 'sprint', mode: 'sprint' as const, icon: '🏁', title: '冲刺模拟', items: g.sprint },
  ].filter((b) => b.items.length)
}

const totalVisible = computed(() => subjectCounts.value.all)

interface DailyRow {
  pkg: LearningPackageRecord
  week: number | null
  title: string
}

/**
 * 每日一练按周分桶（V2.7 · A3）。桶头只在**真的分出多周**时渲染 ——
 * 一个包都没声明周号时，硬塞一个「未分周」标题只是多一层噪音。
 */
function dailyBucketsOf(pkgs: LearningPackageRecord[]) {
  const rows: DailyRow[] = pkgs.map((pkg) => ({
    pkg,
    week: resolveWeekOf(pkg.manifest as unknown as Record<string, unknown>),
    title: pkg.manifest.title,
  }))
  const buckets = groupByWeek(rows)
  const showHead = buckets.length > 1
  return buckets.map((b) => ({ ...b, showHead }))
}
</script>

<style scoped lang="scss">
@import '@/core/styles/card-status';

.package-list-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 16px;
}

.loading-spin {
  display: flex;
  justify-content: center;
  margin-top: 40px;
}

/* ===== V2.7 · 轨道 A3：顶部搜索 ===== */
.list-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-box {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-full;
  transition: border-color $duration-fast $ease-standard, box-shadow $duration-fast $ease-standard;

  &:focus-within {
    border-color: $primary-color;
    box-shadow: 0 0 0 3px $primary-light;
  }

  .search-icon {
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-size: 13.5px;
    color: $text-main;

    &::placeholder { color: $text-muted; }
    /* 原生 search 的 ✕ 与右侧「清除」重复，统一收掉 */
    &::-webkit-search-cancel-button { display: none; }
  }
}

.search-clear {
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border: 1px solid $border-color;
  border-radius: $radius-full;
  background: $card-bg;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: $text-sub;
  cursor: pointer;
  transition: background $duration-fast $ease-standard, color $duration-fast $ease-standard;

  &:hover {
    background: $bg-color-hover;
    color: $text-main;
  }

  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }
}

.search-count {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: $text-sub;
  white-space: nowrap;
}

/* ===== V2.12.5 · 顶部学科筛选条 ===== */
.subject-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  /* 细滚动条，窄屏横向滚动时不抢眼 */
  scrollbar-width: thin;

  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: $border-color; border-radius: 999px; }
}

.subject-chip-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid $border-color;
  border-radius: $radius-full;
  background: $card-bg;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  color: $text-sub;
  cursor: pointer;
  transition: all $duration-fast $ease-standard;

  .sf-icon { font-size: 14px; line-height: 1; }
  .sf-label { white-space: nowrap; }
  .sf-count {
    font-size: 11px;
    font-weight: 700;
    min-width: 18px;
    padding: 1px 6px;
    border-radius: 999px;
    background: $bg-color-hover;
    color: $text-muted;
  }

  &:hover {
    background: $bg-color-hover;
    color: $text-main;
    border-color: $primary-color;
  }

  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }

  /* 选中态：主色渐变填充，文字反白，计数徽标反白 */
  &.active {
    border-color: transparent;
    background: $gradient-primary;
    color: $text-on-primary;
    box-shadow: $shadow-sm;

    .sf-count {
      background: rgba(255, 255, 255, 0.22); // check-hex-allow 渐变底上的反白徽标，同族于 --progress-gloss
      color: $text-on-primary;
    }
  }
}

/* ===== V2.12.5 · 学科分区面板 ===== */
.subject-panel {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-xl;
  box-shadow: $shadow-sm;
  overflow: hidden;
}

.subject-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  transition: background $duration-fast $ease-standard;

  &:hover { background: $bg-color-hover; }
  &:focus-visible { outline: 2px solid $primary-color; outline-offset: -2px; }

  /* 学科主题色竖条（与卡片 accent 同语汇，但更粗，作分区标识） */
  .subject-bar {
    width: 5px;
    height: 22px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .subject-icon {
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
  }

  .subject-name {
    font-size: 16px;
    font-weight: 800;
    color: $text-main;
    letter-spacing: 0.2px;
  }

  .subject-count {
    font-size: 12px;
    font-weight: 700;
    color: $text-sub;
    background: $bg-color-hover;
    padding: 2px 10px;
    border-radius: 999px;
  }

  .subject-toggle {
    margin-left: auto;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid $border-color;
    border-radius: $radius-full;
    background: $card-bg;
    color: $text-sub;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    transition: transform $duration-fast $ease-standard, background $duration-fast $ease-standard, color $duration-fast $ease-standard;

    &[aria-expanded='false'] { transform: rotate(-90deg); }

    &:hover {
      background: $bg-color-hover;
      color: $primary-text;
    }

    &:focus-visible {
      outline: 2px solid $primary-color;
      outline-offset: 2px;
    }
  }
}

/* 学科主题色：数学=主色、语文=警示色、英语=成功色、其他=中性 */
.panel-math .subject-bar { background: $primary-color; }
.panel-chinese .subject-bar { background: $warning-color; }
.panel-english .subject-bar { background: $success-color; }
.panel-other .subject-bar { background: $text-muted; }

.subject-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 12px 14px;
}

/* ===== 学科内类型小节（比学科头低一档层级） ===== */
.type-section {
  display: flex;
  flex-direction: column;
}

.type-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  cursor: pointer;
  user-select: none;
  border-top: 1px dashed $border-light;

  &:first-child { border-top: none; }

  &:hover .type-title { color: $primary-text; }

  .type-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13.5px;
    font-weight: 800;
    color: $text-main;
    transition: color $duration-fast $ease-standard;
  }

  .type-icon { font-size: 14px; line-height: 1; }

  .type-count {
    font-size: 11px;
    font-weight: 700;
    color: $text-muted;
    background: $bg-color-hover;
    padding: 1px 8px;
    border-radius: 999px;
  }

  .type-chevron {
    margin-left: auto;
    font-size: 11px;
    color: $text-muted;
    transition: transform $duration-fast $ease-standard;

    &.collapsed { transform: rotate(-90deg); }
  }
}

.type-body { padding-top: 4px; }

/* ===== 每日一练：按周分桶 ===== */
.week-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.week-head {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border: 1px dashed $border-color;
  border-radius: $radius-full;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  color: $text-sub;
  cursor: pointer;
  transition: border-color $duration-fast $ease-standard, color $duration-fast $ease-standard;

  &:hover {
    border-color: $primary-color;
    color: $primary-text;
  }

  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }

  .week-count {
    font-weight: 600;
    color: $text-muted;
  }

  .week-chevron {
    font-size: 10px;
    transition: transform $duration-fast $ease-standard;
  }

  &[aria-expanded='false'] .week-chevron { transform: rotate(-90deg); }
}

.package-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}

.empty-card {
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 60px 20px;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
}

/* ===== G3 · 分享弹窗（样式全部走语义 token）===== */
.share-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.share-hint {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--text-sub);
  line-height: 1.7;
  text-align: center;
}

/* 白底黑块是扫码对比度要求，与主题无关（见 qrcode.ts 的说明） */
.share-canvas {
  display: block;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
}

.share-error {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--danger-text);
}

.share-code {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  background: var(--bg-color-hover);
  border-radius: var(--radius-sm);
}

.share-code-label {
  font-size: var(--font-2xs);
  font-weight: 700;
  color: var(--text-muted);
}

.share-code-text {
  font-size: var(--font-2xs);
  color: var(--text-main);
  word-break: break-all;
  line-height: 1.6;
}

.share-note {
  margin: 0;
  font-size: var(--font-2xs);
  color: var(--text-muted);
  text-align: center;
}
</style>
