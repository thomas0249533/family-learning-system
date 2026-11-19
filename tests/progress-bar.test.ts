// =====================================================================
// ProgressBar · 答对扫光（celebrate）静态守卫（零依赖，environment: 'node'）
// ---------------------------------------------------------------------
// 本仓无 jsdom，组件不可挂载；沿用 ui-a11y.test.ts 的风格读 .vue 源码文本，
// 把判定抽成纯函数，用真实源码 + 合成「坏」源码双向自证（防空转断言）。
//
// 覆盖：
//   1) celebrate 默认值 / props 类型；
//   2) 扫光元素可重挂载（连续答对重播）、用 token 高光、零硬编码色、
//      时长走 --duration-slowest、位移 -0.6 → 1.2；
//   3) reduced-motion 分支存在且扫光不播放；
//   4) 既有 role="progressbar" / aria-valuetext 契约未被破坏。
// =====================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const source = readFileSync(join(ROOT, 'src/components/ui/ProgressBar.vue'), 'utf8')

/** 取扫光 <span> 的开始标签（纯函数，真实与合成源码共用） */
function sheenTag(text: string): string {
  return text.match(/<span[^>]*class="progress__sheen"[^>]*>/)?.[0] ?? ''
}

/** celebrate 契约违规列表（空 = 通过） */
function celebrateViolations(text: string): string[] {
  const v: string[] = []
  if (!/celebrate\?:\s*boolean/.test(text)) v.push('ProgressBarProps 缺少 celebrate?: boolean')
  if (!/celebrate:\s*false/.test(text)) v.push('withDefaults 缺少 celebrate: false（默认必须关闭）')

  const tag = sheenTag(text)
  if (!tag) v.push('缺少 .progress__sheen 扫光元素')
  else {
    if (!/v-if="celebrate"/.test(tag)) v.push('扫光缺少 v-if="celebrate"')
    if (!/:key="pct"/.test(tag)) v.push('扫光缺少 :key="pct"（连续答对无法重播）')
    if (!/aria-hidden="true"/.test(tag)) v.push('装饰性扫光缺少 aria-hidden="true"')
  }

  if (!/@keyframes\s+progress-sheen/.test(text)) v.push('缺少 progress-sheen keyframes')
  if (!/translateX\(-60%\)/.test(text)) v.push('扫光起点应为 translateX(-60%)（左 -0.6）')
  if (!/translateX\(120%\)/.test(text)) v.push('扫光终点应为 translateX(120%)（右 1.2）')
  if (!/animation:\s*progress-sheen\s+var\(--duration-slowest\)\s+linear/.test(text)) {
    v.push('扫光时长必须走 var(--duration-slowest)，缓动用 linear')
  }
  if (!/var\(--progress-gloss\)/.test(text)) v.push('高光必须取 --progress-gloss token')
  if (/#(?:[0-9a-fA-F]{3,8})\b|rgba?\(\s*\d/.test(text)) v.push('组件层出现硬编码色')
  return v
}

/** reduced-motion 违规列表（空 = 通过） */
function reducedMotionViolations(text: string): string[] {
  const v: string[] = []
  const block = text.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  if (!block) return ['缺少 prefers-reduced-motion: reduce 块']

  const sheen = block.match(/\.progress__sheen\s*\{([^}]*)\}/)?.[1] ?? ''
  if (!sheen) v.push('降级块缺少 .progress__sheen 规则')
  else if (!/display:\s*none|animation:\s*none/.test(sheen)) {
    v.push('扫光降级必须不播放（display:none 或 animation:none）')
  }
  if (!/\.progress__fill\s*\{[^}]*transition:\s*none/.test(block)) v.push('宽度过渡未降级')
  return v
}

describe('ProgressBar · celebrate 契约', () => {
  it('真实源码满足 celebrate 全部约束', () => {
    expect(celebrateViolations(source)).toEqual([])
  })

  it('真实源码满足 reduced-motion 降级', () => {
    expect(reducedMotionViolations(source)).toEqual([])
  })

  it('不破坏既有进度条 a11y 契约', () => {
    expect(source).toMatch(/role="progressbar"/)
    expect(source).toMatch(/v-bind="\$attrs"/)
    expect(source).toMatch(/:aria-valuenow="pct"/)
    expect(source).toMatch(/:aria-valuetext=/)
  })

  it('非空洞自证：合成「坏」源码会被同一判定函数抓到', () => {
    const noKey = source.replace(':key="pct"', '')
    expect(celebrateViolations(noKey).some((m) => m.includes(':key="pct"'))).toBe(true)

    const noDefault = source.replace('celebrate: false', 'celebrate: true')
    expect(celebrateViolations(noDefault).some((m) => m.includes('withDefaults'))).toBe(true)

    const noFallback = source.replace(/\.progress__sheen \{\n    display: none;\n  \}/, '')
    expect(reducedMotionViolations(noFallback).some((m) => m.includes('.progress__sheen'))).toBe(true)
  })
})
