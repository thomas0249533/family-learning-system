// =====================================================================
// 字面量色守卫 · 单一源（tests 侧）
// ---------------------------------------------------------------------
// 为什么独立成文件：`tests/ui-primitives.test.ts` 与
// `tests/tokens-generation.test.ts` 都要检测「声明值里是否有字面量色」。
// 两处各写一份正则 = 第二套真相 → 一处修了另一处没修就会产生隐蔽漏洞
// （真实事故：`\b` 版 NAMED 正则被 `.app-badge { white-space: nowrap }`
//   误报；修了 ui-primitives 却漏了 tokens-generation）。
//
// 口径（与 scripts/check-hex.mjs 对齐，本文件为 tests 侧唯一镜像）：
//   · HEX：`#rgb` ~ `#rrggbbaa`
//   · RGB/HSL：`rgb(a)(` / `hsl(a)(` 后紧跟数字（`rgba(var(--x), a)` 是
//     合法引用，`(` 后是 `var` 非数字 → 放行）
//   · 命名色：`white|black|red|…`，用 lookaround `(?<![\w-])…(?![\w-])`
//     排除 CSS 标识符中的同形词（`white-space` / `grid-row` 不误报）
//   · **豁免**：整段「纯黑阴影」`rgba(0, 0, 0, <alpha>)` —— 与
//     check-hex.mjs 的 BLACK_RGBA 同义（阴影约定）。剔除范围**仅 alpha
//     片段**，故同行另外夹带的真值色仍会被抓。
// =====================================================================

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` */
export const HEX_RE = /#([0-9a-fA-F]{3,8})\b/

/** `rgb(` / `rgba(` 后紧跟数字（`rgba(var(...))` 不匹配） */
export const RGB_RE = /rgba?\(\s*\d/i

/** `hsl(` / `hsla(` 后紧跟数字 */
export const HSL_RE = /hsla?\(\s*\d/i

/**
 * 命名色。**必须用 lookaround 而非 `\b`**：
 * `\bwhite\b` 会把 `white-space: nowrap` 判成白色（`-` 是非词字符 → 有边界）。
 */
export const NAMED_RE =
  /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold|navy|teal|olive|maroon|lime|aqua|fuchsia|cyan|magenta)(?![\w-])/i

/** 纯黑阴影整段（与 scripts/check-hex.mjs 的 BLACK_RGBA 同义）；仅吃 alpha 片段 */
export const BLACK_RGBA_RE = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+%?\s*\)/gi

export type LiteralColorKind = 'hex' | 'rgb' | 'hsl' | 'named'

/**
 * 在给定 CSS 文本（整文件或单个声明值）中查找字面量色。
 *
 * @param cssText 待检测文本；可以是整段 CSS，也可以是单个 `--x: value` 的 value。
 * @returns 命中的类别列表（去重后按 hex→rgb→hsl→named 顺序），空数组 = 合规。
 */
export function findLiteralColors(cssText: string): LiteralColorKind[] {
  // 先剔除合法的纯黑阴影片段，再扫剩余文本（避免「整行跳过」式绕过）
  const scanned = cssText.replace(BLACK_RGBA_RE, '')
  const hits: LiteralColorKind[] = []
  if (HEX_RE.test(scanned)) hits.push('hex')
  if (RGB_RE.test(scanned)) hits.push('rgb')
  if (HSL_RE.test(scanned)) hits.push('hsl')
  if (NAMED_RE.test(scanned)) hits.push('named')
  return hits
}
