/**
 * 成就结算 store（V1.3 · T03）：**全链路唯一入口**。
 *
 * 之前的问题：结算逻辑写在 `Home.vue` 的 `onMounted` 里 —— 只有在首页才会结算，
 * 孩子在专项包里连做 30 题、在错题本里清掉 10 道错题，都要等"回到首页"才亮徽章，
 * 中途看到的成就页永远是旧状态。而且 `AchievementToast` 也挂在 Home 里，
 * 在其他页面解锁时**连提示都没有**。
 *
 * 现在：任何页面（含路由跳转后）都能调 `settle()`，它负责
 *   1. 构建上下文（进度 / 错题 / 打卡 / 包元信息 / 每日统计 / 题型）；
 *   2. 调 `syncAchievements` 判定 + 持久化（只增不删）；
 *   3. 把本轮新解锁的塞进 `pending`，由 `AppShell` 统一播放提示；
 *   4. 重建只读视图 `view`（图鉴 UI 直接读它）。
 *
 * ## 单飞（single-flight）
 * 结算会被多个入口并发触发（路由跳转 + 组件完成事件几乎同时发生）。
 * 并发跑没有数据风险（`syncAchievements` 幂等），但会**重复弹同一枚徽章**，
 * 所以：正在跑时只记一个 `rerun` 标记，跑完再补一次，期间所有调用共享同一个 promise。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  ACHIEVEMENTS,
  loadUnlocked,
  syncAchievements,
  type AchievementContext,
  type AchievementDef,
  type PackageMeta,
  type UnlockedRecord,
} from '@core/motivation/achievements'
import {
  buildAchievementItems,
  buildAchievementViewFromItems,
  type AchievementItem,
  type AchievementView,
} from '@core/motivation/achievementMeta'
import { loadStreak } from '@core/motivation/streak'
import { loadDailyStats } from '@core/motivation/dailyStats'
import { loadAttemptedTypes } from '@core/motivation/attemptedTypes'
import { packageTypeOf } from '@/schemas/manifest'
import { useUserDataStore } from './userData'
import { usePackageStore } from './package'

export const useAchievementStore = defineStore('achievement', () => {
  const userDataStore = useUserDataStore()
  const packageStore = usePackageStore()

  /** 已解锁记录（持久化来源的唯一内存副本） */
  const records = ref<UnlockedRecord[]>([])
  /** 待播放的解锁提示队列（AppShell 消费后清空） */
  const pending = ref<AchievementDef[]>([])
  /** 只读图鉴视图（**未筛选**；图鉴页按自己的筛选条件另算，见 `items`） */
  const view = ref<AchievementView | null>(null)
  /**
   * 28 枚的原始视图模型（不含分区/折叠）。
   * 图鉴页要支持搜索与筛选，若每敲一个字都重建一遍进度，代价不必要也很吵；
   * 这里缓存一份，页面用 `buildAchievementViewFromItems(items, ..., filter)` 纯计算派生。
   */
  const items = ref<AchievementItem[]>([])
  /** 没有任何学习包（决定探索组是否显示"导入后开始探索"的引导） */
  const noPackages = ref(true)
  const settling = ref(false)
  const loaded = ref(false)

  const earnedCount = computed(() => records.value.length)
  const totalCount = ACHIEVEMENTS.length

  let inflight: Promise<AchievementDef[]> | null = null
  let rerun = false

  /** 从当前内存 store + settings 构建判定上下文 */
  async function buildContext(): Promise<AchievementContext> {
    const [streak, dailyStats, attemptedTypes] = await Promise.all([
      loadStreak(),
      loadDailyStats(),
      loadAttemptedTypes(),
    ])

    const packages: PackageMeta[] = packageStore.packages.map((pkg) => ({
      packageId: pkg.packageId,
      subject: pkg.manifest.subject,
      grade: pkg.manifest.grade,
      term: pkg.manifest.term,
      // 运行时 JSON 只写 `type`，`packageType` 是历史别名 → 必须走 packageTypeOf
      packageType: packageTypeOf(pkg.manifest) ?? '',
      kpCount: pkg.knowledgePoints?.length ?? 0,
    }))

    return {
      progress: userDataStore.progress,
      mistakes: userDataStore.mistakes,
      streak,
      packages,
      dailyStats,
      attemptedTypes,
    }
  }

  /** 只重建视图，不写库（图鉴刷新用） */
  async function refreshView(): Promise<AchievementView> {
    if (!loaded.value) await load()
    const ctx = await buildContext()
    items.value = buildAchievementItems(ctx, records.value)
    noPackages.value = (ctx.packages ?? []).length === 0
    view.value = buildAchievementViewFromItems(items.value, { noPackages: noPackages.value })
    return view.value
  }

  /** 首次读取持久化记录 */
  async function load(): Promise<void> {
    if (loaded.value) return
    records.value = await loadUnlocked()
    loaded.value = true
  }

  /**
   * 结算一次。返回本轮新解锁的定义列表（同时已塞进 `pending`）。
   * 并发调用共享同一个 promise（见文件头「单飞」）。
   */
  async function settle(): Promise<AchievementDef[]> {
    if (inflight) {
      rerun = true
      return inflight
    }

    inflight = (async () => {
      settling.value = true
      try {
        await load()
        const ctx = await buildContext()
        const result = await syncAchievements(ctx)
        records.value = result.unlockedRecords
        items.value = buildAchievementItems(ctx, result.unlockedRecords)
        noPackages.value = (ctx.packages ?? []).length === 0
        view.value = buildAchievementViewFromItems(items.value, { noPackages: noPackages.value })

        if (result.newlyUnlocked.length > 0) {
          pending.value = [...pending.value, ...result.newlyUnlocked]
        }
        return result.newlyUnlocked
      } catch (e) {
        // 结算失败绝不能影响做题主流程：徽章是激励层，不是功能层
        console.warn('[achievement] 结算失败（不影响学习流程）', e)
        return []
      } finally {
        settling.value = false
      }
    })()

    try {
      return await inflight
    } finally {
      const needRerun = rerun
      rerun = false
      inflight = null
      // 期间又被触发过 → 补一次。补跑的结果只进 `pending`（提示队列），
      // 不回传给当前调用方：它关心的是"我这轮做了什么"。
      if (needRerun) void settle()
    }
  }

  /** 取出并清空待播放队列（AppShell 用） */
  function drainPending(): AchievementDef[] {
    const out = pending.value
    pending.value = []
    return out
  }

  return {
    records,
    pending,
    view,
    items,
    noPackages,
    settling,
    earnedCount,
    totalCount,
    load,
    settle,
    refreshView,
    drainPending,
  }
})
