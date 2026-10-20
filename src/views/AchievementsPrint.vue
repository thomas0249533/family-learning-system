<template>
  <div class="print-root">
    <div class="print-toolbar">
      <AppButton type="primary" @click="doPrint">打印</AppButton>
      <AppButton @click="router.back()">返回</AppButton>
      <span class="print-toolbar-hint">
        打印件固定浅色，不跟随夜间主题；黑白打印机也能看出层级（★ 数量 + 边框粗细 + 层级文字）。
      </span>
    </div>

    <div v-if="pages.length === 0" class="print-empty">
      还没有成就可打印 —— 先做几道题，解锁第一枚再来。
    </div>

    <div v-else class="print-pages">
      <section v-for="(page, index) in pages" :key="`${page.category}-${index}`" class="print-page">
        <header class="print-page-head">
          <span class="print-profile">{{ profileName }}</span>
          <h2 class="print-group-name">{{ CATEGORY_META[page.category].label }}</h2>
          <span v-if="page.continued" class="print-continued">（续）</span>
          <span class="print-head-meta">
            已获得 {{ page.groupEarned }} / {{ page.groupTotal }}
          </span>
        </header>

        <ul class="print-grid">
          <li
            v-for="item in page.items"
            :key="item.id"
            class="print-card"
            :class="[`tier-${item.tier}`, { 'is-earned': item.earned }]"
          >
            <div class="print-card-top">
              <span class="print-icon" aria-hidden="true">{{ item.icon }}</span>
              <span class="print-title">{{ item.title }}</span>
            </div>

            <!-- 颜色的替代编码之一：层级文字 + 星标数量（AC-P2-10） -->
            <div class="print-tier">
              <span v-if="item.stars > 0" class="print-stars" aria-hidden="true">{{ '★'.repeat(item.stars) }}</span>
              <span>{{ TIER_META[item.tier].label }}</span>
            </div>

            <p class="print-desc">{{ item.desc }}</p>

            <div class="print-card-foot">
              <span class="print-state">{{ item.earned ? '已获得' : '未获得' }}</span>
              <span v-if="item.earned">{{ item.unlockedAt || '较早' }}</span>
              <!-- 重复印记（B6）：打印件上也保留，只是不加粗不放大 -->
              <span v-if="item.earned && item.repeatCount >= 2" class="print-repeat">
                第 {{ item.repeatCount }} 次
              </span>
            </div>
          </li>
        </ul>

        <footer class="print-page-foot">
          <span>导出于 {{ exportDate }}</span>
          <!-- 页码只在这里生成：算法里生成会让续页出现两套总数 -->
          <span class="print-page-no">{{ pageLabel(index, pages.length) }}</span>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 成就打印件（V1.4 · B5 / D4 按小组分页）
 *
 * ## 为什么是独立路由而不是 `window.print()` 盖在成就页上
 * 成就页有筛选、折叠、发现卡、导入面板 —— 打印它等于把一堆交互控件印到纸上，
 * 还得为每一块写 `@media print { display: none }`（漏一块就印出一截 UI）。
 * 独立路由只有"纸"本身：4 页、每页一个小组、页眉页脚固定。
 *
 * ## 不自动调用 `window.print()`
 * 用户点进来先看到预览（"这一版打出来是什么样"），再决定按不按打印。
 * 自动弹系统打印框会把人吓一跳，而且取消之后还得再找入口。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { CATEGORY_META } from '@core/motivation/achievementMeta'
import { TIER_META } from '@core/motivation/achievementTaxonomy'
import { paginateByCategory, pageLabel } from '@core/report/printLayout'
import { currentProfile } from '@core/profile/currentProfile'
import { useAchievementStore } from '@core/stores/achievement'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import '@/core/styles/print.scss'

const router = useRouter()
const achievementStore = useAchievementStore()
const userDataStore = useUserDataStore()
const packageStore = usePackageStore()

const profileName = computed(() => currentProfile()?.name ?? '我')

// `store.items` 已经含自定义包的定义与进度（与图鉴同一份），不再另建一套
const pages = computed(() => paginateByCategory(achievementStore.items))

/** 打印件上的日期：本地口径（不能用 toISOString，会差一天） */
const exportDate = (() => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
})()

onMounted(async () => {
  // 直接进这个路由（刷新/分享链接）时 store 可能是空的。
  // 与 Achievements.vue 同一条理由：`refreshView()` 用的上下文来自这两个 store，
  // 不先补齐就会重建出"进度全 0"的 items（打印件上的层级/星标不受影响，
  // 但分组内的顺序与"已获得 x / y"会跟着错）。
  if (achievementStore.items.length === 0) {
    await userDataStore.loadUserData()
    await packageStore.loadPackages()
    await achievementStore.refreshView()
  }
})

function doPrint(): void {
  window.print()
}
</script>
