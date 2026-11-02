/**
 * content/version.ts —— 题库版本号比较（纯函数，无时钟无 IO）
 *
 * 为什么不用现成的 semver 库：题库版本只在「目录 vs 本地 manifest.version」
 * 之间比较，规则只需要"数字段逐段比"。引一个依赖换来的是供应链与包体积，
 * 不值得。规则刻意从宽：
 *   - `v` 前缀剥掉（作者手滑写成 v1.1.0 也能比）；
 *   - 段数不齐按 0 补齐（1.0 == 1.0.0）；
 *   - 非数字段整串按 0.0.0 处理（宁可提示"可更新"，也别静默判"最新"）。
 */

/** 把任意脏输入收敛成可比较的版本串；不可解析一律 0.0.0（视为"没装过新版本"） */
export function normalizeVersion(v: unknown): string {
  const s = String(v ?? '')
    .trim()
    .replace(/^v/i, '')
  return /^\d+(\.\d+){0,3}$/.test(s) ? s : '0.0.0'
}

/** a 大于 b → 正数；相等 → 0；小于 → 负数 */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.').map(Number)
  const pb = normalizeVersion(b).split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}
