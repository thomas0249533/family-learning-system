import { describe, it, expect } from 'vitest'
import {
  fetchCatalog,
  compareVersions,
  compareWithLocal,
  type Catalog,
  type CatalogTransport,
} from '@core/importer/catalogService'

// ============================================================================
// semver 比较
// ============================================================================

describe('catalog · compareVersions（真·semver）', () => {
  it('1.10.0 > 1.9.0（数值比较，而非字典序）', () => {
    // ⚠️ 反向验证：若实现退化为字符串比较，'1.10.0' > '1.9.0' 会算错
    //    （字典序下 '1.1' < '1.9'，得到负值），此断言会变红。
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('1.2.3 < 1.2.4', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
  })

  it('相等为 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('预发布号：1.0.0 > 1.0.0-alpha', () => {
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0)
  })

  it('预发布号之间按标识符比较', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
  })
})

// ============================================================================
// 本地比对
// ============================================================================

function makeCatalog(): Catalog {
  return {
    ok: true,
    source: 'http://example.com/catalog.json',
    fetchedAt: 0,
    packages: [
      { packageId: 'a', version: '2.0.0', checksum: 'ccc', url: 'http://x/a.lpkgset' },
      { packageId: 'b', version: '1.0.0', checksum: 'ccc', url: 'http://x/b.lpkgset' },
      { packageId: 'c', version: '1.0.0', checksum: 'ccc', url: 'http://x/c.lpkgset' },
    ],
  }
}

describe('catalog · compareWithLocal', () => {
  it('版本更高 → hasUpdate', () => {
    const checks = compareWithLocal(makeCatalog(), [{ packageId: 'a', version: '1.0.0' }])
    const a = checks.find((c) => c.packageId === 'a')!
    expect(a.hasUpdate).toBe(true)
    expect(a.currentVersion).toBe('1.0.0')
    expect(a.remoteVersion).toBe('2.0.0')
  })

  it('校验和不同（版本相同）→ hasUpdate', () => {
    const checks = compareWithLocal(makeCatalog(), [
      { packageId: 'b', version: '1.0.0', checksum: 'different' },
    ])
    const b = checks.find((c) => c.packageId === 'b')!
    expect(b.hasUpdate).toBe(true)
  })

  it('版本与校验和都相同 → 已是最新', () => {
    const checks = compareWithLocal(makeCatalog(), [
      { packageId: 'c', version: '1.0.0', checksum: 'ccc' },
    ])
    const c = checks.find((x) => x.packageId === 'c')!
    expect(c.hasUpdate).toBe(false)
  })

  it('本地无此包 → hasUpdate=true 且 currentVersion=null', () => {
    const checks = compareWithLocal(makeCatalog(), [])
    const a = checks.find((c) => c.packageId === 'a')!
    expect(a.hasUpdate).toBe(true)
    expect(a.currentVersion).toBeNull()
  })
})

// ============================================================================
// fetchCatalog（mock transport）—— 绝不白屏的守卫测试
// ============================================================================

const okTransport: CatalogTransport = {
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      packages: [{ packageId: 'a', version: '1.0.0', url: 'http://x/a.lpkgset' }],
    }),
  }),
}

const networkFailTransport: CatalogTransport = {
  fetch: async () => {
    throw new Error('Failed to fetch')
  },
}

const badJsonTransport: CatalogTransport = {
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('Unexpected token')
    },
  }),
}

const httpFailTransport: CatalogTransport = {
  fetch: async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({}),
  }),
}

describe('catalog · fetchCatalog（类型化错误，绝不抛异常）', () => {
  it('成功路径：返回解析后的 Catalog', async () => {
    const result = await fetchCatalog('http://x/catalog.json', okTransport)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.packages.length).toBe(1)
      expect(result.packages[0].packageId).toBe('a')
    }
  })

  it('网络失败：返回类型化错误而非抛异常', async () => {
    const result = await fetchCatalog('http://x/catalog.json', networkFailTransport)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(['cors', 'network']).toContain(result.kind)
      expect(typeof result.message).toBe('string')
    }
  })

  it('JSON 解析失败：返回 kind=parse 的类型化错误', async () => {
    const result = await fetchCatalog('http://x/catalog.json', badJsonTransport)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('parse')
  })

  it('HTTP 非 2xx：返回 kind=http 的类型化错误', async () => {
    const result = await fetchCatalog('http://x/catalog.json', httpFailTransport)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('http')
      expect(result.status).toBe(404)
    }
  })
})
