import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * V1.6 · Stage A · A4 · 错题归属包收口
 * ---------------------------------------------------------------------------
 * ## 为什么错题也要归属包
 * `recordProgress` 在 V1.3 就把"落库的 packageId 由归属包决定"定下来了，
 * 但 `addMistake` 一直是直接写入参包。后果：在专项包 / 冲刺包里做错的题，
 * 错题行指着那个**临时**的包 —— 家长删掉专项包（它的设计使命就是用完即删）
 * 之后，错题本里那行就指向一个不存在的包，既查不到书名也没法跳转。
 *
 * 进度行没这个问题（写入端已归一化），错题行有 —— 这就是 A4 要补的洞。
 *
 * ## 与 `resolveProgressKey` 的两点差异（都在 `resolveMistakeTarget` 的注释里）
 * 1. 只解析 `kpIds[0]`：一道题挂多个知识点时"取哪一个"不该由写入端猜；
 * 2. 不规范化 kpId：错题的 kpIds 是题目携带的原值，复习/分组都按它反查。
 */

import { createFakeDexie } from './helpers/fakeDexie'
import type { LearningPackageRecord } from '@/db'

const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const { useUserDataStore } = await import('@core/stores/userData')
const {
  buildOwnerIndex,
  resolveMistakeTarget,
} = await import('@core/progress/ownerIndex')
const {
  setOwnerIndexSource,
  invalidateOwnerIndex,
} = await import('@core/progress/ownerIndexCache')
const { currentProfileId, initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')

// ---------------------------------------------------------------------------
// 夹具：两个单元包 + 一个专项包
// ---------------------------------------------------------------------------

/** 造一个只带 knowledgePoints 的包（归属索引只认这个字段） */
function pkg(packageId: string, subject: string, kpIds: string[], title = packageId): LearningPackageRecord {
  return {
    packageId,
    manifest: { title, subject, grade: 4 } as any,
    knowledgePoints: kpIds.map((id) => ({ id, title: `${id}-t` })) as any,
  } as LearningPackageRecord
}

const UNIT_MATH = pkg('unit-math-4-up-rjb-p1', 'math', ['u1::kp-add', 'u1::kp-carry'])
const UNIT_CN = pkg('unit-chinese-4-up-rjb-p1', 'chinese', ['c1::kp-pinyin'])
/** 专项包：引用单元包的知识点，但自己不声明（真实专项包就是这样） */
const SPECIAL = pkg('special-math-4-up-jiajiancheng', 'math', [], '加减乘除专项')

function index() {
  return buildOwnerIndex([UNIT_MATH, UNIT_CN, SPECIAL])
}

/** 一道题（addMistake 只用到 id / question / answer） */
function question(id: string) {
  return { id, question: `${id} 题干`, answer: 'A', options: ['A', 'B'] } as any
}

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

beforeEach(async () => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  await initProfile()
  setOwnerIndexSource([UNIT_MATH, UNIT_CN, SPECIAL])
})

// ---------------------------------------------------------------------------
// 纯函数：三分支
// ---------------------------------------------------------------------------

describe('A4 · resolveMistakeTarget（纯函数）', () => {
  it('唯一归属 → 归一到归属包（入口包是专项包时最典型）', () => {
    const r = resolveMistakeTarget(['u1::kp-add'], SPECIAL.packageId, index())
    expect(r).toEqual({ packageId: UNIT_MATH.packageId, resolved: true })
  })

  it('入口包自己就是归属包 → 原样返回', () => {
    const r = resolveMistakeTarget(['u1::kp-add'], UNIT_MATH.packageId, index())
    expect(r).toEqual({ packageId: UNIT_MATH.packageId, resolved: true })
  })

  it('零候选（谁都没声明这个 kpId）→ 保留入口包，不猜', () => {
    const r = resolveMistakeTarget(['nobody::kp-x'], SPECIAL.packageId, index())
    expect(r).toEqual({ packageId: SPECIAL.packageId, resolved: false })
  })

  it('歧义（两个包声明同一个 kpId）→ 保留入口包，不选代表', () => {
    const dup = pkg('unit-math-4-up-rjb-p2', 'math', ['u1::kp-add'])
    const idx = buildOwnerIndex([UNIT_MATH, dup])
    const r = resolveMistakeTarget(['u1::kp-add'], SPECIAL.packageId, idx)
    expect(r).toEqual({ packageId: SPECIAL.packageId, resolved: false })
  })

  it('跨学科 → 保留入口包（subject 闸门）', () => {
    // 入口包是语文、归属包是数学 → 一律视为异常，不动
    const r = resolveMistakeTarget(['u1::kp-add'], UNIT_CN.packageId, index())
    expect(r).toEqual({ packageId: UNIT_CN.packageId, resolved: false })
  })

  it('空 kpIds / 空数组 → 保留入口包', () => {
    expect(resolveMistakeTarget([], SPECIAL.packageId, index())).toEqual({
      packageId: SPECIAL.packageId,
      resolved: false,
    })
    expect(resolveMistakeTarget(undefined, SPECIAL.packageId, index())).toEqual({
      packageId: SPECIAL.packageId,
      resolved: false,
    })
  })

  it('多知识点只解析第一个（第二个跨包也不影响）', () => {
    const r = resolveMistakeTarget(['u1::kp-add', 'c1::kp-pinyin'], SPECIAL.packageId, index())
    expect(r.packageId).toBe(UNIT_MATH.packageId)
  })

  it('短 id 兜底：全库唯一声明者才用（english-7 式死锁在这里拦住）', () => {
    const bare = pkg('pkg-bare', 'math', ['kp-bare'])
    const idx = buildOwnerIndex([bare])
    expect(resolveMistakeTarget(['other::kp-bare'], SPECIAL.packageId, idx)).toEqual({
      packageId: bare.packageId,
      resolved: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 写入端：addMistake 真的按归属包落库
// ---------------------------------------------------------------------------

describe('A4 · addMistake 落库的 packageId', () => {
  it('专项包里做错 → 行落在单元包上', async () => {
    const s = store()
    await s.addMistake(question('ex-1'), SPECIAL.packageId, ['u1::kp-add'], 'B')

    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].packageId).toBe(UNIT_MATH.packageId)
    // kpIds 不做规范化：题目带什么就存什么
    expect(fake.mistakes.rows[0].knowledgePointIds).toEqual(['u1::kp-add'])
  })

  it('同一道题第二次答错 → 走 update 路径，packageId 不退回入口包', async () => {
    const s = store()
    await s.addMistake(question('ex-1'), SPECIAL.packageId, ['u1::kp-add'], 'B')
    await s.addMistake(question('ex-1'), SPECIAL.packageId, ['u1::kp-add'], 'A')

    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].packageId).toBe(UNIT_MATH.packageId)
    expect(fake.mistakes.rows[0].wrongCount).toBe(2)
  })

  it('归属包被删掉之后再次答错 → 保留行上的归属包（自愈，不退回入口包）', async () => {
    const s = store()
    await s.addMistake(question('ex-1'), SPECIAL.packageId, ['u1::kp-add'], 'B')

    // 单元包被删 → 索引里零候选 → resolved=false。
    // 此时若直接写入口包，这一行就跟着专项包一起"消失"了。
    setOwnerIndexSource([SPECIAL])
    invalidateOwnerIndex()
    await s.addMistake(question('ex-1'), SPECIAL.packageId, ['u1::kp-add'], 'B')

    expect(fake.mistakes.rows[0].packageId).toBe(UNIT_MATH.packageId)
  })

  it('老行（写入时还没有归属解析）在下次答错时被归位', async () => {
    // 直接种一行"入口包"形态的老数据
    await fake.mistakes.add({
      profileId: currentProfileId(),
      packageId: SPECIAL.packageId,
      exerciseId: 'ex-old',
      knowledgePointIds: ['u1::kp-carry'],
      wrongAt: '2026-01-01T00:00:00.000Z',
      wrongCount: 1,
      mastered: false,
    } as any)

    const s = store()
    await s.addMistake(question('ex-old'), SPECIAL.packageId, ['u1::kp-carry'], 'B')

    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].packageId).toBe(UNIT_MATH.packageId)
  })

  it('索引还没建（包表为空）→ 保留入口包，不抛', async () => {
    setOwnerIndexSource([])
    invalidateOwnerIndex()
    const s = store()
    await s.addMistake(question('ex-1'), SPECIAL.packageId, ['u1::kp-add'], 'B')
    expect(fake.mistakes.rows[0].packageId).toBe(SPECIAL.packageId)
  })
})
