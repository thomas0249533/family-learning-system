/**
 * downloadSources.ts —— V2.12.3 · 更新失败时的「手动下载」兜底地址。
 * =====================================================================
 * 背景：Tauri 的 `latest.json` 里，每个平台**只能给一个安装包 URL**，没有多源容错
 * （清单可以写四个源，安装包不行）。所以一旦那个 host 被墙 / 超时，用户只会看到
 * 「更新失败：timeout」这样一句话，没有任何可点的地方 —— 而安装包其实早就挂在
 * Release 资产上了。
 *
 * 这里做的事只有一件：由版本号推导出**同一份安装包**的两个可达地址，供 UI 在
 * 下载失败时渲染成两条链接，用户点一下就能自己下。
 *
 * 为什么是这两个：
 *   ① GitHub Release 资产直链（`releases/latest/download/<文件>`）——
 *      与 `checkUpdate.ts` 的主源同源同理：动态重定向到最新 Release，没有 CDN 长缓存。
 *      能读到清单，就说明这个 host 通，那么同一个 host 上的安装包也通。
 *   ② jsDelivr tag 固定路径（`@v<版本>/updates/<版本>/<文件>`）——
 *      大陆可达性通常更好；用 tag 而不是 `@main`，因为 URL 从未被 CDN 缓存过、
 *      内容永不变（`@main` 有 12 小时分支缓存，V2.12.1 就是栽在这上面）。
 *
 * 注意：这两个地址**只用于手动兜底**，不参与自动更新流程 —— 自动更新走
 * `tauri-plugin-updater` 读清单，那里的 URL 由 `scripts/gen-latest.mjs` 生成。
 * 两边必须指向同一个文件，故 `tests/update-endpoints.test.ts` 会核对二者一致。
 */

/** 发布仓库（owner/repo）。`checkUpdate.ts` 的候选源必须与之同仓，测试会核对 */
export const UPDATE_REPO = 'thomas0249533/family-learning-system'

/** 安装包文件名模板（与 `src-tauri/tauri.conf.json` 的 productName 派生规则一致） */
export function setupAssetName(version: string): string {
  return `FamilyLearningSystem_${version}_x64-setup.exe`
}

export interface DownloadSource {
  label: string
  url: string
}

/**
 * 由版本号推导「手动下载」候选地址，顺序即推荐顺序。
 *
 * 2026-10-29 实测：`cdn.jsdelivr.net` 在国内被墙，自动更新拉不动。所以手动兜底
 * 也换成国内可达的源，给「自动更新失败」的用户一条能点就下的路：
 *   ① GitHub Releases 直链（与清单同源，host 已验证可达）；
 *   ② ghproxy.net / ghproxy.com —— GitHub 镜像代理，绕开 objects.githubusercontent.com，
 *      在 raw.githubusercontent / cdn.jsdelivr 被墙的网络下通常仍能下；
 *   ③ jsDelivr 备用节点（cdn 被墙时，gcore 有时仍通），用 `@main` 路径
 *      （归档提交在打 tag 之后，`@v<版本>` 的 tag 树里没有安装包，按 tag 取必 404）。
 *
 * @param version 目标版本号（如 `2.12.4`）；不接受 `v` 前缀，由内部统一加。
 */
export function manualDownloadUrls(version: string): DownloadSource[] {
  const ver = String(version ?? '').trim().replace(/^v/i, '')
  if (!ver) return []
  const bin = setupAssetName(ver)
  const ghRelease = `https://github.com/${UPDATE_REPO}/releases/download/v${ver}/${bin}`
  return [
    { label: 'GitHub', url: ghRelease },
    { label: 'ghproxy.net', url: `https://ghproxy.net/${ghRelease}` },
    { label: 'ghproxy.com', url: `https://ghproxy.com/${ghRelease}` },
    {
      label: 'jsDelivr(gcore)',
      url: `https://gcore.jsdelivr.net/gh/${UPDATE_REPO}@main/updates/${ver}/${bin}`,
    },
    {
      label: 'jsDelivr',
      url: `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@main/updates/${ver}/${bin}`,
    },
  ]
}
