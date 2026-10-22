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
 *
 * ## 自定义成就（V1.4 · B3）
 * 家长导入的 JSON 包通过 `enabledPackDefs()` 变成 `AchievementDef[]`，作为
 * **额外定义（extraDefs）** 传给 `syncAchievements` / `buildAchievementItems`。两条铁律：
 *
 * 1. **每次现读，不许缓存**。勾选变更、包启停、切换档案都只改库（settings），
 *    缓存 `extra` 就会继续显示旧卡 —— 那正是 V1.3 那批"界面与数据不一致"的病根。
 *    所以 `loadExtraDefs()` 每次都重新 `loadPackState()` + `loadChecks()`。
 * 2. **不并进 `ACHIEVEMENTS`**。那个常量是内置 28 枚的唯一真相；
 *    混进去会污染 `missingTaxonomy()` / `MEASURABLE_IDS` 这类"按 28 枚成立"的推导，
 *    且是那种"测试变绿但语义已经错了"的污染。自定义卡只在调用点以 extraDefs 追加。
 *
 * 另外 `loadChecks()` **不传 profileId** = 当前档案：勾选是 per-profile 的输入，
 * 老二没做过就是没做过。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  ACHIEVEMENT_TOTAL_COLLECTIBLE,
  isCollectible,
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
// 自定义包的读取与"包 → 定义"翻译（V1.4 · B3）。这两个模块都是纯逻辑 + 库读写，
// 不 import 本 store，所以不会成环。
import { enabledPackDefs } from '@core/motivation/customPackDefs'
import { loadChecks, loadPackState } from '@core/motivation/customPackStore'
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

  /**
   * 已解锁枚数（**可收集**口径）。
   *
   * 必须滤掉不参与收集的彩蛋（V1.6 · C6）：`night-owl` 的老记录按"不可撤销"
   * 留档，但它不该出现在任何分子里 —— 否则会出现"已获得 3 / 27"里藏着
   * 一枚家长在图鉴里怎么数也数不到的徽章。
   */
  const earnedCount = computed(() => records.value.filter((r) => isCollectible(r.id)).length)
  /**
   * 已启用的自定义卡枚数（**每次重建视图时刷新**）。
   *
   * 为什么要单独记一个数字：`totalCount` 过去是常量 `ACHIEVEMENTS.length`，
   * 装了自定义包之后会出现"已解锁 30 / 28"这种自相矛盾的进度。
   * C6 起分母改走可收集口径（27），自定义卡默认参与收集。
   */
  const customCount = ref(0)
  const totalCount = computed(() => ACHIEVEMENT_TOTAL_COLLECTIBLE + customCount.value)

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

  /**
   * 读当前**已启用**的自定义包定义（V1.4 · B3）。
   *
   * **每次现读，不缓存**（见文件头「自定义成就」第 1 条）：勾选、启停、切档案
   * 都只改库，缓存会让界面继续显示旧卡。
   *
   * 读失败 → 空数组 + 告警：自定义包是家长扩展出来的激励内容，
   * 它的读取故障绝不能把内置 28 枚的图鉴一起搞崩（那才是孩子每天都在看的东西）。
   */
  async function loadExtraDefs(): Promise<AchievementDef[]> {
    try {
      const [state, checks] = await Promise.all([loadPackState(), loadChecks()])
      return enabledPackDefs(state, checks)
    } catch (e) {
      console.warn('[achievement] 读取自定义包失败，按无自定义成就处理', e)
      return []
    }
  }

  /** 只重建视图，不写库（图鉴刷新用） */
  async function refreshView(): Promise<AchievementView> {
    if (!loaded.value) await load()
    const ctx = await buildContext()
    const extra = await loadExtraDefs()
    items.value = buildAchievementItems(ctx, records.value, extra)
    customCount.value = extra.filter((d) => isCollectible(d.id)).length
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
        // 每次现读（见文件头「自定义成就」）：勾完选、启停包之后这一次结算必须看到新状态
        const extra = await loadExtraDefs()
        // ★ 第 3 个参数才是 extraDefs（第 2 个是 now）。把 extraDefs 故意放在最后，
        //   就是为了让 `syncAchievements(ctx, extra)` 这种写法直接被 tsc 拦下来。
        const result = await syncAchievements(ctx, new Date(), extra)
        records.value = result.unlockedRecords
        items.value = buildAchievementItems(ctx, result.unlockedRecords, extra)
        customCount.value = extra.filter((d) => isCollectible(d.id)).length
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

  /**
   * 切换档案时清空内存态（V1.4 · B1）。
   *
   * 为什么必须有这个函数：`records` / `view` / `items` 都缓存了"当前档案"的派生结果，
   * `loaded` 还挡住了重新读库。不清的话切完档案页面显示的还是上一个孩子的徽章，
   * 而库里数据是对的 —— 这种"界面与数据不一致"最难排查。
   *
   * **先 `drainPending()` 再切**：待播放的解锁提示属于旧档案，不能弹在新档案里
   * （孩子会以为"我解锁了"）。这一点由调用方 `switchProfileAndReload` 保证顺序。
   */
  function resetForProfileSwitch(): void {
    records.value = []
    pending.value = []
    view.value = null
    items.value = []
    // 勾选是 per-profile 的：切完档案启用卡数量可能变（同一个包在两个档案里
    // 勾选不同 → 手工卡的解锁态不同，但**枚数**只跟已启用包有关）。
    // 清零只是为了让"切档案后、重建视图前"这一瞬间不显示上一个档案的总数。
    customCount.value = 0
    loaded.value = false
  }

  /** 取出并清空待播放队列（AppShell 用） */
  function drainPending(): AchievementDef[] {
    const out = pending.value
    pending.value = []
    return out
  }

  /**
   * 故事卡用的上下文快照（V1.4 · B6）。
   *
   * **只读、不缓存、不写库**，而且刻意复用同一个 `buildContext()` ——
   * 故事卡上的"已掌握 N 个"与图鉴里的进度必须是同一份数据算出来的。
   * 若在这里另拼一个精简上下文，就会出现"卡片说 42、进度条说 40"，
   * 而这种不一致家长一定会截图来问。
   *
   * 每次都现读（与 `loadExtraDefs` 同理）：孩子可能刚做完一组题就点开卡片。
   */
  async function storyContext(): Promise<AchievementContext> {
    return buildContext()
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
    storyContext,
    drainPending,
    resetForProfileSwitch,
  }
})
