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

// 1. 归档到 updates/<ver>/（随仓库走，jsdelivr 直接从仓库取）
const outDir = path.join('updates', VER)
fs.mkdirSync(outDir, { recursive: true })
fs.copyFileSync(SRC_BIN, path.join(outDir, BIN))
fs.copyFileSync(SRC_SIG, path.join(outDir, `${BIN}.sig`))

// 2. latest.json
const signature = fs.readFileSync(SRC_SIG, 'utf8').trim()
const latest = {
  version: VER,
  notes: ver.notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://cdn.jsdelivr.net/gh/${REPO}@main/updates/${VER}/${BIN}`,
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
