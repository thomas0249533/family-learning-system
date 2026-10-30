import { test, expect, type Page } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * E3 · 视觉基线（错题本有数据版 + 家长周报卡片）
 * =====================================================================
 * `tests/e2e/visual.spec.ts` 的基线每次都是全新 profile、**库里一条数据都没有**，
 * 所以 `/mistakes` 只有空态、`/parent` 的周报卡片（E3 新增）一个像素都看不见。
 * 本文件补的是"有数据"这一层，并且整套照抄
 * `tests/e2e/learn-status-visual.spec.ts` 的确定性模式：
 *
 *   - `installDeterminismHooks`：addInitScript 冻结时钟（FIXED_NOW，无时区后缀
 *     = 按本地时间解析）+ 预置 `localStorage['fls:theme']`（首帧即目标主题）；
 *   - `STUDIED_AT` 等全部种子日期写成**字面量**：`loadUserData()` 的 `applyDecay`
 *     会把超 7 天未学的"已掌握"降级，用真时间基线会随日期漂移；
 *   - 播种链路 `openSeeded`：resetDb → waitDbReady（等 `.ach-head-count` 可见，
 *     **裸开 IDB 会造空库**）→ 一个 transaction 写四表 → goto；
 *   - `waitToastsSettled`：播种"已掌握"会解锁成就 → AppShell 弹 fixed toast
 *     压内容，消失时机取决于真实计时器，不可复现 —— 显式等它静默；
 *   - 截图前三件套：`waitForTimeout(1200)` → `waitToastsSettled` → `freezeSmil`
 *     （SMIL 动画 `animations:'disabled'` 无效，见 `freeze-smil.ts`）；
 *   - 输出契约：`page.screenshot({ fullPage: true })` 写
 *     `docs/screenshots/{key}-{light|dark}.png`，**不用 `toHaveScreenshot()`**；
 *     卡片/行数断言必须精确（数量不对 = 播种没生效，基线会静默退化成空态）。
 *
 * ## 本文件的两张基线
 *   1. `mistakes-with-data-*`：`/mistakes`，种 4 条错题（三级 masteryLevel
 *      各至少一条 —— 统计横幅四态同屏，未掌握/部分掌握各出卡片）；
 *   2. `parent-weekly-card-*`：`/parent`，种 packages + progress + mistakes +
 *      `studyStreak:default` + `achievements:default`，**点了「生成周报卡片」
 *      再截图**（卡片是快照按钮触发，不点不出现）。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'

/** 固定时刻（本地时间 2025-01-15 10:00:00，无时区后缀 = 按本地时间解析），与视觉基线同源 */
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()

/**
 * 进度行的 `lastStudiedAt`（固定字面量，冻结时刻前 1~3 天）。
 *
 * 为什么不能用 `new Date()`：`applyDecay` 会把"已掌握"且超过 7 天未复习的降级；
 * 固定在冻结时刻前 1~3 天，任何机器时区下都稳定判"已掌握"而不触发衰减。
 */
const STUDIED_AT = '2025-01-14T10:00:00.000Z' // 1 天前
const STUDIED_AT_3D = '2025-01-12T10:00:00.000Z' // 3 天前

/** 档案创建时刻（字面量，避免非确定性） */
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

// ===========================================================================
// 播种数据（字面量，全部可复现）
// ===========================================================================

/** 数学单元包（错题归属 + 学科行的来源） */
const MATH_PKG: Record<string, unknown> = {
  packageId: 'unit-math',
  manifest: {
    schemaVersion: '1.0',
    packageId: 'unit-math',
    type: 'unit',
    subject: 'math',
    grade: 4,
    term: 'up',
    edition: '人教版',
    title: '四年级数学（上）',
    examMode: false,
  },
  knowledgePoints: [
    { id: 'unit-math::kp1', title: '两位数乘法' },
    { id: 'unit-math::kp2', title: '带余除法' },
    { id: 'unit-math::kp3', title: '小数的意义' },
  ],
  exercises: [],
  units: [
    {
      id: 'u1',
      title: '单元一 · 数与代数',
      topics: [
        {
          id: 't1',
          title: '乘法与除法',
          knowledgePointIds: ['unit-math::kp1', 'unit-math::kp2', 'unit-math::kp3'],
        },
      ],
    },
  ],
}

/** 英语单元包（让学科分布出两行） */
const ENGLISH_PKG: Record<string, unknown> = {
  packageId: 'unit-english',
  manifest: {
    schemaVersion: '1.0',
    packageId: 'unit-english',
    type: 'unit',
    subject: 'english',
    grade: 4,
    term: 'up',
    edition: '人教版',
    title: '四年级英语（上）',
    examMode: false,
  },
  knowledgePoints: [
    { id: 'unit-english::kp1', title: '单词拼写' },
    { id: 'unit-english::kp2', title: '句型转换' },
  ],
  exercises: [],
  units: [
    {
      id: 'u1',
      title: '单元一 · 词与句',
      topics: [
        { id: 't1', title: '词汇', knowledgePointIds: ['unit-english::kp1', 'unit-english::kp2'] },
      ],
    },
  ],
}

/**
 * 错题（三级 masteryLevel 各至少一条）。
 *
 * 注意 P3 口径：页面列表只渲染**待复习**（none + partial），mastered 不进列表
 * 但进统计横幅 —— 所以横幅是四态同屏（总/未掌握/部分掌握/已掌握），
 * 卡片区出 3 张（2 未掌握 + 1 部分掌握，左侧色条红/黄分明）。
 */
const MISTAKES: Array<Record<string, unknown>> = [
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    exerciseId: 'ex-v-1',
    knowledgePointIds: ['unit-math::kp1'],
    wrongAt: '2025-01-15T09:30:00.000Z', // 本地 01-15 17:30
    wrongCount: 3,
    mastered: false,
    masteryLevel: 'none',
    questionData: {
      id: 'ex-v-1',
      question: '25 × 4 = ?',
      options: ['A. 100', 'B. 90', 'C. 80'],
      answer: 'A',
      type: 'choice',
      explanation: '25 × 4 = 100，可以先算 25 × 2 = 50，再乘 2。',
    },
    lastUserAnswer: 'B',
  },
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    exerciseId: 'ex-v-2',
    knowledgePointIds: ['unit-math::kp2'],
    wrongAt: '2025-01-14T09:30:00.000Z',
    wrongCount: 2,
    mastered: false,
    masteryLevel: 'none',
    questionData: {
      id: 'ex-v-2',
      question: '17 ÷ 5 = ? …… 余几',
      options: ['A. 余 1', 'B. 余 2', 'C. 余 3'],
      answer: 'B',
      type: 'choice',
      explanation: '17 = 5 × 3 + 2，余数必须比除数 5 小。',
    },
    lastUserAnswer: 'C',
  },
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    exerciseId: 'ex-v-3',
    knowledgePointIds: ['unit-math::kp3'],
    wrongAt: '2025-01-13T09:30:00.000Z',
    wrongCount: 2,
    mastered: false,
    masteryLevel: 'partial',
    reviewCorrectCount: 1,
    questionData: {
      id: 'ex-v-3',
      question: '0.35 里有几个 0.01？',
      options: ['A. 3 个', 'B. 35 个', 'C. 350 个'],
      answer: 'B',
      type: 'choice',
      explanation: '两位小数的最小单位是 0.01，0.35 就是 35 个 0.01。',
    },
    lastUserAnswer: 'A',
  },
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    exerciseId: 'ex-v-4',
    knowledgePointIds: ['unit-math::kp1'],
    wrongAt: '2025-01-10T09:30:00.000Z',
    wrongCount: 1,
    mastered: true,
    masteryLevel: 'mastered',
    reviewCorrectCount: 2,
    questionData: {
      id: 'ex-v-4',
      question: '12 × 5 = ?',
      options: ['A. 50', 'B. 60', 'C. 70'],
      answer: 'B',
      type: 'choice',
    },
    lastUserAnswer: 'B',
  },
]

/** 家长端进度（已掌握 2 / 学习中 1 / 需复习 1 / 未学 1 → 掌握率 40%） */
const PROGRESS: Array<Record<string, unknown>> = [
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    knowledgePointId: 'unit-math::kp1',
    status: '已掌握',
    correctCount: 5,
    wrongCount: 0,
    correctStreak: 4,
    wrongStreak: 0,
    lastStudiedAt: STUDIED_AT,
    studySeconds: 600,
  },
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    knowledgePointId: 'unit-math::kp2',
    status: '已掌握',
    correctCount: 5,
    wrongCount: 0,
    correctStreak: 4,
    wrongStreak: 0,
    lastStudiedAt: STUDIED_AT,
    studySeconds: 300,
  },
  {
    profileId: PROFILE_ID,
    packageId: 'unit-math',
    knowledgePointId: 'unit-math::kp3',
    status: '学习中',
    correctCount: 1,
    wrongCount: 1,
    correctStreak: 0,
    wrongStreak: 1,
    lastStudiedAt: STUDIED_AT,
    studySeconds: 120,
  },
  {
    profileId: PROFILE_ID,
    packageId: 'unit-english',
    knowledgePointId: 'unit-english::kp1',
    status: '需复习',
    correctCount: 2,
    wrongCount: 3,
    correctStreak: 0,
    wrongStreak: 2,
    lastStudiedAt: STUDIED_AT_3D,
    studySeconds: 60,
  },
]

/** 家长端额外 settings 行（打卡 + 成就；不预种 streak-3 会让 settle 弹 toast） */
const PARENT_SETTINGS: Array<{ key: string; value: unknown }> = [
  {
    key: 'studyStreak:default',
    value: { current: 5, longest: 5, lastDate: '2025-01-15' },
  },
  {
    key: 'achievements:default',
    value: [
      { id: 'first-step', unlockedAt: '2025-01-10', evidence: '已掌握 1 个知识点' },
      { id: 'streak-3', unlockedAt: '2025-01-12', evidence: '连续学习 3 天' },
    ],
  },
]

// ===========================================================================
// 播种 / 等待（照抄 learn-status-visual.spec.ts 的已验证链路）
// ===========================================================================

/** `.ach-head-count` 只在读库完成后渲染 → 「Dexie 已建好 v4 schema」的可靠信号 */
async function waitDbReady(page: Page): Promise<void> {
  await page.locator('.hall-head-count, .ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
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

/** 播种载荷（结构化克隆进页面） */
interface SeedPayload {
  packages: Array<Record<string, unknown>>
  progress: Array<Record<string, unknown>>
  mistakes: Array<Record<string, unknown>>
  settings: Array<{ key: string; value: unknown }>
}

/**
 * 一个 transaction 写完 `settings` / `packages` / `progress` / `mistakes`。
 *
 * 跨表半截状态（包有了但进度没写、或进度写了但档案不对）会让断言随机红；
 * `indexedDB.open(dbName)` **不带版本号**——此时 App 已建好 v4 库，不会造空库。
 */
async function seedAll(page: Page, seed: SeedPayload): Promise<void> {
  await page.evaluate(
    async ({ dbName, seed: payload, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'progress', 'mistakes'], 'readwrite')
        // 档案表：没有它 `currentProfileId()` 回落到 default，进度行按 pid 过滤后全是空的
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        for (const rec of payload.settings) tx.objectStore('settings').put(rec)
        for (const pkg of payload.packages) tx.objectStore('packages').put(pkg)
        for (const row of payload.progress) tx.objectStore('progress').put(row)
        for (const row of payload.mistakes) tx.objectStore('mistakes').put(row)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, seed, profileId: PROFILE_ID, createdAt: PROFILE_CREATED_AT }
  )
}

/** 预置主题 + 冻结时钟（与 learn-status-visual.spec.ts 逐行同构） */
async function installDeterminismHooks(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    (cfg: { mode: string; fixedNow: number }) => {
      const { mode: m, fixedNow } = cfg

      // ---- 冻结时钟：报告 / 打卡 / "x 天前" 这类相对时间必须确定 ----
      const RealDate = Date
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
 * `achievementStore` 的待播队列后弹一枚 `.ach-toast`。它是 `position: fixed`
 * 的浮层，正好可能压在内容上方，而它什么时候消失取决于真实计时器
 * （`DISPLAY_MS = 2600`，队列逐条播放，首次结算还有 `scheduleSettle(800ms)`
 * 去抖）—— 「截图那一刻 toast 在不在」不可复现。
 * 本文件已预种会解锁的成就（first-step / streak-3）规避大部分 toast，
 * 但保留这道闸：播种数据将来若调整，确定性不随之漂移。
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

/** 家长端「异步数据已加载完」的锚点（高频错题区只在 loadUserData 之后才有内容） */
async function waitParentLoaded(page: Page): Promise<void> {
  await expect(page.locator('.top-item').first()).toBeVisible({ timeout: 20_000 })
}

/** 清库 → 等 schema → 播种 → 进目标路由 */
async function openSeeded(page: Page, path: string, seed: SeedPayload): Promise<void> {
  await page.goto('/home')
  await resetDb(page)
  await waitDbReady(page)
  await seedAll(page, seed)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

// ===========================================================================
// 截图矩阵
// ===========================================================================

interface ShotSpec {
  key: string
  path: string
  seed: SeedPayload
  /** 截图前的额外准备（如点按钮出卡片） */
  prepare?: (page: Page) => Promise<void>
  /** 就绪断言（数量必须精确：少一张 = 播种没生效，基线会静默退化成空态） */
  assertReady: (page: Page) => Promise<void>
}

const MISTAKES_SEED: SeedPayload = {
  packages: [MATH_PKG],
  progress: [],
  mistakes: MISTAKES,
  settings: [],
}

const PARENT_SEED: SeedPayload = {
  packages: [MATH_PKG, ENGLISH_PKG],
  progress: PROGRESS,
  mistakes: MISTAKES,
  settings: PARENT_SETTINGS,
}

const SHOTS: ShotSpec[] = [
  {
    key: 'mistakes-with-data',
    path: '/mistakes',
    seed: MISTAKES_SEED,
    assertReady: async (page) => {
      // 统计横幅四态同屏：总 4 / 未掌握 2 / 部分掌握 1 / 已掌握 1（三级各至少一条）
      const blocks = page.locator('.stats-banner .stat-block')
      await expect(blocks).toHaveCount(4)
      await expect(blocks.nth(0)).toContainText('4')
      await expect(blocks.nth(1)).toContainText('2')
      await expect(blocks.nth(2)).toContainText('1')
      await expect(blocks.nth(3)).toContainText('1')
      // 列表只渲染待复习：2 张未掌握（红条）+ 1 张部分掌握（黄条）
      await expect(page.locator('.mistake-card')).toHaveCount(3)
      await expect(page.locator('.mistake-card.ml-none')).toHaveCount(2)
      await expect(page.locator('.mistake-card.ml-partial')).toHaveCount(1)
      // E3 新入口按钮在横幅操作区（与导出并排）
      await expect(page.getByRole('button', { name: '一键生成练习卷' })).toBeVisible()
      // 归属包标签解析得出（不显示裸 packageId）
      await expect(page.locator('.mistake-pkg').first()).toContainText('四年级数学（上）')
    },
  },
  {
    key: 'parent-weekly-card',
    path: '/parent',
    seed: PARENT_SEED,
    prepare: async (page) => {
      await waitParentLoaded(page)
      // 卡片是快照按钮触发：点了才出现
      await page.getByRole('button', { name: '生成周报卡片' }).click()
      await expect(page.locator('.weekly-card')).toBeVisible({ timeout: 10_000 })
    },
    assertReady: async (page) => {
      const card = page.locator('.weekly-card')
      await expect(card).toHaveCount(1)
      // 核心数字区四张：已掌握 2/5 · 40% · 5 天 · 18 分钟
      await expect(card.locator('.weekly-stat')).toHaveCount(4)
      await expect(card.locator('.weekly-stat').nth(0)).toContainText('2')
      await expect(card.locator('.weekly-stat').nth(0)).toContainText('/5')
      await expect(card.locator('.weekly-stat').nth(1)).toContainText('40')
      await expect(card.locator('.weekly-stat').nth(2)).toContainText('5')
      await expect(card.locator('.weekly-stat').nth(3)).toContainText('18')
      // 学科行 2（封顶 4 内）、近 7 天 7 根柱、高频错题 3 行（封顶 5 内）
      await expect(card.locator('.weekly-subject-item')).toHaveCount(2)
      await expect(card.locator('.weekly-day')).toHaveCount(7)
      const tops = card.locator('.weekly-top-item')
      await expect(tops).toHaveCount(3)
      await expect(tops.nth(0)).toContainText('两位数乘法')
      await expect(tops.nth(0)).toContainText('错 3 次')
      // 2 / 37：27 是 V1.6 的数，V2.8 · C1 加了 10 枚习惯成就
      await expect(card.locator('.weekly-card__ach')).toHaveText('🏅 成就 2 / 37')
      // 遮罩不入境：截图时 exporting 必须是 false（没有 fixed 浮层）
      await expect(page.locator('.export-overlay')).toHaveCount(0)
      // 页面其它区也随播种渲染（家长端总览六卡 / 学科分布 / Top5）
      await expect(page.locator('.overview-grid .stat-card')).toHaveCount(6)
      await expect(page.locator('.subject-item')).toHaveCount(2)
      await expect(page.locator('.top-item')).toHaveCount(3)
    },
  },
]

for (const shot of SHOTS) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${shot.key}-${mode}`, async ({ page }) => {
      await installDeterminismHooks(page, mode)
      await openSeeded(page, shot.path, shot.seed)

      // 先做截图前的额外准备（如点按钮出卡片），再跑就绪断言 ——
      // 顺序反了会让"断言卡片内容"跑在"卡片还没生成"之前（假红）。
      if (shot.prepare) await shot.prepare(page)
      // 就绪断言（播种生效 + 目标元素在场，数量精确）
      await shot.assertReady(page)

      // 等图表 / 过渡 / 字体稳定（与 learn-status-visual.spec.ts 同一等待）
      await page.waitForTimeout(1200)
      // 再等成就 toast 这种 fixed 浮层安静下来：否则它会压在内容上，
      // 且"截到没截到"不可复现
      await waitToastsSettled(page)

      // ★ 截图前必须回到顶部：`prepare` 里的 click 会把页面滚动到按钮处
      //   （Playwright 的 click 自带 scrollIntoViewIfNeeded），而 AppShell 的
      //   `.app-header` 是 `position: sticky` —— 带着非零 scrollY 做 fullPage
      //   截图， sticky 头会被拼接伪影画到页面中缝（实测盖住一行 Top 错题）。
      //   这是"点了按钮再截图"这个模式自带的确定性陷阱，不是页面 bug。
      await page.evaluate(() => window.scrollTo(0, 0))

      await freezeSmil(page)
      await page.screenshot({
        path: `docs/screenshots/${shot.key}-${mode}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    })
  }
}
