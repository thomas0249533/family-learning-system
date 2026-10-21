import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { GLOBAL_KEYS, PROFILE_SCOPED_KEYS } from '@core/profile/settingsScope'

/**
 * V1.6 · Stage A · A3 · settings 键分片完整性（静态扫描）
 * ---------------------------------------------------------------------------
 * ## 为什么需要这道门禁
 * `settingsScope.ts` 那张登记表（`PROFILE_SCOPED_KEYS` / `GLOBAL_KEYS`）是迁移、
 * 合并、导出三处的**唯一真相**。但它本身只是两张数组 —— 往库里写一个新键不需要
 * 经过它，于是最危险的失败模式依旧是**不报错**：
 * 新键漏登记 → 迁移不搬它（换设备后数据消失）、合并当未知键按 per-profile 猜、
 * 导出按 global 带过去。三个症状都不崩，只是数据悄悄不对。
 *
 * ## 与 `check-profile-scope.mjs` 的分工
 * 那道门禁管**表**（progress/mistakes/examSessions 的访问点要带 profileId）；
 * 本文件管**键**：settings 每一次 get/put/delete 的键表达式，必须能解析到
 * 登记表里的某一项。
 *
 * ## 为什么必须做标识符解析，而不是只匹配字面量
 * 实测 src 里 **41 个访问点，0 个字面量键** —— 全部走 `PROFILES_KEY` 这类常量
 * 或 `dailyStatsKey()` 这类函数。只扫字面量等于什么都没扫。所以这里的扫描器要：
 *   字面量        → 直接查表
 *   `scopedKey(A)` → A 必须解析到 PROFILE_SCOPED_KEYS 成员
 *   常量/函数      → 跟着 import 跳到定义文件，看它的初值 / return 表达式
 *   参数/循环变量  → 静态不可解析 → 必须带 `// settings-key-ok: <理由>` 豁免
 *
 * ## 已知边界（别当成万能）
 * 1. 只认本仓库现有的几种写法（`db.settings.x` / 局部变量 `settings.x` /
 *    `settingsTable(tx).x` / `tx.table('settings').x` / 任意别名 `.put({key:…})`）。
 *    换一种新写法（比如再包一层 `settingsRepo.get`）不会被命中 —— 但那种写法
 *    本身就会因为"集中到了一处"而更容易被 review 看到。
 * 2. 变量解析取**最近的前向声明**，不建作用域树。同一文件里两个函数各有一个
 *    `const key` 时可能取错；取错的后果是"解析到另一个键"，而那个键同样在登记表
 *    里才会通过 —— 比漏扫好，比正确解析差。
 */

// ===========================================================================
// 扫描器
// ===========================================================================

const SRC = pathResolve(process.cwd(), 'src')
const ALIASES: readonly (readonly [string, string])[] = [
  ['@core', join(SRC, 'core')],
  ['@templates', join(SRC, 'templates')],
  ['@modules', join(SRC, 'modules')],
  ['@', SRC],
]

interface KeyLists {
  profileScoped: readonly string[]
  global: readonly string[]
}

interface Problem {
  file: string
  line: number
  text: string
  reason: string
}

interface Point {
  file: string
  line: number
  op: string
  expr: string
  /** 解析到的登记表基键；null = 不可解析（走了豁免） */
  base: string | null
  scoped: boolean
}

interface Exempt {
  file: string
  line: number
  reason: string
}

interface ScanResult {
  points: Point[]
  problems: Problem[]
  exempts: Exempt[]
  /** 登记了、但没有任何 settings 访问点用到的键 */
  unused: string[]
}

interface ScanInput {
  /** 要扫描的文件：路径 → 源码 */
  files: Map<string, string>
  lists: KeyLists
}

/** `db.settings.get(` / 局部变量 `settings.put(` / `.settings.delete(` */
const RE_SETTINGS = /(?:^|[^\w$])settings\.(get|put|delete)\s*\(/g
/** migrateV3 的 `settingsTable(tx).put({ key: MIGRATION_KEY, … })` */
const RE_SETTINGS_TABLE = /settingsTable\s*\([^)]*\)\s*\.(get|put|delete)\s*\(/g
/** migrateV3Recovery 的 `tx.table('settings').put({ key: RECOVERY_KEY, … })` */
const RE_TX_TABLE = /table\s*\(\s*['"]settings['"]\s*\)\s*\.(get|put|delete)\s*\(/g
/**
 * 兜底：任何别名上的 `.put({ key: … })`（对象字面量以 `key` 开头才命中）。
 * 前三条漏掉的新写法，只要还是 Dexie 表别名 + 对象字面量，这条能兜住。
 */
const RE_PUT_KEY = /(?:^|[^\w$])?\.put\(\s*\{\s*key\s*[:,}]/g
const EXEMPT_RE = /settings-key-ok:\s*(.+)/

// ===========================================================================
// 基础文本工具
// ===========================================================================

/** 从开括号位置读到配对闭括号，跳过字符串与注释 */
function readBalanced(text: string, open: number): { inner: string; end: number } | null {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const openCh = text[open]
  const closeCh = pairs[openCh]
  if (!closeCh) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i)
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    if (c === openCh) depth++
    else if (c === closeCh) {
      depth--
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i }
    }
  }
  return null
}

/** 返回字符串字面量的结束引号下标（支持反引号模板；不处理 `${}` 嵌套） */
function skipString(text: string, start: number): number {
  const quote = text[start]
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === quote) return i
    if (c === '\n' && quote !== '`') return i
  }
  return text.length
}

/** 按顶层逗号切分（跳过字符串与嵌套括号） */
function splitTopLevel(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')
}

function lineOf(source: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') n++
  return n
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ===========================================================================
// 模块解析（跟 import 跳到定义文件）
// ===========================================================================

function resolveModulePath(spec: string, fromFile: string, files: Map<string, string>): string | null {
  let base: string | null = null
  if (spec.startsWith('.')) base = pathResolve(dirname(fromFile), spec)
  else {
    for (const [prefix, dir] of ALIASES) {
      if (spec === prefix || spec.startsWith(prefix + '/')) {
        base = join(dir, spec.slice(prefix.length))
        break
      }
    }
  }
  if (!base) return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.vue`, join(base, 'index.ts')]
  for (const cand of candidates) {
    if (files.has(cand)) return cand
    try {
      if (statSync(cand).isFile()) return cand
    } catch {
      /* 不是文件：试下一个 */
    }
  }
  return null
}

/** 从 `import { A, B as C } from '…'` 里取出「本地名 → 源名」 */
function importBindings(source: string): { local: string; imported: string; spec: string }[] {
  const out: { local: string; imported: string; spec: string }[] = []
  const re = /import\s*{([^}]*)}\s*from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    for (const part of m[1].split(',')) {
      const seg = part.trim()
      if (!seg) continue
      const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(seg)
      if (asMatch) out.push({ imported: asMatch[1], local: asMatch[2], spec: m[2] })
      else if (/^\w+$/.test(seg)) out.push({ imported: seg, local: seg, spec: m[2] })
    }
  }
  return out
}

// ===========================================================================
// 键表达式解析
// ===========================================================================

type Resolved = { ok: true; base: string; scoped: boolean } | { ok: false; reason: string }

/** 字面量 → 查登记表。`:pid` 后缀按 v4 之后的分片形态认 */
function classifyLiteral(value: string, lists: KeyLists): Resolved {
  if (lists.global.includes(value)) return { ok: true, base: value, scoped: false }
  if (lists.profileScoped.includes(value)) return { ok: true, base: value, scoped: true }
  const colon = value.lastIndexOf(':')
  if (colon > 0) {
    const head = value.slice(0, colon)
    const tail = value.slice(colon + 1)
    if (lists.profileScoped.includes(head) && tail) return { ok: true, base: head, scoped: true }
  }
  return {
    ok: false,
    reason: `键「${value}」不在 GLOBAL_KEYS 也不在 PROFILE_SCOPED_KEYS（漏登记会让迁移/合并/导出静默漏掉它）`,
  }
}

/** 取 `put(...)` 参数里的键表达式：`get/delete` 直接是首个参数，`put` 是对象的 key 属性 */
function extractKeyExpr(inner: string, op: string): string {
  const t = inner.trim()
  if (op !== 'put') return t
  if (!t.startsWith('{')) return t
  // 对象字面量：找 key 属性（`{ key: X, … }` 与简写 `{ key, … }` 都要认）
  const m = /(?:^|[{,]\s*)key\s*(?=[,}:])/.exec(t)
  if (!m) return ''
  let i = m.index + m[0].length
  while (i < t.length && /\s/.test(t[i])) i++
  if (t[i] !== ':') return 'key' // 简写属性：标识符就叫 key
  i++
  while (i < t.length && /\s/.test(t[i])) i++
  const start = i
  let depth = 0
  for (; i < t.length; i++) {
    const c = t[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(t, i)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) break
  }
  return t.slice(start, i).trim()
}

/** 在文件里找 `NAME` 的声明，取**使用点之前最近**的那个；返回初值文本与所在文件 */
function findDeclaration(
  name: string,
  file: string,
  before: number,
  files: Map<string, string>,
  depth: number,
): { text: string; file: string } | null {
  if (depth > 4) return null
  const source = files.get(file)
  if (source === undefined) return null

  // 1) 本文件的常量声明
  const constRe = new RegExp(`(?:const|let|var)\\s+${escapeRe(name)}\\s*=\\s*([^\\n;]+)`, 'g')
  let best: { text: string; file: string; at: number } | null = null
  let m: RegExpExecArray | null
  while ((m = constRe.exec(source))) {
    if (m.index > before) continue
    const lineStart = source.lastIndexOf('\n', m.index) + 1
    if (isCommentLine(source.slice(lineStart, m.index))) continue
    if (!best || m.index > best.at) best = { text: m[1].trim(), file, at: m.index }
  }
  if (best) return { text: best.text, file: best.file }

  // 2) 本文件的函数声明（const f = () => …  /  function f() {…}）
  const fn = findFunction(name, file, files, depth)
  if (fn) return fn

  // 3) import 进来的：跳到定义文件再找
  for (const b of importBindings(source)) {
    if (b.local !== name) continue
    const target = resolveModulePath(b.spec, file, files)
    if (!target) return null
    const found = findExported(b.imported, target, files, depth + 1)
    if (found) return found
  }
  return null
}

/** 在文件里找导出/本地函数 `NAME`，返回它的 return 表达式 */
function findFunction(
  name: string,
  file: string,
  files: Map<string, string>,
  depth: number,
): { text: string; file: string } | null {
  const source = files.get(file)
  if (source === undefined) return null

  // 参数表里可能有默认值（`profileId: string = currentProfileId()`），
  // 所以不能用 `[^)]*` 硬切 —— 先定位 `NAME(`，再用 readBalanced 找配对括号。
  const returnOfBody = (braceOpen: number): string | null => {
    const bal = readBalanced(source, braceOpen)
    if (!bal) return null
    const ret = /\breturn\s+([^;\n]+)/.exec(bal.inner)
    return ret ? ret[1].trim() : null
  }

  const declRe = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRe(name)}\\s*\\(`)
  const m = declRe.exec(source)
  if (m) {
    const open = m.index + m[0].length - 1
    const bal = readBalanced(source, open)
    if (bal) {
      const after = source.slice(bal.end + 1)
      const brace = /^\s*(?::[^={]*)?{/.exec(after)
      if (brace) {
        const braceOpen = bal.end + 1 + after.indexOf('{')
        const ret = returnOfBody(braceOpen)
        if (ret) return { text: ret, file }
      }
    }
  }

  // const NAME = (…) => 返回值 / { … }
  const arrowRe = new RegExp(`(?:const|let|var)\\s+${escapeRe(name)}\\s*=\\s*(?:async\\s*)?\\(`)
  const am = arrowRe.exec(source)
  if (am) {
    const open = am.index + am[0].length - 1
    const bal = readBalanced(source, open)
    if (bal) {
      const after = source.slice(bal.end + 1)
      const braceIdx = after.indexOf('{')
      if (/^\s*=>/.test(after) && braceIdx >= 0 && after.slice(0, braceIdx).trim() === '=>') {
        const ret = returnOfBody(bal.end + 1 + braceIdx)
        if (ret) return { text: ret, file }
      }
      const arrowIdx = after.indexOf('=>')
      if (arrowIdx >= 0) {
        const line = after.slice(arrowIdx + 2).split('\n')[0]
        return { text: line.trim(), file }
      }
    }
  }

  // import 进来的函数
  for (const b of importBindings(source)) {
    if (b.local !== name) continue
    const target = resolveModulePath(b.spec, file, files)
    if (!target) return null
    return findExported(b.imported, target, files, depth + 1)
  }
  return null
}

/** 在模块里找导出的 `NAME`（常量 / 函数 / 再导出），递归跟下去 */
function findExported(
  name: string,
  file: string,
  files: Map<string, string>,
  depth: number,
): { text: string; file: string } | null {
  if (depth > 4) return null
  const source = files.get(file)
  if (source === undefined) return null

  const constRe = new RegExp(`export\\s+(?:const|let|var)\\s+${escapeRe(name)}\\s*=\\s*([^\\n;]+)`)
  const cm = constRe.exec(source)
  if (cm) return { text: cm[1].trim(), file }

  const fnRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${escapeRe(name)}\\s*\\(`)
  const fm = fnRe.exec(source)
  if (fm) {
    const open = fm.index + fm[0].length - 1
    const bal = readBalanced(source, open)
    if (bal) {
      const after = source.slice(bal.end + 1)
      const braceIdx = after.indexOf('{')
      if (braceIdx >= 0) {
        const braceOpen = bal.end + 1 + braceIdx
        const body = readBalanced(source, braceOpen)
        const ret = body ? /\breturn\s+([^;\n]+)/.exec(body.inner) : null
        if (ret) return { text: ret[1].trim(), file }
      }
    }
  }

  // export { NAME } from '…' / export { NAME }
  const reRe = new RegExp(`export\\s*{[^}]*\\b${escapeRe(name)}\\b[^}]*}\\s*(?:from\\s*['"]([^'"]+)['"])?`)
  const rm = reRe.exec(source)
  if (rm) {
    if (rm[1]) {
      const target = resolveModulePath(rm[1], file, files)
      if (target) return findExported(name, target, files, depth + 1)
      return null
    }
    return findDeclaration(name, file, source.length, files, depth + 1)
  }
  return null
}

/** 解析一个键表达式 → 登记表基键 */
function resolveExpr(expr: string, file: string, files: Map<string, string>, lists: KeyLists, depth = 0): Resolved {
  if (depth > 6) return { ok: false, reason: '解析层级过深（疑似循环定义）' }
  const t = expr.trim()
  if (!t) return { ok: false, reason: '取不到键表达式' }

  // 字符串字面量
  const lit = /^(['"`])((?:\\.|(?!\1).)*)\1$/.exec(t)
  if (lit) return classifyLiteral(lit[2], lists)

  // scopedKey(BASE, …)
  if (/^scopedKey\s*\(/.test(t)) {
    const open = t.indexOf('(')
    const bal = readBalanced(t, open)
    if (!bal) return { ok: false, reason: 'scopedKey(...) 括号不完整' }
    const args = splitTopLevel(bal.inner)
    if (args.length < 2) return { ok: false, reason: 'scopedKey 需要 (base, profileId) 两个参数' }
    const base = resolveExpr(args[0], file, files, lists, depth + 1)
    if (!base.ok) return base
    if (!lists.profileScoped.includes(base.base)) {
      return { ok: false, reason: `scopedKey 的 base「${base.base}」不在 PROFILE_SCOPED_KEYS` }
    }
    return { ok: true, base: base.base, scoped: true }
  }

  // 裸标识符 → 声明
  if (/^[A-Za-z_$][\w$]*$/.test(t)) {
    const decl = findDeclaration(t, file, Number.MAX_SAFE_INTEGER, files, depth)
    if (!decl) return { ok: false, reason: `找不到「${t}」的声明（参数 / 循环变量 / 跨模块数据流）` }
    return resolveExpr(decl.text, decl.file, files, lists, depth + 1)
  }

  // 调用 f(…) → 函数体里的 return
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(t)
  if (call) {
    const fn = findFunction(call[1], file, files, depth)
    if (!fn) return { ok: false, reason: `找不到函数「${call[1]}」的声明` }
    return resolveExpr(fn.text, fn.file, files, lists, depth + 1)
  }

  return { ok: false, reason: `无法静态解析的键表达式：${t.slice(0, 60)}` }
}

// ===========================================================================
// 主扫描
// ===========================================================================

const STRING_LITERAL_RE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g

function unquote(lit: string): string {
  return lit.slice(1, -1).replace(/\\(['"\\])/g, '$1')
}

function scan(input: ScanInput): ScanResult {
  const { lists } = input
  const files = input.files

  /*
   * 这里原本有一个 `loadModule` 可选注入（"解析 import 说明符"），但从来没被接进
   * `findIdentifier` / `findFunction` / `findExported` —— 三处都直接调
   * `resolveModulePath(spec, file, files)`。也就是说它是个**静默失效的开关**：
   * 谁传进去都毫无作用，比没有更糟（B1 打开 tests 类型检查时以 TS6133 暴露）。
   * 需要注入时再加，加的时候要把参数一路传到那三个递归函数里。
   */

  const points: Point[] = []
  const problems: Problem[] = []
  const exempts: Exempt[] = []
  const usedBases = new Set<string>()

  const patterns: { re: RegExp; op: (m: RegExpExecArray) => string; openAt: 'end' | 'first' }[] = [
    { re: RE_SETTINGS, op: (m) => m[1], openAt: 'end' },
    { re: RE_SETTINGS_TABLE, op: (m) => m[1], openAt: 'end' },
    { re: RE_TX_TABLE, op: (m) => m[1], openAt: 'end' },
    // 兜底模式的匹配串以 `key:` / `key,` 结尾，开括号不在末尾
    { re: RE_PUT_KEY, op: () => 'put', openAt: 'first' },
  ]

  for (const [path, source] of files) {
    const lines = source.split(/\r?\n/)
    const seen = new Set<number>()

    for (const { re, op, openAt } of patterns) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(source))) {
        const open = openAt === 'end' ? m.index + m[0].length - 1 : m.index + m[0].indexOf('(')
        if (seen.has(open)) continue
        seen.add(open)

        const line = lineOf(source, m.index)
        if (isCommentLine(lines[line - 1] ?? '')) continue

        const bal = readBalanced(source, open)
        if (!bal) {
          problems.push({ file: path, line, text: m[0].trim(), reason: '参数括号不完整' })
          continue
        }
        const expr = extractKeyExpr(bal.inner, op(m))
        const resolved = resolveExpr(expr, path, files, lists)
        if (resolved.ok) {
          points.push({ file: path, line, op: op(m), expr, base: resolved.base, scoped: resolved.scoped })
          usedBases.add(resolved.base)
          continue
        }
        // 不可解析：附近（前 3 行 ~ 后 1 行）必须有带理由的豁免
        const near = lines.slice(Math.max(0, line - 4), Math.min(lines.length, line + 1)).join('\n')
        const ex = EXEMPT_RE.exec(near)
        if (ex) {
          exempts.push({ file: path, line, reason: ex[1].trim() })
          points.push({ file: path, line, op: op(m), expr, base: null, scoped: false })
          continue
        }
        problems.push({
          file: path,
          line,
          text: expr.slice(0, 80),
          reason: resolved.ok ? '' : resolved.reason,
        })
      }
    }
  }

  // 键形字面量（只扫 .ts：前缀清单是代码级的东西，不放在 .vue 模板里）
  for (const [path, source] of files) {
    if (!path.endsWith('.ts')) continue
    const lines = source.split(/\r?\n/)
    STRING_LITERAL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = STRING_LITERAL_RE.exec(source))) {
      const line = lineOf(source, m.index)
      if (isCommentLine(lines[line - 1] ?? '')) continue
      const value = unquote(m[0])
      if (lists.global.includes(value) || lists.profileScoped.includes(value)) continue
      if (value.endsWith(':')) {
        const head = value.slice(0, -1)
        // 只认"键前缀"形态：head 是单个 camelCase 标识符。这样 `'custom::'`（成就 id
        // 前缀）、`'::'`（分隔符）、`'[ModuleRegistry] 已注册模块:'`（日志前缀）都不会
        // 被当成键 —— 门禁误报一次，下一次就没人信它了。
        if (!/^[a-z][a-zA-Z0-9]*$/.test(head)) continue
        if (lists.profileScoped.includes(head)) continue
        problems.push({
          file: path,
          line,
          text: value,
          reason: `前缀「${head}:」不在 PROFILE_SCOPED_KEYS —— 派生清单与登记表分叉了`,
        })
        continue
      }
      if (value.includes(':')) {
        const head = value.slice(0, value.indexOf(':'))
        if (/^[a-z][a-zA-Z0-9]*$/.test(head) && lists.profileScoped.includes(head)) continue
      }
    }
  }

  const registered = [...lists.profileScoped, ...lists.global]
  const unused = registered.filter((k) => !usedBases.has(k))

  return { points, problems, exempts, unused }
}

/** 走真实 src 树 */
function scanSrc(lists: KeyLists): ScanResult {
  const files = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.(ts|vue)$/.test(name)) files.set(full, readFileSync(full, 'utf8'))
    }
  }
  walk(SRC)
  return scan({ files, lists })
}

// ===========================================================================
// 测试
// ===========================================================================

const LISTS: KeyLists = { profileScoped: PROFILE_SCOPED_KEYS, global: GLOBAL_KEYS }

describe('A3 · settings 键分片静态扫描', () => {
  it('真实 src 树：每个访问点都解析到登记键，零问题', () => {
    const r = scanSrc(LISTS)
    expect(
      r.problems.map((p) => `${p.file}:${p.line} ${p.text} → ${p.reason}`),
    ).toEqual([])
  })

  it('访问点数量是已知值（新增 settings 访问必须回来改这个数字 → 强迫审视）', () => {
    const r = scanSrc(LISTS)
    // 42 个可解析 + 2 个带豁免 = 44。改这个数字等于承认"我看过每一个新访问点"。
    expect(r.points.length).toBe(44)
    expect(r.exempts.length).toBe(2)
  })

  it('豁免恰好是那两处「键来自合并计划」的写入，且都写了理由', () => {
    const r = scanSrc(LISTS)
    // ⚠️ 行号对源码编辑敏感：applyMergePlan.ts 加过 A6 · L2 守卫（在豁免注释之前），
    // 那一处的行号就从 119 挪到了 228。改行号不等于放宽断言 —— 位置与条数都还钉着。
    const at = (e: Exempt) => `${e.file.split('src')[1].split('\\').join('/')}:${e.line}`
    expect(r.exempts.map(at).sort()).toEqual([
      '/core/merge/applyMergePlan.ts:228',
      '/core/storage/migrateV4.ts:199',
    ])
    for (const e of r.exempts) expect(e.reason.length).toBeGreaterThan(4)
  })

  it('每个 per-profile 键都真的被某个访问点用到（登记表没有死条目）', () => {
    const r = scanSrc(LISTS)
    for (const base of PROFILE_SCOPED_KEYS) {
      expect(r.points.some((p) => p.base === base && p.scoped), `per-profile 键 ${base} 没有访问点`).toBe(true)
    }
  })

  it('global 键里两个"从不进 Dexie"的有名有姓的解释', () => {
    const r = scanSrc(LISTS)
    const KNOWN_NON_DEXIE: Record<string, string> = {
      // 主题走 localStorage（src/core/stores/theme.ts:10 STORAGE_KEY）
      'fls:theme': 'localStorage，从不进 Dexie settings',
      // 归属索引是进程内缓存（ownerIndexCache.ts 明确"不入 DB、不落 localStorage"）；
      // 登记它是为了 bundleIO 的导出黑名单，属防御性登记
      'owner:indexCache': '进程内缓存；登记是为了 bundleIO 的导出黑名单',
    }
    const unexplained = r.unused.filter((k) => !(k in KNOWN_NON_DEXIE))
    expect(unexplained).toEqual([])
  })

  it('键函数解析到正确的基键（抽查 8 个）', () => {
    const r = scanSrc(LISTS)
    const byExpr = new Map(r.points.map((p) => [`${p.expr}@${p.line}`, p]))
    // 这些是 src 里真实出现的键函数调用形态
    const expected: [string, string][] = [
      ['dailyStatsKey()', 'dailyStats'],
      ['attemptedTypesKey()', 'attemptedTypes'],
      ['streakKey()', 'studyStreak'],
      ['achievementsKey()', 'achievements'],
      ['achUiKey()', 'achievementUi'],
      ['discoveryKey()', 'achievement:discovery'],
      ['discoveryEnabledKey()', 'achievement:discoveryEnabled'],
      ['collectionSeenKey()', 'achievement:collectionSeen'],
    ]
    for (const [expr, base] of expected) {
      expect([...byExpr.keys()].some((k) => k.startsWith(expr + '@')), `没找到 ${expr} 的访问点`).toBe(true)
      expect(byExpr.get([...byExpr.keys()].find((k) => k.startsWith(expr + '@'))!)?.base).toBe(base)
    }
  })

  it('自定义勾选走 scopedKey(CUSTOM_CHECKS_BASE, pid)，解析到 customChecks', () => {
    const r = scanSrc(LISTS)
    const hit = r.points.find((p) => p.expr.startsWith('scopedKey(CUSTOM_CHECKS_BASE'))
    expect(hit?.base).toBe('customChecks')
    expect(hit?.scoped).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 分类器单测（合成片段：证明判据本身有判别力）
// ---------------------------------------------------------------------------

/** 造一份内存文件集跑扫描 */
function scanOf(sources: Record<string, string>, lists: KeyLists = LISTS): ScanResult {
  const files = new Map(Object.entries(sources).map(([k, v]) => [pathResolve('/virtual', k), v]))
  return scan({ files, lists })
}

describe('A3 · 分类器判据', () => {
  it('字面量：已登记 → 过；漏登记 → 红', () => {
    expect(scanOf({ 'a.ts': `await db.settings.get('profiles')` }).problems).toEqual([])
    const bad = scanOf({ 'a.ts': `await db.settings.get('myNewKey')` })
    expect(bad.problems).toHaveLength(1)
    expect(bad.problems[0].reason).toContain('myNewKey')
  })

  it('字面量带 :pid 后缀 → 按分片形态认', () => {
    expect(scanOf({ 'a.ts': `await db.settings.get('dailyStats:default')` }).problems).toEqual([])
    // 后缀为空（脏数据形态）不放行
    const bad = scanOf({ 'a.ts': `await db.settings.get('dailyStats:')` })
    expect(bad.problems).toHaveLength(1)
  })

  it('scopedKey 的 base 漏登记 → 红', () => {
    const bad = scanOf({ 'a.ts': `await db.settings.get(scopedKey('foo', pid))` })
    expect(bad.problems).toHaveLength(1)
    expect(bad.problems[0].reason).toContain('foo')
  })

  it('import 的常量：跟着跳到定义文件', () => {
    const files = {
      'def.ts': `export const MY_KEY = 'studyStreak'`,
      'use.ts': `import { MY_KEY } from './def'\nawait db.settings.get(MY_KEY)`,
    }
    expect(scanOf(files).problems).toEqual([])
  })

  it('导入常量漏登记 → 红（这才是门禁真正的目标形态）', () => {
    const files = {
      'def.ts': `export const MY_KEY = 'brandNewKey'`,
      'use.ts': `import { MY_KEY } from './def'\nawait db.settings.get(MY_KEY)`,
    }
    const r = scanOf(files)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0].reason).toContain('brandNewKey')
  })

  it('键函数：跟着 return 表达式一路解析到字面量', () => {
    const files = {
      'def.ts': `import { scopedKey } from './scope'\nexport function myKey(pid: string) { return scopedKey('dailyStats', pid) }`,
      'scope.ts': `export function scopedKey(b: string, p: string) { return b + ':' + p }`,
      'use.ts': `import { myKey } from './def'\nawait db.settings.get(myKey())`,
    }
    // scopedKey 的第一个参数是字面量 'dailyStats' → 已登记
    expect(scanOf(files).problems).toEqual([])
  })

  it('局部变量：往上看最近的 const 声明', () => {
    const files = {
      'use.ts': [
        `const key = scopedKey('attemptedTypes', currentProfileId())`,
        `await db.settings.get(key)`,
        `await db.settings.put({ key, value: 1 })`,
      ].join('\n'),
    }
    const r = scanOf(files)
    expect(r.problems).toEqual([])
    expect(r.points.every((p) => p.base === 'attemptedTypes')).toBe(true)
  })

  it('简写属性 { key, … } 与 { key: X, … } 都认', () => {
    const files = {
      'use.ts': [
        `const key = 'achievement:audit'`,
        `await db.settings.put({ key, value: 1 })`,
        `await db.settings.put({ key: 'profiles', value: 2 })`,
      ].join('\n'),
    }
    expect(scanOf(files).problems).toEqual([])
  })

  it('参数 / 循环变量：静态不可解析 → 必须带豁免，否则红', () => {
    const files = {
      'use.ts': [
        `async function f(key: string) {`,
        `  await db.settings.get(key)`,
        `}`,
      ].join('\n'),
    }
    const bad = scanOf(files)
    expect(bad.problems).toHaveLength(1)
    expect(bad.problems[0].reason).toContain('找不到')

    const ok = scanOf({
      'use.ts': [
        `async function f(key: string) {`,
        `  // settings-key-ok: 键由调用方 scopedKey 构造，见 loadChecks`,
        `  await db.settings.get(key)`,
        `}`,
      ].join('\n'),
    })
    expect(ok.problems).toEqual([])
    expect(ok.exempts).toHaveLength(1)
  })

  it('前缀清单：`base:` 的 base 必须登记（防 KEEP 这类派生清单与登记表分叉）', () => {
    const ok = scanOf({ 'use.ts': `const KEEP = ['achievements:', 'customChecks:']` })
    expect(ok.problems).toEqual([])
    const bad = scanOf({ 'use.ts': `const KEEP = ['achievements:', 'brandNew:']` })
    expect(bad.problems).toHaveLength(1)
    expect(bad.problems[0].reason).toContain('brandNew:')
  })

  it('与键无关的带冒号字符串不误报（时间、日志前缀）', () => {
    const files = {
      'use.ts': [
        `const t = '2026-10-21T09:30:00.000Z'`,
        `const tag = '[customPack] 读失败'`,
        `const idx = '[profileId+packageId]'`,
      ].join('\n'),
    }
    expect(scanOf(files).problems).toEqual([])
  })

  it('注释里出现键不算访问点', () => {
    const files = { 'use.ts': `// await db.settings.get('myNewKey')\n/* db.settings.put({ key: 'x' }) */` }
    expect(scanOf(files).problems).toEqual([])
    expect(scanOf(files).points).toHaveLength(0)
  })
})
