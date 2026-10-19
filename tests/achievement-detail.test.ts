import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AchievementItem } from '@core/motivation/achievementMeta'
import { detailOf } from '@core/motivation/achievementDetail'

/**
 * 成就详情弹层的**纯逻辑**测试（V1.3 · P1）
 *
 * 单测跑在 node 环境（无 jsdom），`AchievementDetailModal.vue` 挂不起来，
 * 所以"弹层显示什么"全部收敛到 `detailOf`：这里把三类形态、
 * 剪影不可开、N≥1、证据缺失、入参不变逐条钉死。
 */

const TIER = '进阶'
const GROUP = '精熟目标'

/** 未解锁·可进度化（3/10） */
function pendingCounter(over: Partial<AchievementItem> = {}): AchievementItem {
  return {
    id: 'ten-kp',
    icon: '📚',
    title: '小试牛刀',
    desc: '掌握 10 个知识点',
    category: 'M',
    source: 'subject',
    tier: 'advanced',
    stars: 1,
    earned: false,
    unlockedAt: '',
    evidence: '',
    silhouetted: false,
    metered: true,
    current: 3,
    target: 10,
    percent: 30,
    hint: '已完成 3/10 · 还差 7个知识点',
    chainLabel: '',
    ...over,
  }
}

/** 已解锁（带证据 / 日期 / 连环） */
function earnedItem(over: Partial<AchievementItem> = {}): AchievementItem {
  return {
    ...pendingCounter(),
    earned: true,
    current: 10,
    target: 10,
    percent: 100,
    unlockedAt: '2026-10-12',
    evidence: '已掌握 10 个知识点',
    hint: '已获得',
    chainLabel: '精熟之链 2/5',
    ...over,
  }
}

/** 隐藏成就未解锁 → 视图层只会给出占位字段（真实文案不进视图对象） */
function silhouette(over: Partial<AchievementItem> = {}): AchievementItem {
  return {
    ...pendingCounter(),
    id: 'early-bird',
    icon: '🔒',
    title: '？？？',
    desc: '达成后揭晓',
    tier: 'hidden',
    stars: 0,
    earned: false,
    unlockedAt: '',
    evidence: '',
    silhouetted: true,
    metered: false,
    current: 0,
    target: 0,
    percent: 0,
    hint: '达成后揭晓',
    chainLabel: '',
    ...over,
  }
}

const labels = (rows: { label: string }[]) => rows.map((r) => r.label)
const valueOf = (rows: { label: string; value: string }[], label: string) =>
  rows.find((r) => r.label === label)?.value

describe('剪影（隐藏成就未解锁）：一律不许打开', () => {
  it('canOpen 为 false，且不返回任何可渲染内容', () => {
    const d = detailOf(silhouette(), '隐藏', '行为塑造')
    expect(d.canOpen).toBe(false)
    expect(d.title).toBe('')
    expect(d.rows).toEqual([])
    expect(d.cta).toBe('')
    expect(d.showProgress).toBe(false)
  })

  it('返回对象里搜不到真实标题 / 描述（点开即泄底的路径不存在）', () => {
    // 即便上游误把真实文案塞进 item（正常不会），剪影分支也必须全部拦住
    const leaky = silhouette({ title: '闻鸡起舞', desc: '在 07:00 前完成一次学习' })
    const text = JSON.stringify(detailOf(leaky, '隐藏', '行为塑造'))
    expect(text).not.toContain('闻鸡起舞')
    expect(text).not.toContain('07:00')
  })
})

describe('已解锁形态', () => {
  it('给出层级 / 小组 / 连环 / 解锁日期 / 证据，且不显示进度', () => {
    const d = detailOf(earnedItem(), TIER, GROUP)
    expect(d.canOpen).toBe(true)
    expect(d.title).toBe('小试牛刀')
    expect(labels(d.rows)).toEqual(['层级', '所属小组', '连环', '解锁日期', '证据'])
    expect(valueOf(d.rows, '层级')).toBe(TIER)
    expect(valueOf(d.rows, '所属小组')).toBe(GROUP)
    expect(valueOf(d.rows, '连环')).toBe('精熟之链 2/5')
    expect(valueOf(d.rows, '解锁日期')).toBe('2026-10-12')
    expect(valueOf(d.rows, '证据')).toBe('已掌握 10 个知识点')
    // "10/10" 是无意义回放
    expect(d.showProgress).toBe(false)
    expect(d.hint).toBe('')
    expect(d.cta).toBe('已解锁')
  })

  it('旧记录没有证据 → 不渲染「证据」行；解锁日期空 → 「较早」', () => {
    const d = detailOf(earnedItem({ evidence: '', unlockedAt: '' }), TIER, GROUP)
    expect(labels(d.rows)).not.toContain('证据')
    expect(valueOf(d.rows, '解锁日期')).toBe('较早')
  })

  it('不属于任何连环时不渲染「连环」行', () => {
    const d = detailOf(earnedItem({ chainLabel: '' }), TIER, GROUP)
    expect(labels(d.rows)).not.toContain('连环')
  })
})

describe('未解锁·可进度化', () => {
  it('画进度条，cta = 还差 N，提示原样透传 item.hint', () => {
    const item = pendingCounter()
    const d = detailOf(item, TIER, GROUP)
    expect(d.canOpen).toBe(true)
    expect(d.showProgress).toBe(true)
    expect(d.cta).toBe('还差 7')
    // 文案唯一来源是 progressText，这里一个字都不重写
    expect(d.hint).toBe(item.hint)
    expect(labels(d.rows)).toEqual(['层级', '所属小组'])
  })

  it('只差 1 时 cta = 还差 1', () => {
    const d = detailOf(pendingCounter({ current: 9, target: 10 }), TIER, GROUP)
    expect(d.cta).toBe('还差 1')
  })

  it('N 最小为 1：脏数据（current ≥ target）也不会出现「还差 0」', () => {
    for (const current of [10, 11, 999]) {
      const d = detailOf(pendingCounter({ current, target: 10 }), TIER, GROUP)
      expect(d.cta).toBe('还差 1')
    }
  })
})

describe('未解锁·二值事件', () => {
  it('不画进度条，cta = 完成一次即可解锁（同句只出现一次）', () => {
    const d = detailOf(
      pendingCounter({
        id: 'senior-new',
        title: '另辟蹊径',
        current: 0,
        target: 1,
        percent: 0,
        hint: '完成一次即可解锁',
      }),
      '常见',
      '探索发现',
    )
    expect(d.canOpen).toBe(true)
    expect(d.showProgress).toBe(false)
    expect(d.cta).toBe('完成一次即可解锁')
    // hint 与 cta 同句时不重复给 hint
    expect(d.hint).toBe('')
    expect(labels(d.rows)).toEqual(['层级', '所属小组'])
  })
})

describe('纯函数：不改入参', () => {
  it('对冻结对象调用不抛错，且调用前后快照完全一致', () => {
    const item = Object.freeze(pendingCounter())
    const before = JSON.stringify(item)
    expect(() => detailOf(item, TIER, GROUP)).not.toThrow()
    expect(JSON.stringify(item)).toBe(before)

    const earned = Object.freeze(earnedItem())
    const earnedBefore = JSON.stringify(earned)
    detailOf(earned, TIER, GROUP)
    expect(JSON.stringify(earned)).toBe(earnedBefore)
  })

  it('每次调用返回独立对象（改结果不会污染下一次）', () => {
    const a = detailOf(pendingCounter(), TIER, GROUP)
    a.rows.push({ label: '污染', value: 'x' })
    const b = detailOf(pendingCounter(), TIER, GROUP)
    expect(labels(b.rows)).toEqual(['层级', '所属小组'])
  })
})

// =====================================================================
// 静态接线：node 环境挂不起组件，只能读源码串断言"接入点没被改掉"
// =====================================================================
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('静态接线（组件层）', () => {
  it('卡片 = li 包原生控件：非剪影 <button>、剪影 <div>，不再手写 role/tabindex', () => {
    const card = read('src/components/AchievementCard.vue')
    expect(card).toContain('<li class="ach-card-wrap">')
    expect(card).toContain(':is="clickable ? \'button\' : \'div\'"')
    expect(card).toContain(':type="clickable ? \'button\' : undefined"')
    expect(card).toContain('class="ach-card"')
    expect(card).toContain('@keydown.enter.prevent="onActivate"')
    expect(card).toContain('@keydown.space.prevent="onActivate"')
    // e2e 依赖的两个类名不能丢（28 / 25 计数与解锁角标）
    expect(card).toContain('ach-lock')
    expect(card).toContain('ach-seal')
    // 原生控件自带 role / 焦点 / 键盘行为，手写版不应残留
    expect(card).not.toContain('role="button"')
    expect(card).not.toContain('tabindex')
    expect(card).not.toContain('ach-sr')
  })

  it('独立图鉴页存在，且以 standalone 复用同一个成就区', () => {
    expect(existsSync(join(ROOT, 'src/views/Achievements.vue'))).toBe(true)
    const page = read('src/views/Achievements.vue')
    expect(page).toContain('<AchievementSection :view="view" standalone />')
    expect(page).toContain('refreshView()')
  })

  it('/achievements 路由已注册', () => {
    const router = read('src/core/router/index.ts')
    expect(router).toContain("path: '/achievements'")
  })

  it('首页入口链接由 standalone 控制（Home 不传 → 显示）', () => {
    const section = read('src/components/AchievementSection.vue')
    expect(section).toContain('<RouterLink v-if="!standalone"')
    expect(section).toContain('to="/achievements"')
  })
})
