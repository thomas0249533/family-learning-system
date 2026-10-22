import { describe, expect, it } from 'vitest'
import { GATES, selectGates } from '../scripts/git-hooks/gate-relevance.mjs'

/** 跑哪些门禁（只要 script 名，保序） */
function gatesFor(files: readonly string[]): string[] {
  return selectGates(files).run.map((g) => g.script)
}

describe('selectGates · 暂存文件相关性（V1.10 Stage E · E0）', () => {
  it('文档与截图类提交：两道门禁都跳过（本仓八成提交长这样）', () => {
    expect(gatesFor(['docs/memory/2026-10-22-x.md', 'docs/screenshots/a.png', 'README.md'])).toEqual([])
  })

  it('tokens.ts 改动：两道门禁都跑（它同时是 src/ 下的 .ts，可能引入类型错误）', () => {
    expect(gatesFor(['src/core/styles/tokens.ts'])).toEqual(['tokens:check', 'typecheck:test'])
  })

  it('生成物 theme.scss 在 src/ 下：两道门禁都跑', () => {
    expect(gatesFor(['src/core/styles/theme.scss'])).toEqual(['tokens:check', 'typecheck:test'])
  })

  it('普通组件/core 改动：只跑 typecheck:test（不可能让 token 漂移）', () => {
    expect(gatesFor(['src/components/ui/Button.vue', 'src/core/quiz/blank.ts'])).toEqual(['typecheck:test'])
  })

  it('tests/ 改动：只跑 typecheck:test', () => {
    expect(gatesFor(['tests/e2e/foo.spec.ts'])).toEqual(['typecheck:test'])
  })

  it('package.json 与 tsconfig 改动：保守地算 typecheck:test 相关', () => {
    expect(gatesFor(['package.json'])).toEqual(['typecheck:test'])
    expect(gatesFor(['tsconfig.json'])).toEqual(['typecheck:test'])
    expect(gatesFor(['tsconfig.test.json'])).toEqual(['typecheck:test'])
    expect(gatesFor(['tsconfig.node.json'])).toEqual(['typecheck:test'])
  })

  it('钩子自身与 scripts/ 改动：不触发任何门禁（不在任何 include 里）', () => {
    expect(gatesFor(['scripts/git-hooks/pre-commit.mjs', 'scripts/check-hex.mjs'])).toEqual([])
  })

  it('docs 与 src 混合：相关门禁照跑，不因混了文档就放水', () => {
    expect(gatesFor(['docs/x.md', 'src/core/styles/tokens.ts'])).toEqual(['tokens:check', 'typecheck:test'])
  })

  it('空清单与 nullish：不跑也不炸', () => {
    expect(gatesFor([])).toEqual([])
    expect(selectGates(undefined).run).toEqual([])
    expect(selectGates(null).run).toEqual([])
  })

  it('门禁表保持两条、tokens:check 在最前（顺序即优先级）', () => {
    expect(GATES.map((g) => g.script)).toEqual(['tokens:check', 'typecheck:test'])
  })

  it('跳过的门禁也带齐 why 与 triggers（打印出来要让提交者看懂为什么跳过）', () => {
    const { run, skipped } = selectGates(['docs/a.md'])
    expect(run).toEqual([])
    expect(skipped).toHaveLength(2)
    for (const gate of skipped) {
      expect(gate.why.length).toBeGreaterThan(0)
      expect(gate.triggers.length).toBeGreaterThan(0)
    }
  })
})
