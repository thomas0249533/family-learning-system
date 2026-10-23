/**
 * G1 · 技能树数据层单测（tests/graph-data.test.ts）
 * ---------------------------------------------------------------------
 * 覆盖：空数据、单根、多叉树拓扑（学科 → 单元 → 知识点）、四态判定、
 *       容器聚合、脏数据不炸（方案 §G1 验收）。
 * 状态判定复用 src/core/mastery/ 口径 —— 本测试同时钉住
 * 「MasteryStatus → 图谱四态」的桶映射不许漂移。
 */
import { describe, expect, it } from 'vitest'
import type { LearningPackageRecord, ProgressRecord } from '@/db'
import { buildGraphData, graphStatusOfRow, type GraphNode } from '@core/graph/buildGraphData'
import { makePkg, makeProgress } from './helpers/progressFixtures'

/** 造一个带单元的包（unit.topics.knowledgePointIds 收编 KP） */
function makePkgWithUnit(
  packageId: string,
  subject: string,
  kps: Array<{ id: string; title?: string }>,
  unitId: string,
  unitKpIds: string[]
): LearningPackageRecord {
  const pkg = makePkg(packageId, subject, kps)
  pkg.units = [
    {
      id: unitId,
      title: `单元 · ${unitId}`,
      topics: [{ id: `${unitId}-t1`, title: '话题', knowledgePointIds: unitKpIds }],
    },
  ]
  return pkg
}

function findByName(nodes: GraphNode[], name: string): GraphNode | undefined {
  return nodes.find((n) => n.name === name)
}

describe('buildGraphData —— 空数据与防御', () => {
  it('空包 + 空进度 → 空树', () => {
    expect(buildGraphData([], [])).toEqual([])
  })

  it('null / undefined 入参 → 空树，不抛', () => {
    expect(buildGraphData(null, undefined)).toEqual([])
    expect(buildGraphData(undefined, null)).toEqual([])
  })

  it('没有任何知识点的包 → 不出根', () => {
    const pkg = makePkg('p1', 'math', [])
    expect(buildGraphData([pkg], [])).toEqual([])
  })
})

describe('buildGraphData —— 拓扑', () => {
  it('单包无单元：学科根直接挂知识点（单根）', () => {
    const pkg = makePkg('p1', 'math', [
      { id: 'kp-a', title: '两位数乘法' },
      { id: 'kp-b', title: '带余除法' },
    ])
    const tree = buildGraphData([pkg], [])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('数学')
    expect(tree[0].children!.map((c) => c.name)).toEqual(['两位数乘法', '带余除法'])
    // 知识点节点 id 是 (packageId, kpId) 二元组键
    expect(tree[0].children![0].id).toBe(`p1\u0000kp-a`)
  })

  it('多学科 → 多根，按名称排序', () => {
    const math = makePkg('p-math', 'math', [{ id: 'kp-a', title: '乘法' }])
    const english = makePkg('p-en', 'english', [{ id: 'kp-b', title: '单词' }])
    const tree = buildGraphData([english, math], [])
    expect(tree.map((r) => r.name)).toEqual(['数学', '英语'])
  })

  it('多叉树：单元层插入，KP 归入收编它的单元', () => {
    const pkg = makePkgWithUnit(
      'p1',
      'math',
      [
        { id: 'kp-a', title: '乘法' },
        { id: 'kp-b', title: '除法' },
        { id: 'kp-c', title: '小数' },
      ],
      'u1',
      ['kp-a', 'kp-b']
    )
    const tree = buildGraphData([pkg], [])
    expect(tree).toHaveLength(1)
    const root = tree[0]
    // u1 收编 kp-a/kp-b；kp-c 未被任何单元收编 → 直接挂学科根
    expect(root.children).toHaveLength(2)
    const unit = findByName(root.children!, '单元 · u1')!
    expect(unit.children!.map((c) => c.name)).toEqual(['乘法', '除法'])
    expect(findByName(root.children!, '小数')).toBeDefined()
  })

  it('同一 KP 被多个单元引用 → 只出一次，首个单元收编', () => {
    const pkg = makePkg('p1', 'math', [{ id: 'kp-a', title: '乘法' }])
    pkg.units = [
      {
        id: 'u1',
        title: '单元一',
        topics: [{ id: 't1', title: '', knowledgePointIds: ['kp-a'] }],
      },
      {
        id: 'u2',
        title: '单元二',
        topics: [{ id: 't2', title: '', knowledgePointIds: ['kp-a'] }],
      },
    ]
    const tree = buildGraphData([pkg], [])
    const all = JSON.stringify(tree)
    expect(all.match(/乘法/g)).toHaveLength(1)
    expect(tree[0].children!.map((c) => c.name)).toEqual(['单元一'])
  })

  it('空单元（引用的 KP 不在本包）→ 丢弃', () => {
    const pkg = makePkg('p1', 'math', [{ id: 'kp-a', title: '乘法' }])
    pkg.units = [
      { id: 'u-empty', title: '空单元', topics: [{ id: 't', title: '', knowledgePointIds: ['kp-ghost'] }] },
    ]
    const tree = buildGraphData([pkg], [])
    expect(tree[0].children!.map((c) => c.name)).toEqual(['乘法'])
  })

  it('同 packageId 重复出现 → 只算一次', () => {
    const pkg = makePkg('p1', 'math', [{ id: 'kp-a', title: '乘法' }])
    const tree = buildGraphData([pkg, pkg], [])
    expect(tree[0].children).toHaveLength(1)
  })
})

describe('buildGraphData —— 四态判定（复用 mastery 口径）', () => {
  const pkg = makePkg('p1', 'math', [
    { id: 'kp-m', title: '已掌握点' },
    { id: 'kp-l', title: '学习中点' },
    { id: 'kp-r', title: '需复习点' },
    { id: 'kp-u', title: '未学点' },
  ])

  function progress() {
    return [
      makeProgress({ id: 1, packageId: 'p1', knowledgePointId: 'kp-m', status: '已掌握', wrongCount: 1 }),
      makeProgress({ id: 2, packageId: 'p1', knowledgePointId: 'kp-l', status: '学习中' }),
      makeProgress({ id: 3, packageId: 'p1', knowledgePointId: 'kp-r', status: '需复习', wrongCount: 3 }),
      // kp-u 无进度行 → unlearned
    ]
  }

  it('MasteryStatus 四态 → 图谱四态', () => {
    const kp = findByName(buildGraphData([pkg], progress())[0].children!, '需复习点')!
    expect(kp.status).toBe('review')
    expect(kp.wrongCount).toBe(3)
    const root = buildGraphData([pkg], progress())[0]
    expect(findByName(root.children!, '已掌握点')!.status).toBe('mastered')
    expect(findByName(root.children!, '学习中点')!.status).toBe('learning')
    expect(findByName(root.children!, '未学点')!.status).toBe('unlearned')
    expect(findByName(root.children!, '未学点')!.wrongCount).toBe(0)
  })

  it('graphStatusOfRow：未知脏状态 → unlearned（与 summary 的 notStarted 桶一致）', () => {
    expect(graphStatusOfRow(undefined)).toBe('unlearned')
    expect(graphStatusOfRow({ ...makeProgress({ id: 1, packageId: 'p', knowledgePointId: 'k' }), status: '乱写的' as never })).toBe('unlearned')
  })

  it('同 key 多条进度行 → 取 lastStudiedAt 最新', () => {
    const rows = [
      makeProgress({ id: 1, packageId: 'p1', knowledgePointId: 'kp-m', status: '学习中', lastStudiedAt: '2026-01-01T00:00:00.000Z' }),
      makeProgress({ id: 2, packageId: 'p1', knowledgePointId: 'kp-m', status: '已掌握', lastStudiedAt: '2026-01-02T00:00:00.000Z' }),
    ]
    const node = findByName(buildGraphData([pkg], rows)[0].children!, '已掌握点')!
    expect(node.status).toBe('mastered')
  })

  it('容器聚合：全 mastered → mastered；有 review → review', () => {
    const pkgWithUnit = makePkgWithUnit(
      'p1',
      'math',
      [
        { id: 'kp-a', title: '甲' },
        { id: 'kp-b', title: '乙' },
      ],
      'u1',
      ['kp-a', 'kp-b']
    )
    const allMastered = [
      makeProgress({ id: 1, packageId: 'p1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'p1', knowledgePointId: 'kp-b', status: '已掌握' }),
    ]
    const unit = buildGraphData([pkgWithUnit], allMastered)[0].children![0]
    expect(unit.status).toBe('mastered')

    const hasReview = [
      makeProgress({ id: 1, packageId: 'p1', knowledgePointId: 'kp-a', status: '已掌握' }),
      makeProgress({ id: 2, packageId: 'p1', knowledgePointId: 'kp-b', status: '需复习' }),
    ]
    const unit2 = buildGraphData([pkgWithUnit], hasReview)[0].children![0]
    expect(unit2.status).toBe('review')

    // 部分已掌握 + 部分未学 → learning（推进中）
    const partial = [
      makeProgress({ id: 1, packageId: 'p1', knowledgePointId: 'kp-a', status: '已掌握' }),
    ]
    const unit3 = buildGraphData([pkgWithUnit], partial)[0].children![0]
    expect(unit3.status).toBe('learning')
  })

  it('学科根聚合：wrongCount 为子树求和', () => {
    const rows = [
      makeProgress({ id: 1, packageId: 'p1', knowledgePointId: 'kp-m', status: '已掌握', wrongCount: 1 }),
      makeProgress({ id: 3, packageId: 'p1', knowledgePointId: 'kp-r', status: '需复习', wrongCount: 3 }),
    ]
    const root = buildGraphData([pkg], rows)[0]
    expect(root.wrongCount).toBe(4)
    expect(root.status).toBe('review')
  })
})

describe('buildGraphData —— 脏数据不炸', () => {
  it('包缺 manifest / subject → 落「未分组」根', () => {
    const bad = { packageId: 'p1', knowledgePoints: [{ id: 'kp-a', title: '甲' }], exercises: [], units: [] } as unknown as LearningPackageRecord
    const noSubject = makePkg('p2', 'math', [{ id: 'kp-b', title: '乙' }])
    ;(noSubject.manifest as { subject?: string }).subject = undefined
    const tree = buildGraphData([bad, noSubject], [])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('未分组')
    expect(tree[0].children).toHaveLength(2)
  })

  it('KP 缺 id / unit 缺 id / topics 非数组 → 跳过，不抛', () => {
    const pkg = makePkg('p1', 'math', [
      { id: '', title: '无 id' },
      { id: 'kp-ok', title: '正常' },
    ])
    pkg.units = [
      { title: '没有 id 的单元' },
      { id: 'u1', title: '正常单元', topics: '不是数组' as unknown as undefined },
    ]
    const tree = buildGraphData([pkg], [])
    expect(tree[0].children!.map((c) => c.name)).toEqual(['正常'])
  })

  it('进度行缺键 / 非对象 / wrongCount 是 NaN → 保守处理，不抛', () => {
    const pkg = makePkg('p1', 'math', [{ id: 'kp-a', title: '甲' }])
    const dirtyProgress = [
      { packageId: '', knowledgePointId: 'kp-a', status: '已掌握' },
      { packageId: 'p1', knowledgePointId: '', status: '已掌握' },
      null,
      42,
      { packageId: 'p1', knowledgePointId: 'kp-a', status: '已掌握', wrongCount: Number.NaN },
    ] as unknown as ProgressRecord[]
    const tree = buildGraphData([pkg], dirtyProgress)
    // 前四条脏行全部无效 → 无进度行 → unlearned；
    // 最后一行键齐全（wrongCount=NaN 被 finiteCount 收敛为 0）→ 有效，按 mastery 口径判 mastered
    expect(tree[0].children![0].status).toBe('mastered')
    expect(tree[0].children![0].wrongCount).toBe(0)
  })

  it('packages 里混入 null / 非对象 → 跳过', () => {
    const pkg = makePkg('p1', 'math', [{ id: 'kp-a', title: '甲' }])
    const tree = buildGraphData([null, 7, pkg] as unknown as LearningPackageRecord[], [])
    expect(tree).toHaveLength(1)
  })
})
