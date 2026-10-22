/**
 * `scripts/git-hooks/gate-relevance.mjs` 的类型声明（V1.10 · Stage E · E0）
 *
 * 为什么需要它：主 `tsconfig.json` 没有 `allowJs`，`tests/precommit-gates.test.ts`
 * （.ts）import 这个 .mjs 时，没有声明文件会在 `strict` 下报 TS7016。
 * vitest 跑的时候读的是 .mjs 本体，这个文件只服务于 vue-tsc。
 */

export interface Gate {
  /** npm script 名（钩子按 `npm run <script>` 调起） */
  readonly script: string
  /** 这门禁守的是什么（失败时打印给提交者） */
  readonly why: string
  /** 人类可读的触发器（跳过时打印，让人知道什么改动才会跑它） */
  readonly triggers: string
  /** 给定暂存文件清单，判断这门禁是否可能被本次改动触发 */
  readonly relevant: (files: readonly string[]) => boolean
}

/** 门禁表。顺序即优先级（tokens:check 必须最先） */
export declare const GATES: readonly Gate[]

/**
 * 按暂存文件清单挑出本次要跑的门禁。
 *
 * @param stagedFiles 暂存文件（仓库相对路径、正斜杠）；nullish 时按「都不相关」处理
 * @returns `{ run, skipped }`，保序且互补
 */
export declare function selectGates(
  stagedFiles: readonly string[] | null | undefined,
): { run: Gate[]; skipped: Gate[] }
