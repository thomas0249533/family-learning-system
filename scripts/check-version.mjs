// 版本号一致性门禁
//
// 背景：V2.11.0 只升了 package.json 与 version.json，漏了 tauri.conf.json 与 Cargo.toml，
// 结果打出的安装包版本号仍是旧的、更新器读到的自身版本不变 → 「检查更新」永远判定已是最新，
// 自动更新整条链路静默失效，而且构建过程不报任何错。这类错误靠人肉 review 拦不住，
// 只能机器把关：发布前跑一遍，六处必须是同一个字符串。

import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')

const found = []

// 1) package.json / tauri.conf.json / version.json
for (const [file, key] of [
  ['package.json', 'version'],
  ['src-tauri/tauri.conf.json', 'version'],
  ['version.json', 'version'],
]) {
  try {
    found.push([file, JSON.parse(read(file))[key]])
  } catch (e) {
    found.push([file, `<解析失败：${e.message}>`])
  }
}

// 2) Cargo.toml —— 首个顶层 version
{
  const m = /^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))
  found.push(['src-tauri/Cargo.toml', m ? m[1] : '<未找到 version>'])
}

// 3) Cargo.lock —— 只认 name = "app" 后面那一行（依赖也有 version，不能泛匹配）
{
  const m = /^name\s*=\s*"app"\s*\nversion\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.lock'))
  found.push(['src-tauri/Cargo.lock (app)', m ? m[1] : '<未找到 app 包>'])
}

// 4) package-lock.json —— 顶部两处
{
  const lines = read('package-lock.json').split('\n')
  const pick = (re) => {
    for (const line of lines) {
      const m = re.exec(line)
      if (m) return m[1]
    }
    return '<未找到>'
  }
  found.push(['package-lock.json 顶层', pick(/^ {2}"version":\s*"([^"]+)"/)])
  found.push(['package-lock.json packages[""]', pick(/^ {6}"version":\s*"([^"]+)"/)])
}

const versions = [...new Set(found.map(([, v]) => v))]
const ok = versions.length === 1 && !versions[0].startsWith('<')

if (ok) {
  console.log(`✅ 版本号一致：${versions[0]}（${found.length} 处）`)
  process.exit(0)
}

console.error('❌ 版本号不一致 —— 发版会打出旧版本安装包，自动更新将静默失效：')
for (const [file, v] of found) console.error(`   ${v === versions[0] ? ' ' : '✗'} ${file}: ${v}`)
console.error('\n目标版本（取多数）：' + (versions[0] ?? '?'))
process.exit(1)
