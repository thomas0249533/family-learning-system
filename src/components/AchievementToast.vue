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
import { mergeUnlocksForToast } from '@core/motivation/achievementToast'

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

/**
 * 依次播放队列中的徽章。**≥4 枚合并成一条** —— 合并规则在纯函数
 * `@core/motivation/achievementToast` 里（可单测），这里只负责入队与计时。
 */
function enqueue(defs: AchievementDef[]) {
  const playable = mergeUnlocksForToast(defs)
  if (playable.length === 0) return
  queue.push(...playable)
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
