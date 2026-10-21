import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 跨档案同键的**回归网**（V1.4 · B2 · 修 B1 遗留缺陷）
 *
 * ## 这个缺陷是什么
 * `planProgressMerge()` 是 v3 时代写的，那时没有档案这一层，分组键 = `(packageId, kpId)`。
 * v4 加 `profileId` 之后键没跟着改，于是**两个孩子学同一本教材**时：
 *   - `planProgressMerge` 把两行并成一行、`delete` 掉另一行；
 *   - 承载体（复用 `id` 的那行）来自其中一个孩子，另一个孩子的进度**静默消失**。
 * 触发点：`ensureE1Migrated` —— 导入学习包后、恢复备份后、**以及每次启动（一天一次）**。
 *
 * ## 为什么这里要同时测两层
 * - `planProgressMerge` 是**真正出问题**的那层（分组键）；
 * - `@core/merge/applyMergePlan` 是**跨设备合并**的落地层，它自己按
 *   `[profileId+packageId+knowledgePointId]` 找既有行。这一层本来是对的，
 *   但"本机有 default 的一行 + 计划里有同键但 pid=p2 的 upsert"这个场景
 *   必须用测试钉住：一旦有人把它简化成"按 packageId+kp 找既有行"，
 *   就会出现 `update` 把 A 档案的行改写成 B 的数据（行数不变、数据串了）。
 *
 * 断言的重点不是行数，而是**本机那行逐字段没被改写** —— 只断行数会被
 * "改写了但行数没变"骗过去。
 */

// ---------------------------------------------------------------------------
// 第一层：纯函数分组键
// ---------------------------------------------------------------------------
const { buildOwnerIndex } = await import('@core/progress/ownerIndex')
const { planProgressMerge } = await import('@core/progress/progressMerge')

/** 一行完整进度记录（缺字段会让 normalize 补默认值，掩盖"被改写"） */
function progressRow(over: Record<string, unknown>) {
  return {
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '学习中',
    correctCount: 1,
    wrongCount: 0,
    correctStreak: 0,
    wrongStreak: 0,
    lastStudiedAt: '2025-03-01T00:00:00.000Z',
    studySeconds: 10,
    ...over,
  } as never
}

describe('planProgressMerge — 跨档案同 (packageId, kpId) 不得合并', () => {
  it('★ 两个档案各一行同键 → 零写入、零删除（一行都不能动）', () => {
    const rows = [
      progressRow({
        id: 1,
        profileId: 'default',
        status: '已掌握',
        correctCount: 4,
        correctStreak: 4,
        lastStudiedAt: '2025-03-01T00:00:00.000Z',
      }),
      progressRow({
        id: 2,
        profileId: 'p2',
        status: '需复习',
        correctCount: 1,
        wrongCount: 3,
        wrongStreak: 3,
        lastStudiedAt: '2025-03-02T00:00:00.000Z',
      }),
    ]

    const plan = planProgressMerge(rows, buildOwnerIndex([]))

    expect(plan.deletes).toEqual([]) // ★ 关键：不许删任何一行
    expect(plan.puts).toEqual([]) // 键没变、组内只有一条 → 连写都不该有
    expect(plan.stats.final).toBe(2)
    expect(plan.stats.mergedGroups).toBe(0)
    expect(plan.stats.mergedRowsRemoved).toBe(0)
  })

  it('★ 三个档案同键也各自独立', () => {
    const rows = ['default', 'p2', 'p3'].map((pid, i) =>
      progressRow({ id: i + 1, profileId: pid, correctCount: i + 1 })
    )
    const plan = planProgressMerge(rows, buildOwnerIndex([]))
    expect(plan.deletes).toEqual([])
    expect(plan.stats.final).toBe(3)
  })

  it('反向断言：**同一个档案内**同一知识点仍并成一行（不变量没被放松）', () => {
    const rows = [
      progressRow({ id: 1, profileId: 'default', correctCount: 2, lastStudiedAt: '2025-03-01T00:00:00.000Z' }),
      progressRow({ id: 2, profileId: 'default', correctCount: 3, lastStudiedAt: '2025-03-02T00:00:00.000Z' }),
      // 别的档案的同一知识点：不该参与上面这组的合并
      progressRow({ id: 3, profileId: 'p2', correctCount: 9 }),
    ]

    const plan = planProgressMerge(rows, buildOwnerIndex([]))

    expect(plan.puts).toHaveLength(1)
    expect(plan.deletes).toEqual([2]) // 只删同档案里重复的那行
    expect(plan.stats.mergedGroups).toBe(1)
    expect(plan.stats.mergedRowsRemoved).toBe(1)
    expect(plan.stats.final).toBe(2) // 3 行 → 2 行（每档案一行）
    // 合并后的承载体仍是 default 的那行，且 pid 没被别的档案污染
    expect(plan.puts[0].profileId).toBe('default')
    expect(plan.puts[0].correctCount).toBe(5)
  })

  it('归属包改写（keyChanged）也只在档案内生效：两个档案都会被改写，不会合并', () => {
    // 索引里 kp 属于 unit-p1（入口包是 special-x）→ 两行都要改包名，但仍是两行
    const index = buildOwnerIndex([
      {
        packageId: 'unit-p1',
        manifest: { packageId: 'unit-p1', subject: 'math', type: 'unit', title: 'unit-p1' },
        knowledgePoints: [{ id: 'unit-p1::kp1', title: 'kp' }],
        exercises: [],
        units: [],
      } as never,
    ])
    const rows = ['default', 'p2'].map((pid, i) =>
      progressRow({
        id: i + 1,
        profileId: pid,
        packageId: 'special-x',
        knowledgePointId: 'unit-p1::kp1',
      })
    )

    const plan = planProgressMerge(rows, index)
    expect(plan.deletes).toEqual([])
    expect(plan.puts).toHaveLength(2)
    expect(plan.puts.map((r) => r.profileId).sort()).toEqual(['default', 'p2'])
    expect(plan.puts.every((r) => r.packageId === 'unit-p1')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 第二层：applyMergePlan 不得跨档案复用自增 id
// ---------------------------------------------------------------------------
import { createFakeDexie } from './helpers/fakeDexie'

/**
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）：
 * 索引清单与 `src/db/index.ts` 的 `version(4)` 逐字对应，未知索引抛错。
 */
const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const { applyMergePlan } = await import('@core/merge/applyMergePlan')
const { emptyPlan } = await import('@core/backup/types')

describe('applyMergePlan — 同 (packageId, kpId) 不同档案 → upsert 不是 update', () => {
  beforeEach(() => {
    fake.__reset()
  })

  it('★ 本机 default 那行逐字段不变，库里恰好 2 行', async () => {
    const localRow = {
      id: 1,
      profileId: 'default',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '已掌握',
      correctCount: 4,
      wrongCount: 0,
      correctStreak: 4,
      wrongStreak: 0,
      lastStudiedAt: '2025-03-01T00:00:00.000Z',
      studySeconds: 100,
      masteryProbability: 0.91,
    }
    await fake.progress.add({ ...localRow })

    const plan = emptyPlan()
    plan.stats.noop = false
    plan.progressUpserts.push({
      // 同一个 (packageId, kpId)，但属于**另一个档案**
      profileId: 'p2',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '需复习',
      correctCount: 1,
      wrongCount: 2,
      correctStreak: 0,
      wrongStreak: 2,
      lastStudiedAt: '2025-04-01T00:00:00.000Z',
      studySeconds: 30,
    })

    await applyMergePlan(plan)

    // ① 行数：2 行（不是 1 行）
    expect(fake.progress.rows).toHaveLength(2)

    // ② 本机那一行**逐字段相同**（"改写了但行数没变"在这里会被抓住）
    const kept = fake.progress.rows.find((r) => r.profileId === 'default')
    expect(kept).toBeTruthy()
    for (const [key, value] of Object.entries(localRow)) {
      expect(kept![key], `字段 ${key} 被改写了`).toEqual(value)
    }

    // ③ 新档案那行是**新增**的，id 没有复用本机的 id
    const added = fake.progress.rows.find((r) => r.profileId === 'p2')
    expect(added).toBeTruthy()
    expect(added!.id).not.toBe(localRow.id)
    expect(added!.status).toBe('需复习')

    // ④ 行数与内容对得上（不是把两条合成一条 "已掌握+需复习" 的怪记录）
    expect(fake.progress.rows.map((r) => r.profileId).sort()).toEqual(['default', 'p2'])
  })

  it('同一档案同一知识点重复 upsert → 仍然 update 到同一行（不翻倍）', async () => {
    await fake.progress.add({
      id: 1,
      profileId: 'default',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '学习中',
      correctCount: 1,
      wrongCount: 0,
      correctStreak: 0,
      wrongStreak: 0,
      lastStudiedAt: '2025-03-01T00:00:00.000Z',
      studySeconds: 10,
    })

    const plan = emptyPlan()
    plan.stats.noop = false
    plan.progressUpserts.push({
      profileId: 'default',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '已掌握',
      correctCount: 5,
      wrongCount: 0,
      correctStreak: 5,
      wrongStreak: 0,
      lastStudiedAt: '2025-03-05T00:00:00.000Z',
      studySeconds: 50,
    })

    await applyMergePlan(plan)

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].correctCount).toBe(5)
  })
})
