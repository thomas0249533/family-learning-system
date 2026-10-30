/**
 * 跨设备合并 · 落地（V1.4 · B2 / `system_design-v1.4.md` §6.4）
 *
 * ## 哑 IO：除了「写入前置校验」之外，这个文件里没有任何判断逻辑
 * 所有取舍都在 `planMerge()` 里算完了（纯函数、可穷举测试）。
 * 这里只做四件事：拒绝、开事务、**守卫**、按清单写。
 * **故意不给这里留任何"聪明"的余地** —— 一旦这里也开始判断"这条要不要更新"，
 * 就会有第二套口径，而两套口径分叉的症状是"预览说要导入 12 条，实际导入 7 条"，
 * 没人能复现。（"守卫"是唯一的例外，它不是合并口径而是前置条件，见下面那一节。）
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
 *
 * ## A6 · L2 陈旧快照守卫（为什么这里也要"判断"）
 * 这是本文件**唯一**的例外，先把它和"第二套口径"划清界限：
 * 它判断的不是"这条该不该更新"（那仍然是 `planMerge` 的职责，合并口径只有一份），
 * 而是"这个计划现在还适不适用"—— 即**写入前置条件**。计划是在几分钟前、基于当时
 * 读到的快照算出来的；这期间孩子可能去学习页答了题，本地行已经变了。
 * 继续 apply 就会用备份里的旧值覆盖孩子刚产生的新记录，而且不报错。
 *
 * 三个取舍（都会在代码里看到对应实现）：
 * ① **比整行内容，不只比 `lastStudiedAt` / `lastReviewAt`**。
 *    `db.progress.update()` 是**浅合并**：`masteryLevel` / `nextReviewAt` / `fsrs`
 *    完全可以在不动时间戳的情况下被改掉。只比时间戳会把这些改动漏掉，
 *    而它们恰恰是复习排期的真相。
 * ② **守卫必须前置于所有写入**（progress / mistakes / sessions / settings / 新档案
 *    全都排在它后面）。Dexie 事务抛错确实会回滚，但"前置失败"保证
 *    「一行都没写」在任何实现下都成立，也让失败原因只有一个（守卫）而不是
 *    "可能是守卫、可能是某一步 IO"。
 * ③ **为什么不守 sessions 与 settings**：
 *    - sessions 的身份里含 `startedAt`，两台设备撞成同一场的概率实际为零，
 *      而且同 key 时策略本来就是"保持本机"（不覆盖）；
 *    - settings 的竞态是**已知残留**（家长在两步之间改主题之类），
 *      后果最坏是某个偏好回到备份里的值，由 A6-L1 的导入警告兜底，
 *      为它加基线会让计划体积翻一倍（settings 值普遍比行大得多）。
 */

import { db } from '@/db'
import type { CardCompletionRecord, ExamSessionRecord, MistakeRecord, ProgressRecord } from '@/db'
import { isPlanNoop, type MergePlan } from '@core/backup/types'
import { PROFILES_KEY, normalizeProfilesState } from '@core/profile/profileTypes'
import { mistakeKey } from './mergeMistakes'
import { progressKey } from './mergeProgress'

export interface ApplyMergeResult {
  progress: number
  mistakes: number
  sessions: number
  settings: number
  profiles: number
  /** 写进去的手动完成标记条数（V3.0 · M4 起也在备份契约里） */
  marks: number
}

/**
 * 递归排序键后序列化：**忽略键序与 `undefined` 值**。
 *
 * 为什么必须自己写而不是 `JSON.stringify`：基线的来源与比对对象来自两条不同的路径 ——
 *   1. `executeImport` 会把 plan 做一次 `JSON.parse(JSON.stringify(plan))`，
 *      值为 `undefined` 的键在往返中**直接消失**；
 *   2. 基线来自 `readLocalSnapshot()`（Dexie 读），当前值来自事务内的 `.where().first()`，
 *      两条路径的**键序不一定相同**（Dexie 的结构化克隆与 JS 对象字面量不保证一致）。
 * 直接比字符串会把这两种无害差异判成"数据变了"，守卫变成误报机器。
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
}

/**
 * 行内容指纹。
 *
 * 剔除 `id`：它是**行身份的实现细节**，不是内容。删掉一行再按同样内容重建
 * （恢复备份、迁移、手工修数据都会这样）没有任何数据损失，不该算"有新记录"；
 * 留着它则会让这类重排触发误报。其余字段一个不丢 —— 少比任何一个都等于给守卫开洞。
 */
function rowFingerprint(row: unknown): string {
  if (!row) return 'null'
  // 强转而非收窄参数类型：`ProgressRecord` 是 interface（没有索引签名），
  // 直接写 `Record<string, unknown>` 参数会让每个调用点都要 as，反而更吵。
  const { id: _dropId, ...rest } = row as Record<string, unknown>
  return stableStringify(rest)
}

/** 守卫失败：**带 code**，UI 据此给"重新预览"的引导而不是笼统的"导入失败" */
function staleGuardError(): Error {
  const err = new Error('检测到新的学习记录，为了数据安全，请重新预览后再导入。') as Error & {
    code?: string
  }
  err.code = 'stale-local-data'
  return err
}

/** 全 0 结果（noop 与"什么都没发生"用同一个对象形状） */
function zeroResult(): ApplyMergeResult {
  return { progress: 0, mistakes: 0, sessions: 0, settings: 0, profiles: 0, marks: 0 }
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
    db.cardCompletions,
    async () => {
      // ================= A6 · L2 陈旧快照守卫 =================
      // 必须在**任何写入之前**：progress / mistakes / sessions / settings / 新档案
      // 全都排在它后面（见文件头取舍 ②）。
      //
      // 为什么是"有基线才比"而不是"没有基线就当 null"：`stalenessGuard` 必填，
      // 生产路径（planMerge）一定填。缺失只可能是**手工拼的计划**（测试、将来的修复工具）——
      // 对它们报"检测到新的学习记录"是**误导**（真正的原因是计划没带基线）。
      // 宁可跳过，也不能给一个指向错误方向的错误码；而这个"跳过"的洞由
      // `tests/merge-staleness.test.ts` 里"planMerge 给每个 upsert 都填了基线"钉住。
      const guard = plan.stalenessGuard
      if (guard) {
        for (const row of plan.progressUpserts) {
          const bucket = guard.progress?.[row.profileId]
          if (!bucket) continue
          const k = progressKey(row)
          if (!(k in bucket)) continue
          const baseline = bucket[k] ?? null
          const current = await db.progress
            .where('[profileId+packageId+knowledgePointId]')
            .equals([row.profileId, row.packageId, row.knowledgePointId])
            .first()
          if (rowFingerprint(baseline) !== rowFingerprint(current)) throw staleGuardError()
        }

        for (const row of plan.mistakeUpserts) {
          const bucket = guard.mistakes?.[row.profileId]
          if (!bucket) continue
          const k = mistakeKey(row)
          if (!(k in bucket)) continue
          const baseline = bucket[k] ?? null
          const current = await db.mistakes
            .where('[profileId+exerciseId]')
            .equals([row.profileId, row.exerciseId])
            .first()
          if (rowFingerprint(baseline) !== rowFingerprint(current)) throw staleGuardError()
        }
      }

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

      // ---------------- 手动完成标记（纯并集，见 mergeCardCompletions 文件头）----------------
      for (const row of plan.markUpserts) {
        const { id: _dropId4, ...rest } = row
        const existing = await db.cardCompletions
          .where('[profileId+kind+targetId]')
          .equals([rest.profileId, rest.kind, rest.targetId])
          .first()
        if (existing && typeof existing.id === 'number') {
          // 计划侧已经保证"本机没有才写"，这里命中只可能是手工拼的计划或快照过期。
          // 覆盖成远端那行没有语义差别（内容只有 createdAt），但保持与其余三张表一致的写法。
          await db.cardCompletions.update(existing.id, rest)
        } else {
          await db.cardCompletions.add(rest as CardCompletionRecord)
        }
        result.marks++
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
