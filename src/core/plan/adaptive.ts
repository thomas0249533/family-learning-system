/**
 * 自适应难度（V3.0 · M2）—— "给他什么难度的题"的唯一实现
 * ---------------------------------------------------------------------
 * ## 为什么需要这个文件
 * V3.0 之前 `metadata.difficulty` 只是**题面上的一个标签**：回答"这题是提高题"，
 * 但选题逻辑从不读它。于是题库里混着的 35 道拔高题，只有孩子恰好点进那个主题
 * 才会遇到；复习队列给一个已经全对的孩子继续推基础题。
 *
 * 本文件把"标签"变成"开关"：**按孩子当前的水平挑题**。
 *
 * ## 换挡发生在**下一次**，不在**下一题**（这是本版明确的技术裁决）
 * 真正的会话内换挡（连对 3 题就插入一道提高题）需要答题器支持"中途追加题目"。
 * 本仓的 `QuizEngine` 是 1000+ 行的既有组件，题单由 `questions` prop 一次给定、
 * 内部 `currentIndex` 单调前进；动态插入要改它的核心循环，风险和收益不成比例
 * （孩子的实际体验差异很小：一次练习 3 题，插不插都在两分钟内结束）。
 *
 * 所以换挡的**触发条件**仍然是"连对 / 连错"，只不过它作用于**下一次练习**：
 *   - `correctStreak >= 3` → 升一档（这是"连对 3 题"在跨会话尺度上的等价物，
 *     而且用的是 `progress.correctStreak` 这个**已经在维护的真实状态**，不是新埋点）；
 *   - `wrongStreak >= 2` → 降一档。
 * 孩子做完一轮，下一轮就换挡了 —— 他感受到的就是"越做越难 / 做不动就变简单"。
 *
 * ## 纯函数、零 Vue 零 db
 * 与 `dailyPlan.ts` 同纪律：难度规则是产品规则，必须能被固定输入断言
 * （`tests/adaptive.test.ts`）。
 */

export type Difficulty = '基础' | '提高' | '挑战'

/** 由易到难（数组顺序即档位高低，不要改成对象遍历） */
export const DIFFICULTY_ORDER: Difficulty[] = ['基础', '提高', '挑战']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  基础: '基础',
  提高: '提高',
  挑战: '挑战',
}

/** 未知 / 缺失 / 脏值一律按「基础」处理（宁可简单，不可一上手就劝退） */
export function normalizeDifficulty(v: unknown): Difficulty {
  if (typeof v !== 'string') return '基础'
  const s = v.trim()
  if (s === '挑战' || s === 'challenge' || s === 'hard') return '挑战'
  if (s === '提高' || s === 'advanced' || s === 'medium') return '提高'
  return '基础'
}

export function difficultyOf(q: { metadata?: { difficulty?: unknown } } | null | undefined): Difficulty {
  return normalizeDifficulty(q?.metadata?.difficulty)
}

/** 档位 → 下标（0/1/2），用于升降档 */
export function levelIndex(d: Difficulty): number {
  const i = DIFFICULTY_ORDER.indexOf(d)
  return i < 0 ? 0 : i
}

function levelAt(index: number): Difficulty {
  const clamped = Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, index))
  return DIFFICULTY_ORDER[clamped]
}

/** 孩子在这个知识点上的表现（全部来自 `ProgressRecord`，不新增埋点） */
export interface Performance {
  correctCount?: number
  wrongCount?: number
  /** 当前连对次数（`progress.correctStreak`） */
  correctStreak?: number
  /** 当前连错次数（`progress.wrongStreak`） */
  wrongStreak?: number
  /** BKT 掌握概率（有就比"答对率"更稳，优先用） */
  masteryProbability?: number | null
}

/** 正确率口径的基准档位 */
export function baseLevelOf(p: Performance): Difficulty {
  const correct = Math.max(0, p.correctCount ?? 0)
  const wrong = Math.max(0, p.wrongCount ?? 0)
  const total = correct + wrong
  if (total === 0) return '基础'

  // 优先用 BKT：它已经做了"蒙对"折扣（判断题蒙对率 0.5），比裸正确率可信
  const mastery = typeof p.masteryProbability === 'number' ? p.masteryProbability : null
  const rate = mastery !== null ? mastery : correct / total

  if (rate >= 0.85) return '挑战'
  if (rate >= 0.6) return '提高'
  return '基础'
}

/**
 * 该给孩子什么档位。
 *
 * 顺序很重要：**先按正确率定基准，再被连对/连错推一档**。
 * 反过来（先看连对）会让"刚连对 3 题但整体一塌糊涂"的孩子直接跳到挑战题。
 */
export function levelOf(p: Performance): Difficulty {
  let idx = levelIndex(baseLevelOf(p))
  if ((p.correctStreak ?? 0) >= 3) idx += 1
  if ((p.wrongStreak ?? 0) >= 2) idx -= 1
  return levelAt(idx)
}

/**
 * 从题池里挑 `limit` 道，按**目标档位优先**排序。
 *
 * 规则：
 *   1. 目标档位的题先给（保持题库原有顺序，不打乱教材编排）；
 *   2. 不够就从**低一档**补（降阶比跳阶安全：不会突然给孩子完全没学过的东西），
 *      再不够才用**高一档**补；
 *   3. 还差就按原顺序把剩下的题补齐 —— **永远凑够 `limit` 道**（除非题库本身不够）。
 *
 * 为什么"降阶优先于升阶"：题池里某一档稀缺是常见的（数学包基础题最多、
 * 挑战题可能一个知识点只有 1 道）。先升阶会把仅有的挑战题浪费在一个
 * 正在挣扎的孩子身上，而先降阶只是多做一道会的题，代价小得多。
 */
export function selectSessionQuestions<T extends { metadata?: { difficulty?: unknown } }>(
  pool: T[],
  level: Difficulty,
  limit: number
): T[] {
  const all = Array.isArray(pool) ? pool : []
  if (all.length === 0) return []
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : all.length
  if (cap >= all.length) {
    // 全都要：仍然按目标档位优先排（孩子先做难度合适的，难题落到最后）
    return orderByLevel(all, level)
  }

  const picked: T[] = []
  const used = new Set<number>()
  const idxOfLevel = new Map<Difficulty, number[]>()
  for (const d of DIFFICULTY_ORDER) idxOfLevel.set(d, [])
  all.forEach((q, i) => {
    idxOfLevel.get(difficultyOf(q))!.push(i)
  })

  const target = levelIndex(level)
  // 顺序：目标 → 低一档 → 低两档 → 高一档 → 高两档
  const order = [target, target - 1, target - 2, target + 1, target + 2]
  for (const li of order) {
    if (li < 0 || li >= DIFFICULTY_ORDER.length) continue
    const bucket = idxOfLevel.get(DIFFICULTY_ORDER[li]) ?? []
    for (const i of bucket) {
      if (picked.length >= cap) break
      if (used.has(i)) continue
      used.add(i)
      picked.push(all[i])
    }
    if (picked.length >= cap) break
  }

  // 兜底：极端情况下（例如所有题都被判成同一档但顺序错乱）按原顺序补满
  if (picked.length < cap) {
    for (let i = 0; i < all.length && picked.length < cap; i += 1) {
      if (used.has(i)) continue
      picked.push(all[i])
    }
  }

  return picked
}

/** 全都要时也要"目标档位优先"，但保持各档内部原顺序 */
function orderByLevel<T extends { metadata?: { difficulty?: unknown } }>(pool: T[], level: Difficulty): T[] {
  const target = levelIndex(level)
  const rank = (q: T): number => Math.abs(levelIndex(difficultyOf(q)) - target)
  // 稳定排序：rank 相同则保持原索引顺序（JS sort 已稳定，但仍显式带索引兜底）
  return pool
    .map((q, i) => ({ q, i, r: rank(q) }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((x) => x.q)
}

/**
 * 会话结束后，这个知识点的档位会怎么变（**给结算页/家长端看的预告**）。
 * 纯展示用，不写库。
 */
export function describeShift(before: Difficulty, after: Difficulty): string {
  const b = levelIndex(before)
  const a = levelIndex(after)
  if (a > b) return `下次会换到${DIFFICULTY_LABEL[after]}题`
  if (a < b) return `下次先回来巩固${DIFFICULTY_LABEL[after]}题`
  return '难度保持不变'
}
