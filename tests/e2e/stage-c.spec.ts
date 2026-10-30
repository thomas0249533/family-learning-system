import { test, expect, type Page } from '@playwright/test'

/**
 * V1.6 · Stage C —— 三项功能的**浏览器级**验证（真数据 + 真 IndexedDB）
 * =====================================================================
 * C1 错题归因 / C3 首页弱项推荐 / C5 家长端补签，三者都有一层共同的结构性盲区：
 *
 *   1. 三块 UI 全部被 `v-if` 包着（`m.mistakeCause` 有行才渲染、`weakPoints.length > 0`
 *      才渲染、`missedYesterday && repairLeft > 0` 才渲染），**空数据库下整块不渲染**；
 *   2. 既有单测只覆盖了纯函数（`computeWeakPoints` / `repairYesterday` / `mistakeCauseOf`）
 *      与静态 SFC 断言（"模板里有没有这个 class"）。
 *
 * 也就是说，之前**没有任何测试**证明"有数据时 UI 真的渲染，并且点了之后真的写进
 * 真 IndexedDB"。这个 spec 补的就是这一段：种真数据 → 走真 UI → 断言刷新后仍在。
 *
 * 三条用例的核心断言都不是"元素存在"，而是单测结构上证明不了的东西：
 *   · C1：打标后 `page.reload()` 仍然选中；再点一次后刷新回到「未分类」
 *         —— 守着"取消打标必须真的删键"（旧实现 `update(id, {k: undefined})` 被
 *         `toPlain()` 的 JSON 往返吃掉，静默无效）。
 *   · C3：弱项块的整块文本里**没有**熟练度 / pKnown / `\d+分`（PRD §11.5 硬约束），
 *         且条数被 limit 截到 5；点整行真的带 `?mode=review` 进 TopicDetail。
 *   · C5：额度当天扣干净（补签后再把日期拨回可补签形态，卡片也不许回来）、
 *         连续天数卡跟着变、以及 `settle()` 必须在同一周期内跑完（徽章当场落库）。
 *
 * 纪律说明：
 *   - 本文件**不改 src/**。所有种子日期一律用 `getFullYear/getMonth/getDate` 算本地日，
 *     严禁 `toISOString().slice(0, 10)`（东八区下会退一天，见 `tests/date-discipline.test.ts`）。
 *   - `lastStudiedAt` 一律种成"刚刚"：`loadUserData()` 会跑 `applyDecay`，写死过去的
 *     日期会被降级 —— 那是一个会随时间腐坏的种子。
 */

const DB_NAME = 'FamilyLearningDB'
const STREAK_KEY = 'studyStreak:default'

async function waitDbReady(page: Page): Promise<void> {
  // `.ach-head-count` 只在 `refreshView()`（内部 await 了读库）完成后才渲染，
  // 所以它是"库已建好 v4 表"的可靠信号。裸开 IDB 抢在 Dexie 之前会造空库（V1.3 已踩过）。
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

/** 每个用例的起点：先让 App 把 v4 库建好，再清空 → 用例之间互不依赖执行顺序 */
async function openCleanDb(page: Page): Promise<void> {
  await page.goto('/home')
  await resetDb(page)
  await waitDbReady(page)
}

interface StreakSeed {
  /** 连续天数（current 与 longest 同值，最省心的形状） */
  current: number
  /** 最后一次学习日距今几天：2 = 前天是最后一条 → 昨天漏了（唯一可补签的形态） */
  missedDaysAgo: number
  /** 本月已用补签次数；不给 = 没补过（repair 字段整个不写，与老数据逐字节一致） */
  usedThisMonth?: number
}

interface SeedInput {
  packages?: Record<string, unknown>[]
  progress?: Record<string, unknown>[]
  mistakes?: Record<string, unknown>[]
  /** 额外 settings 行 */
  settings?: Array<{ key: string; value: unknown }>
  streak?: StreakSeed
}

/**
 * 一次性把档案 + 三张表 + 打卡行种进去。
 *
 * 刻意在**一个** transaction 里写完：跨表半截状态会让断言随机红。
 * `indexedDB.open(dbName)` 不带版本号（此时 App 已建好 v4 库），不会造空库。
 */
async function seed(page: Page, input: SeedInput): Promise<void> {
  await page.evaluate(
    async ({ dbName, input }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      const now = new Date()
      const nowIso = now.toISOString()
      // 本地日 / 本地月键：与 src 的 `localDayKey` / `localMonthKey` 同口径
      const localDay = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const localMonth = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'progress', 'mistakes'], 'readwrite')
        const settings = tx.objectStore('settings')
        settings.put({
          key: 'profiles',
          value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: nowIso }] },
        })
        for (const pkg of input.packages ?? []) tx.objectStore('packages').put(pkg)
        // `progress` / `mistakes` 主键都是自增，put 不带 id 就是新增行
        for (const row of input.progress ?? []) tx.objectStore('progress').put(row)
        for (const row of input.mistakes ?? []) tx.objectStore('mistakes').put(row)
        for (const rec of input.settings ?? []) settings.put(rec)

        if (input.streak) {
          const lastDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - input.streak.missedDaysAgo)
          const value: Record<string, unknown> = {
            current: input.streak.current,
            longest: input.streak.current,
            lastDate: localDay(lastDay),
          }
          if (typeof input.streak.usedThisMonth === 'number') {
            // ★ 补签额度就在打卡这一行里（不是独立 settings 键），见 streak.ts 的 StreakState.repair
            value.repair = { month: localMonth(now), used: input.streak.usedThisMonth }
          }
          settings.put({ key: 'studyStreak:default', value })
        }

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, input }
  )
}

/**
 * 只把 `studyStreak:default.lastDate` 拨回"前天"，**保留 repair 字段**，然后 reload。
 *
 * 为什么需要它：补签成功后 `lastDate` 已经是"昨天"，`missedYesterday()` 自己就会把卡片
 * 挡掉 —— 所以"卡片没回来"根本证明不了额度被扣过。把日期拨回可补签形态后仍然不出现，
 * 才说明 `repair.used` 是跟着补签那一次 `put` 一起落库的。
 * 这一条守的是 `streak.ts` 里那句"漏带 repair 的表现是额度悄悄回满（可无限补签）"。
 */
async function rewindStreakToMissedYesterday(page: Page): Promise<void> {
  await page.evaluate(
    async ({ dbName, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      // 读、写分成两个 transaction：在一个事务里 await 另一件事会让它提前失效
      const rec = await new Promise<{ key: string; value: Record<string, unknown> } | undefined>(
        (resolve, reject) => {
          const tx = db.transaction(['settings'], 'readonly')
          const req = tx.objectStore('settings').get(key)
          req.onsuccess = () =>
            resolve(req.result as { key: string; value: Record<string, unknown> } | undefined)
          req.onerror = () => reject(req.error)
        }
      )
      if (!rec) {
        db.close()
        throw new Error(`settings 里没有 ${key}，补签可能没落库`)
      }
      const now = new Date()
      const twoDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2)
      const lastDate = `${twoDaysAgo.getFullYear()}-${String(twoDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(twoDaysAgo.getDate()).padStart(2, '0')}`
      const value = { ...rec.value, lastDate }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings'], 'readwrite')
        tx.objectStore('settings').put({ key, value })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, key: STREAK_KEY }
  )
  await page.reload()
}

/** 家长端总览里某张统计卡的数值（Parent.vue 的「连续天数」等） */
function statValue(page: Page, label: string) {
  return page.locator('.stat-card', { hasText: label }).locator('.stat-card__value')
}

// ===========================================================================
// C1 · 错题归因（src/views/Mistakes.vue + core/stores/userData.ts#setMistakeCause）
// ===========================================================================

test.describe('C1 · 错题归因（打标 / 取消打标都要真的落库）', () => {
  test('点「粗心大意」→ 刷新仍是它；再点一次 → 刷新回到「未分类」', async ({ page }) => {
    await openCleanDb(page)

    // 一条未打标的错题。**不写 mistakeCause** —— 默认就该是「未分类」。
    // questionData 只为了让题干不是"题目数据已过期"，与断言无关。
    await seed(page, {
      mistakes: [
        {
          profileId: 'default',
          packageId: 'unit-c1',
          exerciseId: 'ex-c1-1',
          knowledgePointIds: ['unit-c1::kp1'],
          wrongAt: new Date().toISOString(),
          wrongCount: 1,
          mastered: false,
          masteryLevel: 'none',
          questionData: {
            question: '3 × 4 = ?',
            options: ['A. 12', 'B. 7'],
            answer: 'A',
            type: 'choice',
          },
          lastUserAnswer: 'B',
        },
      ],
    })

    await page.goto('/mistakes')
    const group = page.locator('.mistake-cause[role="radiogroup"]').first()
    await expect(group).toBeVisible({ timeout: 20_000 })

    // 四个选项按 MISTAKE_CAUSE_ORDER 渲染（顺序即语义），标签全是中文、不出现英文码
    const options = group.locator('.cause-opt')
    await expect(options).toHaveCount(4)
    await expect(options).toHaveText(['知识盲区', '粗心大意', '超时未完成', '审题不清'])

    // 初始态：不替用户选一个 —— 既没有选中项，又有「未分类」占位
    await expect(group.locator('.cause-opt.on')).toHaveCount(0)
    await expect(group.locator('.cause-unset')).toHaveText('未分类')

    const careless = group.locator('.cause-opt', { hasText: '粗心大意' })

    // ---------- 打标 ----------
    await careless.click()
    await expect(group.locator('.cause-opt.on')).toHaveText('粗心大意')
    await expect(careless.locator('input')).toBeChecked()
    // 打上标后「未分类」占位必须消失（否则会出现"已选 A 又说未分类"的自相矛盾）
    await expect(group.locator('.cause-unset')).toHaveCount(0)

    // ★ 核心：整页重载后仍然选中 —— 这才是"真的写进 IndexedDB"（内存态不参与 reload）
    await page.reload()
    const afterReload = page.locator('.mistake-cause[role="radiogroup"]').first()
    await expect(afterReload.locator('.cause-opt.on')).toHaveText('粗心大意')
    await expect(
      afterReload.locator('.cause-opt', { hasText: '粗心大意' }).locator('input')
    ).toBeChecked()
    await expect(afterReload.locator('.cause-unset')).toHaveCount(0)

    // ---------- 取消打标（点已选中项）----------
    await afterReload.locator('.cause-opt', { hasText: '粗心大意' }).click()
    await expect(afterReload.locator('.cause-opt.on')).toHaveCount(0)
    await expect(afterReload.locator('.cause-unset')).toHaveText('未分类')

    // ★ 核心：取消必须在库里**真的删掉这个键**，不能只是内存里置空。
    //   旧实现 `db.mistakes.update(id, { mistakeCause: undefined })` 会先被 `toPlain()`
    //   的 JSON 往返把 undefined 键整个丢掉，patch 变成 `{}` → 刷新后标签又冒出来。
    await page.reload()
    const afterCancel = page.locator('.mistake-cause[role="radiogroup"]').first()
    await expect(afterCancel.locator('.cause-opt.on')).toHaveCount(0)
    await expect(afterCancel.locator('.cause-unset')).toHaveText('未分类')
  })
})

// ===========================================================================
// C3 · 首页「今日计划 · 最需要复习」（src/views/Home.vue:58-79）
// ===========================================================================

const C3_PKG = 'unit-c3'
const C3_KP_COUNT = 7

/** 一个带 units/topics 的单元包：`goToWeakPoint` 要靠 units 里的 kp 反查才能跳进 TopicDetail */
function c3Package(): Record<string, unknown> {
  const knowledgePoints = Array.from({ length: C3_KP_COUNT }, (_, i) => ({
    id: `${C3_PKG}::kp${i}`,
    title: `知识点${i + 1}`,
  }))
  return {
    packageId: C3_PKG,
    manifest: {
      packageId: C3_PKG,
      type: 'unit',
      subject: 'math',
      grade: 4,
      term: 'up',
      title: 'C3 测试单元',
    },
    knowledgePoints,
    exercises: [],
    units: [
      {
        id: 'u1',
        title: '单元一',
        topics: [
          { id: 't1', title: '话题一', knowledgePointIds: knowledgePoints.map((k) => k.id) },
        ],
      },
    ],
  }
}

test.describe('C3 · 首页弱项推荐（只展事实、不露分数）', () => {
  test('弱项块出现 + 条数封顶 5 + 文案里没有分数 + 点整行进复习模式', async ({ page }) => {
    await openCleanDb(page)

    const pkg = c3Package()
    const nowIso = new Date().toISOString()
    const overdueIso = new Date(Date.now() - 3 * 86400_000).toISOString()

    // 7 条弱项（`computeWeakPoints` 默认 limit=5）：
    //   · status '学习中' + nextReviewAt 已过期 + wrongCount>0 → 必然入选，reason 是事实型文案；
    //   · status 刻意**不用**「需复习」：那会被 `generateRecommendations` 抢成今日推荐的
    //     `review` 类，随后被 `excludeKpIds` 从弱项里排掉 —— 那样测到的就是空态。
    //   · lastStudiedAt 用"刚刚"：`loadUserData()` 会跑 `applyDecay`，写死过去日期会腐坏。
    await seed(page, {
      packages: [pkg],
      progress: Array.from({ length: C3_KP_COUNT }, (_, i) => ({
        profileId: 'default',
        packageId: C3_PKG,
        knowledgePointId: `${C3_PKG}::kp${i}`,
        status: '学习中',
        correctCount: 1,
        // kp0 错 3 次（最高 → 排序后必是第一条），其余错 2 次
        wrongCount: i === 0 ? 3 : 2,
        correctStreak: 0,
        wrongStreak: 1,
        lastStudiedAt: nowIso,
        studySeconds: 60,
        reviewStage: 1,
        nextReviewAt: overdueIso,
        lastReviewAt: null,
        // BKT 概率：让 `computeMasteryScore` 真的算出一个数（≈42）。
        // ★ 故意种进来：库里**有**熟练度可算，UI 仍然一个字都不许露 ——
        //   没有这个字段时 score 是 null，"没露分数"可能只是"压根没有分数"。
        masteryProbability: 0.42,
      })),
    })

    await page.goto('/home')
    // V3.0 · M1 首页改版：三块推荐（今日复习 / 最需要复习 / 今日推荐）默认收进
    // 「更多推荐」折叠区 —— 首页第一屏只留「今天的学习」一个主入口。
    // 这一条测的是**弱项块本身**的规则（排序 / 上限 / 不露分数），所以先展开。
    // 折叠态本身由 `today-plan.spec.ts` 的 `aria-expanded=false` 断言守着。
    const more = page.locator('.more-toggle')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')

    const block = page.locator('.plan-block', { hasText: '最需要复习' })
    await expect(block).toBeVisible({ timeout: 20_000 })

    // a. 排序 + 事实型文案：wrongCount 降序 → 第一条是 kp0，reason 同时陈述"错了几次"与"该复习了"
    const rows = block.locator('.weak-row')
    await expect(rows).toHaveCount(5) // c. 上限：种了 7 条，块内只能出 5 条
    await expect(block.locator('.app-badge__label')).toContainText('5 个')
    await expect(rows.first().locator('.weak-title')).toHaveText('知识点1')
    await expect(rows.first().locator('.weak-reason')).toHaveText('错了 3 次，且到了该复习的时间')

    // b. §11.5 硬约束的**反向**断言：拿整块文本正则反查，不只查元素存在。
    //    熟练度 / pKnown / "45 分" 这类表达一旦漏进 UI，家长会把它读成对孩子的打分。
    const blockText = (await block.innerText()).replace(/\s+/g, ' ')
    expect(blockText, '§11.5：弱项区不得出现「熟练度」').not.toContain('熟练度')
    expect(blockText, '§11.5：弱项区不得出现 pKnown / BKT 概率').not.toContain('pKnown')
    expect(blockText, '§11.5：弱项区不得出现「N 分」式打分').not.toMatch(/\d+\s*分/)
    expect(blockText, '§11.5：弱项区不得出现百分比打分').not.toMatch(/\d+\s*%/)
    expect(blockText, '§11.5：弱项区不得出现「掌握度」').not.toContain('掌握度')

    // d. 点整行 → 带 `?mode=review` 进 TopicDetail 的复习模式。
    //    只验 URL（`TopicDetail.vue` 的 reviewMode 就是 `route.query.mode === 'review'`）；
    //    scrollTop 受布局/滚动容器影响不稳定，不做断言。
    await rows.first().click()
    await expect(page).toHaveURL(/mode=review/)
    await expect(page).toHaveURL(new RegExp(`/learn/${C3_PKG}/unit/u1/topic/t1`))
    // 顺带证明 TopicDetail 侧真的认了这个 query（不只是 URL 多了个参数）
    await expect(page.locator('.review-mode-banner')).toBeVisible()
  })
})

// ===========================================================================
// C5 · 家长端补签（src/views/Parent.vue:111-123 + core/motivation/streak.ts）
// ===========================================================================

/**
 * 家长端「异步数据已加载完」的锚点。
 *
 * 高频错题区是 `v-if="topMistakes.length > 0"`，而 `topMistakes` 只从
 * `userDataStore.mistakes`（初始 `[]`）算 —— 那个数组要等 `onMounted` 里
 * `await loadUserData()` 之后才有内容。所以「`.top-item` 出现」= 这次加载真的跑过了。
 *
 * 负向断言必须有这个前提：SPA 还没挂载完就断言"卡片不存在"，会立刻满足（假绿）。
 */
async function waitParentLoaded(page: Page): Promise<void> {
  await expect(page.locator('.top-item').first()).toBeVisible({ timeout: 20_000 })
}

/**
 * 断言某个选择器在一次完整加载期间**从未出现**。
 *
 * 为什么不能只写 `toHaveCount(0)`：那条断言在元素数已经是 0 时**立刻**通过，
 * 不管页面稍后会不会渲染出来。反向验证时确实踩到了这个假绿 —— 把补签的额度扣减
 * 改成 `used: 0`（= 额度悄悄回满），"补签后卡片不该回来"那条依然绿。
 * 所以：先等加载锚点，再在一个短窗口内持续采样，任何一刻出现即失败。
 */
async function expectNeverAppears(page: Page, selector: string, windowMs = 1200): Promise<void> {
  const deadline = Date.now() + windowMs
  for (;;) {
    expect(await page.locator(selector).count(), `${selector} 不该出现`).toBe(0)
    if (Date.now() >= deadline) return
    await page.waitForTimeout(120)
  }
}

/**
 * 一条未掌握的错题。**只为给家长端提供"数据已加载"的锚点**（见 `waitParentLoaded`），
 * 与 C5 要验证的补签逻辑无关。
 */
function anchorMistake(): Record<string, unknown> {
  return {
    profileId: 'default',
    packageId: 'unit-c5',
    exerciseId: 'ex-c5-anchor',
    knowledgePointIds: ['unit-c5::kp1'],
    wrongAt: new Date().toISOString(),
    wrongCount: 1,
    mastered: false,
    masteryLevel: 'none',
  }
}

/** 点「确认补签」并走完 naive-ui 二次确认（这一下的语义是家长签字，不是"点一下试试"） */
async function confirmRepair(page: Page): Promise<void> {
  await page.locator('.repair-card').getByRole('button', { name: '确认补签' }).click()
  const dialog = page.locator('.n-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('确认孩子昨天真的练过吗')
  await dialog.getByRole('button', { name: '确认，昨天练过' }).click()
}

test.describe('C5 · 家长端补签（额度 / 连续天数 / 同周期结算）', () => {
  test('满足「昨天漏学 + 有额度」才出现；确认后连续天数 +1、卡片消失、额度扣干净', async ({ page }) => {
    await openCleanDb(page)
    // current=5 且 lastDate 是"前天" → diff === 2，正是 missedYesterday 唯一认的形态
    await seed(page, { streak: { current: 5, missedDaysAgo: 2 }, mistakes: [anchorMistake()] })

    await page.goto('/parent')
    const repairCard = page.locator('.repair-card')
    await expect(repairCard).toBeVisible({ timeout: 20_000 })
    // a. 文案必须把"还剩几次"说清楚（额度就在打卡那一行里，读的是 repairLeft）
    await expect(repairCard).toContainText(/本月还剩\s*1\s*次/)

    // 补签前：连续天数卡显示 0 —— 断两天 `effectiveCurrent` 归零，这正是补签要救的那个视觉
    await expect(statValue(page, '连续天数')).toHaveText('0')

    await confirmRepair(page)

    // b. 补签成功：连续天数 5 → 6，页面上两句提示都是同一份结果算出来的
    await expect(page.locator('.n-message', { hasText: '连续天数恢复为 6 天' })).toBeVisible()
    await expect(statValue(page, '连续天数')).toHaveText('6')
    // 卡片消失（本来就被 `missedYesterday` 挡掉了：lastDate 已补成"昨天"）
    await expect(repairCard).toHaveCount(0)

    // ★ 额度真的落库了：把 lastDate 拨回可补签形态（保留 repair 字段）后，卡片仍不许回来。
    //   补签若漏带 `repair`（`touchStudyDay` 那里有同样的坑），这里会红 —— 那等于额度无限用。
    await rewindStreakToMissedYesterday(page)
    await waitParentLoaded(page)
    await expectNeverAppears(page, '.repair-card')
  })

  test('额度用尽：本月已用 1 次 → 补签卡不出现（防刷）', async ({ page }) => {
    await openCleanDb(page)
    // 形态上完全可补签（diff === 2），唯一差别是本月的 1 次额度已经用掉
    await seed(page, {
      streak: { current: 5, missedDaysAgo: 2, usedThisMonth: 1 },
      mistakes: [anchorMistake()],
    })

    await page.goto('/parent')
    await waitParentLoaded(page)
    await expectNeverAppears(page, '.repair-card')
    // 没有任何"补签被拒"的补救出口：卡片不出现，家长也就点不出补签
    await expect(page.locator('.repair-card').getByRole('button', { name: '确认补签' })).toHaveCount(0)

    // 正对照：同样的 streak，只把额度改回"没用过" → 卡片必须出现。
    // 否则上面那条"不出现"也可能是因为别的条件没满足（假绿）。
    await seed(page, { streak: { current: 5, missedDaysAgo: 2 } })
    await page.reload()
    await expect(page.locator('.repair-card')).toBeVisible()
  })

  test('补签成功后在同一周期内结算成就（连续 3 天 → 当场解锁「三日之约」）', async ({ page }) => {
    await openCleanDb(page)
    // 刻意从 2 起步（而不是 5）：5→6 不跨过任何 streak 门槛，那样即使 `settle()` 一次都没跑，
    // 断言也会绿。2→3 恰好跨过 `streak-3` 的门槛，才能证明结算真的发生了。
    await seed(page, { streak: { current: 2, missedDaysAgo: 2 } })

    await page.goto('/parent')
    await expect(page.locator('.repair-card')).toBeVisible({ timeout: 20_000 })
    await expect(statValue(page, '连续天数')).toHaveText('0')

    // 补签前先记下「成就概览」的分子（`已解锁 N / 27`）与最近解锁区。
    // 等 `.repair-card` 可见 = `onMounted` 全跑完（`loadUnlocked` 在 `refreshStreakState`
    // 之前），所以此刻读到的 N 是"加载完成后"的真实值，不是挂载前的默认 0。
    const achTotalValue = page.locator('.ach-total-value')
    await expect(achTotalValue).toBeVisible()
    const unlockedBefore = Number((await achTotalValue.innerText()).split('/')[0].trim())
    expect(Number.isFinite(unlockedBefore), `.ach-total-value 的分子应是数字，实际：${await achTotalValue.innerText()}`).toBe(true)
    await expect(page.locator('.ach-recent-empty')).toBeVisible()
    await expect(page.locator('.ach-recent-item')).toHaveCount(0)

    await confirmRepair(page)

    // ★ 这句 `新解锁：…` 只可能来自 `doRepair()` 里 `achievementStore.settle()` 的返回值。
    //   补签写的是 settings，**不会**触发 AppShell 那几个 progress/mistakes/packages 触发器，
    //   所以它一旦出现，就说明"同一用户操作周期内结算"这条真的做到了（Parent.vue:557）。
    await expect(page.locator('.n-message', { hasText: '新解锁：三日之约' })).toBeVisible()

    /*
     * ★★ 同一屏（**不 reload、不 goto**）的成就概览必须跟着变。
     *
     * 这是 §11.1 那句"补签了、天数恢复了、徽章没亮"的**字面**验收面：家长端
     * 「已解锁 N / 27」「按小组」「最近解锁」全部派生自 `unlockedRecords`
     * （一个普通 ref，不是 store 的响应式数据），只在 onMounted / 切档案时赋值。
     * `settle()` 只更新 store 的 `records`，所以少了"settle 之后重读 `loadUnlocked()`"
     * 这一步，就会出现"提示说解锁了、同一屏数字纹丝不动、刷新后才变"。
     *
     * 断言刻意**不借助任何 navigation**：一旦靠 goto('/achievements') 顺带满足，
     * 这条守卫就什么也守不住（页面重挂载自然会重读）。所以这里要求：
     *   ① 分子 +1；② 「最近解锁」真的出现刚解锁的那枚（含标题）。
     */
    await expect(achTotalValue).toHaveText(new RegExp(`^\\s*${unlockedBefore + 1}\\s*/`))
    await expect(page.locator('.ach-recent-empty')).toHaveCount(0)
    const recent = page.locator('.ach-recent-item')
    await expect(recent).toHaveCount(1)
    await expect(recent.first()).toContainText('三日之约')

    await expect(statValue(page, '连续天数')).toHaveText('3')
    await expect(page.locator('.repair-card')).toHaveCount(0)

    // 落库面：刷新后图鉴里这枚卡是真的 earned（settle 写的是 `achievements:default`）
    await page.goto('/achievements')
    await waitDbReady(page)
    const toggle = page.locator('.ach-head-toggle')
    if (await toggle.count()) await toggle.first().click()
    await expect(page.locator('.ach-card.earned', { hasText: '三日之约' })).toHaveCount(1)
  })
})
