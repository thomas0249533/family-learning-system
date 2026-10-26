import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_TOTAL_COLLECTIBLE,
  ACHIEVEMENT_TOTAL_DEFINED,
  NON_COLLECTIBLE_IDS,
  isCollectible,
  type AchievementDef,
  type UnlockedRecord,
} from '@core/motivation/achievements'
import {
  buildAchievementItems,
  buildAchievementViewFromItems,
  filterAchievementItems,
} from '@core/motivation/achievementMeta'
import { mergeUnlocksForToast } from '@core/motivation/achievementToast'
import { paginateByCategory } from '@core/report/printLayout'
import { ctx, scenarios } from './achievement-fixtures'

/**
 * `night-owl` 降级为「不参与收集的彩蛋」（V1.6 · Stage C · C6）。
 *
 * 产品裁决（PRD `docs/prd-v1.3-achievement.md` §11.2 + 主理人终审）：
 * 21:00 后学习给徽章等于奖励一件有健康风险的事，与"产品对孩子负有照顾责任"冲突；
 * 但直接摘掉定义又会造出"已解锁却不展示"的怪状态、并让 AC-01 的
 * "28 枚 check 逐条不变"快照失去意义。**故保留触发与定义，拿掉激励**。
 *
 * 由此产生**双口径**，本文件就是这两个口径的合同：
 *   - 定义 38（`ACHIEVEMENT_TOTAL_DEFINED`）→ 只给"定义完整性"类断言用；
 *   - 可收集 37（`ACHIEVEMENT_TOTAL_COLLECTIBLE`）→ **所有 UI 文案的唯一口径**。
 *
 * 以及主理人终审的硬要求：「确保它在**收集图鉴中彻底隐身**」——
 * 图鉴 / 待解锁 / 计数 / toast / 家庭墙 / 打印件 / 线索系统，一处都不能露。
 */

const rec = (id: string, unlockedAt = '2026-10-19'): UnlockedRecord => ({ id, unlockedAt })

const nightOwl = ACHIEVEMENTS.find((a) => a.id === 'night-owl') as AchievementDef

/** 递归列出 `src/` 下的源码文件（静态断言用；不依赖任何构建产物） */
function srcFiles(dir = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...srcFiles(full))
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('双口径常量与 isCollectible（单一真源）', () => {
  it('定义总数 38 与可收集总数 37 必须同时存在且自洽', () => {
    // 38：AC-01 的"38 枚 check 逐条不变"快照按这个口径验（V2.8 · C1：28 → 38）
    expect(ACHIEVEMENT_TOTAL_DEFINED).toBe(38)
    expect(ACHIEVEMENTS.length).toBe(ACHIEVEMENT_TOTAL_DEFINED)
    // 37：所有 UI 分母
    expect(ACHIEVEMENT_TOTAL_COLLECTIBLE).toBe(37)
    // 两个常量的关系必须由名单长度推导，不是各自写死的两个数
    expect(ACHIEVEMENT_TOTAL_DEFINED - NON_COLLECTIBLE_IDS.length).toBe(
      ACHIEVEMENT_TOTAL_COLLECTIBLE,
    )
  })

  it('isCollectible：名单内的隐身，其余（含自定义 id）一律参与', () => {
    expect(isCollectible('night-owl')).toBe(false)
    expect(isCollectible('first-step')).toBe(true)
    // 另外两枚隐藏成就仍然参与收集（"隐藏" ≠ "不参与收集"，别把两件事混成一件）
    expect(isCollectible('comeback')).toBe(true)
    expect(isCollectible('early-bird')).toBe(true)
    // 未知 id = 自定义成就包的卡 → 默认参与收集（白名单方向会静默隐身，绝不能反过来写）
    expect(isCollectible('family-rule::wash-dishes')).toBe(true)
    expect(isCollectible('')).toBe(true)
  })

  it('夜猫子仍在定义里：check 是函数、hidden 为真（守住 AC-01，不许被"清理"掉）', () => {
    expect(nightOwl).toBeTruthy()
    expect(typeof nightOwl.check).toBe('function')
    expect(nightOwl.hidden).toBe(true)
    expect(nightOwl.category).toBe('B')
    // 判定语义原封不动：21:00 后仍在学习 → 满足
    expect(nightOwl.check(ctx({ dailyStats: [{ date: '2026-10-01', questionCount: 3, firstStudyAt: 0, lastStudyAt: new Date('2026-10-01T21:30:00').getTime() }] }))).toBe(true)
    expect(nightOwl.check(ctx({ dailyStats: [{ date: '2026-10-01', questionCount: 3, firstStudyAt: 0, lastStudyAt: new Date('2026-10-01T20:30:00').getTime() }] }))).toBe(false)
    // 三枚隐藏成就的集合不变（数量变化会同时影响线索池与剪影数）
    expect(ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id)).toEqual([
      'comeback',
      'early-bird',
      'night-owl',
    ])
  })
})

describe('视图分母走可收集口径（数据层完整 / 视图层隐身）', () => {
  it('items 仍是 38 枚（定义真相），但视图 total 是 37', () => {
    const items = buildAchievementItems(ctx(), [])
    expect(items).toHaveLength(ACHIEVEMENT_TOTAL_DEFINED)

    const v = buildAchievementViewFromItems(items)
    expect(v.total).toBe(ACHIEVEMENT_TOTAL_COLLECTIBLE)
    expect(v.earned).toBe(0)
    expect(v.percent).toBe(0)
    expect(v.complete).toBe(false)
    expect(v.empty).toBe(true)
  })

  it('night-owl 已解锁：不加 earned、不进 recent / sections、不改分母', () => {
    const items = buildAchievementItems(scenarios()['全达标'], [rec('night-owl')])
    const v = buildAchievementViewFromItems(items)

    expect(v.earned).toBe(0)
    expect(v.recent).toEqual([])
    expect(v.empty).toBe(true)
    // 两个区（这里只有待解锁）的任何一层都不出现它
    const visibleIds = v.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.id)))
    expect(visibleIds).toContain('first-step')
    expect(visibleIds).not.toContain('night-owl')
    expect(v.sections.map((s) => s.key)).toEqual(['pending'])
  })

  it('再拿到一枚正常成就：earned +1、percent 的分母仍是 27', () => {
    const items = buildAchievementItems(scenarios()['全达标'], [
      rec('night-owl'),
      rec('first-step', '2026-10-20'),
    ])
    const v = buildAchievementViewFromItems(items)

    expect(v.earned).toBe(1)
    expect(v.recent.map((i) => i.id)).toEqual(['first-step'])
    // 1/37 ≈ 2.7% → 3%（分母 38 会算出 2.63 → 3，恰好同值；
    // 所以这里同时钉住 earned 与 total，避免"靠巧合通过"）
    expect(v.total).toBe(37)
    expect(v.percent).toBe(Math.round((1 / 37) * 100))
  })

  it('closest（最接近解锁）不含 night-owl', () => {
    const items = buildAchievementItems(scenarios()['全达标'], [])
    const v = buildAchievementViewFromItems(items)
    expect(v.closest.length).toBeGreaterThan(0)
    expect(v.closest.length).toBeLessThanOrEqual(3)
    expect(v.closest.map((i) => i.id)).not.toContain('night-owl')
  })

  it('自定义成就照常进入分母（27 + 自定义）', () => {
    const custom: AchievementDef = {
      id: 'family-rule::x',
      icon: '🧩',
      title: '我家的家规',
      desc: '家长自定义',
      category: 'M',
      check: () => false,
    }
    const items = buildAchievementItems(ctx(), [], [custom])
    const v = buildAchievementViewFromItems(items)
    expect(v.total).toBe(ACHIEVEMENT_TOTAL_COLLECTIBLE + 1)
    expect(v.sections[0].groups.flatMap((g) => g.items.map((i) => i.id))).toContain(
      'family-rule::x',
    )
  })
})

describe('筛选：night-owl 连"筛出来的空"都不算', () => {
  const items = buildAchievementItems(ctx(), [])

  it('关键词搜不到它（用它的真实标题/描述也搜不到）', () => {
    // 剪影卡本就不参与关键词匹配，但那只是"没解锁时"；这里要的是**任何状态**都不出现
    for (const q of ['挑灯', '夜读', '21:00', '很晚']) {
      expect(filterAchievementItems(items, { query: q })).toEqual([])
    }
  })

  it('不做任何筛选时也不出现（早退分支不能原样返回入参）', () => {
    const all = filterAchievementItems(items, { state: 'all' })
    expect(all).toHaveLength(ACHIEVEMENT_TOTAL_COLLECTIBLE)
    expect(all.some((i) => i.id === 'night-owl')).toBe(false)
    // 不传 filter 的等价调用同样要过滤
    expect(filterAchievementItems(items)).toEqual(all)
  })

  it('两枚参与收集的隐藏成就仍是剪影（"隐身"不影响另外两枚的谜面）', () => {
    const silhouettes = filterAchievementItems(items, { state: 'pending' })
      .filter((i) => i.silhouetted)
      .map((i) => i.id)
      .sort()
    expect(silhouettes).toEqual(['comeback', 'early-bird'])
  })

  it('来源筛选「隐藏」只剩 2 枚（不是 3 枚）', () => {
    const hidden = filterAchievementItems(items, { source: 'hidden' })
    expect(hidden.map((i) => i.id).sort()).toEqual(['comeback', 'early-bird'])
  })
})

describe('toast：不弹（唯一出口就在 mergeUnlocksForToast）', () => {
  it('新解锁列表里含 night-owl → 返回里没有它，其他照常', () => {
    const defs = ACHIEVEMENTS.filter((a) =>
      ['first-step', 'night-owl', 'ten-kp'].includes(a.id),
    )
    expect(mergeUnlocksForToast(defs).map((d) => d.id)).toEqual(['first-step', 'ten-kp'])
  })

  it('只有 night-owl 一枚 → 空列表（一条提示都不播）', () => {
    expect(mergeUnlocksForToast([nightOwl])).toEqual([])
  })

  it('3 枚真实 + night-owl 不会被误判成「解锁 4 枚」而合并', () => {
    const defs = ACHIEVEMENTS.filter((a) =>
      ['first-step', 'ten-kp', 'fifty-kp', 'night-owl'].includes(a.id),
    )
    const out = mergeUnlocksForToast(defs)
    expect(out).toHaveLength(3)
    expect(out.some((d) => d.id === '__merged__')).toBe(false)
  })
})

describe('打印件与导出图片：同一套分页，同样不出现它', () => {
  it('B 组 17 枚超过单页容量 12 → 分两页（12+5）；全表 37 枚（V2.8 · C1：B 类 8 → 18）', () => {
    const pages = paginateByCategory(buildAchievementItems(ctx(), []))
    // B 组 17 枚 > PRINT_PER_PAGE(12)：打印件/导出图从 4 页变 5 页，B 续页 continued
    expect(pages.map((p) => p.category)).toEqual(['M', 'G', 'B', 'B', 'E'])
    expect(pages.map((p) => p.items.length)).toEqual([8, 7, 12, 5, 5])
    expect(pages.map((p) => p.groupTotal)).toEqual([8, 7, 17, 17, 5])
    expect(pages.map((p) => p.continued === true)).toEqual([false, false, false, true, false])
    const ids = pages.flatMap((p) => p.items.map((i) => i.id))
    expect(ids).toHaveLength(ACHIEVEMENT_TOTAL_COLLECTIBLE)
    expect(ids).not.toContain('night-owl')
  })
})

describe('静态断言：收集面视图不许再写一遍数字', () => {
  /** 收集类视图：它们的分母只能是 `view.total` / `ACHIEVEMENT_TOTAL_COLLECTIBLE` */
  const surfaces = ['src/views/Parent.vue', 'src/views/FamilyWall.vue', 'src/views/Home.vue']

  it('不得用 ACHIEVEMENTS.length 当分母（那是定义总数口径）', () => {
    for (const file of surfaces) {
      const src = readFileSync(file, 'utf8')
      expect(src, `${file} 不该出现 ACHIEVEMENTS.length`).not.toContain('ACHIEVEMENTS.length')
    }
  })

  it('不得把 38/37 当成可收集数量（三种常见写法都拦；V2.8 · C1 随总数同步）', () => {
    // ① 「x / 37」 ② 「37 枚」 ③ 「共 37」（38 同理 —— 定义口径也不许写进视图）
    const forbidden = [
      /\/\s*37\b/, /\b37\s*枚/, /共\s*37/,
      /\/\s*38\b/, /\b38\s*枚/, /共\s*38/,
    ]
    for (const file of surfaces) {
      const src = readFileSync(file, 'utf8')
      for (const re of forbidden) {
        expect(re.test(src), `${file} 命中禁用写法 ${String(re)}`).toBe(false)
      }
    }
  })

  it('ACHIEVEMENT_TOTAL_COLLECTIBLE 在 src/ 下只有一处定义（只有 achievements.ts）', () => {
    const files = srcFiles()
    const hits = files.filter((f) =>
      /export\s+const\s+ACHIEVEMENT_TOTAL_COLLECTIBLE\b/.test(readFileSync(f, 'utf8')),
    )
    expect(hits.map((f) => relative(process.cwd(), f).replace(/\\/g, '/'))).toEqual([
      'src/core/motivation/achievements.ts',
    ])
    // ACHIEVEMENT_TOTAL_DEFINED 同理（两个分母都必须单一真源）
    const defined = files.filter((f) =>
      /export\s+const\s+ACHIEVEMENT_TOTAL_DEFINED\b/.test(readFileSync(f, 'utf8')),
    )
    expect(defined.map((f) => relative(process.cwd(), f).replace(/\\/g, '/'))).toEqual([
      'src/core/motivation/achievements.ts',
    ])
  })
})
