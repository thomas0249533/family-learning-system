/**
 * content/mirrors.ts —— 题库分发的镜像链与完整性工具
 *
 * 为什么不自己发明一份镜像清单：App 自动更新（checkUpdate.ts /
 * downloadSources.ts）在 V2.12.4 已把"国内可达的源"踩过一遍 —— jsDelivr
 * cdn 被墙、ghproxy 可用。题库分发必须与它同源同仓，否则"App 更新通、
 * 题库更新不通"这种一半一半的状态最难受。
 *
 * 镜像顺序（同 downloadSources 的实测结论）：
 *   ① raw.githubusercontent.com 直链 —— 主源；
 *   ② ghproxy.net / ghproxy.com —— GitHub 镜像代理，raw 被墙时的通路。
 * jsDelivr 不放进来：cdn.jsdelivr.net 国内被墙（V2.12.4 实翻过车），
 * gcore 节点时好时坏，作为题库这种"更新一次拉多个文件"的场景不够稳。
 *
 * sha256 用 WebCrypto：WebView 与 Node 18+ 都有 `crypto.subtle`，
 * 单测跑 node 环境不需要 polyfill。
 */

import { UPDATE_REPO } from '@core/update/downloadSources'

/** 仓库内分发目录（与 scripts/gen-content-dist.ts 的输出一致，测试会核对） */
export const CONTENT_DIST_DIR = 'content-dist'

export const CATALOG_FILE = 'content-catalog.json'

/**
 * 最小 fetch 接口：文本类请求只用到 ok / status / text()；
 * V3.1.8 起音频/图片资产归档走二进制通道，可选提供 arrayBuffer()。
 * 测试的 mock 不用抬整个 Response —— 不下载资产的用例根本不会调到 arrayBuffer。
 */
export interface FetchLike {
  (url: string): Promise<{
    ok: boolean
    status?: number
    text(): Promise<string>
    arrayBuffer?: () => Promise<ArrayBuffer>
  }>
}

/** 单个分发文件的候选地址（顺序即优先级） */
export function contentMirrorUrls(relPath: string): string[] {
  const raw = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/${CONTENT_DIST_DIR}/${relPath}`
  return [raw, `https://ghproxy.net/${raw}`, `https://ghproxy.com/${raw}`]
}

/**
 * 按镜像顺序拉文本：某个源网络层失败或 HTTP 非 2xx 就换下一个。
 * 全部失败时抛错，错误信息带上每个源的具体原因 —— 排查时
 * "三个源分别挂在哪"比一句"网络错误"值钱得多。
 */
export async function fetchTextWithMirrors(relPath: string, fetcher: FetchLike): Promise<string> {
  const urls = contentMirrorUrls(relPath)
  const errors: string[] = []
  for (const url of urls) {
    try {
      const res = await fetcher(url)
      if (!res.ok) throw new Error(`HTTP ${res.status ?? '?'}`)
      return await res.text()
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`所有镜像均不可达 —— ${errors.join('；')}`)
}

/** SHA-256 十六进制摘要（小写），用于目录与文件内容的一致性核对 */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 文本版：字符串先编码成字节再过摘要（与 sha256HexBytes 同一条实现） */
export async function sha256Hex(text: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(text))
}

/**
 * V3.1.8 · 按镜像顺序拉二进制（音频/图片资产归档）。
 * 与 fetchTextWithMirrors 同源同序：某个源网络层失败或 HTTP 非 2xx 就换下一个，
 * 全部失败抛错并带上每个源的具体原因。
 */
export async function fetchArrayBufferWithMirrors(
  relPath: string,
  fetcher: FetchLike,
): Promise<Uint8Array> {
  const urls = contentMirrorUrls(relPath)
  const errors: string[] = []
  for (const url of urls) {
    try {
      const res = await fetcher(url)
      if (!res.ok) throw new Error(`HTTP ${res.status ?? '?'}`)
      if (!res.arrayBuffer) throw new Error('fetcher 未提供 arrayBuffer 能力')
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`所有镜像均不可达 —— ${errors.join('；')}`)
}
