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

// tag 要指向远端 main 上的真实提交。push-to-github 是走 tree API 重建提交，
// 远端 SHA 与本地 HEAD 并不相同 —— 用本地 HEAD 打 tag 会得到一个不挂在 main 上的孤立 tag。
const head = await gh('GET', `/repos/${REPO}/git/ref/heads/main`)
  .then((r) => r.object.sha)
  .catch(() => execFileSync('git', ['rev-parse', 'HEAD']).toString().trim())
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

// 便携版命名 app<日期><字母>.exe（沿用历次发布习惯）。资产按 Release 隔离，
// 跨版本同名不会冲突；这里仍取空位字母，是为了同一天在同一 Release 重跑时不会互相覆盖。
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

/**
 * 查某资产在远端的状态。上传 20MB 时 GitHub 偶发 504 —— 那是**响应**超时，
 * 数据往往已经落库。若直接当失败重跑，会重复上传或误报；必须先回查。
 */
async function remoteAsset(name) {
  const cur = await gh('GET', `/repos/${REPO}/releases/${rel.id}`)
  return (cur.assets || []).find((a) => a.name === name) ?? null
}

for (const [file, name] of assets) {
  const buf = fs.readFileSync(file)
  const already = await remoteAsset(name)
  if (already && already.size === buf.length) {
    console.log(`  跳过（已存在且大小一致）${name}`)
    continue
  }
  // 大小不一致说明上次传了一半或传了旧包，先删掉再传，避免留下坏资产
  if (already) {
    await gh('DELETE', `/repos/${REPO}/releases/assets/${already.id}`)
    console.log(`  删除不完整资产 ${name}（远端 ${already.size} ≠ 本地 ${buf.length}）`)
  }

  let ok = false
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const up = await gh(
        'POST',
        `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
        buf,
        true,
      )
      console.log(`  ✅ ${name} (${(buf.length / 1048576).toFixed(2)}MB) -> ${up.state}`)
      ok = true
    } catch (e) {
      // 失败后不立刻重试：先看是不是「其实已经传上去了」
      const now = await remoteAsset(name)
      if (now && now.size === buf.length) {
        console.log(`  ✅ ${name} 已上传（首次报错：${String(e.message).slice(0, 40)}…，回查确认完整）`)
        ok = true
        break
      }
      if (attempt === 3) throw e
      console.log(`  ↻ ${name} 第 ${attempt} 次失败，2s 后重试`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!ok) throw new Error(`资产上传失败：${name}`)
}

const final = await gh('GET', `/repos/${REPO}/releases/${rel.id}`)
console.log(`\n📦 Release: ${final.html_url}`)
console.log(`   资产 ${final.assets.length} 个:`)
for (const a of final.assets) console.log(`   - ${a.name} (${(a.size / 1024).toFixed(0)}KB)`)

// 收尾自证：四个资产必须在、且大小与本地一致。少一个就是发版失败，不能靠人眼看日志。
const expected = assets.map(([file, name]) => [name, fs.statSync(file).size])
const bad = expected.filter(([name, size]) => final.assets.find((a) => a.name === name)?.size !== size)
if (bad.length) {
  console.error('\n❌ 资产校验失败：')
  for (const [name, size] of bad) console.error(`   ${name} 期望 ${size}B，远端不符或缺失`)
  process.exit(1)
}
console.log('\n✅ 资产校验通过（4 个，大小与本地一致）')
