<template>
  <!-- 悬浮入口：只在触发条件满足时出现（发光 + 轻微浮动） -->
  <button
    v-if="boxAvailable && stage === 'idle'"
    type="button"
    class="blind-box-fab"
    :aria-label="`有神秘盲盒（${ownedCount}/${BLIND_BOX_TOTAL}）`"
    @click="startOpen"
  >
    <span class="blind-box-fab__icon" aria-hidden="true">🎁</span>
    <span class="blind-box-fab__text">有惊喜</span>
  </button>

  <!-- 全屏开箱遮罩 -->
  <div
    v-if="stage !== 'idle'"
    class="blind-box-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="stage === 'done' ? '盲盒奖励' : '打开盲盒'"
    @click.self="stage === 'done' ? close() : undefined"
  >
    <!-- 开箱舞台：盒子（摇晃 → 盖子飞起 → 金光） -->
    <div v-if="stage !== 'done'" class="blind-box-stage" :class="{ 'is-shaking': stage === 'shake' }">
      <div class="blind-box" :class="{ 'is-open': stage === 'open' }" aria-hidden="true">
        <div class="blind-box__lid"><span class="blind-box__bow">🎀</span></div>
        <div class="blind-box__body"><span class="blind-box__q">？</span></div>
        <div class="blind-box__burst" aria-hidden="true"></div>
      </div>
      <p class="blind-box-hint">{{ stage === 'shake' ? '打开中…' : '点击盲盒，开出惊喜！' }}</p>
      <button
        v-if="stage === 'ready'"
        type="button"
        class="blind-box-open-btn"
        @click="doDraw"
      >打开盲盒</button>
    </div>

    <!-- 结果卡：3D 翻转登场（reduced-motion 时淡入） -->
    <div v-else class="blind-box-reward" :class="{ 'is-flipped': flipped }">
      <p class="blind-box-reward__label">🎉 恭喜开出</p>
      <div class="blind-box-reward__icon" aria-hidden="true">{{ reward?.icon }}</div>
      <h2 class="blind-box-reward__title">{{ reward?.title }}</h2>
      <p class="blind-box-reward__desc">{{ reward?.desc }}</p>
      <p class="blind-box-reward__collect">盲盒收藏 {{ ownedCount }} / {{ BLIND_BOX_TOTAL }}</p>
      <AppButton type="primary" @click="close">收下了</AppButton>
    </div>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// BlindBoxEntrance · 盲盒悬浮入口 + 开箱动画（V2.8 · C3）
// ---------------------------------------------------------------------
// 引擎（evaluateBlindBoxTrigger / performBlindBoxDraw）全部在 C2 的
// `blindBox.ts`，本组件只负责「可见性 + 表演」两件事：
//   · 可见性 = 触发条件满足（单日解锁 ≥3 / 连续 ≥7 天 / 单日专注 ≥60 分钟，
//     且今天没抽过、没集齐 5 枚 —— 判定全在引擎里）；
//   · 表演 = 摇晃 → 盖子飞起 → 金光 → 卡片翻转；`prefers-reduced-motion`
//     时全部跳过、直接淡入结果卡（动效是增强，不是依赖）。
// 数据源复用 achievement store 的 records / buildContext（与结算同一份口径）。
// =====================================================================
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useAchievementStore } from '@core/stores/achievement'
import {
  BLIND_BOX_TOTAL,
  evaluateBlindBoxTrigger,
  loadBlindBoxState,
  performBlindBoxDraw,
} from '@core/motivation/blindBox'
import type { AchievementDef } from '@core/motivation/achievements'

const achievementStore = useAchievementStore()

/** 生命周期：ready（盒子在）→ shake → open（盖飞 + 金光）→ done（结果卡） */
type Stage = 'idle' | 'ready' | 'shake' | 'open' | 'done'

const stage = ref<Stage>('idle')
const reward = ref<AchievementDef | null>(null)
const flipped = ref(false)
const ownedCount = ref(0)

const boxAvailable = computed(() => stage.value === 'idle' && available.value)
const available = ref(false)

/** 是否尊重「减少动效」（SSR 安全：仅客户端读 matchMedia） */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/** 评估触发条件（挂载 + 记录变化时各跑一次） */
async function evaluate(): Promise<void> {
  try {
    await achievementStore.load()
    const state = await loadBlindBoxState()
    ownedCount.value = state.owned.length
    const ctx = await achievementStore.storyContext()
    const result = evaluateBlindBoxTrigger({
      unlockedRecords: achievementStore.records,
      streak: ctx.streak,
      dailyStats: ctx.dailyStats ?? [],
      now: new Date(),
      state,
    })
    available.value = result.available
  } catch (e) {
    // 盲盒是纯激励层：任何读取失败都只表现为"今天没有盒子"，绝不影响首页
    console.warn('[blind-box] 触发评估失败（按无盒子处理）', e)
    available.value = false
  }
}

function startOpen(): void {
  stage.value = 'ready'
}

/** 点击「打开盲盒」：摇晃 → 开盖金光 → 结果卡 */
async function doDraw(): Promise<void> {
  if (prefersReducedMotion()) {
    // 降级：跳过全部动画，直接抽 + 淡入结果卡
    await finishDraw()
    stage.value = 'done'
    await nextFrame()
    flipped.value = true
    return
  }

  stage.value = 'shake'
  await sleep(1000)
  stage.value = 'open'
  await finishDraw()
  await sleep(900)
  stage.value = 'done'
  await nextFrame()
  flipped.value = true
}

async function finishDraw(): Promise<void> {
  const def = await performBlindBoxDraw()
  reward.value = def
  if (def) ownedCount.value += 1
}

function close(): void {
  stage.value = 'idle'
  available.value = false
  reward.value = null
  flipped.value = false
  // 抽完当天不会再出现；但明天/新条件满足时要能重新评估 —— 路由回来时 Home 重挂载会重跑
  void evaluate()
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

onMounted(() => {
  void evaluate()
})

// 结算可能刚解锁 3 枚（今天第 3 枚到手）→ 盒子要立刻出现，不等下一次挂载
watch(
  () => achievementStore.records.length,
  () => {
    if (stage.value === 'idle') void evaluate()
  },
)
</script>

<style lang="scss">
// 悬浮入口（固定定位，Home 独有；避开底部导航区域）。
// ★ 动效纪律：按钮**自身**不做位移动画 —— 无限浮动会让包围盒永不稳定，
//   自动化点击（Playwright actionability）会一直等不到它停下来；
//   浮动放在内部图标上，光晕走 box-shadow（都不改变按钮的几何位置）。
.blind-box-fab {
  position: fixed;
  right: 18px;
  bottom: 86px;
  z-index: 150;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 14px;
  border: 2px solid $warning;
  border-radius: 18px;
  background: $card-bg;
  cursor: pointer;
  box-shadow: 0 0 0 0 rgba(var(--warning-rgb), 0.5);
  animation: blind-box-glow 2s ease-in-out infinite;

  .blind-box-fab__icon {
    display: inline-block;
    font-size: 26px;
    animation: blind-box-float 2.4s ease-in-out infinite;
  }
  .blind-box-fab__text {
    font-size: $font-xs;
    font-weight: 700;
    color: $warning-text;
  }

  &:focus-visible {
    outline: 3px solid $primary-color;
    outline-offset: 2px;
  }
}

@keyframes blind-box-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

@keyframes blind-box-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--warning-rgb), 0.5);
  }
  50% {
    box-shadow: 0 0 14px 4px rgba(var(--warning-rgb), 0.4);
  }
}

// 全屏遮罩
.blind-box-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  // 全屏暗幕：与 Parent.vue 的浮层同一写法（rgba 数值不算硬编码色，check:hex 口径）
  background: rgba(0, 0, 0, 0.55);
  padding: $space-4;
}

.blind-box-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $space-4;

  &.is-shaking .blind-box {
    animation: blind-box-shake 0.45s ease-in-out infinite;
  }
}

// 礼盒（纯 CSS：盖 + 身 + 金光）
.blind-box {
  position: relative;
  width: 150px;
  height: 130px;

  &__lid {
    position: absolute;
    top: 0;
    left: -6px;
    width: 162px;
    height: 38px;
    border-radius: 10px;
    background: $gradient-primary;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.4), opacity 0.6s;
  }
  &__bow {
    font-size: 22px;
    transform: translateY(-18px);
  }
  &__body {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 150px;
    height: 92px;
    border-radius: 0 0 12px 12px;
    background: $primary-color;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  &__q {
    color: var(--text-on-primary);
    font-size: 34px;
    font-weight: 800;
  }

  // 金光：开盖时从盒口炸开的一圈光带
  &__burst {
    position: absolute;
    left: 50%;
    bottom: 60px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: $warning-light;
    opacity: 0;
    transform: translate(-50%, 0) scale(0.3);
    pointer-events: none;
  }

  &.is-open {
    .blind-box__lid {
      transform: translateY(-70px) rotate(-24deg);
      opacity: 0;
    }
    .blind-box__burst {
      animation: blind-box-burst 0.9s ease-out forwards;
    }
  }
}

@keyframes blind-box-shake {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-7deg);
  }
  75% {
    transform: rotate(7deg);
  }
}

@keyframes blind-box-burst {
  0% {
    opacity: 0;
    transform: translate(-50%, 0) scale(0.3);
  }
  35% {
    opacity: 1;
    transform: translate(-50%, -10px) scale(3.2);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -40px) scale(6.5);
  }
}

.blind-box-hint {
  color: var(--text-on-primary);
  font-size: $font-sm;
  font-weight: 600;
}

.blind-box-open-btn {
  padding: 10px 26px;
  border: none;
  border-radius: $radius-md;
  background: $gradient-primary;
  color: var(--text-on-primary);
  font-size: $font-md;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid $warning;
    outline-offset: 2px;
  }
}

// 结果卡：3D 翻转登场
.blind-box-reward {
  background: $card-bg;
  border-radius: $radius-lg;
  box-shadow: $shadow-md;
  padding: $space-5 $space-6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $space-2;
  max-width: 320px;
  text-align: center;
  opacity: 0;
  transform: perspective(600px) rotateY(90deg);
  transition: opacity 0.5s ease-out, transform 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2);

  &.is-flipped {
    opacity: 1;
    transform: perspective(600px) rotateY(0deg);
  }

  &__label {
    font-size: $font-sm;
    font-weight: 700;
    color: $text-sub;
  }
  &__icon {
    font-size: 52px;
  }
  &__title {
    font-size: $font-lg;
    font-weight: 800;
    color: $text-main;
  }
  &__desc {
    font-size: $font-sm;
    color: $text-sub;
  }
  &__collect {
    font-size: $font-xs;
    color: $text-sub;
    font-weight: 600;
  }
}

// 减少动效：跳过摇晃/翻转，只保留淡入
@media (prefers-reduced-motion: reduce) {
  .blind-box-fab {
    animation: none;
  }
  .blind-box-stage.is-shaking .blind-box {
    animation: none;
  }
  .blind-box.is-open .blind-box__burst {
    animation: none;
    opacity: 0;
  }
  .blind-box-reward {
    transform: none;
    transition: opacity 0.3s ease-out;
  }
}
</style>
