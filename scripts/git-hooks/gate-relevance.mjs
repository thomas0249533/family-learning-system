#!/usr/bin/env node
/**
 * pre-commit 门禁的「暂存相关性」判定（V1.10 · Stage E · E0）
 *
 * 纯数据 + 纯函数、零依赖。单独一个文件是为了能被
 * `tests/precommit-gates.test.ts` 直接 import —— `pre-commit.mjs` 一被 import
 * 就会真去跑门禁，没法单测，所以「该跑哪些」的逻辑必须落在这里。
 *
 * ## 判据用「否命题」，不维护「无关目录白名单」
 * 每道门禁只登记**能让它变红的暂存路径**；不在登记范围内的一律跳过。
 * 新增门禁、或拿不准的路径，请往 `relevant` 里加，不要发明「无关目录」清单 ——
 * 这个文件的默认方向是「多跑」：漏跑一门禁的代价远大于多跑一分钟。
 *
 * ## 路径格式
 * 仓库相对路径、正斜杠（`git diff --cached --name-only -z` 的输出格式）。
 */

/**
 * @typedef {object} Gate
 * @property {string} script                     npm script 名
 * @property {string} why                        这门禁守的是什么（失败时打印）
 * @property {string} triggers                   人类可读的触发器（跳过时打印，让人知道什么才会跑它）
 * @property {(files: readonly string[]) => boolean} relevant 暂存清单是否能触发它
 */

/** @type {Gate[]} 顺序即优先级（tokens:check 必须最先：后面的门禁会自愈脏值） */
export const GATES = [
  {
    script: 'tokens:check',
    why: '生成物（theme.scss / palette.ts）与唯一手写色源 tokens.ts 的漂移检测；必须最先跑，后面的门禁（pretest 的 tokens:build）会自愈脏值，跑晚了就掩盖漂移',
    triggers: 'src/core/styles/ 下的改动（tokens.ts 与两个生成物都在那）',
    // scripts/tokens/check.ts:19-20 比对的就是这三个文件；
    // 改 src 下任何其他文件都不可能让它变红
    relevant: (files) => files.some((f) => f.startsWith('src/core/styles/')),
  },
  {
    script: 'typecheck:test',
    why: 'tests/ 与 src/ 的类型错误（主 tsconfig 不 include tests/，只有这道门禁能抓测试侧）',
    triggers: 'src/、tests/、package.json、tsconfig*.json 的改动',
    // tsconfig.test.json 的 include = src/** + tests/**/*.ts；
    // package.json（换依赖会改类型面）与 tsconfig（改 include/编译选项）也算相关
    relevant: (files) =>
      files.some(
        (f) =>
          f.startsWith('src/') ||
          f.startsWith('tests/') ||
          f === 'package.json' ||
          /^tsconfig(\.[^/]+)?\.json$/.test(f),
      ),
  },
]

/**
 * 按暂存文件清单挑出本次要跑的门禁。
 *
 * @param {readonly string[] | null | undefined} stagedFiles 暂存文件（仓库相对路径、正斜杠）
 * @returns {{ run: Gate[], skipped: Gate[] }} 保序；两者互补
 */
export function selectGates(stagedFiles) {
  const files = Array.isArray(stagedFiles) ? stagedFiles : []
  /** @type {Gate[]} */ const run = []
  /** @type {Gate[]} */ const skipped = []
  for (const gate of GATES) {
    if (gate.relevant(files)) run.push(gate)
    else skipped.push(gate)
  }
  return { run, skipped }
}
