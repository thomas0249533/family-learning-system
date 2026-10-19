import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 启动期"孤儿行"重归因（V1.3 · E-01 收尾）。
 *
 * 为什么能测：真正的钩子在 `src/main.ts`（模块顶层就 `createApp` + `router`）。
 * vitest 是 **node 环境、没有 jsdom / @vue/test-utils**，组件与入口模块都挂不起来，
 * 所以钩子里可测的部分被抽成了 `runStartupOrphanRecovery()` —— 它就是钩子唯一调用的东西。
 *
 * 假 db 的写法照抄 `tests/progress-migrate.test.ts`：只实现 `toArray / get / put / delete`
 * 与 `transaction`，不引 fake-indexeddb。
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, any>

  const state = {
    packages: [] as Row[],
    progress: [] as Row[],
    settings: [] as Row[],
    /** 写入顺序日志：`put:progress` / `delete:progress` / `put:settings` … */
    writes: [] as string[],
    /** 写进 settings 的 key 顺序：用来断言"全程没写 migration:v3" */
    settingKeys: [] as string[],
  }

  const KEY: Record<string, (r: Row) => any> = {
    packages: (r) => r.packageId,
    progress: (r) => r.id,
    settings: (r) => r.key,
  }

  const throwOn = {
    toArray: {} as Record<string, boolean>,
    get: {} as Record<string, boolean>,
    put: {} as Record<string, boolean>,
  }

  function api(name: 'packages' | 'progress' | 'settings') {
    return {
      async toArray() {
        if (throwOn.toArray[name]) throw new Error(`fake db: ${name}.toArray 失败`)
        return state[name].map((r) => ({ ...r }))
      },
      async get(k: any) {
        if (throwOn.get[name]) throw new Error(`fake db: ${name}.get 失败`)
        return state[name].find((r) => KEY[name](r) === k)
      },
      async put(v: Row) {
        state.writes.push(`put:${name}`)
        if (throwOn.put[name]) throw new Error(`fake db: ${name}.put 失败`)
        const k = KEY[name](v)
        if (name === 'settings') state.settingKeys.push(k)
        const i = state[name].findIndex((r) => KEY[name](r) === k)
        if (i >= 0) state[name][i] = { ...v }
        else state[name].push({ ...v })
        return k
      },
      async delete(k: any) {
        state.writes.push(`delete:${name}`)
        const i = state[name].findIndex((r) => KEY[name](r) === k)
        if (i >= 0) state[name].splice(i, 1)
      },
    }
  }

  const db = {
    packages: api('packages'),
    progress: api('progress'),
    settings: api('settings'),
    /** 只支持本文件用到的形态；`fn` 永远是最后一个参数 */
    async transaction(_mode: any, ...args: any[]) {
      const fn = args[args.length - 1]
      return fn({ table: (n: any) => api(n) })
    },
  }

  return {
    db,
    state,
    throwOn,
    reset() {
      state.packages = []
      state.progress = []
      state.settings = []
      state.writes = []
      state.settingKeys = []
      throwOn.toArray = {}
      throwOn.get = {}
      throwOn.put = {}
    },
  }
})

/** 观测点：`ensureE1Migrated` 被调了几次、要不要抛错 */
const ctl = vi.hoisted(() => ({
  ensureCalls: 0,
  throwOnEnsure: false,
}))

vi.mock('@/db', () => ({ db: fake.db }))

/**
 * 只替换 `ensureE1Migrated`：
 *   - 计数 → 验证"同一进程内只真正执行一次"；
 *   - 可让它抛错 → 验证启动流程不 throw（真实实现内部吞异常，抛不出来，只能这样制造）。
 * 其余（标记读取、`RECOVERY_KEY`、单飞锁）保持真实实现。
 */
vi.mock('@core/storage/migrateV3Recovery', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/storage/migrateV3Recovery')>()
  return {
    ...real,
    async ensureE1Migrated(opts: { orphanOnly?: boolean; mode?: 'import' | 'restore' | 'startup' } = {}) {
      ctl.ensureCalls += 1
      if (ctl.throwOnEnsure) throw new Error('fake: ensureE1Migrated 抛错')
      return real.ensureE1Migrated(opts)
    },
  }
})

const { runStartupOrphanRecovery, shouldRunOrphanRecovery, STARTUP_RECOVERY_KEY } = await import(
  '@core/storage/startupOrphanRecovery'
)
const { MIGRATION_KEY } = await import('@core/storage/migrateV3')
const { RECOVERY_KEY } = await import('@core/storage/migrateV3Recovery')
const { localDayKey } = await import('@core/motivation/streak')

// ---------- 夹具 ----------

function makePackage(packageId: string, subject: string, kpIds: string[]) {
  return {
    packageId,
    manifest: { packageId, subject, type: 'unit', title: packageId },
    knowledgePoints: kpIds.map((id) => ({ id, title: id })),
    exercises: [],
    units: [],
  }
}

/** 一行"挂在入口包上"的进度；`entry` 已被卸载时即为孤儿行 */
function row(id: number, entryPackageId: string, kpId: string) {
  return {
    id,
    packageId: entryPackageId,
    knowledgePointId: kpId,
    status: '学习中',
    correctCount: 2,
    wrongCount: 0,
    correctStreak: 2,
    wrongStreak: 0,
    lastStudiedAt: '2026-10-01T00:00:00.000Z',
    studySeconds: 60,
    reviewStage: 0,
    nextReviewAt: '2026-10-03T00:00:00.000Z',
    lastReviewAt: '2026-10-01T00:00:00.000Z',
  }
}

/** unit-p1 声明 kp；special-x 是入口包（自己不声明任何 kp） */
function seedPackages() {
  fake.state.packages.push(
    makePackage('unit-p1', 'english', ['unit-p1::kp1', 'unit-p1::kp2']),
    makePackage('special-x', 'english', [])
  )
}

beforeEach(() => {
  fake.reset()
  ctl.ensureCalls = 0
  ctl.throwOnEnsure = false
})

// ---------- 纯函数：一天一次 ----------

describe('shouldRunOrphanRecovery — 一天最多一次', () => {
  it.each([
    [null, '2026-10-19', true, '从未跑过'],
    [undefined, '2026-10-19', true, '从未跑过（undefined）'],
    ['', '2026-10-19', true, '脏值当成没跑过'],
    ['2026-10-18', '2026-10-19', true, '昨天跑过 → 今天要跑'],
    ['2026-10-19', '2026-10-19', false, '今天跑过 → 跳过'],
  ] as const)('%#: lastDay=%j today=%s → %s（%s）', (lastDay, today, expected) => {
    expect(shouldRunOrphanRecovery(lastDay, today)).toBe(expected)
  })

  it('拿不到今天的日期键 → 不动（宁可少跑一次）', () => {
    expect(shouldRunOrphanRecovery(null, '')).toBe(false)
  })
})

// ---------- 启动流程 ----------

describe('runStartupOrphanRecovery — 启动期重归因', () => {
  it('★ 把孤儿行归因到**声明它**的包', async () => {
    seedPackages()
    // gone-pkg 已被卸载：行里还挂着它，packages 表里已经没有它
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))

    const stats = await runStartupOrphanRecovery()

    expect(stats?.rewritten).toBe(1)
    expect(fake.state.progress[0].packageId).toBe('unit-p1')
    expect(fake.state.progress[0].knowledgePointId).toBe('unit-p1::kp1')
  })

  it('★ 全程没有 settings.put("migration:v3")：failed 标记也保持原样', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))
    const failed = { status: 'failed', at: 'x', error: 'boom', attempts: 0 }
    fake.state.settings.push({ key: MIGRATION_KEY, value: failed })

    await runStartupOrphanRecovery()

    // 一次性版本迁移的语义不许被日常动作改写（含 attempts 递增）
    expect(fake.state.settingKeys).not.toContain(MIGRATION_KEY)
    expect(fake.state.settings.find((s) => s.key === MIGRATION_KEY)!.value).toEqual(failed)
    // 但孤儿行照样被归因：两件事互不依赖
    expect(fake.state.progress[0].packageId).toBe('unit-p1')
    // 自己的"今天跑过了"记录写上了，日期用**本地口径**
    expect(fake.state.settings.find((s) => s.key === STARTUP_RECOVERY_KEY)!.value.day).toBe(localDayKey())
  })

  it('★ 启动触发的那次在 progress:lastRecovery 里记 mode:"startup"（不再误标成 import）', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))

    await runStartupOrphanRecovery()

    const rec = fake.state.settings.find((s) => s.key === RECOVERY_KEY)!
    expect(rec.value.mode).toBe('startup')
    expect(rec.value.stats.rewritten).toBe(1)
  })

  it('★ ensureE1Migrated 抛错 → 启动流程不 throw，且不记"今天已跑过"', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))
    ctl.throwOnEnsure = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(runStartupOrphanRecovery()).resolves.toBeNull()

    expect(warn).toHaveBeenCalled()
    // 没记标记 → 下次启动会再试一次（而不是永远放弃）
    expect(fake.state.settings.find((s) => s.key === STARTUP_RECOVERY_KEY)).toBeUndefined()
    warn.mockRestore()
  })

  it('★ 同一进程内重复触发只真正执行一次（可观测的 progress 写次数为 1）', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))

    const first = await runStartupOrphanRecovery()
    expect(first?.rewritten).toBe(1)
    expect(fake.state.writes.filter((w) => w === 'put:progress')).toHaveLength(1)

    const writesAfterFirst = fake.state.writes.length
    const callsAfterFirst = ctl.ensureCalls
    expect(callsAfterFirst).toBe(1)

    // 同一天再触发：直接跳过，一次写都不发生
    await expect(runStartupOrphanRecovery()).resolves.toBeNull()
    expect(ctl.ensureCalls).toBe(callsAfterFirst)
    expect(fake.state.writes.length).toBe(writesAfterFirst)
    expect(fake.state.writes.filter((w) => w === 'put:progress')).toHaveLength(1)
    expect(fake.state.progress[0].packageId).toBe('unit-p1')
  })

  it('★ 并发触发（同一次启动里两个调用）→ 共用同一个 promise，只跑一次', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))

    const [a, b] = await Promise.all([runStartupOrphanRecovery(), runStartupOrphanRecovery()])

    expect(ctl.ensureCalls).toBe(1)
    expect(fake.state.writes.filter((w) => w === 'put:progress')).toHaveLength(1)
    expect(a).toBe(b)
  })

  it('没有孤儿行 → 一次 progress 写都不发生（零计划不起写事务）', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'unit-p1', 'unit-p1::kp1'))

    const stats = await runStartupOrphanRecovery()

    expect(stats?.rewritten).toBe(0)
    expect(fake.state.writes.filter((w) => w.includes('progress'))).toEqual([])
    // 只多了一条"今天跑过了"，避免下次开窗再扫全表
    expect(fake.state.settingKeys).toEqual([STARTUP_RECOVERY_KEY])
  })

  it('今天已经跑过 → 连扫表都不扫（不写、不改）', async () => {
    seedPackages()
    fake.state.progress.push(row(1, 'gone-pkg', 'unit-p1::kp1'))
    fake.state.settings.push({
      key: STARTUP_RECOVERY_KEY,
      value: { day: localDayKey(), at: 'x', stats: {} },
    })

    await expect(runStartupOrphanRecovery()).resolves.toBeNull()

    expect(ctl.ensureCalls).toBe(0)
    expect(fake.state.writes).toEqual([])
    expect(fake.state.progress[0].packageId).toBe('gone-pkg')
  })
})
