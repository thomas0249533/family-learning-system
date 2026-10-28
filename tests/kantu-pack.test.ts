/**
 * 二上看图写话包 · 配图回归（V2.12.1 · 12 篇补图）
 *
 * ## 为什么这个包要单独一套护栏
 * 看图写话的图是**题干的一半**：孩子先看图再写话，没图这道题就只能照着
 * "画面：……"那行文字想象。图缺失时 App 只显示一行淡字「配图缺失」，
 * 不报错、不中断答题，所以内容侧的缺陷只能在这里拦。
 *
 * ## 拦三类静默失败
 *   1. 包 JSON 引用了 `assets/kt2-XX.svg`，磁盘上却没有这个文件 → 显示"配图缺失"；
 *   2. 磁盘上有图但没题引用 → 白占包体积（校验脚本报 W036，这里再钉一道）；
 *   3. 缺 `imageAlt` → 朗读 / 无障碍失效。
 *
 * ## 还钉住画布尺寸
 * `QuestionImage` 是 `max-height: 320px` + `max-width: 100%`：
 *   · 画布过高（竖图）→ 缩到 320 高之后宽度只剩一两百像素，画面细节全糊；
 *   · 四格连环画如果按单幅 1000×640 画，每格只有 200 宽，小动物认不出来。
 * 所以约定：单幅横构图、多格必须更宽。下面按图直接校验宽高比。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const PKG_PATH = 'content/chinese-2-up-rjb/special-chinese-2-up-kantu.json'
const ASSET_DIR = 'content/chinese-2-up-rjb/assets/special-chinese-2-up-kantu'

interface Ex {
  id: string
  type: string
  question: string
  image?: string
  imageAlt?: string
}
interface Pkg {
  manifest: { packageId: string; examMode?: boolean }
  units: { topics: { exercises: Ex[] }[] }[]
}

const pkg: Pkg = JSON.parse(readFileSync(resolve(process.cwd(), PKG_PATH), 'utf-8'))
const exercises = pkg.units.flatMap((t) => t.topics.flatMap((x) => x.exercises))

/** 四格 / 三格连环画的题号：画布必须比单幅宽 */
const MULTI_PANEL = ['kt2-07', 'kt2-08', 'kt2-12']

function svgSize(id: string): { w: number; h: number; text: string } {
  const text = readFileSync(resolve(process.cwd(), ASSET_DIR, `${id}.svg`), 'utf-8')
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(text)
  if (!vb) throw new Error(`${id}.svg 缺 viewBox`)
  return { w: Number(vb[1]), h: Number(vb[2]), text }
}

describe('二上看图写话 · 12 篇配图', () => {
  it('12 道题都挂了图，且路径指向包内 assets/', () => {
    expect(exercises.length).toBe(12)
    for (const ex of exercises) {
      expect(ex.image, `${ex.id} 缺 image`).toBe(`assets/${ex.id}.svg`)
    }
  })

  it('每道题都有非空 imageAlt（朗读 / 无障碍）', () => {
    for (const ex of exercises) {
      expect(ex.imageAlt, `${ex.id} 缺 imageAlt`).toBeTruthy()
      expect((ex.imageAlt ?? '').length, `${ex.id} 的 imageAlt 太短`).toBeGreaterThan(10)
    }
  })

  it('引用的 SVG 都真实存在，且磁盘上没有孤儿图', () => {
    const referenced = new Set(exercises.map((e) => `${e.id}.svg`))
    for (const name of referenced) {
      expect(existsSync(resolve(process.cwd(), ASSET_DIR, name)), `${name} 不存在`).toBe(true)
    }
    const onDisk = readdirSync(resolve(process.cwd(), ASSET_DIR)).filter((f) => f.endsWith('.svg'))
    expect(onDisk.sort()).toEqual([...referenced].sort())
  })

  it('每张图都在单张体积上限内，且画布比例适合题卡（横构图，max-height 320px）', () => {
    for (const ex of exercises) {
      const { w, h, text } = svgSize(ex.id)
      const bytes = Buffer.byteLength(text, 'utf-8')
      expect(bytes, `${ex.id} 超过 2MB`).toBeLessThan(2 * 1024 * 1024)
      expect(bytes, `${ex.id} 体积异常小，可能是空图`).toBeGreaterThan(800)
      // 横构图：宽至少是高的 1.4 倍，否则缩到 320 高之后画面只剩一条
      expect(w / h, `${ex.id} 画布 ${w}x${h} 太窄`).toBeGreaterThanOrEqual(1.4)
      if (MULTI_PANEL.includes(ex.id)) {
        // 多格：宽高比 ≥ 1.6 且宽度 ≥ 1200，保证每格缩下来还看得清
        expect(w / h, `${ex.id} 多格画布不够宽`).toBeGreaterThanOrEqual(1.6)
        expect(w, `${ex.id} 多格画布宽度不足`).toBeGreaterThanOrEqual(1200)
      }
    }
  })

  it('SVG 里没有会被 sanitizeSvg 剥掉、或 <img> 下不生效的内容', () => {
    for (const ex of exercises) {
      const { text } = svgSize(ex.id)
      // sanitizeSvg 会剥掉 foreignObject / script / on*，出现就说明生成脚本有问题
      expect(text.includes('foreignObject'), `${ex.id} 含 foreignObject`).toBe(false)
      expect(/<script/i.test(text), `${ex.id} 含 script`).toBe(false)
      expect(/\son\w+\s*=/i.test(text), `${ex.id} 含 on* 事件属性`).toBe(false)
      // <img> 加载 SVG 时不加载外部资源：不许外链图片 / 字体
      expect(/<image\b/.test(text), `${ex.id} 含外链 <image>`).toBe(false)
      expect(/@font-face|href="http/i.test(text), `${ex.id} 引用了外部资源`).toBe(false)
    }
  })

  it('题面仍是「画面：…」的文字描述（图与文字不冲突，图是补充而非替换）', () => {
    for (const ex of exercises) {
      expect(ex.question).toContain('画面：')
    }
  })

  it('包保持 examMode=false（主观表达题要看逐题反馈）', () => {
    expect(pkg.manifest.examMode).toBe(false)
  })
})
