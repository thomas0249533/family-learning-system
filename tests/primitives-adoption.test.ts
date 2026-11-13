// =====================================================================
// D7 · 设计系统收口门禁的自证（V4.0）
// ---------------------------------------------------------------------
// `scripts/check-primitives.mjs` 有两条规则：
//   R1 视图里自绘卡片外观（card-bg + border-radius + box-shadow）→ 必须用 AppCard；
//   R2 视图/模块直引 naive 的 NCard / NBadge / NEmpty / NSkeleton → 必须走基元。
//
// 单测只做三件事，不做第四件：
//   ① **在位**：脚本存在、接在 verify 链里、AppCard 自己仍然是外观的唯一来源；
//   ② **非空洞**：在**临时目录**里造一个自绘卡片，脚本必须红；加上带理由的豁免注释后必须绿。
//      这一步很关键——只断言「脚本 exit 0」的话，一个永远 return 0 的空脚本也能过。
//   ③ **豁免不陈旧**：`ALLOWLIST` 每条都还能命中真实文件与选择器，理由 ≥12 字。
//      否则改完类名忘了删豁免，豁免会悄悄失效（"看起来管着 8 处，实际一处也没管"）。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, 'scripts/check-primitives.mjs')
const scriptSrc = readFileSync(SCRIPT, 'utf8')

/** 在临时目录里跑门禁：cwd 换成临时根，脚本只会扫到我们造的探针文件 */
function runProbe(files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'd7-probe-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel)
      mkdirSync(resolve(abs, '..'), { recursive: true })
      writeFileSync(abs, content, 'utf8')
    }
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' })
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const CARD_SHELL = `<template><div class="probe-card">x</div></template>
<style scoped lang="scss">
.probe-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
</style>
`

describe('check:primitives 在位', () => {
  it('脚本存在，且接在 verify 链里（紧跟 check:icon-contrast 之后）', () => {
    expect(existsSync(SCRIPT)).toBe(true)
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:primitives']).toContain('check-primitives.mjs')
    expect(pkg.scripts.verify).toContain('npm run check:primitives')
    expect(pkg.scripts.verify.indexOf('check:primitives')).toBeGreaterThan(
      pkg.scripts.verify.indexOf('check:icon-contrast'),
    )
  })

  it('AppCard 仍是卡片外观的唯一来源（基元被掏空的话，收口就没意义了）', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/ui/AppCard.vue'), 'utf8')
    // 圆角与阴影由基元自己定；底色来自 naive 的 Card 主题覆盖（不在这里重复写一遍）
    expect(src).toMatch(/border-radius:\s*var\(--radius-/)
    expect(src).toMatch(/box-shadow:\s*var\(--shadow/)
    const palette = readFileSync(resolve(ROOT, 'src/core/styles/palette.ts'), 'utf8')
    const cardBlock = palette.slice(palette.indexOf('Card: {'))
    expect(cardBlock.slice(0, 200)).toContain('color: c.cardBg')
  })

  it('R2 的边界是写明的：NButton 刻意不在禁列（AppButton 不是 drop-in）', () => {
    expect(scriptSrc).toContain("const WRAPPED = ['NCard', 'NBadge', 'NEmpty', 'NSkeleton']")
    expect(scriptSrc).toContain('NButton')
    expect(scriptSrc).toMatch(/AppButton` 不是 n-button 的 drop-in/)
  })
})

describe('check:primitives 非空洞自证', () => {
  it('造一个自绘卡片 → 必须红（且指出 R1）', () => {
    const { code, out } = runProbe({ 'src/views/probe.vue': CARD_SHELL })
    expect(code, `脚本没抓到自绘卡片：\n${out}`).toBe(1)
    expect(out).toContain('[R1]')
    expect(out).toContain('probe-card')
  })

  it('同一块换成 AppCard（无三件套）→ 必须绿', () => {
    const { code, out } = runProbe({
      'src/views/probe.vue':
        '<template><AppCard class="probe-card">x</AppCard></template>\n<style scoped lang="scss">\n.probe-card {\n  padding: 40px 20px;\n}\n</style>\n',
    })
    expect(code, `误报：\n${out}`).toBe(0)
  })

  it('带足理由的块内豁免 → 绿灯；理由太短 → 红（防空豁免）', () => {
    const withReason = CARD_SHELL.replace(
      '  box-shadow: var(--shadow-sm);',
      '  box-shadow: var(--shadow-sm);\n  /* check-primitives-allow: 截图源，宽度与圆角决定导出 PNG 尺寸，不能被基元统一 */',
    )
    expect(runProbe({ 'src/views/probe.vue': withReason }).code).toBe(0)

    const tooShort = CARD_SHELL.replace(
      '  box-shadow: var(--shadow-sm);',
      '  box-shadow: var(--shadow-sm);\n  /* check-primitives-allow: 特殊 */',
    )
    expect(runProbe({ 'src/views/probe.vue': tooShort }).code).toBe(1)
  })

  it('直引 naive NCard → 必须红（R2）；空态改用 EmptyState → 绿', () => {
    const bad =
      '<template><n-card title="x">y</n-card></template>\n<script setup lang="ts">\nimport { NCard } from \'naive-ui\'\n</script>\n'
    const r1 = runProbe({ 'src/views/probe.vue': bad })
    expect(r1.code).toBe(1)
    expect(r1.out).toContain('[R2]')

    const good =
      '<template><AppCard title="x">y</AppCard></template>\n<script setup lang="ts">\nimport AppCard from \'@/components/ui/AppCard.vue\'\n</script>\n'
    expect(runProbe({ 'src/views/probe.vue': good }).code).toBe(0)
  })

  it('只在基元层自绘卡片是合法的（src/components/ui 整层跳过）', () => {
    const { code } = runProbe({ 'src/components/ui/Probe.vue': CARD_SHELL })
    expect(code).toBe(0)
  })
})

describe('豁免清单不陈旧', () => {
  /** 从脚本源码里抽出 ALLOWLIST 的 { file, selector, reason } 三项 */
  const entries = [...scriptSrc.matchAll(
    /file:\s*'([^']+)',\s*\n\s*selector:\s*'([^']+)',\s*\n\s*reason:\s*'([^']+)'/g,
  )].map((m) => ({ file: m[1], selector: m[2], reason: m[3] }))

  it('至少解析出 1 条（正则失效时不要让本组静默全过）', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('每条豁免的文件真实存在，且选择器在该文件里仍是一条规则', () => {
    for (const e of entries) {
      const abs = resolve(ROOT, e.file)
      expect(existsSync(abs), `豁免指向不存在的文件：${e.file}`).toBe(true)
      const src = readFileSync(abs, 'utf8')
      const bare = e.selector.replace(/^&/, '').replace(/^\./, '')
      expect(src.includes(bare), `豁免已陈旧：${e.file} 里找不到 ${e.selector}（改类名时请同步删豁免）`).toBe(
        true,
      )
    }
  })

  it('每条豁免的理由 ≥12 字（"特殊"/"临时"这种不算理由）', () => {
    for (const e of entries) {
      expect(e.reason.trim().length, `豁免理由太短：${e.file} ${e.selector}`).toBeGreaterThanOrEqual(12)
    }
  })
})
