// 查看某个 Release 的资产清单（排查上传问题用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const TOKEN = fs
  .readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8')
  .trim()
  .match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1]

const id = process.argv[2] ?? 'latest'
const url =
  id === 'latest'
    ? `https://api.github.com/repos/${REPO}/releases/latest`
    : `https://api.github.com/repos/${REPO}/releases/${id}`

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fls' },
})
const j = await res.json()
console.log(`tag=${j.tag_name} name=${j.name} draft=${j.draft}`)
for (const a of j.assets ?? []) console.log(`  - ${a.name}  ${a.state}  ${(a.size / 1024).toFixed(0)}KB`)
