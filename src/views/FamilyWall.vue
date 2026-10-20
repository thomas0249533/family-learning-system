<template>
  <div class="family-wall">
    <PageHeader icon="🏠" title="家庭成就墙" subtitle="每个孩子一列，各自看自己的进度" />

    <!-- 一句话说明"这里不是排行榜"。它同时是 AC-P2-8 的产品承诺：
         页面上不出现任何比较级，说明里也不出现 —— 用"各自看自己的"这种中性表述。
         措辞刻意避开"总分/完成率"这类词（禁词测试会扫全文，含注释）：
         一个否定句里出现"总分"，下一个人复制这句去当标题时就会把词带出去。 -->
    <p class="wall-note">
      这一页只是把几个孩子的成就并排放在一起看。没有名次，也没有合计算分 ——
      每个孩子只需要和昨天的自己比。
    </p>

    <div v-if="loading" class="wall-scroll" aria-busy="true">
      <AchievementWallColumn
        v-for="p in placeholders"
        :key="p.id"
        :name="p.name"
        :items="[]"
        loading
      />
    </div>

    <div v-else-if="loadError" class="wall-scroll">
      <EmptyState icon="⚠️" description="读取失败，稍后重新进这一页试试。数据没有被改动。" />
    </div>

    <div v-else-if="columns.length === 0" class="wall-scroll">
      <EmptyState icon="🏠" description="还没有档案。先到家长页建一个孩子的档案。" />
    </div>

    <!-- 横向滚动：4 列 × 320px 在窄屏放不下，宁可横向滚也不压缩成两列
         （压成两列会让"并排看"变成"上下比"） -->
    <div v-else class="wall-scroll">
      <AchievementWallColumn
        v-for="col in columns"
        :key="col.profileId"
        :name="col.name"
        :items="col.items"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * FamilyWall · 家庭成就墙（V1.4 · B4）
 *
 * ## 这一页要解决的是一件事：别让家长为了看老二去切档案
 * 之前看"两个孩子各自拿到多少"，得切档案 → 看图鉴 → 切回来，来回四次。
 * 一屏并排之后，家长能立刻看到"老二最近在习惯类上很稳，老大在精熟类上卡住了"。
 *
 * ## 三条产品红线（写进代码而不是只写在 PRD 里）
 * 1. **不做排行**：不排序、不显示名次、不显示"最高/领先/落后/超过"，也不显示百分比。
 *    有百分比就有 43% 与 57% 的比较，家庭墙会立刻变成记分牌。
 * 2. **不做总分**：总分是排行榜的另一种形态。指标只有"这个孩子自己已获得几枚"。
 * 3. **不泄露隐藏成就**：剪影对每个孩子独立成立（复用 `buildAchievementItems` 的剪影逻辑），
 *    否则"老大的剪影比老二少两个"本身就是信息。
 *
 * ## 数据怎么来（B4 的真正难点）
 * 每列都要按 `profileId` 单独取：进度/错题按行过滤，打卡/每日统计/题型走
 * `profileContext` 的**只读函数**（绕开单档案缓存，见该文件头）。
 * 自定义包的包体是全局的，但勾选是 per-profile，所以 `extraDefs` 必须每列各算一次。
 */
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AchievementWallColumn from '@/components/AchievementWallColumn.vue'
import { buildAchievementItems, type AchievementItem } from '@core/motivation/achievementMeta'
import { loadProfileWall } from '@core/motivation/profileContext'
import { enabledPackDefs } from '@core/motivation/customPackDefs'
import { loadChecks, loadPackState } from '@core/motivation/customPackStore'
import { currentProfile, listProfilesSync } from '@core/profile/currentProfile'
import type { PackageMeta } from '@core/motivation/achievements'
import { packageTypeOf } from '@/schemas/manifest'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'

interface WallColumn {
  profileId: string
  name: string
  items: AchievementItem[]
}

const userDataStore = useUserDataStore()
const packageStore = usePackageStore()

const loading = ref(true)
const columns = ref<WallColumn[]>([])
/** 读取失败 ≠ 没有档案。两者都渲染成空数组会让家长以为孩子的档案没了 */
const loadError = ref(false)

/** 骨架列：数量取真实档案数，避免加载完从 1 列突然变 4 列（布局跳动） */
const placeholders = computed(() => {
  const list = listProfilesSync()
  return list.length > 0 ? list.map((p) => ({ id: p.id, name: p.name })) : [{ id: 'default', name: '我' }]
})

onMounted(() => {
  void load()
})

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const profiles = listProfilesSync()
    const list = profiles.length > 0 ? profiles : [currentProfile()]

    // 学习包是设备级资产：只算一次，所有列共用（墙不需要为每个孩子重算一遍清单）
    const packages: PackageMeta[] = packageStore.packages.map((pkg) => ({
      packageId: pkg.packageId,
      subject: pkg.manifest.subject,
      grade: pkg.manifest.grade,
      term: pkg.manifest.term,
      packageType: packageTypeOf(pkg.manifest) ?? '',
      kpCount: pkg.knowledgePoints?.length ?? 0,
    }))

    // 包体状态也是全局的（`achievement:customPacks`），只读一次；
    // 勾选态是 per-profile，所以 `loadChecks(pid)` 放进 extraDefsOf 里逐列取。
    const packState = await loadPackState()
    const deps = {
      packages,
      progress: userDataStore.progress,
      mistakes: userDataStore.mistakes,
    }

    const out: WallColumn[] = []
    // 顺序 await：每列只有 28 枚（+自定义），并发 4 份同时打库没有收益，
    // 反而让"哪一列读失败"难以定位。墙是慢页面，稳比快重要。
    for (const profile of list) {
      const wall = await loadProfileWall(profile.id, deps, async (pid) =>
        enabledPackDefs(packState, await loadChecks(pid)),
      )
      out.push({
        profileId: profile.id,
        name: profile.name,
        // 复用图鉴的同一套构建：墙上的枚数与图鉴里的必须永远一致
        items: buildAchievementItems(wall.ctx, wall.records, wall.extraDefs),
      })
    }
    columns.value = out
  } catch (e) {
    // 读失败也要让页面出来：宁可能看到一部分，也不要整页白屏（家长会以为数据丢了）。
    // 但**必须**与"没有档案"区分开 —— 否则一次读库异常会被读成"孩子的档案没了"。
    console.warn('[family-wall] 读取家庭成就墙失败', e)
    columns.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.family-wall {
  padding: $space-4;
}

.wall-note {
  margin: 0 0 $space-4;
  padding: $space-3;
  border-radius: $radius-md;
  background: $bg-color-hover;
  color: $text-muted;
  font-size: $font-sm;
  line-height: $leading-relaxed;
}

.wall-scroll {
  display: flex;
  gap: $space-3;
  overflow-x: auto;
  padding-bottom: $space-3;
  /* 触屏与触控板都能滚：惯性滚动 + 每个列自己不被压缩 */
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;

  > * {
    scroll-snap-align: start;
    flex: 0 0 auto;
  }
}
</style>
