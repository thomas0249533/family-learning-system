#!/usr/bin/env node
/**
 * 门禁：三张"按档案分片"的表，任何访问点都必须带 `profileId`（V1.4 · B1）。
 *
 * ## 为什么需要这条门禁
 * 加 `profileId` 之后最危险的 bug 不是"报错"，而是**不报错**：
 *   - `db.mistakes.toArray()` 忘了过滤 → 老二看到老大的错题本；
 *   - `db.progress.where('packageId')...` 忘了加档案 → 统计把两个孩子相加；
 *   - 写入忘了带 pid → 记录静默落进别人的档案，统计"看起来正常"。
 * `tsc` 抓不到这些（类型上都是合法的 Table 调用），只能靠文本规则。
 *
 * ## 只管"读"，不管"写"
 * 这是本门禁的**关键边界**，先看清楚再改：
 *   - **写**（`add` / `put` / `bulkPut` / `update` / `delete` / `get(主键)`）由 `tsc` 兜：
 *     `ProgressRecord.profileId` 是必填字段，任何用对象字面量构造记录的地方都会编译失败。
 *     实测这条防线有效 —— B1 实施时正是 TS2741 把所有构造点逼了出来。
 *   - **读**（`toArray` / `where` / `filter` / `count` / `clear` / `orderBy`）`tsc` 完全抓不到：
 *     `db.progress.toArray()` 类型永远合法，漏了档案过滤只会静默把两个孩子的数据混在一起。
 *     所以门禁只盯这一类。
 *
 * ## 判据（三句话）
 *   1. 命中 `db.<表>` 且该行是**读**操作 → 视为访问点；
 *   2. 该行**前后窗口**（上一行 ~ 后三行）里出现 `profileId` 或 `pid` → 通过；
 *   3. 否则必须有一行带 `// profile-scope-ok: <理由>`。**理由不能为空** ——
 *      只写标签等于把门禁关掉，那还不如不做。
 *
 * ## 刻意跳过的情况
 *   - `db.transaction('rw', db.progress, db.settings, ...)`：这几处只是把表交给事务，
 *     真正读写用 `tx.table(...)`，由迁移模块自己负责（且它们本来就跨档案）；
 *   - 单独成行的表名列举（`db.progress,`）；
 *   - 注释行（`*` / `//` 开头）—— 文档里提到 `db.progress` 不是访问。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TARGET = /db\.(progress|mistakes|examSessions)\b/
/**
 * "读"操作白名单。写入不在此列 —— 它们由 `tsc` 的必填字段兜（见文件头）。
 * `where` 也算读：`where('packageId')` 漏掉档案就是跨档案查询。
 */
const READ_OP = /\.(toArray|where|filter|count|clear|orderBy|each|offset|limit|reverse)\s*\(/
const SCOPE_HINT = /\bprofileId\b|\bpid\b/
const EXEMPT = /profile-scope-ok:\s*\S+/
/**
 * 文件级豁免：`// profile-scope-ok-file: <理由>` 写在文件前 12 行内。
 * 只给"整个文件本身就在做跨档案操作"的情况用（目前只有 v1 全量导出）。
 * 豁免的文件会在结尾被**列出来** —— 悄悄豁免等于没有门禁。
 */
const EXEMPT_FILE = /profile-scope-ok-file:\s*\S+/

/** 窗口：访问点所在行 + 前后 */
const BEFORE = 1
const AFTER = 3

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(name)) out.push(full)
  }
  return out
}

function isComment(line) {
  const t = line.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')
}

/** 事务里列举表、或单独成行的表名：不是访问点 */
function isTableList(line) {
  if (line.includes('db.transaction(')) return true
  return /^db\.(progress|mistakes|examSessions),?$/.test(line.trim())
}

const problems = []
const exemptFiles = []
let checked = 0
let exempted = 0

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/')
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)

  const head = lines.slice(0, 12).join('\n')
  if (EXEMPT_FILE.test(head)) {
    exemptFiles.push(rel)
    continue
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!TARGET.test(line)) continue
    if (isComment(line)) continue
    if (isTableList(line)) continue

    // Dexie 的链式调用几乎总是跨行的：
    //   const raw = await db.progress
    //     .where('[profileId+...]').equals(key).first()
    // 只看命中行会漏掉下一行的 `.where(...)`，所以把后续 6 行拼成"逻辑语句"再判。
    const stmtTo = Math.min(lines.length - 1, i + 6)
    const stmt = lines.slice(i, stmtTo + 1).join('\n')
    if (!READ_OP.test(stmt)) continue

    checked++
    const from = Math.max(0, i - BEFORE)
    const window = lines.slice(from, stmtTo + 1).join('\n')

    if (SCOPE_HINT.test(window)) continue

    // 豁免注释要在访问点附近（前后 2 行内）
    const near = lines
      .slice(Math.max(0, i - 2), Math.min(lines.length - 1, i + 2) + 1)
      .join('\n')
    if (EXEMPT.test(near)) {
      exempted++
      continue
    }

    problems.push({
      file: rel,
      line: i + 1,
      text: line.trim().slice(0, 120),
    })
  }
}

if (problems.length > 0) {
  console.error('\n✖ profile-scope：以下访问点没有带 profileId（会把数据混到别的档案里）\n')
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`)
    console.error(`    ${p.text}`)
  }
  console.error(
    `\n共 ${problems.length} 处。修法二选一：\n` +
      `  a) 加档案过滤：.where('profileId').equals(currentProfileId())\n` +
      `  b) 确实要跨档案操作时，在访问点附近写：// profile-scope-ok: <为什么必须跨档案>\n`
  )
  process.exit(1)
}

console.log(
  `✔ profile-scope：${checked} 个访问点全部带档案作用域` +
    (exempted > 0 ? `（其中 ${exempted} 个是带理由的豁免）` : '')
)
if (exemptFiles.length > 0) {
  console.log(`  文件级豁免（整文件跳过）：${exemptFiles.join(', ')}`)
}
