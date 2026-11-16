<template>
  <div class="pkg-cell" :class="{ 'is-hidden': hidden }">
    <PackageCard
      :pkg="pkg"
      :mode="mode"
      :status="status"
      @share="(p) => emit('share', p)"
    />

    <!--
      隐藏入口必须是**独立按钮**，不能挂在 PackageCard 上：卡片本身是进入学习的
      导航区，点 menu 想的是"改可见性"，不是"开始练习"。
    -->
    <n-dropdown :options="menuOptions" @select="onSelect">
      <button
        class="pkg-cell__more"
        type="button"
        :aria-label="moreLabel"
      ><IconBase name="gear" size="1em" /></button>
    </n-dropdown>

    <span v-if="hidden" class="pkg-cell__badge">已隐藏</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NDropdown } from 'naive-ui'
import PackageCard from './PackageCard.vue'
import IconBase from '@/components/ui/IconBase.vue'
import { type CardStatus } from '@core/learning/cardStatus'
import type { LearningPackageRecord } from '@/db'

const props = defineProps<{
  pkg: LearningPackageRecord
  mode: 'textbook' | 'daily' | 'special' | 'sprint'
  status: CardStatus
  hidden: boolean
}>()

const emit = defineEmits<{
  (e: 'share', pkg: LearningPackageRecord): void
  (e: 'toggle-hidden', packageId: string): void
}>()

const menuOptions = computed(() => [
  { label: props.hidden ? '取消隐藏' : '隐藏', key: 'toggle' },
])

const moreLabel = computed(() =>
  `${props.pkg.manifest?.title ?? props.pkg.packageId} 的更多操作（${props.hidden ? '取消隐藏' : '隐藏'}）`
)

function onSelect(): void {
  emit('toggle-hidden', props.pkg.packageId)
}
</script>

<style scoped lang="scss">
.pkg-cell {
  position: relative;

  /* 隐藏 = 从主列表撤下，不是禁用：打开开关后仍可点进去用 */
  &.is-hidden { opacity: 0.55; }
}

.pkg-cell__more {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $card-bg;
  color: $text-sub;
  font-size: var(--font-sm);
  cursor: pointer;

  &:hover { color: $primary-text; border-color: $primary-color; }
  &:focus-visible {
    outline: var(--focus-ring-w) solid var(--btn-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
}

.pkg-cell__badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  z-index: 1;
  padding: 1px 8px;
  border-radius: 20px;
  background: var(--badge-warning-bg);
  color: $warning-text;
  font-size: var(--font-2xs);
  font-weight: 700;
}
</style>
