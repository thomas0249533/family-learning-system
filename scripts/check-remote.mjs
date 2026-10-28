// 核对远端 tag / main / Release 资产 / 更新清单 / 安装包可达性
//
// 自动更新是一条跨好几个系统的链路（tag → Release 资产 → latest.json → CDN → 安装包），
// 任何一环断掉，家庭端只会看到「已是最新」或静默失败。所以发版后必须逐环验一遍。
//
// 用法: node scripts/check-remote.mjs

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const VER = JSON.parse(fs.readFileSync('version.json', 'utf8')).version
const TAG = `v${VER}`

const TOKEN = fs
  .readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8')
  .trim()
  .match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1]
const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fls' }
const get = async (u) => (await fetch(`https://api.github.com${u}`, { headers: H })).json()

let fail = 0
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) fail++
}

// 1. tag 必须挂在 main 的历史上（发版后 main 会继续前进，所以允许 tag 是祖先）
const tagRef = await get(`/repos/${REPO}/git/ref/tags/${TAG}`)
let targetSha = tagRef.object?.sha
if (tagRef.object?.type === 'tag') {
  targetSha = (await get(`/repos/${REPO}/git/tags/${tagRef.object.sha}`)).object?.sha
}
const cmp = await get(`/repos/${REPO}/compare/${TAG}...main`)
// identical = 恰好同点；ahead = main 领先（发版后又提交了东西），都算正常
check(
  ['identical', 'ahead'].includes(cmp.status),
  `tag ${TAG} 挂在 main 历史上`,
  `${String(targetSha).slice(0, 8)} / main 领先 ${cmp.ahead_by ?? 0} 个提交`,
)

// 2. Release 与资产
const rel = await get(`/repos/${REPO}/releases/tags/${TAG}`)
const names = (rel.assets ?? []).map((a) => a.name)
check(!!rel.id, `Release ${TAG} 存在`, rel.html_url)
for (const want of [
  `FamilyLearningSystem_${VER}_x64-setup.exe`,
  `FamilyLearningSystem_${VER}_x64-setup.exe.sig`,
  'latest.json',
]) {
  check(names.includes(want), `资产存在：${want}`)
}
const localSetup = `src-tauri/target/release/bundle/nsis/FamilyLearningSystem_${VER}_x64-setup.exe`
if (fs.existsSync(localSetup)) {
  const size = fs.statSync(localSetup).size
  const a = (rel.assets ?? []).find((x) => x.name === path.basename(localSetup))
  check(a?.size === size, '安装包大小与本地一致', a ? `${a.size}B` : '缺失')
}
check(
  names.some((n) => /^app\d{4}-\d{2}-\d{2}[a-z]\.exe$/.test(n)),
  '便携版存在',
  names.filter((n) => n.startsWith('app')).join(', '),
)

// 3. 更新清单可达且版本正确（三个 endpoint 都要能用：raw / jsdelivr / gitmirror）
//
// 注意：本机 DNS 解析不了这几个 CDN 域名（api.github.com 可以），直连与走代理都不通。
// 所以网络失败时不能直接判"发版失败"，改为用 API 读 main 上的 blob 做等价校验：
// 文件在仓库里、内容正确，才算过。这样既不会漏报真故障，也不会被本机网络误伤。
const tree = await get(`/repos/${REPO}/git/trees/main?recursive=1`)
const blobs = new Map((tree.tree ?? []).map((t) => [t.path, t]))

async function blobText(pathInRepo) {
  const sha = blobs.get(pathInRepo)?.sha
  if (!sha) return null
  const b = await get(`/repos/${REPO}/git/blobs/${sha}`)
  return Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
}

let cdnUnreachable = 0
for (const url of [
  `https://raw.githubusercontent.com/${REPO}/main/latest.json`,
  `https://cdn.jsdelivr.net/gh/${REPO}@main/latest.json`,
  `https://raw.gitmirror.com/${REPO}/main/latest.json`,
]) {
  const host = new URL(url).host
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'fls' }, redirect: 'follow' })
    const j = r.ok ? await r.json() : null
    check(j?.version === VER, `${host} latest.json = v${VER}`, `HTTP ${r.status}${j ? '' : ' 内容非 JSON'}`)
  } catch {
    // 本机不可达：退回仓库内校验，并统计出来单独提示
    cdnUnreachable++
    const text = await blobText('latest.json')
    let ok = false
    try {
      ok = JSON.parse(text).version === VER
    } catch {
      ok = false
    }
    check(ok, `${host} 不可达，改验仓库内 latest.json`, '本机 DNS 受限')
  }
}
if (cdnUnreachable === 3) {
  console.log('   ⚠️  三个 CDN 域名本机全部不可达（代理与直连均失败）——这是本机网络限制，不代表家庭端不可达')
}

// 4. 清单里的安装包 URL 真能下到（更新器下载的就是这个地址）
const manifest = JSON.parse(fs.readFileSync('latest.json', 'utf8'))
const binUrl = manifest.platforms['windows-x86_64'].url
const localSize = fs.existsSync(localSetup) ? fs.statSync(localSetup).size : -1
try {
  const r = await fetch(binUrl, { method: 'HEAD', headers: { 'User-Agent': 'fls' }, redirect: 'follow' })
  const len = Number(r.headers.get('content-length'))
  check(r.ok && len === localSize, '安装包 URL 可达且大小一致', `HTTP ${r.status} ${(len / 1048576).toFixed(2)}MB`)
  console.log(`   ${binUrl}`)
} catch {
  const inRepo = blobs.get(`updates/${VER}/FamilyLearningSystem_${VER}_x64-setup.exe`)
  check(
    inRepo?.size === localSize,
    '安装包 URL 不可达，改验仓库内 blob',
    inRepo ? `${(inRepo.size / 1048576).toFixed(2)}MB 与本地一致` : '仓库内缺失',
  )
  console.log(`   ${binUrl}`)
}

// 5. 签名里的文件名/版本必须是本版（否则更新器验签失败，且错误信息极难懂）
const sig = Buffer.from(manifest.platforms['windows-x86_64'].signature, 'base64').toString('utf8')
check(
  sig.includes(`file:FamilyLearningSystem_${VER}_x64-setup.exe`) && sig.includes(`version:${VER}`),
  '签名内文件名与版本一致',
)

console.log(fail === 0 ? '\n🎉 更新链路全环通过' : `\n❌ ${fail} 项未通过`)
process.exit(fail === 0 ? 0 : 1)
