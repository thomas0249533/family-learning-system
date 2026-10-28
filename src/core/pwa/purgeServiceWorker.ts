/**
 * purgeServiceWorker.ts —— 桌面端（Tauri）摘除 Service Worker。
 * ---------------------------------------------------------------------
 * ## 为什么桌面端反而要清掉 SW
 * 这个 App 同时是 PWA。SW 会在 `http://tauri.localhost`（Tauri v2 在 Windows 的
 * 页面 origin，属于合法 http origin）上注册成功，而 `vite.config.ts` 里
 * `navigateFallback: 'index.html'` 让 SW 连页面导航一起接管。于是换掉 exe 之后，
 * WebView2 仍然从 Cache Storage 里取旧的 index.html 与旧 chunk：
 *
 *   · 版本徽标、界面、组件实现全部停在升级前那一版；
 *   · 题型白名单也是旧的（V2.12.0 的 essay 会被旧白名单判 E006）；
 *   · 全程不报错，看起来就像"新 exe 没生效"。
 *
 * 资源本来就内嵌在 exe 里，SW 在桌面端只有害无益。
 *
 * ## 两道防线
 * 1. Rust 侧 `purge_stale_sw_cache`（src-tauri/src/lib.rs）：WebView2 初始化之前
 *    按版本号删掉 `EBWebView/Default/{Service Worker,CacheStorage}`。**对已经"中毒"
 *    的机器只有这条路径有效**——SW 一旦接管，跑在画面上的就是旧 JS，这里的代码
 *    根本没机会执行。
 * 2. 本文件的 `purgeDesktopServiceWorker`：前端侧的兜底，万一目录删失败或哪天
 *    WebView 换了 profile 位置，还能把注册摘掉；同时保证桌面端此后不再注册。
 *
 * 零依赖（不 import vue），便于在 node 环境下直接跑单测。
 */

/** sessionStorage 标记：同一次运行只因清 SW 而刷新一次，避免反复 reload */
export const PURGED_FLAG = 'fls:sw-purged'

/**
 * 摘掉所有 SW 注册并清空 Cache Storage。
 *
 * @param nav 默认取全局 navigator；单测可注入假实现
 * @param cacheStorage 默认取全局 caches；单测可注入假实现
 * @returns 摘掉的 SW 注册数（0 表示本来就干净）
 */
export async function purgeDesktopServiceWorker(
  nav: Pick<Navigator, 'serviceWorker'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches
): Promise<number> {
  let purged = 0

  try {
    const regs = (await nav?.serviceWorker?.getRegistrations()) ?? []
    if (regs.length > 0) {
      await Promise.all(regs.map((r) => r.unregister()))
      purged = regs.length
    }
  } catch {
    // 清理失败不是致命错误：启动流程不该被它拦住
  }

  try {
    const keys = (await cacheStorage?.keys()) ?? []
    await Promise.all(keys.map((k) => cacheStorage!.delete(k)))
  } catch {
    // 同上
  }

  return purged
}
