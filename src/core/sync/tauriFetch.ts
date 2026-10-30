/**
 * 桌面端的 WebDAV 传输实现（P3 · 打通云端同步）。
 *
 * 浏览器版继续用原生 `fetch`（能否成功取决于网盘是否给网页放行 CORS）；
 * 桌面端把请求交给 Rust 侧的 `webdav_fetch` command，由 reqwest 直接发出，
 * 不受 WebView2 的同源策略约束。
 *
 * ## 为什么超时单独传
 *
 * 前端那套 `AbortController` 只对原生 `fetch` 生效 —— 它管不到跨进程的
 * `invoke`。所以超时必须在 Rust 侧由 reqwest 自己掐，`timeoutMs` 因此
 * 作为参数单独传下去，而不是指望 `init.signal`。
 *
 * ## 为什么动态 import
 *
 * `@tauri-apps/api` 只在桌面端有意义。动态 import 让网页版构建不必为它
 * 付首屏体积，也不会在非 Tauri 环境触碰 `window.__TAURI_INTERNALS__`。
 */

import type { FetchInitLike, FetchLike, FetchResponseLike } from './webdavClient'

interface WebdavFetchPayload {
  status: number
  statusText: string
  body: string
  url: string
}

/**
 * Rust 侧失败时抛的是**字符串**（`Result<_, String>`），不是 Error。
 * 原样往上扔的话，上层只能看到一句 `Failed to fetch` 式的泛化文案，
 * 而真正的原因（超时 / 域名解析失败 / 证书过期）就在这里 —— 挂到消息上带出去。
 */
function toTransportError(err: unknown): Error & { webdavMessage: string } {
  const raw =
    typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '未知错误')
  const wrapped = new Error(raw) as Error & { webdavMessage: string }
  wrapped.name = 'TauriTransportError'
  wrapped.webdavMessage = raw
  return wrapped
}

/** 把 Rust 返回的扁平结果包装成 `FetchResponseLike` */
function toResponse(p: WebdavFetchPayload): FetchResponseLike {
  const body = typeof p.body === 'string' ? p.body : ''
  return {
    ok: p.status >= 200 && p.status < 300,
    status: p.status,
    statusText: p.statusText ?? '',
    // 请求是真的发出去了并拿到了字节，不是跨域下的 opaque 响应
    type: 'basic',
    text: () => Promise.resolve(body),
    json: () => {
      try {
        return Promise.resolve(JSON.parse(body))
      } catch (e) {
        return Promise.reject(e)
      }
    },
  }
}

/**
 * 走 Rust 的 fetch 替身。
 *
 * @param timeoutMs 由 reqwest 侧执行的超时；0 或不传表示不设上限
 */
export const tauriFetch = async (
  input: string,
  init?: FetchInitLike,
  timeoutMs?: number,
): Promise<FetchResponseLike> => {
  const { invoke } = await import('@tauri-apps/api/core')
  let payload: WebdavFetchPayload
  try {
    payload = await invoke<WebdavFetchPayload>('webdav_fetch', {
      url: input,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ?? null,
      timeoutMs: timeoutMs && timeoutMs > 0 ? timeoutMs : null,
    })
  } catch (err) {
    throw toTransportError(err)
  }
  return toResponse(payload)
}

/** 统一成 `FetchLike`（丢掉超时参数），给需要它的调用方直接注入用 */
export function createTauriFetch(timeoutMs?: number): FetchLike {
  return (input, init) => tauriFetch(input, init, timeoutMs)
}
