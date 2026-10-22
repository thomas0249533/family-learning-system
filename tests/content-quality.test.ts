/**
 * 内容侧质量警告 W021 / W022 / W023 的判定测试（V1.11 Stage F · F3）
 *
 * ## 这个文件为什么存在
 *
 * V1.6 Stage D 让**判分内核**能判对多答案填空（`@core/quiz/blank`），但题库内容
 * 本身的异味要由生产工具扫出来。三条警告的判定函数是纯函数，直接在 `tests/` 里
 * 钉死 —— 与 `tests/blank-grading.test.ts` 同一手法。
 *
 * ## 组织方式
 *
 * 1. 三个基础计量函数（空位数 / 段数 / 词数）；
 * 2. W021 / W022 / W023 各自的命中、不命中、边界；
 * 3. **真实题库数据钉死**（字符串直接写进断言，标注 file + id，不 import JSON 全量
 *    扫描 —— 内容一改测试就跟着漂的护栏是失效的护栏）；
 * 4. `qualityChecks` 的集成（输出必须是 NormalizeIssue 且 level=warning）。
 */

import { describe, it, expect } from 'vitest'
import {
  countStemBlanks,
  splitAnswerSegments,
  countAnswerSegments,
  countAnswerWords,
  checkArrayElementSeparator,
  checkSlashAlternatives,
  checkBlankCountMismatch,
  collectExercises,
  qualityChecks,
  W021_MAX_PHRASE_LEN,
} from '../scripts/lib/qualityChecks'

describe('countStemBlanks · 题干空位数', () => {
  it('没有下划线 → 0', () => {
    expect(countStemBlanks('1 + 1 = ？')).toBe(0)
    expect(countStemBlanks('')).toBe(0)
    expect(countStemBlanks(undefined)).toBe(0)
  })

  it('单空 / 多空', () => {
    expect(countStemBlanks('我国的国旗是______。')).toBe(1)
    expect(countStemBlanks('10个一万是（______），10个一千万是（______）。')).toBe(2)
    expect(countStemBlanks('甲______乙______丙______')).toBe(3)
  })

  it('3 个下划线的短空也算一个空', () => {
    expect(countStemBlanks('甲___乙')).toBe(1)
  })

  it('全角空格分隔的多个空仍分别计数', () => {
    expect(countStemBlanks('交朋友______\u3000\u3000来自______')).toBe(2)
  })

  it('作文格（72 个下划线）不算空位 —— 上限 24 的意义就在这一条', () => {
    const line = '_'.repeat(72)
    expect(countStemBlanks(`书面表达。\n${line}`)).toBe(0)
    expect(countStemBlanks('_'.repeat(24))).toBe(1)
    expect(countStemBlanks('_'.repeat(25))).toBe(0)
  })
})

describe('splitAnswerSegments · 答案分段（与判分内核同口径）', () => {
  it('标量按半/全角逗号、顿号、分号切段', () => {
    expect(splitAnswerSegments('甲,乙')).toEqual(['甲', '乙'])
    expect(splitAnswerSegments('甲，乙')).toEqual(['甲', '乙'])
    expect(splitAnswerSegments('甲、乙')).toEqual(['甲', '乙'])
    expect(splitAnswerSegments('甲;乙')).toEqual(['甲', '乙'])
    expect(splitAnswerSegments('甲；乙')).toEqual(['甲', '乙'])
  })

  it('**空格不是段分隔符**（38 条「每空一词」英文短语答案依赖这条）', () => {
    expect(splitAnswerSegments('When is')).toEqual(['When is'])
    expect(splitAnswerSegments('a quarter past')).toEqual(['a quarter past'])
    // 全角空格同理
    expect(splitAnswerSegments('When\u3000is')).toEqual(['When\u3000is'])
  })

  it('数组：每个元素就是一段，元素内的顿号属于答案文本', () => {
    expect(splitAnswerSegments(['全面、客观', '全貌'])).toEqual(['全面、客观', '全貌'])
    expect(countAnswerSegments(['全面、客观', '全貌'])).toBe(2)
  })

  it('斜杠备选是**一段**（斜杠不是段分隔符）', () => {
    expect(splitAnswerSegments("aren't / are not")).toEqual(["aren't / are not"])
  })

  it('nullish 降级为空数组，不抛异常', () => {
    expect(splitAnswerSegments(null)).toEqual([])
    expect(splitAnswerSegments(undefined)).toEqual([])
    expect(splitAnswerSegments('')).toEqual([])
  })
})

describe('countAnswerWords · 词数（「每空一词」复核用）', () => {
  it('按空白（含全角空格）切词并累加', () => {
    expect(countAnswerWords('How does; go')).toBe(3)
    expect(countAnswerWords('a quarter past')).toBe(3)
    expect(countAnswerWords('甲\u3000乙')).toBe(2)
    expect(countAnswerWords(['全面、客观', '全貌'])).toBe(2)
  })
})

describe('W021 · 数组答案元素内含分隔符', () => {
  it('命中：元素里的顿号把两个并列写法塞在一个元素里', () => {
    const hit = checkArrayElementSeparator(['全面、客观', '全貌'])
    expect(hit.hit).toBe(true)
    expect(hit.evidence).toEqual(['全面、客观'])
  })

  it('不命中：元素各自干净', () => {
    expect(checkArrayElementSeparator(['甲', '乙']).hit).toBe(false)
  })

  it('不命中：**标量**多段是本项目标准写法，不是数组元素异味', () => {
    expect(checkArrayElementSeparator('甲,乙').hit).toBe(false)
    expect(checkArrayElementSeparator('甲、乙').hit).toBe(false)
  })

  it('不命中：含换行的自由作答（逗号是句读不是分隔符）', () => {
    const hit = checkArrayElementSeparator(['(1) 漏算了 10×3，\n(2) 100 + 60 + 9 = 169'])
    expect(hit.hit).toBe(false)
  })

  it('不命中：超过短语长度上限的解答题长文本', () => {
    const long = '方案1：不合题意；方案2：剩余68张；方案3：剩余44张，答案是3种'
    expect(long.length).toBeGreaterThan(W021_MAX_PHRASE_LEN)
    expect(checkArrayElementSeparator([long]).hit).toBe(false)
  })

  it('边界：长度恰好等于上限仍算短语（含）', () => {
    const at = '甲、' + '乙'.repeat(W021_MAX_PHRASE_LEN - 2)
    expect(at.length).toBe(W021_MAX_PHRASE_LEN)
    expect(checkArrayElementSeparator([at]).hit).toBe(true)
  })

  it('nullish / 非数组不炸', () => {
    expect(checkArrayElementSeparator(null).hit).toBe(false)
    expect(checkArrayElementSeparator(undefined).hit).toBe(false)
    expect(checkArrayElementSeparator('甲').hit).toBe(false)
  })
})

describe('W022 · 斜杠备选答案', () => {
  it('命中：斜杠两侧都有半角空格', () => {
    const hit = checkSlashAlternatives("aren't / are not")
    expect(hit.hit).toBe(true)
    expect(hit.evidence).toEqual(["aren't / are not"])
  })

  it('命中：斜杠两侧是全角空格', () => {
    expect(checkSlashAlternatives('aren\u2019t\u3000/\u3000are not').hit).toBe(true)
  })

  it('命中：多段里只有某一段带备选也能抓出来', () => {
    const hit = checkSlashAlternatives('make friends; be from / come from; be in Class 1, Grade 7')
    expect(hit.hit).toBe(true)
    expect(hit.evidence).toEqual(['be from / come from'])
  })

  it('两侧都带空格才算 —— 命中条件就是这条', () => {
    expect(checkSlashAlternatives("aren't/ are not").hit).toBe(false)
    expect(checkSlashAlternatives("aren't /are not").hit).toBe(false)
    expect(checkSlashAlternatives("aren't/are not").hit).toBe(false)
  })

  it('不命中：单位写法的斜杠（85 千米/时）', () => {
    expect(checkSlashAlternatives('85 千米/时，8').hit).toBe(false)
  })

  it('不命中：音标斜杠（/kæt/）', () => {
    expect(checkSlashAlternatives('/kæt/').hit).toBe(false)
  })

  it('数组答案也照样扫', () => {
    expect(checkSlashAlternatives(['aren\'t / are not']).hit).toBe(true)
  })
})

describe('W023 · 题干空位数与答案段数不一致', () => {
  it('不命中：段数对齐', () => {
    const r = checkBlankCountMismatch({ type: 'blank', question: '甲______，乙______。', answer: '甲,乙' })
    expect(r.applicable).toBe(true)
    expect(r.hit).toBe(false)
    expect(r.blanks).toBe(2)
    expect(r.segments).toBe(2)
  })

  it('不命中：数组元素个数与空位数匹配', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: '要______地看问题，看不清事物的______。',
      answer: ['全面、客观', '全貌'],
    })
    expect(r.hit).toBe(false)
    expect(r.segments).toBe(2)
  })

  it('命中：数组元素个数少于空位数', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: '写“我和______过一天”，展开丰富的______。',
      answer: ['想象'],
    })
    expect(r.hit).toBe(true)
    expect(r.blanks).toBe(2)
    expect(r.segments).toBe(1)
  })

  it('命中：答案段数多于空位数（顿号把段数撑大了）', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: '请写出至少4个钝角：（______）。',
      answer: '105°、120°、135°、150°',
    })
    expect(r.hit).toBe(true)
    expect(r.blanks).toBe(1)
    expect(r.segments).toBe(4)
  })

  it('边界：空答案 —— 0 段对上空位，判定命中（真值在 E007 那边）', () => {
    const r = checkBlankCountMismatch({ type: 'blank', question: '甲______。', answer: '' })
    expect(r.applicable).toBe(true)
    expect(r.hit).toBe(true)
    expect(r.segments).toBe(0)
  })

  it('边界：题干没有空位标记 → 无从比对，不参与判定', () => {
    const r = checkBlankCountMismatch({ type: 'blank', question: '直接写出得数：25×4', answer: '100' })
    expect(r.applicable).toBe(false)
    expect(r.hit).toBe(false)
  })

  it('边界：非文本题型（single / judge）一律不参与判定', () => {
    expect(checkBlankCountMismatch({ type: 'single', question: '甲______。', answer: 'A' }).applicable).toBe(false)
    expect(checkBlankCountMismatch({ type: 'judge', question: '甲______。', answer: ['T', 'F'] }).applicable).toBe(false)
  })

  it('豁免：「每空一词」英语短语 —— 词数等于空位数', () => {
    const r = checkBlankCountMismatch({ type: 'blank', question: '8:50 is ______ ______ nine.', answer: 'ten to' })
    expect(r.applicable).toBe(true)
    expect(r.hit).toBe(false)
    expect(r.segments).toBe(1)
    expect(r.words).toBe(2)
  })

  it('豁免：多段里某段含空格，词数仍对齐（How does; go）', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: '—______ ______ your sister ______ to school?',
      answer: 'How does; go',
    })
    expect(r.blanks).toBe(3)
    expect(r.segments).toBe(2)
    expect(r.words).toBe(3)
    expect(r.hit).toBe(false)
  })

  it('不豁免：词数也对不上（a quarter past 对 2 个空）', () => {
    const r = checkBlankCountMismatch({ type: 'blank', question: '7:15 is ______ ______ seven.', answer: 'a quarter past' })
    expect(r.hit).toBe(true)
    expect(r.words).toBe(3)
  })

  it('斜杠备选不算切段：1 空 1 段', () => {
    const r = checkBlankCountMismatch({ type: 'blank', question: 'They ______ (not be) in the same class.', answer: "aren't / are not" })
    expect(r.blanks).toBe(1)
    expect(r.segments).toBe(1)
    expect(r.hit).toBe(false)
  })
})

describe('真实题库数据钉死（内容改了这里就该红）', () => {
  it('W021 命中 —— content/chinese-4-up-rjb/unit-chinese-4-up-rjb-u3.json u3-ex-002', () => {
    // 题干：要______地看问题…事物的______。答案 ["全面、客观","全貌"]
    expect(checkArrayElementSeparator(['全面、客观', '全貌']).hit).toBe(true)
  })

  it('W021 不命中 —— content/math-4-up-rjb/special-math-4-up-u3.json m4-u3-ex-013（189 字解答题）', () => {
    const long = '方案1：45 × 12 = 540 > 500，不合题意；方案2：36 × 12 = 432（张），剩余 500 - 432 = 68（张）；方案3：38 × 12 = 456（张），剩余 500 - 456 = 44（张）；方案4：40 × 12 = 480（张），剩余 500 - 480 = 20（张）。答：有3种分配方案。'
    expect(checkArrayElementSeparator([long]).hit).toBe(false)
  })

  it('W022 命中 —— content/english-7-up-rjb/unit-english-7-up-rjb-p1.json u1-ex-029', () => {
    expect(checkSlashAlternatives("aren't / are not").hit).toBe(true)
  })

  it('W022 不命中 —— content/math-4-up-rjb/daily-math-4-up-rjb-45d.json d45-26-x01（单位斜杠）', () => {
    expect(checkSlashAlternatives('85 千米/时，8').hit).toBe(false)
  })

  it('W023 命中 —— content/chinese-4-up-rjb/special-chinese-4-up-reading.json read-ex-058', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: '"浮云"一词有两层含义，一层是指______，另一层是指______。（用逗号隔开）',
      answer: '在山间浮动的云雾,奸邪小人,眼前的困难与障碍',
    })
    expect(r.blanks).toBe(2)
    expect(r.segments).toBe(3)
    expect(r.hit).toBe(true)
  })

  it('W023 命中 —— special-english-7-up-phrases special-ex-110（元素里塞了逗号）', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: '根据汉语提示写出短语。\n交朋友 ______    来自 ______    在七年级一班 ______',
      answer: 'make friends; be from / come from; be in Class 1, Grade 7',
    })
    expect(r.blanks).toBe(3)
    expect(r.segments).toBe(4)
    expect(r.hit).toBe(true)
  })

  it('W023 不命中 —— sprint-english-7-up-final sprint-ex-090（书面表达，72 下划线作文格）', () => {
    const r = checkBlankCountMismatch({
      type: 'blank',
      question: `书面表达。\n${'_'.repeat(72)}`,
      answer: '参考范文：Dear Tom, …',
    })
    expect(r.applicable).toBe(false)
    expect(r.hit).toBe(false)
  })
})

describe('qualityChecks · 集成', () => {
  const pkg = {
    manifest: { packageId: 'demo' },
    knowledgePoints: [{ id: 'kp-1', title: '知识点一', prerequisites: [] }],
    units: [
      {
        id: 'u1',
        topics: [
          {
            id: 't1',
            knowledgePointIds: ['kp-1'],
            modules: [{ id: 'm1', type: 'math.concept', title: '概念', knowledgePointIds: ['kp-1'] }],
            exercises: [
              // W021 + W023 都不命中（2 空 2 段）
              { id: 'ex-001', type: 'blank', question: '甲______，乙______。', answer: ['甲', '乙'], knowledgePointIds: ['kp-1'] },
              // W021 命中
              { id: 'ex-002', type: 'blank', question: '甲______，乙______。', answer: ['全面、客观', '全貌'], knowledgePointIds: ['kp-1'] },
              // W022 命中
              { id: 'ex-003', type: 'blank', question: 'They ______ (not be) here.', answer: "aren't / are not", knowledgePointIds: ['kp-1'] },
              // W023 命中
              { id: 'ex-004', type: 'blank', question: '甲______。', answer: '甲,乙', knowledgePointIds: ['kp-1'] },
              // 单选：三条都不参与
              { id: 'ex-005', type: 'single', question: '甲______。', options: ['A. 甲', 'B. 乙'], answer: 'A', knowledgePointIds: ['kp-1'] },
            ],
          },
        ],
      },
    ],
  }

  it('三条警告各自只报该报的题，且都是 warning（不阻塞构建）', () => {
    const issues = qualityChecks(pkg)
    const codes = issues.filter((i) => ['W021', 'W022', 'W023'].includes(i.code))
    expect(codes.map((i) => i.code)).toEqual(['W021', 'W022', 'W023'])
    for (const i of codes) expect(i.level).toBe('warning')
    expect(issues.find((i) => i.code === 'W021')?.message).toContain('ex-002')
    expect(issues.find((i) => i.code === 'W022')?.message).toContain('ex-003')
    expect(issues.find((i) => i.code === 'W023')?.message).toContain('ex-004')
  })

  it('干净的题不产生 W021~W023（含单选不误报）', () => {
    const codes = qualityChecks(pkg).map((i) => `${i.code}:${i.path}`)
    expect(codes).not.toContain('W021:units[u1].topics[t1].exercises[ex-001]')
    expect(codes.filter((c) => c.endsWith('exercises[ex-005]'))).toEqual([])
  })

  it('collectExercises 顶层池与 topic 池都要扫（现有内容两种写法并存）', () => {
    const both = collectExercises({
      exercises: [{ id: 'top-1', type: 'blank', question: '', answer: 'a' }],
      units: [{ id: 'u', topics: [{ id: 't', exercises: [{ id: 'tt-1', type: 'blank', question: '', answer: 'a' }] }] }],
    })
    expect(both.map((e) => e.ex.id)).toEqual(['top-1', 'tt-1'])
    expect(both[1].path).toBe('units[u].topics[t].exercises[tt-1]')
  })

  it('空包 / 缺字段不炸，返回空数组', () => {
    expect(qualityChecks({}).filter((i) => i.code.startsWith('W02'))).toEqual([])
    expect(qualityChecks({ units: [{ topics: [{}] }] }).filter((i) => i.code.startsWith('W02'))).toEqual([])
  })
})
