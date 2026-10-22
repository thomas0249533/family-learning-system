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
 * 回归由 `tests/blank-grading.test.ts` 锁死。抽取之后才在此之上新增了
 * 「空格第二通道」（见 `gradeBlank` 的说明）—— 严格路径作为第一段原样保留，
 * 只有它未命中时才启用新通道，因此既有行为仍然 100% 不变。
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
 * ## ⚠️ 已知且**有意**的宽松点（不要当 bug 修）
 *
 * 第 7 步删除所有空格 ⇒ `10 000` 与 `10000` 判等、`Ch i nese` 与 `Chinese` 判等、
 * `Whenis` 与 `When is` 判等。这是**有意设计**，不是笔误：题库里 38 条「每空一词」
 * 的短语答案（`When is` / `on weekends` / `next to` …）依赖「空格不敏感」这个语义，
 * 学生把空格漏写或多写都必须判对。
 *
 * 代价是纯数字题天然接受被空格切开的写法。**这是接受的取舍**：`10 000` 本身也确实
 * 等于 `10000`，没有语义错误。若要收紧（例如把「原始输入含空格且原始答案不含空格」
 * 判为错），必须**同时改题库**里那 38 条短语答案的约定，否则会一次性判错 38 道题。
 * 单改判分一侧是不可能的 —— 两者共用同一条 `\s+` 删除机制。
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
 * 单段比对的容错阶梯 —— 严格路径与第二通道**共用同一份规则**（不要复制粘贴）。
 *
 * 阶梯顺序与硬编码阈值都是既有语义，**不要调整**：
 * - `u === c`：完全一致；
 * - `u === cNoP`：用户答案等于正确答案去括号后的形态；
 * - `c.includes(u) && u.length >= 1`：用户答案是完全答案的子串
 *   （如 `京` vs `南京`）。`u.length >= 1` 在 u 非空时恒真，是旧实现的原样保留；
 * - `u.includes(c) && c.length >= 2`：反向子串容错（如 `does not` vs `does`）。
 *   `c.length >= 2` 是硬性下限，否则单字符正确答案会匹配任意包含它的长输入。
 *
 * @param u 用户答案的一段（调用方保证已 `normalizeBlank` 且非空）
 * @param c 正确答案对应位置的一段（同上）
 */
function partsMatch(u: string, c: string): boolean {
  if (u === c) return true
  const cNoP = stripParentheses(c)
  if (u === cNoP) return true
  // 用户答案是完全答案的子串（如 "省" vs "省(直辖市)"）
  if (c.includes(u) && u.length >= 1) return true
  // ✅ 反向：完全答案是用户答案的子串（如 "does" vs "does not"）
  if (u.includes(c) && c.length >= 2) return true
  return false
}

/** 按 `,` 切段（归一化后所有分隔符都已是 `,`），丢掉空段 */
function splitCommaParts(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * 第二通道的分隔符集：半/全角空格、半/全角逗号、顿号、半/全角分号。
 * 与 `normalizeBlank` 认可的写法的超集 —— 但作用在**原始输入**上，
 * 因为第二通道必须在空格被删掉之前切分。
 */
const SECOND_CHANNEL_DELIM_RE = /[\s\u3000,，、;；]+/

/** 原始输入里是否**确实**含至少一个分隔符（第二通道前置条件 b） */
const HAS_DELIM_RE = /[\s\u3000,，、;；]/

/** 原始正确答案里是否含空格（第二通道前置条件 a 的反面） */
const HAS_SPACE_RE = /\s|\u3000/

/**
 * 严格路径：既有判分语义，**一个字符都没改**（Commit 1 的原样实现）。
 *
 * 入参是已 `normalizeBlank` 的字符串。语义要点：
 * - 空用户答案 false；
 * - 位置敏感：`甲,乙` 对 `乙,甲` 必须 false；
 * - 全或无：6 段答对 5 段 → false；
 * - 单空分支不做子串容错（只有段数 > 1 且相等才进容错阶梯）。
 *
 * @param ua 归一化后的用户答案
 * @param ca 归一化后的正确答案
 */
function gradeBlankStrict(ua: string, ca: string): boolean {
  if (!ua) return false

  // 1. 完全一致
  if (ua === ca) return true

  // 2. 去括号后一致
  const uaNoP = stripParentheses(ua)
  const caNoP = stripParentheses(ca)
  if (uaNoP === caNoP) return true

  // 3. 多空比对（分号已统一成逗号）
  const uaParts = splitCommaParts(ua)
  const caParts = splitCommaParts(ca)

  if (uaParts.length > 1 && uaParts.length === caParts.length) {
    return uaParts.every((u, i) => partsMatch(u, caParts[i]))
  }

  return false
}

/**
 * 第二通道：**用空格/标点当分隔符**切段后按位置比对。
 *
 * ## 为什么需要它
 *
 * 多空题的标准写法是逗号分隔（`read-ex-003` 题干明写「用逗号隔开」），但学生
 * 更自然的输入是空格：`排比 比喻`。严格路径会把空格删掉 → `排比比喻` ≠ `排比,比喻`
 * → 判错。第二通道把空格也当分隔符，救回这一类。
 *
 * ## 三个前置条件（缺一不可，顺序即安全边界）
 *
 * - **a. 原始正确答案不含空格**。这一条是硬边界：题库里 38 条「每空一词」的短语
 *   单答案（`When is` / `on weekends` / `next to` …）答案**本身含空格**，一旦允许
 *   空格切分，`When is` 会被切成 2 段而正确答案只有 1 段 → 这类题全部判错。
 *   有这条前置，`When is` 永远进不来第二通道。
 * - **b. 原始用户输入确实含分隔符**。否则 `排比比喻`（连写）→ 单段 → 段数不等判错，
 *   行为不变。注意这条也保证「用户什么都没改」时不会走进来。
 * - **c. 严格路径没命中**（由 `gradeBlank` 的调用顺序保证）。
 *
 * ## 与严格路径的一致性
 *
 * 段数必须相等、**按位置**比对、复用 `partsMatch` 容错阶梯 —— 所以顺序颠倒仍然
 * false，全或无仍然成立。第二通道只放宽「分隔符种类」，不放宽「段数与顺序」。
 *
 * @param userAnswer 用户**原始**输入（未归一化，要在空格被删前切分）
 * @param correctAnswer **原始**正确答案
 */
function gradeBlankSpaced(userAnswer: unknown, correctAnswer: unknown): boolean {
  const rawCorrect = String(correctAnswer ?? '')
  // 前置 a：正确答案自带空格 → 空格在它里面是答案的一部分，不是分隔符
  if (HAS_SPACE_RE.test(rawCorrect)) return false

  const rawUser = String(userAnswer ?? '')
  // 前置 b：用户没写任何分隔符 → 没有第二通道能做而严格路径做不到的事
  if (!HAS_DELIM_RE.test(rawUser)) return false

  // 两侧都按同一组分隔符切段，再逐段归一化（丢弃空段：多打一个空格/逗号不该判错）
  const uaParts = splitSecondChannelParts(rawUser)
  const caParts = splitSecondChannelParts(rawCorrect)

  if (uaParts.length === 0) return false
  if (uaParts.length !== caParts.length) return false
  return uaParts.every((u, i) => partsMatch(u, caParts[i]))
}

/** 第二通道专用切段：按分隔符集切 → 逐段 `normalizeBlank` → 丢空段 */
function splitSecondChannelParts(raw: string): string[] {
  return raw
    .split(SECOND_CHANNEL_DELIM_RE)
    .map((s) => normalizeBlank(s))
    .filter(Boolean)
}

/**
 * 备选答案的斜杠：**两侧必须有空白**（`aren't / are not`）。
 *
 * 这个约束是硬性的，不是凑巧：题库里有 `85 千米/时，8` 这类「单位答案」，
 * `千米/时` 的斜杠两侧没有空白 —— 若把任意 `/` 都当备选分隔符，单位会被切成两截，
 * 这道题当场判错。`tests/blank-grading.test.ts` 有专门一条钉死这一点。
 */
const SLASH_ALT_RE = /\s+\/\s+/

/**
 * 备选路径的**段**分隔符：只认标点，**不认空格**。
 *
 * 与 `SECOND_CHANNEL_DELIM_RE` 的关键差异就在「不认空格」：备选答案本身是短语
 * （`are not`、`come from`），把空格当段分隔符会把 `are` / `not` 拆成两个空位，
 * 段数立刻对不上。空格在备选路径里是**答案文本的一部分**。
 */
const ALT_SEGMENT_SPLIT_RE = /[,，、;；]+/

/**
 * 数组答案路径 A 的用户侧分段：**连顿号也不切**。
 *
 * 数组元素的内部标点（`["全面、客观","全貌"]` 里的顿号）是答案文本，不是空位分隔符；
 * 若按顿号切，`全面、客观,全貌` 会被读成 3 段，而数组只有 2 个元素 → 判错。
 * 所以路径 A 的用户侧只按逗号/分号切，好让「元素内顿号」保持完整。
 */
const ARRAY_A_USER_SPLIT_RE = /[,，;；]+/

/** 把原始串按给定分隔符切成段并逐段归一化（丢弃空段） */
function splitByPattern(raw: string, re: RegExp): string[] {
  return raw
    .split(re)
    .map((s) => normalizeBlank(s))
    .filter(Boolean)
}

/**
 * 段内备选列表：`"aren't / are not"` → `["aren't", "arenot"]`。
 * 没有斜杠时返回单元素数组（即该段只有一种写法）。
 */
function alternativesOf(rawSegment: string): string[] {
  const alts = splitByPattern(rawSegment, SLASH_ALT_RE)
  return alts.length > 0 ? alts : []
}

/**
 * 备选匹配：**精确匹配**，不走 `partsMatch` 的子串阶梯。
 *
 * 这里是刻意与多空路径不同的一处：`partsMatch` 允许「用户答案是正确答案的子串」
 * （`c.includes(u)`），放到备选列表上会被放大 —— 学生只写 `aren` 就会命中备选
 * `aren't`，把明显的错答判成对。备选列表的每个元素本身就是**完整答案**，
 * 没有「省」vs「省(直辖市)」那种省略约定，所以只接受归一化后完全相等
 * （外加剥括号后的相等，与严格路径的第 2 步保持一致）。
 *
 * @param u 用户答案的一段（已归一化）
 * @param alt 某个备选（已归一化）
 */
function altMatches(u: string, alt: string): boolean {
  if (u === alt) return true
  if (u === stripParentheses(alt)) return true
  return false
}

/**
 * 备选答案路径：`aren't / are not` 允许只写 `aren't` 或 `are not`。
 *
 * ## 为什么需要它
 *
 * 英语语法题常把同义写法并列进答案（`aren't / are not`）。旧实现里 `/` 既不是
 * 分隔符也没被特殊处理，归一化后变成 `aren't/arenot` —— 学生写**任何一个正确的**
 * 写法都判错，只有原样全写才对。这是「正确答案被判错」，必须修。
 *
 * ## 顺序要求（反过来会把多空结构拆坏）
 *
 * 1. **先按标点切段**（`[,，、;；]+`）→ 保持既有「多空」段数组不变；
 * 2. **再在每段内部**按 `\s+\/\s+` 切备选 —— 只切「斜杠两侧有空白」的；
 * 3. 该段命中 = 任一备选精确匹配；
 * 4. 段数仍必须相等，仍全或无。
 *
 * 若反过来先切斜杠，`make friends; be from / come from; …` 里的段边界会被打乱。
 *
 * ## 纯增量
 *
 * 第一行就是护栏：**原始正确答案里没有 `\s+\/\s+` 就直接 false**，绝大多数题目
 * 根本进不来这条路。全库扫描（18981 对 old-vs-new）确认「旧 true → 新 false = 0」。
 *
 * @param userAnswer 用户**原始**输入（要在空格被删前切段）
 * @param correctAnswer **原始**正确答案
 */
function gradeBlankAlternatives(userAnswer: unknown, correctAnswer: unknown): boolean {
  const rawCorrect = String(correctAnswer ?? '')

  // 纯增量护栏：没有「斜杠备选」这种写法就走人（`85 千米/时` 因此永远进不来）
  if (!SLASH_ALT_RE.test(rawCorrect)) return false

  const rawUser = String(userAnswer ?? '')
  const uaSegs = splitByPattern(rawUser, ALT_SEGMENT_SPLIT_RE)
  const caSegs = rawCorrect.split(ALT_SEGMENT_SPLIT_RE).filter((s) => s.trim() !== '')

  if (uaSegs.length === 0) return false
  if (uaSegs.length !== caSegs.length) return false

  return uaSegs.every((u, i) => {
    const alts = alternativesOf(caSegs[i])
    return alts.length > 0 && alts.some((alt) => altMatches(u, alt))
  })
}

/**
 * 数组答案路径：按**元素边界**切段，元素内部不再二次切分。
 *
 * ## 修的缺陷
 *
 * `QuizEngine` 传给判分的是 `q.answer`。数组答案（如 `["全面、客观","全貌"]`）过去被
 * `String()` 隐式 join 成 `"全面、客观,全貌"`，归一化把顿号也变成逗号 → 切成 **3 段**，
 * 而题干只有 **2 个空** → 学生写对也判错。
 *
 * ## 两条路，任一命中即 true
 *
 * - **A（新，语义正确）**：每个数组元素归一化后就是一段，元素内的 `，；、` 属于
 *   答案文本。用户侧同样只按逗号/分号切（见 `ARRAY_A_USER_SPLIT_RE`）。
 * - **B（现状，兼容保留）**：数组 join 成 `"a,b"` 后按分隔符切 — 与抽取前的行为
 *   完全一致。**不要删**：已有学生习惯按膨胀后的段数用逗号对齐作答，删掉 B 会让
 *   这些原本判对的输入变错。
 *
 * 两条路都要求「段数相等 + 逐段 `partsMatch`」，仍然全或无、仍然位置敏感。
 *
 * @param userAnswer 用户原始输入
 * @param correctAnswer 正确答案；非数组直接返回 false
 */
function gradeBlankArray(userAnswer: unknown, correctAnswer: unknown): boolean {
  if (!Array.isArray(correctAnswer)) return false

  const elements = correctAnswer.map((el) => normalizeBlank(el)).filter(Boolean)
  if (elements.length === 0) return false

  // 路径 A：元素边界即段边界
  const uaPartsA = splitByPattern(String(userAnswer ?? ''), ARRAY_A_USER_SPLIT_RE)
  if (
    uaPartsA.length === elements.length &&
    uaPartsA.every((u, i) => partsMatch(u, elements[i]))
  ) {
    return true
  }

  // 路径 B：join 后按分隔符切（与抽取前完全一致，勿删）
  const uaPartsB = splitCommaParts(normalizeBlank(userAnswer))
  const caPartsB = splitCommaParts(normalizeBlank(correctAnswer))
  if (
    uaPartsB.length > 0 &&
    uaPartsB.length === caPartsB.length &&
    uaPartsB.every((u, i) => partsMatch(u, caPartsB[i]))
  ) {
    return true
  }

  return false
}

/**
 * 填空题判分：**先跑既有严格路径，未命中才依次尝试三条宽容通道**。
 *
 * 顺序即安全边界：每一步都只可能在「前面都判错」时才执行，且每一步都是**纯增量**
 * （只把 false 变 true，绝不把 true 变 false）。因此既有行为 100% 保留
 * （`tests/blank-grading.test.ts` 的回归护栏全部仍然绿）。
 *
 * 1. `gradeBlankStrict` —— 既有语义（完全一致 → 括号容错 → 多空按位置）；
 * 2. `gradeBlankArray` —— 数组答案按元素边界切段（修顿号膨胀段数）；
 * 3. `gradeBlankSpaced` —— 空格/标点都当分隔符（`排比 比喻`）；
 * 4. `gradeBlankAlternatives` —— 斜杠备选答案（`aren't / are not` 只写一个也判对）。
 *
 * 刻意不做部分给分：`AnswerPayload.isCorrect` 是 boolean，直接驱动 BKT 概率、
 * FSRS 排期、掌握四态、错题三级、成就打卡 —— 改成分数要穿透五层内核，
 * 收益远小于风险（同 `@core/quiz/judge.ts` 的取舍）。
 *
 * ## 已知且**有意**的宽松点（不要当 bug 修）
 *
 * `normalizeBlank` 会删掉所有空格，所以 `10 000` 与 `10000` 判等、`Whenis` 与
 * `When is` 判等 —— 同一条 `\s+` 删除机制，不可能只堵前者。38 条「每空一词」的
 * 短语答案依赖它。详见 `normalizeBlank` 的注释。
 *
 * @param userAnswer 用户原始输入（**传原始值**，不要提前 `String()`：数组答案要靠
 *   `Array.isArray` 识别，备选答案要在空格被删前切段）
 * @param correctAnswer 正确答案（**传原始值**，同上）
 */
export function gradeBlank(userAnswer: unknown, correctAnswer: unknown): boolean {
  const ua = normalizeBlank(userAnswer)
  const ca = normalizeBlank(correctAnswer)

  // 1. 既有语义，命中即返回（行为零变化）
  if (gradeBlankStrict(ua, ca)) return true

  // 2. 数组答案：按元素边界切段（修 `["全面、客观","全貌"]` 段数膨胀）
  if (gradeBlankArray(userAnswer, correctAnswer)) return true

  // 3. 空格第二通道（`排比 比喻`）
  if (gradeBlankSpaced(userAnswer, correctAnswer)) return true

  // 4. 斜杠备选（`aren't / are not`）
  return gradeBlankAlternatives(userAnswer, correctAnswer)
}
