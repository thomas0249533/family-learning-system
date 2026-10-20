import { describe, expect, it } from 'vitest'
import { deriveCustomTier, parseCustomPack, previewCustomPack } from '@core/motivation/customPack'
import {
  CUSTOM_PACK_SCHEMA_VERSION,
  MAX_ACHIEVEMENTS_PER_PACK,
  MAX_PACKS,
  type CustomAchievement,
  type CustomPack,
  type StoredPack,
  type ValidationResult,
} from '@core/motivation/customPackTypes'
import { ACHIEVEMENTS } from '@core/motivation/achievements'

/**
 * JSON 成就包校验 + 导入预览测试（V1.4 · B3 / AC-P2-1、AC-P2-2、AC-P2-4 的纯函数侧）
 *
 * 组织原则：
 *   - 校验器部分按 **错误码** 分组，做到"每个 code 至少一条用例"，
 *     将来加一个 code 而忘了写用例，review 时一眼能看出来；
 *   - 预览部分按 **三类冲突 + 升版** 分组；
 *   - 不造 db、不 mock 时间：这两块是纯函数，造了反而验不出纯度。
 *
 * 断言只许加严：错误码用 `toContain` 允许"顺带多报"（多错同报是本设计的意图），
 * 但对**必须不报**的情况（`ok: true`）一律用 `ok` 严格断言。
 */

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>

/** 一枚「合法」成就；`over` 覆盖出各种坏形态 */
function ach(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'custom::read-book',
    icon: '📖',
    title: '读完一本书',
    desc: '读完一本课外书，并说说它讲了什么',
    category: 'E',
    source: 'habit',
    rule: { kind: 'manual-check', prompt: '读完并复述了吗' },
    ...over,
  }
}

/** 一份「合法」包 */
function pack(over: AnyRecord = {}): AnyRecord {
  return {
    schemaVersion: CUSTOM_PACK_SCHEMA_VERSION,
    packId: 'home-1',
    achievements: [ach()],
    ...over,
  }
}

/** 已归一化的成就（只用于 preview / deriveCustomTier 这类吃 `CustomAchievement` 的函数） */
function ca(over: Partial<CustomAchievement> = {}): CustomAchievement {
  return {
    id: 'custom::a',
    icon: '🌱',
    title: '自定义',
    desc: '一句话描述',
    category: 'M',
    source: 'core',
    tier: 'common',
    metered: false,
    unit: '',
    noun: '',
    rule: { kind: 'manual-check', prompt: '做到了吗' },
    ...over,
  }
}

function cp(over: Partial<CustomPack> = {}): CustomPack {
  return { schemaVersion: CUSTOM_PACK_SCHEMA_VERSION, packId: 'home-1', achievements: [ca()], ...over }
}

function stored(packId: string, version: number, achievements: CustomAchievement[]): StoredPack {
  return {
    packId,
    enabled: true,
    version,
    pack: cp({ packId, achievements }),
    previous: null,
    importedAt: '2026-10-01T00:00:00.000Z',
  }
}

function codesOf(result: ValidationResult): string[] {
  return result.ok ? [] : result.errors.map((e) => e.code)
}

function pathsOf(result: ValidationResult): string[] {
  return result.ok ? [] : result.errors.map((e) => e.path)
}

function messageOf(result: ValidationResult, code: string): string {
  if (result.ok) return ''
  return result.errors.find((e) => e.code === code)?.message ?? ''
}

/** 断言通过并拿到归一化后的包（失败时把真实错误打出来，省得 debug） */
function okPack(result: ValidationResult): CustomPack {
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.path} ${e.code}: ${e.message}`).join(' | ')
    throw new Error(`期望校验通过，实际报错：${detail}`)
  }
  return result.pack
}

// ---------------------------------------------------------------------------
// 包级校验
// ---------------------------------------------------------------------------

describe('包级：E_SHAPE', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字符串', '{"schemaVersion":1}'],
    ['数字', 42],
    ['数组', []],
    ['布尔', true],
  ])('不是非 null 对象就拒：%s', (_name, raw) => {
    const res = parseCustomPack(raw)
    expect(res.ok).toBe(false)
    expect(codesOf(res)).toContain('E_SHAPE')
    expect(pathsOf(res)).toContain('$')
  })
})

describe('包级：E_SCHEMA_VERSION', () => {
  it.each([
    ['缺失', undefined],
    ['版本 2', 2],
    ['字符串 "1"', '1'],
    ['null', null],
  ])('schemaVersion 不是 1 就拒：%s', (_name, value) => {
    const base = pack()
    delete base['schemaVersion']
    const res = parseCustomPack({ ...base, schemaVersion: value })
    expect(codesOf(res)).toContain('E_SCHEMA_VERSION')
  })

  it('schemaVersion 恰好为 1 才通过', () => {
    expect(parseCustomPack(pack({ schemaVersion: 1 })).ok).toBe(true)
  })
})

describe('包级：E_PACK_ID', () => {
  it.each([
    ['缺失', undefined],
    ['空串', ''],
    ['含空格', 'home 1'],
    ['含点', 'home.1'],
    ['数字/字母开头之外的字符开头', '-home'],
    ['下划线开头', '_home'],
    ['超长（41）', 'a'.repeat(41)],
    ['数字类型', 42],
    ['中文', '家庭包'],
  ])('packId 非法就拒：%s', (_name, value) => {
    const base = pack()
    const res = parseCustomPack({ ...base, packId: value })
    expect(codesOf(res)).toContain('E_PACK_ID')
  })

  it.each(['home-1', 'Home_2', 'a', 'a'.repeat(40), 'p0'])('合法 packId 通过：%s', (packId) => {
    expect(parseCustomPack(pack({ packId })).ok).toBe(true)
  })
})

describe('包级：E_PACK_NAME', () => {
  it('name 非字符串就拒', () => {
    expect(codesOf(parseCustomPack(pack({ name: 123 })))).toContain('E_PACK_NAME')
    expect(codesOf(parseCustomPack(pack({ name: ['包'] })))).toContain('E_PACK_NAME')
  })

  it('name 超过 20 字就拒', () => {
    expect(codesOf(parseCustomPack(pack({ name: '名'.repeat(21) })))).toContain('E_PACK_NAME')
    expect(parseCustomPack(pack({ name: '名'.repeat(20) })).ok).toBe(true)
  })

  it('name 省略 / 空串都通过，空串按「没写」归一化掉', () => {
    expect(okPack(parseCustomPack(pack())).name).toBeUndefined()
    expect(okPack(parseCustomPack(pack({ name: '' }))).name).toBeUndefined()
    expect(okPack(parseCustomPack(pack({ name: '我的家庭包' }))).name).toBe('我的家庭包')
  })
})

describe('包级：E_ACHIEVEMENTS', () => {
  it.each([
    ['缺失', undefined],
    ['空数组', []],
    ['对象', { 0: ach() }],
    ['字符串', 'achievements'],
  ])('achievements 不是非空数组就拒：%s', (_name, value) => {
    const base = pack()
    const res = parseCustomPack({ ...base, achievements: value })
    expect(codesOf(res)).toContain('E_ACHIEVEMENTS')
    expect(pathsOf(res)).toContain('$.achievements')
  })
})

describe('包级：E_TOO_MANY', () => {
  it(`单包超过 ${MAX_ACHIEVEMENTS_PER_PACK} 枚就拒`, () => {
    const list = Array.from({ length: MAX_ACHIEVEMENTS_PER_PACK + 1 }, (_, i) =>
      ach({ id: `custom::a${i}` }),
    )
    const res = parseCustomPack(pack({ achievements: list }))
    expect(codesOf(res)).toContain('E_TOO_MANY')
  })

  it(`正好 ${MAX_ACHIEVEMENTS_PER_PACK} 枚通过`, () => {
    const list = Array.from({ length: MAX_ACHIEVEMENTS_PER_PACK }, (_, i) =>
      ach({ id: `custom::a${i}` }),
    )
    expect(parseCustomPack(pack({ achievements: list })).ok).toBe(true)
  })
})

describe('包级：E_TOO_MANY_PACKS', () => {
  const full = Array.from({ length: MAX_PACKS }, (_, i) =>
    stored(`p${i}`, 1, [ca({ id: `custom::p${i}` })]),
  )

  it(`已装 ${MAX_PACKS} 个包时，新 packId 被拒`, () => {
    const res = parseCustomPack(pack({ packId: 'brand-new' }), { existingPacks: full })
    expect(codesOf(res)).toContain('E_TOO_MANY_PACKS')
  })

  it('已装满但 packId 已存在 → 是升版覆盖，不占新名额', () => {
    expect(parseCustomPack(pack({ packId: 'p0' }), { existingPacks: full }).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 逐枚校验
// ---------------------------------------------------------------------------

describe('逐枚：E_ID_PREFIX', () => {
  it.each([
    ['没有前缀', 'read-book'],
    ['前缀大小写不符', 'CUSTOM::read-book'],
    ['前缀后为空', 'custom::'],
    ['缺失', undefined],
    ['数字', 42],
  ])('id 非法就拒：%s', (_name, id) => {
    const res = parseCustomPack(pack({ achievements: [ach({ id })] }))
    expect(codesOf(res)).toContain('E_ID_PREFIX')
    expect(pathsOf(res)).toContain('achievements[0].id')
  })
})

describe('逐枚：E_ID_BUILTIN（AC-P2-1）', () => {
  it('撞内置 id 被拒，且 message 里写出具体 id', () => {
    const res = parseCustomPack(pack({ achievements: [ach({ id: 'first-step', title: '撞车' })] }))
    expect(codesOf(res)).toContain('E_ID_BUILTIN')
    expect(messageOf(res, 'E_ID_BUILTIN')).toContain('first-step')
  })

  it('缺省 builtinIds 取自内置 28 枚（不用调用方传也能拦住）', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(28)
    for (const builtinId of ['first-step', 'streak-100', 'night-owl']) {
      expect(codesOf(parseCustomPack(pack({ achievements: [ach({ id: builtinId })] })))).toContain(
        'E_ID_BUILTIN',
      )
    }
  })

  it('显式注入 builtinIds 时以注入的为准（测试可缩小集合）', () => {
    const res = parseCustomPack(pack(), { builtinIds: ['custom::read-book'] })
    expect(codesOf(res)).toContain('E_ID_BUILTIN')
  })
})

describe('逐枚：E_ID_DUPLICATE', () => {
  it('同一份包内 id 重复被拒', () => {
    const res = parseCustomPack(pack({ achievements: [ach(), ach({ title: '第二枚同名' })] }))
    expect(codesOf(res)).toContain('E_ID_DUPLICATE')
    expect(pathsOf(res)).toContain('achievements[1].id')
  })

  it('id 各不相同则通过', () => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ id: 'custom::a' }), ach({ id: 'custom::b' })] }),
    )
    expect(res.ok).toBe(true)
  })
})

describe('逐枚：E_ICON', () => {
  it.each([
    ['空串', ''],
    ['两个字符', '📖📖'],
    ['空白', ' '],
    ['数字', 7],
    ['缺失', undefined],
  ])('icon 不是单个字符就拒：%s', (_name, icon) => {
    const res = parseCustomPack(pack({ achievements: [ach({ icon })] }))
    expect(codesOf(res)).toContain('E_ICON')
  })

  it('代理对 emoji（UTF-16 长度 2 但只有 1 个字符）必须通过', () => {
    expect('🧩'.length).toBe(2)
    expect(parseCustomPack(pack({ achievements: [ach({ icon: '🧩' })] })).ok).toBe(true)
    expect(parseCustomPack(pack({ achievements: [ach({ icon: '书' })] })).ok).toBe(true)
  })
})

describe('逐枚：E_TITLE', () => {
  it.each([
    ['空串', ''],
    ['纯空白', '   '],
    ['17 字', '标'.repeat(17)],
    ['数字', 42],
  ])('title 非法就拒：%s', (_name, title) => {
    const res = parseCustomPack(pack({ achievements: [ach({ title })] }))
    expect(codesOf(res)).toContain('E_TITLE')
  })

  it('16 字正好通过', () => {
    expect(parseCustomPack(pack({ achievements: [ach({ title: '标'.repeat(16) })] })).ok).toBe(true)
  })
})

describe('逐枚：E_DESC', () => {
  it.each([
    ['空串', ''],
    ['61 字', '描'.repeat(61)],
    ['缺失', undefined],
  ])('desc 非法就拒：%s', (_name, desc) => {
    const res = parseCustomPack(pack({ achievements: [ach({ desc })] }))
    expect(codesOf(res)).toContain('E_DESC')
  })

  it('60 字正好通过', () => {
    expect(parseCustomPack(pack({ achievements: [ach({ desc: '描'.repeat(60) })] })).ok).toBe(true)
  })
})

describe('逐枚：E_CATEGORY / E_SOURCE / E_TIER', () => {
  it('category 不在 M/G/B/E 就拒', () => {
    expect(codesOf(parseCustomPack(pack({ achievements: [ach({ category: 'X' })] })))).toContain(
      'E_CATEGORY',
    )
    expect(codesOf(parseCustomPack(pack({ achievements: [ach({ category: undefined })] })))).toContain(
      'E_CATEGORY',
    )
  })

  it('source 不在 core/subject/habit/hidden 就拒', () => {
    expect(codesOf(parseCustomPack(pack({ achievements: [ach({ source: 'builtin' })] })))).toContain(
      'E_SOURCE',
    )
  })

  it('tier 存在但不在白名单就拒；省略或合法值都通过', () => {
    expect(codesOf(parseCustomPack(pack({ achievements: [ach({ tier: 'legendary' })] })))).toContain(
      'E_TIER',
    )
    expect(parseCustomPack(pack({ achievements: [ach()] })).ok).toBe(true)
    expect(parseCustomPack(pack({ achievements: [ach({ tier: 'rare' })] })).ok).toBe(true)
  })
})

describe('逐枚：E_METERED', () => {
  it('metered 不是 boolean 就拒', () => {
    expect(codesOf(parseCustomPack(pack({ achievements: [ach({ metered: 1 })] })))).toContain(
      'E_METERED',
    )
    expect(codesOf(parseCustomPack(pack({ achievements: [ach({ metered: 'true' })] })))).toContain(
      'E_METERED',
    )
  })

  it('counter 规则显式写 metered: false 就拒（累计型必须可进度化）', () => {
    const res = parseCustomPack(
      pack({
        achievements: [
          ach({ metered: false, rule: { kind: 'counter', metric: 'streak', target: 7 } }),
        ],
      }),
    )
    expect(codesOf(res)).toContain('E_METERED')
  })
})

describe('逐枚：E_RULE_KIND（AC-P2-2：只有两种白名单）', () => {
  it.each([
    ['rule 缺失', undefined],
    ['rule 是字符串', 'manual-check'],
    ['未知 kind expr', { kind: 'expr', expr: 'masteredKp > 10' }],
    ['未知 kind script', { kind: 'script', script: 'return true' }],
    ['未知 kind js', { kind: 'js', code: 'alert(1)' }],
    ['kind 缺失', { prompt: '做到吗' }],
    ['kind 大小写不符', { kind: 'Manual-Check', prompt: '做到吗' }],
  ])('rule 非法就拒：%s', (_name, rule) => {
    const res = parseCustomPack(pack({ achievements: [ach({ rule })] }))
    expect(codesOf(res)).toContain('E_RULE_KIND')
  })
})

describe('逐枚：E_PROMPT', () => {
  it.each([
    ['空串', ''],
    ['纯空白', '  '],
    ['31 字', '问'.repeat(31)],
    ['缺失', undefined],
  ])('manual-check 的 prompt 非法就拒：%s', (_name, prompt) => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ rule: { kind: 'manual-check', prompt } })] }),
    )
    expect(codesOf(res)).toContain('E_PROMPT')
    expect(pathsOf(res)).toContain('achievements[0].rule.prompt')
  })

  it('30 字正好通过', () => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ rule: { kind: 'manual-check', prompt: '问'.repeat(30) } })] }),
    )
    expect(res.ok).toBe(true)
  })
})

describe('逐枚：E_METRIC', () => {
  it.each(['height', 'masteredKP', '', 42, undefined])('metric 不在白名单就拒：%s', (metric) => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ rule: { kind: 'counter', metric, target: 10 } })] }),
    )
    expect(codesOf(res)).toContain('E_METRIC')
    expect(pathsOf(res)).toContain('achievements[0].rule.metric')
  })

  it('四个白名单指标都通过', () => {
    for (const metric of ['masteredKp', 'totalAttempts', 'studyDays', 'streak']) {
      const res = parseCustomPack(
        pack({ achievements: [ach({ rule: { kind: 'counter', metric, target: 10 } })] }),
      )
      expect(res.ok, `${metric} 应通过`).toBe(true)
    }
  })
})

describe('逐枚：E_COUNTER_TARGET', () => {
  it.each([
    ['0', 0],
    ['负数', -1],
    ['小数', 1.5],
    ['字符串', '10'],
    ['缺失', undefined],
    ['Infinity', Infinity],
  ])('rule.target 不是 ≥1 的整数就拒：%s', (_name, target) => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ rule: { kind: 'counter', metric: 'masteredKp', target } })] }),
    )
    expect(codesOf(res)).toContain('E_COUNTER_TARGET')
    expect(pathsOf(res)).toContain('achievements[0].rule.target')
  })
})

// ---------------------------------------------------------------------------
// 跨字段一致性（B3 裁决，写进 PRD「自定义包字段一致性」）
// ---------------------------------------------------------------------------

describe('跨字段：manual-check 的 metered / target', () => {
  it('metered 省略 = false，此时不得出现 target → E_TARGET', () => {
    const res = parseCustomPack(pack({ achievements: [ach({ target: 2 })] }))
    expect(codesOf(res)).toContain('E_TARGET')
    expect(pathsOf(res)).toContain('achievements[0].target')
  })

  it('metered: false + target → E_TARGET', () => {
    const res = parseCustomPack(pack({ achievements: [ach({ metered: false, target: 1 })] }))
    expect(codesOf(res)).toContain('E_TARGET')
  })

  it('metered: true + target: 3 → E_TARGET_NOT_ONE（0/1 进度条只能是 1）', () => {
    const res = parseCustomPack(pack({ achievements: [ach({ metered: true, target: 3 })] }))
    expect(codesOf(res)).toContain('E_TARGET_NOT_ONE')
  })

  it('metered: true + target: 1 通过，归一化后 target 仍为 1', () => {
    const p = okPack(parseCustomPack(pack({ achievements: [ach({ metered: true, target: 1 })] })))
    expect(p.achievements[0]).toMatchObject({ metered: true, target: 1 })
  })

  it('metered: true 省略 target 也通过（归一化补成 1）', () => {
    const p = okPack(parseCustomPack(pack({ achievements: [ach({ metered: true })] })))
    expect(p.achievements[0]).toMatchObject({ metered: true, target: 1 })
  })
})

describe('跨字段：counter 的 metered / target', () => {
  const counterRuleOf = (target: number) => ({ kind: 'counter', metric: 'masteredKp', target })

  it('顶层 target 与 rule.target 不一致 → E_TARGET_MISMATCH', () => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ metered: true, target: 5, rule: counterRuleOf(10) })] }),
    )
    expect(codesOf(res)).toContain('E_TARGET_MISMATCH')
    expect(pathsOf(res)).toContain('achievements[0].target')
  })

  it('顶层 target 与 rule.target 一致则通过', () => {
    const res = parseCustomPack(
      pack({ achievements: [ach({ metered: true, target: 10, rule: counterRuleOf(10) })] }),
    )
    expect(res.ok).toBe(true)
  })

  it('counter 省略 metered 默认 true、省略 target 取 rule.target', () => {
    const p = okPack(parseCustomPack(pack({ achievements: [ach({ rule: counterRuleOf(30) })] })))
    expect(p.achievements[0]).toMatchObject({ metered: true, target: 30, tier: 'advanced' })
  })
})

// ---------------------------------------------------------------------------
// 多错同报 + 上限
// ---------------------------------------------------------------------------

describe('多错同报（家长改一轮就够了）', () => {
  it('一枚成就里的多个问题一次全报', () => {
    const res = parseCustomPack(
      pack({
        achievements: [
          ach({ id: 'nope', icon: '', title: '', desc: '', category: 'Z', source: 'x', tier: 'zzz' }),
        ],
      }),
    )
    expect(res.ok).toBe(false)
    expect(codesOf(res)).toEqual(
      expect.arrayContaining([
        'E_ID_PREFIX',
        'E_ICON',
        'E_TITLE',
        'E_DESC',
        'E_CATEGORY',
        'E_SOURCE',
        'E_TIER',
      ]),
    )
  })

  it('多枚成就的问题 + 包级问题一次全报（而不是第一枚就返回）', () => {
    const res = parseCustomPack({
      schemaVersion: 2,
      packId: 'bad id',
      achievements: [ach({ icon: '' }), ach({ id: 'custom::b', title: '' })],
    })
    expect(codesOf(res)).toEqual(
      expect.arrayContaining([
        'E_SCHEMA_VERSION',
        'E_PACK_ID',
        'E_ICON',
        'E_TITLE',
      ]),
    )
    expect(pathsOf(res)).toContain('achievements[0].icon')
    expect(pathsOf(res)).toContain('achievements[1].title')
  })

  it('报错条数上限 50（一份错乱的 JSON 不能撑爆 UI）', () => {
    const list = Array.from({ length: MAX_ACHIEVEMENTS_PER_PACK + 1 }, (_, i) =>
      ach({ id: `custom::a${i}`, icon: '', title: '', desc: '' }),
    )
    const res = parseCustomPack(pack({ achievements: list }))
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.errors).toHaveLength(50)
  })

  it('成就不是对象时按 E_SHAPE 报在 achievements[i] 上', () => {
    const res = parseCustomPack(pack({ achievements: [ach(), 'not-an-object'] }))
    expect(codesOf(res)).toContain('E_SHAPE')
    expect(pathsOf(res)).toContain('achievements[1]')
  })
})

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

describe('归一化：下游不必再判可选字段', () => {
  it('manual-check 不写 metered/target → metered=false，且 target 键**不存在**', () => {
    const p = okPack(parseCustomPack(pack()))
    const a = p.achievements[0]
    expect(a.metered).toBe(false)
    expect('target' in a).toBe(false)
    expect(a.unit).toBe('')
    expect(a.noun).toBe('')
    expect(a.tier).toBe('common')
  })

  it('counter 补齐 metered/target/unit/noun/tier', () => {
    const p = okPack(
      parseCustomPack(
        pack({ achievements: [ach({ rule: { kind: 'counter', metric: 'studyDays', target: 100 } })] }),
      ),
    )
    expect(p.achievements[0]).toEqual({
      id: 'custom::read-book',
      icon: '📖',
      title: '读完一本书',
      desc: '读完一本课外书，并说说它讲了什么',
      category: 'E',
      source: 'habit',
      metered: true,
      target: 100,
      unit: '天',
      noun: '学习',
      tier: 'rare',
      rule: { kind: 'counter', metric: 'studyDays', target: 100 },
    })
  })

  it('家长显式写的 tier 原样保留（不被推导覆盖）', () => {
    const p = okPack(
      parseCustomPack(
        pack({
          achievements: [
            ach({ tier: 'rare', rule: { kind: 'counter', metric: 'masteredKp', target: 3 } }),
          ],
        }),
      ),
    )
    expect(p.achievements[0].tier).toBe('rare')
  })

  it('家长显式写的 unit/noun 原样保留；空白值回落到指标默认值', () => {
    const kept = okPack(
      parseCustomPack(
        pack({
          achievements: [
            ach({ unit: '章', noun: '课文', rule: { kind: 'counter', metric: 'masteredKp', target: 5 } }),
          ],
        }),
      ),
    )
    expect(kept.achievements[0]).toMatchObject({ unit: '章', noun: '课文' })

    const fallback = okPack(
      parseCustomPack(
        pack({
          achievements: [
            ach({ unit: '  ', noun: '', rule: { kind: 'counter', metric: 'masteredKp', target: 5 } }),
          ],
        }),
      ),
    )
    expect(fallback.achievements[0]).toMatchObject({ unit: '个', noun: '知识点' })
  })

  it('schemaVersion 归一化为常量，warnings 出口存在且为空', () => {
    const res = parseCustomPack(pack())
    const p = okPack(res)
    expect(p.schemaVersion).toBe(CUSTOM_PACK_SCHEMA_VERSION)
    expect(res.ok && res.warnings).toEqual([])
  })

  it('通过时 achievements 顺序与条数不变', () => {
    const p = okPack(
      parseCustomPack(
        pack({ achievements: [ach({ id: 'custom::a' }), ach({ id: 'custom::b' }), ach({ id: 'custom::c' })] }),
      ),
    )
    expect(p.achievements.map((a) => a.id)).toEqual(['custom::a', 'custom::b', 'custom::c'])
  })
})

// ---------------------------------------------------------------------------
// deriveCustomTier
// ---------------------------------------------------------------------------

describe('deriveCustomTier：没有更好信号时的保守推导', () => {
  it.each([
    [1, 'common'],
    [29, 'common'],
    [30, 'advanced'],
    [99, 'advanced'],
    [100, 'rare'],
    [1000, 'rare'],
  ])('target=%i → %s', (target, tier) => {
    expect(deriveCustomTier(ca({ target }))).toBe(tier)
  })

  it('没有 target（勾了就算）→ common', () => {
    expect(deriveCustomTier(ca())).toBe('common')
  })

  it('source 为 hidden 时优先给 hidden（再大的 target 也不显形）', () => {
    expect(deriveCustomTier(ca({ source: 'hidden', target: 1000 }))).toBe('hidden')
    expect(deriveCustomTier(ca({ source: 'hidden' }))).toBe('hidden')
  })

  it('脏 target（NaN）按无 target 处理', () => {
    expect(deriveCustomTier(ca({ target: NaN }))).toBe('common')
  })
})

// ---------------------------------------------------------------------------
// previewCustomPack
// ---------------------------------------------------------------------------

const BUILTIN_SAMPLE = ['first-step', 'ten-kp', 'streak-100'] as const

describe('previewCustomPack：三类冲突 + 升版', () => {
  it('全新包：全部进 added（净新增），无冲突，replaces 为 null，retained 恒 0', () => {
    const preview = previewCustomPack(
      cp({
        achievements: [
          ca({ id: 'custom::a', title: 'A' }),
          ca({ id: 'custom::b', title: 'B', category: 'E', rule: { kind: 'counter', metric: 'streak', target: 7 } }),
        ],
      }),
      { builtinIds: BUILTIN_SAMPLE },
    )
    expect(preview).toEqual({
      packId: 'home-1',
      added: [
        { id: 'custom::a', title: 'A', category: 'M', ruleKind: 'manual-check' },
        { id: 'custom::b', title: 'B', category: 'E', ruleKind: 'counter' },
      ],
      retained: 0,
      provided: 2,
      conflicts: [],
      replaces: null,
    })
    // 新包的不变式：没有旧版本可保留 → retained 恒 0，provided 就是 added 的条数
    expect(preview.retained).toBe(0)
    expect(preview.provided).toBe(preview.added.length)
  })

  it('与内置 id 撞车 → kind: builtin，且不进 added、不计入 provided', () => {
    const preview = previewCustomPack(
      cp({ achievements: [ca({ id: 'first-step', title: '撞车' })] }),
      { builtinIds: BUILTIN_SAMPLE },
    )
    expect(preview.conflicts).toEqual([
      { id: 'first-step', title: '撞车', kind: 'builtin', with: 'first-step' },
    ])
    expect(preview.added).toEqual([])
    expect(preview.provided).toBe(0)
  })

  it('与别的已装包撞 id → kind: custom，with 是那个 packId', () => {
    const preview = previewCustomPack(cp({ achievements: [ca({ id: 'custom::a', title: 'A' })] }), {
      builtinIds: BUILTIN_SAMPLE,
      existingPacks: [stored('other-pack', 2, [ca({ id: 'custom::a' })])],
    })
    expect(preview.conflicts).toEqual([
      { id: 'custom::a', title: 'A', kind: 'custom', with: 'other-pack' },
    ])
    expect(preview.added).toEqual([])
  })

  it('同一份包内 id 重复 → kind: duplicate，with 是自己的 packId，且只进 added 一次', () => {
    const preview = previewCustomPack(
      cp({
        achievements: [
          ca({ id: 'custom::a', title: '第一次' }),
          ca({ id: 'custom::a', title: '第二次' }),
        ],
      }),
      { builtinIds: BUILTIN_SAMPLE },
    )
    expect(preview.conflicts).toEqual([
      { id: 'custom::a', title: '第二次', kind: 'duplicate', with: 'home-1' },
    ])
    expect(preview.added.map((a) => a.id)).toEqual(['custom::a'])
  })

  it('内置优先于 custom（同一 id 既撞内置又在别人的包里 → builtin）', () => {
    const preview = previewCustomPack(cp({ achievements: [ca({ id: 'first-step', title: 'X' })] }), {
      builtinIds: BUILTIN_SAMPLE,
      existingPacks: [stored('other-pack', 1, [ca({ id: 'first-step' })])],
    })
    expect(preview.conflicts).toHaveLength(1)
    expect(preview.conflicts[0]).toMatchObject({ kind: 'builtin', with: 'first-step' })
  })

  it('同 packId 已装 → replaces 带 fromVersion（升版）；保留的卡不进 added', () => {
    const preview = previewCustomPack(cp({ achievements: [ca({ id: 'custom::a' })] }), {
      builtinIds: BUILTIN_SAMPLE,
      existingPacks: [stored('home-1', 3, [ca({ id: 'custom::a' })])],
    })
    expect(preview.replaces).toEqual({ packId: 'home-1', fromVersion: 3 })
    expect(preview.added).toEqual([])
    expect(preview.retained).toBe(1)
    expect(preview.provided).toBe(1)
  })

  it('升版时与旧版本共有的 id 不算冲突（旧版本自己也被 ignore），且算 retained', () => {
    const preview = previewCustomPack(
      cp({ achievements: [ca({ id: 'custom::a' }), ca({ id: 'custom::new' })] }),
      {
        builtinIds: BUILTIN_SAMPLE,
        existingPacks: [
          stored('home-1', 1, [ca({ id: 'custom::a' }), ca({ id: 'custom::removed' })]),
          stored('other-pack', 1, [ca({ id: 'custom::x' })]),
        ],
      },
    )
    expect(preview.conflicts).toEqual([])
    // 净新增：只有 genuinely 新的那一枚；共有的那枚算"保留"
    expect(preview.added.map((a) => a.id)).toEqual(['custom::new'])
    expect(preview.retained).toBe(1)
    expect(preview.provided).toBe(2)
    expect(preview.replaces).toEqual({ packId: 'home-1', fromVersion: 1 })
  })

  it('升版净新增计数：旧版 3 枚（留 2 删 1）+ 新增 1 枚 → added 1 / retained 2 / provided 3', () => {
    const preview = previewCustomPack(
      cp({
        achievements: [
          // 与旧版同 id，只改了标题 —— 仍是同一张卡，不算新增
          ca({ id: 'custom::keep-a', title: '改了标题' }),
          ca({ id: 'custom::keep-b' }),
          ca({ id: 'custom::brand-new' }),
        ],
      }),
      {
        builtinIds: BUILTIN_SAMPLE,
        existingPacks: [
          stored('home-1', 4, [
            ca({ id: 'custom::keep-a', title: '旧标题' }),
            ca({ id: 'custom::keep-b' }),
            ca({ id: 'custom::dropped' }),
          ]),
        ],
      },
    )
    expect(preview.added.map((a) => a.id)).toEqual(['custom::brand-new'])
    expect(preview.retained).toBe(2)
    expect(preview.provided).toBe(3)
    // 恒等式：任何情况下 provided 都等于"净新增 + 保留"
    expect(preview.provided).toBe(preview.added.length + preview.retained)
    expect(preview.replaces).toEqual({ packId: 'home-1', fromVersion: 4 })
  })

  it('纯函数：同一输入重复调用结果完全一致', () => {
    const input = cp({ achievements: [ca({ id: 'custom::a' })] })
    const opts = { builtinIds: BUILTIN_SAMPLE, existingPacks: [stored('home-1', 2, [])] }
    expect(previewCustomPack(input, opts)).toEqual(previewCustomPack(input, opts))
  })

  it('不传 existingPacks 时 replaces 为 null 且不抛错', () => {
    const preview = previewCustomPack(cp(), { builtinIds: BUILTIN_SAMPLE })
    expect(preview.replaces).toBeNull()
    expect(preview.added).toHaveLength(1)
  })
})

describe('校验 + 预览的端到端衔接', () => {
  it('校验通过的包可以直接喂给 preview，字段都对得上', () => {
    const p = okPack(
      parseCustomPack(
        pack({
          packId: 'home-2',
          name: '我的包',
          achievements: [
            ach({ id: 'custom::a', title: 'A' }),
            ach({ id: 'custom::b', title: 'B', rule: { kind: 'counter', metric: 'streak', target: 7 } }),
          ],
        }),
      ),
    )
    const preview = previewCustomPack(p, { builtinIds: BUILTIN_SAMPLE })
    expect(preview.packId).toBe('home-2')
    expect(preview.added).toEqual([
      { id: 'custom::a', title: 'A', category: 'E', ruleKind: 'manual-check' },
      { id: 'custom::b', title: 'B', category: 'E', ruleKind: 'counter' },
    ])
  })
})
