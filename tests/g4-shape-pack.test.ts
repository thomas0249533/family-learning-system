/**
 * 四年级「巧数图形」包 · 内容级回归（V2.12 · 图片支持首个内容包）
 *
 * ## 这个包为什么需要两套独立的答案来源
 * 图形题的答案是"数出来"的，而这恰恰是最容易错、也最难在 review 时发现的环节：
 * 图和答案都出自同一个人的同一套理解，看着永远自洽。
 *
 * 所以这里做了**双源比对**：
 *   1. 生成脚本 `gen-math4-shape.py` 用几何枚举算答案（点集 + 可见边 + 组合判定）；
 *   2. 下面这张 `EXPECTED` 表是**人工按常用方法另算一遍**的结果
 *      （C(n,2)、按大小分类、横边×竖边、边长分类）后写死的。
 *
 * 两者相等才算通过。任何一侧漂移（改了图形没更新答案、或者答案手填错了）都会红。
 *
 * ## 图片相关的护栏
 * 图片链路有三处静默失败的可能，都必须在这里拦住：
 *   · 包 JSON 引用了图，但 `assets/` 里没有这个文件 → 孩子看到"配图缺失"；
 *   · `assets/` 里有图，但没有题引用 → 白占体积（校验脚本报 W036，这里再钉一道）；
 *   · `imageAlt` 为空 → 朗读 / 无障碍失效。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const PKG_PATH = 'content/math-4-up-rjb/special-math-4-up-shape.json'
const ASSET_DIR = 'content/math-4-up-rjb/assets/special-math-4-up-shape'

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
interface Pkg {
  manifest: { packageId: string; examMode?: boolean; dependencies?: unknown[] }
  knowledgePoints: { id: string }[]
  units: { id: string; name: string; topics: { id: string; title: string; exercises: Ex[] }[] }[]
}

const pkg: Pkg = JSON.parse(readFileSync(resolve(process.cwd(), PKG_PATH), 'utf-8'))
const exercises = pkg.units.flatMap((u) => u.topics.flatMap((t) => t.exercises))

/**
 * 人工另算的答案。**不要因为测试红了就改这里的数字** ——
 * 先确认是图形变了还是枚举算错了，再动。
 */
const EXPECTED: Record<string, number> = {
  'shape-q01': 6, // 直线上 4 个点：4×3÷2
  'shape-q02': 10, // 5 个点：5×4÷2
  'shape-q03': 9, // 横线 4 点 6 条 + 竖线 3 点 3 条
  'shape-q04': 6, // 4 条射线：4×3÷2
  'shape-q05': 10, // 5 条射线：5×4÷2
  'shape-q06': 3, // 2 小 + 1 大
  'shape-q07': 6, // 底边 3 段：3+2+1
  'shape-q08': 5, // 三中位线：4 小 + 1 大
  'shape-q09': 8, // 正方形对角线：4 小 + 4 半
  'shape-q10': 18, // 2×3 网格：6×3
  'shape-q11': 36, // 3×3 网格：6×6
  'shape-q12': 8, // 2×3 正方形：6+2
  'shape-q13': 14, // 3×3 正方形：9+4+1
}

/** 从选项文本 `A. 18` 里取出数字 */
function numberInOption(opt: string): number {
  const m = /(-?\d+)\s*$/.exec(opt.trim())
  expect(m, `选项「${opt}」里找不到数字`).not.toBeNull()
  return Number(m![1])
}

describe('巧数图形 · 结构与图片', () => {
  it('4 个单元正好对应 4 种数法，题量与脚本一致', () => {
    expect(pkg.units.map((u) => u.name)).toEqual(['数线段', '数角', '数三角形', '数长方形和正方形'])
    expect(exercises).toHaveLength(13)
  })

  it('非考试模式（考试模式会关掉逐题反馈，孩子看不到自己漏数了哪一类）', () => {
    expect(pkg.manifest.examMode).toBe(false)
  })

  it('每题都挂了本包知识点', () => {
    const kpIds = new Set(pkg.knowledgePoints.map((k) => k.id))
    for (const ex of exercises) {
      expect(ex.knowledgePointIds?.length, ex.id).toBeGreaterThan(0)
      for (const k of ex.knowledgePointIds ?? []) expect(kpIds.has(k), `${ex.id} → ${k}`).toBe(true)
    }
  })

  it('每道题都有配图，且文件真实存在', () => {
    for (const ex of exercises) {
      expect(ex.image, `${ex.id} 缺 image`).toMatch(/^assets\/q\d{2}\.svg$/)
      // 包内路径是 `assets/q01.svg`；磁盘上多一层 packageId，由 build-lpkgset 补上
      const file = resolve(process.cwd(), ASSET_DIR, basename(ex.image!))
      expect(existsSync(file), `缺文件 ${file}`).toBe(true)
    }
  })

  it('assets/ 里没有孤儿图（有图却没人引用）', () => {
    const referenced = new Set(exercises.map((e) => e.image))
    const files = readdirSync(resolve(process.cwd(), ASSET_DIR))
      .filter((f) => f.endsWith('.svg'))
      .map((f) => `assets/${f}`)
    expect(files.sort()).toEqual([...referenced].sort())
  })

  it('每张图都有 imageAlt（朗读与无障碍都要用）', () => {
    for (const ex of exercises) {
      expect((ex.imageAlt ?? '').trim().length, `${ex.id} 缺 imageAlt`).toBeGreaterThan(3)
    }
  })
})

describe('巧数图形 · 答案与选项', () => {
  it('选项恒为 4 个、答案字母合法、正文不重复', () => {
    for (const ex of exercises) {
      expect(ex.options, ex.id).toHaveLength(4)
      expect(['A', 'B', 'C', 'D']).toContain(ex.answer)
      const texts = ex.options!.map((o) => o.replace(/^[A-D]\.\s*/, ''))
      expect(new Set(texts).size, `${ex.id} 选项重复`).toBe(4)
    }
  })

  it.each(Object.keys(EXPECTED))('%s 的答案与人工另算一致', (id) => {
    const ex = exercises.find((e) => e.id === id)!
    expect(ex, `找不到 ${id}`).toBeDefined()

    const idx = ex.answer.charCodeAt(0) - 65
    const chosen = numberInOption(ex.options![idx])
    expect(chosen, `${id} 程序/人工答案不一致`).toBe(EXPECTED[id])

    // 干扰项不能恰好等于正确答案（否则这题有两个正确答案）
    for (const [i, opt] of ex.options!.entries()) {
      if (i === idx) continue
      expect(numberInOption(opt), `${id} 干扰项与答案同值`).not.toBe(EXPECTED[id])
    }
  })

  it('正确答案位置在 A–D 间轮换（避免孩子形成"总选 B"的惯性）', () => {
    const letters = exercises.slice(0, 4).map((e) => e.answer)
    expect(new Set(letters).size).toBe(4)
  })

  it('每题都有解析，且解析里点出了正确数字', () => {
    for (const ex of exercises) {
      const exp = ex.explanation ?? ''
      expect(exp.length, `${ex.id} 解析太短`).toBeGreaterThan(20)
      expect(exp, `${ex.id} 解析没给答案`).toContain(String(EXPECTED[ex.id]))
    }
  })
})
