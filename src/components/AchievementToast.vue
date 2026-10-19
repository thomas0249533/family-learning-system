<template>
  <teleport to="body">
    <transition name="ach-pop">
      <div v-if="current" class="ach-toast" :class="{ 'reduce-motion': reduceMotion }">
        <span class="toast-glow" aria-hidden="true"></span>
        <span class="toast-icon">{{ current.icon }}</span>
        <div class="toast-body">
          <div class="toast-tag">🎉 {{ current.hidden ? '隐藏成就已解锁！' : '解锁新成就' }}</div>
          <div class="toast-title">{{ current.title }}</div>
          <div class="toast-desc">{{ current.desc }}</div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
// =====================================================================
// AchievementToast · 新解锁徽章动效（A2-4）
// ---------------------------------------------------------------------
// · 居中/顶部弹出徽章卡片，轻微放大回弹（复用 --ease-spring）+ 光晕；
// · 多枚依次播放（队列）；
// · 尊重 prefers-reduced-motion：命中即退化为静态提示（无动画/回弹）。
// 用法：模板挂 <AchievementToast ref="toastRef" />，调用 toastRef.enqueue(defs)。
// =====================================================================
import { ref, onUnmounted } from 'vue'
import type { AchievementDef } from '@core/motivation/achievements'
import { tierOf } from '@core/motivation/achievementTaxonomy'

const current = ref<AchievementDef | null>(null)
const queue: AchievementDef[] = []
let timer: ReturnType<typeof setTimeout> | null = null

/** 是否命中「减少动态效果」偏好 */
const reduceMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const DISPLAY_MS = reduceMotion ? 2200 : 2600
const GAP_MS = reduceMotion ? 0 : 180

/** 超过这个枚数就合并成一条（避免一次弹 5 条像中奖广告，PRD §6.3） */
const MERGE_THRESHOLD = 4

/** 层级权重：合并提示取"最高层级那枚"的图标 */
const TIER_RANK: Record<string, number> = { common: 1, advanced: 2, rare: 3, hidden: 4 }

/**
 * 合并成一条提示。**信息不丢失**：全部记录仍然进「已获得」区，
 * 这里只是不做逐条播放。
 */
function mergedDef(defs: AchievementDef[]): AchievementDef {
  const top = [...defs].sort((a, b) => (TIER_RANK[tierOf(b.id)] ?? 0) - (TIER_RANK[tierOf(a.id)] ?? 0))[0]
  const names = defs.slice(0, 3).map((d) => d.title).join('、')
  return {
    id: '__merged__',
    icon: top?.icon ?? '🏅',
    title: `解锁 ${defs.length} 枚新成就`,
    desc: defs.length > 3 ? `${names} 等` : names,
    category: top?.category ?? 'M',
    check: () => true,
  }
}

/** 依次播放队列中的徽章（≥4 枚时合并为一条）。 */
function enqueue(defs: AchievementDef[]) {
  const list = (defs ?? []).filter(Boolean)
  if (list.length === 0) return
  if (list.length >= MERGE_THRESHOLD) queue.push(mergedDef(list))
  else queue.push(...list)
  if (!current.value) playNext()
}

function playNext() {
  const next = queue.shift()
  if (!next) {
    current.value = null
    return
  }
  current.value = next
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    current.value = null
    timer = setTimeout(playNext, GAP_MS)
  }, DISPLAY_MS)
}

onUnmounted(() => {
  if (timer !== null) clearTimeout(timer)
})

defineExpose({ enqueue })
</script>

<style scoped lang="scss">
.ach-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 22px;
  min-width: 260px;
  max-width: 92vw;
  background: $card-bg;
  border: 2px solid $primary-color;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  overflow: hidden;

  .toast-glow {
    position: absolute;
    inset: -40%;
    background: radial-gradient(circle at 30% 30%, rgba(var(--primary-rgb), 0.28), transparent 60%);
    pointer-events: none;
  }

  .toast-icon {
    position: relative;
    font-size: 40px;
    line-height: 1;
    z-index: 1;
  }

  .toast-body {
    position: relative;
    z-index: 1;
    min-width: 0;

    .toast-tag {
      font-size: 11px;
      font-weight: 800;
      color: $primary-text;
      letter-spacing: 0.3px;
    }
    .toast-title {
      font-size: 16px;
      font-weight: 800;
      color: $text-main;
      margin-top: 2px;
    }
    .toast-desc {
      font-size: 12px;
      color: $text-sub;
      margin-top: 2px;
    }
  }

  /* 减少动态效果：不放大/不回弹 */
  &.reduce-motion {
    animation: none;
  }
}

.ach-pop-enter-active {
  animation: achPopDown var(--duration-slower) var(--ease-spring) both;
}
.ach-pop-leave-active {
  animation: achPopUp var(--duration-base) ease both;
}

@keyframes achPopDown {
  0% { opacity: 0; transform: translate(-50%, -18px) scale(0.9); }
  100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
@keyframes achPopUp {
  0% { opacity: 1; transform: translate(-50%, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -12px) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .ach-pop-enter-active,
  .ach-pop-leave-active {
    animation: none;
  }
}
</style>
