import { describe, expect, it } from 'vitest'

/**
 * 自定义包 → `AchievementDef` → 成就视图（V1.4 · B3）
 *
 * 验收的是一条**链路**，不是三个孤立函数：
 *   包 → `enabledPackDefs` → `buildAchievementItems` → `buildAchievementViewFromItems`
 * 因为最容易出的错恰好发生在接缝上 —— "定义翻译对了，但视图层仍按内置表查 source/tier"，
 * 症状是自定义卡在界面上显示成「系统核心 · 常见」，且进度条永远 0。
 */
import type { UnlockedRecord } from '@core/motivation/achievements'
import {
  buildAchievementItems,
  buildAchievementViewFromItems,
} from '@core/motivation/achievementMeta'
import { enabledPackDefs, packToDefs } from '@core/motivation/customPackDefs'
import { checkKey } from '@core/motivation/customPackTypes'
import type {
  CustomCheckState,
  CustomPack,
  CustomPackState,
  StoredPack,
} from '@core/motivation/customPackTypes'
import { ctx, mastered, pkg } from './achievement-fixtures'

const PACK_ID = 'pack-alpha'

/**
 * 三张卡，覆盖三种形态：
 *   A `counter`（显式 tier、无量词覆盖 → 走 METRIC_META 回落）
 *   B `manual-check`（勾了）
 *   C `hidden` 手工卡（未解锁 → 剪影）
 */
function pack(): CustomPack {
  return {
    schemaVersion: 1,
    packId: PACK_ID,
    name: '家庭自定',
    achievements: [
      {
        id: 'custom::read-3',
        icon: '📖',
        title: '阅读三天',
        desc: '连续三天阅读',
        category: 'B',
        source: 'habit',
        tier: 'advanced',
        metered: true,
        target: 3,
        rule: { kind: 'counter', metric: 'streak', target: 3 },
      },
      {
        id: 'custom::tidy-desk',
        icon: '🧹',
        title: '整理书桌',
        desc: '家长确认书桌整理好了',
        category: 'M',
        source: 'core',
        metered: false,
        rule: { kind: 'manual-check', prompt: '书桌整理好了吗' },
      },
      {
        id: 'custom::secret',
        icon: '🎁',
        title: '神秘奖励',
        desc: '家长的小惊喜',
        category: 'E',
        source: 'hidden',
        metered: false,
        rule: { kind: 'manual-check', prompt: '兑现小惊喜了吗' },
      },
    ],
  }
}

function storedPack(enabled: boolean, p: CustomPack = pack()): StoredPack {
  return {
    packId: p.packId,
    enabled,
    version: 1,
    pack: p,
    previous: null,
    importedAt: '2026-10-20T08:00:00.000Z',
    ...(enabled ? { enabledAt: '2026-10-20T08:00:00.000Z' } : {}),
  }
}

/** 只勾了「整理书桌」 */
function checks(): CustomCheckState {
  return {
    [checkKey(PACK_ID, 'custom::tidy-desk')]: { at: '2026-10-20T09:00:00.000Z' },
  }
}

const rec = (id: string, unlockedAt = '2026-10-20'): UnlockedRecord => ({ id, unlockedAt })

describe('packToDefs — 单枚翻译', () => {
  it('三张卡按包内顺序翻译，id/icon/title/desc/category 原样带出', () => {
    const defs = packToDefs(pack(), {})
    expect(defs.map((d) => d.id)).toEqual([
      'custom::read-3',
      'custom::tidy-desk',
      'custom::secret',
    ])
    expect(defs[0]).toMatchObject({
      icon: '📖',
      title: '阅读三天',
      desc: '连续三天阅读',
      category: 'B',
    })
  })

  it('★ 三个新字段都带上：source / tier / measure（视图层靠它们，而不是靠 id 反查）', () => {
    const defs = packToDefs(pack(), {})
    // 显式声明优先
    expect(defs[0].source).toBe('habit')
    expect(defs[0].tier).toBe('advanced')
    expect(typeof defs[0].measure).toBe('function')
    // 手工卡同样有度量（0/1 二值），否则卡片没有可渲染的进度口径
    expect(typeof defs[1].measure).toBe('function')
  })

  it('省略 tier 时用校验器同一个推导函数（target≥30 → 进阶；手工卡 → 常见）', () => {
    const p = pack()
    delete p.achievements[0].tier
    p.achievements[0].target = 30
    p.achievements[0].rule = { kind: 'counter', metric: 'streak', target: 30 }

    const defs = packToDefs(p, {})
    expect(defs[0].tier).toBe('advanced')
    expect(defs[1].tier).toBe('common')
  })

  it('source=hidden → def.hidden（剪影由视图层按 hidden 判定）', () => {
    const defs = packToDefs(pack(), {})
    expect(defs[2].hidden).toBe(true)
    expect(defs[0].hidden).toBeUndefined()
  })
})

describe('manual-check — check 只看勾选，不看 ctx', () => {
  it('★ 勾了就是勾了：空上下文与满上下文都判 true', () => {
    const defs = packToDefs(pack(), checks())
    const tidy = defs.find((d) => d.id === 'custom::tidy-desk')!

    expect(tidy.check(ctx())).toBe(true)
    expect(
      tidy.check(ctx({ progress: mastered('unit-math', 50), packages: [pkg('unit-math', 'math', 100)] })),
    ).toBe(true)
  })

  it('没勾 → false（不因为孩子在其它维度做得好就自动解锁）', () => {
    const defs = packToDefs(pack(), {})
    const tidy = defs.find((d) => d.id === 'custom::tidy-desk')!
    expect(tidy.check(ctx({ progress: mastered('unit-math', 50) }))).toBe(false)
  })

  it('度量为 0/1 二值，且与 check 同源（勾了 = 1/1）', () => {
    const unchecked = packToDefs(pack(), {})
    const m0 = unchecked[1].measure!(ctx())
    expect(m0).toMatchObject({ current: 0, target: 1, kind: 'binary' })

    const checked = packToDefs(pack(), checks())
    const m1 = checked[1].measure!(ctx())
    expect(m1).toMatchObject({ current: 1, target: 1, kind: 'binary' })
    expect(checked[1].check(ctx())).toBe(true)
  })
})

describe('counter — check 与 measure 同源', () => {
  it('★ check 随 ctx 变化（连续 3 天达标，0 天不达标）', () => {
    const defs = packToDefs(pack(), {})
    const read3 = defs[0]

    expect(read3.check(ctx({ streak: { current: 3, longest: 3, lastDate: '2026-10-19' } }))).toBe(true)
    expect(read3.check(ctx({ streak: { current: 2, longest: 2, lastDate: '2026-10-19' } }))).toBe(false)
    expect(read3.check(ctx())).toBe(false)
  })

  it('★ check 为真 ⇔ measure.current 达到 target（不出现"进度条满了但没解锁"）', () => {
    const read3 = packToDefs(pack(), {})[0]
    const got = ctx({ streak: { current: 3, longest: 3, lastDate: '2026-10-19' } })
    const m = read3.measure!(got)
    expect(m.current).toBeGreaterThanOrEqual(m.target)
    expect(read3.check(got)).toBe(true)

    const notYet = ctx({ streak: { current: 2, longest: 2, lastDate: '2026-10-19' } })
    const m2 = read3.measure!(notYet)
    expect(m2.current).toBeLessThan(m2.target)
    expect(read3.check(notYet)).toBe(false)
  })

  it('量词未覆盖时回落到 METRIC_META（streak → 天 / 连续）', () => {
    const m = packToDefs(pack(), {})[0].measure!(ctx())
    expect(m.unit).toBe('天')
    expect(m.noun).toBe('连续')
    expect(m.target).toBe(3)
  })

  it('包里写了 unit/noun 就覆盖（家长可以写"本 · 绘本"）', () => {
    const p = pack()
    p.achievements[0].unit = '本'
    p.achievements[0].noun = '绘本'
    const m = packToDefs(p, {})[0].measure!(ctx())
    expect(m.unit).toBe('本')
    expect(m.noun).toBe('绘本')
  })
})

describe('enabledPackDefs — 只取启用包', () => {
  it('★ 停用的包一枚卡都不出现（否则"停用"只是把卡藏起来，结算照样弹 toast）', () => {
    const state: CustomPackState = { packs: [storedPack(false)] }
    expect(enabledPackDefs(state, checks())).toEqual([])
  })

  it('多个启用包按安装顺序拼接', () => {
    const other = pack()
    other.packId = 'pack-beta'
    other.achievements = [other.achievements[1]]
    other.achievements[0].id = 'custom::brush-teeth'
    other.achievements[0].title = '早晚刷牙'

    const state: CustomPackState = {
      packs: [storedPack(true), storedPack(true, other)],
    }
    const defs = enabledPackDefs(state, checks())
    expect(defs.map((d) => d.id)).toEqual([
      'custom::read-3',
      'custom::tidy-desk',
      'custom::secret',
      'custom::brush-teeth',
    ])
  })
})

describe('接入视图：自定义卡与内置 38 枚无可区分', () => {
  const defs = () => enabledPackDefs({ packs: [storedPack(true)] }, checks())

  it('★ 自定义卡出现在它的 category 分组里，「已获得」随解锁记录变化', () => {
    const c = ctx()

    const pendingView = buildAchievementViewFromItems(buildAchievementItems(c, [], defs()))
    const pendingB = pendingView.sections
      .find((s) => s.key === 'pending')!
      .groups.find((g) => g.category === 'B')!
    expect(pendingB.items.map((i) => i.id)).toContain('custom::read-3')

    const earnedView = buildAchievementViewFromItems(
      buildAchievementItems(c, [rec('custom::read-3')], defs()),
    )
    const earnedB = earnedView.sections
      .find((s) => s.key === 'earned')!
      .groups.find((g) => g.category === 'B')!
    expect(earnedB.items.map((i) => i.id)).toEqual(['custom::read-3'])

    const item = earnedB.items[0]
    expect(item.earned).toBe(true)
    expect(item.unlockedAt).toBe('2026-10-20')
    expect(item.hint).toBe('已获得')
    // 统计口径跟着变（total = 可收集 37 + 3 张自定义；night-owl 不参与收集，V1.6 · C6）
    expect(earnedView.total).toBe(40)
    expect(earnedView.earned).toBe(1)
  })

  it('★ 视图尊重自定义来源/层级（不回落成「系统核心 · 常见」）', () => {
    const items = buildAchievementItems(ctx(), [], defs())
    const read3 = items.find((i) => i.id === 'custom::read-3')!
    expect(read3.source).toBe('habit')
    expect(read3.tier).toBe('advanced')
    // 星标是层级的视觉冗余：进阶 = 1 颗
    expect(read3.stars).toBe(1)

    const tidy = items.find((i) => i.id === 'custom::tidy-desk')!
    expect(tidy.source).toBe('core')
    expect(tidy.tier).toBe('common')
    expect(tidy.stars).toBe(0)
  })

  it('★ 未解锁的自定义隐藏卡是剪影（不外泄标题），解锁后正常显示', () => {
    const c = ctx()
    const locked = buildAchievementItems(c, [], defs()).find((i) => i.id === 'custom::secret')!
    expect(locked.silhouetted).toBe(true)
    expect(locked.title).toBe('？？？')

    const unlocked = buildAchievementItems(c, [rec('custom::secret')], defs()).find(
      (i) => i.id === 'custom::secret',
    )!
    expect(unlocked.silhouetted).toBe(false)
    expect(unlocked.title).toBe('神秘奖励')
  })

  it('自定义卡的进度可用（手工卡勾了 → 100% 且提示已获得）', () => {
    const items = buildAchievementItems(ctx(), [rec('custom::tidy-desk')], defs())
    const tidy = items.find((i) => i.id === 'custom::tidy-desk')!
    expect(tidy.metered).toBe(true)
    expect(tidy.percent).toBe(100)

    const lockedTidy = buildAchievementItems(
      ctx(),
      [],
      // 未勾选的包定义：勾选态是构建 def 时捕获的，所以要拿"没勾"的那一份来测
      enabledPackDefs({ packs: [storedPack(true)] }, {}),
    ).find((i) => i.id === 'custom::tidy-desk')!
    expect(lockedTidy.percent).toBe(0)
    expect(lockedTidy.hint).toBe('完成一次即可解锁')
  })

  it('内置定义仍是 38 枚，但视图分母是可收集的 37（不传 extraDefs 时）', () => {
    // 数据层（items）是定义真相，视图层（total）走可收集口径 —— 两者刻意不同
    expect(buildAchievementItems(ctx(), [])).toHaveLength(38)
    expect(buildAchievementViewFromItems(buildAchievementItems(ctx(), [])).total).toBe(37)
  })
})
