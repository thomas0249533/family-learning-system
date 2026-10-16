import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { findLiteralColors, HEX_RE, RGB_RE, HSL_RE, NAMED_RE } from './helpers/colorLiterals'

// =====================================================================
// 8 UI 基元静态检查（零新依赖，environment: 'node'）
// ---------------------------------------------------------------------
// 覆盖任务书 a–e：
//   a) 8 个基元文件均存在；
//   b) 零字面量色（hex / rgb / hsl / 命名色）——与 check-hex.mjs 同口径；
//   c) 所有 `var(--x)` 均可解析（theme.scss ∪ components.scss 的声明的子集）；
//   d) 反向：已声明但未被基元引用的 token（仅报告，不阻塞）；
//   e) AppBadge / StatCard 具备 `icon` slot（§6.5 色盲冗余）。
// 另加两条防漂移护栏：展示页存在、路由为 DEV 条件注册。
// =====================================================================

const ROOT = process.cwd()
const UI_DIR = join(ROOT, 'src/components/ui')
const STYLES_DIR = join(ROOT, 'src/core/styles')

const PRIMITIVES = [
  'AppButton',
  'AppCard',
  'AppBadge',
  'StatCard',
  'SectionTitle',
  'ProgressBar',
  'EmptyState',
  'PageHeader',
] as const

function read(p: string): string {
  return readFileSync(p, 'utf8')
}

const sfcText = new Map<string, string>()
for (const name of PRIMITIVES) {
  const p = join(UI_DIR, `${name}.vue`)
  if (existsSync(p)) sfcText.set(name, read(p))
}

/** 已声明的 token 名（theme.scss + components.scss） */
function declaredTokens(): Set<string> {
  const set = new Set<string>()
  for (const f of ['theme.scss', 'components.scss']) {
    const text = read(join(STYLES_DIR, f))
    for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) set.add(m[1])
  }
  return set
}

/** 某文件里引用到的 token 名 */
function usedTokens(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) out.push(m[1])
  return out
}

// 与 check-hex.mjs 同口径的正则（防第二套真相漂移）
// 单一源：tests/helpers/colorLiterals.ts（本文件与 tokens-generation.test.ts 共用）
// 命名色用 lookaround（而非 \b）排除 CSS 标识符中的同形词，避免 `white-space` / `grid-row` 误报。

describe('8 基元 · 文件与结构', () => {
  it('a) 8 个基元 SFC 均存在', () => {
    const missing = PRIMITIVES.filter((n) => !existsSync(join(UI_DIR, `${n}.vue`)))
    expect(missing).toEqual([])
  })

  it('e) AppBadge / StatCard 具备 icon slot（语义不靠颜色单信号）', () => {
    for (const name of ['AppBadge', 'StatCard'] as const) {
      const text = sfcText.get(name) ?? ''
      expect(text, `${name} 应有 <slot name="icon"`).toContain('<slot name="icon"')
    }
  })
})

describe('8 基元 · 零硬编码色', () => {
  it('b) 所有基元声明区零字面量色（hex / rgb / hsl / 命名色）', () => {
    const hits: string[] = []
    for (const [name, text] of sfcText) {
      // 仅取 <style> 块，避免注释/文案误报
      const style = text.match(/<style[\s\S]*?<\/style>/)?.[0] ?? ''
      const kinds = findLiteralColors(style)
      if (kinds.length > 0) hits.push(`${name}: 命中 ${kinds.join(',')}`)
    }
    expect(hits).toEqual([])
  })

  it('b2) 整个 SFC（含模板/script）亦无字面量色', () => {
    const hits: string[] = []
    for (const [name, text] of sfcText) {
      const kinds = findLiteralColors(text)
      if (kinds.length > 0) hits.push(`${name}: 命中 ${kinds.join(',')}`)
    }
    expect(hits).toEqual([])
  })
})

describe('守卫正则自身（单一源 colorLiterals 的语义自证）', () => {
  it('catch 真值：hex / rgb / hsl / 命名色', () => {
    expect(findLiteralColors('--x: #abcdef;')).toContain('hex')
    expect(findLiteralColors('--x: rgba(1, 2, 3, 0.5);')).toContain('rgb')
    expect(findLiteralColors('--x: hsl(120, 50%, 50%);')).toContain('hsl')
    expect(findLiteralColors('--x: white;')).toContain('named')
  })

  it('放行合法：var() 引用与纯黑阴影（仅 alpha 片段被剔除）', () => {
    expect(findLiteralColors('--x: var(--primary-color);')).toEqual([])
    expect(findLiteralColors('--x: rgba(var(--primary-rgb), 0.55);')).toEqual([])
    expect(findLiteralColors('--x: rgba(0, 0, 0, 0.05);')).toEqual([])
    // 同行夹带真值色不得被整行放过
    expect(findLiteralColors('--x: rgba(0, 0, 0, 0.05) #000000;')).toContain('hex')
  })

  it('不误报 CSS 标识符（lookaround 版与 \\b 版的关键区别）', () => {
    for (const s of ['white-space: nowrap;', 'grid-row: 1;', 'prefers-reduced-motion: reduce;']) {
      expect(findLiteralColors(s), s).toEqual([])
    }
    // 防止有人把 lookaround 改回 \b：直接断言正则不含裸 \b 包裹
    expect(String(NAMED_RE)).toContain('(?<![\\w-])')
    expect(String(NAMED_RE)).toContain('(?![\\w-])')
  })

  it('导出四个正则均为 RegExp（供跨文件共用）', () => {
    for (const re of [HEX_RE, RGB_RE, HSL_RE, NAMED_RE]) expect(re).toBeInstanceOf(RegExp)
  })
})

describe('8 基元 · token 可解析性（§8.4 不变量 5）', () => {
  it('c) 基元引用的每个 var(--x) 都在 theme.scss ∪ components.scss 中有声明', () => {
    const declared = declaredTokens()
    const unresolved: string[] = []
    for (const [name, text] of sfcText) {
      for (const ref of usedTokens(text)) {
        if (!declared.has(ref)) unresolved.push(`${name} → var(${ref})`)
      }
    }
    expect([...new Set(unresolved)]).toEqual([])
  })

  it('c2) 解析出来的声明集非空（防止断言因空集恒过）', () => {
    expect(declaredTokens().size).toBeGreaterThan(50)
  })

  it('d) 反向报告：已声明但未被 8 基元引用的 token（不阻塞）', () => {
    const declared = declaredTokens()
    const used = new Set<string>()
    for (const text of sfcText.values()) for (const r of usedTokens(text)) used.add(r)
    const unused = [...declared].filter((t) => !used.has(t)).sort()
    // 仅报告：页面层（views/modules）仍会消费这些 token，故不作失败断言
    // eslint-disable-next-line no-console
    console.log(
      `[ui-primitives] 未被基元引用的已声明 token：${unused.length}/${declared.size}`,
    )
    expect(Array.isArray(unused)).toBe(true)
  })
})

describe('展示页与路由（DEV-only 防漂移）', () => {
  it('展示页 src/views/DesignSystem.vue 存在', () => {
    expect(existsSync(join(ROOT, 'src/views/DesignSystem.vue'))).toBe(true)
  })

  it('DesignSystem 路由受 import.meta.env.DEV 条件注册（生产 DCE）', () => {
    const router = read(join(ROOT, 'src/core/router/index.ts'))
    // 必须：DEV 三元 + 路径在 devRoutes 分支内 + 通过 push 追加
    expect(router).toContain('import.meta.env.DEV')
    expect(router).toMatch(/import\.meta\.env\.DEV\s*\?\s*\[/)
    expect(router).toContain("'/design-system'")
    expect(router).toContain('routes.push(...devRoutes)')
    // 静态 routes 数组字面量内不得直接出现该路径
    const literal = router.match(/const routes: RouteRecordRaw\[\] = \[([\s\S]*?)\n\]/)?.[1] ?? ''
    expect(literal).not.toContain('design-system')
  })

  it('展示页覆盖全部 8 个基元（data-ds 区块）', () => {
    const ds = read(join(ROOT, 'src/views/DesignSystem.vue'))
    const expected = [
      'app-button',
      'app-card',
      'app-badge',
      'stat-card',
      'section-title',
      'progress-bar',
      'empty-state',
      'page-header',
    ]
    for (const key of expected) expect(ds).toContain(`data-ds="${key}"`)
    expect(readdirSync(UI_DIR).filter((f) => f.endsWith('.vue'))).toHaveLength(8)
  })
})
