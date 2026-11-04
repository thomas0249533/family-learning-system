// 确定性打乱单选题选项顺序（破掉「正确项永远在 A 位」的套路）
//
// 背景：剑桥少儿英语（english-movers-cep）三包与七年级英语 phrases 包的全部单选题
//       正确答案都恰好在 A 位，导致孩子无脑选 A 就能全对、失去练习意义。
//       经逐题核对，答案「内容」本身是正确的，问题在于「位置」——正确项永远排第一。
//
// 本脚本：
//   1. 对每道 single 题，按「题目 id（缺省用 题序）」做确定性哈希种子，Fisher-Yates 打乱选项；
//   2. 正确「内容」保持不变，仅重排顺序并重算 answer 字母；
//   3. 为原先没有 version 的包补齐 manifest.version（首次发版 1.0.1），
//      否则 content-dist 目录里 version 与家庭端本地同为 0.0.0，更新不会被触发；
//   4. 幂等：只依赖题 id 种子，多次运行结果一致；不改动的题（无 id 且题序不变）也稳定。
//
// 安全前提（已校验）：这些包的 explanation 全部用「内容」描述，从不引用 A/B/C 字母，
//       打乱选项位置不会让解析错位。
//
// 用法：node scripts/content/fix-shuffle-single-options.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..') // D:/study
const NEW_VERSION = '1.0.1'

// 仅这些「真身」进入 content-dist；packages/ 冗余副本同步改以保持源一致（不入 dist）。
const TARGETS = [
  'content/english-movers-cep/special-english-movers-unit.json',
  'content/english-movers-cep/special-english-movers-review.json',
  'content/english-movers-cep/special-english-movers-mock.json',
  'content/english-7-up-rjb/special-english-7-up-phrases.json',
  'content/english-7-up-rjb/packages/special-english-7-up-phrases.json',
]

// ---- 确定性 PRNG ----
function hashStr(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffled(arr, seed) {
  const a = arr.slice()
  const rnd = mulberry32(seed)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const OPT_RE = /^([A-Ga-g])[.．]\s*(.*)$/

// 递归找到所有单选题并就地修改
function shuffleAll(node, pkgId, ctx) {
  if (Array.isArray(node)) {
    node.forEach((n) => shuffleAll(n, pkgId, ctx))
    return
  }
  if (node && typeof node === 'object') {
    if (node.type === 'single' && Array.isArray(node.options)) {
      ctx.count++
      processSingle(node, pkgId, ctx.count, ctx)
    }
    for (const k of Object.keys(node)) {
      if (k === 'options' || k === 'answer') continue // 已在 processSingle 处理
      shuffleAll(node[k], pkgId, ctx)
    }
  }
}

function processSingle(q, pkgId, idx, ctx) {
  const opts = q.options.map((s) => {
    const m = OPT_RE.exec(String(s))
    if (!m) return { letter: null, content: String(s), raw: String(s) }
    return { letter: m[1].toUpperCase(), content: m[2], raw: String(s) }
  })
  // 正确内容 = 原 answer 字母对应的选项内容
  const ansLetter = String(q.answer ?? '').trim().toUpperCase().charAt(0)
  const correct = opts.find((o) => o.letter === ansLetter)
  if (!correct) {
    ctx.warnings.push(`[${pkgId}] 题#${idx} answer=${q.answer} 无法匹配选项，跳过`)
    return
  }
  if (opts.some((o) => o.letter === null)) {
    ctx.warnings.push(`[${pkgId}] 题#${idx} 存在无前缀选项，跳过打乱`)
    return
  }

  // 规范化：先按内容排序，使打乱结果只依赖「内容集合 + 题 id 种子」，
  // 与当前选项顺序无关——保证幂等（多次运行结果一致、可复现）。
  const sorted = opts.slice().sort((x, y) =>
    x.content < y.content ? -1 : x.content > y.content ? 1 : 0
  )

  const seed = hashStr(`${pkgId}::${q.id ?? '#' + idx}`)
  const newOpts = shuffled(sorted, seed)
  q.options = newOpts.map((o, k) => `${String.fromCharCode(65 + k)}. ${o.content}`)
  const newIdx = newOpts.findIndex((o) => o.content === correct.content)
  q.answer = String.fromCharCode(65 + newIdx)
  ctx.done++
}

function distribution(qs) {
  const c = {}
  for (const q of qs) {
    const a = String(q.answer ?? '').trim().toUpperCase().charAt(0)
    if (a) c[a] = (c[a] || 0) + 1
  }
  return c
}

function collectSingles(node, acc) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectSingles(n, acc))
    return
  }
  if (node && typeof node === 'object') {
    if (node.type === 'single') acc.push(node)
    for (const k of Object.keys(node)) collectSingles(node[k], acc)
  }
}

// JSON 写回：保留中文（还原 \uXXXX 转义）
function stringifyZh(obj) {
  const json = JSON.stringify(obj, null, 2)
  return json.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  )
}

let totalDone = 0
const allWarnings = []
for (const rel of TARGETS) {
  const file = join(ROOT, rel)
  if (!existsSync(file)) {
    console.log(`[跳过] 文件不存在: ${rel}`)
    continue
  }
  const raw = readFileSync(file, 'utf8')
  const data = JSON.parse(raw)
  const beforeQs = []
  collectSingles(data, beforeQs)
  const before = distribution(beforeQs)

  const ctx = { count: 0, done: 0, warnings: [] }
  shuffleAll(data, data.manifest?.packageId || rel, ctx)

  // 补齐 version
  if (!data.manifest) data.manifest = {}
  if (!data.manifest.version) {
    data.manifest.version = NEW_VERSION
    ctx.versionSet = NEW_VERSION
  }

  writeFileSync(file, stringifyZh(data) + '\n', 'utf8')

  const afterQs = []
  collectSingles(data, afterQs)
  const after = distribution(afterQs)

  console.log(`\n=== ${rel}`)
  console.log(`   单选 ${beforeQs.length} 题 | 打乱 ${ctx.done} 题 | 警告 ${ctx.warnings.length}`)
  console.log(`   分布 before=${JSON.stringify(before)}`)
  console.log(`   分布 after =${JSON.stringify(after)}`)
  if (ctx.versionSet) console.log(`   manifest.version 补齐为 ${ctx.versionSet}`)
  ctx.warnings.forEach((w) => console.log('   ⚠ ' + w))
  totalDone += ctx.done
  allWarnings.push(...ctx.warnings)
}

console.log(`\n完成：共打乱 ${totalDone} 道单选题；警告 ${allWarnings.length} 条。`)
if (allWarnings.length) process.exitCode = 2
