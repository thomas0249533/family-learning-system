// =====================================================================
// 可访问性 adopt 护栏（V4.0 · D5）
// ---------------------------------------------------------------------
// 锁住四件事，任何一条退化都立即变红：
//   1. **焦点环对比度**：`--focus-ring` 指向 `--primary-text`，6 组预设 × 浅深
//      对卡片底色都要 ≥ 3:1（WCAG 1.4.11 非文本对比度）。
//      这条是 D5 的起因：原值是 `rgba(--primary-rgb, 0.55)`，浅底上只有 ~2.4:1，
//      环"在"，但看不清 —— 视觉上像是没有焦点态。
//   2. **焦点环 token 化**：定义处三个偏移 token 齐全，且 `--focus-ring` 不能又
//      被改回半透明（半透明 = 对比度不可控，取决于底下是什么）。
//   3. **v-clickable 语义**：Enter/Space 在 button / link 两种 role 下的行为差异
//      （链接按 Space 是滚动页面，不是点击）。
//   4. **门禁在位**：check:a11y 接进 verify 链，且允许列表不被悄悄放宽。
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSemantic, MODES, PRESETS, type ThemeMode, type ThemePreset } from '../src/core/styles/tokens'
import { resolveKeyAction, resolveRole } from '../src/core/a11y/clickable'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

/* ---------------------- WCAG 对比度工具 ---------------------- */

const lin = (c: number): number => {
  const x = c / 255
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}

const parseHex = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

const lum = (hex: string): number => {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const ratio = (a: string, b: string): number => {
  const la = lum(a)
  const lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const GROUPS: Array<[ThemePreset, ThemeMode]> = PRESETS.flatMap((p) =>
  MODES.map((m) => [p, m] as [ThemePreset, ThemeMode]),
)

describe('焦点环对比度护栏（WCAG 1.4.11 ≥ 3:1）', () => {
  it('6 组预设 × 浅深：焦点环对卡片底与页面底都 ≥ 3:1', () => {
    const failures: string[] = []
    for (const [preset, mode] of GROUPS) {
      const sem = buildSemantic(preset, mode) as unknown as Record<string, string>
      const ring = sem['primary-text']
      for (const bgKey of ['card-bg', 'bg-color'] as const) {
        const bg = sem[bgKey]
        const r = ratio(ring, bg)
        if (!(r >= 3)) {
          failures.push(`${preset}/${mode}: 焦点环(${ring}) vs ${bgKey}(${bg}) = ${r.toFixed(2)}:1`)
        }
      }
    }
    expect(failures, `焦点环对比度不足 3:1：\n${failures.join('\n')}`).toEqual([])
  })

  it('旧的 55% 半透明环已不可达（对比度本就不足 3:1，不能回退）', () => {
    // 用浅色预设复算旧方案，证明"回退即失败"不是空话
    const sem = buildSemantic('primary', 'light') as unknown as Record<string, string>
    const [r, g, b] = parseHex(sem['primary-color'])
    const composited = `#${[r, g, b]
      .map((c) => Math.round(c * 0.55 + 255 * 0.45).toString(16).padStart(2, '0'))
      .join('')}`
    expect(ratio(composited, sem['card-bg'])).toBeLessThan(3)
  })
})

describe('焦点环 token 定义', () => {
  const css = read('src/core/styles/components.scss')

  it('`--focus-ring` 指向不透明的 --primary-text', () => {
    expect(css).toMatch(/--focus-ring:\s*var\(--primary-text\);/)
  })

  it('不再出现 rgba 半透明焦点环', () => {
    expect(css).not.toMatch(/--focus-ring:\s*rgba\(/)
  })

  it('宽 / 偏移 / 内嵌偏移 / 强调面四个 token 齐全', () => {
    for (const name of [
      '--focus-ring-w',
      '--focus-ring-offset',
      '--focus-ring-offset-inset',
      '--focus-ring-on-strong',
    ]) {
      expect(css, `components.scss 缺少 ${name}`).toContain(`${name}:`)
    }
  })

  it('tokens.ts 镜像与 components.scss 一致', () => {
    const ts = read('src/core/styles/tokens.ts')
    expect(ts).toContain(`'focus-ring': 'var(--primary-text)'`)
    expect(ts).toContain(`'focus-ring-offset-inset': '-2px'`)
    expect(ts).toContain(`'focus-ring-on-strong': 'var(--on-strong)'`)
  })

  it('全局 :focus-visible 走 token，且不清空 outline', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-w\) solid var\(--focus-ring\)/)
  })
})

describe('v-clickable 语义', () => {
  it('button：Enter 与 Space 都激活，Space 要阻止滚动', () => {
    expect(resolveKeyAction('button', 'Enter')).toEqual({ activate: true, preventDefault: false })
    expect(resolveKeyAction('button', ' ')).toEqual({ activate: true, preventDefault: true })
  })

  it('link：只有 Enter 激活；Space 留给页面滚动', () => {
    expect(resolveKeyAction('link', 'Enter')).toEqual({ activate: true, preventDefault: true })
    expect(resolveKeyAction('link', ' ')).toEqual({ activate: false, preventDefault: false })
  })

  it('其它键一律不处理', () => {
    for (const k of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      expect(resolveKeyAction('button', k)).toEqual({ activate: false, preventDefault: false })
    }
  })

  it('role 推导：作者已声明时尊重作者；:link 修饰符得 link；否则 button', () => {
    expect(resolveRole('link', null)).toBe('link')
    expect(resolveRole(undefined, null)).toBe('button')
    expect(resolveRole('link', 'tab')).toBe('tab')
  })
})

describe('可访问性铺开', () => {
  it('main.ts 全局注册了 v-clickable 指令', () => {
    expect(read('src/main.ts')).toMatch(/app\.directive\(['"]clickable['"]/)
  })

  it('指令类型已声明（模板里 vue-tsc 才认）', () => {
    expect(read('src/global-components.d.ts')).toContain('GlobalDirectives')
  })

  it('主要卡片/行已接 v-clickable', () => {
    const targets: Array<[string, RegExp]> = [
      ['src/views/Home.vue', /class="today-card"[\s\S]{0,400}?@click="goToday"/],
      ['src/views/learn/PackageCard.vue', /v-clickable:link[\s\S]{0,200}?@click="selectPackage\(pkg\)"/],
      ['src/views/learn/TopicList.vue', /v-clickable:link[\s\S]{0,300}?@click="selectTopic\(topic\)"/],
      ['src/views/learn/UnitList.vue', /v-clickable:link[\s\S]{0,200}?@click="selectUnit\(ru\)"/],
      ['src/views/Search.vue', /v-clickable:link[\s\S]{0,200}?@click="openItem\(item\)"/],
    ]
    for (const [file, re] of targets) {
      // 断言"这块容器上有 v-clickable"：先定位到含 @click 的开标签，再回看是否带指令
      expect(read(file), `${file} 的可点击容器缺 v-clickable`).toMatch(re)
    }
  })

  it('纯图标按钮都带 aria-label', () => {
    // 抽查 D5 修过的几个「只有图标」的按钮
    const samples: Array<[string, string]> = [
      ['src/modules/core/VocabDrill.vue', 'aria-label="退出练习"'],
      ['src/modules/core/VocabDrill.vue', 'aria-label="朗读答案"'],
      ['src/modules/chinese/ChinesePoem.vue', ":aria-label=\"speakingId === kp.id ? '停止朗读' : '朗读全文'\""],
      ['src/modules/english/EnglishVocab.vue', ":aria-label=\"speakingId === kp.id ? '停止朗读' : '朗读单词'\""],
    ]
    for (const [file, needle] of samples) {
      expect(read(file), `${file} 缺 ${needle}`).toContain(needle)
    }
  })

  it('盲盒弹层可用 Esc 关闭（键盘用户有出口）', () => {
    const src = read('src/components/BlindBoxEntrance.vue')
    expect(src).toMatch(/e\.key !== 'Escape'/)
    expect(src).toMatch(/removeEventListener\('keydown'/)
  })

  it('check:a11y 已接进 verify 链', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['check:a11y']).toBeTruthy()
    expect(pkg.scripts.verify).toContain('check:a11y')
  })
})
