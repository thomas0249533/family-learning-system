<template>
  <div class="parent-page">
    <!-- 顶部标题 -->
    <PageHeader
      icon="👨‍👩‍👧"
      title="家长视图"
      subtitle="查看孩子的学习情况 · 数据只读"
    />

    <!--
      档案管理（V1.4 · B1）。放在最上面而不是塞进设置页：
      家长进"家长视图"第一个要确认的就是"我现在看的是哪个孩子"。
      改名/新建/删除只在这里出现 —— 孩子端只能切换（AppShell），不能改。
    -->
    <section class="section">
      <SectionTitle title="👧 档案管理" />
      <div class="profile-panel">
        <p class="profile-hint">
          每个档案的进度、错题、成就、打卡互相独立。最多 {{ MAX_PROFILES }} 个。
          <strong>删除档案只删条目、不删数据</strong>，但删掉后那些记录就找不回来了 ——
          建议先把该档案的备份导出再删。
        </p>

        <ul class="profile-list">
          <li v-for="p in profileState.list" :key="p.id" class="profile-row">
            <template v-if="editingId === p.id">
              <input
                v-model="editingName"
                class="profile-input"
                type="text"
                maxlength="12"
                aria-label="档案名"
                @keydown.enter.prevent="commitRename"
                @keydown.esc="editingId = null"
              />
              <button class="profile-btn profile-btn--primary" type="button" @click="commitRename">保存</button>
              <button class="profile-btn" type="button" @click="editingId = null">取消</button>
            </template>
            <template v-else>
              <span class="profile-row__name">{{ p.name }}</span>
              <span v-if="p.id === profileState.activeId" class="profile-row__badge">当前</span>
              <span class="profile-row__spacer" />
              <button
                v-if="p.id !== profileState.activeId"
                class="profile-btn profile-btn--primary"
                type="button"
                @click="onSwitch(p.id)"
              >
                切换
              </button>
              <button class="profile-btn" type="button" @click="startRename(p)">改名</button>
              <button
                class="profile-btn profile-btn--danger"
                type="button"
                :disabled="profileState.list.length <= 1"
                :title="profileState.list.length <= 1 ? '至少要保留一个档案' : ''"
                @click="onDelete(p)"
              >
                删除
              </button>
            </template>
          </li>
        </ul>

        <div v-if="creating" class="profile-create">
          <input
            v-model="draftName"
            class="profile-input"
            type="text"
            maxlength="12"
            placeholder="新档案的名字，比如「妹妹」"
            aria-label="新档案名字"
            @keydown.enter.prevent="commitCreate"
            @keydown.esc="creating = false"
          />
          <button class="profile-btn profile-btn--primary" type="button" @click="commitCreate">创建</button>
          <button class="profile-btn" type="button" @click="creating = false">取消</button>
        </div>
        <div v-else class="profile-create">
          <button
            class="profile-btn"
            type="button"
            :disabled="profileState.list.length >= MAX_PROFILES"
            @click="startCreate"
          >
            新建档案（{{ profileState.list.length }} / {{ MAX_PROFILES }}）
          </button>
        </div>
      </div>
    </section>

    <!-- 总览指标 -->
    <section class="section">
      <SectionTitle title="📊 学习总览" />
      <div class="overview-grid">
        <StatCard icon="📖" :value="stats.totalKp" label="知识点总数" />
        <StatCard icon="✅" :value="stats.mastered" label="已掌握" tone="success" />
        <StatCard icon="🔄" :value="stats.learning" label="学习中" tone="warning" />
        <StatCard icon="❌" :value="stats.needReview" label="需复习" tone="danger" />
        <StatCard icon="⏱️" :value="stats.studyMinutes" label="累计分钟" />
        <StatCard icon="🔥" :value="stats.continuousDays" label="连续天数" />
      </div>
    </section>

    <!-- 成就概览（只读） -->
    <section class="section">
      <SectionTitle title="🏅 成就概览" />
      <div class="ach-overview-card">
        <div class="ach-total">
          <div class="ach-total-value">{{ achUnlockedCount }} / {{ achTotal }}</div>
          <div class="ach-total-label">已解锁成就</div>
        </div>
        <div class="ach-row-label">按小组</div>
        <div class="ach-cats">
          <div v-for="c in achByCategory" :key="c.cat" class="ach-cat">
            <span class="ach-cat-icon">{{ c.icon }}</span>
            <span class="ach-cat-name">{{ c.label }}</span>
            <span class="ach-cat-count">{{ c.unlocked }} / {{ c.total }}</span>
          </div>
        </div>
        <!-- 四类来源分布（PRD §4.1 的 source 四类；四个桶恒定出现，某类为 0 也显示） -->
        <div class="ach-row-label">按来源</div>
        <div class="ach-sources">
          <div v-for="s in achBySource" :key="s.source" class="ach-source">
            <span class="ach-source-name">{{ s.label }}</span>
            <span class="ach-source-count">{{ s.earned }} / {{ s.total }}</span>
          </div>
        </div>
        <div class="ach-recent">
          <div class="ach-recent-title">最近解锁</div>
          <div v-if="recentUnlocked.length === 0" class="ach-recent-empty">还没有解锁成就</div>
          <div v-else class="ach-recent-list">
            <div v-for="r in recentUnlocked" :key="r.id" class="ach-recent-item">
              <span class="recent-icon">{{ r.def!.icon }}</span>
              <span class="recent-name">{{ r.def!.title }}</span>
              <span class="recent-date">{{ r.unlockedAt || '较早' }}</span>
            </div>
          </div>
        </div>
        <!-- 家长开关：发现机制（抽线索）。关掉后图鉴回到纯剪影，不给孩子任何"再来一次"的钩子 -->
        <label class="ach-discovery-toggle">
          <input
            type="checkbox"
            :checked="discoveryEnabled"
            @change="toggleDiscovery(($event.target as HTMLInputElement).checked)"
          />
          <span>允许「发现线索」机制（隐藏成就的模糊提示，每天一次，随时可关）</span>
        </label>

        <!-- 解锁证据（快照，不重算）：家长判断"这枚是不是真学会了"的依据 -->
        <div class="ach-evidence" v-if="recentEvidence.length > 0">
          <div class="ach-evidence-title">解锁证据</div>
          <ul class="ach-evidence-list">
            <li v-for="e in recentEvidence" :key="e.id" class="ach-evidence-item">
              <span class="evidence-icon" aria-hidden="true">{{ e.icon }}</span>
              <span class="evidence-text"><b>{{ e.title }}</b> · {{ e.evidence }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 学科分布 -->
    <section class="section" v-if="subjectStats.length > 0">
      <SectionTitle title="📚 学科分布" />
      <div class="subject-list">
        <div v-for="s in subjectStats" :key="s.subject" class="subject-item">
          <div class="subject-head">
            <span class="subject-name">{{ s.label }}</span>
            <span class="subject-count">
              {{ s.mastered }} / {{ s.total }}（{{ s.rate }}%）
            </span>
          </div>
          <ProgressBar :value="s.rate" gradient />
        </div>
      </div>
    </section>

    <!-- 高频错题 Top 5 -->
    <section class="section" v-if="topMistakes.length > 0">
      <SectionTitle title="❌ 高频错题 Top 5" />
      <div class="top-list">
        <div v-for="(item, i) in topMistakes" :key="item.kpId" class="top-item">
          <div class="top-rank">{{ i + 1 }}</div>
          <div class="top-info">
            <div class="top-title">{{ item.title }}</div>
            <div class="top-meta">错 {{ item.count }} 次</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 近 7 天学习 -->
    <section class="section">
      <SectionTitle title="📅 近 7 天学习" />
      <div class="week-card">
        <div class="week-chart">
          <div v-for="d in weekDays" :key="d.date" class="day-col">
            <div class="day-bar-wrap">
              <div
                class="day-bar"
                :style="{ height: barHeight(d.count) + '%' }"
                :class="{ active: d.count > 0 }"
              ></div>
            </div>
            <div class="day-count" v-if="d.count > 0">{{ d.count }}</div>
            <div class="day-label">{{ d.label }}</div>
          </div>
        </div>
        <div class="week-summary">
          本周共学习 <b>{{ weekTotal }}</b> 个知识点
        </div>
      </div>
    </section>

    <!--
      自定义成就包（V1.4 · B3）。放在家长视图里而不是设置页：
      "给孩子加一条我们家的家规"是家长的决定，不是技术设置。
    -->
    <section class="section">
      <AppCard title="🧩 自定义成就包">
        <CustomPackPanel />
      </AppCard>
    </section>

    <!-- 学习包管理 -->
    <section class="section">
      <SectionTitle title="📦 学习包管理" />
      <div class="pkg-card">
        <div class="pkg-info">
          <div class="pkg-title">已导入 {{ packageStore.packages.length }} 个学习包</div>
          <div class="pkg-desc">管理学习内容、导入新包、导出备份</div>
        </div>
        <AppButton type="primary" @click="goToImport">📥 管理学习包</AppButton>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import PageHeader from '@/components/ui/PageHeader.vue'
import SectionTitle from '@/components/ui/SectionTitle.vue'
import StatCard from '@/components/ui/StatCard.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import CustomPackPanel from '@/components/CustomPackPanel.vue'
import {
  MAX_PROFILES,
  ProfileLimitError,
  createProfile,
  deleteProfile,
  onProfileChange,
  profilesState,
  renameProfile,
  type ProfileMeta,
  type ProfilesState,
} from '@core/profile/currentProfile'
import { switchProfileAndReload } from '@core/profile/switchProfileService'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import {
  ACHIEVEMENTS,
  loadUnlocked,
  type UnlockedRecord,
} from '@core/motivation/achievements'
import { CATEGORY_META, CATEGORY_ORDER } from '@core/motivation/achievementMeta'
import { TAXONOMY } from '@core/motivation/achievementTaxonomy'
import {
  distributionBySource,
  evidenceLines,
  type OverviewItem,
} from '@core/motivation/achievementOverview'
import {
  loadDiscoveryEnabled,
  saveDiscoveryEnabled,
} from '@core/motivation/achievementDiscovery'
import { computeMasterySummary, masteryBySubject } from '@core/mastery/masterySummary'

const router = useRouter()
const userDataStore = useUserDataStore()
const packageStore = usePackageStore()

// ---------- 档案管理（V1.4 · B1）----------
const dialog = useDialog()
const message = useMessage()
const profileState = ref<ProfilesState>(profilesState())
const creating = ref(false)
const draftName = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')
let offProfileChange: (() => void) | null = null

/** 档案变了（不管是谁触发的：本页或 AppShell 的切换器）→ 本页数据全部重读 */
async function reloadProfileScopedData(): Promise<void> {
  await userDataStore.loadUserData()
  unlockedRecords.value = await loadUnlocked()
  discoveryEnabled.value = await loadDiscoveryEnabled()
}

function startCreate(): void {
  if (profileState.value.list.length >= MAX_PROFILES) {
    message.warning(`最多 ${MAX_PROFILES} 个档案`)
    return
  }
  creating.value = true
  draftName.value = ''
}

async function commitCreate(): Promise<void> {
  const name = draftName.value.trim()
  if (!name) {
    message.warning('给档案起个名字')
    return
  }
  try {
    await createProfile(name)
    creating.value = false
    draftName.value = ''
    // 新建后会自动切到新档案（见 createProfile），所以要把页面数据切过去
    await reloadProfileScopedData()
    message.success(`已创建档案「${name}」`)
  } catch (e) {
    if (e instanceof ProfileLimitError) {
      message.error(`最多 ${MAX_PROFILES} 个档案，可以先把不用的档案导出后再删`)
      return
    }
    message.error('创建失败：' + (e as Error).message)
  }
}

function startRename(p: ProfileMeta): void {
  editingId.value = p.id
  editingName.value = p.name
}

async function commitRename(): Promise<void> {
  const id = editingId.value
  if (!id) return
  const name = editingName.value.trim()
  if (!name) {
    message.warning('档案名不能为空')
    return
  }
  try {
    await renameProfile(id, name)
    editingId.value = null
  } catch (e) {
    message.error('改名失败：' + (e as Error).message)
  }
}

async function onSwitch(id: string): Promise<void> {
  if (id === profileState.value.activeId) return
  try {
    await switchProfileAndReload(id)
  } catch (e) {
    message.error('切换失败：' + (e as Error).message)
  }
}

/**
 * 删除档案：二次确认用 `dialog.error`（红色按钮），文案里明确写"数据不回收"。
 * 不强制先导出 —— 强制拦截只会让人去找破解办法，不如把风险说清楚。
 */
function onDelete(p: ProfileMeta): void {
  dialog.error({
    title: `删除档案「${p.name}」？`,
    content: '该档案的进度、错题、成就、打卡将无法再访问，此操作不可恢复。建议先导出备份。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteProfile(p.id)
        await reloadProfileScopedData()
        message.success('已删除档案')
      } catch (e) {
        message.error('删除失败：' + (e as Error).message)
      }
    },
  })
}

const unlockedRecords = ref<UnlockedRecord[]>([])
/** 发现机制开关（家长可关；默认开，见 achievementDiscovery 的注释） */
const discoveryEnabled = ref(true)

async function toggleDiscovery(enabled: boolean): Promise<void> {
  discoveryEnabled.value = enabled
  await saveDiscoveryEnabled(enabled)
}

onMounted(async () => {
  offProfileChange = onProfileChange((next) => {
    profileState.value = next
  })
  await userDataStore.loadUserData()
  await packageStore.loadPackages()
  unlockedRecords.value = await loadUnlocked()
  discoveryEnabled.value = await loadDiscoveryEnabled()
})

onUnmounted(() => {
  offProfileChange?.()
})

/** ===== 成就概览（A2-5，只读）===== */
// 分类元数据与 Home 的成就图鉴共用同一份定义（避免标签/图标漂移）
const CAT_ORDER = CATEGORY_ORDER
const CAT_META = CATEGORY_META

const achTotal = ACHIEVEMENTS.length
const achUnlockedCount = computed(() => unlockedRecords.value.length)

const achByCategory = computed(() =>
  CAT_ORDER.map((cat) => {
    const items = ACHIEVEMENTS.filter((a) => a.category === cat)
    const unlocked = items.filter((a) => unlockedRecords.value.some((r) => r.id === a.id)).length
    return { cat, ...CAT_META[cat], unlocked, total: items.length }
  }),
)

/** 家长端只拿得到「静态定义 + 库里的记录」，先拼成概览输入（与图鉴页同一套字段语义） */
const overviewItems = computed<OverviewItem[]>(() => {
  const byId = new Map(unlockedRecords.value.map((r) => [r.id, r]))
  return ACHIEVEMENTS.map((a) => {
    const rec = byId.get(a.id)
    return {
      id: a.id,
      source: TAXONOMY[a.id].source,
      earned: !!rec,
      unlockedAt: rec?.unlockedAt,
      evidence: rec?.evidence,
      title: a.title,
      icon: a.icon,
    }
  })
})

/** 四类来源分布（恒 4 桶，顺序固定） */
const achBySource = computed(() => distributionBySource(overviewItems.value))

/** 解锁证据（只取已解锁且证据非空的，按日期倒序，最多 3 条） */
const recentEvidence = computed(() => evidenceLines(overviewItems.value, 3))

const recentUnlocked = computed(() => {
  const rows = unlockedRecords.value
    .map((r) => ({ ...r, def: ACHIEVEMENTS.find((a) => a.id === r.id) }))
    .filter((r) => !!r.def)
  // unlockedAt 倒序；空日期排最后
  rows.sort((a, b) => {
    if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt)
    if (a.unlockedAt) return -1
    if (b.unlockedAt) return 1
    return 0
  })
  return rows.slice(0, 3)
})

/** 总览统计 */
const stats = computed(() => {
  // V1.3 · T04：与 Home / Report 同源（去重口径），见 computeMasterySummary
  const summary = computeMasterySummary(packageStore.packages, userDataStore.progress)
  const totalKp = summary.total
  const progress = userDataStore.progress
  const mastered = summary.mastered
  const learning = summary.learning
  const needReview = summary.needReview
  const studySeconds = progress.reduce((sum, p) => sum + (p.studySeconds ?? 0), 0)
  const studyMinutes = Math.round(studySeconds / 60)

  // 连续天数
  const days = new Set<string>()
  for (const p of progress) {
    if (p.lastStudiedAt) days.add(p.lastStudiedAt.slice(0, 10))
  }
  const sorted = Array.from(days).sort().reverse()
  let continuousDays = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < sorted.length; i++) {
    const expect = new Date(today.getTime() - i * 86400000)
    if (sorted[i] === expect.toISOString().slice(0, 10)) continuousDays++
    else break
  }

  return { totalKp, mastered, learning, needReview, studyMinutes, continuousDays }
})

/** 学科分布 */
const subjectStats = computed(() => {
  const labelMap: Record<string, string> = { math: '数学', chinese: '语文', english: '英语' }
  // V1.3 · T04：与整体掌握率同源（masteryBySubject 内部走 canonicalize，
  // 不再用"裸 kpId → 学科"映射——那会被后写入的包覆盖学科归属）
  return masteryBySubject(packageStore.packages, userDataStore.progress).map((s) => ({
    subject: s.subject,
    label: labelMap[s.subject] ?? s.subject,
    total: s.total,
    mastered: s.mastered,
    rate: s.rate,
  }))
})

/** 高频错题 Top 5 */
const topMistakes = computed(() => {
  const kpMap = new Map<string, string>()
  for (const pkg of packageStore.packages) {
    for (const kp of pkg.knowledgePoints ?? []) {
      kpMap.set(kp.id, kp.title)
    }
  }

  const countMap = new Map<string, number>()
  for (const m of userDataStore.mistakes) {
    if (m.mastered) continue
    for (const kpId of m.knowledgePointIds ?? []) {
      countMap.set(kpId, (countMap.get(kpId) ?? 0) + m.wrongCount)
    }
  }

  return Array.from(countMap.entries())
    .map(([kpId, count]) => ({ kpId, title: kpMap.get(kpId) ?? kpId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
})

/** 近 7 天 */
const weekDays = computed(() => {
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const result: Array<{ date: string; label: string; count: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const dateStr = d.toISOString().slice(0, 10)
    const count = userDataStore.progress.filter(
      p => p.lastStudiedAt?.slice(0, 10) === dateStr
    ).length
    result.push({ date: dateStr, label: labels[d.getDay()], count })
  }
  return result
})

const weekTotal = computed(() => weekDays.value.reduce((sum, d) => sum + d.count, 0))

function barHeight(count: number): number {
  const max = Math.max(...weekDays.value.map(d => d.count), 1)
  return Math.max((count / max) * 100, count > 0 ? 10 : 0)
}

function goToImport() {
  router.push('/settings/import')
}
</script>

<style scoped lang="scss">
.parent-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 24px;
}

/* 页头 / 小节标题 / 概览卡 / 进度条 已由基元承载（PageHeader / SectionTitle / StatCard / ProgressBar）。 */

.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ========== 总览 ========== */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;

  @media (max-width: 1200px) { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
}

/* `.ov-card` 已由 StatCard 基元承载（card-bg + border-color + radius-md + shadow-sm + tone 值色）。 */

/* ========== 成就概览 ========== */
.ach-discovery-toggle {
  display: flex;
  align-items: flex-start;
  gap: $space-2;
  font-size: $font-2xs;
  font-weight: 600;
  color: $text-sub;
  line-height: $leading-normal;
  cursor: pointer;

  input {
    margin-top: 2px;
    flex-shrink: 0;
    accent-color: $primary-color;
  }
}

/* 两排"x / y"小卡（小组 / 来源）需要标题区分，否则家长分不清哪排是什么 */
.ach-row-label {
  font-size: $font-2xs;
  font-weight: 700;
  color: $text-muted;
  margin-bottom: -8px;
}

.ach-sources {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;

  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
}

.ach-source {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  background: $bg-color-hover;
  border-radius: $radius-md;

  .ach-source-name {
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-sub;
  }
  .ach-source-count {
    font-size: $font-2xs;
    font-weight: 800;
    color: $text-main;
    font-variant-numeric: tabular-nums;
  }
}

.ach-evidence {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px dashed $border-color;

  .ach-evidence-title {
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-muted;
  }
}

.ach-evidence-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ach-evidence-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: $font-2xs;
  line-height: $leading-normal;
  color: $text-sub;

  .evidence-icon {
    flex-shrink: 0;
  }
  .evidence-text {
    min-width: 0;
    word-break: break-word;
  }
  b {
    color: $text-main;
    font-weight: 700;
  }
}

.ach-overview-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px 20px;
  box-shadow: $shadow-sm;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ach-total {
  display: flex;
  align-items: baseline;
  gap: 10px;

  .ach-total-value {
    font-size: 28px;
    font-weight: 800;
    color: $primary-text;
    line-height: 1;
  }
  .ach-total-label {
    font-size: 13px;
    color: $text-sub;
    font-weight: 600;
  }
}

.ach-cats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;

  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
}

.ach-cat {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: $bg-color-hover;
  border-radius: $radius-md;

  .ach-cat-icon { font-size: 16px; line-height: 1; }
  .ach-cat-name { font-size: 12px; font-weight: 700; color: $text-main; flex: 1; }
  .ach-cat-count { font-size: 12px; font-weight: 800; color: $primary-text; }
}

.ach-recent {
  .ach-recent-title {
    font-size: 13px;
    font-weight: 800;
    color: $text-main;
    margin-bottom: 8px;
  }
  .ach-recent-empty {
    font-size: 12px;
    color: $text-muted;
  }
  .ach-recent-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ach-recent-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid $border-light;
    border-radius: $radius-sm;

    .recent-icon { font-size: 18px; line-height: 1; }
    .recent-name { flex: 1; font-size: 13px; font-weight: 700; color: $text-main; }
    .recent-date { font-size: 11px; color: $text-muted; font-weight: 600; }
  }
}

/* ========== 学科分布 ========== */
.subject-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px 20px;
  box-shadow: $shadow-sm;
}

.subject-item {
  .subject-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .subject-name {
      font-size: 14px;
      font-weight: 700;
      color: $text-main;
    }
    .subject-count {
      font-size: 12px;
      color: $text-sub;
      font-weight: 600;
    }
  }
}

/* ========== 错题 Top ========== */
.top-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 12px 16px;
  box-shadow: $shadow-sm;
}

.top-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 4px;
  border-bottom: 1px dashed $border-light;

  &:last-child { border-bottom: none; }

  .top-rank {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $bg-color-hover;
    color: $text-sub;
    font-weight: 800;
    font-size: 13px;
    flex-shrink: 0;

    &:first-child {
      background: $gradient-warm;
      color: $on-strong;
    }
  }

  .top-info {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;

    .top-title {
      font-size: 14px;
      font-weight: 600;
      color: $text-main;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .top-meta {
      font-size: 12px;
      color: $danger-text;
      font-weight: 700;
      flex-shrink: 0;
    }
  }
}

/* ========== 近 7 天 ========== */
.week-card {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 20px 24px;
  box-shadow: $shadow-sm;

  .week-chart {
    display: flex;
    justify-content: space-around;
    align-items: flex-end;
    height: 160px;
    padding: 8px 0 20px;

    .day-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      height: 100%;
      justify-content: flex-end;

      .day-bar-wrap {
        width: 50%;
        height: 100px;
        display: flex;
        align-items: flex-end;

        .day-bar {
          width: 100%;
          background: $bg-color-hover;
          border-radius: 6px 6px 0 0;
          transition: height 0.4s;

          &.active {
            background: $gradient-primary;
          }
        }
      }
      .day-count {
        font-size: 11px;
        color: $primary-text;
        font-weight: 700;
        margin-top: 4px;
      }
      .day-label {
        font-size: 11px;
        color: $text-sub;
        margin-top: 4px;
      }
    }
  }

  .week-summary {
    font-size: 13px;
    color: $text-sub;
    text-align: center;
    padding-top: 12px;
    border-top: 1px dashed $border-light;

    b {
      color: $primary-text;
      font-size: 16px;
      margin: 0 3px;
    }
  }
}

/* ========== 学习包管理 ========== */
.pkg-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px 20px;
  box-shadow: $shadow-sm;

  .pkg-info {
    .pkg-title {
      font-size: 15px;
      font-weight: 700;
      color: $text-main;
      margin-bottom: 4px;
    }
    .pkg-desc {
      font-size: 12px;
      color: $text-sub;
    }
  }
}
/* ========== 档案管理（V1.4 · B1） ========== */
.profile-panel {
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 16px 18px;
  box-shadow: $shadow-sm;
}

.profile-hint {
  font-size: 12px;
  line-height: 1.7;
  color: $text-sub;
  margin: 0 0 12px;

  strong { color: $text-main; }
}

.profile-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: $radius-md;
  background: $bg-color-hover;

  &__name {
    font-size: 14px;
    font-weight: 700;
    color: $text-main;
  }

  &__badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: $primary-light;
    color: $primary-text;
  }

  &__spacer { flex: 1; }
}

.profile-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  font-size: 14px;
  color: $text-main;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;

  &:focus-visible {
    outline: 2px solid var(--primary-text);
    outline-offset: 1px;
  }
}

.profile-create {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-btn {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
  color: $text-main;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) { background: $bg-color-hover; }

  &:focus-visible {
    outline: 2px solid var(--primary-text);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--primary {
    color: $primary-text;
    border-color: $primary-text;
  }

  &--danger {
    color: var(--danger-text);
    border-color: var(--danger-text);
  }
}
</style>