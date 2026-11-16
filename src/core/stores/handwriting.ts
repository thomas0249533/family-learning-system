/**
 * 「手写作答」的对外 API（题目级随手练）。
 * ---------------------------------------------------------------------------
 * ## 它是什么
 * 孩子在一道题的格子里**手写**填答案 → 落库（`pending`）→ 家长批改
 * （`correct` / `partial` / `wrong`）→ 结论回流进 `progress` / `mistakes`。
 *
 * ## 为什么是「题目级」而不是「整批听写」
 * 交互原话是「手写板填答案」：进入一道题、写、批、下一题。做成批次（一次听写
 * 10 个词）会引出"整卷待批"的模型，那是另一套 UI 与另一套表。题目级还有个
 * 好处：`knowledgePointIds` 是题自带的，回流时不需要任何额外映射。
 *
 * ## 五条纪律（前三条与 `userData.ts` 同一套）
 * 1. **`profileId` 只有一个来源**：`currentProfileId()`，不作为参数传进来 ——
 *    传错不会报错，只会把记录写进另一个孩子的档案（V1.4 · B1 的原话）。
 * 2. **绝不自己写统计字段**：批改结论一律通过 store 既有方法回流
 *    （`addMistake` / `recordProgress`），因为它们内部才持有 BKT / FSRS /
 *    掌握状态机的正确口径。这里直接改 `progress.correctCount` 会让统计说谎，
 *    而 `correctCount` 是掌握率、成就、弱项推荐的共同输入。
 * 3. **本表不进备份 / 合并 / FSRS**：见 `db/index.ts` 的 `HandwritingRecord`。
 *    丢的只是原笔迹，结论已经在 `progress` / `mistakes` 里（那两张表进备份）。
 * 4. **数据层不解析 `cells`**：它是逐格 `serializeStrokes()` 串，只有渲染组件
 *    知道怎么画。store 里解析一次、组件里再解析一次 = 两处口径，且 codec 一演进
 *    （抽稀、坏笔丢弃）就漏掉一处。所以这里**不 import** `deserializeStrokes`。
 * 5. **行不可变，只有批改三字段可写**：`status` / `reviewedAt` / `wrongCells`。
 *    `cells` 永不改 —— "擦掉重写"是 append 新行。旧行是"孩子当时写了什么"的
 *    事实，改写等于编辑历史，K=2 保留策略的唯一价值（这次 vs 上次）当场作废。
 *
 * ## 保留策略
 * 每次提交后跑一次 `purgeOldHandwriting()`：每题留最近 2 条已批改 + 每档案
 * 上限 2000（压缩到 1800），**`pending` 永不清理**。判定逻辑全在
 * `core/handwriting/retention.ts`（纯函数、可单测），这里只负责 IO。
 */
import { db, type HandwritingRecord } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import {
  keepRecentByExercise,
  MAX_ROWS_PER_PROFILE,
  mergePurgeIds,
  pickOverflowByProfile,
} from '@core/handwriting/retention'
import { useUserDataStore } from '@core/stores/userData'
import type { QuizQuestion } from '@modules/core/QuizEngine.vue'

/** 批改结论（对外口径，与 `HandwritingRecord.status` 去掉 `pending` 相同） */
export type HandwritingVerdict = 'correct' | 'wrong' | 'partial'

/**
 * 错题本里「你的答案」那一栏的占位文案。
 *
 * 为什么不是空串：错题本 UI 对空白答案的呈现是"没答"，而这里孩子**答了**，
 * 只是答案是笔迹（存在 `handwritings.cells` 里的序列化串）。
 * 为什么不是 `cells.join('')`：那会把一串坐标 JSON 显示给家长，比空白更糟。
 */
export const HANDWRITING_ANSWER_PLACEHOLDER = '（手写作答）'

/** 提交一次手写作答的入参（**填空题**，逐格） */
export interface HandwritingSubmission {
  /** 入口包 id（与 `recordProgress` 第 1 参数同口径） */
  packageId: string
  /** 题目 id */
  exerciseId: string
  /** 本题触达的知识点（批改回流时喂给 store 既有两个方法） */
  knowledgePointIds: string[]
  /** 题干快照 */
  prompt: string
  /** 参考答案快照 */
  correctAnswer: string
  /**
   * 逐格**序列化笔迹**：`cells[i]` 是第 i 格的 `serializeStrokes()` 产物。
   * 没写的格由调用方给 `'[]'`（不要过滤掉 —— "第 2 格空着"本身就是信息）。
   */
  cells: string[]
  /**
   * 格子总数（可选）。缺省取 `cells.length`。
   * 为什么允许单独传：格子布局来自题目（参考答案长度），`cells` 是孩子实际
   * 拿到的格子，正常情况相等，但前端已经按"题目格数"传值，这里不逼它改。
   */
  cellCount?: number
}

/** 归一化：非字符串 / 非数组的脏输入一律变安全值（提交路径不该因为脏数据抛错） */
function normalizeCells(cells: unknown): string[] {
  if (!Array.isArray(cells)) return []
  return cells.map((c) => (typeof c === 'string' ? c : String(c ?? '')))
}

/**
 * 归一化 `wrongCells`：只留落在 `[0, cellCount)` 的整数，去重并升序。
 *
 * 为什么在这里挡：`wrongCells` 会直接驱动批改页高亮，越界下标会让渲染层
 * 静默画不出东西（而不是报错）。脏数据来自"批改页开着 → 孩子重答同一题"这类
 * 时序竞争，必须在入口掐掉。
 */
function normalizeWrongCells(raw: unknown, cellCount: number): number[] {
  if (!Array.isArray(raw)) return []
  const limit = Number.isFinite(cellCount) && cellCount > 0 ? cellCount : 0
  const seen = new Set<number>()
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v)) continue
    if (v < 0 || v >= limit) continue
    seen.add(v)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * 提交一次手写作答，返回新行 id。
 *
 * 落库即 `pending`（待批改）—— 手写不自动判分：形近字/笔顺的自动误判代价太高，
 * 会把孩子的信心和掌握度统计一起搞坏。判定由 `gradeHandwriting` 显式给。
 *
 * **全空格也落库**：孩子什么都没写（`cells` 全是 `'[]'`）照样写一行 pending ——
 * "按了跳过什么都没留下"和"写了但没写对"对家长是两条完全不同的信息，
 * 待批改队列不能把后者咽掉。
 */
export async function submitHandwriting(sub: HandwritingSubmission): Promise<number> {
  const profileId = currentProfileId()
  const cells = normalizeCells(sub?.cells)

  const row: HandwritingRecord = {
    profileId,
    packageId: String(sub?.packageId ?? ''),
    exerciseId: String(sub?.exerciseId ?? ''),
    knowledgePointIds: Array.isArray(sub?.knowledgePointIds) ? [...sub.knowledgePointIds] : [],
    prompt: String(sub?.prompt ?? ''),
    correctAnswer: String(sub?.correctAnswer ?? ''),
    cells,
    cellCount:
      typeof sub?.cellCount === 'number' && Number.isFinite(sub.cellCount)
        ? sub.cellCount
        : cells.length,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }

  const id = (await db.handwritings.add(row)) as number

  // 保留策略是**尽力而为**：清理失败绝不能让"孩子刚写的那份"看起来提交失败了
  // （那会诱使他再写一遍，然后库里就有两份 pending）。
  // 只清刚写的那道题 —— `purgeOldHandwriting` 的注释解释了为什么不能全表读。
  try {
    await purgeOldHandwriting(row.exerciseId)
  } catch (e) {
    console.warn('[手写作答] 保留策略执行失败，已忽略（不影响本次提交）', e)
  }

  return id
}

/**
 * 待批改队列（`status === 'pending'`），**最早写的在前**（FIFO）。
 *
 * 为什么 FIFO：这是队列不是流水账。家长打开批改页要处理的是"最久没批的那份"，
 * 倒序会让昨天那份永远排在今天新写的后面，越攒越多。
 *
 * 排序在内存里做（fakeDexie 的 where 只有 first/toArray，见 retention.ts 文件头），
 * 但**选行走索引**：`[profileId+status]` 直接命中 pending，不会把已批改的
 * 几百行（每行还带着笔迹串）读进内存。
 *
 * @param limit 最多返回几条（不传 = 全部）
 */
export async function listPendingHandwriting(limit?: number): Promise<HandwritingRecord[]> {
  const pid = currentProfileId()
  const rows = await db.handwritings
    .where('[profileId+status]')
    .equals([pid, 'pending'])
    .toArray()
  const sorted = rows.sort((a, b) => {
    const ta = a?.createdAt ?? ''
    const tb = b?.createdAt ?? ''
    if (ta !== tb) return ta < tb ? -1 : 1
    return (a?.id ?? 0) - (b?.id ?? 0)
  })
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
    return sorted.slice(0, Math.floor(limit))
  }
  return sorted
}

/**
 * 某道题的手写历史（**新的在前**），含待批改。
 *
 * 用途：同一题孩子连写三次，回看"哪一次写对了"。排序与 retention 的保留口径
 * （每题留最近 K=2）方向一致，读出来不会出现"留下的两条顺序错乱"。
 */
export async function listHandwritingByExercise(exerciseId: string): Promise<HandwritingRecord[]> {
  const pid = currentProfileId()
  const rows = await db.handwritings
    .where('[profileId+exerciseId]')
    .equals([pid, String(exerciseId ?? '')])
    .toArray()
  return rows.sort((a, b) => {
    const ta = a?.createdAt ?? ''
    const tb = b?.createdAt ?? ''
    if (ta !== tb) return ta < tb ? 1 : -1
    return (b?.id ?? 0) - (a?.id ?? 0)
  })
}

/**
 * 待批改条数（家长页角标）。
 *
 * 用 `.count()` 而不是 `toArray().length`：这个查询在家长页每次挂载都跑，
 * 而 pending 行自带几十 KB 的笔迹串 —— 只为了一个数字把所有行搬进内存没有道理。
 * `count()` 在 Dexie 里是索引扫描，不 materialize 行。
 */
export async function countPendingHandwriting(): Promise<number> {
  const pid = currentProfileId()
  return db.handwritings.where('[profileId+status]').equals([pid, 'pending']).count()
}

/**
 * 一次批改的**结果码**。给 UI 用的，不含内部细节。
 *
 * ## 为什么不能是 `void` / `boolean`
 * 这三条分支给家长的措辞完全不同，而 `void` 会让它们全都表现成"点完就消失了"
 * —— 等于告诉家长"记上了"，但那可能是一次静默失败：
 *   · `graded`   真的写了、也真的回流了统计 → 移除并计数 +1
 *   · `replaced` 这一行已被**孩子的新作答**顶掉（K=2 保留策略）→ 移除、**不计数**；
 *                家长该做的是刷新后批最新那份
 *   · `already`  行还在但已批过（重复点击）→ 移除、不提示（重复点不该被骂）
 *   · `ignored`  行不存在 / 不属于当前档案 / 入参非法 → 移除、不计数，提示"已清理"
 *
 * `replaced` 与 `ignored` 都发生在"更新不生效"那一刻，区分方式见 `gradeHandwriting`
 * 的注释：同题还有没有别的行。
 */
export type GradeOutcome = 'graded' | 'replaced' | 'already' | 'ignored'

/**
 * 批改一份手写作答。
 *
 * ## 三步，顺序不可颠倒
 * 1. **写判定**（`pending → 目标值`）：返回 `0` 说明行已被新的作答替换（K=2 淘汰），
 *    warn 后直接返回 —— 这是幂等护栏；
 * 2. **回流统计**（`recordProgress` 对错都走 + `addMistake` / `resolveMistake`）；
 * 3. **回流抛错 → 把 `status` 写回 `pending`** 并把错误抛给调用方。
 *
 * 为什么必须先写判定：幂等只能靠"status 已不是 pending"来实现。反过来的顺序
 * （先回流、后写判定）一旦中途失败，统计已经涨了而行还在队列里 → 家长重批 →
 * `wrongCount` **静默双计**，且没有任何错误可见。
 *
 * 为什么失败必须回滚：不回滚的话这份作业会从待批改列表消失 —— 家长既看不到
 * 也重试不了，那正是"判定已记、统计没写上"的静默丢失。回滚后前端能原地重试
 * （`HandwritingReview` 的 catch 会提示"再点一次"，且它只在成功时才把行从列表移除）。
 * 回滚用 `put` 而不是 `update({ reviewedAt: undefined })`：本仓 update 载荷都要过
 * `JSON` 往返（`toPlain` 老坑），`undefined` 键会被整个丢掉，patch 变成空对象；
 * `put` 是整行替换，键不写就是不在了，两种实现下语义一致。
 *
 * ★ 失败分支为什么仍然 **throw** 而不是返回 `'ignored'`：
 * 回滚之后这一行**还在待批改队列里、可以原地重试**，而 `'ignored'` 的文案是
 * "已被清理、没有记入统计" —— 那会让家长以为没救了、索性不重试。抛错让批改页
 * 走它已有的"这一份没批成功，请再点一次（笔迹没有丢）"那条文案，与事实一致。
 *
 * ## 回流必须**对错都写 progress**（与打字路径同构）
 * 打字路径（`TopicDetail.handleAnswer`）是"`recordProgress(kp, isCorrect)` 对错都走 +
 * 答错才 `addMistake`"。而 `addMistake` **只碰 `mistakes`**、从不写 `progress`。
 * 所以如果手写答错只调 `addMistake`，会得到一个**系统性偏高**的掌握度：
 * `wrongCount` / `wrongStreak` 不涨、BKT 概率不降、`status` 永远到不了「需复习」、
 * 弱项推荐看不见这次错误 —— 而判定为对的那次却会推高 BKT、拉长 FSRS 间隔。
 * 只用手写模式的孩子于是"掌握度只会涨"，这是主动骗人，比"两边都不动"更糟。
 *
 * 因此：
 * - `correct`          → `recordProgress(kp, true)` × N，再 `resolveMistake(id, true)`
 *                         （上次打字错过、这次手写写对了，错题三级状态要推进）
 * - `wrong` / `partial` → `recordProgress(kp, false)` × N + `addMistake(...)`
 *                         （`partial` 与 `wrong` 在统计上**完全同构**，差别只在
 *                          `wrongCells` 的展示；不要给它第三条路）
 *
 * ★ 已知且接受的副作用：
 * 1. 批改发生在晚上，`recordProgress` 内部的 `now` 是**批改时刻**，所以
 *    `lastStudiedAt` / FSRS `last_review` / `studySeconds += 30` 会记在批改那一刻
 *    而不是书写那一刻。修它要给 `recordProgress` 加时间入参并穿透 FSRS 排期，
 *    收益远小于风险 —— **这是有意接受的，不要当 bug 修**。
 * 2. **整段回流非原子**（没有跨表事务，也不该加）。两种残留失败模式，已知并接受：
 *    ① 第 N 个 kp 抛错 → 前 N−1 个已落库 → 回滚把行退回 pending → 家长重批 →
 *       前 N−1 个**双计**（`correctCount` / `correctStreak` 各 +1；FSRS 有
 *       `shouldAdvanceSchedule` 的同日闸门，挡不住跨天重批）。`addMistake` 抛错
 *       重批同理，`wrongCount +1` 两次。
 *    ② 进程在循环中途被杀 → `catch` 不执行 → 行停在"已批改"但只有部分 kp 记上 →
 *       不可重试、静默少算。
 *    **不要为了消除它们引入 `db.transaction`**：`addMistake` 内部会读 `db.packages`
 *    全表（`ensureOwnerIndex`）并 `loadUserData()` 读多表，包进事务会抛
 *    "Table X not part of transaction" 或撞 5s 上限（`bundleIO.dumpLocal` 有先例）。
 *    要真做原子性，唯一正路是把"写 progress + 写 mistakes + 写 status"抽成一个
 *    吃 `tx` 的原子函数 —— 那是另一件事。
 *
 * ## `partial` 的状态：**已支持、UI 暂未暴露**
 * 批改页目前只有「写对了 / 写错了」两键，没有"半对"。所以 `partial` 平时不会被
 * 写出来 —— 但**不要据此删掉它**：
 *   · 它的存在理由没消失（「犬/大」「人/入」这种字形，二选一必然误判）；
 *   · 数据层一旦有人写出 `partial` 行（未来 UI、导入、脚本），下面这条分流必须成立。
 * 暴露给 UI 时**不得改变统计口径**，否则同一份作答的结论会取决于"UI 有没有这个按钮"。
 *
 * `addMistake` 的 `userAnswer` 传占位文案（见 `HANDWRITING_ANSWER_PLACEHOLDER`）：
 * `cells` 是笔迹 JSON 不是文本，塞进去会让错题本显示一坨坐标；传空串又会被
 * 当成"没答"。
 *
 * @param wrongCells 仅 `partial` 有意义：写错的格子下标（0-based）。其它结论忽略。
 */
export async function gradeHandwriting(
  id: number,
  verdict: HandwritingVerdict,
  wrongCells?: readonly number[]
): Promise<GradeOutcome> {
  if (typeof id !== 'number' || !Number.isFinite(id)) return 'ignored'

  const pid = currentProfileId()
  const row = await db.handwritings.get(id)
  if (!row) return 'ignored'
  if (row.profileId !== pid) {
    console.warn('[手写作答] 批改目标不属于当前档案，已忽略', { id, owner: row.profileId })
    return 'ignored'
  }
  if (row.status !== 'pending') {
    console.warn('[手写作答] 该笔迹已批改过，忽略重复批改', { id, status: row.status })
    return 'already'
  }

  // ---------- ① 写判定（幂等护栏） ----------
  const patch: Partial<HandwritingRecord> = {
    status: verdict,
    reviewedAt: new Date().toISOString(),
  }
  if (verdict === 'partial') {
    // `wrongCells` 的越界基准以**孩子实际拿到的格子数**为准（`cells.length`），
    // `cellCount` 只是"这题应该有几格"的展示口径（题面与答案长度不一致时会分叉）。
    const basis = Array.isArray(row.cells) && row.cells.length > 0
      ? row.cells.length
      : (row.cellCount ?? 0)
    const cells = normalizeWrongCells(wrongCells, basis)
    if (cells.length > 0) patch.wrongCells = cells
  }

  // 行可能在"打开批改页 → 孩子又答了一遍 → K=2 淘汰了这条"之后消失。
  // 真 Dexie 的 update 对不存在的行返回 0（不抛），所以必须看返回值。
  const updated = await db.handwritings.update(id, patch)
  if (updated === 0) {
    // 区分两种"没更新上"：同题还有别的行 → 被孩子的新作答顶掉了（replaced）；
    // 一条都没有 → 这条是被别的清理路径干掉的（ignored）。文案完全不同。
    const siblings = await listHandwritingByExercise(row.exerciseId)
    const replaced = siblings.some((r) => r.id !== row.id)
    console.warn('[手写作答] 批改未生效', { id, reason: replaced ? 'replaced' : 'ignored' })
    return replaced ? 'replaced' : 'ignored'
  }

  // ---------- ② 回流统计（对错都走 recordProgress） ----------
  const store = useUserDataStore()
  const kpIds = Array.isArray(row.knowledgePointIds) ? [...row.knowledgePointIds] : []
  const isCorrect = verdict === 'correct'

  try {
    for (const kpId of kpIds) {
      if (!kpId) continue
      // `questionType` 让 BKT 用填空题的蒙对率（当前与默认值相同，传它是为了
      // 将来默认值变化时手写路径不会悄悄漂到选择题的猜对率上）
      await store.recordProgress(row.packageId, kpId, isCorrect, { questionType: 'blank' })
    }
    if (isCorrect) {
      // 上次（打字）错过这题、这次手写写对了 → 三级状态要推进，否则错题本永远停在旧状态
      await store.resolveMistake(row.exerciseId, true)
    } else {
      await store.addMistake(
        questionOf(row),
        row.packageId,
        kpIds,
        HANDWRITING_ANSWER_PLACEHOLDER
      )
    }
  } catch (err) {
    // ---------- ③ 回滚：让这份作业回到待批改队列，家长能原地重试 ----------
    console.warn('[手写作答] 批改回流失败，已把状态退回待批改', err)
    await revertToPending(row).catch((e) =>
      console.error('[手写作答] 回滚失败，该份作业可能卡在已批改状态', { id, error: e })
    )
    // 见上方注释：因为行已回到待批改（可重试），这里选择抛错让批改页走"再点一次"
    // 的文案，而不是返回 'ignored'（那会让家长以为已经没救了）。
    throw err
  }

  return 'graded'
}

/**
 * 把一行退回 `pending`（回滚用）。
 *
 * ★ **受控例外**：这是整个 store 里唯一绕过"行不可变 · 只允许改 `status` /
 * `reviewedAt` / `wrongCells`"白名单的地方 —— 它用 `put` 写整行。
 * 成立的前提有三个，缺一条就不许在这里用 `put`：
 *   1. 内容来自**刚读出来的 `row`**，`cells` / `prompt` 等字段一个字节都没改；
 *   2. 必须 `delete reviewedAt / wrongCells` —— 否则会留下"`pending` 却带着批改
 *      时间和错格"的非法组合（`pending` 的语义是"还没批过"）；
 *   3. 唯一用途是回滚。**后来人不要拿 `put` 去做普通更新** —— 那等于把白名单废掉
 *      （`update` 只能改那三个字段是这套设计的核心约束）。
 * 失败不吞异常：调用方要看到"回滚也失败"。
 */
async function revertToPending(row: HandwritingRecord): Promise<void> {
  const reverted: HandwritingRecord = { ...row, status: 'pending' }
  delete reverted.reviewedAt
  delete reverted.wrongCells
  await db.handwritings.put(reverted)
}

/**
 * 把一行手写还原成一个 `QuizQuestion`（只给 `addMistake` 用）。
 *
 * 为什么构造而不是存整题：题干/答案已经在行上（快照），`addMistake` 只需
 * `id` 做去重键、其余字段进 `questionData` 供错题本展示。存整题会让每行
 * 多几百字节到几 KB（含选项、解析、配图路径），而 `questionData` 里那份
 * 本来就是"作答时的快照"，重复存没有意义。
 *
 * `type` 固定 `blank`：手写填格在判分语义上就是填空题；该字段只影响错题本的
 * 图标与文案，不影响任何统计。
 */
function questionOf(row: HandwritingRecord): QuizQuestion {
  return {
    id: row.exerciseId,
    type: 'blank',
    question: row.prompt ?? '',
    answer: row.correctAnswer ?? '',
    explanation: '',
  }
}

/**
 * 执行保留策略，返回实际删除的行数。
 *
 * 两条规则叠在一起（顺序即优先级，便于测试断言）：
 *   1. 每题留最近 K=2 条**已批改**（`keepRecentByExercise`）；
 *   2. 每档案已批改行上限 M=2000，超了压到 N=1800（`pickOverflowByProfile`）。
 *
 * `pending` 两边都跳过 —— 待批改队列不是历史，删了就是丢作业。
 *
 * 只清理**当前档案**：别的档案等他下次提交时自己清 —— 在"老二的会话里删老大的行"
 * 是不可接受的副作用（老大的待批改列表会莫名变短）。
 *
 * ## 性能：两个闸门各读各的行（这条函数挂在**每次提交**末尾）
 * 手写行自带笔迹串（5 格词 ≈ 10~20KB），全表读的代价随使用量线性恶化：
 * 450 行时每次提交读 4.5~9MB，到 2000 行上限时 20~40MB —— 而一轮 15 词的练习
 * 就是 15 次。所以：
 *   - **第 1 条**只读**当前这一题**（`[profileId+exerciseId]` 精确命中，几条行）；
 *   - **第 2 条**先 `count()` 判阈值，超了才 `toArray()`。
 *     `total > M` 这个判据是安全的：`pickOverflowByProfile` 只数 `status !== 'pending'`，
 *     已批改行数恒 ≤ total，所以 `total ≤ M` 时**不可能** overflow。
 *
 * @param exerciseId 只清这一题（`submitHandwriting` 传刚写的那道题）。
 *   不传时跳过第 1 条、只跑第 2 条 —— 给"清空数据"这类全量场景用。
 */
export async function purgeOldHandwriting(exerciseId?: string): Promise<number> {
  const pid = currentProfileId()
  const doomed: number[] = []

  // ---------- ① 每题 K=2：只读这一题 ----------
  const exId = typeof exerciseId === 'string' ? exerciseId : ''
  if (exId) {
    const sameExercise = await db.handwritings
      .where('[profileId+exerciseId]')
      .equals([pid, exId])
      .toArray()
    doomed.push(...keepRecentByExercise(sameExercise))
  }

  // ---------- ② 档案上限：count 判阈值，超了才读全量 ----------
  const total = await db.handwritings.where('profileId').equals(pid).count()
  if (total > MAX_ROWS_PER_PROFILE) {
    const rows = await db.handwritings.where('profileId').equals(pid).toArray()
    doomed.push(...pickOverflowByProfile(rows))
  }

  const ids = mergePurgeIds(doomed)
  if (ids.length === 0) return 0

  await db.handwritings.bulkDelete(ids)
  return ids.length
}
