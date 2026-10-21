/**
 * 假 Dexie 替身（V1.6 · Stage A · A2）—— 单一真相
 *
 * ## 为什么要有这个文件
 * 此前 7 个测试文件各自内联一份假 db（A2 收掉 6 份，A6 把
 * `migrate-jump-path.test.ts` 的第 7 份也收进来）。它们**都**做到了
 * "未知索引抛错"，但索引清单是各写一份的：`src/db/index.ts` bump 到 v5 时，
 * 改漏任何一份，那个文件里的查询就会静默 fallback 到"按字段比较"，
 * 看起来还在跑，实际上已经不代表真实索引行为了 —— 正是 A2 要堵的"假通过"。
 *
 * 抽出来之后：**索引清单只有一份**（`V4_INDICES`，与 `version(4)` 逐字对应），
 * 未知索引抛错也只有一份实现；`fakeDexie-guard.test.ts` 还会把清单与
 * `src/db/index.ts` 原文逐字比对，schema 一改不同步就红。
 *
 * ## 与真实 Dexie 的差异（刻意为之，别"修"）
 * 1. **没有查询计划器**。`where(idx).equals(v)` 就是"按索引字段逐行比"。
 *    真 Dexie 会用 B-tree，我们只关心**语义**（哪些行被选中），不关心性能。
 * 2. **事务是手写快照**：提交前备份涉及表的 `rows`，抛错时整张还原。
 *    这近似而非等价于 Dexie 的 ACID（不处理并发与部分失败），
 *    但对"apply 中途抛错不能留下半截数据"这类断言足够。
 * 3. **`where` 只支持 `.equals(v).first()/toArray()`**。
 *    生产代码用到的 `.reverse()/.sortBy()/.and()/.modify()` 一概没有 ——
 *    真用到了会让测试**炸**，而不是安静地换一条语义，这正是想要的效果。
 * 4. **`equals()` 的形参校验比真库严**（V1.6 · A6 补牙，专抓"少传 profileId"）：
 *    - 复合索引必须传**长度等于元数的数组**。真库对短数组是"静默空结果"
 *      （查询永远查不到、不报错），对传标量更是直接空 —— 这里一律抛错。
 *      漏掉 `profileId` 是 V1.4 · B1 之后最高频的回归形态，必须炸。
 *    - 单列索引传数组抛错（真库静默空；旧替身按首字段比，会**多返**）。
 *    - `equals(null/undefined)` 抛错（真库 reject；旧替身会匹配"字段为
 *      undefined 的行"，纯静默 fallback）。
 * 5. **`add()` 撞主键抛错**（真库 ConstraintError）。旧替身静默插入第二行
 *    同 id 行 —— "upsert 被写成 add" 这类缺陷因此假通过。
 * 6. **v4 索引形态下，progress / mistakes / examSessions 每行必须带非空
 *    `profileId`**（真库不校验，但项目规则是必填：夹具漏了的测试在单档案下
 *    照样全绿，正是 A2 要堵的静默串数据）。测老数据夹具传
 *    `overrides.<table>.requireProfileId = false` 显式豁免。
 * 7. **读接口返回浅拷贝**（真库是结构化克隆）：`first()/get()/toArray()`
 *    改返回值顶层字段不污染库；嵌套对象仍共享引用 —— 生产代码全都
 *    `toPlain` 过，碰不到这一层。
 *
 * ## 怎么用
 * ```ts
 * import { createFakeDexie } from './helpers/fakeDexie'
 *
 * const fake = createFakeDexie()
 * vi.mock('@/db', () => ({ db: fake.db }))          // 工厂是懒执行的，此时 fake 已赋值
 * const { useUserDataStore } = await import('@core/stores/userData')
 *
 * fake.progress.add(row(1, 'p', 'k'))
 * fake.settings.get('dailyStats:default')
 * fake.failOn.add('put:progress')                    // 注入 IO 失败
 * ```
 * 注意：**被 mock 的模块必须用动态 `await import()`**。
 * `vi.mock` 的注册会被提升，但工厂要等模块第一次被 require 才跑；
 * 顶层 `const fake = ...` 先于 `await import` 执行，所以工厂能拿到已赋值的 `fake`。
 * （老文件用 `vi.hoisted` 包住整个假 db，是因为假 db 定义在工厂外面就取不到；
 *  抽成模块之后不再需要。）
 */

export type Row = Record<string, any>

/**
 * v4 schema 的**真实索引清单**（`src/db/index.ts` 的 `version(4)`）。
 *
 * 改 schema 时必须同步改这里 —— 这是本文件存在的全部意义。
 * 顺序无关，只要集合一致。
 */
export const V4_INDICES: Record<string, readonly string[]> = {
  packages: ['packageId', 'manifest.subject', 'manifest.grade'],
  progress: [
    '[profileId+packageId+knowledgePointId]',
    '[profileId+packageId]',
    'profileId',
    'status',
  ],
  mistakes: ['[profileId+exerciseId]', 'packageId', 'profileId', 'mastered'],
  settings: ['key'],
  examSessions: ['[profileId+packageId]', 'profileId', 'status', 'startedAt'],
}

/**
 * v3 及更早的索引清单。
 *
 * 只有**测 v3 迁移本身**的文件才用它（`tests/progress-migrate.test.ts`）——
 * 那时库里还没有 `profileId`，索引名也不同。用 v4 清单去测 v3 会让
 * `where('[packageId+knowledgePointId]')` 直接抛错，从而测不到想测的东西。
 */
export const V3_INDICES: Record<string, readonly string[]> = {
  packages: ['packageId', 'manifest.subject', 'manifest.grade'],
  progress: ['[packageId+knowledgePointId]', 'packageId', 'status'],
  mistakes: ['packageId', 'exerciseId', 'mastered'],
  settings: ['key'],
  examSessions: ['packageId', 'status', 'startedAt'],
}

/** 默认建哪些表（顺序即 `db` 上的属性顺序，便于快照与 reset） */
const TABLE_NAMES = ['packages', 'progress', 'mistakes', 'settings', 'examSessions'] as const
export type TableName = (typeof TABLE_NAMES)[number]

/** 每张表的默认主键（与 schema 的 `++id` / `key` 对应） */
const DEFAULT_KEY: Record<TableName, (r: Row) => any> = {
  packages: (r) => r.packageId,
  progress: (r) => r.id,
  mistakes: (r) => r.id,
  settings: (r) => r.key,
  examSessions: (r) => r.id,
}

/** 哪些表是自增主键 */
const AUTO_ID: Record<TableName, boolean> = {
  packages: false,
  progress: true,
  mistakes: true,
  settings: false,
  examSessions: true,
}

export interface TableOpts {
  /** 覆盖主键取值 */
  keyOf?: (r: Row) => any
  /** 覆盖索引清单（默认 `V4_INDICES[name]`；测 v3 传 `V3_INDICES`） */
  indices?: readonly string[]
  /**
   * 行级 profileId 断言开关。默认按索引形态自动判断：
   * 索引清单里出现 `profileId` / `[profileId+…]` → 开启。
   * 测**老数据夹具**（迁移前本来就没有 profileId）显式传 `false`。
   */
  requireProfileId?: boolean
  /** `get` 的前置钩子：抛错即模拟"读失败" */
  onGet?: (key: any) => void
  /** `put` 的前置钩子：抛错即模拟"写失败" */
  onPut?: (row: Row) => void
}

export interface WhereChain {
  equals(value: any): {
    first(): Promise<Row | undefined>
    toArray(): Promise<Row[]>
  }
}

export interface FakeTable {
  /** 表里的行（测试直接读它来断言，比 toArray 更省事） */
  rows: Row[]
  /** `put` 次数：用来断言"不该落库时一个字节都没写" */
  puts: number
  __reset(): void
  toArray(): Promise<Row[]>
  get(k: any): Promise<Row | undefined>
  put(r: Row): Promise<any>
  add(r: Row): Promise<any>
  bulkPut(rs: Row[]): Promise<void>
  bulkDelete(ids: any[]): Promise<void>
  update(id: any, patch: Row): Promise<void>
  delete(k: any): Promise<void>
  where(index: string): WhereChain
}

export interface FakeDexie {
  packages: FakeTable
  progress: FakeTable
  mistakes: FakeTable
  settings: FakeTable
  examSessions: FakeTable
  /** 喂给 `vi.mock('@/db', () => ({ db: fake.db }))` 的对象 */
  db: {
    packages: FakeTable
    progress: FakeTable
    mistakes: FakeTable
    settings: FakeTable
    examSessions: FakeTable
    transaction(mode: any, ...args: any[]): Promise<any>
  }
  /**
   * 注入 IO 失败：键形如 `put:progress` / `toArray:settings` / `update:mistakes`。
   * 命中即抛错，用来模拟"磁盘写不进去""读到一半断了"。
   */
  failOn: Set<string>
  /** 写入顺序日志：`put:progress` / `delete:progress` / `update:progress` / `put:settings` … */
  writes: string[]
  /** 事务计数：用来断言"noop 时一个事务都不开" */
  txCount: number
  __reset(): void
  /** 全库快照（配合 `restore` 模拟 versionchange 事务回滚） */
  snapshot(): Record<string, Row[]>
  restore(snap: Record<string, Row[]>): void
}

export interface FakeDexieOpts {
  /** `'v4'`（默认）/ `'v3'` / 自定义 `Record<table, string[]>` */
  indices?: 'v4' | 'v3' | Record<string, readonly string[]>
  /** 逐表覆盖 */
  overrides?: Record<string, TableOpts>
}

function indexMapOf(indices: FakeDexieOpts['indices']): Record<string, readonly string[]> {
  if (indices === 'v3') return V3_INDICES
  if (indices === undefined || indices === 'v4') return V4_INDICES
  return indices
}

function fieldsOf(name: string, index: string, known: readonly string[]): string[] {
  if (!known.includes(index)) {
    // ★ 未知索引必须抛错。静默返回空结果会让"漏改索引名"这类缺陷假通过 ——
    // 而它在生产里是真会抛的（Dexie 对不存在的索引直接 SchemaError）。
    throw new Error(`fake db: 未知索引 ${name}.${index}`)
  }
  return index.startsWith('[') && index.endsWith(']') ? index.slice(1, -1).split('+') : [index]
}

export function createFakeDexie(opts: FakeDexieOpts = {}): FakeDexie {
  const indexMap = indexMapOf(opts.indices)
  const overrides = opts.overrides ?? {}

  const tables = {} as Record<TableName, FakeTable>

  for (const name of TABLE_NAMES) {
    const over = overrides[name] ?? {}
    const keyOf = over.keyOf ?? DEFAULT_KEY[name]
    const indices = over.indices ?? indexMap[name] ?? []
    const autoId = AUTO_ID[name]
    const rows: Row[] = []
    let seq = 1

    // ★ v4 索引形态（索引清单里出现 profileId）下，每一行都必须带非空
    // profileId。真库不校验这条，但项目规则是必填（见 ProgressRecord 的
    // 注释："可空就意味着存在一条代码路径忘了判断"）—— 夹具漏了 profileId
    // 的测试在单档案数据下照样全绿，正是 A2 要堵的静默串数据。
    const profileScoped =
      over.requireProfileId ??
      indices.some((i) => i === 'profileId' || i.startsWith('[profileId+'))
    const assertScoped = (r: Row): void => {
      if (!profileScoped) return
      const pid = r?.profileId
      if (typeof pid !== 'string' || pid === '') {
        throw new Error(
          `fake db: ${name} 行缺少 profileId（v4 语义必填）—— ` +
            '单档案测试里漏了它照样全绿，正是 A2 要堵的静默串数据；' +
            `确需造老数据夹具请传 overrides.${name}.requireProfileId = false`
        )
      }
    }

    const table: FakeTable = {
      rows,
      puts: 0,

      __reset() {
        rows.length = 0
        seq = 1
        table.puts = 0
      },

      async toArray() {
        if (failOn.has(`toArray:${name}`)) throw new Error(`fake db: ${name}.toArray 失败`)
        return rows.map((r) => ({ ...r }))
      },

      async get(k: any) {
        over.onGet?.(k)
        if (failOn.has(`get:${name}`)) throw new Error(`fake db: ${name}.get 失败`)
        const hit = rows.find((r) => keyOf(r) === k)
        // 同 first()：交副本，调用方改不到库里
        return hit ? { ...hit } : undefined
      },

      async put(r: Row) {
        assertScoped(r)
        over.onPut?.(r)
        writes.push(`put:${name}`)
        table.puts++
        if (failOn.has(`put:${name}`)) throw new Error(`fake db: ${name}.put 失败`)
        const k = keyOf(r)
        const i = rows.findIndex((x) => keyOf(x) === k)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return k
      },

      async add(r: Row) {
        assertScoped(r)
        writes.push(`add:${name}`)
        if (failOn.has(`add:${name}`)) throw new Error(`fake db: ${name}.add 失败`)
        const row = { ...r }
        if (autoId && row.id === undefined) {
          // 模仿 IndexedDB 的自增语义：**max(id)+1**，而不是"内部计数器 +1"。
          // 直接 `seq++` 会在"测试先手工塞了一行 id:1"时也给出 1
          // （假库里出现两行同 id），于是"新增行没有复用本机 id"这类断言
          // 会变成假通过 / 假失败。
          // 这条是从 `progress-merge-profile.test.ts` 的旧替身里保留下来的，
          // 该用例专门守"upsert 不是 update"（V1.4 · B2 的串档案缺陷）。
          const maxId = rows.reduce(
            (m, x) => (typeof x.id === 'number' ? Math.max(m, x.id) : m),
            0,
          )
          row.id = Math.max(seq, maxId + 1)
          seq = row.id + 1
        }
        const k = keyOf(row)
        // ★ 真库 add 撞已存在主键 → ConstraintError。旧替身静默插入第二行
        // 同 id 行，"upsert 被写成 add" 这类缺陷因此假通过。
        if (rows.some((x) => keyOf(x) === k)) {
          throw new Error(
            `fake db: ${name}.add 主键冲突（${JSON.stringify(k)}）—— ` +
              '真实 Dexie 抛 ConstraintError；要覆盖同键行请用 put'
          )
        }
        rows.push(row)
        return k
      },

      async bulkPut(rs: Row[]) {
        for (const r of rs) await table.put(r)
      },

      async bulkDelete(ids: any[]) {
        for (const id of ids) await table.delete(id)
      },

      async update(id: any, patch: Row) {
        writes.push(`update:${name}`)
        if (failOn.has(`update:${name}`)) throw new Error(`fake db: ${name}.update 失败`)
        const i = rows.findIndex((r) => keyOf(r) === id)
        if (i >= 0) rows[i] = { ...rows[i], ...patch }
      },

      async delete(k: any) {
        writes.push(`delete:${name}`)
        if (failOn.has(`delete:${name}`)) throw new Error(`fake db: ${name}.delete 失败`)
        const i = rows.findIndex((r) => keyOf(r) === k)
        if (i >= 0) rows.splice(i, 1)
      },

      where(index: string): WhereChain {
        const fields = fieldsOf(name, index, indices)
        const compound = index.startsWith('[')
        // ★ 形参校验（A6 补牙）。见文件头"差异"第 4 条：
        // 少传 profileId 的短数组、传给复合索引的标量，在真库里都是
        // "静默空结果 / 静默多返"，不抛错就等于放回归过去。
        const checkValue = (value: any): void => {
          if (value == null) {
            throw new Error(
              `fake db: ${name}.where('${index}').equals(${String(value)}) —— ` +
                '真实 Dexie 对 null/undefined key 直接 reject（Invalid key provided）'
            )
          }
          if (compound) {
            if (!Array.isArray(value) || value.length !== fields.length) {
              throw new Error(
                `fake db: ${name}.where('${index}') 是 ${fields.length} 元复合索引，` +
                  `equals() 必须传长度 ${fields.length} 的数组，收到 ${JSON.stringify(value)}。` +
                  '少传 profileId 在真实库里不报错、只会永远查不到 —— 这里必须炸'
              )
            }
          } else if (Array.isArray(value)) {
            throw new Error(
              `fake db: ${name}.where('${index}') 是单列索引，equals() 不能传数组` +
                `（收到 ${JSON.stringify(value)}；真库会静默空结果，旧替身按首字段比会多返）`
            )
          }
        }
        const matches = (r: Row, value: any) =>
          compound
            ? fields.every((f, i) => r[f] === value[i])
            : r[fields[0]] === value
        return {
          equals: (value: any) => {
            checkValue(value)
            return {
              async first() {
                const hit = rows.find((r) => matches(r, value))
                // 真库返回结构化克隆；旧替身把**活行**交出去，
                // 调用方一改就污染库里数据
                return hit ? { ...hit } : undefined
              },
              async toArray() {
                return rows.filter((r) => matches(r, value)).map((r) => ({ ...r }))
              },
            }
          },
        }
      },
    }

    tables[name] = table
  }

  const failOn = new Set<string>()
  const writes: string[] = []
  let txCount = 0

  const db = {
    packages: tables.packages,
    progress: tables.progress,
    mistakes: tables.mistakes,
    settings: tables.settings,
    examSessions: tables.examSessions,

    /**
     * 手写事务：提交前快照涉及的表，抛错时整张还原。
     *
     * 支持两种调用形态（Dexie 两种都合法）：
     *   `transaction('rw', db.a, db.b, cb)`
     *   `transaction('rw', [db.a, db.b], cb)`
     */
    async transaction(_mode: any, ...args: any[]) {
      const fn = args[args.length - 1] as (...a: any[]) => Promise<any>
      const rest = args.slice(0, -1)
      const involved: FakeTable[] = (Array.isArray(rest[0]) ? (rest[0] as FakeTable[]) : (rest as FakeTable[]))
      const snapshot = involved.map((t) => t.rows.map((r) => ({ ...r })))
      txCount++
      try {
        return await fn({ table: (n: string) => tables[n as TableName] })
      } catch (err) {
        involved.forEach((t, i) => {
          t.rows.length = 0
          snapshot[i].forEach((r) => t.rows.push({ ...r }))
        })
        throw err
      }
    },
  }

  const fake: FakeDexie = {
    packages: tables.packages,
    progress: tables.progress,
    mistakes: tables.mistakes,
    settings: tables.settings,
    examSessions: tables.examSessions,
    db,
    failOn,
    writes,
    get txCount() {
      return txCount
    },
    __reset() {
      for (const name of TABLE_NAMES) tables[name].__reset()
      failOn.clear()
      writes.length = 0
      txCount = 0
    },
    snapshot() {
      const out: Record<string, Row[]> = {}
      for (const name of TABLE_NAMES) out[name] = tables[name].rows.map((r) => ({ ...r }))
      return out
    },
    restore(snap: Record<string, Row[]>) {
      for (const name of TABLE_NAMES) {
        tables[name].rows.length = 0
        ;(snap[name] ?? []).forEach((r) => tables[name].rows.push({ ...r }))
      }
    },
  }

  return fake
}
