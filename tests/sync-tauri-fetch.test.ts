/**
 * 桌面端 WebDAV 传输层（P3 · 打通云端同步）
 *
 * ## 这份测试要钉住的三件事
 *  1. **参数契约**：Rust command 的字段名（camelCase）与前端 JS 传参必须逐字对上。
 *     名字写错时 Tauri 只会抛一句参数缺失，不会被类型检查挡下 —— 必须在这里断言。
 *  2. **非 2xx 不是异常**：WebDAV 靠 401/404 做业务判断（判鉴权、探存在），
 *     状态码必须原样交给上层，不能在传输层里当错误吞掉或抛掉。
 *  3. **失败原因不许被吞**：Rust 侧 `Result<_, String>` 抛的是字符串，不是 Error。
 *     若直接往上扔，上层只剩一句泛化的"请求没发出去"，把家长引向错误的排查方向。
 *
 * 全程 `invoke` 都是替身，一个真报文都不发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const { tauriFetch, createTauriFetch } = await import('@core/sync/tauriFetch')

beforeEach(() => {
  invokeMock.mockReset()
})

describe('桌面端传输 · 参数契约', () => {
  it('默认方法 GET，未指定超时传 null（Rust 侧据此不设上限）', async () => {
    invokeMock.mockResolvedValue({ status: 200, statusText: 'OK', body: '', url: 'https://x/y' })
    await tauriFetch('https://dav.example.com/base/')
    expect(invokeMock).toHaveBeenCalledWith('webdav_fetch', {
      url: 'https://dav.example.com/base/',
      method: 'GET',
      headers: {},
      body: null,
      timeoutMs: null,
    })
  })

  it('方法/请求头/正文/超时原样透传', async () => {
    invokeMock.mockResolvedValue({ status: 201, statusText: 'Created', body: '', url: '' })
    await tauriFetch(
      'https://dav.example.com/a.json',
      { method: 'PUT', headers: { Authorization: 'Basic x', 'Content-Type': 'application/json' }, body: '{}' },
      15_000,
    )
    expect(invokeMock).toHaveBeenCalledWith(
      'webdav_fetch',
      expect.objectContaining({
        method: 'PUT',
        body: '{}',
        timeoutMs: 15_000,
        headers: expect.objectContaining({ Authorization: 'Basic x' }),
      }),
    )
  })

  it('timeoutMs 为 0 时按"不设上限"传 null，而不是传 0 让 reqwest 立刻超时', async () => {
    invokeMock.mockResolvedValue({ status: 200, statusText: 'OK', body: '', url: '' })
    await tauriFetch('https://dav.example.com/', undefined, 0)
    expect(invokeMock.mock.calls[0][1].timeoutMs).toBeNull()
  })
})

describe('桌面端传输 · 响应翻译', () => {
  it('2xx → ok=true，正文可从 text()/json() 取回', async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      body: '{"version":2}',
      url: 'https://dav.example.com/a.json',
    })
    const res = await tauriFetch('https://dav.example.com/a.json')
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    // 不是 opaque：请求真的发出去了，这一点决定了上层不走 CORS 那条错误分支
    expect(res.type).toBe('basic')
    expect(await res.text()).toBe('{"version":2}')
    expect(await res.json()).toEqual({ version: 2 })
  })

  it('401 → ok=false 但**不抛**，状态码原样交给业务层判鉴权', async () => {
    invokeMock.mockResolvedValue({ status: 401, statusText: 'Unauthorized', body: '', url: '' })
    const res = await tauriFetch('https://dav.example.com/a.json')
    expect(res.ok).toBe(false)
    expect(res.status).toBe(401)
  })

  it('正文不是 JSON 时 json() 拒绝，而 text() 仍可用', async () => {
    invokeMock.mockResolvedValue({ status: 200, statusText: 'OK', body: '<xml/>', url: '' })
    const res = await tauriFetch('https://dav.example.com/a.json')
    expect(await res.text()).toBe('<xml/>')
    await expect(res.json()).rejects.toBeTruthy()
  })
})

describe('桌面端传输 · 失败原因不许被吞', () => {
  it('Rust 抛字符串时，包成 Error 并把原文挂在 webdavMessage 上', async () => {
    invokeMock.mockRejectedValue('连不上服务器（域名解析/网络/证书问题）：https://dav.example.com/')
    await expect(tauriFetch('https://dav.example.com/')).rejects.toMatchObject({
      name: 'TauriTransportError',
      webdavMessage: '连不上服务器（域名解析/网络/证书问题）：https://dav.example.com/',
    })
  })

  it('Rust 抛 Error 时同样带出 message', async () => {
    invokeMock.mockRejectedValue(new Error('请求超时：https://dav.example.com/'))
    await expect(tauriFetch('https://dav.example.com/')).rejects.toMatchObject({
      webdavMessage: '请求超时：https://dav.example.com/',
    })
  })

  it('createTauriFetch 把超时固化进闭包（fetch 替身签名没有第三参）', async () => {
    invokeMock.mockResolvedValue({ status: 200, statusText: 'OK', body: '', url: '' })
    const fn = createTauriFetch(8_000)
    await fn('https://dav.example.com/', { method: 'PROPFIND' })
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ method: 'PROPFIND', timeoutMs: 8_000 })
  })
})
