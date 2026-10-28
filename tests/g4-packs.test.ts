/**
 * 四年级语文「基础知识默写」+ 四年级英语「单词句型语法」两个包的**内容级**回归。
 *
 * 为什么需要：这两个包都是我从**零文本扫描件**里读出来的（语文 16 页题目+答案页，
 * 英语 12 页中英对照 + 6 页语法），任何一处转录错误都会变成一道判错的题——
 * 而孩子做题时只会觉得"我明明写对了"。所以必须让机器逐题核对：
 *
 * ## 语文最有力的一条：音节数 == 汉字数
 *
 * 「看拼音写词语」题的题干是 `qí guān → （　）`，答案 `奇观`。
 * 拼音音节数与答案字数**必须相等**，否则一定是抄错了（多写一个音节、少写一个字、
 * 或者拼音和汉字错位）。这条规则不依赖任何拼音库，纯数空格就能验，
 * 却能抓住 90% 的转录错误。
 *
 * ## 英语最关键的一条：短答案不能做填空
 *
 * `@core/quiz/blank` 的 `partsMatch` 有反向右向子串容错（`u.includes(c) && c.length >= 2`），
 * answer=`is` 时孩子写 `this` 会判对。所以 <4 字母的答案必须是 `single`。
 * 这条也钉在测试里，防止以后有人"顺手"把 PE/Ms/his 改回填空。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CN4 = 'content/chinese-4-up-rjb/special-chinese-4-up-vocab.json'
const EN4 = 'content/english-4-up-vocab/special-english-4-up-vocab.json'

const VALID_TYPES = ['single', 'blank', 'multiple', 'judge', 'matching', 'spelling', 'essay']
/** 语文包里允许的 module.type（registerAll.ts 已注册的语文模块） */
const CN_MODULES = ['chinese.poem', 'chinese.text', 'chinese.words', 'chinese.writing']
const EN_MODULES = ['english.vocab', 'english.sentence', 'english.grammar', 'english.reading', 'english.writing']

interface Ex {
  id: string
  type: string
  question: string
  answer: string | string[] | number[]
  options?: string[]
  explanation?: string
  knowledgePointIds?: string[]
  metadata?: { word?: string; pinyin?: string }
}
interface Pkg {
  manifest: { packageId: string; examMode?: boolean; edition?: string }
  knowledgePoints: { id: string; type: string; content?: string; metadata?: Record<string, string> }[]
  units: { id: string; name: string; topics: { id: string; title?: string; modules?: { type: string }[]; exercises: Ex[] }[] }[]
}

function load(rel: string): { pkg: Pkg; exercises: Ex[]; topics: { id: string; title?: string; modules?: { type: string }[]; exercises: Ex[] }[] } {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as Pkg
  const topics = pkg.units.flatMap((u) => u.topics)
  return { pkg, exercises: topics.flatMap((t) => t.exercises), topics }
}

describe('四年级语文 · 基础知识默写包', () => {
  const { pkg, exercises, topics } = load(CN4)

  it('包配置正确：非考试模式、人教版、8 个单元', () => {
    expect(pkg.manifest.examMode, '必须 examMode:false，否则逐题解析不显示').toBe(false)
    expect(pkg.manifest.edition).toBe('人教版')
    expect(pkg.units.length).toBe(8)
  })

  it('模块类型都已注册', () => {
    for (const t of topics) {
      expect(t.modules?.length, `${t.id} 没有 modules`).toBeGreaterThan(0)
      for (const m of t.modules!) expect(CN_MODULES, `${t.id} 模块类型 ${m.type} 未注册`).toContain(m.type)
    }
  })

  it('每道题都有答案、解析，且挂在存在的知识点上', () => {
    const kpIds = new Set(pkg.knowledgePoints.map((k) => k.id))
    const ids = exercises.map((e) => e.id)
    expect(new Set(ids).size, '题目 id 有重复').toBe(ids.length)
    for (const ex of exercises) {
      expect(VALID_TYPES, `${ex.id} 题型非法`).toContain(ex.type)
      expect(String(ex.answer ?? '').trim(), `${ex.id} 缺答案`).not.toBe('')
      expect(ex.explanation?.trim(), `${ex.id} 缺解析`).toBeTruthy()
      expect(ex.knowledgePointIds?.length, `${ex.id} 无知识点`).toBeGreaterThan(0)
      for (const k of ex.knowledgePointIds!) expect(kpIds.has(k), `${ex.id} 引用了不存在的知识点 ${k}`).toBe(true)
      // 题干里不该残留未替换的占位符
      expect(ex.question, `${ex.id} 题干残留空位占位符`).not.toContain('__')
      expect(String(ex.answer), `${ex.id} 答案残留空位占位符`).not.toContain('（　）')
    }
  })

  it('成语补字：答案字数必须等于题干空位数', () => {
    // 原卷是「把词语补充完整」，孩子只会填缺的那几个字。
    // 如果答案写成整词（「人声鼎沸」），孩子填「人声」就会被判错 —— 这条专门防这个。
    const idiomEx = exercises.filter((e) => e.question.startsWith('【把词语补充完整】'))
    expect(idiomEx.length).toBeGreaterThan(30)
    const bad: string[] = []
    for (const ex of idiomEx) {
      const blanks = (ex.question.match(/（　）/g) ?? []).length
      const ans = String(ex.answer)
      if (ans.includes('/')) continue // 带备选写法的题（报 / 报国）另算
      const chars = ans.replace(/[,\s，]/g, '').length
      if (blanks === 0) bad.push(`${ex.id} 题干没有空位：${ex.question}`)
      else if (chars !== blanks) bad.push(`${ex.id} 空位 ${blanks} 个，答案「${ans}」却是 ${chars} 字`)
    }
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([])
  })

  it('看拼音写词语：音节数必须等于答案汉字数', () => {
    const pinyinEx = exercises.filter((e) => e.question.startsWith('【看拼音写词语】'))
    expect(pinyinEx.length, '看拼音写词语题太少').toBeGreaterThan(300)
    const bad: string[] = []
    for (const ex of pinyinEx) {
      // 题干形如「【看拼音写词语】qí guān → （　）」
      const m = ex.question.match(/^【看拼音写词语】(.+?) → （　）$/)
      if (!m) { bad.push(`${ex.id} 题干格式不符：${ex.question}`); continue }
      const syllables = m[1].trim().split(/\s+/).length
      const chars = String(ex.answer).replace(/[^\u4e00-\u9fa5]/g, '').length
      if (syllables !== chars) {
        bad.push(`${ex.id}「${m[1]}」→「${ex.answer}」音节 ${syllables} ≠ 字数 ${chars}`)
      }
    }
    expect(bad, `拼音与汉字对不上：\n${bad.slice(0, 10).join('\n')}`).toEqual([])
  })

  it('每个词语知识点都有一道对应的默写题', () => {
    const wordKps = pkg.knowledgePoints.filter((k) => k.type === 'word')
    expect(wordKps.length).toBeGreaterThan(300)
    const covered = new Set(exercises.flatMap((e) => e.knowledgePointIds ?? []))
    const missing = wordKps.filter((k) => !covered.has(k.id)).map((k) => k.id)
    expect(missing, `这些词语知识点没有出题：${missing.slice(0, 10).join(', ')}`).toEqual([])
  })

  it('词语知识点都带拼音，且拼音全是小写字母与声调', () => {
    const bad: string[] = []
    for (const k of pkg.knowledgePoints.filter((x) => x.type === 'word')) {
      const py = k.metadata?.pinyin ?? ''
      if (!py) { bad.push(`${k.id} 缺拼音`); continue }
      if (!/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ\s]+$/i.test(py)) bad.push(`${k.id} 拼音含异常字符：${py}`)
    }
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([])
  })
})

describe('四年级英语 · 单词句型语法包', () => {
  const { pkg, exercises, topics } = load(EN4)

  it('包配置正确：非考试模式、人教版、6 个单元 + 语法', () => {
    expect(pkg.manifest.examMode).toBe(false)
    expect(pkg.manifest.edition).toBe('人教版')
    expect(pkg.units.length).toBe(7)
    expect(pkg.units[6].name).toBe('语法专项')
  })

  it('模块类型都已注册', () => {
    for (const t of topics) {
      expect(t.modules?.length, `${t.id} 没有 modules`).toBeGreaterThan(0)
      for (const m of t.modules!) expect(EN_MODULES, `${t.id} 模块类型 ${m.type} 未注册`).toContain(m.type)
    }
  })

  it('每道题都有答案、解析、知识点；单选题答案在选项内', () => {
    const kpIds = new Set(pkg.knowledgePoints.map((k) => k.id))
    const ids = exercises.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const ex of exercises) {
      expect(VALID_TYPES, `${ex.id} 题型非法`).toContain(ex.type)
      expect(ex.explanation?.trim(), `${ex.id} 缺解析`).toBeTruthy()
      for (const k of ex.knowledgePointIds ?? []) expect(kpIds.has(k), `${ex.id} 知识点 ${k} 不存在`).toBe(true)
      if (ex.type === 'single') {
        const letters = (ex.options ?? []).map((o) => o.trim().charAt(0))
        expect(letters.length, `${ex.id} 选项不足 4 个`).toBeGreaterThanOrEqual(3)
        expect(letters, `${ex.id} 答案 ${ex.answer} 不在选项 ${letters.join('/')}`).toContain(ex.answer)
      }
    }
  })

  it('单词题统一用填空（单空是严格匹配，短词也不会被蒙对）', () => {
    // 查过 @core/quiz/blank：单空走 gradeBlankStrict 的严格相等，
    // partsMatch 的子串容错只在「多空」「斜杠备选」两条路径生效。
    // 所以 PE/Ms/his 这类短词做填空是安全的，不该被改成选择题而破坏题型一致性。
    const wordEx = exercises.filter((e) => /-w\d+$/.test(e.id))
    expect(wordEx.length).toBe(109)
    const notBlank = wordEx.filter((e) => e.type !== 'blank').map((e) => `${e.id}:${e.type}`)
    expect(notBlank, `这些单词题不是填空：${notBlank.join(', ')}`).toEqual([])

    const bad: string[] = []
    for (const ex of exercises.filter((e) => e.type === 'blank')) {
      const segs = String(ex.answer).replace(/，/g, ',').split(',').map((s) => s.trim())
      if (segs.some((s) => !s)) bad.push(`${ex.id} 答案有空段：${ex.answer}`)
      if (String(ex.answer).includes('（　）')) bad.push(`${ex.id} 答案残留占位符`)
    }
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([])
  })

  it('109 个单元生词全部出题，且与知识点一一对应', () => {
    const wordKps = pkg.knowledgePoints.filter((k) => k.type === 'word')
    expect(wordKps.length).toBe(109)
    const covered = new Set(exercises.flatMap((e) => e.knowledgePointIds ?? []))
    expect(wordKps.filter((k) => !covered.has(k.id)).map((k) => k.id)).toEqual([])
    // 每个单词题挂的知识点，其 metadata.word 必须与答案/题干对得上
    const kpMap = new Map(wordKps.map((k) => [k.id, k.metadata?.word ?? '']))
    const bad: string[] = []
    for (const ex of exercises.filter((e) => e.id.includes('-w'))) {
      const kp = kpMap.get(ex.knowledgePointIds![0])
      if (!kp) continue
      const answer = String(ex.answer)
      // blank 题答案是英文单词；single 题的答案是字母，题干里带英文单词
      const hit = ex.type === 'blank' ? answer.toLowerCase() === kp.toLowerCase() : ex.question.includes(kp)
      if (!hit) bad.push(`${ex.id} 知识点词「${kp}」与题目对不上（${ex.type}）`)
    }
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([])
  })

  it('题干不应把选项整串塞进去（应改用 single 的 options 字段）', () => {
    const bad = exercises.filter((e) => /（A\.\s/.test(e.question)).map((e) => e.id)
    expect(bad, `这些题把选项写进了题干：${bad.join(', ')}`).toEqual([])
  })

  it('语法单元覆盖 5 个语法点，题量合理', () => {
    const g = pkg.units[6]
    expect(g.topics.length).toBe(5)
    expect(g.topics.map((t) => (t.title ?? '').split('（')[0])).toEqual([
      'There be 句型', 'be 动词与 have / has', '名词所有格', '形容词构词与词类', '职业词汇与词形变化',
    ])
    const n = g.topics.reduce((s, t) => s + t.exercises.length, 0)
    expect(n).toBeGreaterThanOrEqual(45)
  })
})
