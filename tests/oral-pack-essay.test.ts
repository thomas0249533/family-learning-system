/**
 * 口语交际专项包的**内容级**回归。
 *
 * 为什么单独写这个文件：口语交际原卷是「开放填空 + 写话」，没有唯一答案。
 * 这批包的可判分性完全押在两件事上——
 *   ① 客观题的答案与选项真的对得上（写错一个字母孩子就会被判错）；
 *   ② essay 的 `keyPoints` 真的能区分「认真答」和「敷衍答」。
 * 这两件事靠肉眼审 91 道题不可靠，必须让判分内核逐题跑一遍。
 *
 * 断言三类：
 *   - 结构：题型合法、答案在选项内、matching 索引不越界、essay 得分点 ≥3 且备选 ≥2 字；
 *   - 自洽：参考答案自身必须判对（判不对说明得分点写歪了）；
 *   - 区分度：每题一个「认真作答」样本判对、一个「敷衍作答」样本判错。
 *
 * 数据源是 content/ 下的真实交付文件（不是内嵌副本），
 * 所以改包不更新本测试会直接红——这正是我们要的护栏。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gradeEssay } from '../src/core/quiz/essayGrade'

const VALID_TYPES = ['single', 'blank', 'multiple', 'judge', 'matching', 'spelling', 'essay']

interface Ex {
  id: string
  type: string
  question: string
  answer: string | string[] | number[]
  options?: string[]
  left?: string[]
  right?: string[]
  keyPoints?: string[]
  knowledgePointIds?: string[]
  explanation?: string
}

interface Pkg {
  manifest: { packageId: string; examMode?: boolean }
  knowledgePoints: { id: string }[]
  units: {
    id: string
    topics: { id: string; modules?: { type: string }[]; exercises: Ex[] }[]
  }[]
}

function load(rel: string): { pkg: Pkg; exercises: Ex[] } {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as Pkg
  const exercises = pkg.units.flatMap((u) => u.topics.flatMap((t) => t.exercises))
  return { pkg, exercises }
}

const PACKS = [
  { name: '二上口语交际', file: 'content/chinese-2-up-rjb/special-chinese-2-up-oral.json' },
  { name: '四上口语交际', file: 'content/chinese-4-up-rjb/special-chinese-4-up-oral.json' },
]

/**
 * 每题两个样本：认真作答（必须判对）/ 敷衍作答（必须判错）。
 * 样本刻意写成孩子的口气，并**不照抄参考答案**——考的就是「换一种说法也判对」。
 */
const SAMPLES: Record<string, { good: string; bad: string }> = {
  'o2-u1-11': {
    good: '我最喜欢的动物是小猫。它的毛是橘色的，眼睛圆圆的，尾巴长长的。它最爱在阳台上晒太阳，还会抓老鼠，真有趣。',
    bad: '我喜欢小狗。',
  },
  'o2-u1-12': {
    good: '请问小猫长什么样子呀？它平时爱吃什么、爱玩什么呢？',
    bad: '小猫吃什么？',
  },
  'o2-u2-10': {
    good: '我做的是纸风车。先拿一张正方形的纸，再对角折两次，然后用图钉固定在铅笔上，最后吹一口气，风车就做好了。',
    bad: '我做了一个手工，很好看。',
  },
  'o2-u2-11': {
    good: '你的手工真有意思！能不能按先做什么、再做什么的顺序再讲一遍？我很想学。',
    bad: '再讲一遍。',
  },
  'o2-u3-11': {
    good: '妈妈，周末我能和同学去公园玩吗？我保证写完作业再去，下午四点一定回家。',
    bad: '妈妈我要去公园。',
  },
  'o2-u3-12': {
    good: '叔叔您好！我们的羽毛球打到树上了，够不着，您能帮我们拿下来吗？谢谢您！',
    bad: '叔叔帮我捡球。',
  },
  'o2-u4-08': {
    good: '春天，爸爸让儿子站直，在小树上钉了一枚钉子做记号，量身高。第二年，儿子站在树下，发现钉子比自己还高。爸爸说，不是你变矮了，是树长高了。',
    bad: '爸爸给儿子量身高。',
  },
  'o2-u4-09': {
    good: '小兔子迷路了，害怕得哭起来。一只萤火虫打着灯笼飞过来，问它怎么了。萤火虫说，别怕，我带你回家。',
    bad: '小兔子回家了。',
  },
  'o4-u1-11': {
    good: '我发现学校门口的小河里有很多垃圾，水都变黑了。我建议：首先，在河边放几个垃圾桶；其次，看到乱扔垃圾的人要提醒他。',
    bad: '我们要保护环境。',
  },
  'o4-u1-12': {
    good: '我想让同学们做到：看见垃圾弯弯腰，把废纸投进可回收箱，离开教室随手关灯。',
    bad: '保护环境，人人有责。',
  },
  'o4-u2-10': {
    good: '你总在光线暗的地方看书，还长时间玩平板，这样眼睛很容易近视。我建议你在光线充足的地方看书，每半小时远眺一次，多到户外活动。',
    bad: '你要保护眼睛。',
  },
  'o4-u2-11': {
    good: '我认为保护视力非常重要，眼睛看不清东西会给学习带来很多麻烦。我建议大家每天认真做眼保健操，每看书四十分钟就到窗边看看绿树，坚持下去。',
    bad: '我认为要保护视力。',
  },
  'o4-u3-10': {
    good: '各位朋友，大家好！欢迎来到故宫。故宫是明清两代的皇宫，红墙黄瓦，非常壮观。希望我的介绍能让大家喜欢故宫，谢谢大家！',
    bad: '故宫很大。',
  },
  'o4-u3-11': {
    good: '我打算先搜集兵马俑的资料，比如它的样子和种类。然后把资料分类，挑出同学们最感兴趣的内容，去掉太复杂的部分。最后按顺序排好，做成小卡片。',
    bad: '我会看很多资料。',
  },
  'o4-u4-11': {
    good: '兰兰，别失望！虽然没看到日出，但雨中的丹霞山也很美。下次我们挑个晴天再来，我陪你一起。',
    bad: '没关系，下次再看吧。',
  },
  'o4-u4-12': {
    good: '妈妈，您今天不开心，是工作太累了吗？您先歇一歇，我给您倒杯水。别担心，我会好好学习，不让您操心。',
    bad: '妈妈别难过。',
  },
}

describe.each(PACKS)('$name 包结构', ({ file }) => {
  const { pkg, exercises } = load(file)

  it('必须是非考试模式，且模块类型已注册', () => {
    // 这两条都是「看起来可以更严格、其实会把功能改坏」的坑，用测试钉住：
    // ① examMode:true 会让 QuizEngine 的 feedback-box 整块不渲染（门禁是 !examMode），
    //    essay 的「你漏了哪几点」就永远看不到；
    // ② module.type 必须是 registerAll.ts 里真正注册过的，否则 topic 的知识点卡片不渲染。
    expect(pkg.manifest.examMode, '口语交际包必须 examMode:false，否则逐题判分反馈不显示').toBe(false)
    const REGISTERED = ['chinese.poem', 'chinese.text', 'chinese.words', 'chinese.writing']
    for (const u of pkg.units) {
      for (const t of u.topics) {
        expect(t.modules?.length, `${t.id} 没有 modules`).toBeGreaterThan(0)
        for (const m of t.modules!) {
          expect(REGISTERED, `${t.id} 的模块类型 ${m.type} 未在 registerAll 注册`).toContain(m.type)
        }
      }
    }
  })

  it('有题目，且全部挂在知识点上', () => {
    expect(exercises.length).toBeGreaterThan(0)
    const kpIds = new Set(pkg.knowledgePoints.map((k) => k.id))
    for (const ex of exercises) {
      expect(ex.knowledgePointIds?.length, `${ex.id} 无知识点`).toBeGreaterThan(0)
      for (const id of ex.knowledgePointIds!) expect(kpIds.has(id), `${ex.id} 引用了不存在的知识点 ${id}`).toBe(true)
    }
  })

  it('题目 id 唯一', () => {
    const ids = exercises.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('题型合法，且 answer 与题型字段对得上', () => {
    for (const ex of exercises) {
      expect(VALID_TYPES, `${ex.id} 题型非法`).toContain(ex.type)
      expect(ex.question?.trim(), `${ex.id} 缺题干`).toBeTruthy()
      expect(ex.explanation?.trim(), `${ex.id} 缺解析`).toBeTruthy()

      if (ex.type === 'single') {
        const opts = ex.options ?? []
        expect(opts.length, `${ex.id} 选项不足`).toBeGreaterThanOrEqual(2)
        const letters = opts.map((o) => o.trim().charAt(0))
        expect(letters, `${ex.id} 的答案 ${ex.answer} 不在选项 ${letters.join('/')} 内`).toContain(ex.answer)
      }

      if (ex.type === 'multiple') {
        const opts = ex.options ?? []
        const letters = opts.map((o) => o.trim().charAt(0))
        const ans = ex.answer as string[]
        expect(Array.isArray(ans), `${ex.id} multiple 的 answer 应为数组`).toBe(true)
        expect(ans.length, `${ex.id} 多选题只有 1 个答案，应改为 single`).toBeGreaterThan(1)
        for (const a of ans) expect(letters, `${ex.id} 的答案 ${a} 不在选项内`).toContain(a)
      }

      if (ex.type === 'judge') {
        expect(['对', '错'], `${ex.id} 判断题答案应为 对/错`).toContain(ex.answer)
      }

      if (ex.type === 'matching') {
        const { left, right } = ex
        const ans = ex.answer as number[]
        expect(Array.isArray(left) && Array.isArray(right), `${ex.id} 缺 left/right`).toBe(true)
        expect(ans.length, `${ex.id} answer 长度应等于 left 长度`).toBe(left!.length)
        for (const i of ans) {
          expect(Number.isInteger(i) && i >= 0 && i < right!.length, `${ex.id} 索引越界`).toBe(true)
        }
        // 同一 right 项不应被重复指向（否则连线题会出现两个左项对同一个右项）
        expect(new Set(ans).size, `${ex.id} 有重复配对的右项`).toBe(ans.length)
      }
    }
  })

  it('essay 得分点可被内核真正使用（≥3 个、每备选 ≥2 字）', () => {
    for (const ex of exercises.filter((e) => e.type === 'essay')) {
      const pts = ex.keyPoints ?? []
      expect(pts.length, `${ex.id} 得分点不足 3 个（阈值 0.6 时判分过严）`).toBeGreaterThanOrEqual(3)
      for (const p of pts) {
        for (const alt of p.replace(/／/g, '/').split('/')) {
          expect(alt.trim().length, `${ex.id} 得分点备选「${alt}」不足 2 字，内核会忽略`).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })
})

describe.each(PACKS)('$name 主观题判分', ({ file }) => {
  const { exercises } = load(file)
  const essays = exercises.filter((e) => e.type === 'essay')

  it('每道 essay 都有区分度样本', () => {
    const missing = essays.filter((e) => !SAMPLES[e.id]).map((e) => e.id)
    expect(missing, `这些 essay 缺少判分样本：${missing.join(', ')}`).toEqual([])
  })

  it('参考答案自身必须判对（自洽性）', () => {
    for (const ex of essays) {
      const r = gradeEssay(ex.answer as string, ex.answer as string, ex.keyPoints)
      expect(r.correct, `${ex.id} 参考答案自己都判不过：命中 ${r.covered}/${r.total}，漏 ${r.missing.join('、')}`).toBe(true)
    }
  })

  it('认真作答判对、敷衍作答判错', () => {
    for (const ex of essays) {
      const s = SAMPLES[ex.id]
      if (!s) continue

      const good = gradeEssay(s.good, ex.answer as string, ex.keyPoints)
      expect(
        good.correct,
        `${ex.id} 认真作答被判错：命中 ${good.covered}/${good.total}，漏 ${good.missing.join('、')}`,
      ).toBe(true)

      const bad = gradeEssay(s.bad, ex.answer as string, ex.keyPoints)
      expect(bad.correct, `${ex.id} 敷衍作答被判对（得分点太松）：「${s.bad}」`).toBe(false)
    }
  })
})
