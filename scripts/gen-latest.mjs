// 生成 latest.json + 归档安装包到 updates/<ver>/
//
// 之前这一步用的是一次性脚本，发完就丢了，下次发版只能照抄上一次的产物手改。
// 这里固化下来：签名从 .sig 原样读，pub_date 用当前时间，URL 由版本号推出。
//
// 用法：node scripts/gen-latest.mjs

import fs from 'node:fs'
import path from 'node:path'

const REPO = 'thomas0249533/family-learning-system'
const ver = JSON.parse(fs.readFileSync('version.json', 'utf8'))
const VER = ver.version

const BIN = `FamilyLearningSystem_${VER}_x64-setup.exe`
const NSIS_DIR = 'src-tauri/target/release/bundle/nsis'
const SRC_BIN = path.join(NSIS_DIR, BIN)
const SRC_SIG = `${SRC_BIN}.sig`

for (const f of [SRC_BIN, SRC_SIG]) {
  if (!fs.existsSync(f)) {
    console.error(`❌ 缺少构建产物：${f}\n   先跑 npm run tauri:build（或 npx tauri build），并确认版本号已是 ${VER}`)
    process.exit(1)
  }
}

// 1. 归档到 updates/<ver>/（随仓库走，作为 jsdelivr / 仓库内校验的备份位置）
const outDir = path.join('updates', VER)
fs.mkdirSync(outDir, { recursive: true })
fs.copyFileSync(SRC_BIN, path.join(outDir, BIN))
fs.copyFileSync(SRC_SIG, path.join(outDir, `${BIN}.sig`))

// 2. latest.json
//
// ★ 安装包地址用 **GitHub Releases 直链**（`releases/download/v<版本>/<文件>`）。
//
// 为什么不是 jsDelivr（v2.12.2–v2.12.4 一直用的 `cdn.jsdelivr.net/gh/...@v<版本>`）：
//   2026-10-29 家庭端实测 —— `cdn.jsdelivr.net` 在国内被墙，自动更新报
//   「error sending request」/「403 Forbidden」，怎么都下不下来。而**同一台机器**
//   能正常拉到 `releases/latest/download/latest.json`（更新清单），说明
//   `github.com` 这个 host 对他们网络是通的。安装包与清单同属 GitHub Releases，
//   换个同 host 的直链即可绕开被墙的 jsDelivr，无需重编客户端。
//
//   （jsDelivr 仍作为「手动下载」兜底的备选项保留在 downloadSources.ts，且改用
//   `@main` 路径——因为归档提交在打 tag 之后，`@v<版本>` 的 tag 树里并没有安装包，
//   按 tag 取必定 404；`@main` 树里安装包已提交，能取到。）
const signature = fs.readFileSync(SRC_SIG, 'utf8').trim()
const latest = {
  version: VER,
  notes: ver.notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/v${VER}/${BIN}`,
    },
  },
}
fs.writeFileSync('latest.json', JSON.stringify(latest, null, 2) + '\n')

// 3. 自证：签名里签的文件名与版本必须和本次一致，否则更新器会去下一个 404 的地址
const decoded = Buffer.from(signature, 'base64').toString('utf8')
const mFile = /file:(\S+)/.exec(decoded)
const mVer = /version:(\S+)/.exec(decoded)
if (!mFile || mFile[1] !== BIN) {
  console.error(`❌ 签名内文件名不符：${mFile?.[1] ?? '<未找到>'} ≠ ${BIN}`)
  process.exit(1)
}
if (!mVer || mVer[1] !== VER) {
  console.error(`❌ 签名内版本不符：${mVer?.[1] ?? '<未找到>'} ≠ ${VER}`)
  process.exit(1)
}

const mb = (fs.statSync(SRC_BIN).size / 1048576).toFixed(2)
console.log(`✅ latest.json -> ${VER}`)
console.log(`   安装包 ${BIN} (${mb}MB) 已归档到 updates/${VER}/`)
console.log(`   签名自证通过：${mFile[1]} / v${mVer[1]}`)
console.log(`   URL ${latest.platforms['windows-x86_64'].url}`)
