import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveLatestVerdict, runAutoUpdate, type AutoUpdateState } from '@core/update/autoUpdater'
import { UPDATE_CHECK_CANDIDATES, type UpdateCheckResult } from '@core/update/checkUpdate'

// ============================================================================
// 更新检查「假最新」回归守卫
// ----------------------------------------------------------------------------
// 背景：tauri-plugin-updater 的 check() 读 latest.json（插件内部带 HTTP 缓存），
// 刚发版几分钟内仍返回 null → 旧代码直接报「已是最新版本」。修复方式是拿
// 无插件缓存的 D-1 路径（version.json）结果做交叉验证。
//
// 决策逻辑抽成纯函数 resolveLatestVerdict 单测；cross-check「只请求主源一个
// candidate」的调用约束用 vi.mock 拦插件 + stub 全局 fetch 做集成断言。
// 测试环境为 node（无 jsdom），故不挂载 Vue 组件。
// ============================================================================

const { checkMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }))

/** 造一个「成功返回指定 JSON body」的假 fetch */
function jsonFetch(body: unknown, urls?: string[]): typeof fetch {
  return ((url: string) => {
    urls?.push(url)
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    })
  }) as unknown as typeof fetch
}

describe('resolveLatestVerdict · latest 交叉验证决策（纯函数）', () => {
  const appVersion = '4.1.0'

  it('fallback.ok && hasUpdate → phase=fallback，原样透传结果（UI 才能显示下载链接）', () => {
    const verdict: UpdateCheckResult = {
      ok: true,
      hasUpdate: true,
      currentVersion: appVersion,
      remoteVersion: '4.1.1',
      downloadUrl: 'https://example.com/v4.1.1.exe',
    }
    const state = resolveLatestVerdict(verdict, appVersion)
    expect(state.phase).toBe('fallback')
    // 引用透传：remoteVersion / downloadUrl 必须完整交给 UI
    expect(state.fallback).toBe(verdict)
  })

  it('fallback.ok && !hasUpdate → phase=latest，回显当前版本（确认真最新）', () => {
    const verdict: UpdateCheckResult = {
      ok: true,
      hasUpdate: false,
      currentVersion: appVersion,
      remoteVersion: appVersion,
      downloadUrl: null,
    }
    expect(resolveLatestVerdict(verdict, appVersion)).toEqual({
      phase: 'latest',
      version: appVersion,
    })
  })

  it('fallback 网络失败 → 仍报 latest，不抛异常（离线可用）', () => {
    const verdict: UpdateCheckResult = { ok: false, kind: 'network', message: 'Failed to fetch' }
    expect(() => resolveLatestVerdict(verdict, appVersion)).not.toThrow()
    expect(resolveLatestVerdict(verdict, appVersion)).toEqual({
      phase: 'latest',
      version: appVersion,
    })
  })

  it('fallback 其它失败类型（cors / http / parse）同样落到 latest', () => {
    for (const kind of ['cors', 'http', 'parse'] as const) {
      const verdict: UpdateCheckResult = { ok: false, kind, message: 'bad' }
      expect(resolveLatestVerdict(verdict, appVersion).phase).toBe('latest')
    }
  })
})

describe('runAutoUpdate · check() 报 null 时走单源交叉验证', () => {
  const appVersion = '4.1.0'

  beforeEach(() => {
    checkMock.mockReset()
    relaunchMock.mockReset()
    // 插件因 latest.json 缓存仍读到旧清单 → 返回 null（"没有更新"）
    checkMock.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cross-check 只请求主源一个 candidate（不走 4 源 × 8s 慢路径）', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', jsonFetch({ version: appVersion }, urls))

    const states: AutoUpdateState[] = []
    await expect(runAutoUpdate(appVersion, (s) => states.push(s))).resolves.toBeUndefined()

    expect(urls).toEqual([UPDATE_CHECK_CANDIDATES[0]])
    expect(states[states.length - 1]).toEqual({ phase: 'latest', version: appVersion })
  })

  it('cross-check 发现新版本 → 透传 fallback（含 remoteVersion / downloadUrl）', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      jsonFetch({ version: '4.1.1', downloadUrl: 'https://example.com/v4.1.1.exe' }, urls)
    )

    const states: AutoUpdateState[] = []
    await expect(runAutoUpdate(appVersion, (s) => states.push(s))).resolves.toBeUndefined()

    expect(urls).toHaveLength(1)
    const final = states[states.length - 1]
    expect(final.phase).toBe('fallback')
    expect(final.fallback?.ok).toBe(true)
    if (final.fallback?.ok) {
      expect(final.fallback.hasUpdate).toBe(true)
      expect(final.fallback.remoteVersion).toBe('4.1.1')
      expect(final.fallback.downloadUrl).toBe('https://example.com/v4.1.1.exe')
    }
    // 只是告知用户手动下载，不触发安装 / 重启
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('cross-check 失败（断网）→ 仍报 latest 且不抛异常，不白屏', async () => {
    vi.stubGlobal(
      'fetch',
      ((_url: string) => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    )

    const states: AutoUpdateState[] = []
    await expect(runAutoUpdate(appVersion, (s) => states.push(s))).resolves.toBeUndefined()

    expect(states[0]).toEqual({ phase: 'checking' })
    expect(states[states.length - 1]).toEqual({ phase: 'latest', version: appVersion })
  })
})
