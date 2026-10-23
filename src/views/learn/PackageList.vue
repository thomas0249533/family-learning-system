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
            :class="cardStatusClass(pkgStatus(pkg))"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-green"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-green">每日一练</span>
                <!-- G3 · 跨设备分享：`.stop` 防止触发整卡的学习跳转 -->
                <button
                  class="pkg-share-btn"
                  type="button"
                  aria-label="分享此学习包"
                  title="分享此学习包"
                  @click.stop="openShare(pkg)"
                >📤</button>
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
            <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
            <span class="pkg-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[pkgStatus(pkg)] }}</span>
            <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[pkgStatus(pkg)] }}</span>
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
            :class="cardStatusClass(pkgStatus(pkg))"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-blue"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-blue">{{ typeLabel(getPackageType(pkg)) }}</span>
                <button
                  class="pkg-share-btn"
                  type="button"
                  aria-label="分享此学习包"
                  title="分享此学习包"
                  @click.stop="openShare(pkg)"
                >📤</button>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级 ·
                {{ pkg.manifest.term === 'up' ? '上册' : '下册' }} · {{ pkg.manifest.edition }}
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
            <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
            <span class="pkg-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[pkgStatus(pkg)] }}</span>
            <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[pkgStatus(pkg)] }}</span>
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
            :class="cardStatusClass(pkgStatus(pkg))"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-orange"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-orange">专项测验</span>
                <button
                  class="pkg-share-btn"
                  type="button"
                  aria-label="分享此学习包"
                  title="分享此学习包"
                  @click.stop="openShare(pkg)"
                >📤</button>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级
                <template v-if="(pkg.manifest as any).sourceUnitIds?.length">
                  · 基于 {{ (pkg.manifest as any).sourceUnitIds.length }} 个单元
                </template>
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
            <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
            <span class="pkg-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[pkgStatus(pkg)] }}</span>
            <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[pkgStatus(pkg)] }}</span>
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
            :class="cardStatusClass(pkgStatus(pkg))"
            @click="selectPackage(pkg)"
          >
            <div class="pkg-card-accent accent-red"></div>
            <div class="pkg-card-body">
              <div class="pkg-card-head">
                <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
                <span class="pkg-card-tag tag-red">冲刺卷</span>
                <button
                  class="pkg-share-btn"
                  type="button"
                  aria-label="分享此学习包"
                  title="分享此学习包"
                  @click.stop="openShare(pkg)"
                >📤</button>
              </div>
              <div class="pkg-card-meta">
                {{ subjectLabel(pkg.manifest.subject) }} · {{ pkg.manifest.grade }}年级
              </div>
            </div>
            <div class="pkg-card-arrow">→</div>
            <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
            <span class="pkg-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[pkgStatus(pkg)] }}</span>
            <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[pkgStatus(pkg)] }}</span>
          </div>
        </div>
      </section>

      <EmptyState
        v-if="groups.textbook.length + groups.daily.length + groups.special.length + groups.sprint.length === 0"
        description="暂无学习包，请先导入"
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
import { useRouter } from 'vue-router'
import { NSpin, NModal, NSpace } from 'naive-ui'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import {
  CARD_STATUS_LABEL,
  CARD_STATUS_MARK,
  cardStatusClass,
  packageCardStatusOf,
  type CardStatus,
} from '@core/learning/cardStatus'
import { buildShareString, drawQrToCanvas } from '@core/share/qrcode'
import type { LearningPackageRecord } from '@/db'

const packageStore = usePackageStore()
const userDataStore = useUserDataStore()
const router = useRouter()
const loading = ref(true)

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
 * 一次算完一屏，模板只查表。
 *
 * 聚合走 **`progress` 模式**（`packageCardStatusOf` 内部固定传）：这一格问的是
 * 「这天做了没做完」，所以「练了一部分」必须留在 `learning`（黄），不能因为有一个
 * 知识点到期就整格挂红。45 天的包有几百个知识点，「全部同时已掌握」不可达 ——
 * 用 `attention` 口径会让包卡几乎永不变绿（详见 `cardStatus.ts` 文件头）。
 */
const statusByPackageId = computed<Map<string, CardStatus>>(() => {
  const map = new Map<string, CardStatus>()
  for (const pkg of packageStore.packages) {
    map.set(pkg.packageId, packageCardStatusOf(pkg.packageId, userDataStore.progress))
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
@import '@/core/styles/card-status';

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
      color: $primary-text;
    }
  }

  &.exam:hover {
    border-color: $warning-color;
    .pkg-card-arrow { color: $warning-text; }
  }

  /* ===== D1 · 掌握状态（每日一练的「打卡」状态）=====
     底色只用 --badge-{tone}-bg（= -light），与 --{tone}-text 角标同属
     contrast-report.ts 的 MUST_PASS 白名单；未学（none）不改底色。
     左侧 4px 板块色条（.pkg-card-accent）与背景色正交，不冲突。 */
  &.is-learning { @include card-status-surface(learning); }
  &.is-review   { @include card-status-surface(review); }
  &.is-mastered { @include card-status-surface(mastered); }

  .pkg-status-mark {
    @include card-status-mark-slot;
    @include card-status-mark-corner;
    @include card-status-ink(none);
  }

  &.is-learning .pkg-status-mark { @include card-status-ink(learning); }
  &.is-review .pkg-status-mark { @include card-status-ink(review); }
  &.is-mastered .pkg-status-mark { @include card-status-ink(mastered); }

  /* 读屏专用文本：视觉不可见，但「掌握状态：需复习」会被读出来 */
  .sr-only { @include sr-only; }

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

    &.tag-blue { background: var(--badge-primary-bg); color: $primary-text; }
    &.tag-green { background: var(--badge-success-bg); color: $success-text; }
    &.tag-orange { background: var(--badge-warning-bg); color: $warning-text; }
    &.tag-red { background: var(--badge-danger-bg); color: $danger-text; }
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

/* 分享按钮：卡片头里的低存在感入口，悬停才浮出主色 */
.pkg-share-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-color-hover);
    color: var(--primary-text);
  }

  &:focus-visible {
    outline: var(--focus-ring-w) solid var(--focus-ring);
  }
}
</style>