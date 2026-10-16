<template>
  <div class="package-list-page">
    <n-spin v-if="loading" size="large" class="loading-spin" />

    <template v-else>
      <!-- 每日一练 -->
      <section v-if="groups.daily.length > 0" class="group-section">
        <header class="group-header">
          <div class="group-title-wrap">
            <span class="group-icon">📅</span>
            <h2 class="group-title">每日一练</h2>
          </div>
          <span class="group-count">{{ groups.daily.length }}</span>
        </header>
        <div class="package-grid">
          <div
            v-for="pkg in groups.daily"
            :key="pkg.packageId"
            class="pkg-card"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-green"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-green">每日一练</span>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级 ·
                {{ pkg.manifest.term === 'up' ? '上册' : '下册' }} · {{ pkg.manifest.edition }}
                <template v-if="dailyMeta(pkg)">
                  · {{ dailyMeta(pkg) }}
                </template>
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
          </div>
        </div>
      </section>

      <!-- 教材 -->
      <section v-if="groups.textbook.length > 0" class="group-section">
        <header class="group-header">
          <div class="group-title-wrap">
            <span class="group-icon">📚</span>
            <h2 class="group-title">教材</h2>
          </div>
          <span class="group-count">{{ groups.textbook.length }}</span>
        </header>
        <div class="package-grid">
          <div
            v-for="pkg in groups.textbook"
            :key="pkg.packageId"
            class="pkg-card"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-blue"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-blue">{{ typeLabel(getPackageType(pkg)) }}</span>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级 ·
                {{ pkg.manifest.term === 'up' ? '上册' : '下册' }} · {{ pkg.manifest.edition }}
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
          </div>
        </div>
      </section>

      <!-- 专项 -->
      <section v-if="groups.special.length > 0" class="group-section">
        <header class="group-header">
          <div class="group-title-wrap">
            <span class="group-icon">🎯</span>
            <h2 class="group-title">专项突破</h2>
          </div>
          <span class="group-count">{{ groups.special.length }}</span>
        </header>
        <div class="package-grid">
          <div
            v-for="pkg in groups.special"
            :key="pkg.packageId"
            class="pkg-card exam"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-orange"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-orange">专项测验</span>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级
                <template v-if="(pkg.manifest as any).sourceUnitIds?.length">
                  · 基于 {{ (pkg.manifest as any).sourceUnitIds.length }} 个单元
                </template>
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
          </div>
        </div>
      </section>

      <!-- 冲刺 -->
      <section v-if="groups.sprint.length > 0" class="group-section">
        <header class="group-header">
          <div class="group-title-wrap">
            <span class="group-icon">🏁</span>
            <h2 class="group-title">冲刺模拟</h2>
          </div>
          <span class="group-count">{{ groups.sprint.length }}</span>
        </header>
        <div class="package-grid">
          <div
            v-for="pkg in groups.sprint"
            :key="pkg.packageId"
            class="pkg-card exam"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-red"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-red">冲刺卷</span>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
          </div>
        </div>
      </section>

      <n-empty
        v-if="groups.textbook.length + groups.daily.length + groups.special.length + groups.sprint.length === 0"
        description="暂无学习包，请先导入"
        class="empty-card"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NEmpty, NSpin } from 'naive-ui'
import { usePackageStore } from '@core/stores/package'
import type { LearningPackageRecord } from '@/db'

const packageStore = usePackageStore()
const router = useRouter()
const loading = ref(true)

onMounted(async () => {
  await packageStore.loadPackages()
  loading.value = false
})

function getPackageType(pkg: LearningPackageRecord): string {
  const m = pkg.manifest as any
  return m.packageType ?? m.type ?? ''
}

function isInternal(pkg: LearningPackageRecord): boolean {
  const m = pkg.manifest as any
  return m.isInternal === true
}

const groups = computed(() => {
  const textbook: LearningPackageRecord[] = []
  const daily: LearningPackageRecord[] = []
  const special: LearningPackageRecord[] = []
  const sprint: LearningPackageRecord[] = []

  for (const pkg of packageStore.packages) {
    if (isInternal(pkg)) continue
    const type = getPackageType(pkg)
    if (type === 'daily') daily.push(pkg)
    else if (type === 'special') special.push(pkg)
    else if (type === 'sprint') sprint.push(pkg)
    else textbook.push(pkg)
  }

  return { textbook, daily, special, sprint }
})

/** 每日一练：展示「N 天 · 每天 M 个板块」 */
function dailyMeta(pkg: LearningPackageRecord): string {
  const units = (pkg as any).units ?? []
  if (units.length === 0) return ''
  const boards = units[0]?.topics?.length ?? 0
  return boards > 0 ? `${units.length} 天 · 每天 ${boards} 个板块` : `${units.length} 天`
}

function selectPackage(pkg: LearningPackageRecord) {
  packageStore.setCurrentPackage(pkg)
  router.push(`/learn/${pkg.packageId}`)
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

function subjectLabel(subject?: string): string {
  switch (subject) {
    case 'math': return '数学'
    case 'chinese': return '语文'
    case 'english': return '英语'
    default: return subject ?? ''
  }
}
</script>

<style scoped lang="scss">
.package-list-page {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 16px;
}

.loading-spin {
  display: flex;
  justify-content: center;
  margin-top: 40px;
}

.group-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .group-title-wrap {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .group-icon { font-size: 20px; line-height: 1; }

  .group-title {
    font-size: 17px;
    font-weight: 800;
    color: $text-main;
    margin: 0;
    letter-spacing: 0.2px;
  }

  .group-count {
    font-size: 12px;
    font-weight: 700;
    color: $text-sub;
    background: $bg-color-hover;
    padding: 3px 10px;
    border-radius: 20px;
  }
}

.package-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}

.pkg-card {
  position: relative;
  display: flex;
  align-items: stretch;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s ease;
  min-height: 84px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
    border-color: $primary-color;

    .pkg-card-arrow {
      transform: translateX(4px);
      color: $primary-color;
    }
  }

  &.exam:hover {
    border-color: $warning-color;
    .pkg-card-arrow { color: $warning-color; }
  }

  .pkg-card-accent {
    width: 4px;
    flex-shrink: 0;

    &.accent-blue { background: $primary-color; }
    &.accent-green { background: $success-color; }
    &.accent-orange { background: $warning-color; }
    &.accent-red { background: $danger-color; }
  }

  .pkg-card-body {
    flex: 1;
    min-width: 0;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
  }

  .pkg-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pkg-card-title {
    font-size: 15px;
    font-weight: 700;
    color: $text-main;
    margin: 0;
    line-height: 1.4;
    flex: 1;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .pkg-card-tag {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;

    &.tag-blue { background: rgba(var(--primary-rgb), 0.12); color: $primary-color; }
    &.tag-green { background: rgba(var(--success-rgb), 0.12); color: $success-color; }
    &.tag-orange { background: rgba(var(--warning-rgb), 0.12); color: $warning-color; }
    &.tag-red { background: rgba(var(--danger-rgb), 0.12); color: $danger-color; }
  }

  .pkg-card-meta {
    font-size: 12px;
    color: $text-sub;
    line-height: 1.5;
  }

  .pkg-card-arrow {
    display: flex;
    align-items: center;
    padding: 0 16px;
    color: $text-muted;
    font-size: 18px;
    transition: all 0.2s;
  }
}

.empty-card {
  background: $card-bg;
  border-radius: $radius-lg;
  padding: 60px 20px;
  box-shadow: $shadow-sm;
  border: 1px solid $border-color;
}
</style>