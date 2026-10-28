/**
 * 填空题判分回归测试
 *
 * ## 这个文件为什么存在
 *
 * 判分逻辑原本埋在 `src/modules/core/QuizEngine.vue` 的 `<script setup>` 里，
 * vitest 是 `environment: 'node'` 且没有 jsdom / @vue/test-utils → **SFC 内部函数测不到**，
 * 1340 道填空题长期 0 条单测。本文件针对抽出来的纯函数 `@core/quiz/blank`。
 *
 * ## 组织方式
 *
 * 1. `normalizeBlank` / `stripParentheses` 的单元行为；
 * 2. `gradeBlank` 的既有语义（**这一批是回归护栏：任何一条变红都说明判分语义被改了**）；
 * 3. 真实题库数据钉死（字符串直接写进断言，**不** import JSON 全量扫描 ——
 *    那样内容一改测试就跟着漂，护栏就失效了）。
 *
 * 数据来源逐条标注 file + id，便于回溯核对。
 */

import { describe, it, expect } from 'vitest'
import { gradeBlank, normalizeBlank, stripParentheses } from '../src/core/quiz/blank'

describe('normalizeBlank · 归一化', () => {
  it('大小写不敏感 + 首尾空格', () => {
    expect(normalizeBlank('  ABC  ')).toBe('abc')
    expect(normalizeBlank('When Is')).toBe('whenis')
  })

  it('全角/半角逗号、分号、顿号统一成 `,`', () => {
    expect(normalizeBlank('甲，乙')).toBe('甲,乙')
    expect(normalizeBlank('甲；乙')).toBe('甲,乙')
    expect(normalizeBlank('甲;乙')).toBe('甲,乙')
    expect(normalizeBlank('甲、乙')).toBe('甲,乙')
  })

  it('全角冒号 → 半角，全角括号 → 半角', () => {
    expect(normalizeBlank('比例：1')).toBe('比例:1')
    expect(normalizeBlank('（直辖市）')).toBe('(直辖市)')
  })

  it('空格被整体删除 —— 这是既有语义（`When is` ≡ `Whenis`）', () => {
    expect(normalizeBlank('When is')).toBe('whenis')
    expect(normalizeBlank('When  is')).toBe('whenis')
    expect(normalizeBlank('When\tis')).toBe('whenis')
    // 全角空格先转半角再删
    expect(normalizeBlank('When\u3000is')).toBe('whenis')
  })

  it('null / undefined 降级为空串，不抛异常', () => {
    expect(normalizeBlank(null)).toBe('')
    expect(normalizeBlank(undefined)).toBe('')
  })
})

describe('stripParentheses · 括号剥离', () => {
  it('剥半角与全角括号（含内容）', () => {
    expect(stripParentheses('省(直辖市)')).toBe('省')
    expect(stripParentheses('省（直辖市）')).toBe('省')
  })

  it('无括号时原样返回', () => {
    expect(stripParentheses('排比')).toBe('排比')
  })
})

describe('gradeBlank · 既有语义（回归护栏）', () => {
  it('完全一致', () => {
    expect(gradeBlank('排比', '排比')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(gradeBlank('CHINESE', 'Chinese')).toBe(true)
    expect(gradeBlank('chinese', 'Chinese')).toBe(true)
  })

  it('首尾空格不影响', () => {
    expect(gradeBlank('  Chinese  ', 'Chinese')).toBe(true)
  })

  it('标点全半角互换不影响', () => {
    expect(gradeBlank('甲，乙', '甲,乙')).toBe(true)
    expect(gradeBlank('甲；乙', '甲,乙')).toBe(true)
    expect(gradeBlank('甲、乙', '甲,乙')).toBe(true)
    expect(gradeBlank('甲;乙', '甲,乙')).toBe(true)
  })

  it('括号容错：只答主干也判对', () => {
    expect(gradeBlank('省', '省(直辖市)')).toBe(true)
    expect(gradeBlank('省', '省（直辖市）')).toBe(true)
  })

  it('空用户答案一律 false', () => {
    expect(gradeBlank('', '排比')).toBe(false)
    expect(gradeBlank('   ', '排比')).toBe(false)
    expect(gradeBlank(null, '排比')).toBe(false)
    expect(gradeBlank(undefined, '排比')).toBe(false)
  })

  it('正确答案为空时用户答什么都 false', () => {
    expect(gradeBlank('排比', '')).toBe(false)
    expect(gradeBlank('排比', null)).toBe(false)
    expect(gradeBlank('排比', undefined)).toBe(false)
  })

  it('多空序列正确才判对', () => {
    expect(gradeBlank('甲,乙', '甲,乙')).toBe(true)
    expect(gradeBlank('甲、乙', '甲,乙')).toBe(true)
  })

  it('顺序颠倒必须 false —— 序列语义，不是集合语义', () => {
    expect(gradeBlank('乙,甲', '甲,乙')).toBe(false)
  })

  it('段数不等必须 false', () => {
    expect(gradeBlank('甲', '甲,乙')).toBe(false)
    expect(gradeBlank('甲,乙', '甲')).toBe(false)
    expect(gradeBlank('甲,乙,丙', '甲,乙')).toBe(false)
  })

  it('单段答案不做子串容错', () => {
    // 只有段数 > 1 且相等时才进入容错阶梯
    expect(gradeBlank('甲乙', '甲')).toBe(false)
    expect(gradeBlank('甲', '甲乙')).toBe(false)
  })

  it('多余的空段被丢弃，不影响段数比对', () => {
    expect(gradeBlank('甲,,乙', '甲,乙')).toBe(true)
    expect(gradeBlank('甲, ,乙', '甲,乙')).toBe(true)
  })

  it('双向子串容错（仅多空路径）', () => {
    // c.includes(u)：用户答「京」，正确答案「南京」
    expect(gradeBlank('甲,京', '甲,南京')).toBe(true)
    // u.includes(c)：用户答「does not」，正确答案「does」
    expect(gradeBlank('甲,does not', '甲,does')).toBe(true)
  })

  it('全或无：6 段答对 5 段仍然 false', () => {
    const correct = '排比,比喻,裙幅,鸡蛋清,碧玉,碧绿之色'
    // 第 3 段「裙幅」→「裙子」：互不为子串，必然判错
    expect(gradeBlank('排比,比喻,裙子,鸡蛋清,碧玉,碧绿之色', correct)).toBe(false)
  })
})

/**
 * 真实题库数据钉死。
 * 每条都注明了 file / id，改动判分逻辑时这批最先红。
 */
describe('gradeBlank · 真实题库答案（现状语义锁死）', () => {
  it('纯数字应用题：`d45-23-x01` answer `10000`', () => {
    // content/math-4-up-rjb/daily-math-4-up-rjb-45d.json :: d45-23-x01
    // 应用题约定：单位写在题干里，answer 只填数字
    expect(gradeBlank('10000', '10000')).toBe(true)
    // 单段答案不做子串容错，带单位不算对
    expect(gradeBlank('10000千克', '10000')).toBe(false)
  })

  it('短语单答案含空格：`special-ex-095` answer `When is`', () => {
    // content/english-7-up-rjb/special-english-7-up-birthday.json :: special-ex-095
    // 题干「根据答语补全问句，每空一词」→ 空格是空位提示，不是分隔符
    expect(gradeBlank('When is', 'When is')).toBe(true)
    // 既有语义：空格无意义
    expect(gradeBlank('Whenis', 'When is')).toBe(true)
    expect(gradeBlank('When  is', 'When is')).toBe(true)
    // 单段路径无子串容错
    expect(gradeBlank('When is today', 'When is')).toBe(false)
  })

  it('逗号多空 6 段：`read-ex-003`（题干明写「按顺序填写，用逗号隔开」）', () => {
    // content/chinese-4-up-rjb/special-chinese-4-up-reading.json :: read-ex-003
    const correct = '排比,比喻,裙幅,鸡蛋清,碧玉,碧绿之色'
    expect(gradeBlank('排比,比喻,裙幅,鸡蛋清,碧玉,碧绿之色', correct)).toBe(true)
    // 全角逗号 / 顿号写法同样判对
    expect(gradeBlank('排比，比喻，裙幅，鸡蛋清，碧玉，碧绿之色', correct)).toBe(true)
    expect(gradeBlank('排比、比喻、裙幅、鸡蛋清、碧玉、碧绿之色', correct)).toBe(true)
    // 顺序错 → false（这是序列语义存在的唯一理由）
    expect(gradeBlank('比喻,排比,裙幅,鸡蛋清,碧玉,碧绿之色', correct)).toBe(false)
  })

  it('数组答案隐式 join：`u1-ex-005` answer `["顺序","特点"]`', () => {
    // content/chinese-4-up-rjb/unit-chinese-4-up-rjb-u1.json :: u1-ex-005
    // `String(['顺序','特点'])` → `"顺序,特点"`，这正是 35 条数组答案多空题能工作的机制
    expect(gradeBlank('顺序,特点', ['顺序', '特点'])).toBe(true)
    expect(gradeBlank('顺序、特点', ['顺序', '特点'])).toBe(true)
    expect(gradeBlank('特点,顺序', ['顺序', '特点'])).toBe(false)
  })
})

/**
 * 第二通道：空格/标点都当分隔符。
 *
 * 安全边界全部落在「三个前置条件」上，因此这一批用例除了验证放宽的部分，
 * 更要验证**没被放宽的部分**（顺序、段数、短语单答案）。
 */
describe('gradeBlank · 第二通道（空格当分隔符）', () => {
  it('空格分隔的多空答案判对', () => {
    expect(gradeBlank('排比 比喻', '排比,比喻')).toBe(true)
  })

  it('顿号 / 全角逗号 / 半角逗号仍然判对（严格路径已覆盖，回归）', () => {
    expect(gradeBlank('排比、比喻', '排比,比喻')).toBe(true)
    expect(gradeBlank('排比，比喻', '排比,比喻')).toBe(true)
    expect(gradeBlank('排比,比喻', '排比,比喻')).toBe(true)
  })

  it('顺序颠倒仍然 false —— 第二通道不放宽顺序', () => {
    expect(gradeBlank('比喻 排比', '排比,比喻')).toBe(false)
  })

  it('只答对一段仍然 false —— 第二通道不放宽全或无', () => {
    expect(gradeBlank('排比', '排比,比喻')).toBe(false)
    // 单段无分隔符 → 前置 b 不满足，第二通道根本不启用
    expect(gradeBlank('排比比喻', '排比,比喻')).toBe(false)
  })

  it('多空格 / 首尾空格切出的空段被丢弃，不导致段数不等', () => {
    expect(gradeBlank('排比  比喻', '排比,比喻')).toBe(true)
    expect(gradeBlank('  排比 比喻  ', '排比,比喻')).toBe(true)
    expect(gradeBlank('排比 , 比喻', '排比,比喻')).toBe(true)
  })

  it('混合分隔符（逗号 + 空格 + 全角分号）', () => {
    expect(gradeBlank('甲, 乙；丙', '甲,乙,丙')).toBe(true)
    expect(gradeBlank('甲 乙 丙', '甲,乙,丙')).toBe(true)
    expect(gradeBlank('甲；乙；丙', '甲,乙,丙')).toBe(true)
  })

  it('段数不等仍然 false', () => {
    expect(gradeBlank('甲 乙 丙 丁', '甲,乙,丙')).toBe(false)
    expect(gradeBlank('甲 乙', '甲,乙,丙')).toBe(false)
  })

  it('6 段题空格写法判对，但顺序错 / 缺段判错', () => {
    // content/chinese-4-up-rjb/special-chinese-4-up-reading.json :: read-ex-003
    const correct = '排比,比喻,裙幅,鸡蛋清,碧玉,碧绿之色'
    expect(gradeBlank('排比 比喻 裙幅 鸡蛋清 碧玉 碧绿之色', correct)).toBe(true)
    expect(gradeBlank('比喻 排比 裙幅 鸡蛋清 碧玉 碧绿之色', correct)).toBe(false)
    expect(gradeBlank('排比 比喻 裙幅 鸡蛋清 碧玉', correct)).toBe(false)
    // 全或无：第 3 段换成互不为子串的「裙子」
    expect(gradeBlank('排比 比喻 裙子 鸡蛋清 碧玉 碧绿之色', correct)).toBe(false)
  })

  it('数组答案 + 空格写法同样判对', () => {
    // content/chinese-4-up-rjb/unit-chinese-4-up-rjb-u1.json :: u1-ex-005
    expect(gradeBlank('顺序 特点', ['顺序', '特点'])).toBe(true)
    expect(gradeBlank('特点 顺序', ['顺序', '特点'])).toBe(false)
  })

  it('前置 a：正确答案自带空格 → 第二通道永久禁用', () => {
    // content/english-7-up-rjb/special-english-7-up-birthday.json :: special-ex-095
    // 题干「每空一词」→ 空格是空位提示。「When is 其他」必须 false，
    // 若第二通道被误启用，这里会被切成 3 段而答案只 1 段…… 但仍可能误判，
    // 所以真正钉死前置 a 的是下面这条：逗号写到空格短语里必须判错。
    expect(gradeBlank('When is', 'When is')).toBe(true)
    expect(gradeBlank('Whenis', 'When is')).toBe(true) // 现状语义：空格被删除
    expect(gradeBlank('When  is', 'When is')).toBe(true)
    expect(gradeBlank('When is 其他', 'When is')).toBe(false)
    // 正确答案含空格 → 不允许把用户输入的标点当分隔符切开比对
    expect(gradeBlank('When,is', 'When is')).toBe(false)
  })

  it('前置 a：`on weekends` 这类短语单答案行为不变', () => {
    expect(gradeBlank('on weekends', 'on weekends')).toBe(true)
    expect(gradeBlank('onweekends', 'on weekends')).toBe(true) // 现状语义
    expect(gradeBlank('on,weekends', 'on weekends')).toBe(false)
  })

  it('纯数字题不受影响：`d45-23-x01` answer `10000`', () => {
    // content/math-4-up-rjb/daily-math-4-up-rjb-45d.json :: d45-23-x01
    expect(gradeBlank('10000', '10000')).toBe(true)
    // 千分位逗号 → 用户侧 2 段 vs 答案 1 段 → 段数不等 → false
    expect(gradeBlank('10,000', '10000')).toBe(false)
    // ⚠️ 已知且**有意**的宽松点：normalizeBlank 删除所有空格，故 "10 000" 判等。
    // 这与 "Whenis" ≡ "When is" 是同一条机制；38 条「每空一词」的短语答案依赖它。
    // 要收紧必须同时改题库，单改判分做不到 —— 详见 blank.ts 中 normalizeBlank 的注释。
    expect(gradeBlank('10 000', '10000')).toBe(true)
  })
})

/**
 * 斜杠备选答案（`aren't / are not`）。
 *
 * 修的缺陷：`/` 既不是分隔符也没被处理，归一化后成 `aren't/arenot`，
 * 学生写**任何一个正确写法**都判错，只有原样全写才对 —— 正确答案被判错。
 */
describe('gradeBlank · 斜杠备选答案', () => {
  const ALT = "aren't / are not"
  // content/english-7-up-rjb/unit-english-7-up-rjb-p1.json :: u1-ex-029
  // content/english-7-up-rjb/unit-english-7-up-rjb-p3.json :: u3-ex-021

  it('只写第一个备选也判对（旧实现判错）', () => {
    expect(gradeBlank("aren't", ALT)).toBe(true)
  })

  it('只写第二个备选也判对（旧实现判错）', () => {
    expect(gradeBlank('are not', ALT)).toBe(true)
  })

  it('原样全写仍然判对（回归）', () => {
    expect(gradeBlank("aren't / are not", ALT)).toBe(true)
  })

  it('大小写 / 斜杠两侧空格数不影响', () => {
    expect(gradeBlank('ARE NOT', ALT)).toBe(true)
    expect(gradeBlank("aren't   /   are not", ALT)).toBe(true)
  })

  it('半截词不算对 —— 备选匹配是精确匹配，不走子串容错', () => {
    // `"aren't".includes("aren")` 为真，若沿用 partsMatch 的子串阶梯这里会误判
    expect(gradeBlank('aren', ALT)).toBe(false)
    expect(gradeBlank('are', ALT)).toBe(false)
    expect(gradeBlank('not', ALT)).toBe(false)
    expect(gradeBlank('', ALT)).toBe(false)
  })

  it('斜杠两侧没有空白就不是备选 —— 单位 `千米/时` 绝不能被拆开', () => {
    // 题库真实写法：`85 千米/时` 里「千米/时」是一个单位答案
    const unit = '85 千米/时，8'
    expect(gradeBlank('85千米/时,8', unit)).toBe(true)
    expect(gradeBlank('85 千米/时，8', unit)).toBe(true)
    // 若把无空白的 `/` 也当备选分隔符，这个输入会被放宽成对 —— 必须仍然 false
    expect(gradeBlank('85千米,时,8', unit)).toBe(false)
    // 最有判别力的一条：`千米` 精确等于备选切分后的第一段。
    // 只要 `/` 被无条件当备选分隔符，这里就会变 true；有空白约束则保持 false。
    expect(gradeBlank('千米', '千米/时')).toBe(false)
    expect(gradeBlank('时', '千米/时')).toBe(false)
    expect(gradeBlank('千米/时', '千米/时')).toBe(true)
    // 注：`85千米,8` 判 true 是**既有**行为（严格路径 `c.includes(u)` 子串容错允许
    // 「85千米」是「85千米/时」的子串），与斜杠备选无关，本次未改动。
    expect(gradeBlank('85千米,8', unit)).toBe(true)
  })

  it('备选答案仍然遵守多空段数与顺序', () => {
    const twoBlanks = "aren't / are not,are not"
    // 段数不等 → false
    expect(gradeBlank("aren't", twoBlanks)).toBe(false)
    expect(gradeBlank("aren't,arenot,多余", twoBlanks)).toBe(false)
    // 段数相等 → 按位置逐段命中备选
    expect(gradeBlank("aren't, are not", twoBlanks)).toBe(true)
    expect(gradeBlank('are not; are not', twoBlanks)).toBe(true)
    // 第 2 段写了别的 → false（全或无）
    expect(gradeBlank("aren't, is not", twoBlanks)).toBe(false)
  })

  it('没有斜杠的普通答案不受影响（该 false 的仍然 false）', () => {
    expect(gradeBlank('Chinese', 'Chinese')).toBe(true)
    expect(gradeBlank('Chines', 'Chinese')).toBe(false)
    expect(gradeBlank('Japanese', 'Chinese')).toBe(false)
  })
})

/**
 * 数组答案：元素内的标点不该被当成空位分隔符。
 *
 * 修的缺陷：`["全面、客观","全貌"]` 被 `String()` join 成 `"全面、客观,全貌"`，
 * 归一化把顿号也变逗号 → 3 段，而题干只有 2 个空 → 学生写对也判错。
 *
 * 路径 A（元素边界切段）是新增的正确路径，路径 B（join 后按分隔符切）是现状兼容
 * 路径，两条都保留、任一命中即 true —— 删掉 B 会让习惯逗号对齐的学生变错。
 */
describe('gradeBlank · 数组答案按元素边界切段', () => {
  // content/chinese-4-up-rjb/unit-chinese-4-up-rjb-u3.json :: u3-ex-002
  const U3 = ['全面、客观', '全貌']

  it('路径 A：用户写元素内顿号 + 元素间逗号 → true', () => {
    expect(gradeBlank('全面、客观,全貌', U3)).toBe(true)
  })

  it('路径 B：用户写膨胀后的 3 段 → 仍然 true（不回归）', () => {
    expect(gradeBlank('全面,客观,全貌', U3)).toBe(true)
  })

  it('原样答案 → true', () => {
    expect(gradeBlank('全面、客观，全貌', U3)).toBe(true)
  })

  it('元素互换顺序 → false', () => {
    expect(gradeBlank('全貌,全面、客观', U3)).toBe(false)
    expect(gradeBlank('全貌 全面、客观', U3)).toBe(false)
  })

  it('只答一个元素 → false（全或无）', () => {
    expect(gradeBlank('全面、客观', U3)).toBe(false)
    expect(gradeBlank('全貌', U3)).toBe(false)
  })

  it('两元素数组：`["顺序","特点"]`（u1-ex-005）', () => {
    // content/chinese-4-up-rjb/unit-chinese-4-up-rjb-u1.json :: u1-ex-005
    expect(gradeBlank('顺序,特点', ['顺序', '特点'])).toBe(true)
    expect(gradeBlank('顺序 特点', ['顺序', '特点'])).toBe(true)
    expect(gradeBlank('特点,顺序', ['顺序', '特点'])).toBe(false)
    expect(gradeBlank('顺序', ['顺序', '特点'])).toBe(false)
  })

  it('单元素数组 → 等价于单空比对', () => {
    expect(gradeBlank('排比', ['排比'])).toBe(true)
    expect(gradeBlank('比喻', ['排比'])).toBe(false)
    expect(gradeBlank('排比,比喻', ['排比'])).toBe(false)
  })

  it('数组答案不会再被 `String()` 的逗号 join 弄坏段数', () => {
    // 旧路径下 ca 为 3 段，数组只有 2 个元素 —— 路径 A 用元素数做段数基准
    expect(gradeBlank('全面、客观，全貌', U3)).toBe(true)
    // 但段数仍必须对上：3 个元素分成 4 段不给过
    expect(gradeBlank('全面、客观，全貌，多余', U3)).toBe(false)
  })

  it('空数组 / 空输入一律 false', () => {
    expect(gradeBlank('甲', [])).toBe(false)
    expect(gradeBlank('', ['甲'])).toBe(false)
  })
})

/**
 * V2.12.3 · 数字型答案的**单位后缀容错**。
 *
 * 修的缺陷：题库约定「单位写题干、answer 只填数字」，但大量知识点卡题把单位写进了
 * 答案（`360 度` / `1 度` / `100 公顷` / `15174克`），孩子按题干语境填数字反被判错。
 *
 * 护栏两条：① 只影响「数字 + 可选单位」形态，文字答案语义零变化；
 * ② 单位不一致时必须判错（`360 度` ≠ `360 米`）。
 */
describe('gradeBlank · 数字 + 单位后缀容错', () => {
  // content/math-4-up-rjb/special-math-4-up-kaodian.json :: kd4-18-1
  const ZHOUJIAO = '360 度'
  // content/math-4-up-rjb/special-math-4-up-kaodian.json :: kd4-14-3
  const YI_DU = '1 度'
  // content/math-4-up-rjb/special-math-4-up-kaodian.json :: kd4-34-1
  const NEIJIAO = '360 度'
  // content/math-4-up-rjb/special-math-4-up-u3.json :: m4-u3-ex-012
  const KE = '15174克'
  // content/math-4-up-rjb/special-math-4-up-kaodian.json :: kd4-10-1
  const GONGQING = '100 公顷'

  it('答案带单位、孩子只写数字 → 判对', () => {
    expect(gradeBlank('360', ZHOUJIAO)).toBe(true)
    expect(gradeBlank('1', YI_DU)).toBe(true)
    expect(gradeBlank('360', NEIJIAO)).toBe(true)
    expect(gradeBlank('15174', KE)).toBe(true)
    expect(gradeBlank('100', GONGQING)).toBe(true)
  })

  it('答案带单位、孩子也写单位 → 判对（原样）', () => {
    expect(gradeBlank('360度', ZHOUJIAO)).toBe(true)
    expect(gradeBlank('1度', YI_DU)).toBe(true)
    expect(gradeBlank('15174克', KE)).toBe(true)
  })

  it('答案不带单位、孩子多写了单位 → **判错**（反向不放行：既有护栏钉死）', () => {
    // 既有回归护栏：gradeBlank('10000千克', '10000') === false
    // 「15万」蒙对「15」是这条严格规则要挡的事，不能为修一个缺陷推翻它。
    expect(gradeBlank('30度', '30')).toBe(false)
    expect(gradeBlank('10000千克', '10000')).toBe(false)
  })

  it('数值不一致 → 判错', () => {
    expect(gradeBlank('180', ZHOUJIAO)).toBe(false)
    expect(gradeBlank('360.5', ZHOUJIAO)).toBe(false)
  })

  it('单位不一致（两边都带且不同）→ 判错', () => {
    expect(gradeBlank('360米', ZHOUJIAO)).toBe(false)
    expect(gradeBlank('360度', '360米')).toBe(false)
  })

  it('单位不在白名单 → 不做后缀兼容（`85 千米/时` 的斜杠形式）', () => {
    // content/math-4-up-rjb/daily-math-4-up-rjb-45d.json :: d45-26-x01
    expect(gradeBlank('85', '85 千米/时')).toBe(false)
    expect(gradeBlank('85千米/时', '85 千米/时')).toBe(true)
  })

  it('文字型答案完全不受影响（通道只吃数字形态）', () => {
    expect(gradeBlank('排比', '排比')).toBe(true)
    expect(gradeBlank('比喻', '排比')).toBe(false)
    expect(gradeBlank('易变形', '易变形')).toBe(true)
  })

  it('「万」「千」这类数词修饰不是单位 → 不被剥掉', () => {
    expect(gradeBlank('15万', '15')).toBe(false)
    expect(gradeBlank('15', '15万')).toBe(false)
  })
})

/**
 * V2.12.3 · 括号里的**并列补充说明**。
 *
 * 修的缺陷：`省（直辖市、自治区）` 这种答案，单空路径只认「完全一致」与「去括号后
 * 一致」两条规则 —— 孩子填括号里的「直辖市」「自治区」会被判错，而那明明写在答案上。
 */
describe('gradeBlank · 括号里的并列补充（单空）', () => {
  // content/math-4-up-rjb/unit-math-4-up-rjb-p2.json :: u2-ex-002（多空，见下一组）
  const SHENG = '省（直辖市、自治区）'

  it('填括号外的主干 → 判对（既有语义，回归护栏）', () => {
    expect(gradeBlank('省', SHENG)).toBe(true)
  })

  it('填括号里的任一项 → 判对', () => {
    expect(gradeBlank('直辖市', SHENG)).toBe(true)
    expect(gradeBlank('自治区', SHENG)).toBe(true)
  })

  it('填不相关的内容 → 判错', () => {
    expect(gradeBlank('北京市', SHENG)).toBe(false)
    expect(gradeBlank('', SHENG)).toBe(false)
  })

  it('多空答案的某一段带括号 → 仍按位置比对（多空走 partsMatch，不走本通道）', () => {
    // content/math-4-up-rjb/unit-math-4-up-rjb-p2.json :: u2-ex-002
    expect(gradeBlank('6,省', '6,省（直辖市、自治区）')).toBe(true)
    expect(gradeBlank('6,直辖市', '6,省（直辖市、自治区）')).toBe(true)
    expect(gradeBlank('6,自治区', '6,省（直辖市、自治区）')).toBe(true)
    // 只填一个空仍然判错（多空全或无）
    expect(gradeBlank('6', '6,省（直辖市、自治区）')).toBe(false)
  })

  it('括号里只有一项时等价于「主干 / 该项」二选一', () => {
    expect(gradeBlank('长度', '长度（高度）')).toBe(true)
    expect(gradeBlank('高度', '长度（高度）')).toBe(true)
    expect(gradeBlank('宽度', '长度（高度）')).toBe(false)
  })

  it('括号里塞一长串说明（>6 项）→ 不放行', () => {
    const long = '甲（乙、丙、丁、戊、己、庚、辛）'
    expect(gradeBlank('庚', long)).toBe(false)
  })
})
