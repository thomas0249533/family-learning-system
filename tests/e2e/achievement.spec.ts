import { test, expect, type Page } from '@playwright/test'

/**
 * 成就链路端到端验证（V1.3 · A-03/A-04/A-05）
 *
 * 覆盖 PRD §9.2 里只能在真机验证的几条：
 *   AC-10 首次进入「已获得」收起、「待解锁」展开；刷新后保持用户上次状态
 *   AC-11 一键全部展开 / 全部收起，按钮文案与状态一致
 *   AC-12 折叠头是原生按钮，aria-expanded 随状态变化
 *   AC-14 隐藏成就未解锁时 DOM 里搜不到真实标题/描述
 *   AC-15 0 枚不渲染「已获得」区；全收集时隐藏「待解锁」区
 *   以及解锁链路：满足条件 → 计入已获得 → 弹提示 → 刷新不重复弹
 *
 * 做法：直接往 IndexedDB 种数据，让真实链路（AppShell 触发器 → store.settle →
 * syncAchievements → toast）自己跑，不 mock 任何业务代码。
 */

/** 种数据：一个 unit 包 + 一条已掌握进度（= 满足「迈出第一步」） */
async function seedMasteredOne(page: Page): Promise<void> {
  // ⚠️ 必须等 Dexie 真的开过库再种数据：此时若用裸 `indexedDB.open(name)`
  // （不带版本号）抢先建库，会造出一个"没有任何表"的空库，后续 Dexie 升级就对不上了。
  // `.ach-head-count` 只在 `refreshView()`（内部 await 了读库）完成后才渲染，
  // 所以它是"库已就绪"的可靠信号。
  await page.locator('.ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('FamilyLearningDB')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const names = Array.from(db.objectStoreNames)
        if (!names.includes('packages') || !names.includes('progress')) {
          reject(new Error(`DB 尚未建表：${names.join(',')}`))
          return
        }
        const tx = db.transaction(['packages', 'progress'], 'readwrite')
        tx.objectStore('packages').put({
          packageId: 'unit-math-e2e',
          manifest: {
            packageId: 'unit-math-e2e',
            type: 'unit',
            subject: 'math',
            grade: 4,
            term: 'up',
            title: 'E2E 测试单元',
          },
          knowledgePoints: [{ id: 'unit-math-e2e::kp1', title: '两位数乘法' }],
          exercises: [],
          units: [],
        })
        // V1.4 · B1：行上必须带 profileId，否则 v4 之后这些行读不到
        //（迁移只在 upgrade 时补列，这里是在 v4 库上"事后种数据"，不会再被补）
        tx.objectStore('progress').put({
          profileId: 'default',
          packageId: 'unit-math-e2e',
          knowledgePointId: 'unit-math-e2e::kp1',
          status: '已掌握',
          correctCount: 3,
          wrongCount: 0,
          correctStreak: 3,
          wrongStreak: 0,
          lastStudiedAt: new Date().toISOString(),
          studySeconds: 60,
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
}

/**
 * 种数据：一次结算会同时解锁 **5 枚**（first-step / ten-kp / mistake-first / streak-3 / streak-7）。
 *
 * 刻意凑到 ≥4 枚，用来验证「合并成一条提示」这条规则（AC-07）。
 * 其余成就都被压在门槛下面（掌握率 25%、没有 dailyStats、只有 1 个包…），
 * 所以枚数是确定的，不存在"环境不同数量不同"的抖动。
 */
async function seedFiveUnlocks(page: Page): Promise<void> {
  await page.locator('.ach-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('FamilyLearningDB')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const names = Array.from(db.objectStoreNames)
        if (!names.includes('packages') || !names.includes('progress')) {
          reject(new Error(`DB 尚未建表：${names.join(',')}`))
          return
        }
        const tx = db.transaction(['packages', 'progress', 'mistakes', 'settings'], 'readwrite')

        const kps = Array.from({ length: 10 }, (_, i) => ({
          id: `unit-math-e2e::kp${i}`,
          title: `知识点 ${i + 1}`,
        }))
        tx.objectStore('packages').put({
          packageId: 'unit-math-e2e',
          manifest: {
            packageId: 'unit-math-e2e',
            type: 'unit',
            subject: 'math',
            grade: 4,
            term: 'up',
            title: 'E2E 测试单元',
          },
          knowledgePoints: kps,
          exercises: [],
          units: [],
        })

        // 10 个已掌握 → first-step + ten-kp
        for (const kp of kps) {
          tx.objectStore('progress').put({
            profileId: 'default',
            packageId: 'unit-math-e2e',
            knowledgePointId: kp.id,
            status: '已掌握',
            correctCount: 2,
            wrongCount: 0,
            correctStreak: 2,
            wrongStreak: 0,
            lastStudiedAt: new Date().toISOString(),
            studySeconds: 30,
          })
        }

        // 1 道已攻克错题 → mistake-first
        tx.objectStore('mistakes').put({
          profileId: 'default',
          exerciseId: 'e2e-ex-1',
          packageId: 'unit-math-e2e',
          knowledgePointId: 'unit-math-e2e::kp0',
          question: '1 + 1 = ?',
          userAnswer: '3',
          correctAnswer: '2',
          mastered: true,
          reviewCorrectCount: 0,
          createdAt: new Date().toISOString(),
          lastReviewedAt: new Date().toISOString(),
        })

        // 连续 7 天 → streak-3 + streak-7
        const d = new Date()
        const lastDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`
        tx.objectStore('settings').put({
          // V1.4 · B1：settings 键按档案分片，实际落库键带 `:default` 后缀
          key: 'studyStreak:default',
          value: { current: 7, longest: 7, lastDate },
        })

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
}

/**
 * 清库，保证用例之间互不影响。
 *
 * ⚠️ **必须在 `goto` 之后调用**：about:blank 下 IndexedDB 被浏览器禁用（SecurityError）。
 * 折叠偏好存在 `db.settings['achievementUi']` 里（V1.3 起从 localStorage 迁过来），
 * 所以删库就够，**不能**用 addInitScript 清状态 —— 它每次导航都跑，
 * 会把"刷新后保持展开"这条断言直接清掉。
 */
async function resetAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('FamilyLearningDB')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })
  // 删库会让当前页面的 Dexie 连接失效，重新加载拿一个干净起点
  await page.reload()
}

/** 已获得的卡片（`.ach-card.earned`）数量 */
const earnedCards = (page: Page) => page.locator('.ach-card.earned')
const allCards = (page: Page) => page.locator('.ach-card')

test.describe('成就图鉴 · 两级折叠', () => {
  test('默认态：已获得收起、待解锁展开；一键切换；刷新保持（AC-10 / AC-11）', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    const masterToggle = page.getByRole('button', { name: /全部展开|全部收起/ })

    // 0 枚解锁：只有「待解锁」区（AC-15），它默认展开 → 27 张卡都在（可收集口径，V1.6 · C6）
    await expect(page.locator('.ach-part')).toHaveCount(1)
    await expect(page.locator('.ach-part-head')).toContainText('待解锁')
    await expect(page.locator('.ach-empty-hint')).toContainText('还没有徽章')
    await expect(allCards(page)).toHaveCount(27)

    // 全展开 → 按钮变「全部收起」
    await expect(masterToggle).toHaveText('全部收起')
    await masterToggle.click()
    await expect(masterToggle).toHaveText('全部展开')
    await expect(allCards(page)).toHaveCount(0)

    // 再点回全展开，然后刷新验证持久化
    await masterToggle.click()
    await expect(masterToggle).toHaveText('全部收起')
    await page.reload()
    await expect(page.getByRole('button', { name: '全部收起' })).toBeVisible()
    await expect(allCards(page)).toHaveCount(27)
  })

  test('有已获得时：已获得区默认收起，组头给「最接近」提示', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await seedMasteredOne(page)
    await page.reload()

    // 先等解锁 toast 播完，避免它挡住下面的点击（不写死等待时长，等状态）
    await expect(page.locator('.ach-toast')).toHaveCount(0, { timeout: 20_000 })

    // 两个区都在；已获得区收起（其下无卡片），待解锁区展开
    await expect(page.locator('.ach-part')).toHaveCount(2)
    await expect(page.locator('.ach-part-head').first()).toContainText('已获得')
    await expect(earnedCards(page)).toHaveCount(0)
    await expect(page.locator('.ach-head-count')).toHaveText('1 / 27')

    // 展开已获得区 → 那一枚出现，且带证据快照 + 解锁日期
    await page.locator('.ach-part-head').first().click()
    await expect(earnedCards(page)).toHaveCount(1)
    await expect(earnedCards(page).first()).toContainText('迈出第一步')
    await expect(earnedCards(page).first()).toContainText('已掌握 1 个知识点')
    await expect(earnedCards(page).first()).toContainText('解锁于')
    await expect(earnedCards(page).first()).toContainText('精熟之链 1/5')

    // aria-expanded 随状态变化（AC-12）
    await expect(page.locator('.ach-part-head').first()).toHaveAttribute('aria-expanded', 'true')
  })

  test('折叠头是原生按钮，键盘可切换（AC-12）', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    const sectionHead = page.locator('.ach-part-head').first()
    await expect(sectionHead).toHaveJSProperty('tagName', 'BUTTON')
    await expect(sectionHead).toHaveAttribute('aria-expanded', 'true')

    await sectionHead.focus()
    await page.keyboard.press('Enter')
    await expect(sectionHead).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Space')
    await expect(sectionHead).toHaveAttribute('aria-expanded', 'true')
  })
})

test.describe('成就图鉴 · 隐藏成就与文案（AC-13 / AC-14）', () => {
  test('隐藏成就未解锁时，页面源码里搜不到真实标题', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await page.getByRole('button', { name: '全部收起' }).click()
    await page.getByRole('button', { name: '全部展开' }).click()

    // 三枚剪影卡都在，但真实文案一个都不在剪影卡里
    const silhouettes = page.locator('.ach-card.silhouette')
    await expect(silhouettes).toHaveCount(3)
    await expect(silhouettes.first()).toContainText('？？？')

    // 用每枚隐藏成就**独一无二**的描述来断言：标题里"越挫越勇"恰好也出现在
    // 成长型思维组的说明文字里（那是分组描述，不算泄底），所以只查描述 + 独有标题。
    const secrets = [
      '闻鸡起舞',
      '挑灯夜读',
      '某知识点曾答错 ≥3 次后转为「已掌握」',
      '在 07:00 前完成一次学习',
      '在 21:00 后完成一次学习',
    ]
    const silhouetteHtml = await silhouettes.evaluateAll((els) =>
      els.map((el) => el.outerHTML).join(''),
    )
    for (const secret of secrets) {
      expect(silhouetteHtml, `剪影卡泄露了「${secret}」`).not.toContain(secret)
    }
    // 整页也不该出现三枚的影子（描述是唯一指纹）
    const bodyHtml = await page.locator('body').evaluate((el) => el.innerHTML)
    expect(bodyHtml).not.toContain('某知识点曾答错')
    expect(bodyHtml).not.toContain('闻鸡起舞')
    expect(bodyHtml).not.toContain('挑灯夜读')
  })

  test('未获得卡有进度提示与量词（AC-13）', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await page.getByRole('button', { name: '全部收起' }).click()
    await page.getByRole('button', { name: '全部展开' }).click()

    // 可进度化 + 还没开始 → 「目标 N 个知识点」
    const tenKp = page.locator('.ach-card').filter({ hasText: '小试牛刀' })
    await expect(tenKp).toContainText('目标 10个知识点')

    // 事件型（target=1）→ 「完成一次即可解锁」，且不画进度条
    const seniorNew = page.locator('.ach-card').filter({ hasText: '另辟蹊径' })
    await expect(seniorNew).toContainText('完成一次即可解锁')
    await expect(seniorNew.locator('.ach-progress')).toHaveCount(0)

    // 未获得卡：小锁角标 + 灰化真实图标（两层信号，避免"以为已经有了"）
    // 27 枚可收集 − 2 枚剪影（comeback / early-bird）= 25；night-owl 连剪影都不出现
    await expect(page.locator('.ach-card .ach-lock')).toHaveCount(25)
    await expect(page.locator('.ach-card .ach-seal')).toHaveCount(0)
  })
})

test.describe('成就链路 · 合并提示（AC-07）', () => {
  test('一次解锁 5 枚：只弹 1 条合并提示，5 枚全部进「已获得」', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)

    await seedFiveUnlocks(page)
    await page.reload()

    const toast = page.locator('.ach-toast')
    await expect(toast).toBeVisible({ timeout: 15_000 })
    await expect(toast).toContainText('解锁 5 枚新成就')
    // 合并态下不会逐条播放：任意时刻只有一条
    await expect(toast).toHaveCount(1)

    // 等它播完，确认**没有第二条**跟上来
    await expect(toast).toHaveCount(0, { timeout: 20_000 })

    // 计数与「已获得」区一枚不少（合并只影响播放形式，不影响数据）
    await expect(page.locator('.ach-head-count')).toHaveText('5 / 27')
    await page.locator('.ach-part-head').first().click()
    await expect(earnedCards(page)).toHaveCount(5)
    for (const id of ['迈出第一步', '小试牛刀', '知错能改', '三日之约', '一周不断']) {
      await expect(page.locator('.ach-card.earned').filter({ hasText: id })).toHaveCount(1)
    }
  })
})

test.describe('成就链路 · 解锁', () => {
  test('满足条件 → 计入已获得 + 弹提示 + 刷新不重复弹', async ({ page }) => {
    await page.goto('/home')
    await resetAll(page)
    await expect(page.getByRole('heading', { name: '成就图鉴' })).toBeVisible()

    // 初始 0 / 27（分母是可收集枚数，不含不参与收集的彩蛋）
    await expect(page.locator('.ach-head-count')).toHaveText('0 / 27')

    // 种一条已掌握 → 刷新让真实结算链路跑一遍
    await seedMasteredOne(page)
    await page.reload()

    // 解锁提示（toast）出现，标题是「迈出第一步」
    const toast = page.locator('.ach-toast')
    await expect(toast).toBeVisible({ timeout: 15_000 })
    await expect(toast).toContainText('解锁新成就')
    await expect(toast).toContainText('迈出第一步')

    // 计入已获得
    await expect(page.locator('.ach-head-count')).toHaveText('1 / 27')

    // 等 toast 播完再点（它固定在顶部，会挡住区头）
    await expect(page.locator('.ach-toast')).toHaveCount(0, { timeout: 20_000 })

    // 展开已获得区能看到这一枚
    await page.locator('.ach-part-head').first().click()
    await expect(earnedCards(page)).toHaveCount(1)
    await expect(earnedCards(page).first()).toContainText('迈出第一步')

    // 持久化 + 不重复提示：再刷新一次，没有 toast，计数仍是 1
    await page.reload()
    await expect(page.locator('.ach-head-count')).toHaveText('1 / 27')
    await page.waitForTimeout(1500)
    await expect(page.locator('.ach-toast')).toHaveCount(0)
  })
})
