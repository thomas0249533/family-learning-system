/**
 * 填空题判分内核（纯函数 · 可单测）
 *
 * ## 为什么从 SFC 里抽出来
 *
 * 判分逻辑原本以 module-private 函数的形式埋在 `src/modules/core/QuizEngine.vue`
 * 的 `<script setup>` 里（`normalizeBlank` / `stripParentheses` / `gradeBlank`）。
 * 本机 `vitest.config.ts` 是 `environment: 'node'` 且没有 `@vue/test-utils` / jsdom，
 * **SFC 内部函数根本测不到** —— 于是 1340 道填空题的判分长期是 0 条单测。
 * `@core/quiz/judge.ts` 已用同一手法把判断题内核搬出来并写明了这条约束
 * （见其文件头），本文件沿用该先例（另有 `@core/review/fsrs.ts`、
 * `@core/mistake/mistakeRules.ts`）。
 *
 * 本次抽取是**纯重构：行为零变化**。三个函数的实现逐字来自 QuizEngine.vue，
 * 逻辑一个字符都没有改动（包括 `u.length >= 1` / `c.length >= 2` 这些魔数）。
 * 回归由 `tests/blank-grading.test.ts` 锁死。
 *
 * ## `normalizeBlank` 里删空格的语义（改动前务必读懂）
 *
 * 归一化链的最后一步是 `.replace(/\s+/g, '')` —— **空格被视为无意义字符**：
 * `When is` ≡ `Whenis` ≡ `When  is`。这不是笔误：题库里 188 条含空格的字符串答案中，
 * 有 38 条是不含任何分隔符的**短语单答案**（`When is`、`What sports`、`on weekends`、
 * `next to`、`across from`、`brush teeth`、`There are`），题干一律写着「每空一词」，
 * 空格是视觉上的空位提示而非答案分隔。若把空格改判为分隔符，这 38 条会全部判错。
 *
 * ## 多空比对是**序列**语义，不是集合语义
 *
 * `content/chinese-4-up-rjb/special-chinese-4-up-reading.json` 的 `read-ex-003`
 * 题干明写「按顺序填写，用逗号隔开」，answer 是 6 段。所以比对必须位置敏感
 * （`every((u, i) => ...)`），**绝不能改成集合比对** —— 顺序错就是错。
 *
 * ## 纯数字答案是最大的一类
 *
 * 1340 条里 890 条（66%）是纯数字：应用题约定「单位写题干、answer 只填数字」。
 * 这类题的任何宽容度扩展都不能让 `10 000` 通过 `10000` 的判分。
 */

/**
 * 归一化填空答案：大小写、全半角标点、全角空格。
 *
 * 逐项作用（顺序即语义）：
 * 1. `trim()` + 转小写；
 * 2. `，` `；` `;` → `,`（三种分隔符统一）；
 * 3. `：` → `:`；
 * 4. 全角括号 `（）` → 半角 `()`；
 * 5. `、` → `,`（顿号也是分隔符）；
 * 6. 全角空格 `\u3000` → 半角空格；
 * 7. `\s+` 整体删除 —— **空格无意义**，见文件头说明。
 *
 * @param text 任意输入，内部 `String(text ?? '')` 降级（兼容 `null` / `undefined` / 数组）
 * @returns 归一化后的字符串；输入为空时返回 `''`
 */
export function normalizeBlank(text: unknown): string {
  return String(text ?? '')
    .trim().toLowerCase()
    .replace(/，/g, ',').replace(/；/g, ',').replace(/;/g, ',')  // ✅ 分号统一成逗号
    .replace(/：/g, ':')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/、/g, ',')
    .replace(/\u3000/g, ' ').replace(/\s+/g, '')
}

/**
 * 去掉成对括号及其内容（半角 / 全角各一遍）。
 *
 * 用于「答案写了但不要求必须写」的补充说明，如 `省(直辖市)` 允许只答 `省`。
 * 注意：不做嵌套处理，是非贪婪单层剥离 —— 与抽取前的旧实现完全一致。
 *
 * @param text 任意输入，内部 `String(text ?? '')` 降级
 * @returns 剥离括号片段后的字符串（原地删除，不补空格）
 */
export function stripParentheses(text: unknown): string {
  return String(text ?? '')
    .replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '')
}

/**
 * 填空题判分：完全一致 → 括号容错 → 多空按位置逐段比对。
 *
 * 语义要点（每一条都对应真实题库数据，改动前请先看文件头）：
 * - **空用户答案一律 false**；正确答案为空时也会落到末尾 `return false`；
 * - **位置敏感**：`甲,乙` 对 `乙,甲` 必须 false；
 * - **全或无**：6 段答对 5 段 → false。刻意不做部分给分 —— `AnswerPayload.isCorrect`
 *   是 boolean，直接驱动 BKT 概率、FSRS 排期、掌握四态、错题三级、成就打卡，
 *   改成分数要穿透五层内核，收益远小于风险（同 `@core/quiz/judge.ts` 的取舍）；
 * - **单空分支不做子串容错**：只有段数 > 1 且段数相等时才进入容错阶梯。
 *
 * @param userAnswer 用户原始输入（允许数组：`String()` 会隐式 join 成 `"a,b"`，
 *   这正是 35 条数组答案的多空题能工作的隐式机制，不要动它）
 * @param correctAnswer 正确答案（同上）
 */
export function gradeBlank(userAnswer: unknown, correctAnswer: unknown): boolean {
  const ua = normalizeBlank(userAnswer)
  const ca = normalizeBlank(correctAnswer)
  if (!ua) return false

  // 1. 完全一致
  if (ua === ca) return true

  // 2. 去括号后一致
  const uaNoP = stripParentheses(ua)
  const caNoP = stripParentheses(ca)
  if (uaNoP === caNoP) return true

  // 3. 多空比对（分号已统一成逗号）
  const uaParts = ua.split(',').map(s => s.trim()).filter(Boolean)
  const caParts = ca.split(',').map(s => s.trim()).filter(Boolean)

  if (uaParts.length > 1 && uaParts.length === caParts.length) {
    return uaParts.every((u, i) => {
      const c = caParts[i]
      if (u === c) return true
      const cNoP = stripParentheses(c)
      if (u === cNoP) return true
      // 用户答案是完全答案的子串（如 "省" vs "省(直辖市)"）
      if (c.includes(u) && u.length >= 1) return true
      // ✅ 反向：完全答案是用户答案的子串（如 "does" vs "does not"）
      if (u.includes(c) && c.length >= 2) return true
      return false
    })
  }

  return false
}
