import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * attemptedTypes 单测：读取 / 去重 / 忽略空值 / 落盘持久化。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const rows: Row[] = []
  let putCalls = 0
  return {
    rows,
    get putCalls() { return putCalls },
    settings: {
      async get(k: any) { return rows.find((r) => r.key === k) },
      async put(r: Row) {
        putCalls++
        const i = rows.findIndex((x) => x.key === r.key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return r.key
      },
    },
    __reset() { rows.length = 0; putCalls = 0 },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const {
  loadAttemptedTypes,
  addAttemptedType,
  flushAttemptedTypes,
  attemptedTypesKey,
  __resetAttemptedTypesForTest,
} = await import('@core/motivation/attemptedTypes')

beforeEach(() => {
  fake.__reset()
  __resetAttemptedTypesForTest()
})

describe('attemptedTypes', () => {
  it('空库 → []', async () => {
    expect(await loadAttemptedTypes()).toEqual([])
  })

  it('add 后可见', async () => {
    await loadAttemptedTypes() // 初始化缓存
    addAttemptedType('blank')
    expect(await loadAttemptedTypes()).toEqual(['blank'])
  })

  it('去重：同名题型只记一次', async () => {
    await loadAttemptedTypes()
    addAttemptedType('blank')
    addAttemptedType('blank')
    addAttemptedType('single')
    const types = await loadAttemptedTypes()
    expect(types.sort()).toEqual(['blank', 'single'])
  })

  it('空字符串被忽略', async () => {
    await loadAttemptedTypes()
    addAttemptedType('')
    expect(await loadAttemptedTypes()).toEqual([])
  })

  it('flush 落盘持久化到 settings', async () => {
    await loadAttemptedTypes()
    addAttemptedType('judge')
    addAttemptedType('spelling')
    await flushAttemptedTypes()
    // 落库键带档案后缀：写成基名 = 换档案后"题型收藏家"按另一个孩子的进度判定
    expect(attemptedTypesKey()).toBe('attemptedTypes:default')
    const row = fake.rows.find((r) => r.key === attemptedTypesKey())
    expect(row).toBeTruthy()
    expect([...row!.value].sort()).toEqual(['judge', 'spelling'])
  })

  it('能读取既有存储（去重后）', async () => {
    await fake.settings.put({ key: attemptedTypesKey(), value: ['multiple', 'blank', 'blank'] })
    __resetAttemptedTypesForTest()
    const types = await loadAttemptedTypes()
    expect(types.sort()).toEqual(['blank', 'multiple'])
  })

  it('bump 不立即落盘（防抖），flush 才写', async () => {
    await loadAttemptedTypes()
    const before = fake.putCalls
    addAttemptedType('essay')
    expect(fake.putCalls).toBe(before)
    await flushAttemptedTypes()
    expect(fake.putCalls).toBeGreaterThan(before)
  })
})
