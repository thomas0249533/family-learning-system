#!/usr/bin/env node
/**
 * pre-commit 门禁（V1.6 · Stage B · B1 → V1.10 · Stage E · E0 暂存相关性裁剪）
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
 * ## V1.10 · E0：暂存相关性裁剪（2026-10-22）
 * 原实现无视暂存内容，每次提交固定 ~64s（实测 tokens:check 12.2s +
 * typecheck:test 51.6s）。而本仓八成提交是 docs/memory/截图这类**结构上不可能
 * 触发门禁**的改动 —— Stage 收尾时尤其密集（日志 + 基线图 + 版本号 bump）。
 *
 * 规则在 `gate-relevance.mjs`（纯函数、有单测 `tests/precommit-gates.test.ts`）：
 * 每道门禁只登记「能让它变红的暂存路径」，不在登记范围内 → 跳过，并逐条打印
 * 跳过理由与触发器。**方向是「拿不准就多跑」**：docs/** 与图片之外的一切照旧
 * 全量跑；连暂存清单都读不到时也按全量跑（漏跑一门禁的代价远大于多跑 64s）。
 *
 * 配套提速：`tsconfig.test.json` 开了 incremental（tsBuildInfoFile 落在
 * `node_modules/.cache/`，已被 gitignore）—— 热跑 24s vs 冷跑 52s。
 *
 * 刻意**不提供跳过开关**（`--no-verify` 是 git 自带的，那是使用者的权利，
 * 不该由钩子再开一个更隐蔽的口子）。慢一点，但提交进来的东西是干净的。
 */
import { spawnSync, execFileSync } from 'node:child_process'
import { GATES, selectGates } from './gate-relevance.mjs'

const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

/**
 * 读暂存文件清单（仓库相对路径、正斜杠）。
 * ACM = 新增/复制/修改；**删除不参与门禁**（少一个文件不会让检查变红）。
 * 返回 null 表示读不到 —— 调用方必须按「全量跑」处理，绝不按「全跳」处理。
 */
function readStagedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], {
      encoding: 'utf8',
    })
    return out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/'))
  } catch {
    return null
  }
}

function run(script) {
  const startedAt = Date.now()
  const result = spawnSync(NPM, ['run', script], {
    stdio: 'inherit',
    // Windows 上 `npm` 是 `.cmd`，Node 18+ 直接 spawn 会 EINVAL，必须借 shell
    shell: IS_WIN,
  })
  return { ok: result.status === 0, ms: Date.now() - startedAt, error: result.error }
}

// ---- 决定这次跑哪些门禁 ----------------------------------------------------
const staged = readStagedFiles()
let toRun
if (staged === null) {
  console.log('[pre-commit] ⚠ 读不到暂存清单（git diff --cached 失败）→ 按全量跑，不猜')
  toRun = GATES
} else {
  const plan = selectGates(staged)
  toRun = plan.run
  console.log(`[pre-commit] 暂存 ${staged.length} 个文件`)
  for (const gate of plan.run) {
    console.log(`[pre-commit] ○ 要跑 ${gate.script}（${gate.why}）`)
  }
  for (const gate of plan.skipped) {
    console.log(`[pre-commit] － 跳过 ${gate.script}（触发器：${gate.triggers}）`)
  }
}

if (toRun.length === 0) {
  console.log('\n[pre-commit] ✓ 本次改动与全部门禁无关，无需检查\n')
  process.exit(0)
}

// ---- 跑 --------------------------------------------------------------------
const failed = []
for (const [i, gate] of toRun.entries()) {
  console.log(`\n[pre-commit ${i + 1}/${toRun.length}] ${gate.script}`)
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
