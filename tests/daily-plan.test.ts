import { describe, it, expect } from 'vitest'
import {
  buildDailyPlan,
  planProgress,
  markItemDone,
  nextPendingItem,
  isPlanStale,
  normalizeGoal,
  planItemId,
  reasonOf,
  kindBreakdown,
  DEFAULT_GOAL,
  GOAL_LIMITS,
  KIND_COST,
  type PlanCandidate,
  type PlanItemKind,
} from '@core/plan/dailyPlan'

// ---------------------------------------------------------------------------
// 构造器：只写关心的字段，其余给稳定默认值
// ---------------------------------------------------------------------------

let seq = 0
function mk(kind: PlanItemKind, over: Partial<PlanCandidate> = {}): PlanCandidate {
  seq += 1
  return {
    kind,
    packageId: over.packageId ?? 'pkg-a',
    unitId: over.unitId ?? `u${seq}`,
    topicId: over.topicId ?? `t${seq}`,
    knowledgePointId: over.knowledgePointId ?? `kp-${seq}`,
    title: over.title ?? `知识点 ${seq}`,
    subtitle: over.subtitle ?? '数学 · 四上',
    availableQuestions: over.availableQuestions ?? 10,
    overdueDays: over.overdueDays,
    pendingMistakes: over.pendingMistakes,
    mastery: over.mastery,
    order: over.order,
  }
}

const DATE = '2026-10-30'

function kinds(plan: ReturnType<typeof buildDailyPlan>): PlanItemKind[] {
  return plan.items.map((i) => i.kind)
}

// ---------------------------------------------------------------------------

describe('normalizeGoal', () => {
  it('缺省值 = 24 题 / 20 分钟 / 题量口径', () => {
    expect(normalizeGoal(null)).toEqual(DEFAULT_GOAL)
    expect(normalizeGoal(undefined)).toEqual(DEFAULT_GOAL)
  })

  it('非法 mode 回落题量口径，两个数字都保留', () => {
    expect(normalizeGoal({ mode: 'bogus' as never, questions: 30, minutes: 40 })).toEqual({
      mode: 'questions',
      questions: 30,
      minutes: 40,
    })
  })

  it('越界钳制到上下界（填 0 或 999 都不许进队列）', () => {
    expect(normalizeGoal({ questions: 0 }).questions).toBe(GOAL_LIMITS.questions.min)
    expect(normalizeGoal({ questions: 999 }).questions).toBe(GOAL_LIMITS.questions.max)
    expect(normalizeGoal({ minutes: 0 }).minutes).toBe(GOAL_LIMITS.minutes.min)
    expect(normalizeGoal({ minutes: 999 }).minutes).toBe(GOAL_LIMITS.minutes.max)
  })

  it('非数字（字符串 / NaN）回落默认值而不是 0', () => {
    expect(normalizeGoal({ questions: 'abc' as never }).questions).toBe(DEFAULT_GOAL.questions)
    expect(normalizeGoal({ minutes: Number.NaN }).minutes).toBe(DEFAULT_GOAL.minutes)
  })
})

describe('buildDailyPlan · 空与边界', () => {
  it('没有任何候选 → 空队列，且不谎报已完成', () => {
    const plan = buildDailyPlan({ date: DATE, candidates: [] })
    expect(plan.items).toEqual([])
    expect(plan.totals).toEqual({ questions: 0, minutes: 0 })
    const p = planProgress(plan)
    expect(p.finished).toBe(false)
    expect(p.ratio).toBe(0)
  })

  it('题目被删（availableQuestions = 0）的候选不进队列', () => {
    const plan = buildDailyPlan({
      date: DATE,
      candidates: [mk('review', { availableQuestions: 0 }), mk('review')],
    })
    expect(plan.items).toHaveLength(1)
  })

  it('目标只够 5 题、唯一候选是 6 题的新学 → 仍然放 1 项（不空队列）', () => {
    const plan = buildDailyPlan({
      date: DATE,
      goal: { questions: 5, minutes: 20, mode: 'questions' },
      candidates: [mk('new')],
    })
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].kind).toBe('new')
  })

  it('题量被题库封顶时，耗时按比例缩（3 题 2 分钟 → 1 题 1 分钟）', () => {
    const plan = buildDailyPlan({
      date: DATE,
      candidates: [mk('review', { availableQuestions: 1 })],
    })
    expect(plan.items[0].questions).toBe(1)
    expect(plan.items[0].minutes).toBe(1)
  })
})

describe('buildDailyPlan · 题量口径裁剪', () => {
  it('8 张到期卡 × 3 题，目标 24 题 → 恰好 24 题不超', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      mk('review', { overdueDays: i, title: `卡 ${i}` })
    )
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(plan.totals.questions).toBe(24)
    expect(plan.items).toHaveLength(8)
  })

  it('30 张到期卡 → 按目标截断，不是全塞（防劝退）', () => {
    const candidates = Array.from({ length: 30 }, () => mk('review'))
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(plan.totals.questions).toBeLessThanOrEqual(24)
    expect(plan.items.length).toBeLessThan(30)
  })

  it('maxItems 硬上限生效', () => {
    const candidates = Array.from({ length: 20 }, () => mk('weak'))
    const plan = buildDailyPlan({ date: DATE, goal: { questions: 120, minutes: 20, mode: 'questions' }, candidates, maxItems: 5 })
    expect(plan.items.length).toBeLessThanOrEqual(5)
  })
})

describe('buildDailyPlan · 时长口径', () => {
  it('目标 20 分钟 → 总额不超软溢出上限，且至少一项', () => {
    const candidates = Array.from({ length: 20 }, () => mk('review'))
    const plan = buildDailyPlan({
      date: DATE,
      goal: { questions: 24, minutes: 20, mode: 'minutes' },
      candidates,
    })
    expect(plan.items.length).toBeGreaterThan(0)
    expect(plan.totals.minutes).toBeLessThanOrEqual(24)
  })

  it('口径切换不影响队列内容（只影响进度分母）', () => {
    const candidates = [mk('review'), mk('new')]
    const a = buildDailyPlan({ date: DATE, goal: { questions: 24, minutes: 20, mode: 'questions' }, candidates })
    const b = buildDailyPlan({ date: DATE, goal: { questions: 24, minutes: 20, mode: 'minutes' }, candidates })
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id))
  })
})

describe('buildDailyPlan · 优先级与配额', () => {
  it('四类都有候选时，顺序必须是 复习 → 错题 → 弱项 → 新学', () => {
    const candidates = [
      mk('new'),
      mk('weak'),
      mk('mistake'),
      mk('review'),
    ]
    const plan = buildDailyPlan({ date: DATE, candidates })
    const order = kinds(plan)
    const rank = { review: 0, mistake: 1, weak: 2, new: 3 } as const
    const ranks = order.map((k) => rank[k])
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
  })

  it('新学不会被旧账饿死：复习卡充足时仍有新学项', () => {
    const candidates = [
      ...Array.from({ length: 20 }, () => mk('review')),
      ...Array.from({ length: 10 }, () => mk('mistake')),
      mk('new', { title: '第 5 单元' }),
    ]
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(kinds(plan)).toContain('new')
  })

  it('没有新学候选时，复习可以吃满预算', () => {
    const candidates = Array.from({ length: 20 }, () => mk('review'))
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(plan.totals.questions).toBe(24)
    expect(kinds(plan).every((k) => k === 'review')).toBe(true)
  })

  it('只有三类旧账时，三类都能上桌（不被复习独吞）', () => {
    const candidates = [
      ...Array.from({ length: 10 }, () => mk('review')),
      ...Array.from({ length: 10 }, () => mk('mistake')),
      ...Array.from({ length: 10 }, () => mk('weak')),
    ]
    const plan = buildDailyPlan({ date: DATE, candidates })
    const b = kindBreakdown(plan)
    expect(b.review).toBeGreaterThan(0)
    expect(b.mistake).toBeGreaterThan(0)
    expect(b.weak).toBeGreaterThan(0)
  })
})

describe('buildDailyPlan · 类内排序', () => {
  it('复习：逾期越久越靠前', () => {
    const candidates = [
      mk('review', { title: 'A', overdueDays: 1 }),
      mk('review', { title: 'B', overdueDays: 5 }),
      mk('review', { title: 'C', overdueDays: 3 }),
    ]
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(plan.items.map((i) => i.title)).toEqual(['B', 'C', 'A'])
  })

  it('错题：待攻克题数多的靠前', () => {
    const candidates = [
      mk('mistake', { title: 'A', pendingMistakes: 1 }),
      mk('mistake', { title: 'B', pendingMistakes: 6 }),
    ]
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(plan.items.map((i) => i.title)).toEqual(['B', 'A'])
  })

  it('弱项：掌握度低的靠前，无采集值（null）排最后而不是当 0', () => {
    const candidates = [
      mk('weak', { title: '无数据', mastery: null }),
      mk('weak', { title: '0.62', mastery: 0.62 }),
      mk('weak', { title: '0.31', mastery: 0.31 }),
    ]
    const plan = buildDailyPlan({ date: DATE, candidates })
    expect(plan.items.map((i) => i.title)).toEqual(['0.31', '0.62', '无数据'])
  })

  it('新学：按教材顺序，不是按标题', () => {
    const candidates = [
      mk('new', { title: '第 3 单元', order: 3 }),
      mk('new', { title: '第 1 单元', order: 1 }),
      mk('new', { title: '第 2 单元', order: 2 }),
    ]
    const plan = buildDailyPlan({
      date: DATE,
      goal: { questions: 120, minutes: 20, mode: 'questions' },
      candidates,
    })
    expect(plan.items.map((i) => i.title)).toEqual(['第 1 单元', '第 2 单元', '第 3 单元'])
  })
})

describe('reasonOf · 理由必须是可核对的事实', () => {
  it('四类各给出具体事实，不写「系统推荐」', () => {
    expect(reasonOf(mk('review', { overdueDays: 3 }))).toBe('逾期 3 天')
    expect(reasonOf(mk('review', { overdueDays: 1 }))).toBe('昨天到期，趁还没忘')
    expect(reasonOf(mk('review', { overdueDays: 0 }))).toBe('今天到期，复习一下')
    expect(reasonOf(mk('mistake', { pendingMistakes: 4 }))).toBe('还有 4 道错题没攻克')
    expect(reasonOf(mk('weak', { mastery: 0.314 }))).toBe('掌握度 31%，还不稳')
    expect(reasonOf(mk('weak', { mastery: null }))).toBe('练得少，再看一遍')
    expect(reasonOf(mk('new'))).toBe('还没学过')
  })
})

describe('planItemId · 稳定且唯一', () => {
  it('同输入同输出（跨次生成不抖动）', () => {
    const a = mk('review', { packageId: 'p', unitId: 'u', topicId: 't', knowledgePointId: 'k' })
    const b = mk('review', { packageId: 'p', unitId: 'u', topicId: 't', knowledgePointId: 'k' })
    expect(planItemId(a)).toBe(planItemId(b))
  })

  it('kind / 包 / 单元 / 知识点任一不同即不同键', () => {
    const base = { packageId: 'p', unitId: 'u', topicId: 't', knowledgePointId: 'k' }
    const ids = new Set([
      planItemId({ ...base, kind: 'review' }),
      planItemId({ ...base, kind: 'mistake' }),
      planItemId({ ...base, kind: 'review', unitId: 'u2' }),
      planItemId({ ...base, kind: 'review', knowledgePointId: 'k2' }),
    ])
    expect(ids.size).toBe(4)
  })

  it('不含 NUL 之外的歧义分隔（kpId 自带 :: 也不会串键）', () => {
    const id1 = planItemId({ kind: 'review', packageId: 'a::b', unitId: 'u', knowledgePointId: 'x' })
    const id2 = planItemId({ kind: 'review', packageId: 'a', unitId: 'b::u', knowledgePointId: 'x' })
    expect(id1).not.toBe(id2)
  })
})

describe('markItemDone · 幂等与真实值', () => {
  function onePlan() {
    return buildDailyPlan({
      date: DATE,
      candidates: [mk('review', { title: 'A' }), mk('review', { title: 'B' })],
    })
  }

  it('标记完成后 done / doneIds 更新，进度推进', () => {
    const plan = onePlan()
    const id = plan.items[0].id
    const next = markItemDone(plan, id)
    expect(next.doneIds).toEqual([id])
    expect(next.done.questions).toBe(plan.items[0].questions)
    expect(planProgress(next).doneItems).toBe(1)
  })

  it('重复标记同一项不累加（幂等）', () => {
    const plan = onePlan()
    const id = plan.items[0].id
    const once = markItemDone(plan, id)
    const twice = markItemDone(once, id)
    expect(twice.done).toEqual(once.done)
    expect(twice.doneIds).toHaveLength(1)
  })

  it('不存在的 id 不改变任何东西', () => {
    const plan = onePlan()
    expect(markItemDone(plan, '不存在')).toBe(plan)
  })

  it('实际做题数与计划不同时，按实际记账（进度环不撒谎）', () => {
    const plan = onePlan()
    const next = markItemDone(plan, plan.items[0].id, { questions: 5, minutes: 4 })
    expect(next.done).toEqual({ questions: 5, minutes: 4 })
  })

  it('原对象不被修改（纯函数）', () => {
    const plan = onePlan()
    const before = JSON.stringify(plan)
    markItemDone(plan, plan.items[0].id)
    expect(JSON.stringify(plan)).toBe(before)
  })
})

describe('planProgress / nextPendingItem', () => {
  function plan2() {
    return buildDailyPlan({
      date: DATE,
      candidates: [mk('review', { title: 'A' }), mk('review', { title: 'B' })],
    })
  }

  it('全部完成 → finished=true, ratio=1, 没有下一项', () => {
    let plan = plan2()
    for (const it of plan.items) plan = markItemDone(plan, it.id)
    const p = planProgress(plan)
    expect(p.finished).toBe(true)
    expect(p.ratio).toBe(1)
    expect(nextPendingItem(plan)).toBeNull()
  })

  it('未完成时返回第一个未做的项，而不是第一项', () => {
    const plan = plan2()
    const done = markItemDone(plan, plan.items[0].id)
    expect(nextPendingItem(done)?.id).toBe(plan.items[1].id)
  })

  it('剩余量按当前口径扣减，不为负', () => {
    let plan = plan2()
    plan = markItemDone(plan, plan.items[0].id, { questions: 99, minutes: 99 })
    expect(planProgress(plan).remaining).toBe(0)
  })
})

describe('isPlanStale', () => {
  const plan = buildDailyPlan({ date: DATE, candidates: [mk('review')] })

  it('同日同目标 → 不重算（队列冻结）', () => {
    expect(isPlanStale(plan, DATE, plan.goal)).toBe(false)
  })

  it('跨天 → 重算', () => {
    expect(isPlanStale(plan, '2026-10-31')).toBe(true)
  })

  it('只切口径 → 不重算（否则已完成项被清空）', () => {
    expect(isPlanStale(plan, DATE, { ...plan.goal, mode: 'minutes' })).toBe(false)
  })

  it('目标数字变了 → 重算', () => {
    expect(isPlanStale(plan, DATE, { ...plan.goal, questions: 30 })).toBe(true)
    expect(isPlanStale(plan, DATE, { ...plan.goal, minutes: 30 })).toBe(true)
  })

  it('null / 版本不符 → 重算', () => {
    expect(isPlanStale(null, DATE)).toBe(true)
    expect(isPlanStale({ ...plan, version: 2 as never }, DATE)).toBe(true)
  })
})

describe('KIND_COST 契约', () => {
  it('每类都有正值成本（0 会让裁剪死循环）', () => {
    for (const k of ['review', 'mistake', 'weak', 'new'] as PlanItemKind[]) {
      expect(KIND_COST[k].questions).toBeGreaterThan(0)
      expect(KIND_COST[k].minutes).toBeGreaterThan(0)
    }
  })
})
