import { describe, expect, it } from 'vitest'
import {
  GLOBAL_KEYS,
  PROFILE_SCOPED_KEYS,
  classifyKey,
  isProfileScoped,
  scopedKey,
  type ProfileScopedBase,
} from '@core/profile/settingsScope'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  MAX_PROFILES,
  ProfileLimitError,
  makeProfileId,
  normalizeProfilesState,
} from '@core/profile/profileTypes'

/**
 * settings 作用域表 + 档案基础类型。
 *
 * 这一层没有 I/O，但它的失败模式最贵：判错一个键 = 某个孩子的数据"看起来归零"，
 * 且没有任何报错。所以这里的断言集中在**两件容易写错的事**：
 *   1. 判定顺序（精确匹配必须先于 `base:pid` 拆分）；
 *   2. 清单本身是否被悄悄改动（删一个键 → 该键在迁移里变成 legacy/unknown）。
 */

describe('settingsScope — 键清单', () => {
  it('8 个 per-profile 键、9 个 global 键一个都不能少（删键等于那个键不再被搬）', () => {
    expect(PROFILE_SCOPED_KEYS).toHaveLength(8)
    expect(GLOBAL_KEYS).toHaveLength(9)
    // 抽查两组里最容易被人"顺手删掉"的成员：家长开关与迁移标记
    expect(PROFILE_SCOPED_KEYS).toContain('achievement:discoveryEnabled')
    expect(GLOBAL_KEYS).toContain('migration:v4')
  })

  it('两个清单不允许有交集（同时在两边的键，分类结果只取决于判定顺序）', () => {
    const overlap = PROFILE_SCOPED_KEYS.filter((k) => (GLOBAL_KEYS as readonly string[]).includes(k))
    expect(overlap).toEqual([])
  })

  it('scopedKey 只是拼 `<base>:<pid>`，不做 trim / 不做校验（调用方给什么就存什么）', () => {
    expect(scopedKey('dailyStats', 'p1')).toBe('dailyStats:p1')
    expect(scopedKey('achievements', DEFAULT_PROFILE_ID)).toBe('achievements:default')
  })
})

describe('settingsScope — classifyKey 的判定顺序', () => {
  it('★ 8 个 base 键本身（v3 形态）都判 profile-legacy，base 原样返回', () => {
    for (const base of PROFILE_SCOPED_KEYS) {
      expect(classifyKey(base)).toEqual({ kind: 'profile-legacy', base })
    }
  })

  it('★ `achievement:discoveryEnabled` 不能被拆成 base=achievement:discovery + pid=Enabled', () => {
    // 这是判定顺序陷阱：若实现改成"先按前缀拆"，它会被拆成 pid='Enabled'，
    // 迁移就会造出 achievement:discovery:Enabled 这种脏键，原数据读不出来。
    expect(classifyKey('achievement:discoveryEnabled')).toEqual({
      kind: 'profile-legacy',
      base: 'achievement:discoveryEnabled',
    })
  })

  it('★ `achievement:discovery` 自身就是 base，不能被拆成 base=achievement + pid=discovery', () => {
    expect(classifyKey('achievement:discovery')).toEqual({
      kind: 'profile-legacy',
      base: 'achievement:discovery',
    })
  })

  it('★ 9 个 global 键都判 global（去掉 global 判断会让它们退化 unknown，进而被额外复制一份）', () => {
    for (const key of GLOBAL_KEYS) {
      expect(classifyKey(key)).toEqual({ kind: 'global', key })
    }
  })

  it('新形态 `<base>:<pid>` 判 profile，并正确切出 profileId', () => {
    expect(classifyKey('dailyStats:p1')).toEqual({
      kind: 'profile',
      base: 'dailyStats',
      profileId: 'p1',
    })
    expect(classifyKey('achievement:discoveryEnabled:p_abc_01')).toEqual({
      kind: 'profile',
      base: 'achievement:discoveryEnabled',
      profileId: 'p_abc_01',
    })
  })

  it('★ 空后缀（`dailyStats:`）判 unknown：这是脏数据，必须走告警而不是静默当成某档案', () => {
    expect(classifyKey('dailyStats:')).toEqual({ kind: 'unknown' })
  })

  it('任何清单都没登记的键判 unknown（迁移时按 per-profile 搬 + 告警）', () => {
    expect(classifyKey('weird:thing')).toEqual({ kind: 'unknown' })
    expect(classifyKey('')).toEqual({ kind: 'unknown' })
    expect(classifyKey('dailyStatsX')).toEqual({ kind: 'unknown' })
  })
})

describe('settingsScope — 与写入端的闭环一致性', () => {
  it('★ scopedKey 写出的键必须能被 classifyKey 还原（读写两端用的是同一张表）', () => {
    for (const base of PROFILE_SCOPED_KEYS) {
      for (const pid of [DEFAULT_PROFILE_ID, 'p1', 'p_abc_01']) {
        expect(classifyKey(scopedKey(base, pid))).toEqual({
          kind: 'profile',
          base: base as ProfileScopedBase,
          profileId: pid,
        })
      }
    }
  })

  it('isProfileScoped：global 为 false，其余（含 unknown）为 true', () => {
    expect(isProfileScoped('fls:theme')).toBe(false)
    expect(isProfileScoped('profiles')).toBe(false)
    expect(isProfileScoped('dailyStats')).toBe(true)
    expect(isProfileScoped('dailyStats:p1')).toBe(true)
    // 未知键按 true 处理：迁移宁可多搬一份，也不能漏搬（漏搬用户察觉不到）
    expect(isProfileScoped('weird:thing')).toBe(true)
  })
})

describe('profileTypes — normalizeProfilesState', () => {
  const NOW = new Date('2024-05-06T07:08:09.000Z')

  it('读不到（null / 非对象 / 空 list）→ 单个 default 档案', () => {
    for (const raw of [null, undefined, 'profiles', 42, {}, { list: [] }, { list: 'x' }]) {
      const s = normalizeProfilesState(raw, NOW)
      expect(s.activeId).toBe(DEFAULT_PROFILE_ID)
      expect(s.list).toHaveLength(1)
      expect(s.list[0]).toEqual({
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        createdAt: NOW.toISOString(),
      })
    }
  })

  it('★ 重复 id 只保留第一条（两个人共用一个 id 等于共用一份数据）', () => {
    const s = normalizeProfilesState(
      {
        activeId: 'p1',
        list: [
          { id: 'p1', name: '老大', createdAt: 'c1' },
          { id: 'p1', name: '老二', createdAt: 'c2' },
        ],
      },
      NOW
    )
    expect(s.list).toHaveLength(1)
    expect(s.list[0].name).toBe('老大')
  })

  it('空 id / 纯空白 id 丢弃；丢弃后 list 为空则回落 default', () => {
    const dropped = normalizeProfilesState({ list: [{ id: '  ', name: 'x' }, { name: '无 id' }] }, NOW)
    expect(dropped.list).toHaveLength(1)
    expect(dropped.list[0].id).toBe(DEFAULT_PROFILE_ID)

    const partial = normalizeProfilesState({ list: [{ id: '  ' }, { id: 'p2' }] }, NOW)
    expect(partial.list.map((p) => p.id)).toEqual(['p2'])
    // 有效条目存在时不能回落 default
    expect(partial.activeId).toBe('p2')
  })

  it('★ activeId 不在 list 里 → 回落 list[0].id（不是硬编码 default）', () => {
    const s = normalizeProfilesState(
      { activeId: 'ghost', list: [{ id: 'p1' }, { id: 'p2' }] },
      NOW
    )
    expect(s.activeId).toBe('p1')

    const noActive = normalizeProfilesState({ list: [{ id: 'p9' }] }, NOW)
    expect(noActive.activeId).toBe('p9')

    const ok = normalizeProfilesState({ activeId: 'p2', list: [{ id: 'p1' }, { id: 'p2' }] }, NOW)
    expect(ok.activeId).toBe('p2')
  })

  it('★ 超过上限截断到 MAX_PROFILES 条（多出来的档案不能悄悄留在库里）', () => {
    const list = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}` }))
    const s = normalizeProfilesState({ activeId: 'p1', list }, NOW)
    expect(MAX_PROFILES).toBe(4)
    expect(s.list).toHaveLength(MAX_PROFILES)
    expect(s.list.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('空 / 纯空白 name → 用 id 兜底；正常 name 会被 trim', () => {
    const s = normalizeProfilesState(
      { list: [{ id: 'p1', name: '   ' }, { id: 'p2' }, { id: 'p3', name: '  小宝  ' }] },
      NOW
    )
    expect(s.list.map((p) => p.name)).toEqual(['p1', 'p2', '小宝'])
  })

  it('缺 createdAt 用 now 补，已有的原样保留', () => {
    const s = normalizeProfilesState({ list: [{ id: 'p1' }, { id: 'p2', createdAt: 'keep-me' }] }, NOW)
    expect(s.list[0].createdAt).toBe(NOW.toISOString())
    expect(s.list[1].createdAt).toBe('keep-me')
  })
})

describe('profileTypes — makeProfileId', () => {
  it('★ 固定 now/rand 时结果稳定：`p_<时间36进制>_<4位随机36进制>`', () => {
    expect(makeProfileId(new Date(0), () => 0.5)).toBe('p_0_0pa7')
    expect(makeProfileId(new Date('2024-01-02T03:04:05.000Z'), () => 0.1)).toBe('p_lqvrmnpk_0521')
  })

  it('★ 不是递增序号：同样的输入调两次得到同一个 id（序号会变成 p2）', () => {
    const a = makeProfileId(new Date(0), () => 0.5)
    const b = makeProfileId(new Date(0), () => 0.5)
    expect(a).toBe(b)
    // 序号形态（p2 / p3）会被这条挡住
    expect(a).not.toMatch(/^p\d+$/)
  })

  it('★ 随机段不同 → id 不同（两台设备各自建档案不会撞成同一个孩子）', () => {
    const now = new Date(0)
    expect(makeProfileId(now, () => 0.1)).not.toBe(makeProfileId(now, () => 0.9))
  })

  it('随机段左侧补 0 到 4 位（rand 极小时长度仍固定）', () => {
    expect(makeProfileId(new Date(0), () => 0)).toBe('p_0_0000')
  })
})

describe('profileTypes — ProfileLimitError', () => {
  it('code 是稳定的 PROFILE_LIMIT，文案里带上限数字（UI 靠它给引导文案）', () => {
    const err = new ProfileLimitError()
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('PROFILE_LIMIT')
    expect(err.name).toBe('ProfileLimitError')
    expect(err.message).toContain(String(MAX_PROFILES))
  })

  it('自定义上限时文案跟着变（不能把 4 写死在字符串里）', () => {
    expect(new ProfileLimitError(2).message).toContain('2')
  })
})
