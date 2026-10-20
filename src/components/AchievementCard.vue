<template>
  <!-- li 只负责列表语义 + 同排等高；真正可点的是里面的原生控件 -->
  <li class="ach-card-wrap">
    <component
      :is="clickable ? 'button' : 'div'"
      class="ach-card"
      :class="[`tier-${item.tier}`, { earned: item.earned, silhouette: item.silhouetted }]"
      :type="clickable ? 'button' : undefined"
      :aria-label="clickable ? ariaLabel : undefined"
      @click="onActivate"
      @keydown.enter.prevent="onActivate"
      @keydown.space.prevent="onActivate"
    >
      <span class="ach-icon" aria-hidden="true">{{ item.icon }}</span>

      <!-- 内层一律 span：<button> 的合法内容只有 phrasing content，塞 div 会被严格校验判违规。
           视觉上用 display:block 还原块级排布（见样式里逐条说明）。 -->
      <span class="ach-body">
        <span class="ach-title-row">
          <span class="ach-title">{{ item.title }}</span>
          <!-- 层级用星标数量表达（色觉冗余），不是唯一编码 -->
          <span v-if="item.stars > 0" class="ach-stars" aria-hidden="true">{{ stars }}</span>
          <span v-if="item.earned && item.tier === 'hidden'" class="ach-hidden-tag">隐藏成就</span>
        </span>

        <span class="ach-desc">{{ item.desc }}</span>

        <!-- 已获得：证据快照 + 解锁日期 + 连环标记，**不显示进度**（"10/10"是无意义回放） -->
        <template v-if="item.earned">
          <!-- 旧记录没有 evidence → 空串 → 该行不渲染（绝不事后补算） -->
          <span v-if="item.evidence" class="ach-evidence">{{ item.evidence }}</span>
          <span class="ach-meta">解锁于 {{ item.unlockedAt || '较早' }}</span>
          <span v-if="item.chainLabel" class="ach-chain">{{ item.chainLabel }}</span>
          <!-- 重复纪念印记（V1.4 · B6）：只记录事实，不加分、不改层级、不给奖励。
               徽章是"我做到过"，印记是"我又做到了一次"——两者语义不同，所以不做成
               更亮的勾，而是一个安静的次级标签。次数进 aria-label（见 script），
               否则读屏用户完全得不到这个信息。 -->
          <span v-if="item.repeatCount >= 2" class="ach-repeat">第 {{ item.repeatCount }} 次</span>
        </template>

        <!-- 未获得（非隐藏）：可进度化 → 细进度条 + 文案；二值 → 只给文案 -->
        <template v-else-if="!item.silhouetted">
          <!-- 进度条在 <button> 里只能是装饰：ARIA 规定 button 的后代全部 presentational，
               内层 role="progressbar" 会被读屏器丢弃。进度信息**不丢**——按钮的 aria-label
               里已含 item.hint，而 hint 的唯一来源就是 progressText（"已完成 3/10 · 还差 7"）。
               带语义的进度条在详情弹层里（不在 button 内），那边保留 role。 -->
          <span
            v-if="showBar"
            class="ach-progress"
            aria-hidden="true"
          >
            <span class="ach-progress-fill" :style="{ width: item.percent + '%' }"></span>
          </span>
          <span class="ach-hint">{{ item.hint }}</span>
        </template>

        <!-- 隐藏成就：达成前不泄露任何信息（真实标题/描述不进 DOM） -->
        <span v-else class="ach-hint">达成后揭晓</span>
      </span>

      <!-- 已获得 → 打勾；未获得（未揭晓的剪影除外）→ 小锁角标。
           锁与真实图标**并存**：PRD §5.3 表 B 原意是"别让孩子误以为自己已经有了"，
           但 25 枚全换成 🔒 会让图鉴失去辨识度（与 §5.1"未获得的也能看"冲突），
           所以用"灰化真实图标 + 锁角标"同时满足两个意图。 -->
      <span v-if="item.earned" class="ach-seal" aria-hidden="true">✓</span>
      <span v-else-if="!item.silhouetted" class="ach-lock" aria-hidden="true">🔒</span>
    </component>
  </li>
</template>

<script setup lang="ts">
// =====================================================================
// AchievementCard · 单枚成就卡（三类形态）
// ---------------------------------------------------------------------
//   已获得     → 层级边框 + 星标 + 证据行 + 解锁日期 + 连环标记 + 打勾
//   未获得     → 灰化 + 进度条（可进度化时）+ 进度提示文案
//   隐藏未解锁 → 剪影（🔒 + ？？？），**真实标题/描述连字符串都不进视图**
//
// 层级视觉（PRD §4.2）只消费既有 token：边框粗细 + 星标数量 + 底色软填充，
// 颜色**不是唯一编码**（星标数量与 aria-label 里的中性描述承担冗余）。
// 儿童视图不出现"稀有 / 史诗 / SSR"字样。
//
// 语义用 `<li>` 包一层原生控件：可点的是 `<button>`，剪影是 `<div>`。
// 这样 `<ul>` 仍然是列表（28 个 listitem），控件也自带 role / 焦点 / 键盘行为，
// aria-label 保证读屏不会只读到锁图标。
//
// ## 可点开详情（V1.3 · P1）
// `.ach-card` 这个类名必须继续挂在**可点的那个元素**上 —— e2e 的 28 / 25 / 3
// 计数与 375px 的 getBoundingClientRect 断言全靠它，所以 li 换成
// `.ach-card-wrap`（只负责列表语义与同排等高），卡片本体用 `:is` 切 button/div。
// 剪影卡是 div：不可聚焦、不可点，DOM 里也没有任何真实信息。
// =====================================================================
import { computed } from 'vue'
import type { AchievementItem } from '@core/motivation/achievementMeta'
import { TIER_META } from '@core/motivation/achievementTaxonomy'

const props = defineProps<{ item: AchievementItem }>()

/** 点开详情：剪影不可点（未解锁的隐藏成就必须保持"点不开"） */
const emit = defineEmits<{ (e: 'select', item: AchievementItem): void }>()

const clickable = computed(() => !props.item.silhouetted)

function onActivate(): void {
  if (!clickable.value) return
  emit('select', props.item)
}

const stars = computed(() => '★'.repeat(props.item.stars))

/**
 * 只在"真的能填"的时候画进度条：`target === 1` 的事件型成就画一条 0%/100% 的条
 * 没有信息量，还容易被误读成"卡住了"。
 */
const showBar = computed(() => props.item.metered && props.item.target > 1)

const ariaLabel = computed(() => {
  const it = props.item
  const state = it.earned ? `已解锁，${it.unlockedAt || '较早'}` : `未解锁，${it.hint}`
  // 层级只给中性描述（"层级：进阶"），不出现"稀有"这类稀缺暗示
  const tier = it.tier === 'hidden' ? '' : `，${TIER_META[it.tier].ariaSuffix}`
  // 重复次数必须进读屏文本：卡面上的"第 2 次"是纯视觉的，
  // 只写 aria-hidden 徽章等于把这条信息对读屏用户藏起来了
  const repeat = it.earned && it.repeatCount >= 2 ? `，第 ${it.repeatCount} 次达成` : ''
  return `${it.title}，${state}${tier}${repeat}`
})
</script>

<style scoped lang="scss">
/* li 不再自己当卡片：只提供列表语义，并让里面的控件撑满同一行的高度。
   grid + 单格：li 被外层 .ach-list 的 grid 拉成同排等高后，这一格（auto 行）
   会被 align-content: stretch 撑满，里面的 button 再 align-self: stretch 填满，
   于是同排卡片仍然等高（换成 flex 也能做到，这里按 grid 写法保持最少假设）。 */
.ach-card-wrap {
  display: grid;
}

.ach-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: $space-3;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  padding: $space-3 $space-4;

  /* ---- 原生 button 重置（本组件唯一的视觉风险点，逐条说明） ----
     · width: 100%      —— button 默认按内容收缩，不撑满 li，会破坏同排对齐；
     · font: inherit    —— 否则 button 用系统 UI 字体（字号/行高/字重全变），中文观感与全站不一致；
     · color: inherit   —— 避免 UA 的 buttontext 色透到未显式着色的文本（如图标）；
     · text-align: left —— button 默认居中，卡片正文必须左对齐；
     · appearance: none —— 去掉各平台原生按钮的立体/圆角外观，交给下面的 border/background。
     background / border / padding 上面已经写过，不需要重复。 */
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  appearance: none;

  transition: border-color $duration-fast $ease-standard,
    box-shadow $duration-fast $ease-standard,
    transform $duration-fast $ease-standard;

  .ach-icon {
    font-size: $font-xl;
    line-height: 1.1;
    flex-shrink: 0;
    filter: grayscale(0.75);
    opacity: 0.7;
  }

  /* span 还原块级：<button> 只允许 phrasing content，布局靠 display 补回来 */
  .ach-body {
    display: block;
    min-width: 0;
    flex: 1;
  }

  .ach-title-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: $space-1;
  }

  .ach-title {
    font-size: $font-sm;
    font-weight: 800;
    color: $text-sub;
    line-height: $leading-tight;
  }

  .ach-stars {
    font-size: $font-2xs;
    letter-spacing: 1px;
    color: $primary-text;
  }

  .ach-hidden-tag {
    font-size: $font-2xs;
    font-weight: 700;
    color: $info-text;
    background: $info-soft;
    border-radius: $radius-full;
    padding: 0 $space-2;
  }

  .ach-desc {
    display: block;
    font-size: $font-2xs;
    color: $text-muted;
    margin-top: 2px;
    line-height: $leading-normal;
  }

  .ach-evidence {
    display: block;
    margin-top: $space-1;
    font-size: $font-2xs;
    color: $text-muted;
    line-height: $leading-normal;
  }

  .ach-meta {
    display: block;
    margin-top: 2px;
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-sub;
  }

  .ach-chain {
    display: block;
    margin-top: 2px;
    font-size: $font-2xs;
    color: $text-muted;
    letter-spacing: 0.2px;
  }

  /* 重复印记：靠右、方角、比"隐藏成就"更安静 ——
     它不该抢已获得打勾的注意力，只回答"这是第几次"。
     用 warning 软底而不是 success：success 已经是"已获得"的语义，
     再用一次会让人以为重复达成是更高级的奖励（PRD 明确不额外给奖励）。 */
  .ach-repeat {
    display: inline-block;
    margin-top: $space-1;
    padding: 1px 6px;
    border-radius: $radius-sm;
    background: $warning-light;
    color: $warning-text;
    font-size: $font-2xs;
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .ach-progress {
    display: block;
    margin-top: $space-2;
    height: 6px;
    background: $bg-color-hover;
    border-radius: $radius-full;
    overflow: hidden;

    .ach-progress-fill {
      display: block;
      height: 100%;
      background: $gradient-primary;
      border-radius: $radius-full;
      transition: width $duration-base $ease-decelerate;
    }
  }

  .ach-hint {
    display: block;
    margin-top: $space-1;
    /* 右下角有锁角标（absolute），文案让出 18px 免得压在上面 */
    padding-right: 18px;
    font-size: $font-2xs;
    font-weight: 600;
    color: $text-muted;
    line-height: $leading-normal;
  }

  /* ---------- 层级视觉：边框粗细 + 星标 + 底色（只用既有 token） ---------- */
  &.tier-advanced {
    border-width: 2px;
    border-color: $primary-color;
  }

  &.tier-rare {
    border-width: 2px;
    border-color: $success-color;
    background: $success-soft;

    .ach-stars {
      color: $success-text;
    }
  }

  &.tier-hidden {
    border-width: 2px;
    border-color: $info-color;
    background: $info-soft;
  }

  /* 已获得：去掉灰化，加一点阴影让它"立"起来 */
  &.earned {
    box-shadow: $shadow-xs;

    .ach-icon {
      filter: none;
      opacity: 1;
    }
    .ach-title {
      color: $text-main;
    }
  }

  /* 隐藏成就剪影：虚线 + 更淡 */
  &.silhouette {
    background: $bg-color-hover;
    border-style: dashed;
    border-width: 2px;
    border-color: $border-color;

    .ach-icon {
      filter: grayscale(1);
      opacity: 0.55;
    }
    .ach-title {
      letter-spacing: 2px;
      color: $text-muted;
    }
  }

  &.earned:hover {
    transform: translateY(-1px);
    box-shadow: $shadow-sm;
  }

  /* ---------- 可点开详情（只有非剪影卡才是 button） ---------- */
  &:is(button) {
    cursor: pointer;
  }

  &:is(button):hover {
    border-color: $primary-color;
    box-shadow: $shadow-sm;
  }

  /* 原生 button 自带键盘可达，焦点环直接命中它，比之前挂在 li 上更自然 */
  &:focus-visible {
    outline: 2px solid $primary-color;
    outline-offset: 2px;
  }

  /* 右下角状态角标：脱离文档流，不再从正文里抢 26px 宽度 */
  .ach-lock {
    position: absolute;
    right: $space-2;
    bottom: $space-2;
    font-size: $font-2xs;
    line-height: 1;
    opacity: 0.55;
    pointer-events: none;
  }

  .ach-seal {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: $radius-full;
    background: $success-light;
    color: $success-text;
    font-size: $font-2xs;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ach-card,
  .ach-card .ach-progress .ach-progress-fill {
    transition: none;
  }
  .ach-card.earned:hover {
    transform: none;
  }
}
</style>
