/**
 * 切换档案的**编排**（V1.4 · B1 / `system_design-v1.4.md` §8.1）
 *
 * 切档案不是"改一个变量"，而是一个有顺序的事务性操作。顺序错了会出三类 bug：
 *
 * | 漏掉的步骤 | 用户看到的现象 |
 * |---|---|
 * | ① 旧档案先结算 | 刚答完最后一题就切档案 → 那枚成就永久不会解锁（下次进来条件已不成立） |
 * | ② 清掉待播提示 | 老二看到"你解锁了「连续 7 天」"，而那是老大的 |
 * | ③ 清空 store 缓存 | 切完档案徽章/统计还是上一个孩子的（库里是对的，界面是错的） |
 *
 * 所以这段顺序**只能有一个实现**，不许各页面自己拼。
 *
 * ## 为什么不用 `onBeforeProfileSwitch` 就够
 * 那个钩子只负责"缓存类模块落盘"（dailyStats / attemptedTypes），由各模块自己注册；
 * 而"先结算成就 + 清队列"依赖 store，放进去会让 core 层反向依赖 pinia store。
 * 折中：钩子管模块内部状态，本文件管 store 编排。
 */
import { switchProfile } from './currentProfile'
import { useAchievementStore } from '@core/stores/achievement'
import { useUserDataStore } from '@core/stores/userData'

/**
 * 切到指定档案，并把界面数据切过去。
 *
 * 失败时**不吞错**：切换本身失败（档案不存在）要让调用方知道并提示用户；
 * 但"重新加载"失败只告警 —— 用户已经切过去了，此时回滚档案反而更混乱。
 */
export async function switchProfileAndReload(id: string): Promise<void> {
  const achievement = useAchievementStore()
  const userData = useUserDataStore()

  // ① 旧档案先结算（把"刚才那一题"产生的成就落库）
  await achievement.settle()

  // ② 旧档案的待播提示直接丢弃：它属于上一个孩子。
  //    注意这里不是"播放完再切"，而是**丢弃** —— 切档案是家长的显式动作，
  //    此刻弹出一堆旧徽章既打断操作，又会被误认成新档案的成果。
  achievement.drainPending()

  // ③ 真正切（内部会先 flush 各模块的内存缓存到旧档案的键上，再发变更通知）
  await switchProfile(id)

  // ④ 清 store 缓存 + 重新读库
  achievement.resetForProfileSwitch()
  userData.mistakes = []
  userData.progress = []

  try {
    await userData.loadUserData()
    // 重新结算一次：新档案的 `records` / `view` 目前是空的，
    // settle 会读该档案的键并重建（幂等，不会产生假解锁）
    await achievement.settle()
  } catch (e) {
    console.warn('[profile] 切换后重新加载失败（档案已切换，界面可能需要手动刷新）', e)
  }
}
