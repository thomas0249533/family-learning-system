import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createFakeDexie, V3_INDICES, V4_INDICES } from './helpers/fakeDexie'

/**
 * 假 Dexie 自身的防线（V1.6 · Stage A · A6）。
 *
 * ## 为什么会有这个文件
 * A2 把 6 份内联假库收成单一真相后，全量单测**全绿**。这是个危险信号：
 * 一副有牙的替身本该当场咬出几个"未声明索引 / 少传 profileId"的用例 ——
 * 全绿只有两种解释：(a) 生产代码和夹具全都干净；(b) 替身在某些用法上
 * 静默 fallback，错误被它咽下去了。
 *
 * 审计结论是 (b)：旧替身在五处静默 fallback（复合索引短数组/标量、
 * null key、add 撞主键、缺 profileId 的夹具行、first() 交活行），
 * A6 已逐一补成抛错。本文件负责**证明牙是真的**，并且**防止牙再被拔掉**：
 * 将来谁把这些抛错改回静默语义，这里必须红，而不是安静地全绿。
 *
 * ## 断言分两组
 * 1. 索引清单与 `src/db/index.ts` 原文逐字一致 —— schema bump 时忘了
 *    同步 `V4_INDICES` / `V3_INDICES` 就红（这是"单一真相"的终极形态）；
 * 2. 每一道旧静默 fallback 都有对应的抛错断言 + 合法用法照常工作
 *    （防止"为了炸而炸"，把正常查询也挡掉）。
 */

// ---------------------------------------------------------------------------
// 1. 索引清单 ↔ 真 schema 一致性
// ---------------------------------------------------------------------------

/** 从 `src/db/index.ts` 原文里抠出某个 `version(n).stores({...})` 的索引清单 */
function storesOfVersion(n: number): Record<string, string[]> {
  const src = readFileSync(
    fileURLToPath(new URL('../src/db/index.ts', import.meta.url)),
    'utf8'
  )
  const vStart = src.indexOf(`this.version(${n})`)
  expect(vStart, `src/db/index.ts 应包含 this.version(${n})`).toBeGreaterThan(-1)
  const storesStart = src.indexOf('.stores({', vStart)
  expect(storesStart, `version(${n}) 应调用 .stores()`).toBeGreaterThan(-1)
  // 配对花括号找 .stores() 块的结尾（注释里没有花括号，可以朴素数）
  let depth = 0
  let end = -1
  for (let i = src.indexOf('{', storesStart); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  expect(end, `version(${n}) 的 .stores() 块应能找到右花括号`).toBeGreaterThan(-1)
  const body = src.slice(storesStart, end)
  const out: Record<string, string[]> = {}
  const re = /(\w+):\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && s !== '++id')
  }
  return out
}

describe('fakeDexie 索引清单与 src/db/index.ts 逐字一致', () => {
  it('V4_INDICES ≡ version(4)', () => {
    expect(storesOfVersion(4)).toEqual({ ...V4_INDICES })
  })

  it('V3_INDICES ≡ version(3)', () => {
    expect(storesOfVersion(3)).toEqual({ ...V3_INDICES })
  })
})

// ---------------------------------------------------------------------------
// 2. 未知索引抛错（A2 的原始牙齿，防回归）
// ---------------------------------------------------------------------------

describe('未知索引抛错', () => {
  it('v4 已删除的旧复合索引抛错', () => {
    const fake = createFakeDexie()
    // v3 有、v4 删了的索引：用了它就是跨档案串数据
    expect(() => fake.progress.where('[packageId+knowledgePointId]')).toThrow(/未知索引/)
  })

  it('根本不存在的字段名抛错', () => {
    const fake = createFakeDexie()
    expect(() => fake.progress.where('knowledgePointId')).toThrow(/未知索引/)
    // mistakes 的 exerciseId 单列索引也在 v4 被复合索引取代
    expect(() => fake.mistakes.where('exerciseId')).toThrow(/未知索引/)
  })
})

// ---------------------------------------------------------------------------
// 3. 复合索引 equals() 形参校验 —— "少传 profileId" 必须炸
// ---------------------------------------------------------------------------

describe('复合索引 equals() 形参校验', () => {
  it('短数组（少传 profileId）抛错', () => {
    const fake = createFakeDexie()
    expect(() =>
      fake.progress.where('[profileId+packageId+knowledgePointId]').equals(['p', 'k'])
    ).toThrow(/3 元复合索引/)
    expect(() => fake.mistakes.where('[profileId+exerciseId]').equals(['default'])).toThrow(
      /2 元复合索引/
    )
  })

  it('长数组抛错', () => {
    const fake = createFakeDexie()
    expect(() =>
      fake.progress.where('[profileId+packageId]').equals(['a', 'b', 'c'])
    ).toThrow(/2 元复合索引/)
  })

  it('复合索引传标量抛错（真库静默空，旧替身按首字段多返）', () => {
    const fake = createFakeDexie()
    expect(() => fake.progress.where('[profileId+packageId]').equals('default')).toThrow(
      /必须传长度 2 的数组/
    )
  })

  it('单列索引传数组抛错', () => {
    const fake = createFakeDexie()
    expect(() => fake.progress.where('profileId').equals(['default'])).toThrow(/单列索引/)
  })

  it('equals(null/undefined) 抛错（真库 reject；旧替身匹配 undefined 行）', () => {
    const fake = createFakeDexie()
    expect(() => fake.progress.where('profileId').equals(undefined)).toThrow(/null\/undefined/)
    expect(() => fake.progress.where('profileId').equals(null)).toThrow(/null\/undefined/)
  })

  it('equals(false) 合法 —— 别把假值当 null', async () => {
    const fake = createFakeDexie()
    await fake.mistakes.add({
      profileId: 'default',
      packageId: 'p',
      exerciseId: 'e',
      mastered: false,
    })
    const hit = await fake.mistakes.where('mastered').equals(false).first()
    expect(hit?.exerciseId).toBe('e')
  })

  it('正确形参正常选中', async () => {
    const fake = createFakeDexie()
    await fake.progress.add({
      profileId: 'default',
      packageId: 'p',
      knowledgePointId: 'k',
    })
    const hit = await fake.progress
      .where('[profileId+packageId+knowledgePointId]')
      .equals(['default', 'p', 'k'])
      .first()
    expect(hit?.knowledgePointId).toBe('k')
  })
})

// ---------------------------------------------------------------------------
// 4. add() 撞主键抛错（真库 ConstraintError）
// ---------------------------------------------------------------------------

describe('add() 撞主键抛错', () => {
  it('settings 同 key add 两次 → 第二次拒绝，且不污染第一行', async () => {
    const fake = createFakeDexie()
    await fake.settings.add({ key: 'k', value: 1 })
    await expect(fake.settings.add({ key: 'k', value: 2 })).rejects.toThrow(/主键冲突/)
    expect(fake.settings.rows).toHaveLength(1)
    expect(fake.settings.rows[0].value).toBe(1)
  })

  it('autoId 表显式 id 冲突抛错', async () => {
    const fake = createFakeDexie()
    const row = { id: 7, profileId: 'default', packageId: 'p', knowledgePointId: 'k' }
    await fake.progress.add(row)
    await expect(fake.progress.add({ ...row })).rejects.toThrow(/主键冲突/)
    expect(fake.progress.rows).toHaveLength(1)
  })

  it('autoId 表现在 max(id)+1，手工塞过 id 也不撞', async () => {
    const fake = createFakeDexie()
    fake.progress.rows.push({ id: 1, profileId: 'default' })
    const k = await fake.progress.add({
      profileId: 'default',
      packageId: 'p',
      knowledgePointId: 'k2',
    })
    expect(k).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 5. v4 行级 profileId 断言
// ---------------------------------------------------------------------------

describe('v4 行级 profileId 断言', () => {
  it('progress/mistakes/examSessions 缺 profileId → put/add 都拒绝', async () => {
    const fake = createFakeDexie()
    await expect(fake.progress.put({ packageId: 'p', knowledgePointId: 'k' })).rejects.toThrow(
      /profileId/
    )
    await expect(fake.progress.add({ packageId: 'p', knowledgePointId: 'k' })).rejects.toThrow(
      /profileId/
    )
    await expect(fake.mistakes.add({ packageId: 'p', exerciseId: 'e' })).rejects.toThrow(
      /profileId/
    )
    await expect(fake.examSessions.add({ packageId: 'p' })).rejects.toThrow(/profileId/)
  })

  it('空串 profileId 同样拒绝', async () => {
    const fake = createFakeDexie()
    await expect(
      fake.progress.add({ profileId: '', packageId: 'p', knowledgePointId: 'k' })
    ).rejects.toThrow(/profileId/)
  })

  it('settings 不在此断言范围（按 key 分片，由 check:settings-keys 守）', async () => {
    const fake = createFakeDexie()
    await fake.settings.add({ key: 'anything', value: 1 })
    expect(fake.settings.rows).toHaveLength(1)
  })

  it('v3 索引形态不断言（老数据夹具）', async () => {
    const fake = createFakeDexie({ indices: 'v3' })
    await fake.progress.add({ id: 1, packageId: 'p', knowledgePointId: 'k' })
    expect(fake.progress.rows).toHaveLength(1)
  })

  it('显式 requireProfileId:false 豁免', async () => {
    const fake = createFakeDexie({
      overrides: { progress: { requireProfileId: false } },
    })
    await fake.progress.add({ id: 1, packageId: 'p', knowledgePointId: 'k' })
    expect(fake.progress.rows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 6. 读接口返回副本（不污染库）
// ---------------------------------------------------------------------------

describe('读接口返回副本', () => {
  it('first() 改顶层字段不影响库里', async () => {
    const fake = createFakeDexie()
    await fake.settings.put({ key: 'k', value: 1 })
    const got = await fake.settings.where('key').equals('k').first()
    expect(got).toBeDefined()
    got!.value = 999
    const again = await fake.settings.get('k')
    expect(again?.value).toBe(1)
  })
})
