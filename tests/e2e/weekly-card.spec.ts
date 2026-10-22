import { test, expect, type Page } from '@playwright/test'

/**
 * E3 · 家长周报卡片（生成 + 导出 PNG，功能断言）
 * =====================================================================
 * 装配口径由 `tests/weekly-card.test.ts` 的 10 条单测钉死；本 spec 只验
 * **接得上 + 导得出**：
 *
 *   1. `/parent` 点「生成周报卡片」→ 卡片出现，且卡上的数字就是播种的那组
 *      （已掌握 2/5、掌握率 40%、连续 5 天、累计 18 分钟、Top 错题求和…）；
 *   2. 点「导出图片」→ 真的产出一个 **download 事件**，文件名带本地日期
 *      （`weekly-card-2025-01-15.png`）。
 *
 * ## 为什么断言 download 而不是"按钮不报错"
 * `exportWeeklyCardPng` 里任何一步抛错都会被 Parent.vue 的 catch 吞成一句
 * `message.error`，而"按钮点了有反馈"本身看起来是对的 —— 那是假绿。
 * 所以断言的是 **download 事件 + suggestedFilename**（照
 * `tests/e2e/achievement-story.spec.ts:142-148` 的范式）。本文件的下载用例
 * 做过反向验证：把导出函数临时改成抛错，本条必须在 download 事件上红。
 *
 * ## 确定性
 * 冻结时钟到 `FIXED_NOW`（2025-01-15 10:00 本地）—— 卡片生成日期、
 * 近 7 天窗口、导出文件名全部由它决定；进度 `lastStudiedAt` 相对它推导，
 * 不用真时间（`applyDecay` 会把超 7 天未学的"已掌握"降级，种子会随日期腐坏）。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'

/** 固定时刻（本地时间 2025-01-15 10:00:00，无时区后缀 = 按本地时间解析） */
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()

/** 档案创建时刻（字面量，避免非确定性） */
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

async function installClockFreeze(page: Page): Promise<void> {
  await page.addInitScript(
    (fixedNow: number) => {
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
    },
    FIXED_NOW
  )
}

async function waitDbReady(page: Page): Promise<void> {
  // `.ach-head-count` 只在读库完成后渲染 → 「Dexie 已建好 v4 schema」的可靠信号。
  // 裸开 IDB 抢在 Dexie 之前会造空库（V1.3 已踩过）。
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

/** 两个单元包：math 3 KP + english 2 KP（学科行恰好 2 行，测不满封顶） */
const PACKAGES: Array<Record<string, unknown>> = [
  {
    packageId: 'unit-math',
    manifest: {
      packageId: 'unit-math',
      type: 'unit',
      subject: 'math',
      grade: 4,
      term: 'up',
      title: 'E3 周报 · 数学',
    },
    knowledgePoints: [
      { id: 'unit-math::kp1', title: '两位数乘法' },
      { id: 'unit-math::kp2', title: '带余除法' },
      { id: 'unit-math::kp3', title: '小数意义' },
    ],
    exercises: [],
    units: [
      {
        id: 'u1',
        title: '单元一',
        topics: [
          {
            id: 't1',
            title: '话题一',
            knowledgePointIds: ['unit-math::kp1', 'unit-math::kp2', 'unit-math::kp3'],
          },
        ],
      },
    ],
  },
  {
    packageId: 'unit-english',
    manifest: {
      packageId: 'unit-english',
      type: 'unit',
      subject: 'english',
      grade: 4,
      term: 'up',
      title: 'E3 周报 · 英语',
    },
    knowledgePoints: [
      { id: 'unit-english::kp1', title: '单词拼写' },
      { id: 'unit-english::kp2', title: '句型转换' },
    ],
    exercises: [],
    units: [
      {
        id: 'u1',
        title: '单元一',
        topics: [{ id: 't1', title: '话题一', knowledgePointIds: ['unit-english::kp1', 'unit-english::kp2'] }],
      },
    ],
  },
]

/**
 * 四表 + 三行 settings 一次播种（跨表半截状态会让断言随机红）。
 *
 * 数字设计（与断言一一对应）：
 *   · 已掌握 2 / 全集 5 → 掌握率 40%；数学 2/3、英语 0/2；
 *   · studySeconds 600+300+120+60 = 1080s → 累计 18 分钟；
 *   · 近 7 天：3 行学在昨天（01-14）、1 行学在 3 天前（01-12）→ 合计 4；
 *   · 打卡 current=5 且 lastDate=今天 → 连续 5 天（max(旧口径 1, 打卡 5)）；
 *   · 错题：kp1 错 5+2=7 次（Top 1）、kp2 错 1 次；
 *   · 成就：first-step + streak-3 已解锁 → 2 / 27
 *     （刻意预种 streak-3：不种的话 `settle()` 会在加载后解锁它并弹 toast，
 *      虽不影响卡片快照，但会让页面多一个 fixed 浮层，平添不确定因素）。
 */
async function seed(page: Page): Promise<void> {
  await page.evaluate(
    async ({ dbName, packages, fixedNow, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      const isoAgo = (days: number) => new Date(fixedNow - days * 86400_000).toISOString()
      const localDay = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      const progress: Array<Record<string, unknown>> = [
        {
          profileId,
          packageId: 'unit-math',
          knowledgePointId: 'unit-math::kp1',
          status: '已掌握',
          correctCount: 5,
          wrongCount: 0,
          correctStreak: 4,
          wrongStreak: 0,
          lastStudiedAt: isoAgo(1),
          studySeconds: 600,
        },
        {
          profileId,
          packageId: 'unit-math',
          knowledgePointId: 'unit-math::kp2',
          status: '已掌握',
          correctCount: 5,
          wrongCount: 0,
          correctStreak: 4,
          wrongStreak: 0,
          lastStudiedAt: isoAgo(1),
          studySeconds: 300,
        },
        {
          profileId,
          packageId: 'unit-math',
          knowledgePointId: 'unit-math::kp3',
          status: '学习中',
          correctCount: 1,
          wrongCount: 1,
          correctStreak: 0,
          wrongStreak: 1,
          lastStudiedAt: isoAgo(1),
          studySeconds: 120,
        },
        {
          profileId,
          packageId: 'unit-english',
          knowledgePointId: 'unit-english::kp1',
          status: '需复习',
          correctCount: 2,
          wrongCount: 3,
          correctStreak: 0,
          wrongStreak: 2,
          lastStudiedAt: isoAgo(3),
          studySeconds: 60,
        },
      ]

      const mistakes: Array<Record<string, unknown>> = [
        {
          profileId,
          packageId: 'unit-math',
          exerciseId: 'ex-w-1',
          knowledgePointIds: ['unit-math::kp1'],
          wrongAt: isoAgo(2),
          wrongCount: 5,
          mastered: false,
          masteryLevel: 'none',
        },
        {
          profileId,
          packageId: 'unit-math',
          exerciseId: 'ex-w-2',
          knowledgePointIds: ['unit-math::kp1'],
          wrongAt: isoAgo(2),
          wrongCount: 2,
          mastered: false,
          masteryLevel: 'none',
        },
        {
          profileId,
          packageId: 'unit-math',
          exerciseId: 'ex-w-3',
          knowledgePointIds: ['unit-math::kp2'],
          wrongAt: isoAgo(2),
          wrongCount: 1,
          mastered: false,
          masteryLevel: 'none',
        },
      ]

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'progress', 'mistakes'], 'readwrite')
        const settings = tx.objectStore('settings')
        settings.put({
          key: 'profiles',
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        settings.put({
          key: 'studyStreak:default',
          value: { current: 5, longest: 5, lastDate: localDay(new Date(fixedNow)) },
        })
        settings.put({
          key: 'achievements:default',
          value: [
            { id: 'first-step', unlockedAt: '2025-01-10', evidence: '已掌握 1 个知识点' },
            { id: 'streak-3', unlockedAt: '2025-01-12', evidence: '连续学习 3 天' },
          ],
        })
        for (const pkg of packages) tx.objectStore('packages').put(pkg)
        for (const row of progress) tx.objectStore('progress').put(row)
        for (const row of mistakes) tx.objectStore('mistakes').put(row)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, packages: PACKAGES, fixedNow: FIXED_NOW, profileId: PROFILE_ID, createdAt: PROFILE_CREATED_AT }
  )
}

/** 家长端「异步数据已加载完」的锚点：高频错题区只在 loadUserData 之后才有内容 */
async function waitParentLoaded(page: Page): Promise<void> {
  await expect(page.locator('.top-item').first()).toBeVisible({ timeout: 20_000 })
}

/** 等成就 toast 静默（fixed 浮层压内容时点击会不稳定；播种数据不触发新解锁，正常瞬间通过） */
async function waitToastsSettled(page: Page, quietMs = 1500, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let quietSince = Date.now()
  do {
    if ((await page.locator('.ach-toast').count()) > 0) quietSince = Date.now()
    if (Date.now() - quietSince >= quietMs) return
    if (Date.now() > deadline) throw new Error(`${timeoutMs}ms 内成就 toast 没有静默`)
    await page.waitForTimeout(100)
  } while (true)
}

test.describe('E3 · 周报卡片（生成快照 + 导出 PNG）', () => {
  test.beforeEach(async ({ page }) => {
    await installClockFreeze(page)
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)
  })

  test('生成周报卡片 → 卡上数字就是播种的那组', async ({ page }) => {
    await page.goto('/parent')
    await waitParentLoaded(page)
    await waitToastsSettled(page)

    // 生成前没有卡片（快照按钮点了才出现）
    await expect(page.locator('.weekly-card')).toHaveCount(0)
    await page.getByRole('button', { name: '生成周报卡片' }).click()

    const card = page.locator('.weekly-card')
    await expect(card).toBeVisible({ timeout: 10_000 })

    // 卡头：标题 + 档案 + 本地日期范围
    await expect(card.locator('.weekly-card__title')).toHaveText('学习周报')
    await expect(card.locator('.weekly-card__range')).toHaveText('近 7 天 · 2025-01-15')
    await expect(card.locator('.weekly-card__profile')).toContainText('我')

    // 核心数字区（四张）：已掌握 2/5 · 40% · 5 天 · 18 分钟
    const stats = card.locator('.weekly-stat')
    await expect(stats).toHaveCount(4)
    await expect(stats.nth(0)).toContainText('2')
    await expect(stats.nth(0)).toContainText('/5')
    await expect(stats.nth(0)).toContainText('已掌握知识点')
    await expect(stats.nth(1)).toContainText('40')
    await expect(stats.nth(1)).toContainText('掌握率')
    await expect(stats.nth(2)).toContainText('5')
    await expect(stats.nth(2)).toContainText('连续学习')
    await expect(stats.nth(3)).toContainText('18')
    await expect(stats.nth(3)).toContainText('累计时长')

    // 学科行：数学 2/3、英语 0/2（ masteryBySubject 同源）
    const subjects = card.locator('.weekly-subject-item')
    await expect(subjects).toHaveCount(2)
    await expect(subjects.nth(0)).toContainText('数学')
    await expect(subjects.nth(0)).toContainText('2 / 3')
    await expect(subjects.nth(1)).toContainText('英语')
    await expect(subjects.nth(1)).toContainText('0 / 2')

    // 近 7 天：恒定 7 根柱，合计 4 个知识点
    await expect(card.locator('.weekly-day')).toHaveCount(7)
    await expect(card.locator('.weekly-week-total')).toContainText('4')

    // 高频错题：kp1 求和 7 次排第一，kp2 一次
    const tops = card.locator('.weekly-top-item')
    await expect(tops).toHaveCount(2)
    await expect(tops.nth(0)).toContainText('两位数乘法')
    await expect(tops.nth(0)).toContainText('错 7 次')
    await expect(tops.nth(1)).toContainText('带余除法')
    await expect(tops.nth(1)).toContainText('错 1 次')

    // 成就：可收集口径 2 / 27
    await expect(card.locator('.weekly-card__ach')).toHaveText('🏅 成就 2 / 27')
  })

  test('导出图片 → 产出 download 事件，文件名带本地日期', async ({ page }) => {
    await page.goto('/parent')
    await waitParentLoaded(page)
    await waitToastsSettled(page)

    await page.getByRole('button', { name: '生成周报卡片' }).click()
    await expect(page.locator('.weekly-card')).toBeVisible({ timeout: 10_000 })

    // ★ 断言 download 事件 + 文件名，不是"按钮点了不报错"（导出抛错会被
    //   message.error 吞掉，只断言按钮反馈是假绿 —— 反向验证见提交说明）。
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: '导出图片' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('weekly-card-2025-01-15.png')

    // 遮罩必须收起（finally 语义）：导出结束后页面上不留 fixed 浮层
    await expect(page.locator('.export-overlay')).toHaveCount(0)
    // 导出成功有一句明确的提示（含文件名）
    await expect(page.locator('.n-message', { hasText: '已导出周报图片' })).toBeVisible()
  })
})
