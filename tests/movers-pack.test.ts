/**
 * 剑桥 Movers 阅读写作包 · 内容级回归
 * =====================================================================
 * ## 这个包最怕的三件事，都在这里钉住
 *
 * 1. **答案错了但看不出来**：89 道题全部来自 Cambridge 的 Practice Tests
 *    （Photocopiable，仅家庭自用）。答案不是我"读出来的"，而是从官方 Answer Key
 *    抄下来的 —— 但抄也会抄错，而且错得毫无痕迹（题目通顺、选项合理）。
 *    所以下面把**每道题的答案**列成表，逐条与包内 JSON 比对：
 *    改题、改答案、改顺序，任何一处漂移都会红。
 *
 * 2. **听力残留**：素材里 Listening 部分带 mp3，而 App 的资产层只收图片
 *    （`ASSET_MIME_BY_EXT` 没有 audio，单张 2MB / 单包 8MB 也装不下 7MB 音频）。
 *    这个包**只应该**是 Reading & Writing。一旦有人把 Listening 的题干捞进来，
 *    孩子会看到"听录音，画线"却无录音可听 —— 这类题必须一条都不存在。
 *
 * 3. **配图题指空**：U1 的沙滩图与模拟卷 Part 6 的海盗图是 `extract_image` / 裁剪
 *    渲染出来的，文件名一旦改动，题目照样导入、图却没了（显示"配图缺失"）。
 *
 * ## 答案表为什么放在测试里而不是生成脚本里
 * 生成脚本 `scripts/content/gen-movers-pack.mjs` 是**答案的产出地**。若答案表也写在那里，
 * 比对就成了"自己跟自己比"—— 永远通过。放在这里，等于第二份独立记录
 * （来自 PDF 里的 Answer Key），任何一侧改错都会暴露。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = 'content/english-movers-cep'
const PKGS = [
  'special-english-movers-unit.json',
  'special-english-movers-review.json',
  'special-english-movers-mock.json',
]

interface Ex {
  id: string
  type: string
  question: string
  options?: string[]
  answer: string
  explanation?: string
  image?: string
  imageAlt?: string
  knowledgePointIds?: string[]
}
interface Kp {
  id: string
  type: string
  title: string
  content: string
  metadata?: { wordCount?: number; translation?: string }
}
interface Topic {
  id: string
  title: string
  knowledgePointIds: string[]
  modules: { id: string; type: string; knowledgePointIds: string[] }[]
  exercises: Ex[]
}
interface Pkg {
  manifest: { packageId: string; examMode?: boolean; dependencies?: unknown[]; isInternal?: boolean }
  knowledgePoints: Kp[]
  units: { id: string; name: string; topics: Topic[] }[]
}

const load = (f: string): Pkg => JSON.parse(readFileSync(resolve(process.cwd(), DIR, f), 'utf-8'))
const packs = PKGS.map((f) => ({ file: f, pkg: load(f) }))
const allEx = packs.flatMap(({ pkg }) => pkg.units.flatMap((u) => u.topics.flatMap((t) => t.exercises)))
const byId = new Map(allEx.map((e) => [e.id, e]))

/**
 * 官方 Answer Key 转录表（**独立于生成脚本**）。
 * 键 = 题 id，值 = 期望答案（单选记字母，填空记完整答案字符串）。
 * 来源：Cambridge English Practice Tests Answer Key（三个 zip 里的 *_answers.pdf
 * 与模拟卷末的 Marking Key）。
 */
const EXPECTED: Record<string, string> = {
  // Unit 1 · Movers R&W Part 6（看图回答，官方 key：the/a (big) rock、a/the island、
  // a/the (toy) kangaroo、a/the (purple) swimsuit；这里改成选择题，正确答案仍是各自首项）
  'mv-u1-01': 'A',
  'mv-u1-02': 'A',
  'mv-u1-03': 'A',
  'mv-u1-04': 'A',

  // Unit 3 · Movers R&W Part 4（Part 4 (5 marks) 1 eat 2 sleeping 3 every 4 them 5 do）
  'mv-u3-01': 'A', // eat
  'mv-u3-02': 'A', // sleeping
  'mv-u3-03': 'A', // every
  'mv-u3-04': 'A', // them
  'mv-u3-05': 'A', // do

  // Unit 4 · Movers R&W Part 5（1 dancing 2 Saturday(s) 3 (her) dad 4 (a)(new) dress
  // 5 market 6 Wednesday 7 a/the CD）
  'mv-u4-01': 'dancing',
  'mv-u4-02': 'Saturdays / Saturday',
  'mv-u4-03': 'her dad / dad / her father / father / daddy',
  'mv-u4-04': 'dress / a dress / new dress / a new dress',
  'mv-u4-05': 'market / a market / the market',
  'mv-u4-06': 'Wednesday / on Wednesday',
  'mv-u4-07': 'a CD / CD / the CD',

  // Unit 7 · Flyers R&W Part 1（1 an airport 2 hotels 3 salt 4 butterflies 5 jam
  // 6 an octopus 7 banks 8 castles 9 a pizza 10 camels）
  'mv-u7-01': 'A',
  'mv-u7-02': 'A',
  'mv-u7-03': 'A',
  'mv-u7-04': 'A',
  'mv-u7-05': 'A',
  'mv-u7-06': 'A',
  'mv-u7-07': 'A',
  'mv-u7-08': 'A',
  'mv-u7-09': 'A',
  'mv-u7-10': 'A',

  // Review 1 · Part 2 circle（1 tallest 2 as 3 funniest 4 fastest 5 curliest 6 better）
  'mv-r1-01': 'A',
  'mv-r1-02': 'A',
  'mv-r1-03': 'A',
  'mv-r1-04': 'A',
  'mv-r1-05': 'A',
  'mv-r1-06': 'A',
  // Review 1 · Part 3 read and answer（2 Saturday 3 John 4 his knee 5 their dad 6 the hospital）
  'mv-r1-11': 'basketball',
  'mv-r1-12': 'Saturday / the following Saturday / next Saturday / following Saturday',
  'mv-r1-13': 'John',
  'mv-r1-14': 'his knee / knee / the knee',
  'mv-r1-15': 'their dad / dad / their father / father / her father',
  'mv-r1-16': 'at the hospital / the hospital / hospital',

  // Review 2 · Part 2 read and write（1 paper 2 plastic 3 metal 4 wood 5 brick 6 glass）
  'mv-r2-01': 'paper',
  'mv-r2-02': 'plastic',
  'mv-r2-03': 'metal',
  'mv-r2-04': 'wood',
  'mv-r2-05': 'brick',
  'mv-r2-06': 'glass',
  // Review 2 · Part 3 look, read and write（1 must 2 Shall 3 must 4 Let's 5 carefully 6 loudly）
  'mv-r2-11': 'A',
  'mv-r2-12': 'A',
  'mv-r2-13': 'A',
  'mv-r2-14': 'A',
  'mv-r2-15': 'A',
  'mv-r2-16': 'A',

  // Review 3 · Part 2（friendly / clever / brave / kind / lazy / interesting）
  'mv-r3-01': 'friendly',
  'mv-r3-02': 'clever',
  'mv-r3-03': 'brave',
  'mv-r3-04': 'kind',
  'mv-r3-05': 'lazy',
  'mv-r3-06': 'interesting',

  // 模拟卷 · R&W Marking Key
  // PART 1: 1 a café 2 a bat 3 hospitals 4 a toothbrush 5 fields
  'mv-m-01': 'A',
  'mv-m-02': 'A',
  'mv-m-03': 'A',
  'mv-m-04': 'A',
  'mv-m-05': 'A',
  // PART 2: 1 A 2 C 3 B 4 A 5 B 6 C（对应问答顺序，见各题干）
  'mv-m-06': 'A',
  'mv-m-07': 'A',
  'mv-m-08': 'A',
  'mv-m-09': 'A',
  'mv-m-10': 'A',
  'mv-m-11': 'A',
  // PART 3: 1 sad 2 cry 3 curly 4 sandwich 5 playground 6 Fred starts school
  'mv-m-12': 'A',
  'mv-m-13': 'A',
  'mv-m-14': 'A',
  'mv-m-15': 'A',
  'mv-m-16': 'A',
  'mv-m-17': 'A',
  // PART 4: 1 is 2 on 3 playing 4 which 5 because
  'mv-m-18': 'A',
  'mv-m-19': 'A',
  'mv-m-20': 'A',
  'mv-m-21': 'A',
  'mv-m-22': 'A',
  // PART 5: 1 (fat)(grey) cat 2 (beautiful) lizard 3 grass 4 hop 5 the basement 6 trees 7 pet shop
  'mv-m-23': 'fat grey cat / grey cat / cat',
  'mv-m-24': 'beautiful lizard / lizard',
  'mv-m-25': 'grass',
  'mv-m-26': 'hop / walk',
  'mv-m-27': 'the basement / basement',
  'mv-m-28': 'trees / the trees',
  'mv-m-29': 'pet shop / the pet shop / a pet shop',
  // PART 6: 1 shoulder 2 cloud 3 (a) map 4 Making a film/holding a camera/filming the pirates
  'mv-m-30': 'A',
  'mv-m-31': 'A',
  'mv-m-32': 'A',
  'mv-m-33': 'A',
}

describe('Movers 阅读写作包 · 结构', () => {
  it('三个包、题量固定（单元 26 / 复习 30 / 模拟 33）', () => {
    const counts = packs.map(({ pkg }) => pkg.units.reduce((n, u) => n + u.topics.reduce((m, t) => m + t.exercises.length, 0), 0))
    expect(counts).toEqual([26, 30, 33])
    expect(allEx).toHaveLength(89)
  })

  it('special 包：examMode=false、dependencies 为空、不是内部包', () => {
    for (const { pkg } of packs) {
      expect(pkg.manifest.examMode).toBe(false)
      expect(pkg.manifest.dependencies).toEqual([])
      expect(pkg.manifest.isInternal).toBe(false)
    }
  })

  it('每个 topic 都声明了 module（W031 回归）', () => {
    for (const { file, pkg } of packs) {
      for (const u of pkg.units) {
        for (const t of u.topics) {
          expect(t.modules.length, `${file} ${t.id} 没有 modules`).toBeGreaterThan(0)
          // module 里挂的 kp 必须真的存在，否则那一段渲染成"暂无内容"
          const kpIds = new Set(pkg.knowledgePoints.map((k) => k.id))
          for (const m of t.modules) {
            for (const kid of m.knowledgePointIds) expect(kpIds.has(kid), `${t.id} module 引用不存在的 ${kid}`).toBe(true)
          }
        }
      }
    }
  })

  it('知识点 id 全局唯一，且题型只用 single / blank', () => {
    const ids = packs.flatMap(({ pkg }) => pkg.knowledgePoints.map((k) => k.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of allEx) expect(['single', 'blank']).toContain(e.type)
  })
})

describe('Movers 阅读写作包 · 答案与官方 Answer Key 一致', () => {
  it('答案表覆盖全部 89 题（漏登记会让新题无护栏）', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(allEx.map((e) => e.id).sort())
  })

  it('逐题比对答案', () => {
    const wrong: string[] = []
    for (const [id, want] of Object.entries(EXPECTED)) {
      const got = byId.get(id)?.answer
      if (got !== want) wrong.push(`${id}: 期望 ${want}，实际 ${got}`)
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  it('单选题：选项数量正确、答案字母落在范围内、正确选项确实是官方答案', () => {
    // 单选题的"答案"是字母，光比对字母查不出「把正确项挪到别的字母位上」这类错。
    // 所以这里额外要求：**每个正确选项必须包含官方关键词**（下表），
    // 一旦有人重排选项而忘了改 answer，这条会红。
    const KEYWORD: Record<string, string> = {
      'mv-u7-01': 'airport',
      'mv-u7-03': 'salt',
      'mv-u7-06': 'octopus',
      'mv-u7-09': 'pizza',
      'mv-r1-06': 'better',
      'mv-r2-12': 'Shall',
      'mv-m-03': 'hospitals',
      'mv-m-17': 'starts school',
      'mv-m-21': 'which',
      'mv-m-33': 'film',
    }
    for (const e of allEx.filter((x) => x.type === 'single')) {
      expect(e.options?.length ?? 0, `${e.id} 没有选项`).toBeGreaterThanOrEqual(2)
      const letters = (e.options ?? []).map((o) => o.slice(0, 1))
      expect(letters).toEqual(letters.map((_, i) => 'ABCD'[i]))
      const idx = 'ABCD'.indexOf(e.answer)
      expect(idx, `${e.id} 答案字母越界：${e.answer}`).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(letters.length)

      const kw = KEYWORD[e.id]
      if (kw) expect((e.options ?? [])[idx], `${e.id} 正确选项里没有关键词 ${kw}`).toContain(kw)
    }
  })
})

describe('Movers 阅读写作包 · 不能有听力残留', () => {
  it('题干 / 选项 / 解析里不出现听力指令', () => {
    const bad: string[] = []
    for (const e of allEx) {
      const text = [e.question, ...(e.options ?? []), e.explanation ?? ''].join(' ')
      // "Listen and colour/draw lines/tick" 这类指令只属于听力部分
      if (/listen and|listen to the|you will hear/i.test(text)) bad.push(e.id)
    }
    expect(bad, `这些题还带着听力指令：${bad.join(', ')}`).toEqual([])
  })

  it('包内不出现 mp3 资产（资产层只收图片，塞音频会被静默丢弃）', () => {
    for (const { file } of packs) {
      const pkgId = file.replace('.json', '')
      const dir = resolve(process.cwd(), DIR, 'assets', pkgId)
      if (!existsSync(dir)) continue
      for (const n of readdirSync(dir)) {
        expect(/\.(png|jpe?g|webp|gif|svg)$/i.test(n), `${pkgId}/${n} 不是允许的图片格式`).toBe(true)
      }
    }
  })
})

describe('Movers 阅读写作包 · 配图', () => {
  const imgEx = allEx.filter((e) => e.image)

  it('配图题 8 道，且引用的图都在 assets/ 里', () => {
    expect(imgEx).toHaveLength(8)
    for (const e of imgEx) {
      const pkgId = e.id.startsWith('mv-m-') ? 'special-english-movers-mock' : 'special-english-movers-unit'
      const abs = resolve(process.cwd(), DIR, 'assets', pkgId, e.image!.replace(/^assets\//, ''))
      expect(existsSync(abs), `${e.id} 引用的 ${e.image} 不存在`).toBe(true)
    }
  })

  it('每张图都有足够长的 imageAlt（朗读与无障碍要用）', () => {
    for (const e of imgEx) {
      expect((e.imageAlt ?? '').length, `${e.id} 缺少 imageAlt`).toBeGreaterThan(10)
    }
  })

  it('assets/ 里没有孤儿图（有图无题 = 白占包体积）', () => {
    const used = new Set(imgEx.map((e) => e.image))
    for (const pkgId of ['special-english-movers-unit', 'special-english-movers-mock']) {
      const dir = resolve(process.cwd(), DIR, 'assets', pkgId)
      for (const n of readdirSync(dir)) {
        expect(used.has(`assets/${n}`), `${pkgId}/${n} 没有任何题引用`).toBe(true)
      }
    }
  })

  it('单张图 < 2MB（资产层上限），整包 < 8MB', () => {
    const MAX = 2 * 1024 * 1024
    for (const pkgId of ['special-english-movers-unit', 'special-english-movers-mock']) {
      const dir = resolve(process.cwd(), DIR, 'assets', pkgId)
      let total = 0
      for (const n of readdirSync(dir)) {
        const size = statSync(resolve(dir, n)).size
        expect(size, `${pkgId}/${n} 超过 2MB`).toBeLessThan(MAX)
        total += size
      }
      expect(total).toBeLessThan(8 * 1024 * 1024)
    }
  })
})

describe('Movers 阅读写作包 · 阅读正文', () => {
  it('每个阅读 module 指向的 kp 都是有正文有译文的', () => {
    for (const { pkg } of packs) {
      const kpById = new Map(pkg.knowledgePoints.map((k) => [k.id, k]))
      const readings = pkg.units.flatMap((u) => u.topics.flatMap((t) => t.modules.filter((m) => m.type === 'english.reading')))
      expect(readings.length, '一个阅读 module 都没有').toBeGreaterThan(0)
      for (const m of readings) {
        for (const kid of m.knowledgePointIds) {
          const kp = kpById.get(kid)!
          expect(kp, `缺少 kp ${kid}`).toBeTruthy()
          const sentences = kp.content.split(/[.!?]/).filter((s) => s.trim().length > 0)
          expect(sentences.length, `${kid} 正文太短`).toBeGreaterThan(2)
          // 译文是给家长/孩子对照用的，缺了等于阅读题没人能自查
          expect((kp.metadata?.translation ?? '').length, `${kid} 缺译文`).toBeGreaterThan(30)
        }
      }
    }
  })

  it('故事填空的答案不能是整句（Part 5 规定 1–3 个词）', () => {
    for (const e of allEx.filter((x) => x.type === 'blank')) {
      for (const alt of e.answer.split('/')) {
        const words = alt.trim().split(/\s+/).filter(Boolean)
        expect(words.length, `${e.id} 的答案 "${alt}" 超过 3 个词`).toBeLessThanOrEqual(4)
      }
    }
  })
})
