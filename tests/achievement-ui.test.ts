import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLLAPSED,
  UI_KEYS,
  groupKey,
  groupKeysOf,
  isAllExpanded,
  isCollapsed,
  normalizeCollapsed,
  toggleAll,
  toggleGroup,
  toggleSection,
} from '@core/motivation/achievementUi'

/**
 * 成就图鉴折叠状态的**纯算法**测试（V1.3 · A-04，对应 PRD §5.2）
 *
 * 这些函数不碰 DOM、不碰 db（IO 在同名文件里单独一层），
 * 所以可以在 node 环境里穷举边界：默认态、脏数据降级、区组联动、一键全展开。
 */

describe('默认态（PRD §5.2）', () => {
  it('已获得区默认收起，待解锁区默认展开', () => {
    expect(DEFAULT_COLLAPSED).toContain('earned')
    expect(DEFAULT_COLLAPSED).not.toContain('pending')
  })

  it('组不单独给默认值 —— 它们跟随所在区', () => {
    expect(DEFAULT_COLLAPSED.some((k) => k.startsWith('grp:'))).toBe(false)
  })
})

describe('normalizeCollapsed：读到什么都不能崩', () => {
  it('null / undefined / 字符串 / 数字 → 静默降级为默认态', () => {
    for (const raw of [null, undefined, 'oops', 0, true]) {
      expect(normalizeCollapsed(raw)).toEqual([...DEFAULT_COLLAPSED])
    }
  })

  it('缺 collapsed 数组 → 默认态', () => {
    expect(normalizeCollapsed({ v: 1 })).toEqual([...DEFAULT_COLLAPSED])
    expect(normalizeCollapsed({ v: 1, collapsed: 'earned' })).toEqual([...DEFAULT_COLLAPSED])
  })

  it('丢弃非法键与重复键，保留合法键', () => {
    const out = normalizeCollapsed({
      v: 1,
      collapsed: ['pending', 'pending', 'grp:pending:M', 'nonsense', 42, null],
    })
    expect(out).toEqual(['pending', 'grp:pending:M'])
  })

  it('兼容早期的裸组键 `grp:M` → 视为已获得区的组键', () => {
    expect(normalizeCollapsed({ collapsed: ['grp:M'] })).toEqual([groupKey('earned', 'M')])
  })

  it('全非法键 → 空数组（等价于"全部展开"），不悄悄回到默认收起', () => {
    expect(normalizeCollapsed({ collapsed: ['x', 'y'] })).toEqual([])
  })
})

describe('toggleSection：组跟随区（一次点击看到内容）', () => {
  it('展开已获得区时，它的 4 个组一起展开', () => {
    const out = toggleSection(['earned', ...groupKeysOf('earned')], 'earned')
    expect(out).not.toContain('earned')
    for (const k of groupKeysOf('earned')) expect(out).not.toContain(k)
  })

  it('收起待解锁区时，它的 4 个组一起收起', () => {
    const out = toggleSection([], 'pending')
    expect(out).toContain('pending')
    for (const k of groupKeysOf('pending')) expect(out).toContain(k)
  })

  it('只影响目标区，另一个区不受牵连', () => {
    const out = toggleSection(['earned'], 'pending')
    expect(out).toContain('earned')
    expect(out).toContain('pending')
  })

  it('返回新数组（不可变，便于 Vue 响应式）', () => {
    const base = [...DEFAULT_COLLAPSED]
    const out = toggleSection(base, 'earned')
    expect(out).not.toBe(base)
    expect(base).toEqual([...DEFAULT_COLLAPSED])
  })
})

describe('toggleGroup：单点一个组', () => {
  it('只切自己', () => {
    const out = toggleGroup([], 'pending', 'M')
    expect(out).toEqual([groupKey('pending', 'M')])
  })

  it('再点一次收回', () => {
    const there = toggleGroup([], 'pending', 'M')
    expect(toggleGroup(there, 'pending', 'M')).toEqual([])
  })

  it('同名组的两个分区互不干扰', () => {
    const out = toggleGroup([], 'earned', 'B')
    expect(isCollapsed(out, groupKey('earned', 'B'))).toBe(true)
    expect(isCollapsed(out, groupKey('pending', 'B'))).toBe(false)
  })
})

describe('一键全展开 / 全收起（AC-11）', () => {
  const visible = ['earned', 'pending', ...groupKeysOf('earned'), ...groupKeysOf('pending')]

  it('任一收起 → 全部展开', () => {
    const out = toggleAll(['earned'], visible)
    expect(isAllExpanded(out, visible)).toBe(true)
  })

  it('全展开 → 全部收起', () => {
    const out = toggleAll([], visible)
    expect(isAllExpanded(out, visible)).toBe(false)
    for (const k of visible) expect(out).toContain(k)
  })

  it('只作用于当前可见键，不误伤已隐藏分区的历史偏好', () => {
    // 已获得区因为"0 枚"没渲染 → 它的键不该被一键收起波及
    const onlyPending = ['pending', ...groupKeysOf('pending')]
    const out = toggleAll([], onlyPending)
    expect(out).toContain('pending')
    expect(out.some((k) => k.includes(':earned:'))).toBe(false)
  })
})

describe('键集合自洽', () => {
  it('UI_KEYS = 2 个区 + 2×4 个组，无重复', () => {
    expect(UI_KEYS).toHaveLength(10)
    expect(new Set(UI_KEYS).size).toBe(10)
  })

  it('所有生成出来的键都在白名单里（否则会被归一化静默丢掉）', () => {
    for (const sec of ['earned', 'pending'] as const) {
      expect(UI_KEYS).toContain(sec)
      for (const k of groupKeysOf(sec)) expect(UI_KEYS).toContain(k)
    }
  })
})
