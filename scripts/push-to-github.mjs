// 用 GitHub REST API 推送当前 HEAD（绕开 git 协议被代理拦截）
// 思路：本地无远端 base 对象，故不依赖 git diff，改为对比远端 tree 与本地 ls-tree 的 blob SHA。
// 用法: node scripts/push-to-github.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const BRANCH = 'main'
const API = 'https://api.github.com'

const TOKEN = (() => {
  const raw = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8').trim()
  const m = raw.match(/https:\/\/[^:]+:([^@]+)@github\.com/)
  if (!m) throw new Error('未找到 GitHub 凭证')
  return m[1]
})()

async function gh(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fls-push',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024, ...opts })

// 1. 远端 main 与 tree
const ref = await gh('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)
const baseSha = ref.object.sha
const baseCommit = await gh('GET', `/repos/${REPO}/git/commits/${baseSha}`)
const baseTreeSha = baseCommit.tree.sha
const headSha = git(['rev-parse', 'HEAD']).toString().trim()
console.log(`远端 main = ${baseSha.slice(0, 8)}   本地 HEAD = ${headSha.slice(0, 8)}`)

const remoteTree = await gh('GET', `/repos/${REPO}/git/trees/${baseTreeSha}?recursive=1`)
if (remoteTree.truncated) console.warn('⚠️ 远端 tree 结果被截断，可能有遗漏')
const remote = new Map()
for (const e of remoteTree.tree) if (e.type === 'blob') remote.set(e.path, e.sha)
console.log(`远端 blob: ${remote.size}`)

// 2. 本地 HEAD 全量（-z：NUL 分隔且不转义中文路径）
const localOut = git(['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', headSha]).toString()
const local = new Map()
for (const rec of localOut.split('\0')) {
  if (!rec) continue
  const tab = rec.indexOf('\t')
  if (tab < 0) continue
  const meta = rec.slice(0, tab).split(/\s+/)
  const p = rec.slice(tab + 1)
  if (meta[1] === 'blob') local.set(p, { mode: meta[0], sha: meta[2] })
}
console.log(`本地 blob: ${local.size}`)

// 3. 差异
const entries = []
let nAdd = 0, nMod = 0, nDel = 0
for (const [p, info] of local) {
  const r = remote.get(p)
  if (r === info.sha) continue
  if (!r) nAdd++
  else nMod++
  const buf = git(['show', `${headSha}:${p}`], { encoding: 'buffer' })
  process.stdout.write(`  ${r ? 'M' : 'A'} ${p} (${(buf.length / 1024).toFixed(0)}KB)...`)
  const blob = await gh('POST', `/repos/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  })
  entries.push({ path: p, mode: info.mode, type: 'blob', sha: blob.sha })
  console.log(' ok')
}
for (const p of remote.keys()) {
  if (!local.has(p)) {
    entries.push({ path: p, mode: '100644', type: 'blob', sha: null })
    nDel++
    console.log(`  D ${p}`)
  }
}

if (entries.length === 0) {
  console.log('内容一致，无需推送')
  process.exit(0)
}
console.log(`\n差异: +${nAdd} ~${nMod} -${nDel}（共 ${entries.length}）`)

// 4. tree -> commit -> ref
const tree = await gh('POST', `/repos/${REPO}/git/trees`, { base_tree: baseTreeSha, tree: entries })
const message = git(['log', '-1', '--pretty=%B']).toString().trim()
const commit = await gh('POST', `/repos/${REPO}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [baseSha],
})
await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false })
console.log(`\n✅ 推送完成: ${commit.sha}`)
console.log(`   https://github.com/${REPO}/commit/${commit.sha}`)
