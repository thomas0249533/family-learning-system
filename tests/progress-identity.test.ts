import { describe, expect, it } from 'vitest'
import {
  buildOwnerIndex,
  canonicalKpId,
  resolveOwnerPackageId,
  resolveProgressKey,
  stripPrefix,
} from '@core/progress/ownerIndex'
import { makeEnglishSeven, makePkg } from './helpers/progressFixtures'

describe('stripPrefix', () => {
  it('去掉 `::` 前缀；无前缀时原样返回', () => {
    expect(stripPrefix('unit-x::kp-a')).toBe('kp-a')
    expect(stripPrefix('kp-a')).toBe('kp-a')
    expect(stripPrefix('')).toBe('')
  })

  it('只按第一个 `::` 切（id 里再有 `::` 也不动）', () => {
    expect(stripPrefix('a::b::c')).toBe('b::c')
  })
})

describe('buildOwnerIndex — own = knowledgePoints 里声明了该 kpId 的包（C1）', () => {
  it('同包重复声明同一 kpId 不会把自己算成两个声明者', () => {
    const pkg = makePkg('p1', 'math', [{ id: 'kp-a' }, { id: 'kp-a' }])
    const index = buildOwnerIndex([pkg])
    expect(index.byKpId.get('kp-a')).toEqual(['p1'])
    expect(resolveOwnerPackageId('kp-a', 'p1', index)).toBe('p1')
  })

  it('按 knowledgePoints 判定，不看 units（units 引用不算声明）', () => {
    const owner = makePkg('p-owner', 'math', [{ id: 'kp-a' }])
    const aggregator = makePkg('p-agg', 'math', [])
    aggregator.units = [{ id: 'u1', knowledgePointIds: ['kp-a'] }]
    const index = buildOwnerIndex([owner, aggregator])
    expect(resolveOwnerPackageId('kp-a', 'p-agg', index)).toBe('p-owner')
  })

  it('subject 表按包记录', () => {
    const index = buildOwnerIndex([makePkg('p1', 'math', []), makePkg('p2', '', [])])
    expect(index.subjectByPkgId.get('p1')).toBe('math')
    expect(index.subjectByPkgId.has('p2')).toBe(false)
  })
})

describe('resolveOwnerPackageId — 严格三分支，零 tie-break（C2）', () => {
  it('|own| == 1 → 该包（跨包调用也解析到归属包）', () => {
    const index = buildOwnerIndex([
      makePkg('unit-a', 'math', [{ id: 'kp-a' }]),
      makePkg('term-x', 'math', []),
    ])
    expect(resolveOwnerPackageId('kp-a', 'term-x', index)).toBe('unit-a')
  })

  it('|own| == 0 → null（不知道就不动，绝不 fallback 到入口包）', () => {
    const index = buildOwnerIndex([makePkg('unit-a', 'math', [{ id: 'kp-a' }])])
    expect(resolveOwnerPackageId('word-apple', 'unit-a', index)).toBeNull()
  })

  it('|own| >= 2 → null，**即使所有候选 title 完全相同也不选代表**', () => {
    const index = buildOwnerIndex([
      makePkg('base-1', 'math', [{ id: 'kp-a', title: '同一个知识点' }]),
      makePkg('unit-1', 'math', [{ id: 'kp-a', title: '同一个知识点' }]),
    ])
    expect(index.byKpId.get('kp-a')).toEqual(['base-1', 'unit-1'])
    // `mastery-metric-definition.md` §3.4 曾拟"title 全同则取副本代表"，
    // 该拟法在**写入层**已由 team-lead 作废（C2）——写入端错了会永久污染数据。
    expect(resolveOwnerPackageId('kp-a', 'base-1', index)).toBeNull()
  })

  it('|own| >= 2 时换成短 id 去查也不会绕过歧义', () => {
    const index = buildOwnerIndex([
      makePkg('a-1', 'math', [{ id: 'a-1::kp-a' }]),
      makePkg('b-1', 'math', [{ id: 'b-1::kp-a' }]),
    ])
    expect(resolveOwnerPackageId('kp-a', 'a-1', index)).toBeNull()
  })
})

describe('resolveOwnerPackageId — english-7 的 49→7 陷阱', () => {
  it('裸 JSON 路径：7 个包共用 7 个裸 id → 全部判为歧义（不合并、不塌缩）', () => {
    const index = buildOwnerIndex(makeEnglishSeven())
    for (const id of ['kp-reading-001', 'kp-word-001', 'kp-grammar-002']) {
      expect(index.byKpId.get(id)?.length).toBe(7)
      expect(resolveOwnerPackageId(id, 'unit-english-7-up-rjb-p1', index)).toBeNull()
    }
  })

  it('运行时路径：带包前缀的 id 精确命中，解析到自己的包', () => {
    const packages = makeEnglishSeven(true)
    const index = buildOwnerIndex(packages)
    expect(resolveOwnerPackageId('unit-english-7-up-rjb-p3::kp-reading-001', 'x', index)).toBe(
      'unit-english-7-up-rjb-p3'
    )
    expect(index.byKpId.size).toBe(49)
  })
})

describe('resolveOwnerPackageId — subject 闸门', () => {
  it('两侧 subject 都非空且不等 → null（跨学科归属视为异常，不动）', () => {
    const index = buildOwnerIndex([
      makePkg('special-chinese', 'chinese', [{ id: 'kp-reading-001' }]),
      makePkg('unit-english', 'english', []),
    ])
    expect(resolveOwnerPackageId('kp-reading-001', 'unit-english', index)).toBeNull()
  })

  it('入口包不在索引里（subject 未知）→ 跳过闸门，正常归属', () => {
    const index = buildOwnerIndex([makePkg('unit-math', 'math', [{ id: 'kp-a' }])])
    expect(resolveOwnerPackageId('kp-a', 'pkg-not-loaded', index)).toBe('unit-math')
  })

  it('归属包缺 subject → 跳过闸门，不把 undefined !== math 误判成跨学科', () => {
    const index = buildOwnerIndex([
      makePkg('legacy-pkg', '', [{ id: 'kp-a' }]),
      makePkg('unit-math', 'math', []),
    ])
    expect(resolveOwnerPackageId('kp-a', 'unit-math', index)).toBe('legacy-pkg')
  })

  it('同 subject → 正常归属', () => {
    const index = buildOwnerIndex([
      makePkg('unit-math', 'math', [{ id: 'kp-a' }]),
      makePkg('term-math', 'math', []),
    ])
    expect(resolveOwnerPackageId('kp-a', 'term-math', index)).toBe('unit-math')
  })
})

describe('resolveOwnerPackageId — 短 id 只作兜底', () => {
  it('历史行写短 id，但全库只有一个声明者 → 解析成功', () => {
    const index = buildOwnerIndex([makePkg('unit-a', 'math', [{ id: 'unit-a::kp-a' }])])
    expect(resolveOwnerPackageId('kp-a', 'term-x', index)).toBe('unit-a')
  })

  it('短 id 有两个声明者 → null', () => {
    const index = buildOwnerIndex([
      makePkg('a-1', 'math', [{ id: 'a-1::kp-a' }]),
      makePkg('b-1', 'math', [{ id: 'b-1::kp-a' }]),
    ])
    expect(resolveOwnerPackageId('kp-a', 'a-1', index)).toBeNull()
  })
})

describe('canonicalKpId', () => {
  it('精确命中 → 原值返回（99%+ 的情况零变化）', () => {
    const index = buildOwnerIndex([makePkg('unit-a', 'math', [{ id: 'unit-a::kp-a' }])])
    expect(canonicalKpId('unit-a', 'unit-a::kp-a', index)).toBe('unit-a::kp-a')
  })

  it('命中短 id 分支 → 换成归属包声明的完整 id', () => {
    const index = buildOwnerIndex([makePkg('unit-a', 'math', [{ id: 'unit-a::kp-a' }])])
    expect(canonicalKpId('unit-a', 'kp-a', index)).toBe('unit-a::kp-a')
  })

  it('找不到 → 原值返回（防御性，不改写入内容）', () => {
    const index = buildOwnerIndex([makePkg('unit-a', 'math', [{ id: 'unit-a::kp-a' }])])
    expect(canonicalKpId('unit-a', 'kp-unknown', index)).toBe('kp-unknown')
  })
})

describe('resolveProgressKey — 一步换两个字段', () => {
  const index = buildOwnerIndex([
    makePkg('unit-a', 'math', [{ id: 'unit-a::kp-a' }]),
    makePkg('term-x', 'math', []),
    makePkg('unit-b', 'math', [{ id: 'kp-ambiguous' }]),
    makePkg('unit-c', 'math', [{ id: 'kp-ambiguous' }]),
  ])

  it('解析成功 → resolved true 且 kpId 规范化', () => {
    expect(resolveProgressKey('kp-a', 'term-x', index)).toEqual({
      packageId: 'unit-a',
      knowledgePointId: 'unit-a::kp-a',
      resolved: true,
    })
  })

  it('解析失败 → 原样返回（保留入口包，不猜）', () => {
    expect(resolveProgressKey('kp-ambiguous', 'term-x', index)).toEqual({
      packageId: 'term-x',
      knowledgePointId: 'kp-ambiguous',
      resolved: false,
    })
  })
})
