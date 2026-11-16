import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalSnapshot } from '@core/backup/types'

/**
 * P0-1 · 隐藏学习包数据层回归测试
 *
 * ## 这个文件在守什么
 * 隐藏态最贵的失败模式是**安静地反向**：
 *   1. "取消隐藏"写成删 key → 旧备份里的 hidden:true 在下次合并时把包重新藏起来；
 *   2. 合并用"本机优先" → 两台设备各藏不同的包，只活下来一边；
 *   3. 漏登记 GLOBAL_KEYS → classifyKey 判 unknown，planMerge 直接跳过，用户以为同步了；
 *   4. 每次导入都重写 → 预览永远显示"发现新数据"，家长不再信这个提示。
 * 四条都不崩、不报错，只表现为"隐藏状态自己乱变"，所以必须逐条钉死。
 */
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const {
  HIDDEN_PACKAGES_KEY,
  emptyHiddenPackages,
  normalizeHiddenPackages,
  isPackageHidden,
  hiddenPackageCount,
  applyHidden,
  mergeHiddenPackages,
  loadHiddenPackages,
  savePackageHidden,
  setHiddenPackages,
} = await import('@core/settings/hiddenPackages')

const { GLOBAL_KEYS, classifyKey } = await import('@core/profile/settingsScope')
const { planMerge } = await import('@core/merge/mergeBundle')

const T1 = '2026-01-01T10:00:00.000Z'
const T2 = '2026-02-01T10:00:00.000Z'
const T3 = '2026-03-01T10:00:00.000Z'

function snap(globalSettings: Record<string, unknown> = {}): LocalSnapshot {
  return { profiles: [], activeProfileId: 'default', bundles: [], globalSettings }
}

function state(items: Record<string, { hidden: boolean; at: string }>) {
  return { v: 1 as const, items }
}

function planWith(localRaw: unknown, remoteRaw: unknown) {
  return planMerge(
    localRaw === undefined ? snap() : snap({ [HIDDEN_PACKAGES_KEY]: localRaw }),
    [],
    T3,
    { [HIDDEN_PACKAGES_KEY]: remoteRaw },
  )
}

beforeEach(() => fake.__reset())

describe('零抛归一化', () => {
  it('null / 非对象 / 数组 / 缺 items → 空状态，一个都不抛', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}, { items: null }, { items: [] }, { items: 'x' }]) {
      expect(normalizeHiddenPackages(raw)).toEqual(emptyHiddenPackages())
    }
  })

  it('★ 脏条目被丢掉：hidden 非 boolean / at 空或非字符串 / 空 packageId', () => {
    const out = normalizeHiddenPackages({
      v: 2,
      items: {
        good: { hidden: true, at: T1 },
        badFlag: { hidden: 'true', at: T1 },
        badAt: { hidden: true, at: 123 },
        emptyAt: { hidden: false, at: '' },
        '': { hidden: true, at: T1 },
        nil: null,
      },
    })
    expect(out).toEqual(state({ good: { hidden: true, at: T1 } }))
    // v 永远收敛到 1，不跟着脏数据走
    expect(out.v).toBe(1)
  })

  it('items 键序稳定（合并后 JSON 逐字节比较才不会因为键序反复重写）', () => {
    const raw = state({ zeta: { hidden: true, at: T1 }, alpha: { hidden: false, at: T2 } })
    expect(Object.keys(normalizeHiddenPackages(raw).items)).toEqual(['alpha', 'zeta'])
  })

  it('归一化不改入参', () => {
    const raw = state({ p: { hidden: true, at: T1 } })
    normalizeHiddenPackages(raw)
    expect(raw).toEqual(state({ p: { hidden: true, at: T1 } }))
  })
})

describe('查询与原地写入', () => {
  it('isPackageHidden 只看 hidden，墓碑一律 false；空 id 为 false', () => {
    const s = state({
      p: { hidden: true, at: T1 },
      q: { hidden: false, at: T2 },
    })
    expect(isPackageHidden(s, 'p')).toBe(true)
    expect(isPackageHidden(s, 'q')).toBe(false)
    expect(isPackageHidden(s, 'never')).toBe(false)
    expect(isPackageHidden(s, '')).toBe(false)
  })

  it('hiddenPackageCount 不数墓碑', () => {
    expect(hiddenPackageCount(state({
      p: { hidden: true, at: T1 },
      q: { hidden: false, at: T2 },
      r: { hidden: true, at: T3 },
    }))).toBe(2)
    expect(hiddenPackageCount(emptyHiddenPackages())).toBe(0)
  })

  it('applyHidden 返回新状态，不改入参', () => {
    const s = state({ p: { hidden: true, at: T1 } })
    const next = applyHidden(s, 'q', true, T2)
    expect(next).toEqual(state({
      p: { hidden: true, at: T1 },
      q: { hidden: true, at: T2 },
    }))
    expect(s).toEqual(state({ p: { hidden: true, at: T1 } }))
  })

  it('★ 同一个 at 上写入走"看得见优先"，与合并器同一规则', () => {
    const visible = applyHidden(state({ p: { hidden: false, at: T1 } }), 'p', true, T1)
    expect(visible.items.p.hidden).toBe(false)
    const hidden = applyHidden(state({ p: { hidden: true, at: T1 } }), 'p', false, T1)
    expect(hidden.items.p.hidden).toBe(false)
  })

  it('非法入参原样返回（零抛、不写脏数据）', () => {
    const s = state({ p: { hidden: true, at: T1 } })
    expect(applyHidden(s, '', true, T2)).toBe(s)
    expect(applyHidden(s, 'p', true, '')).toBe(s)
  })
})

describe('逐项 LWW', () => {
  it('★ 两台设备各藏不同的包 → 并集，谁也不丢', () => {
    const merged = mergeHiddenPackages(
      state({ oldZh: { hidden: true, at: T1 } }),
      state({ oldEn: { hidden: true, at: T2 } }),
    )
    expect(isPackageHidden(merged, 'oldZh')).toBe(true)
    expect(isPackageHidden(merged, 'oldEn')).toBe(true)
    expect(hiddenPackageCount(merged)).toBe(2)
  })

  it('远端更新 → 远端胜（两个方向）', () => {
    expect(mergeHiddenPackages(
      state({ p: { hidden: true, at: T1 } }),
      state({ p: { hidden: false, at: T2 } }),
    ).items.p).toEqual({ hidden: false, at: T2 })

    expect(mergeHiddenPackages(
      state({ p: { hidden: false, at: T2 } }),
      state({ p: { hidden: true, at: T3 } }),
    ).items.p).toEqual({ hidden: true, at: T3 })
  })

  it('本机更新 → 本机胜（旧备份不能把隐藏状态改回去）', () => {
    expect(mergeHiddenPackages(
      state({ p: { hidden: false, at: T3 } }),
      state({ p: { hidden: true, at: T1 } }),
    ).items.p).toEqual({ hidden: false, at: T3 })
  })

  it('★ at 相同取 hidden:false（看得见优先）', () => {
    expect(mergeHiddenPackages(
      state({ p: { hidden: true, at: T1 } }),
      state({ p: { hidden: false, at: T1 } }),
    ).items.p).toEqual({ hidden: false, at: T1 })
    // 对称
    expect(mergeHiddenPackages(
      state({ p: { hidden: false, at: T1 } }),
      state({ p: { hidden: true, at: T1 } }),
    ).items.p.hidden).toBe(false)
    // 两边都 true 才是 true
    expect(mergeHiddenPackages(
      state({ p: { hidden: true, at: T1 } }),
      state({ p: { hidden: true, at: T1 } }),
    ).items.p.hidden).toBe(true)
  })

  it('★ 墓碑能压住旧备份的 hidden:true（"取消后又自己藏起来"的反例）', () => {
    const a = state({ p: { hidden: true, at: T1 } })
    const b = state({ p: { hidden: false, at: T2 } })
    expect(mergeHiddenPackages(a, b)).toEqual(b)
    // 再合一次旧的 A，仍然是看得见
    expect(isPackageHidden(mergeHiddenPackages(b, a), 'p')).toBe(false)
  })

  it('一侧缺失 / 脏数据不抛，按只有一侧处理', () => {
    expect(mergeHiddenPackages(undefined, state({ p: { hidden: true, at: T1 } })))
      .toEqual(state({ p: { hidden: true, at: T1 } }))
    expect(mergeHiddenPackages(state({ p: { hidden: true, at: T1 } }), null))
      .toEqual(state({ p: { hidden: true, at: T1 } }))
  })

  it('幂等且键序稳定：merge(s, s) 逐字节等于 s', () => {
    const s = state({
      zeta: { hidden: true, at: T1 },
      alpha: { hidden: false, at: T2 },
    })
    const normalized = normalizeHiddenPackages(s)
    expect(JSON.stringify(mergeHiddenPackages(s, s))).toBe(JSON.stringify(normalized))
  })

  it('不改入参', () => {
    const a = state({ p: { hidden: true, at: T1 } })
    const b = state({ q: { hidden: true, at: T2 } })
    mergeHiddenPackages(a, b)
    expect(a).toEqual(state({ p: { hidden: true, at: T1 } }))
    expect(b).toEqual(state({ q: { hidden: true, at: T2 } }))
  })
})

describe('fakeDexie 往返', () => {
  it('空库读出空状态，不写任何键', async () => {
    expect(await loadHiddenPackages()).toEqual(emptyHiddenPackages())
    expect(await fake.settings.toArray()).toEqual([])
  })

  it('★ 取消隐藏写墓碑，不删 key 也不删条目', async () => {
    await savePackageHidden('oldZh', true)
    const hidden = await loadHiddenPackages()
    expect(isPackageHidden(hidden, 'oldZh')).toBe(true)

    await savePackageHidden('oldZh', false)
    const rec = await fake.settings.get(HIDDEN_PACKAGES_KEY)
    expect(rec).toBeTruthy()
    expect(rec?.key).toBe(HIDDEN_PACKAGES_KEY)
    expect(rec?.value.items.oldZh.hidden).toBe(false)
    expect(typeof rec?.value.items.oldZh.at).toBe('string')
    expect(Object.keys((await loadHiddenPackages()).items)).toContain('oldZh')
  })

  it('savePackageHidden 多次写入只占一个 settings 键', async () => {
    await savePackageHidden('p1', true)
    await savePackageHidden('p2', true)
    await savePackageHidden('p1', false)
    expect((await fake.settings.toArray()).length).toBe(1)
  })

  it('setHiddenPackages 整表替换：新集合之外的旧隐藏项写墓碑', async () => {
    await savePackageHidden('a', true)
    await savePackageHidden('b', true)
    const next = await setHiddenPackages(['a', 'c'])
    expect(isPackageHidden(next, 'a')).toBe(true)
    expect(isPackageHidden(next, 'c')).toBe(true)
    expect(isPackageHidden(next, 'b')).toBe(false)
    expect(next.items.b.at).toBeTruthy()
    expect(await loadHiddenPackages()).toEqual(next)
  })

  it('setHiddenPackages 去重、过滤空白 id', async () => {
    const next = await setHiddenPackages(['p', 'p', '  ', '', 'q'])
    expect(Object.keys(next.items).sort()).toEqual(['p', 'q'])
  })

  it('读失败 fail-open：书架宁可多显示一个包，也不能整个打不开', async () => {
    fake.failOn.add(`get:settings`)
    expect(await loadHiddenPackages()).toEqual(emptyHiddenPackages())
  })

  it('写失败必须抛，不能假装隐藏成功', async () => {
    fake.failOn.add('put:settings')
    await expect(savePackageHidden('p', true)).rejects.toThrow(/settings\.put/)
  })
})

describe('与 planMerge 集成', () => {
  it('★ 已登记为 global（漏登记会让第 4 段 classifyKey 直接跳过，且不报错）', () => {
    expect(GLOBAL_KEYS).toContain(HIDDEN_PACKAGES_KEY)
    expect(classifyKey(HIDDEN_PACKAGES_KEY)).toEqual({ kind: 'global', key: HIDDEN_PACKAGES_KEY })
  })

  it('本机缺失 → 整份远端隐藏表写入，键不加 :pid 后缀', () => {
    const plan = planWith(undefined, state({ p: { hidden: true, at: T1 } }))
    expect(plan.settingUpserts).toEqual([{
      key: HIDDEN_PACKAGES_KEY,
      value: state({ p: { hidden: true, at: T1 } }),
    }])
    expect(plan.stats.settingsChanged).toBe(1)
    expect(plan.stats.noop).toBe(false)
  })

  it('★ 两台设备各藏一个包 → 合并后两个都在（本机优先会丢远端那个）', () => {
    const plan = planWith(
      state({ a: { hidden: true, at: T1 } }),
      state({ b: { hidden: true, at: T2 } }),
    )
    expect(plan.settingUpserts).toHaveLength(1)
    const value = plan.settingUpserts[0].value
    expect(isPackageHidden(value, 'a')).toBe(true)
    expect(isPackageHidden(value, 'b')).toBe(true)
  })

  it('★ 远端墓碑赢过本机旧的 hidden:true', () => {
    const plan = planWith(
      state({ p: { hidden: true, at: T1 } }),
      state({ p: { hidden: false, at: T2 } }),
    )
    expect(plan.settingUpserts[0].value.items.p).toEqual({ hidden: false, at: T2 })
  })

  it('本机更新赢过远端旧备份', () => {
    const plan = planWith(
      state({ p: { hidden: false, at: T3 } }),
      state({ p: { hidden: true, at: T1 } }),
    )
    expect(plan.settingUpserts).toHaveLength(0)
    expect(plan.stats.settingsKeptLocal).toBe(1)
    expect(plan.stats.noop).toBe(true)
  })

  it('at 相同时导入取 hidden:false', () => {
    const plan = planWith(
      state({ p: { hidden: true, at: T1 } }),
      state({ p: { hidden: false, at: T1 } }),
    )
    expect(plan.settingUpserts[0].value.items.p.hidden).toBe(false)
  })

  it('★ 幂等：合并结果写回本机后再导入 → 空计划', () => {
    const local = state({ a: { hidden: true, at: T1 } })
    const remote = state({ b: { hidden: true, at: T2 }, a: { hidden: false, at: T3 } })
    const first = planWith(local, remote)
    expect(first.settingUpserts).toHaveLength(1)

    const merged = first.settingUpserts[0].value
    const second = planWith(merged, remote)
    expect(second.settingUpserts).toEqual([])
    expect(second.stats.settingsKeptLocal).toBe(1)
    expect(second.stats.noop).toBe(true)
  })

  it('本机值键序不同但内容相同 → 不重写（JSON 逐字节比较踩的坑）', () => {
    const plan = planWith(
      { v: 1, items: { zeta: { hidden: true, at: T1 }, alpha: { hidden: false, at: T2 } } },
      state({ alpha: { hidden: false, at: T2 }, zeta: { hidden: true, at: T1 } }),
    )
    expect(plan.settingUpserts).toEqual([])
    expect(plan.stats.noop).toBe(true)
  })

  it('远端值脏数据不抛，按空表处理', () => {
    const plan = planWith(undefined, { v: 2, items: { p: { hidden: 'yes', at: T1 } } })
    expect(plan.settingUpserts).toEqual([])
    expect(plan.stats.noop).toBe(true)
  })
})
