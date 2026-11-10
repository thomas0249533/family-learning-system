/**
 * 题库在线更新（V3.1）单测
 *
 * 两条最重要的契约在这里钉死：
 *   1. **更新不洗进度** —— 更新只是 db.packages.put 覆盖，progress / mistakes
 *      一行都不能少。这是内容更新的生死线（家长最怕"更新了题全重做"），
 *      靠注释约束没用，必须用回归测试钉死。
 *   2. **脏数据拒收** —— sha256 不符 / 包校验不过 / packageId 张冠李戴，
 *      任何一种都必须"拒写入"，宁可更新失败也不要半套新题库。
 *
 * fetch 全程注入 mock（不碰真网络）；db 用 fakeDexie（node 环境，无 jsdom）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

import { createFakeDexie } from './helpers/fakeDexie'

// 动态 import：vi.mock 的工厂在模块加载时才执行，静态 import 会被提升到
// `fake` 初始化之前（既有 backup 系测试同款写法）。
const { compareVersions, normalizeVersion } = await import('@core/content/version')
const { contentMirrorUrls, sha256Hex, CATALOG_FILE, CONTENT_DIST_DIR } = await import(
  '@core/content/mirrors'
)
const {
  parseCatalog,
  checkForUpdates,
  applyUpdate,
  applyAllUpdates,
  installNewPackages,
} = await import('@core/content/contentUpdater')
type UpdatablePackage = import('@core/content/contentUpdater').UpdatablePackage
type CatalogPackage = import('@core/content/contentUpdater').CatalogPackage

const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')

/** 造一个能过 normalizePackage 的最小合法包（带顶层 packageId，与 App 存储记录一致） */
function makePackage(version: string): any {
  return {
    packageId: 'pkg-a',
    manifest: {
      packageId: 'pkg-a',
      title: '测试包',
      subject: 'math',
      grade: 4,
      term: 'up',
      version,
    },
    knowledgePoints: [{ id: 'kp-1', name: '知识点一', prerequisites: [] }],
    exercises: [
      {
        id: 'ex-1',
        type: 'single',
        question: '1+1=（　　）',
        options: ['A. 2', 'B. 3', 'C. 4', 'D. 5'],
        answer: 'A',
        explanation: '1+1=2，选A。',
        knowledgePointIds: ['kp-1'],
      },
    ],
  }
}

/** 可更新项（本地 1.0.0 → 远端 1.1.0） */
async function makeUpdatable(): Promise<UpdatablePackage> {
  const text = JSON.stringify(makePackage('1.1.0'))
  return {
    packageId: 'pkg-a',
    title: '测试包',
    localVersion: '1.0.0',
    remoteVersion: '1.1.0',
    sha256: await sha256Hex(text),
  }
}

/** 按子串路由的 mock fetcher：命中给文本，未命中抛错（模拟 404） */
function fetcherOf(routes: Record<string, string>) {
  return async (url: string) => {
    for (const [needle, text] of Object.entries(routes)) {
      if (url.includes(needle)) return { ok: true, status: 200, text: async () => text }
    }
    return { ok: false, status: 404, text: async () => 'not found' }
  }
}

/** 所有源都断的 fetcher（模拟被墙环境） */
const deadFetcher = async () => {
  throw new Error('network unreachable')
}

/** 断言"更新失败"并收窄联合类型 —— expect() 不参与 TS 收窄，必须显式 guard */
function expectFail(res: Awaited<ReturnType<typeof applyUpdate>>): { ok: false; reason: string } {
  expect(res.ok).toBe(false)
  if (res.ok) throw new Error('预期更新失败，实际成功了')
  return res
}

async function seedLocal(): Promise<void> {
  await fake.packages.put(makePackage('1.0.0'))
  // 进度种子：更新后必须原样健在（契约 1）
  await fake.progress.bulkPut([
    {
      profileId: 'default',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: 'learning',
      correctCount: 3,
      wrongCount: 1,
      updatedAt: Date.now(),
    },
  ])
}

beforeEach(async () => {
  createPinia() && setActivePinia(createPinia())
  fake.__reset()
  invalidateOwnerIndex()
  await seedLocal()
  await initProfile()
  __resetProfileForTest()
})

describe('compareVersions / normalizeVersion（纯函数）', () => {
  it('数字段逐段比较', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0) // 不是字符串比较
  })

  it('v 前缀与段数不齐', () => {
    expect(compareVersions('v1.1', '1.1.0')).toBe(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })

  it('脏输入按 0.0.0 处理（宁可提示可更新，不静默判最新）', () => {
    expect(normalizeVersion(undefined)).toBe('0.0.0')
    expect(normalizeVersion('')).toBe('0.0.0')
    expect(normalizeVersion('abc')).toBe('0.0.0')
    expect(compareVersions('1.0.0', 'abc')).toBeGreaterThan(0)
  })
})

describe('parseCatalog（目录形状校验，脏目录拒收）', () => {
  it('合法目录解析出包列表', () => {
    const text = JSON.stringify({
      updatedAt: '2026-11-02',
      packages: [{ packageId: 'p1', version: '1.0.0', title: '包一', sha256: 'a'.repeat(64) }],
    })
    const catalog = parseCatalog(text)
    expect(catalog.packages).toHaveLength(1)
    expect(catalog.packages[0].packageId).toBe('p1')
  })

  it('非法 JSON / 缺 packages / 重复 packageId / sha256 不合法，全部抛错', () => {
    expect(() => parseCatalog('not json')).toThrow()
    expect(() => parseCatalog('{"updatedAt":"x"}')).toThrow()
    expect(() =>
      parseCatalog(
        JSON.stringify({
          packages: [
            { packageId: 'p1', version: '1.0.0', sha256: 'a'.repeat(64) },
            { packageId: 'p1', version: '1.0.1', sha256: 'a'.repeat(64) },
          ],
        }),
      ),
    ).toThrow(/重复/)
    expect(() =>
      parseCatalog(JSON.stringify({ packages: [{ packageId: 'p1', version: '1.0.0', sha256: 'zz' }] })),
    ).toThrow(/sha256/)
  })
})

describe('checkForUpdates（版本比对）', () => {
  it('镜像地址与 downloadSources 同仓同源', () => {
    const urls = contentMirrorUrls('content-catalog.json')
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain('raw.githubusercontent.com')
    expect(urls[0]).toContain(`${CONTENT_DIST_DIR}/content-catalog.json`)
    expect(urls[1]).toContain('ghproxy.net/')
    expect(urls[2]).toContain('ghproxy.com/')
    expect(CATALOG_FILE).toBe('content-catalog.json')
  })

  it('远端版本更高 → 进可更新列表；未安装的包进 installable（V3.1.6）', async () => {
    const catalog = JSON.stringify({
      updatedAt: '2026-11-02',
      packages: [
        { packageId: 'pkg-a', version: '1.1.0', title: '测试包', sha256: 'a'.repeat(64) },
        { packageId: 'pkg-not-installed', version: '9.9.9', title: '没装的包', sha256: 'b'.repeat(64) },
      ],
    })
    const res = await checkForUpdates(fetcherOf({ [CATALOG_FILE]: catalog }))
    expect(res.ok).toBe(true)
    expect(res.total).toBe(2)
    expect(res.updatable.map((u) => u.packageId)).toEqual(['pkg-a'])
    expect(res.updatable[0].remoteVersion).toBe('1.1.0')
    expect(res.installable.map((p) => p.packageId)).toEqual(['pkg-not-installed'])
    expect(res.installable[0].title).toBe('没装的包')
    // 契约：检查只报告，绝不偷偷写入新包
    expect(await fake.packages.get('pkg-not-installed')).toBeUndefined()
  })

  it('网络全断 → installable 为空数组（不抛异常、不给脏数据）', async () => {
    const res = await checkForUpdates(deadFetcher)
    expect(res.installable).toEqual([])
  })

  it('版本相同 → 已是最新', async () => {
    const catalog = JSON.stringify({
      updatedAt: '2026-11-02',
      packages: [{ packageId: 'pkg-a', version: '1.0.0', title: '测试包', sha256: 'a'.repeat(64) }],
    })
    const res = await checkForUpdates(fetcherOf({ [CATALOG_FILE]: catalog }))
    expect(res.ok).toBe(true)
    expect(res.updatable).toHaveLength(0)
  })

  it('网络全断 → ok:false + 可读错误，不抛异常', async () => {
    const res = await checkForUpdates(deadFetcher)
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(res.updatable).toHaveLength(0)
  })
})

describe('applyUpdate（下载 → 校验 → 覆盖写入）', () => {
  it('正常更新：包写入新版本，进度原样健在（契约 1：更新不洗进度）', async () => {
    const item = await makeUpdatable()
    const text = JSON.stringify(makePackage('1.1.0'))
    const res = await applyUpdate(item, fetcherOf({ 'pkg-a.json': text }))

    expect(res.ok).toBe(true)
    const row = await fake.db.packages.get('pkg-a')
    expect(row?.manifest.version).toBe('1.1.0')
    // 进度一行不少
    const progress = await fake.db.progress.toArray()
    expect(progress).toHaveLength(1)
    expect(progress[0].correctCount).toBe(3)
  })

  it('sha256 不符 → 拒写入，旧包不受影响', async () => {
    const item = { ...(await makeUpdatable()), sha256: 'c'.repeat(64) }
    const text = JSON.stringify(makePackage('1.1.0'))
    const res = expectFail(await applyUpdate(item, fetcherOf({ 'pkg-a.json': text })))

    expect(res.reason).toContain('sha256')
    const row = await fake.db.packages.get('pkg-a')
    expect(row?.manifest.version).toBe('1.0.0') // 还是旧版
  })

  it('下载内容校验不过 → 拒写入', async () => {
    const item = await makeUpdatable()
    const bad = makePackage('1.1.0')
    // 重复知识点 id → normalize 报 E004，必须拒写入
    bad.knowledgePoints = [
      { id: 'kp-1', name: '知识点一', prerequisites: [] },
      { id: 'kp-1', name: '重复的', prerequisites: [] },
    ]
    const text = JSON.stringify(bad)
    const item2 = { ...item, sha256: await sha256Hex(text) }
    const res = expectFail(await applyUpdate(item2, fetcherOf({ 'pkg-a.json': text })))

    expect(res.reason).toContain('校验')
  })

  it('包身份不符（下载到别的包）→ 拒写入', async () => {
    const item = await makeUpdatable()
    const other = makePackage('1.1.0')
    other.manifest.packageId = 'pkg-b'
    const text = JSON.stringify(other)
    const res = expectFail(
      await applyUpdate({ ...item, sha256: await sha256Hex(text) }, fetcherOf({ 'pkg-a.json': text })),
    )

    expect(res.reason).toContain('身份不符')
  })

  it('下载失败（全镜像不通）→ ok:false 带原因', async () => {
    const item = await makeUpdatable()
    const res = expectFail(await applyUpdate(item, deadFetcher))
    expect(res.reason).toContain('下载失败')
  })
})

describe('applyUpdate 跨包知识点引用（E009 回归）', () => {
  /** 一个只声明知识点的「单元包」，模拟已安装的 unit-math-4-up-rjb-pX */
  function makeUnitPackage(packageId: string, kpId: string): any {
    return {
      packageId,
      manifest: { packageId, title: '单元包', subject: 'math', grade: 4, term: 'up', version: '1.0.0' },
      knowledgePoints: [{ id: kpId, name: '单元知识点', prerequisites: [] }],
      exercises: [],
    }
  }

  /** 一个自身不声明知识点、只跨包引用 unit 包 KP 的 special/sprint 包 */
  function makeCrossRefPackage(kpId: string, version: string): any {
    return {
      packageId: 'pkg-cross',
      manifest: { packageId: 'pkg-cross', title: '跨包引用包', subject: 'math', grade: 4, term: 'up', version },
      knowledgePoints: [],
      // normalizePackage 只遍历 units[].topics[].exercises（与真实包结构一致）
      units: [
        {
          id: 'u1',
          name: '单元',
          topics: [
            {
              id: 't1',
              name: '话题',
              exercises: [
                {
                  id: 'ex-1',
                  type: 'single',
                  question: '题目（跨包引用）',
                  options: ['A. 2', 'B. 3'],
                  answer: 'A',
                  explanation: 'x',
                  knowledgePointIds: [kpId],
                },
              ],
            },
          ],
        },
      ],
    }
  }

  const CROSS_KP = 'unit-math-4-up-rjb-p1::kp-num-001'

  it('已安装 unit 包时：合法跨包引用应校验通过并写入', async () => {
    // 模拟家庭端已安装该 unit 包（其 KP 已在本地库）
    await fake.db.packages.put(makeUnitPackage('unit-math-4-up-rjb-p1', CROSS_KP))

    const text = JSON.stringify(makeCrossRefPackage(CROSS_KP, '1.1.0'))
    const item: UpdatablePackage = {
      packageId: 'pkg-cross',
      title: '跨包引用包',
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      sha256: await sha256Hex(text),
    }
    const res = await applyUpdate(item, fetcherOf({ 'pkg-cross.json': text }))

    expect(res.ok).toBe(true)
    const row = await fake.db.packages.get('pkg-cross')
    expect(row?.manifest.version).toBe('1.1.0')
  })

  it('未安装 unit 包时：跨包引用仍应被 E009 拒绝（不是放宽校验）', async () => {
    // beforeEach 只装了 pkg-a（kp-1），不含 CROSS_KP → 跨包引用无法解析
    const text = JSON.stringify(makeCrossRefPackage(CROSS_KP, '1.1.0'))
    const item: UpdatablePackage = {
      packageId: 'pkg-cross',
      title: '跨包引用包',
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      sha256: await sha256Hex(text),
    }
    const res = expectFail(await applyUpdate(item, fetcherOf({ 'pkg-cross.json': text })))

    expect(res.reason).toContain('E009')
  })
})

describe('applyAllUpdates（批量串行）', () => {
  it('一个成一个败：updated / failed 各归各位', async () => {
    const itemA = await makeUpdatable()
    const textA = JSON.stringify(makePackage('1.1.0'))
    const itemB: UpdatablePackage = { ...itemA, packageId: 'pkg-b' }
    const out = await applyAllUpdates([itemA, itemB], fetcherOf({ 'pkg-a.json': textA }))

    expect(out.updated).toEqual(['pkg-a'])
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].packageId).toBe('pkg-b')
  })
})

// ==================== V3.1.6 · 发现并安装新包 ====================
/** 造一个 packageId 可指定的最小合法包；kpIds 用于构造跨包引用 */
function makeNamedPackage(packageId: string, kpIds: string[], version = '1.0.0'): any {
  const base = makePackage(version)
  return {
    ...base,
    packageId,
    manifest: { ...base.manifest, packageId, title: `${packageId} 标题` },
    knowledgePoints: [{ id: `${packageId}::kp-own`, name: '自有知识点', prerequisites: [] }],
    exercises: [{
      id: `${packageId}::ex-1`,
      type: 'single',
      question: '1+1=（　　）',
      options: ['A. 2', 'B. 3', 'C. 4', 'D. 5'],
      answer: 'A',
      explanation: '1+1=2。',
      knowledgePointIds: kpIds,
    }],
  }
}

async function catalogItem(packageId: string): Promise<{ item: CatalogPackage; text: string }> {
  const text = JSON.stringify(makeNamedPackage(packageId, [`${packageId}::kp-own`]))
  return {
    item: {
      packageId,
      version: '1.0.0',
      title: `${packageId} 标题`,
      sha256: await sha256Hex(text),
    },
    text,
  }
}

describe('installNewPackages（家长勾选后才安装）', () => {
  it('未勾选时不调用安装 → 一个包都不会写入（契约：不替家长做决定）', async () => {
    const a = await catalogItem('pkg-new-a')
    const res = await checkForUpdates(fetcherOf({
      [CATALOG_FILE]: JSON.stringify({ updatedAt: '2026-11-10', packages: [a.item] }),
    }))
    expect(res.installable.map((p) => p.packageId)).toEqual(['pkg-new-a'])
    expect(await fake.packages.get('pkg-new-a')).toBeUndefined()
  })

  it('勾选后安装成功：包入库、进度原样健在（不洗进度）', async () => {
    const a = await catalogItem('pkg-new-a')
    const out = await installNewPackages([a.item], fetcherOf({ 'pkg-new-a.json': a.text }))
    expect(out.updated).toEqual(['pkg-new-a'])
    expect(out.failed).toHaveLength(0)
    const row: any = await fake.packages.get('pkg-new-a')
    expect(row?.manifest.version).toBe('1.0.0')
    // beforeEach 播种的进度必须原样健在
    expect((await fake.progress.toArray()).some((p: any) => p.packageId === 'pkg-a')).toBe(true)
  })

  it('sha256 不符 → 拒写，且不影响同批其它包', async () => {
    const a = await catalogItem('pkg-new-a')
    const b = await catalogItem('pkg-new-b')
    const bad: CatalogPackage = { ...a.item, sha256: 'f'.repeat(64) }
    const out = await installNewPackages(
      [bad, b.item],
      fetcherOf({ 'pkg-new-a.json': a.text, 'pkg-new-b.json': b.text }),
    )
    expect(out.updated).toEqual(['pkg-new-b'])
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].packageId).toBe('pkg-new-a')
    expect(out.failed[0].reason).toContain('sha256')
    expect(await fake.packages.get('pkg-new-a')).toBeUndefined()
  })

  it('同批新包之间的跨包知识点引用不被 E009 误杀', async () => {
    // pkg-new-a 的题目引用 pkg-new-b 的知识点；两者都还没安装
    const textA = JSON.stringify(makeNamedPackage('pkg-new-a', ['pkg-new-b::kp-own']))
    const textB = JSON.stringify(makeNamedPackage('pkg-new-b', ['pkg-new-b::kp-own']))
    const items: CatalogPackage[] = [
      { packageId: 'pkg-new-a', version: '1.0.0', title: 'A', sha256: await sha256Hex(textA) },
      { packageId: 'pkg-new-b', version: '1.0.0', title: 'B', sha256: await sha256Hex(textB) },
    ]
    const out = await installNewPackages(items, fetcherOf({
      'pkg-new-a.json': textA,
      'pkg-new-b.json': textB,
    }))
    expect(out.failed).toEqual([])
    expect(out.updated).toEqual(['pkg-new-a', 'pkg-new-b'])
  })

  it('下载失败（镜像全断）→ 只记 failed，不抛异常', async () => {
    const a = await catalogItem('pkg-new-a')
    const out = await installNewPackages([a.item], deadFetcher)
    expect(out.updated).toEqual([])
    expect(out.failed[0].reason).toContain('下载失败')
  })
})
