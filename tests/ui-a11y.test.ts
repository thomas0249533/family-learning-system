import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// =====================================================================
// UI 基元无障碍静态检查（零新依赖，environment: 'node'，组件不可挂载）
// ---------------------------------------------------------------------
// 与 ui-primitives.test.ts 同风格：读 .vue 源码文本做静态断言。
// 覆盖两类真实缺陷的防回归：
//   1) StatCard：可聚焦（tabindex）↔ 可激活（click emit + Enter/Space
//      keydown）必须一致 —— 不允许「承诺了交互却不兑现」；
//   2) ProgressBar：role="progressbar" 所在元素能吃到 $attrs（可访问
//      名称），aria-valuemin/max/now 统一 0–100 百分比量纲，且有
//      aria-valuetext 人类可读文案。
// 反向自证：把「坏」源码喂给同一校验函数，必须报缺陷（防空转断言）。
// =====================================================================

const ROOT = process.cwd()
const UI_DIR = join(ROOT, 'src/components/ui')

function read(name: string): string {
  return readFileSync(join(UI_DIR, `${name}.vue`), 'utf8')
}

/** 取带 role="progressbar" 的开始标签文本（不含子元素） */
function progressbarTag(text: string): string {
  const idx = text.indexOf('role="progressbar"')
  if (idx === -1) return ''
  const start = text.lastIndexOf('<', idx)
  const end = text.indexOf('>', idx)
  return text.slice(start, end + 1)
}

// ---------------------------------------------------------------------
// 校验函数：真实源码与合成「坏」源码共用同一套（反向自证的关键）
// ---------------------------------------------------------------------

/** StatCard：可聚焦 ↔ 可激活一致性。返回违规列表（空 = 通过）。 */
function statCardViolations(text: string): string[] {
  const v: string[] = []
  const focusable = /:tabindex=/.test(text)
  const hasClickEmit = /defineEmits<[^>]*\bclick\b/.test(text)
  const hasKeyActivation = /@keydown\.(enter|space)/.test(text)
  const activatable = hasClickEmit && hasKeyActivation
  if (focusable && !activatable) {
    v.push('有 tabindex 却无键盘激活（click emit / keydown.enter|space 缺失）')
  }
  if (activatable && !focusable) {
    v.push('有激活手段却不可聚焦（缺 tabindex）')
  }
  return v
}

/** ProgressBar：可访问名称落点 + aria 量纲一致性。返回违规列表。 */
function progressBarViolations(text: string): string[] {
  const v: string[] = []
  if (!/inheritAttrs:\s*false/.test(text)) {
    v.push('缺少 inheritAttrs: false（attrs 会落到外层 wrap，本体无名）')
  }
  const tag = progressbarTag(text)
  if (!tag) {
    v.push('缺少 role="progressbar"')
    return v
  }
  if (!tag.includes('v-bind="$attrs"')) {
    v.push('progressbar 本体未 v-bind="$attrs"（aria-label 无法命中）')
  }
  if (!/aria-valuemin="0"/.test(tag)) v.push('aria-valuemin 应为字面量 0')
  if (!/aria-valuemax="100"/.test(tag)) v.push('aria-valuemax 应为字面量 100（百分比量纲）')
  if (!/:aria-valuenow="pct"/.test(tag)) {
    v.push('aria-valuenow 应绑定 pct（百分比量纲，而非原始值 clamped）')
  }
  if (!/:aria-valuetext=/.test(tag)) v.push('缺少 :aria-valuetext（读屏只会读一个裸数字）')
  return v
}

// ---------------------------------------------------------------------
// 合成「坏」源码：修复前的真实缺陷形态（喂给同一校验函数）
// ---------------------------------------------------------------------

const STAT_CARD_BAD = `
<template>
  <div class="stat-card" :class="{ 'stat-card--interactive': interactive }"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined">
    <div class="stat-card__body"><slot /></div>
  </div>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ interactive?: boolean }>(), { interactive: false })
</script>
`

const PROGRESS_BAR_BAD = `
<template>
  <div class="progress-wrap">
    <div class="progress" role="progressbar"
      :aria-valuenow="clamped" :aria-valuemin="0" :aria-valuemax="max">
      <div class="progress__fill" />
    </div>
  </div>
</template>
<script setup lang="ts">
const props = withDefaults(defineProps<{ value: number; max?: number }>(), { max: 100 })
const clamped = computed(() => Math.max(0, Math.min(props.value, props.max)))
</script>
`

describe('StatCard · 可聚焦 ↔ 可激活一致', () => {
  it('真实源码：tabindex 与 click emit + Enter/Space 激活同时具备', () => {
    expect(statCardViolations(read('StatCard'))).toEqual([])
  })

  it('Enter 与 Space 两条路径都必须存在（只补一条等于砍掉半个键盘）', () => {
    const text = read('StatCard')
    expect(text).toMatch(/@keydown\.enter/)
    expect(text).toMatch(/@keydown\.space/)
  })

  it('反证：仅有 tabindex 的旧形态必须被判失败（防断言空转）', () => {
    const v = statCardViolations(STAT_CARD_BAD)
    expect(v.length).toBeGreaterThan(0)
    expect(v.join(';')).toContain('无键盘激活')
  })

  it('反证：有激活却砍掉 tabindex 同样判失败', () => {
    const v = statCardViolations(
      STAT_CARD_BAD.replace(':tabindex="interactive ? 0 : undefined"', '')
        .replace('</script>', 'const emit = defineEmits<{ click: [] }>()\n</script>')
        .replace(':role=', '@keydown.enter="emit(\'click\')" :role='),
    )
    expect(v.join(';')).toContain('不可聚焦')
  })
})

describe('ProgressBar · 可访问名称与量纲', () => {
  it('真实源码：inheritAttrs:false + 本体 v-bind="$attrs" 同时存在', () => {
    expect(progressBarViolations(read('ProgressBar'))).toEqual([])
  })

  it('量纲一致：min=0 / max=100 / now=pct（百分比），且有 valuetext', () => {
    const tag = progressbarTag(read('ProgressBar'))
    expect(tag).toContain('aria-valuemin="0"')
    expect(tag).toContain('aria-valuemax="100"')
    expect(tag).toContain(':aria-valuenow="pct"')
    expect(tag).toContain(':aria-valuetext=')
  })

  it('反证：attrs 落外层 + valuenow=clamped 的旧形态必须被判失败', () => {
    const v = progressBarViolations(PROGRESS_BAR_BAD)
    expect(v.length).toBeGreaterThanOrEqual(4)
    expect(v.join(';')).toContain('inheritAttrs')
    expect(v.join(';')).toContain('v-bind="$attrs"')
    expect(v.join(';')).toContain('百分比量纲')
  })
})
