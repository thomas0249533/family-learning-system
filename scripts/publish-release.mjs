// 创建 tag 与 GitHub Release，并上传资产
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const API = 'https://api.github.com'
const VER = JSON.parse(fs.readFileSync('version.json', 'utf8')).version
const TAG = `v${VER}`

const TOKEN = (() => {
  const raw = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8').trim()
  return raw.match(/https:\/\/[^:]+:([^@]+)@github\.com/)[1]
})()

async function gh(method, url, body, raw = false) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fls-release',
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()
const ver = JSON.parse(fs.readFileSync('version.json', 'utf8'))

// 1. tag（已存在则跳过）
try {
  await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/tags/${TAG}`, sha: head })
  console.log(`✅ tag ${TAG} -> ${head.slice(0, 8)}`)
} catch (e) {
  if (String(e.message).includes('422')) console.log(`tag ${TAG} 已存在`)
  else throw e
}

// 2. Release（已存在则复用）
let rel
try {
  rel = await gh('POST', `/repos/${REPO}/releases`, {
    tag_name: TAG,
    name: `家庭学习系统 ${TAG}`,
    body: ver.notes,
    draft: false,
    prerelease: false,
  })
  console.log(`✅ Release 创建: ${rel.html_url}`)
} catch (e) {
  if (String(e.message).includes('422')) {
    rel = await gh('GET', `/repos/${REPO}/releases/tags/${TAG}`)
    console.log(`Release 已存在（id ${rel.id}），复用`)
  } else throw e
}

// 3. 上传资产
// 源文件名里带版本号，硬编码过一次 2.11.0 就会在下次发版时静默传错包 —— 一律由 VER 推出
const NSIS = `src-tauri/target/release/bundle/nsis/FamilyLearningSystem_${VER}_x64-setup.exe`

// 便携版命名 app<日期><字母>.exe。同一天发两版（2.11.0 与 2.12.0 都在 10-28）时，
// 硬写 'a' 会撞上上一版已上传的资产名 —— 而下面的「已存在则跳过」会把新包静默丢掉，
// 日志上还是一行 ✅。所以先看这一版已有哪些同名前缀，取下一个空位。
const today = new Date().toISOString().slice(0, 10)
const taken = (rel.assets || [])
  .map((a) => new RegExp(`^app${today}([a-z])\\.exe$`).exec(a.name))
  .filter(Boolean)
  .map((m) => m[1])
let letter = 'a'
while (taken.includes(letter)) letter = String.fromCharCode(letter.charCodeAt(0) + 1)
const PORTABLE = `app${today}${letter}.exe`

const assets = [
  [NSIS, `FamilyLearningSystem_${VER}_x64-setup.exe`],
  [`${NSIS}.sig`, `FamilyLearningSystem_${VER}_x64-setup.exe.sig`],
  ['latest.json', 'latest.json'],
  ['src-tauri/target/release/app.exe', PORTABLE],
]

const existing = new Set((rel.assets || []).map((a) => a.name))
for (const [file, name] of assets) {
  if (existing.has(name)) {
    console.log(`  跳过（已存在）${name}`)
    continue
  }
  const buf = fs.readFileSync(file)
  const up = await gh('POST',
    `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
    buf, true)
  console.log(`  ✅ ${name} (${(buf.length / 1048576).toFixed(2)}MB) -> ${up.state}`)
}

const final = await gh('GET', `/repos/${REPO}/releases/${rel.id}`)
console.log(`\n📦 Release: ${final.html_url}`)
console.log(`   资产 ${final.assets.length} 个:`)
for (const a of final.assets) console.log(`   - ${a.name} (${(a.size / 1024).toFixed(0)}KB)`)
