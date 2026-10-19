// =====================================================================
// 设计系统文档 · 防漂移（node 环境，只读文件 + 正则，零新依赖）
// ---------------------------------------------------------------------
// 目的：让「改了组件/ token 却忘了同步文档」变成红灯，而不是靠人记得。
//
// 断言六组：
//   1) src/components/ui/*.vue 的每个基名都出现在 primitives.md；
//   2) primitives.md 的 `## Name` 标题集合 === 目录里的 .vue 集合（双向，
//      多写一个不存在的基元也红）；
//   3) primitives.md 里 `Xxx.vue` 形式的裸文件名必须真实存在（反向防烂）；
//   4) tokens.ts 的 COMPONENT_TOKENS 每个键都在 tokens.md，且第 7 节清单里
//      的值与常量一致（键集合也是双向：清单里不得出现不存在的 token）；
//   5) 三份文档不得出现「CSS 属性名 + 字面色值」写法；
//      说明性正文里孤立写 `#2d6a4f` 是允许的（文档要解释主色是什么），
//      所以**不能**用 findLiteralColors 扫全文——那会把正常说明判成违规。
//      这里的口径是「声明形态」：属性名与字面色值之间只有冒号/空白。
//   6) 文档里提到的 `npm run <x>` 必须在 package.json 里真实存在
//      （防止文档停留在已删除/改名的命令上）。
//
// 另加两条不变量：
//   · index.md 的 verify 链**不得**包含 tokens:build（它会自愈脏值，掩盖漂移）；
//   · index.md 的基元索引表覆盖全部 8 个基元。
// 每条失败的 message 都写「该改什么」。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { COMPONENT_TOKENS } from '../src/core/styles/tokens'
import { findLiteralColors } from './helpers/colorLiterals'

const ROOT = process.cwd()
const UI_DIR = join(ROOT, 'src/components/ui')
const DOCS_DIR = join(ROOT, 'docs/design-system')

const INDEX_MD = join(DOCS_DIR, 'index.md')
const PRIMITIVES_MD = join(DOCS_DIR, 'primitives.md')
const TOKENS_MD = join(DOCS_DIR, 'tokens.md')
const A11Y_MD = join(DOCS_DIR, 'a11y.md')

const read = (p: string): string => readFileSync(p, 'utf8')

/** 源码里的基元名（去扩展名），排序后便于比对。 */
const primitiveNames = (): string[] =>
  readdirSync(UI_DIR)
    .filter((f) => f.endsWith('.vue'))
    .map((f) => f.replace(/\.vue$/, ''))
    .sort()

const docs = {
  index: read(INDEX_MD),
  primitives: read(PRIMITIVES_MD),
  tokens: read(TOKENS_MD),
} as const

// ---------------------------------------------------------------------
// 可复用的纯函数（便于「非空洞自证」用合成输入直接测）
// ---------------------------------------------------------------------

/** `## AppButton` 这种二级标题里的英文标识符（跳过 `## 0. xxx` 这类编号标题）。 */
const HEADING_RE = /^##\s+([A-Za-z][A-Za-z0-9]*)\s*$/gm

function documentedPrimitives(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(HEADING_RE)) out.push(m[1])
  return out.sort()
}

/** 目录里有、文档里没有的基元。 */
function missingFrom(named: string[], md: string): string[] {
  return named.filter((n) => !new RegExp(`^##\\s+${n}\\s*$`, 'm').test(md) && !md.includes(n))
}

/** 文档里写了、源码里没有的基元标题。 */
function extraIn(documented: string[], named: readonly string[]): string[] {
  return documented.filter((n) => !named.includes(n))
}

/** 文档里 `Xxx.vue` 形式的裸文件名（不含路径前缀）。 */
function bareVueNames(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/`([A-Za-z][A-Za-z0-9]*)\.vue`/g)) out.push(m[1])
  return [...new Set(out)].sort()
}

/**
 * 「CSS 属性名 + 字面色值」写法。属性名用负向环视排除
 * `border-color` / `background-color` 等被前缀吃掉的情况（其实是先匹配长前缀，
 * 但保留 lookbehind 可防止 `my-color: #fff` 这类自定义属性误伤）。
 * 只截值到 `;`/`}`/行尾，再交给 findLiteralColors 判定，
 * 从而复用 tests/helpers/colorLiterals.ts 的 lookaround 命名色口径
 * （`white-space: nowrap` 不会误报）。
 */
const DECL_RE =
  /(?<![\w-])(color|background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|border-top-color|border-bottom-color|border-left-color|border-right-color|outline|outline-color|fill|stroke|box-shadow|text-shadow)\s*:\s*([^;{}\n]*)/g

function literalColorDeclarations(md: string): string[] {
  const hits: string[] = []
  for (const m of md.matchAll(DECL_RE)) {
    const kinds = findLiteralColors(m[2])
    if (kinds.length > 0) hits.push(`${m[1]}: ${m[2].trim()} [${kinds.join(',')}]`)
  }
  return hits
}

/** 文档里出现的 `npm run <script>` 名。 */
function mentionedScripts(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/npm run ([\w:-]+)/g)) out.push(m[1])
  return [...new Set(out)].sort()
}

/** tokens.md 第 7 节「全量清单」的正文（`### 全量清单` 到下一个 `## `）。 */
function componentTokenSection(md: string): string {
  const start = md.indexOf('### 全量清单')
  if (start < 0) return ''
  const rest = md.slice(start)
  const end = rest.indexOf('\n## ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

// ---------------------------------------------------------------------
// 0. 基线：三份文档存在且非空
// ---------------------------------------------------------------------
describe('设计系统文档 · 基线', () => {
  it('index.md / primitives.md / tokens.md 均存在且非空', () => {
    for (const p of [INDEX_MD, PRIMITIVES_MD, TOKENS_MD]) {
      expect(existsSync(p), `缺少文档：${p}（本测试要求三份文档齐全）`).toBe(true)
      expect(read(p).length, `${p} 内容过短，像是占位文件`).toBeGreaterThan(500)
    }
  })

  it('a11y.md 仍在，且 index.md 链到它（不要把审计文档写丢）', () => {
    expect(existsSync(A11Y_MD), 'docs/design-system/a11y.md 被删了；对比度审计是 AA 的唯一证据').toBe(
      true,
    )
    expect(docs.index, 'index.md 应链到 ./a11y.md，否则读者找不到对比度实测').toContain(
      './a11y.md',
    )
  })
})

// ---------------------------------------------------------------------
// 1/2/3 基元文档覆盖（双向）
// ---------------------------------------------------------------------
describe('primitives.md ⇄ src/components/ui/*.vue（双向锁定）', () => {
  const names = primitiveNames()
  const documented = documentedPrimitives(docs.primitives)

  it('目录里至少有一个基元（防断言因空集恒过）', () => {
    expect(names.length, 'src/components/ui/ 下没有 .vue？路径或目录结构变了').toBeGreaterThan(0)
  })

  it('每个 .vue 的基名都在 primitives.md 出现（新增基元忘写文档 → 红）', () => {
    const missing = missingFrom(names, docs.primitives)
    expect(
      missing,
      `primitives.md 缺少这些基元：${missing.join(', ')}。`
        + '请在 primitives.md 里补一节 `## <基元名>`，写清 props / slots / events / 消费的 token / a11y。',
    ).toEqual([])
  })

  it('primitives.md 的二级标题集合 === 目录里的基元集合（写了不存在的基元 → 红）', () => {
    const extra = extraIn(documented, names)
    expect(
      extra,
      `primitives.md 提到了源码里不存在的基元：${extra.join(', ')}。`
        + '要么删掉这一节（基元已删除/改名），要么先把 .vue 加进 src/components/ui/。',
    ).toEqual([])
    expect(
      documented,
      `primitives.md 的基元标题与目录不一致。目录：${names.join(', ')}；文档：${documented.join(', ')}。`
        + '该文件每个基元必须恰好一个 `## <基元名>` 标题（否则本测试的解析会漏项）。',
    ).toEqual(names)
  })

  it('primitives.md 里裸写的 Xxx.vue 必须真实存在（反向防烂）', () => {
    const unknown = bareVueNames(docs.primitives).filter(
      (n) => !existsSync(join(UI_DIR, `${n}.vue`)),
    )
    expect(
      unknown,
      `primitives.md 引用了不存在的文件：${unknown.join(', ')}。`
        + '若基元已改名，请同步标题与文件名；文件名写错会被 check:hex 之外的读者当成真相。',
    ).toEqual([])
  })

  it('非空洞自证：合成文档能被正确判缺 / 判多', () => {
    expect(missingFrom(['AppButton', 'AppGhost'], '## AppButton\n')).toEqual(['AppGhost'])
    expect(extraIn(documentedPrimitives('## AppButton\n## AppGhost\n'), ['AppButton'])).toEqual([
      'AppGhost',
    ])
    expect(bareVueNames('见 `AppGhost.vue` 与 `src/views/DesignSystem.vue`。')).toEqual(['AppGhost'])
  })
})

// ---------------------------------------------------------------------
// 4. COMPONENT_TOKENS ⇄ tokens.md（第 3 层不漂移）
// ---------------------------------------------------------------------
describe('tokens.md ⇄ COMPONENT_TOKENS（第三层全量清单）', () => {
  const section = componentTokenSection(docs.tokens)
  const entries = Object.entries(COMPONENT_TOKENS)

  it('第 7 节「全量清单」存在（本节是 tokens.md 的锚点，改名请同步本测试）', () => {
    expect(section, 'tokens.md 找不到 `### 全量清单`：请保留该标题，测试靠它定位清单').not.toBe('')
  })

  it('每个 COMPONENT_TOKENS 键都在 tokens.md 出现（新增组件 token 忘写文档 → 红）', () => {
    const missing = entries.map(([k]) => k).filter((k) => !docs.tokens.includes(`--${k}`))
    expect(
      missing,
      `tokens.md 缺少这些组件级 token：${missing.map((k) => `--${k}`).join(', ')}。`
        + '请在 `### 全量清单` 表里补一行（键 / 值 / 消费者），并确认 components.scss 同步声明。',
    ).toEqual([])
  })

  it('清单里记录的键集合 === COMPONENT_TOKENS 键集合（多写不存在的 token → 红）', () => {
    const listed = [...section.matchAll(/`--([a-z0-9-]+)`/g)].map((m) => m[1])
    const unique = [...new Set(listed)].sort()
    expect(
      unique,
      `tokens.md 第 7 节列的 token 与 COMPONENT_TOKENS 不一致。`
        + '若删了组件 token，请同时删清单行；若只是正文提到别的 token，请移出本节。',
    ).toEqual(entries.map(([k]) => k).sort())
  })

  it('清单里每个 token 的值 === COMPONENT_TOKENS 的值（文档抄错值 → 红）', () => {
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const wrong: string[] = []
    for (const [key, value] of entries) {
      const row = new RegExp('`--' + esc(key) + '`\\s*\\|\\s*`' + esc(value) + '`')
      if (!row.test(section)) wrong.push(`--${key} 应为 \`${value}\``)
    }
    expect(
      wrong,
      `tokens.md 全量清单里的值与 tokens.ts 不一致：${wrong.join('；')}。`
        + '文档值必须逐字等于 COMPONENT_TOKENS（否则读者会照错的抄）。',
    ).toEqual([])
  })

  it('非空洞自证：清单解析确实提取到 token 名', () => {
    expect(section.match(/`--[a-z0-9-]+`/g)?.length ?? 0).toBeGreaterThanOrEqual(
      entries.length,
    )
  })
})

// ---------------------------------------------------------------------
// 5. 文档不含「声明形态」的硬编码色
// ---------------------------------------------------------------------
describe('三份文档 · 无硬编码色（只禁声明形态，不禁说明性色值）', () => {
  it('没有任何 CSS 属性直接等于字面色值', () => {
    const hits: string[] = []
    for (const [name, text] of Object.entries(docs)) {
      for (const h of literalColorDeclarations(text)) hits.push(`${name}.md → ${h}`)
    }
    expect(
      hits,
      `文档里出现硬编码色：${hits.join(' | ')}。`
        + '示例代码一律写 var(--x)；要展示某个色值本身（如主色 #2d6a4f）请放在正文或表格里，'
        + '不要写成 CSS 声明。',
    ).toEqual([])
  })

  it('守卫非空洞：声明形态必命中，说明性色值必放行', () => {
    // ① 真值必须被抓（含命名色与非纯黑 rgb）
    expect(literalColorDeclarations('```css\n.a { color: #2d6a4f; }\n```').length).toBe(1)
    expect(literalColorDeclarations('x { background: white; }').length).toBe(1)
    expect(literalColorDeclarations('x { border-color: rgb(1, 2, 3); }').length).toBe(1)
    // ② 说明性写法必须放行：正文里孤立提到色值、以及 token 引用
    expect(literalColorDeclarations('主色是 `#2d6a4f`（浅）/ `#4fa57f`（深）')).toEqual([])
    expect(literalColorDeclarations('```scss\n.a { color: var(--text-main); }\n```')).toEqual([])
    expect(literalColorDeclarations('| --on-strong | #ffffff |')).toEqual([])
    // ③ CSS 标识符不得误报（lookaround 版命名色正则的意义）
    expect(literalColorDeclarations('x { white-space: nowrap; }')).toEqual([])
  })
})

// ---------------------------------------------------------------------
// 6. 文档提到的 npm 脚本必须真实存在
// ---------------------------------------------------------------------
describe('文档 ⇄ package.json scripts', () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as {
    scripts: Record<string, string>
  }
  const available = Object.keys(pkg.scripts)

  it('每个 `npm run <x>` 都在 package.json 里（文档不得停留在已删除的命令）', () => {
    const mentioned = new Set<string>()
    for (const text of Object.values(docs)) {
      for (const s of mentionedScripts(text)) mentioned.add(s)
    }
    const ghosts = [...mentioned].filter((s) => !available.includes(s))
    expect(
      ghosts,
      `文档提到了不存在的 npm 脚本：${ghosts.join(', ')}。`
        + `现有脚本：${available.join(', ')}。请改文档或补脚本（不要留死命令）。`,
    ).toEqual([])
  })

  it('文档确实提到了核心门禁命令（防止「一条都没提」时本断言恒过）', () => {
    const all = Object.values(docs).join('\n')
    for (const s of ['tokens:build', 'tokens:check', 'check:hex', 'check:text-color']) {
      expect(all, `文档里应解释 \`npm run ${s}\` 的作用与顺序`).toContain(`npm run ${s}`)
    }
  })
})

// ---------------------------------------------------------------------
// 7. index.md 的额外不变量
// ---------------------------------------------------------------------
describe('index.md · 门禁顺序与基元索引', () => {
  it('verify 链不含 tokens:build（它会自愈脏值、掩盖漂移）', () => {
    const block = docs.index.match(/```\nnpm run tokens:check([\s\S]*?)```/)?.[0] ?? ''
    expect(
      block,
      'index.md 应有一段以 `npm run tokens:check` 开头的 verify 命令块（测试靠它校验顺序）',
    ).not.toBe('')
    expect(
      block,
      'verify 链里出现了 tokens:build：build 会先覆盖手改的生成物，导致漂移永远抓不到。'
        + '请把 tokens:check 留在最前，且不要在 verify 里放 tokens:build。',
    ).not.toContain('tokens:build')
    expect(
      docs.index,
      'index.md 必须说明 pretest/predev/prebuild 会自愈、所以 tokens:check 要最先跑（这是顺序的理由）',
    ).toMatch(/pretest[\s\S]{0,120}prebuild|predev/)
  })

  it('8 个基元都出现在 index.md 的索引里', () => {
    const missing = primitiveNames().filter((n) => !docs.index.includes(n))
    expect(
      missing,
      `index.md 的基元索引缺少：${missing.join(', ')}。新增基元后请补索引表一行。`,
    ).toEqual([])
  })

  it('三套主题预设都出现在 index.md', () => {
    for (const p of ['primary', 'junior', 'senior']) {
      expect(docs.index, `index.md 的主题预设表应包含 ${p}`).toContain(p)
    }
  })
})
