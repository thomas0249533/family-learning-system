// 删除 Release 上的某个资产（清理重复/坏包用）
// 用法: node scripts/delete-release-asset.mjs <releaseId> <assetName>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const TOKEN = fs
  .readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8')
  .trim()
  .match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1]

const [releaseId, assetName] = process.argv.slice(2)
if (!releaseId || !assetName) {
  console.error('用法: node scripts/delete-release-asset.mjs <releaseId> <assetName>')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'fls',
}

const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/${releaseId}`, { headers })).json()
const hit = (rel.assets ?? []).find((a) => a.name === assetName)
if (!hit) {
  console.log(`没有名为 ${assetName} 的资产`)
  process.exit(0)
}

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${hit.id}`, {
  method: 'DELETE',
  headers,
})
console.log(res.status === 204 ? `✅ 已删除 ${assetName}` : `❌ 删除失败 ${res.status}`)
