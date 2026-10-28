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
 * 安装包必须是 `releases/download/v<ver>/` 直链，jsDelivr 只能排在后面兜底。
 */
import { describe, it, expect } from 'vitest'
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

  it('安装包 url 用 Release 资产直链，不带 @main、不走 jsDelivr', () => {
    const gen = read('scripts/gen-latest.mjs')
    expect(gen).toContain("releases/download/v${VER}/${BIN}")
    // 生成器里不许再把安装包指向 jsDelivr（那是 V2.12.1 下载 404 的根因）
    expect(gen).not.toMatch(/url:\s*`https:\/\/cdn\.jsdelivr\.net[^`]*updates/)
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
