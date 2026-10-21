/**
 * 跨设备合并 · 落地（V1.4 · B2 / `system_design-v1.4.md` §6.4）
 *
 * ## 哑 IO：这个文件里没有任何判断逻辑
 * 所有取舍都在 `planMerge()` 里算完了（纯函数、可穷举测试）。
 * 这里只做三件事：拒绝、开事务、按清单写。**故意不给这里留任何"聪明"的余地** ——
 * 一旦这里也开始判断"这条要不要更新"，就会有第二套口径，
 * 而两套口径分叉的症状是"预览说要导入 12 条，实际导入 7 条"，没人能复现。
 *
 * ## 为什么全在一个事务里
 * AC-P2-15：任何一步抛错，整笔回滚。
 * 半截导入的后果不是"少了几条"，而是**跨表不一致**：
 * 进度写进去了、错题没写、`profiles` 里也没有这个档案 ——
 * 于是库里存在一批"无主"数据，家长再导一次时它们会被当成"本机已有"而永远保留。
 *
 * ## 为什么 plan 必须在事务外算
 * Dexie 的事务只对**事务内发起的请求**有效。在事务里 `await` 一个漫长计算（读全表 + 合并）
 * 会让事务长时间持有，且中途任何一次非 Dexie 的 await 都可能让事务提前提交（Zone 失效）。
 * 所以顺序固定：事务外读快照 → 纯函数算计划 → 事务内只写。
 */

import { db } from '@/db'
import type { ExamSessionRecord, MistakeRecord, ProgressRecord } from '@/db'
import { isPlanNoop, type MergePlan } from '@core/backup/types'
import { PROFILES_KEY, normalizeProfilesState } from '@core/profile/profileTypes'

export interface ApplyMergeResult {
  progress: number
  mistakes: number
  sessions: number
  settings: number
  profiles: number
}

/** 全 0 结果（noop 与"什么都没发生"用同一个对象形状） */
function zeroResult(): ApplyMergeResult {
  return { progress: 0, mistakes: 0, sessions: 0, settings: 0, profiles: 0 }
}

/**
 * 执行计划。
 *
 * @throws 计划里带 `reject` 时直接抛出（**一行都不写**）；
 *         事务内任何一步失败也会抛出（Dexie 自动回滚整笔）。
 */
export async function applyMergePlan(plan: MergePlan): Promise<ApplyMergeResult> {
  // AC-P2-14：整笔拒绝。放在最前面 —— 连事务都不开，就不存在"开了又回滚"的中间态
  if (plan.reject) throw new Error(plan.reject.detail)

  const result = zeroResult()
  // AC-P2-13：没有任何要写的东西时**不开启事务**（省一次 IO，也让"导入两次"真的零成本）
  if (isPlanNoop(plan)) return result

  await db.transaction(
    'rw',
    db.progress,
    db.mistakes,
    db.examSessions,
    db.settings,
    async () => {
      // ---------------- 进度 ----------------
      for (const row of plan.progressUpserts) {
        const { id: _dropId, ...rest } = row
        const existing = await db.progress
          .where('[profileId+packageId+knowledgePointId]')
          .equals([rest.profileId, rest.packageId, rest.knowledgePointId])
          .first()
        if (existing && typeof existing.id === 'number') {
          // 按复合索引找到既有行再 update：add 会凭空多出一行同一个知识点（统计翻倍）
          await db.progress.update(existing.id, rest)
        } else {
          await db.progress.add(rest as ProgressRecord)
        }
        result.progress++
      }

      // ---------------- 错题 ----------------
      for (const row of plan.mistakeUpserts) {
        const { id: _dropId2, ...rest } = row
        const existing = await db.mistakes
          .where('[profileId+exerciseId]')
          .equals([rest.profileId, rest.exerciseId])
          .first()
        if (existing && typeof existing.id === 'number') {
          await db.mistakes.update(existing.id, rest)
        } else {
          await db.mistakes.add(rest as MistakeRecord)
        }
        result.mistakes++
      }

      // ---------------- 模考 ----------------
      for (const row of plan.sessionUpserts) {
        const { id: _dropId3, ...rest } = row
        // 没有 `[profileId+packageId+sessionIndex+startedAt]` 索引：这不是能力限制
        // （Dexie 的复合索引本身没有列数上限），而是**成本选择** —— 为一个
        // "单档案单包场次只有个位数"的查询去加四列索引，就得把 schema bump 到 v5，
        // 而每次 schema 升级都是一次"用户数据能不能起来"的风险。不值得。
        // 所以先用 `[profileId+packageId]`（v4 已有）收窄，再按 `sessionIndex + startedAt` 精确匹配。
        const candidates = await db.examSessions
          .where('[profileId+packageId]')
          .equals([rest.profileId, rest.packageId])
          .toArray()
        const existing = candidates.find(
          (c) => c.sessionIndex === rest.sessionIndex && c.startedAt === rest.startedAt,
        )
        if (existing && typeof existing.id === 'number') {
          await db.examSessions.update(existing.id, rest)
        } else {
          await db.examSessions.add(rest as ExamSessionRecord)
        }
        result.sessions++
      }

      // ---------------- settings（分片键与全局键走同一条路：put 整条记录）----------------
      // settings-key-ok: 键由 plan 侧统一构造（planProgressMerge / planCustomPackMerge），
      // 那里的每个键都过 scopedKey() 或直接取登记表常量；这里只负责原样落库。
      for (const record of plan.settingUpserts) {
        await db.settings.put(record)
        result.settings++
      }

      // ---------------- 新档案 ----------------
      if (plan.newProfiles.length > 0) {
        const rec = await db.settings.get(PROFILES_KEY)
        const state = normalizeProfilesState(rec?.value)
        const list = [...state.list]
        let added = 0
        for (const meta of plan.newProfiles) {
          // 二次去重：计划已经保证是本机没有的 pid，但库里的真实值可能与快照有出入
          // （快照是事务外读的），重复追加会让两个孩子共用一个档案
          if (list.some((p) => p.id === meta.id)) continue
          list.push(meta)
          added++
        }
        if (added > 0) {
          // `activeId` **保持不变**：导入不该打断本机正在用的人。
          // 若 activeId 指向的档案不存在，normalizeProfilesState 已经把它兜回第一个。
          await db.settings.put({ key: PROFILES_KEY, value: { activeId: state.activeId, list } })
          result.profiles = added
        }
      }
    },
  )

  return result
}
