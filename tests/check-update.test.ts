import { describe, it, expect } from 'vitest'
import { checkUpdate, UPDATE_CHECK_URL, UPDATE_CHECK_CANDIDATES } from '@core/update/checkUpdate'

// ============================================================================
// V2.3 轨道 D（方案 D-1）· 纯前端「检查更新」守卫测试
// ----------------------------------------------------------------------------
// 核心不变量：checkUpdate **绝不抛异常**，任何网络 / 跨域 / HTTP / 解析失败都
// 必须转成类型化结果，否则 WebView 里会白屏。故每个失败分支都要能拿到结果对象。
// ============================================================================

/** 造一个「成功返回指定 JSON body」的假 fetch */
function jsonFetch(body: unknown, init: { status?: number; statusText?: string } = {}): typeof fetch {
  return (async () => ({
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  })) as unknown as typeof fetch
}

/** 造一个「抛出指定错误」的假 fetch（模拟断网 / 跨域） */
function throwFetch(message: string): typeof fetch {
  return (async () => {
    throw new TypeError(message)
  }) as unknown as typeof fetch
}

describe('checkUpdate · 版本比较语义', () => {
  it('远端更高 → hasUpdate=true，带 remoteVersion 与 downloadUrl', async () => {
    const result = await checkUpdate(
      '1.0.0',
      jsonFetch({ version: '2.0.0', downloadUrl: 'https://example.com/dl' })
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hasUpdate).toBe(true)
      expect(result.currentVersion).toBe('1.0.0')
      expect(result.remoteVersion).toBe('2.0.0')
      expect(result.downloadUrl).toBe('https://example.com/dl')
    }
  })

  it('1.10.0 > 1.9.0（真·semver 数值比较，不是字典序）', async () => {
    // ⚠️ 反向验证：若实现退化为字符串比较，'1.10.0' > '1.9.0' 会算错 → 此断言变红
    const result = await checkUpdate('1.9.0', jsonFetch({ version: '1.10.0' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.hasUpdate).toBe(true)
  })

  it('版本相同 → hasUpdate=false', async () => {
    const result = await checkUpdate('1.2.3', jsonFetch({ version: '1.2.3' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.hasUpdate).toBe(false)
  })

  it('远端更低 → hasUpdate=false', async () => {
    const result = await checkUpdate('2.0.0', jsonFetch({ version: '1.0.0' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.hasUpdate).toBe(false)
  })

  it('downloadUrl 缺失时返回 null（不崩）', async () => {
    const result = await checkUpdate('1.0.0', jsonFetch({ version: '1.1.0' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.downloadUrl).toBeNull()
  })
})

describe('checkUpdate · 类型化错误（绝不抛异常）', () => {
  it('HTTP 非 2xx → kind=http，携带状态码信息', async () => {
    const result = await checkUpdate(
      '1.0.0',
      jsonFetch({}, { status: 404, statusText: 'Not Found' })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('http')
      expect(result.message).toContain('404')
    }
  })

  it('JSON 解析失败 → kind=parse', async () => {
    const badJson = (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })) as unknown as typeof fetch
    const result = await checkUpdate('1.0.0', badJson)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('parse')
  })

  it('缺少 version 字段 → kind=parse', async () => {
    const result = await checkUpdate('1.0.0', jsonFetch({ downloadUrl: 'x' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('parse')
  })

  it('网络失败（Failed to fetch）→ kind=network', async () => {
    const result = await checkUpdate('1.0.0', throwFetch('Failed to fetch'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
      expect(typeof result.message).toBe('string')
    }
  })

  it('跨域被拦截（CORS 文案）→ kind=cors', async () => {
    const result = await checkUpdate(
      '1.0.0',
      throwFetch('Request blocked by CORS policy: No Access-Control-Allow-Origin')
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('cors')
  })

  it('任何失败都返回结果对象，绝不让异常冒泡', async () => {
    // 综合守卫：多种异常输入下调用都必须正常 resolve
    const errors = [
      throwFetch('Failed to fetch'),
      throwFetch('CORS blocked'),
      jsonFetch({}, { status: 500 }),
      jsonFetch(null),
    ]
    for (const impl of errors) {
      const result = await checkUpdate('1.0.0', impl)
      expect(result).toBeTruthy()
      expect(typeof result.ok).toBe('boolean')
    }
  })
})

describe('checkUpdate · 部署常量', () => {
  it('UPDATE_CHECK_URL 是 https 且以 version.json 结尾', () => {
    expect(UPDATE_CHECK_URL.startsWith('https://')).toBe(true)
    expect(UPDATE_CHECK_URL.endsWith('version.json')).toBe(true)
  })

  it('UPDATE_CHECK_CANDIDATES 至少含主源与两个镜像，且都是 https', () => {
    expect(UPDATE_CHECK_CANDIDATES.length).toBeGreaterThanOrEqual(2)
    expect(UPDATE_CHECK_CANDIDATES[0]).toBe(UPDATE_CHECK_URL)
    for (const url of UPDATE_CHECK_CANDIDATES) {
      expect(url.startsWith('https://')).toBe(true)
      expect(url.endsWith('version.json')).toBe(true)
    }
  })
})

describe('checkUpdate · 多镜像容错（中国大陆访问 raw.githubusercontent 被墙场景）', () => {
  it('主源失败会回退到下一个镜像并成功', async () => {
    const seen: string[] = []
    const fetchImpl = ((url: string) => {
      seen.push(url)
      if (url === UPDATE_CHECK_CANDIDATES[0]) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ version: '9.9.9', downloadUrl: 'https://example.com/x' }),
      })
    }) as unknown as typeof fetch

    const result = await checkUpdate('1.0.0', fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.remoteVersion).toBe('9.9.9')
      expect(result.hasUpdate).toBe(true)
    }
    // 至少尝试了两个源（主源失败 → 回退镜像）
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[0]).toBe(UPDATE_CHECK_CANDIDATES[0])
  })

  it('主源非 2xx 也尝试下一个镜像', async () => {
    const seen: string[] = []
    const fetchImpl = ((url: string) => {
      seen.push(url)
      if (url === UPDATE_CHECK_CANDIDATES[0]) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({}),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ version: '2.0.0' }),
      })
    }) as unknown as typeof fetch

    const result = await checkUpdate('1.0.0', fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.remoteVersion).toBe('2.0.0')
  })

  it('所有镜像都失败 → 返回 network 错误（绝不抛异常），并提示已尝试多源', async () => {
    const fetchImpl = ((_url: string) =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    const result = await checkUpdate('1.0.0', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
      expect(result.message).toContain('更新源')
    }
  })
})
