/**
 * 桌面端 Service Worker 缓存清理（V2.12.1）· 单测
 * =====================================================================
 * 这一版修的是一个**只有真机才暴露**的坑：App 同时是 PWA，SW 在
 * `http://tauri.localhost` 上注册成功并接管页面导航（`navigateFallback`），
 * 于是换掉 exe 之后 WebView2 仍从 Cache Storage 取旧 index.html 与旧 chunk，
 * 新版本装着、跑的却是旧逻辑，且不报错。
 *
 * 这里锁三件事：
 *   1. 清理函数本身的行为（摘注册、清 cache、异常不得外抛）；
 *   2. Rust 侧那条**对已中毒机器唯一有效**的路径仍然存在，且只删 SW 相关两处；
 *   3. 前端在 Tauri 下先判环境再注册——顺序错了就等于没修。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { purgeDesktopServiceWorker } from '@core/pwa/purgeServiceWorker'

const root = path.resolve(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

function fakeNav(count: number, unregisterImpl?: () => Promise<boolean>) {
  const calls: string[] = []
  const regs = Array.from({ length: count }, (_, i) => ({
    scope: `http://tauri.localhost/scope-${i}`,
    unregister: async () => {
      calls.push(`reg-${i}`)
      return unregisterImpl ? unregisterImpl() : true
    },
  }))
  return {
    nav: { serviceWorker: { getRegistrations: async () => regs } } as unknown as Pick<
      Navigator,
      'serviceWorker'
    >,
    calls,
  }
}

describe('purgeDesktopServiceWorker', () => {
  it('有注册时全部摘掉，并清空所有 cache，返回注册数', async () => {
    const { nav, calls } = fakeNav(2)
    const deleted: string[] = []
    const cacheStorage = {
      keys: async () => ['workbox-precache-v2', 'images'],
      delete: async (k: string) => {
        deleted.push(k)
        return true
      },
    } as unknown as CacheStorage

    const purged = await purgeDesktopServiceWorker(nav, cacheStorage)

    expect(purged).toBe(2)
    expect(calls).toHaveLength(2)
    expect(deleted).toEqual(['workbox-precache-v2', 'images'])
  })

  it('本来就干净时返回 0，且不抛', async () => {
    const { nav } = fakeNav(0)
    const cacheStorage = {
      keys: async () => [],
      delete: async () => true,
    } as unknown as CacheStorage

    await expect(purgeDesktopServiceWorker(nav, cacheStorage)).resolves.toBe(0)
  })

  it('navigator / caches 都不存在（node 环境）时不抛，返回 0', async () => {
    await expect(purgeDesktopServiceWorker(undefined, undefined)).resolves.toBe(0)
  })

  it('unregister 抛错被吞掉，不能让启动流程挂掉', async () => {
    const { nav } = fakeNav(1, async () => {
      throw new Error('SecurityError')
    })
    const cacheStorage = {
      keys: async () => [],
      delete: async () => true,
    } as unknown as CacheStorage

    await expect(purgeDesktopServiceWorker(nav, cacheStorage)).resolves.toBe(0)
  })

  it('caches.keys 抛错时仍然完成 SW 摘除', async () => {
    const { nav } = fakeNav(1)
    const cacheStorage = {
      keys: async () => {
        throw new Error('boom')
      },
      delete: async () => true,
    } as unknown as CacheStorage

    await expect(purgeDesktopServiceWorker(nav, cacheStorage)).resolves.toBe(1)
  })
})

describe('Rust 侧：WebView2 启动前清理（对已中毒机器唯一有效路径）', () => {
  const src = read('src-tauri/src/lib.rs')

  it('仍然删除 Service Worker 与 CacheStorage 两处', () => {
    expect(src).toContain('"Service Worker"')
    expect(src).toContain('"CacheStorage"')
  })

  it('清理发生在 setup 里、窗口创建之前', () => {
    expect(src).toContain('purge_stale_sw_cache(app.handle())')
    const setupAt = src.indexOf('.setup(')
    const callAt = src.indexOf('purge_stale_sw_cache(app.handle())')
    expect(setupAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(setupAt)
  })

  it('只删 SW 子目录，绝不删整个数据目录（IndexedDB 在做题记录里）', () => {
    expect(src).not.toContain('remove_dir_all(&local_dir)')
    expect(src).not.toContain('remove_dir_all(local_dir)')
  })

  it('按版本号只清一次，靠版本戳文件', () => {
    expect(src).toContain('.sw-cache-version')
  })
})

describe('前端侧：桌面端不注册 SW', () => {
  const src = read('src/core/pwa/usePWAUpdate.ts')

  it('先判 isTauri 再决定注册', () => {
    const guardAt = src.indexOf('isTauri()')
    const registerAt = src.indexOf("await import('virtual:pwa-register/vue')")
    expect(guardAt).toBeGreaterThan(-1)
    expect(registerAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(registerAt)
  })

  it('桌面端分支里做了清理并 return，走不到注册', () => {
    const guardBlock = src.slice(src.indexOf('isTauri()'), src.indexOf("await import('virtual:pwa-register/vue')"))
    expect(guardBlock).toContain('purgeDesktopServiceWorker()')
    expect(guardBlock).toContain('return')
  })
})
