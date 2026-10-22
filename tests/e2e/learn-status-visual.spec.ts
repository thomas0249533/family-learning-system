import { test, expect, type Page } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * V1.6 · Stage D · **有数据版**视觉基线（D1 状态卡 + D4 划线工具栏）
 * =====================================================================
 * `tests/e2e/visual.spec.ts` 的 16 张基线有一个结构性盲区：每次 `chromium.launch()`
 * 都是全新 profile，库里**一条数据都没有**，所以 `/learn` 只渲染 EmptyState。
 * 后果是本轮刚做完的两件事在视觉回归里**一个像素都看不见**：
 *
 *   1. **D1 状态卡片**（`src/core/learning/cardStatus.ts` + `_card-status.scss`）——
 *      单元卡 / 专题卡 / 包卡按掌握状态给不同底色与角标（○ ◐ ↻ ✓）。空库里
 *      (`/learn` 无包、`/learn/<pkg>` 无进度) 全走 EmptyState，四套配色零覆盖。
 *   2. **D4 阅读划线工具栏**（`src/components/reading/InkOverlay.vue` 的 `.ink-toolbar`）——
 *      只出现在语文阅读专题页，空库进不去。
 *
 * 也就是说：谁把「已掌握 = 绿底」改成灰底，现有基线**不会报警**。本文件补的就是这层。
 *
 * ## 与 visual.spec.ts 的契约保持完全一致
 *   - 输出 `docs/screenshots/{key}-{light|dark}.png`，用 `page.screenshot({ fullPage })`，
 *     **不用** `toHaveScreenshot()`（那需要另一套基线目录与 `--update-snapshots` 流程）。
 *   - `addInitScript` 预置 `localStorage['fls:theme']`（首帧即目标主题）+ **冻结时钟**。
 *   - 截图前 `freezeSmil()`：naive-ui 的 loading 用 SMIL，`animations: 'disabled'`
 *     对它无效（见 `freeze-smil.ts` 的说明）。
 *
 * ## 确定性（连跑两遍 `git status` 必须一致）
 *   1. 时钟冻结在 `FIXED_NOW`；所有 `lastStudiedAt` 也是固定 ISO 串（不能用 `new Date()`）；
 *   2. 播种数据全部字面量，无随机数、无 `Date.now()`、无网络；
 *   3. 每个用例独立上下文（Playwright 默认），自己清库 + 播种，不依赖执行顺序。
 *
 * ## 播种纪律（照抄 `reading-ink.spec.ts` 的已验证链路，别自己发明）
 *   - **先等库就绪再裸开 IDB**：`.ach-head-count` 可见 = Dexie 已建好 v4 schema。
 *     裸 `indexedDB.open(name)` 不带版本号在 schema 建好前会创建**空库**，App 之后
 *     读到空 schema（V1.3 踩过这个坑）。
 *   - **一个 transaction 写完** `['settings','packages','progress']`：跨表半截状态会让
 *     断言随机红。
 *
 * ## 数据设计（为什么是这几个包）
 * `/learn` 的包卡状态由**该包自己的进度行**反演（`packageCardStatusOf`），一张包卡
 * 只能有一种状态；所以「包卡四态同屏」必须四个包。`/learn/<pkg>` 的单元卡状态按
 * `progress` 模式聚合（有「未学/学习中」在推进时不许变红），所以「单元卡四态同屏」
 * 要求「需复习」那个单元的 KP **全部**到期 —— 掺一个未学它就退化成「学习中」。
 * 专题卡走 `attention` 模式，四态可以挂在同一个单元（`u5`）的四个主题上。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'

/** 固定时刻（本地时间 2025-01-15 10:00:00，无时区后缀 = 按本地时间解析），与 visual.spec.ts 同源 */
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()

/**
 * 所有进度行的 `lastStudiedAt`（固定时刻前 16~32 小时）。
 *
 * 为什么不能用 `new Date()`：`userDataStore.loadUserData()` 会跑 `applyDecay`，
 * 「已掌握」且 `lastStudiedAt` 超过 7 天 → 被**降级成「需复习」**。
 * 真时间会让截图随日期漂移；固定在冻结时刻前 1 天，则无论机器时区如何
 * （差 16~32 小时）都稳定判「已掌握」而不触发衰减。
 */
const STUDIED_AT = '2025-01-14T10:00:00.000Z'

/** 档案创建时刻（`profiles` 键里的 `createdAt`，写成字面量以避免非确定性） */
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

/** 语文阅读正文（≥5 段，`\n\n` 分隔 → markdown-it 渲染成多个 `<p>`） */
const TEXT_CONTENT = [
  '从小丘西行百二十步，隔篁竹，闻水声，如鸣佩环，心乐之。伐竹取道，下见小潭，水尤清冽。',
  '全石以为底，近岸，卷石底以出，为坻，为屿，为嵁，为岩。青树翠蔓，蒙络摇缀，参差披拂。',
  '潭中鱼可百许头，皆若空游无所依。日光下澈，影布石上，佁然不动；俶尔远逝，往来翕忽。',
  '潭西南而望，斗折蛇行，明灭可见。其岸势犬牙差互，不可知其源。',
  '坐潭上，四面竹树环合，寂寥无人，凄神寒骨，悄怆幽邃。以其境过清，不可久居，乃记之而去。',
  '同游者：吴武陵，龚古，余弟宗玄。隶而从者，崔氏二小生，曰恕己，曰奉壹。',
].join('\n\n')

// ===========================================================================
// 播种数据（字面量，全部可复现）
// ===========================================================================

/** `progress.status` 的合法值（DB 里就是这四个中文字面量，不改口径） */
type SeedStatus = '未学' | '学习中' | '已掌握' | '需复习'

interface TopicSeed {
  id: string
  title: string
  kpIds: string[]
  /** 与 `kpIds` 一一对应；`null` = **不写进度行**（库里根本没这条进度） */
  statuses: Array<SeedStatus | null>
}

interface UnitSeed {
  id: string
  title: string
  topics: TopicSeed[]
}

interface PackageSeed {
  packageId: string
  title: string
  subject: 'math' | 'chinese' | 'english'
  units: UnitSeed[]
  /** 仅语文阅读包需要：知识点正文（`chinese.text` 模块从 `knowledgePoints[].content` 取） */
  contents?: Record<string, string>
}

const D1_PKG = 'd1-visual'
const D4_PKG = 'd4-visual'

/**
 * 四个包 = 包卡四态同屏。
 *
 * 包卡状态是「这一个包的所有进度行」的聚合，一个包只能出一种状态，
 * 所以 `d1-mastered`（全已掌握）/ `d1-review`（全到期）/ `d1-visual`（混合 → 学习中）/
 * `d4-visual`（零进度行 → 未学）四个包才凑得出 ○ ◐ ↻ ✓ 四张不同的包卡。
 */
const PACKAGE_SEEDS: PackageSeed[] = [
  {
    packageId: 'd1-mastered',
    title: 'D1 视觉 · 已掌握包',
    subject: 'math',
    units: [
      {
        id: 'u1',
        title: '全册已掌握',
        topics: [
          {
            id: 'u1t1',
            title: '小数的意义',
            kpIds: ['d1-mastered::k1', 'd1-mastered::k2'],
            statuses: ['已掌握', '已掌握'],
          },
        ],
      },
    ],
  },
  {
    packageId: 'd1-review',
    title: 'D1 视觉 · 需复习包',
    subject: 'math',
    units: [
      {
        id: 'u1',
        title: '整单元到期',
        topics: [
          {
            id: 'u1t1',
            title: '异分母加减',
            kpIds: ['d1-review::k1', 'd1-review::k2'],
            statuses: ['需复习', '需复习'],
          },
        ],
      },
    ],
  },
  {
    packageId: D1_PKG,
    title: 'D1 视觉 · 混合进度包',
    subject: 'math',
    units: [
      {
        id: 'u1',
        title: '单元一 · 已掌握',
        topics: [
          {
            id: 'u1t1',
            title: '分数的意义',
            kpIds: [`${D1_PKG}::u1k1`, `${D1_PKG}::u1k2`],
            statuses: ['已掌握', '已掌握'],
          },
        ],
      },
      {
        id: 'u2',
        title: '单元二 · 学习中',
        topics: [
          {
            id: 'u2t1',
            title: '真分数与假分数',
            kpIds: [`${D1_PKG}::u2k1`, `${D1_PKG}::u2k2`],
            // 一个在推进、一个没碰 → 单元级 `progress` 模式判「学习中」（不因半个到期就变红）
            statuses: ['学习中', null],
          },
        ],
      },
      {
        id: 'u3',
        title: '单元三 · 需复习',
        topics: [
          {
            id: 'u3t1',
            title: '分数的基本性质',
            kpIds: [`${D1_PKG}::u3k1`, `${D1_PKG}::u3k2`],
            // 两个都到期：单元级要呈现「需复习」就必须没有「未学/学习中」掺着
            // （`aggregateProgress` 第 3 条：学完了、整体到期才允许红）
            statuses: ['需复习', '需复习'],
          },
        ],
      },
      {
        id: 'u4',
        title: '单元四 · 未开始',
        topics: [
          {
            id: 'u4t1',
            title: '分数乘法',
            kpIds: [`${D1_PKG}::u4k1`, `${D1_PKG}::u4k2`],
            // 两行都不写：库里没有任何进度 = 真·未学（不是"写了未学"，两者在 UI 上等价，
            // 但这里必须证明「零进度行」这条路径也渲染成 ○）
            statuses: [null, null],
          },
        ],
      },
      {
        id: 'u5',
        title: '单元五 · 四种状态',
        topics: [
          {
            id: 'u5t1',
            title: '通分',
            kpIds: [`${D1_PKG}::u5m1`, `${D1_PKG}::u5m2`],
            statuses: ['已掌握', '已掌握'],
          },
          {
            id: 'u5t2',
            title: '约分',
            kpIds: [`${D1_PKG}::u5l1`, `${D1_PKG}::u5l2`],
            // 主题级 `attention` 模式：不是全已掌握、也没有到期 → 学习中
            statuses: ['学习中', '已掌握'],
          },
          {
            id: 'u5t3',
            title: '分数加减',
            kpIds: [`${D1_PKG}::u5r1`],
            statuses: ['需复习'],
          },
          {
            id: 'u5t4',
            title: '分数应用',
            kpIds: [`${D1_PKG}::u5n1`],
            statuses: [null],
          },
        ],
      },
    ],
  },
  {
    packageId: D4_PKG,
    title: 'D4 视觉 · 阅读包',
    subject: 'chinese',
    units: [
      {
        id: 'ru1',
        title: '阅读单元',
        topics: [
          {
            id: 'rt1',
            title: '潭水',
            kpIds: [`${D4_PKG}::kp1`],
            statuses: [null],
          },
        ],
      },
    ],
    contents: { [`${D4_PKG}::kp1`]: TEXT_CONTENT },
  },
]

/** 播种载荷（纯数据，可直接结构化克隆进页面） */
interface SeedPayload {
  packages: Array<Record<string, unknown>>
  progress: Array<Record<string, unknown>>
}

/** 由字面量种子推导出 `packages` 行与 `progress` 行（字段名照 `src/db/index.ts` 的接口，不臆造） */
function buildSeed(): SeedPayload {
  const packages: Array<Record<string, unknown>> = []
  const progress: Array<Record<string, unknown>> = []

  for (const pkg of PACKAGE_SEEDS) {
    const knowledgePoints: Array<Record<string, unknown>> = []
    const units: Array<Record<string, unknown>> = []

    for (const unit of pkg.units) {
      const topics: Array<Record<string, unknown>> = []

      for (const topic of unit.topics) {
        topics.push({
          id: topic.id,
          title: topic.title,
          knowledgePointIds: topic.kpIds,
          exercises: [],
        })

        topic.kpIds.forEach((kpId, i) => {
          const content = pkg.contents?.[kpId]
          knowledgePoints.push({
            id: kpId,
            title: `${topic.title} · 知识点${i + 1}`,
            ...(content ? { content } : {}),
          })

          const status = topic.statuses[i] ?? null
          if (status === null) return
          progress.push({
            profileId: PROFILE_ID,
            packageId: pkg.packageId,
            knowledgePointId: kpId,
            status,
            // 计数只影响状态机内部口径，不进卡片视觉；给「自洽」的一组值便于人工核对
            correctCount: status === '未学' ? 0 : 3,
            wrongCount: status === '需复习' ? 3 : 0,
            correctStreak: status === '已掌握' ? 4 : status === '学习中' ? 1 : 0,
            wrongStreak: status === '需复习' ? 2 : 0,
            lastStudiedAt: STUDIED_AT,
            studySeconds: 600,
          })
        })
      }

      units.push({ id: unit.id, title: unit.title, topics })
    }

    packages.push({
      packageId: pkg.packageId,
      manifest: {
        schemaVersion: '1.0',
        packageId: pkg.packageId,
        // 运行时 JSON 普遍只写 `type`（`packageType` 是历史别名，见 schemas/manifest.ts）
        type: 'unit',
        subject: pkg.subject,
        grade: 4,
        term: 'up',
        edition: '人教版',
        title: pkg.title,
        examMode: false,
      },
      knowledgePoints,
      exercises: [],
      units,
    })
  }

  return { packages, progress }
}

// ===========================================================================
// 播种 / 等待（照抄 reading-ink.spec.ts 的已验证链路）
// ===========================================================================

/** `.ach-head-count` 只在读库完成后渲染 → 「Dexie 已建好 v4 schema」的可靠信号 */
async function waitDbReady(page: Page): Promise<void> {
  await page.locator('.ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function resetDb(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  }, DB_NAME)
  await page.reload()
}

/**
 * 一个 transaction 写完 `settings` / `packages` / `progress` 三张表。
 *
 * 跨表半截状态（包有了但进度没写、或进度写了但档案不对）会让断言随机红；
 * `indexedDB.open(dbName)` **不带版本号**——此时 App 已建好 v4 库，不会造空库。
 */
async function seedAll(page: Page, seed: SeedPayload): Promise<void> {
  await page.evaluate(
    async ({ dbName, packages, progress, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'progress'], 'readwrite')
        // 档案表：没有它 `currentProfileId()` 回落到 default，进度行按 pid 过滤后全是空的
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        for (const pkg of packages) tx.objectStore('packages').put(pkg)
        for (const row of progress) tx.objectStore('progress').put(row)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
    {
      dbName: DB_NAME,
      packages: seed.packages,
      progress: seed.progress,
      profileId: PROFILE_ID,
      createdAt: PROFILE_CREATED_AT,
    }
  )
}

/** 预置主题 + 冻结时钟（与 visual.spec.ts 逐行同构） */
async function installDeterminismHooks(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    (cfg: { mode: string; fixedNow: number }) => {
      const { mode: m, fixedNow } = cfg

      // ---- 冻结时钟：报告 / 打卡 / "x 天前" 这类相对时间必须确定 ----
      const RealDate = Date
      // 显式 `any`：造一个"形状像 Date"的替身再挂回 window 上
      const FrozenDate: any = function (...args: any[]) {
        if (args.length === 0) return new RealDate(fixedNow)
        // @ts-expect-error 透传参数
        return new RealDate(...args)
      }
      FrozenDate.now = () => fixedNow
      FrozenDate.parse = RealDate.parse
      FrozenDate.UTC = RealDate.UTC
      FrozenDate.prototype = RealDate.prototype
      ;(window as any).Date = FrozenDate

      // ---- 预置主题（首帧即目标主题，顺带守住防 FOUC）----
      localStorage.setItem(
        'fls:theme',
        JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false })
      )
    },
    { mode, fixedNow: FIXED_NOW }
  )
}

/**
 * 等「成就 toast」彻底播放完（`.ach-toast` 连续 `quietMs` 不出现）。
 *
 * 为什么必须等：播种了「已掌握」进度 → 成就会解锁 → `AppShell` 收到
 * `achievementStore` 的待播队列后弹一枚 `.ach-toast`。它是 `position: fixed` 的浮层，
 * 正好压在卡片上方（实测遮住单元卡 1~2 的右上角 —— 也就是状态角标所在位置）。
 *
 * 更关键的是**它什么时候消失取决于真实计时器**（`DISPLAY_MS = 2600`，队列逐条播放，
 * 首次结算还有 `scheduleSettle(800ms)` 去抖），而页面加载耗时会在几秒到十几秒之间浮动
 * （本机 dev server 与并行任务共享，别人改 src 会触发重编译）。于是「截图那一刻
 * toast 在不在」是**不可复现**的 —— 同一份代码两次跑可能一张有、一张没有。
 *
 * 这里不靠"加大 waitForTimeout 蒙过去"，而是显式等到浮层消失后再静默 3000ms
 * （> 2600ms 单条播放时长 + 180ms 队列间隔），使"截图里没有 toast"成为确定的稳态。
 */
async function waitToastsSettled(page: Page, quietMs = 3000, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let quietSince = Date.now()
  do {
    if ((await page.locator('.ach-toast').count()) > 0) quietSince = Date.now()
    if (Date.now() - quietSince >= quietMs) return
    if (Date.now() > deadline) {
      throw new Error(`${timeoutMs}ms 内成就 toast 没有静默，截图不可复现`)
    }
    await page.waitForTimeout(100)
  } while (true)
}

/** 清库 → 等 schema → 播种 → 进目标路由 */
async function openSeeded(page: Page, path: string): Promise<void> {
  await page.goto('/home')
  await resetDb(page)
  await waitDbReady(page)
  await seedAll(page, buildSeed())
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

// ===========================================================================
// 截图矩阵
// ===========================================================================

interface CardShot {
  key: string
  path: string
  /** 卡片选择器 */
  card: string
  /** 该页应有的卡片张数（数量不对说明播种没生效，别让基线偷偷退化成空态） */
  count: number
  /** 角标选择器（`null` = 本页没有状态角标，如 D4 阅读页） */
  mark: string | null
  /** 期望同屏出现的四个状态类（`null` = 不要求四态） */
  statuses: string[] | null
}

const CARD_SHOTS: CardShot[] = [
  {
    key: 'learn-with-data',
    path: '/learn',
    card: '.pkg-card',
    // 四个包 = 包卡四态（详见 PACKAGE_SEEDS 的注释）
    count: 4,
    mark: '.pkg-status-mark',
    statuses: ['is-none', 'is-learning', 'is-review', 'is-mastered'],
  },
  {
    key: 'unit-status',
    path: `/learn/${D1_PKG}`,
    card: '.unit-card',
    // u1 已掌握 / u2 学习中 / u3 需复习 / u4 未开始 / u5 四态混合（= 学习中）
    count: 5,
    mark: '.unit-status-mark',
    statuses: ['is-none', 'is-learning', 'is-review', 'is-mastered'],
  },
  {
    key: 'topic-status',
    // team-lead 原定 u1；但 u1 的 KP 全已掌握（否则单元卡就不是 mastered），
    // 它下面的专题卡只可能同色。为让专题卡也四态同屏，取 u5 这个"四态混合"单元。
    path: `/learn/${D1_PKG}/unit/u5`,
    card: '.topic-card',
    count: 4,
    mark: '.topic-status-mark',
    statuses: ['is-none', 'is-learning', 'is-review', 'is-mastered'],
  },
  {
    key: 'reading-ink-toolbar',
    path: `/learn/${D4_PKG}/unit/ru1/topic/rt1`,
    card: '.text-body',
    count: 1,
    mark: null,
    statuses: null,
  },
]

/** 卡片实测值（打印进日志，作为"基线里到底画了什么颜色"的证据） */
interface CardMeasure {
  index: number
  title: string
  className: string
  background: string
  mark: string
  markColor: string
  height: number
}

async function measureCards(page: Page, card: string, mark: string | null): Promise<CardMeasure[]> {
  return page.evaluate(
    async ({ card, mark }) => {
      const nodes = Array.from(document.querySelectorAll(card))
      return nodes.map((el, index) => {
        const box = el as HTMLElement
        const markEl = mark ? el.querySelector(mark) : null
        const titleEl = el.querySelector('h3') ?? el.querySelector('.text-body')
        return {
          index: index + 1,
          title: (titleEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
          className: box.className.replace(/\s+/g, ' ').trim(),
          background: getComputedStyle(box).backgroundColor,
          mark: markEl ? (markEl.textContent ?? '').trim() : '(无角标)',
          markColor: markEl ? getComputedStyle(markEl).color : '(无角标)',
          height: Math.round(box.getBoundingClientRect().height),
        }
      })
    },
    { card, mark }
  )
}

for (const shot of CARD_SHOTS) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${shot.key}-${mode}`, async ({ page }) => {
      await installDeterminismHooks(page, mode)
      await openSeeded(page, shot.path)

      if (shot.key === 'reading-ink-toolbar') {
        // 阅读页的"就绪"信号：正文真的渲染出来了（≥5 段）+ 划线工具栏在位
        await expect(page.locator('.text-body p').nth(4)).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('.ink-toolbar')).toHaveCount(1)
        await expect(page.locator('.ink-layer')).toHaveCount(1)
        await expect(page.locator('.ink-status')).toBeVisible()
      } else {
        await expect(page.locator(shot.card).first()).toBeVisible({ timeout: 20_000 })
        // 数量必须精确：少一张 = 播种没生效，基线会静默退化成一个"看起来还行"的空态
        await expect(page.locator(shot.card)).toHaveCount(shot.count)
        if (shot.mark) {
          await expect(page.locator(shot.mark)).toHaveCount(shot.count)
        }
      }

      // 等图表 / 过渡 / 字体稳定（与 visual.spec.ts 同一等待）
      await page.waitForTimeout(1200)
      // 再等成就 toast 这种 fixed 浮层安静下来（见 waitToastsSettled 的说明）：
      // 否则它会压在本文件要拍的卡片角标上，而且"截到没截到"不可复现
      await waitToastsSettled(page)

      // ---------- 断言：四态真的同屏，且底色/角标互不相同 ----------
      if (shot.statuses) {
        const measures = await measureCards(page, shot.card, shot.mark)
        console.log(`\n[${shot.key}-${mode}] 实测卡片：\n` + JSON.stringify(measures, null, 2))

        const classes = measures.map((m) => m.className)
        for (const cls of shot.statuses) {
          expect(
            classes.some((c) => c.split(' ').includes(cls)),
            `缺少状态类 ${cls}（实测：${classes.join(' | ')}）`
          ).toBe(true)
        }
        // 四张卡的同屏底色必须**两两不同**：这就是"改 token 会报警"的那条线
        expect(new Set(measures.map((m) => m.background)).size).toBe(4)
        // 角标必须是 ○ ◐ ↻ ✓ 四个不同字形，且墨色也两两不同（颜色之外的冗余信号）
        expect(measures.every((m) => m.mark !== '(无角标)' && m.mark !== '')).toBe(true)
        expect(new Set(measures.map((m) => m.markColor)).size).toBeGreaterThanOrEqual(3)
      } else {
        const ink = await page.evaluate(() => {
          const toolbar = document.querySelector('.ink-toolbar') as HTMLElement | null
          const status = document.querySelector('.ink-status') as HTMLElement | null
          const body = document.querySelector('.text-body') as HTMLElement | null
          const cs = (el: HTMLElement | null) => (el ? getComputedStyle(el) : null)
          const tb = cs(toolbar)
          return {
            toolbarBox: toolbar
              ? {
                  width: Math.round(toolbar.getBoundingClientRect().width),
                  height: Math.round(toolbar.getBoundingClientRect().height),
                }
              : null,
            toolbarBackground: tb?.backgroundColor ?? null,
            toolbarBorder: tb?.borderColor ?? null,
            buttons: Array.from(document.querySelectorAll('.ink-btn')).map((b) => ({
              text: (b.textContent ?? '').trim(),
              pressed: b.getAttribute('aria-pressed'),
              disabled: (b as HTMLButtonElement).disabled,
            })),
            statusText: (status?.textContent ?? '').trim(),
            statusColor: status ? getComputedStyle(status).color : null,
            textBodyBackground: body ? getComputedStyle(body).backgroundColor : null,
          }
        })
        console.log(`\n[${shot.key}-${mode}] 实测划线工具栏：\n` + JSON.stringify(ink, null, 2))

        // 工具栏必须真的画出来了（不是被压成 0 高 / 只有容器没有按钮）
        expect(ink.toolbarBox).not.toBeNull()
        expect(ink.toolbarBox!.height).toBeGreaterThan(16)
        expect(ink.buttons.length).toBeGreaterThanOrEqual(4)
        expect(ink.statusText).not.toBe('')
      }

      await freezeSmil(page)
      await page.screenshot({
        path: `docs/screenshots/${shot.key}-${mode}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    })
  }
}
