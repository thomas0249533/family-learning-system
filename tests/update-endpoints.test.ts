/**
 * 更新链路地址 · 静态回归（V2.12.2）
 *
 * ## 为什么这种「配置字符串」也值得一套测试
 * V2.12.1 发出去之后，家庭端点「检查更新」，得到的是「已是最新版本（v2.12.0）」——
 * 而远端明明已经是 2.12.1。原因全在**地址**上，代码逻辑一行没错：
 *
 *   · `raw.githubusercontent.com` 在国内常被拦；
 *   · `cdn.jsdelivr.net/gh/<repo>@main` 对分支内容有 **12 小时缓存**，
 *     发版后 12 小时内读到的还是上一版清单 → 判定「已最新」；
 *   · 更糟的是 `latest.json` 里的安装包 url 也指向 jsDelivr 的 `@main`：
 *     发版后那个新路径在缓存刷新前是 **404**，就算清单读对了也下载不动。
 *
 * 这类错误不会让任何单测变红，也不会让人在 review 时停一下——它只在
 * 「发版 30 分钟后家里点一下」这个场景里暴露。所以把地址钉在这里：
 * 主源必须是 Release 资产（`releases/latest/download/`，动态重定向、无长缓存），
 * 安装包必须是 jsDelivr 的 **tag 固定路径**（`@v<ver>/`，URL 从未被缓存、内容不变），
 * jsDelivr 只能排在清单源的后面兜底。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8')

describe('更新链路 · 地址选择', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
  const endpoints: string[] = conf.plugins.updater.endpoints

  it('updater 主源是 Release 资产（动态重定向、没有 12 小时缓存）', () => {
    expect(endpoints[0]).toContain('/releases/latest/download/latest.json')
    expect(endpoints[0].startsWith('https://github.com/')).toBe(true)
  })

  it('jsDelivr 不允许排在 Release 直链前面（它会给旧清单）', () => {
    const jsdelivr = endpoints.findIndex((u) => u.includes('cdn.jsdelivr.net'))
    const release = endpoints.findIndex((u) => u.includes('/releases/latest/download/'))
    expect(release).toBeGreaterThanOrEqual(0)
    if (jsdelivr >= 0) expect(jsdelivr).toBeGreaterThan(release)
  })

  it('至少保留两个兜底源（Release 也可能被整体拦掉）', () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(3)
    for (const u of endpoints) expect(u.startsWith('https://')).toBe(true)
  })

  it('安装包 url 用 jsDelivr 的 tag 固定路径，不许出现 @main', () => {
    const gen = read('scripts/gen-latest.mjs')
    expect(gen).toContain('@v${VER}/updates/${VER}/${BIN}')
    // @main 的 12 小时缓存正是 V2.12.1「清单读到旧版 / 下载 404」的根因
    expect(gen).not.toMatch(/url:\s*`[^`]*@main[^`]*updates/)
  })

  it('发布脚本会把 version.json 一起上传（前端降级路径的主源要用它）', () => {
    const pub = read('scripts/publish-release.mjs')
    expect(pub).toContain("['version.json', 'version.json']")
  })

  it('前端检查更新的主源同样是 Release 资产', () => {
    const src = read('src/core/update/checkUpdate.ts')
    expect(src).toContain('/releases/latest/download/version.json')
    // 主源常量必须仍是候选列表的第一项（有单测固定这个不变量）
    expect(src).toMatch(/UPDATE_CHECK_CANDIDATES[\s\S]*?\[\s*\n?\s*UPDATE_CHECK_URL/)
  })
})

/**
 * 下载兜底 · V2.12.3
 *
 * 清单里每个平台**只能写一个安装包 URL**（Tauri 的格式限制，没有多源容错），
 * 所以「清单读得通、安装包下不动」是个真实存在的死角：用户只会看到一句
 * 「更新失败：timeout」，而安装包其实早就挂在 Release 资产上了。
 * 这组测试锁两件事：兜底地址必须指回同一个仓库的同一份文件；失败时必须真的给出来。
 */
describe('下载兜底 · 失败时能自己下', () => {
  it('由版本号推导出两个可达地址，且文件名与 tauri.conf 的产物一致', async () => {
    const { manualDownloadUrls, UPDATE_REPO, setupAssetName } = await import('@core/update/downloadSources')
    const list = manualDownloadUrls('2.12.3')

    expect(list).toHaveLength(2)
    expect(setupAssetName('2.12.3')).toBe('FamilyLearningSystem_2.12.3_x64-setup.exe')

    // ① GitHub Release 资产直链：能读到清单就说明这个 host 通，同一个 host 上安装包也通
    expect(list[0].url).toBe(
      `https://github.com/${UPDATE_REPO}/releases/latest/download/FamilyLearningSystem_2.12.3_x64-setup.exe`
    )
    // ② jsDelivr tag 固定路径：大陆可达性更好，且 tag 路径不会被 CDN 缓存
    expect(list[1].url).toBe(
      `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@v2.12.3/updates/2.12.3/FamilyLearningSystem_2.12.3_x64-setup.exe`
    )
    // @main 的分支缓存会让新版本的路径 404，这是 V2.12.1 的老坑
    for (const s of list) expect(s.url).not.toContain('@main')
    expect(manualDownloadUrls('v2.12.3')[0].url).toBe(list[0].url) // 容忍 v 前缀
    expect(manualDownloadUrls('')).toEqual([])
  })

  it('兜底地址、清单候选源、安装包生成脚本必须同仓（否则指向不存在的资产）', () => {
    const gen = read('scripts/gen-latest.mjs')
    const chk = read('src/core/update/checkUpdate.ts')
    const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
    const repoInGen = gen.match(/REPO\s*=\s*['"]([^'"]+)['"]/)
    expect(repoInGen, 'gen-latest.mjs 里找不到 REPO 常量').toBeTruthy()
    const repo = repoInGen![1]
    expect(chk).toContain(`github.com/${repo}/`)
    for (const u of conf.plugins.updater.endpoints as string[]) {
      if (u.includes('github.com')) expect(u).toContain(repo)
      if (u.includes('jsdelivr')) expect(u).toContain(repo)
    }
    const dl = read('src/core/update/downloadSources.ts')
    expect(dl).toContain(repo)
  })

  it('下载抛错时，error 态必须带上 manualDownloads（不只是一句失败文案）', async () => {
    vi.resetModules()
    const checkMock = vi.fn()
    vi.doMock('@tauri-apps/plugin-updater', () => ({ check: checkMock }))
    vi.doMock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
    checkMock.mockResolvedValue({
      version: '2.12.3',
      body: 'notes',
      downloadAndInstall: async () => {
        throw new Error('timeout')
      },
    })

    const { runAutoUpdate } = await import('@core/update/autoUpdater')
    const states: any[] = []
    await runAutoUpdate('2.12.2', (s) => states.push(s))

    const err = states.find((s) => s.phase === 'error')
    expect(err, '没有进入 error 态').toBeTruthy()
    expect(err.manualDownloads).toHaveLength(2)
    expect(err.manualDownloads[0].url).toContain('/releases/latest/download/')
    expect(err.manualDownloads[0].url).toContain('2.12.3')
    vi.doUnmock('@tauri-apps/plugin-updater')
    vi.doUnmock('@tauri-apps/plugin-process')
  })

  beforeEach(() => vi.resetModules())
})
