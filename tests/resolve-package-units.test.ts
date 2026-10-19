import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolvePackageUnits` 三段式回归（V1.3 · E-01 · D2 / D4）。
 *
 * 这是 english-7 那条链式依赖缺陷的**唯一**防线：
 * 旧实现按 `dependencies.length === 0` 判断"是不是聚合包"，于是 p2 只显示 p1 的单元，
 * 且 `findUnitByKnowledgePoint(p2, p2 自己的 kp)` 恒为 null → 6/7 单元包的学习记录进不了复习计划。
 */
const fake = vi.hoisted(() => {
  const packages = new Map<string, any>()
  return {
    packages,
    db: {
      packages: {
        async get(id: string) {
          return packages.get(id)
        },
      },
    },
    put(pkg: any) {
      packages.set(pkg.packageId, pkg)
    },
    reset() {
      packages.clear()
    },
  }
})

vi.mock('@/db', () => ({ db: fake.db }))

const { resolvePackageUnits, findUnitByKnowledgePoint } = await import(
  '@core/importer/resolvePackageUnits'
)

// ---------- 夹具 ----------

function unit(id: string, kpIds: string[]) {
  return { id, title: id, topics: [{ id: `${id}::t1`, knowledgePointIds: kpIds }] }
}

function pkg(opts: {
  packageId: string
  type?: string
  deps?: string[]
  sourceUnitIds?: string[]
  units?: any[]
  subject?: string
}) {
  return {
    packageId: opts.packageId,
    manifest: {
      packageId: opts.packageId,
      type: opts.type ?? 'unit',
      subject: opts.subject ?? 'english',
      title: opts.packageId,
      dependencies: opts.deps ?? [],
      ...(opts.sourceUnitIds ? { sourceUnitIds: opts.sourceUnitIds } : {}),
    },
    knowledgePoints: [],
    exercises: [],
    units: opts.units ?? [],
  }
}

beforeEach(() => {
  fake.reset()
})

describe('unit 包 / base 包：只看自己', () => {
  it('★ 链式依赖（p2 deps=[p1]）不再把 p1 的单元漏进 p2 —— D2 的核心断言', async () => {
    fake.put(pkg({ packageId: 'p1', type: 'unit', units: [unit('p1::u1', ['p1::kp1'])] }))
    fake.put(pkg({ packageId: 'p2', type: 'unit', deps: ['p1'], units: [unit('p2::u2', ['p2::kp1'])] }))

    const r = await resolvePackageUnits(fake.packages.get('p2'))

    expect(r.units.map((u) => u.unit.id)).toEqual(['p2::u2'])
    expect(r.isAggregate).toBe(false)
  })

  it('★ 复习计划能反查到自己的单元（旧实现这里恒为 null）', async () => {
    fake.put(pkg({ packageId: 'p1', units: [unit('p1::u1', ['p1::kp1'])] }))
    fake.put(pkg({ packageId: 'p2', deps: ['p1'], units: [unit('p2::u2', ['p2::kp1'])] }))

    const found = await findUnitByKnowledgePoint(fake.packages.get('p2'), 'p2::kp1')

    expect(found).toEqual({
      unitId: 'p2::u2',
      topicId: 'p2::u2::t1',
      sourcePackageId: 'p2',
    })
  })

  it('链式依赖缺包也不报错（unit 包根本不读依赖）', async () => {
    fake.put(pkg({ packageId: 'p2', deps: ['p1-不存在'], units: [unit('p2::u2', [])] }))
    const r = await resolvePackageUnits(fake.packages.get('p2'))
    expect(r.units).toHaveLength(1)
    expect(r.missing).toEqual([])
  })

  it('`packageType` 与 `type` 两种字段名都能识别', async () => {
    const p = pkg({ packageId: 'p2', type: 'unit', deps: ['p1'], units: [unit('p2::u2', [])] })
    // 真实 JSON 只写 type；这里额外验证别名分支
    p.manifest = { ...p.manifest, packageType: 'unit' }
    delete (p.manifest as any).type
    fake.put(pkg({ packageId: 'p1', units: [unit('p1::u1', [])] }))

    const r = await resolvePackageUnits(p)
    expect(r.units.map((u) => u.unit.id)).toEqual(['p2::u2'])
  })
})

describe('term 包：自有 + 全量依赖', () => {
  it('自有单元在前，依赖单元按 dependencies 顺序追加', async () => {
    fake.put(pkg({ packageId: 'p1', units: [unit('p1::u1', [])] }))
    fake.put(pkg({ packageId: 'p2', units: [unit('p2::u2', [])] }))
    const term = pkg({
      packageId: 'term-x',
      type: 'term',
      deps: ['p2', 'p1'],
      units: [unit('term-x::all', [])],
    })

    const r = await resolvePackageUnits(term)

    expect(r.units.map((u) => u.unit.id)).toEqual(['term-x::all', 'p2::u2', 'p1::u1'])
    expect(r.isAggregate).toBe(true)
  })

  it('缺依赖 → 记进 missing，其余照常返回', async () => {
    fake.put(pkg({ packageId: 'p1', units: [unit('p1::u1', [])] }))
    const term = pkg({ packageId: 'term-x', type: 'term', deps: ['p1', 'p-ghost'] })

    const r = await resolvePackageUnits(term)

    expect(r.units.map((u) => u.unit.id)).toEqual(['p1::u1'])
    expect(r.missing).toEqual(['p-ghost'])
  })

  it('同一 unit.id 被自有与依赖同时提供 → 只保留一份（自有优先）', async () => {
    fake.put(pkg({ packageId: 'p1', units: [unit('dup', []), unit('p1::other', [])] }))
    const term = pkg({ packageId: 'term-x', type: 'term', deps: ['p1'], units: [unit('dup', [])] })

    const r = await resolvePackageUnits(term)

    expect(r.units.filter((u) => u.unit.id === 'dup')).toHaveLength(1)
    expect(r.units[0].sourcePackageId).toBe('term-x')
  })
})

describe('special / sprint 包：按 sourceUnitIds 精确追加', () => {
  it('★ 只追加映射里点名的单元，不整包 dump', async () => {
    fake.put(
      pkg({
        packageId: 'p7',
        units: [unit('p7::u7', ['p7::kp1']), unit('p7::u8', ['p7::kp2'])],
      })
    )
    const special = pkg({
      packageId: 'special-x',
      type: 'special',
      deps: ['p7'],
      sourceUnitIds: ['p7::u7'],
      units: [unit('special-x::su', ['p7::kp1'])],
    })

    const r = await resolvePackageUnits(special)

    expect(r.units.map((u) => u.unit.id)).toEqual(['special-x::su', 'p7::u7'])
    expect(r.isAggregate).toBe(true)
  })

  it('sourceUnitIds 里有 7 个 → 7 个都进来（grammar/vocab 那种包）', async () => {
    const units = Array.from({ length: 7 }, (_, i) => unit(`p${i}::u`, [`p${i}::kp`]))
    units.forEach((u, i) => fake.put(pkg({ packageId: `p${i}`, units: [u] })))
    const special = pkg({
      packageId: 'special-g',
      type: 'special',
      deps: units.map((_, i) => `p${i}`),
      sourceUnitIds: units.map((u) => u.id),
      units: [unit('special-g::su', [])],
    })

    const r = await resolvePackageUnits(special)
    expect(r.units).toHaveLength(8) // 自有 1 + 来源 7
  })

  it('★ 映射点名了但依赖里找不到该单元 → 记进 missing（可提示，不静默）', async () => {
    fake.put(pkg({ packageId: 'p7', units: [unit('p7::u7', [])] }))
    const special = pkg({
      packageId: 'special-x',
      type: 'special',
      deps: ['p7'],
      sourceUnitIds: ['p7::u7', 'p7::u99'],
      units: [unit('special-x::su', [])],
    })

    const r = await resolvePackageUnits(special)

    expect(r.units.map((u) => u.unit.id)).toEqual(['special-x::su', 'p7::u7'])
    expect(r.missing).toContain('p7::u99')
  })

  it('没有 sourceUnitIds 的 special 包 → 回退全量依赖（老包兼容）', async () => {
    fake.put(pkg({ packageId: 'p1', units: [unit('p1::u1', []), unit('p1::u2', [])] }))
    const special = pkg({ packageId: 'special-old', type: 'special', deps: ['p1'] })

    const r = await resolvePackageUnits(special)
    expect(r.units.map((u) => u.unit.id)).toEqual(['p1::u1', 'p1::u2'])
  })
})

describe('边界', () => {
  it('既无自有单元也无依赖 → 空结果、isAggregate=false', async () => {
    const r = await resolvePackageUnits(pkg({ packageId: 'empty' }))
    expect(r.units).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.isAggregate).toBe(false)
  })

  it('单元缺 id（脏数据）→ 跳过，不制造 undefined 键', async () => {
    const dirty = pkg({ packageId: 'd', units: [{ title: 'no-id', topics: [] }] })
    const r = await resolvePackageUnits(dirty)
    expect(r.units).toEqual([])
  })

  it('依赖包自身 units 为空 → 不抛错', async () => {
    fake.put({ packageId: 'p1', manifest: { title: 'p1' }, knowledgePoints: [], exercises: [] })
    const r = await resolvePackageUnits(pkg({ packageId: 't', type: 'term', deps: ['p1'] }))
    expect(r.units).toEqual([])
    expect(r.missing).toEqual([])
  })
})
