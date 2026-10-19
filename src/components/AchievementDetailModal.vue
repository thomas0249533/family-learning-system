<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    class="ach-detail"
    :title="detail?.title ?? ''"
    style="max-width: 420px;"
  >
    <div v-if="item && detail" class="ach-detail__body">
      <!-- 描述：与卡片同源（item.desc），不另写文案 -->
      <p class="ach-detail__desc">{{ item.desc }}</p>

      <dl class="ach-detail__rows">
        <div v-for="row in detail.rows" :key="row.label" class="ach-detail__row">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>

      <!-- 仅"未解锁且可进度化"：进度条 + current/target + 提示 -->
      <div v-if="detail.showProgress" class="ach-detail__progress">
        <div class="ach-detail__bar-row">
          <ProgressBar :value="item.current" :max="item.target" size="sm" />
          <span class="ach-detail__count">{{ item.current }} / {{ item.target }}</span>
        </div>
        <p class="ach-detail__hint">{{ detail.hint }}</p>
      </div>

      <footer class="ach-detail__footer">
        <AppBadge
          :tone="item.earned ? 'success' : 'primary'"
          :icon="item.earned ? '✓' : '🎯'"
        >{{ detail.cta }}</AppBadge>
        <AppButton size="small" @click="visible = false">关闭</AppButton>
      </footer>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
// =====================================================================
// AchievementDetailModal · 单枚成就详情弹层（V1.3 · P1）
// ---------------------------------------------------------------------
// 分工：**所有"显示什么"都在 `@core/motivation/achievementDetail`**，
// 本组件只做两件事：算一次 `detailOf(...)`、把结果画成 DOM。
// 这样 node 环境的单测能覆盖全部规则（剪影不可开、三类形态、N≥1…），
// 组件层没有第二套判断。
//
// 剪影（隐藏成就未解锁）：`canOpen === false` → `visible` 恒为 false，
// 弹层根本不会渲染，`n-modal` 默认 `display-directive="if"` 也不留 DOM。
// =====================================================================
import { computed } from 'vue'
import { NModal } from 'naive-ui'
import AppBadge from './ui/AppBadge.vue'
import AppButton from './ui/AppButton.vue'
import ProgressBar from './ui/ProgressBar.vue'
import type { AchievementItem } from '@core/motivation/achievementMeta'
import { CATEGORY_META } from '@core/motivation/achievementMeta'
import { TIER_META } from '@core/motivation/achievementTaxonomy'
import { detailOf } from '@core/motivation/achievementDetail'

const props = defineProps<{
  show: boolean
  item: AchievementItem | null
}>()

const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const detail = computed(() => {
  const it = props.item
  if (!it) return null
  // 层级只用中性词（常见 / 进阶 / 稀有 / 隐藏），不出现"稀有度 / SSR"这类暗示
  return detailOf(it, TIER_META[it.tier].label, CATEGORY_META[it.category].label)
})

/** 只读代理：打开与否由父级 show + 剪影守卫共同决定，关闭时回传给父级 */
const visible = computed({
  get: () => props.show && detail.value?.canOpen === true,
  set: (v: boolean) => {
    if (!v) emit('update:show', false)
  },
})
</script>

<style scoped lang="scss">
.ach-detail__body {
  display: flex;
  flex-direction: column;
  gap: $space-3;
}

.ach-detail__desc {
  margin: 0;
  font-size: $font-sm;
  color: $text-sub;
  line-height: $leading-normal;
}

.ach-detail__rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: $space-2;
  padding: $space-3;
  background: $bg-color-hover;
  border-radius: $radius-md;
}

.ach-detail__row {
  display: flex;
  align-items: baseline;
  gap: $space-2;

  dt {
    flex-shrink: 0;
    min-width: 64px;
    font-size: $font-2xs;
    font-weight: 700;
    color: $text-muted;
  }

  dd {
    margin: 0;
    min-width: 0;
    font-size: $font-2xs;
    font-weight: 600;
    color: $text-main;
    line-height: $leading-normal;
    word-break: break-word;
  }
}

.ach-detail__progress {
  display: flex;
  flex-direction: column;
  gap: $space-2;
}

.ach-detail__bar-row {
  display: flex;
  align-items: center;
  gap: $space-2;
}

.ach-detail__count {
  flex-shrink: 0;
  font-size: $font-2xs;
  font-weight: 700;
  color: $text-sub;
  font-variant-numeric: tabular-nums;
}

.ach-detail__hint {
  margin: 0;
  font-size: $font-2xs;
  font-weight: 600;
  color: $text-muted;
  line-height: $leading-normal;
}

.ach-detail__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-3;
  padding-top: $space-1;
}
</style>
