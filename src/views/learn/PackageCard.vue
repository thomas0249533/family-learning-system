<template>
  <div
    class="pkg-card"
    :class="[cardStatusClass(status), { exam: modeMeta.exam }]"
    @click="selectPackage(pkg)"
  >
    <div class="pkg-card-accent" :class="`accent-${modeMeta.accent}`"></div>

    <div class="pkg-card-body">
      <div class="pkg-card-head">
        <h3 class="pkg-card-title">{{ pkg.manifest.title }}</h3>
        <span class="pkg-card-tag" :class="modeMeta.tagClass">{{ modeMeta.tag }}</span>
        <!-- G3 · 跨设备分享：`.stop` 防止触发整卡的学习跳转 -->
        <button
          class="pkg-share-btn"
          type="button"
          aria-label="分享此学习包"
          title="分享此学习包"
          @click.stop="$emit('share', pkg)"
        >📤</button>
      </div>

      <div class="pkg-card-meta">
        <span class="subject-chip" :class="subjectChipClass(pkg.manifest.subject)">
          {{ subjectLabel(pkg.manifest.subject) }}
        </span>
        <!-- 教材/冲刺走默认「年级 · 册 · 版本」；专项/每日一练用更贴合的文案 -->
        <span v-if="customMeta" class="meta-text">{{ customMeta }}</span>
        <span v-else class="meta-text">
          {{ pkg.manifest.grade }}年级 ·
          {{ pkg.manifest.term === 'up' ? '上册' : '下册' }} · {{ pkg.manifest.edition }}
        </span>
      </div>
    </div>

    <div class="pkg-card-arrow">→</div>

    <!-- D1 · 掌握状态角标：字形是颜色之外的冗余信号（色弱 / 灰度打印可分辨） -->
    <span class="pkg-status-mark" aria-hidden="true">{{ CARD_STATUS_MARK[status] }}</span>
    <span class="sr-only">掌握状态：{{ CARD_STATUS_LABEL[status] }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePackageStore } from '@core/stores/package'
import {
  CARD_STATUS_LABEL,
  CARD_STATUS_MARK,
  cardStatusClass,
  type CardStatus,
} from '@core/learning/cardStatus'
import type { LearningPackageRecord } from '@/db'

const props = defineProps<{
  /** 所属类型：决定卡片左侧色条、类型 tag、hover 配色 */
  mode: 'textbook' | 'daily' | 'special' | 'sprint'
  pkg: LearningPackageRecord
  /** 由父层算好的掌握状态（聚合 + 题目级「全部完成」通道） */
  status: CardStatus
}>()

defineEmits<{ (e: 'share', pkg: LearningPackageRecord): void }>()

const packageStore = usePackageStore()
const router = useRouter()

/**
 * 模式 → 视觉套餐。教材/每日一练是常规包（hover 主色），专项/冲刺是测验卷（hover 警示色）。
 * 教材的 tag 跟着包自身类型走（基础包/单元包/学期包），其余三档 tag 固定。
 */
const modeMeta = computed(() => {
  switch (props.mode) {
    case 'daily':
      return { accent: 'green', tagClass: 'tag-green', tag: '每日一练', exam: false }
    case 'special':
      return { accent: 'orange', tagClass: 'tag-orange', tag: '专项测验', exam: true }
    case 'sprint':
      return { accent: 'red', tagClass: 'tag-red', tag: '冲刺卷', exam: true }
    default:
      return { accent: 'blue', tagClass: 'tag-blue', tag: typeLabel(getPackageType(props.pkg)), exam: false }
  }
})

/** 中间那行元信息：专项显示「基于 N 个单元」，每日一练显示「N 天 · 每天 M 板块」 */
const customMeta = computed<string | undefined>(() => {
  const m = props.pkg.manifest as any
  const type = getPackageType(props.pkg)
  if (type === 'special') {
    const n = m.sourceUnitIds?.length
    return n ? `${m.grade}年级 · 基于 ${n} 个单元` : `${m.grade}年级`
  }
  if (type === 'daily') {
    const d = dailyMeta(props.pkg)
    return d ? `${m.grade}年级 · ${m.term === 'up' ? '上册' : '下册'} · ${d}` : undefined
  }
  return undefined
})

function getPackageType(pkg: LearningPackageRecord): string {
  const m = pkg.manifest as any
  return m.packageType ?? m.type ?? ''
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

function subjectChipClass(subject?: string): string {
  switch (subject) {
    case 'math': return 'chip-math'
    case 'chinese': return 'chip-chinese'
    case 'english': return 'chip-english'
    default: return 'chip-neutral'
  }
}

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
</script>

<style scoped lang="scss">
@import '@/core/styles/card-status';

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
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    color: $text-sub;
    line-height: 1.5;

    /* V2.8 · 学科彩色软底胶囊：扫视卡片列表时学科一眼可辨，
       册别/版本降为普通文本，信息层级更清楚 */
    .subject-chip {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 9px;
      border-radius: 10px;
      line-height: 1.6;

      &.chip-math { background: var(--badge-primary-bg); color: $primary-text; }
      &.chip-chinese { background: var(--badge-warning-bg); color: $warning-text; }
      &.chip-english { background: var(--badge-success-bg); color: $success-text; }
      &.chip-neutral { background: var(--badge-neutral-bg); color: $text-sub; }
    }

    .meta-text { white-space: nowrap; }
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
