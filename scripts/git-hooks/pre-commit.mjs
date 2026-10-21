#!/usr/bin/env node
/**
 * pre-commit 门禁（V1.6 · Stage B · B1）
 *
 * ## 为什么不用 husky + lint-staged
 * 本项目纪律是「不为一个钩子引入依赖」。husky 要装包、要 `prepare` 脚本、
 * 还会在 `.git/hooks` 里塞一层转发脚本；而我们要跑的两件事本就是 npm script，
 * 30 行 Node 就够了。
 *
 * ## 为什么跑的是这两条
 * 1. `tokens:check` —— 生成物（`theme.scss` / `palette.ts`）与唯一手写色源
 *    `src/core/styles/tokens.ts` 的漂移检测。**必须最先跑**：后面的门禁（尤其
 *    `pretest` 的 `tokens:build`）会自愈脏值，跑晚了就掩盖了漂移。
 * 2. `typecheck:test` —— `tests/` 的类型检查。主 `tsconfig.json` 只 include `src/`，
 *    测试里的类型错误只会在运行期炸；这条门禁是 V1.6 B1 建的那道墙。
 *
 * 刻意**不提供跳过开关**（`--no-verify` 是 git 自带的，那是使用者的权利，
 * 不该由钩子再开一个更隐蔽的口子）。慢一点，但提交进来的东西是干净的。
 */
import { spawnSync } from 'node:child_process'

const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

/** 要跑的门禁：顺序即优先级（`tokens:check` 必须最先） */
const GATES = [
  { script: 'tokens:check', why: '生成物与 tokens.ts 漂移（改色请走 tokens.ts → npm run tokens:build）' },
  { script: 'typecheck:test', why: 'tests/ 类型错误（主配置不 include tests/，只有这道门禁能抓）' },
]

function run(script) {
  const startedAt = Date.now()
  const result = spawnSync(NPM, ['run', script], {
    stdio: 'inherit',
    // Windows 上 `npm` 是 `.cmd`，Node 18+ 直接 spawn 会 EINVAL，必须借 shell
    shell: IS_WIN,
  })
  return { ok: result.status === 0, ms: Date.now() - startedAt, error: result.error }
}

const failed = []
for (const [i, gate] of GATES.entries()) {
  console.log(`\n[pre-commit ${i + 1}/${GATES.length}] ${gate.script}`)
  const { ok, ms, error } = run(gate.script)
  if (ok) {
    console.log(`[pre-commit] ✓ ${gate.script}（${(ms / 1000).toFixed(1)}s）`)
    continue
  }
  const detail = error ? `\n  进程启动失败：${error.message}` : ''
  failed.push({ ...gate, detail })
  // 第一条失败就停：后面的门禁在这条红着时基本也会红，堆一屏噪音只会让人直接 --no-verify
  break
}

if (failed.length > 0) {
  console.error('\n✗ 提交被拦下了：\n')
  for (const f of failed) {
    console.error(`  · npm run ${f.script} 未通过`)
    console.error(`    它守的是：${f.why}${f.detail}`)
  }
  console.error('\n  修完之后直接重新提交即可（改动仍暂存着，不用重新 add）。')
  console.error('  如果确认是门禁本身错了，请先修门禁 —— 不要习惯性 --no-verify。\n')
  process.exit(1)
}

console.log('\n[pre-commit] ✓ 全部门禁通过\n')
