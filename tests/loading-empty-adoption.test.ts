import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// =====================================================================
// D4 · 空态 / 加载态收口（零依赖，environment: 'node'）
// ---------------------------------------------------------------------
// 守三件事：
//   a) 裸 `<n-empty>` 只准出现在 EmptyState 基元里（否则空态文案/图标/动作
//      会重新长回各视图，漂成十几种写法）；
//   b) 页面级加载态用 Skeleton 骨架 + `aria-busy`，而不是「文字加载中」或转圈；
//   c) Skeleton 基元自身的契约（variant / label / 减弱动效）不被改坏。
// =====================================================================

const ROOT = process.cwd()
/** 相对仓库根的路径与绝对路径都接受（vueFiles 返回的是绝对路径） */
const read = (p: string) => readFileSync(p.startsWith(ROOT) ? p : join(ROOT, p), 'utf8')

/** 递归收集 src 下的 .vue */
function vueFiles(dir = join(ROOT, 'src'), out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) vueFiles(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const rel = (p: string) => p.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')

describe('D4 · 空态收口', () => {
  it('a) 裸 <n-empty> 只出现在 EmptyState.vue', () => {
    const offenders = vueFiles()
      .filter((f) => rel(f) !== 'src/components/ui/EmptyState.vue')
      .filter((f) => /<n-empty\b/.test(read(f)))
      .map(rel)
    expect(offenders, `这些文件仍裸用 <n-empty>，请改用 <EmptyState>：\n${offenders.join('\n')}`).toEqual([])
  })

  it('a) EmptyState 仍然包 n-empty（没有偷偷换成自建结构）', () => {
    expect(read('src/components/ui/EmptyState.vue')).toContain('<n-empty')
  })
})

describe('D4 · 加载态骨架铺开', () => {
  // 这些页面在 D4 从「文字加载中 / 转圈」改成了同构骨架，锁住防回退
  const PAGES = [
    'src/views/Report.vue',
    'src/views/Review.vue',
    'src/views/Home.vue',
    'src/views/learn/PackageList.vue',
    'src/views/learn/TopicList.vue',
    'src/views/learn/UnitList.vue',
    'src/views/learn/TopicDetail.vue',
  ]

  it('b) 目标页面均使用 <Skeleton> 且加载区带 aria-busy', () => {
    const missing: string[] = []
    for (const p of PAGES) {
      const text = read(p)
      if (!text.includes('<Skeleton')) missing.push(`${p}：没有 <Skeleton>`)
      if (!text.includes('aria-busy')) missing.push(`${p}：加载容器缺 aria-busy`)
    }
    expect(missing).toEqual([])
  })

  it('b) 页面级 n-spin 已清零（转圈只保留在局部块 / 阻塞遮罩）', () => {
    const offenders: string[] = []
    for (const f of vueFiles().filter((x) => rel(x).startsWith('src/views/'))) {
      read(f).split('\n').forEach((line, i) => {
        if (!/<n-spin[^>]*size="large"/.test(line)) return
        // 上一行或本行写了 check-loading-allow 的，视为显式豁免
        const prev = read(f).split('\n')[i - 1] ?? ''
        if (line.includes('check-loading-allow') || prev.includes('check-loading-allow')) return
        offenders.push(`${rel(f)}:${i + 1}`)
      })
    }
    expect(offenders, `页面级 n-spin 应改为骨架（阻塞遮罩请加 check-loading-allow）：\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('D4 · Skeleton 基元契约', () => {
  const sfc = read('src/components/ui/Skeleton.vue')

  it('c) 三种 variant 齐备且都有样式', () => {
    for (const v of ['text', 'rect', 'circle']) {
      expect(sfc, `缺少 variant: ${v}`).toContain(`skeleton--${v}`)
    }
  })

  it('c) 默认对辅助技术隐藏，传 label 才播报', () => {
    expect(sfc).toContain("label ? undefined : 'true'")
    expect(sfc).toContain("label ? 'status' : undefined")
  })

  it('c) 减弱动效偏好下停止脉冲', () => {
    expect(sfc).toMatch(/prefers-reduced-motion:\s*reduce/)
    expect(sfc).toMatch(/\.skeleton--animated\s*\{\s*animation:\s*none/)
  })

  it('c) 不写死像素级颜色（底色走 token）', () => {
    expect(sfc).toContain('var(--bg-color-hover)')
    expect(sfc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
