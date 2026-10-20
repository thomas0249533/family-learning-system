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

      <!-- 故事卡（V1.4 · B6）：只补"关联学习记录"这一段 ——
           解锁日期与证据已经在上面 rows 里了，再列一遍是同一条信息出现两次。
           这一段的标题必须是「现在的记录」：它是实时算的，会随学习变化，
           而上面那两行是解锁瞬间固化的事实。两者口径不同，文案上必须分开说。 -->
      <section v-if="story && story.canSave" class="ach-detail__story">
        <h3 class="ach-detail__story-title">现在的记录</h3>
        <dl v-if="story.related.length > 0" class="ach-detail__rows">
          <div v-for="row in story.related" :key="row.label" class="ach-detail__row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
        <p v-else class="ach-detail__story-empty">
          还读不到关联的学习记录（可能是学习包被删掉了）。
        </p>
        <p class="ach-detail__story-note">
          故事卡会把「解锁日期 + 当时的证据 + 现在的记录」拼成一张图片，可以保存在相册里。
        </p>
        <div class="ach-detail__story-actions">
          <AppButton size="small" :loading="saving" @click="saveStory">保存故事卡</AppButton>
        </div>
      </section>
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
//
// ## 故事卡（V1.4 · B6）
// 打开时异步取一次"实时上下文"再调 `storyOf()` 纯函数。三条约束：
//   1. **只在已解锁时取** —— 未解锁的卡片不需要故事卡，省一次库读；
//   2. **取不到就让这一段消失**，不弹错、不阻塞弹层（详情本身仍然有信息量）；
//   3. 关联记录里的知识点标题来自 packageStore，包没加载时先补一次 `loadPackages()`
//      （否则所有人都会看到"还读不到关联的学习记录"，而这其实只是没加载）。
// =====================================================================
import { computed, ref, watch } from 'vue'
import { NModal, useMessage } from 'naive-ui'
import AppBadge from './ui/AppBadge.vue'
import AppButton from './ui/AppButton.vue'
import ProgressBar from './ui/ProgressBar.vue'
import type { AchievementItem } from '@core/motivation/achievementMeta'
import { CATEGORY_META } from '@core/motivation/achievementMeta'
import { TIER_META } from '@core/motivation/achievementTaxonomy'
import { detailOf } from '@core/motivation/achievementDetail'
import { storyOf, type AchievementStory } from '@core/motivation/achievementStory'
import { exportStoryCard } from '@core/report/storyImage'
import { localDateKey } from '@core/report/canvasKit'
import { useAchievementStore } from '@core/stores/achievement'
import { usePackageStore } from '@core/stores/package'
import { currentProfile } from '@core/profile/currentProfile'

const props = defineProps<{
  show: boolean
  item: AchievementItem | null
}>()

const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const store = useAchievementStore()
const packageStore = usePackageStore()
const message = useMessage()

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

/* ---------------- 故事卡 ---------------- */

const story = ref<AchievementStory | null>(null)
const saving = ref(false)

/** 知识点标题解析器：包 id + 知识点 id → 标题（查不到返回空串，故事卡会少一行） */
function kpTitleOf(packageId: string, kpId: string): string {
  const pkg = packageStore.packages.find((p) => p.packageId === packageId)
  if (!pkg) return ''
  return pkg.knowledgePoints?.find((kp) => kp.id === kpId)?.title ?? ''
}

async function loadStory(item: AchievementItem): Promise<void> {
  if (!item.earned || item.silhouetted) {
    story.value = null
    return
  }
  try {
    if (packageStore.packages.length === 0) await packageStore.loadPackages()
    const ctx = await store.storyContext()
    story.value = storyOf(item, ctx, {
      profileName: currentProfile()?.name ?? '我',
      today: localDateKey(),
      tierLabel: TIER_META[item.tier].label,
      categoryLabel: CATEGORY_META[item.category].label,
      kpTitleOf,
    })
  } catch (e) {
    // 故事卡是附加信息：读失败就让这一段不出现，不影响详情本身
    console.warn('[AchievementDetailModal] 故事卡上下文读取失败', e)
    story.value = null
  }
}

/**
 * 弹层打开时才取上下文，关闭时清空。
 *
 * 用 `watch(visible)` 而不是 `watch(item)`：同一枚成就反复开关时，
 * 关掉再打开必须**重算**（孩子可能刚做完一组题），所以以"可见"为触发条件。
 */
watch(
  visible,
  (open) => {
    if (open && props.item) void loadStory(props.item)
    else story.value = null
  },
  { immediate: true },
)

async function saveStory(): Promise<void> {
  const s = story.value
  if (!s || saving.value) return
  saving.value = true
  try {
    const filename = await exportStoryCard(s)
    message.success(`已保存 ${filename}`)
  } catch (e) {
    message.error('保存故事卡失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    saving.value = false
  }
}
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

/* ========== 故事卡（V1.4 · B6） ========== */
.ach-detail__story {
  display: flex;
  flex-direction: column;
  gap: $space-2;
  padding-top: $space-3;
  border-top: 1px solid $border-color;
}

.ach-detail__story-title {
  margin: 0;
  font-size: $font-2xs;
  font-weight: 800;
  color: $text-sub;
  letter-spacing: 0.2px;
}

/* 说明文字与"读不到"都走 muted：这两句都不是主角，
   不能抢上面那两行真实记录的注意力 */
.ach-detail__story-note,
.ach-detail__story-empty {
  margin: 0;
  font-size: $font-2xs;
  color: $text-muted;
  line-height: $leading-normal;
}

/* 按钮不撑满整行：弹层主体是内容，操作靠左贴住内容左边缘 */
.ach-detail__story-actions {
  display: flex;
  align-self: flex-start;
}
</style>
