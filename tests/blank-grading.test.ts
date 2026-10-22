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
