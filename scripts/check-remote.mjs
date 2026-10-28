// 核对远端 tag / main / Release 资产与更新清单
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const TOKEN = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8')
  .trim().match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1]
const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fls' }
const get = async (u) => (await fetch(`https://api.github.com${u}`, { headers: H })).json()

const tagRef = await get(`/repos/${REPO}/git/ref/tags/v2.11.0`)
const tagSha = tagRef.object?.sha
const tagType = tagRef.object?.type
// annotated tag 需要解引用
let targetSha = tagSha
if (tagType === 'tag') {
  const t = await get(`/repos/${REPO}/git/tags/${tagSha}`)
  targetSha = t.object?.sha
}
const main = await get(`/repos/${REPO}/git/ref/heads/main`)
const rel = await get(`/repos/${REPO}/releases/tags/v2.11.0`)

console.log('tag v2.11.0 ->', targetSha)
console.log('main        ->', main.object.sha)
console.log('一致:', targetSha === main.object.sha)
console.log('Release:', rel.html_url, '| 资产:', rel.assets?.map((a) => a.name).join(', '))

// 更新清单可达性（jsdelivr 有 CDN 延迟，raw 更即时）
for (const url of [
  `https://raw.githubusercontent.com/${REPO}/main/latest.json`,
  `https://cdn.jsdelivr.net/gh/${REPO}@main/latest.json`,
]) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'fls' } })
    const j = r.ok ? await r.json() : null
    console.log(`${r.status} ${j ? 'v' + j.version : ''} ${url.slice(0, 60)}`)
  } catch (e) {
    console.log(`ERR ${url.slice(0, 60)} ${e.message}`)
  }
}
