import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * UI 基元 · **真实交互** e2e（V1.6 · Stage B / B2）
 * ---------------------------------------------------------------------------
 * 与 `primitives.spec.ts` 的分工：那份是**截图矩阵**（只出图、不断言），
 * 这份只断言行为 —— 每个用例都必须能观察到"看得见后果"，
 * 元素存在 / 属性存在 这类永真断言一律不写。
 *
 * 覆盖：
 *   1. AppButton `disabled`：原生 DOM 属性 + 点击不触发 `emit('click')`
 *   2. AppBadge `closable`：关闭按钮点击后 badge **从 DOM 移除**，且只移除那一个
 *   3. ProgressBar：`role="progressbar"` / `aria-valuenow` 随 value 变 / 0 与超 max 边界
 *   4. 基元 `:focus-visible`：未聚焦 → 键盘 Tab 聚焦出焦点环（2px solid + 非透明色）→ 失焦即消失
 *      （**不用"鼠标点击不出环"作对照**：Chromium + Windows 上 `matches(':focus-visible')`
 *       在鼠标点击后仍可能为真，输入模态判定不可靠，拿它当断言会在换内核时变成假红）
 *   5. A6 遗留 · 导入防连点：确定性失败后 2 秒冷却窗口内连点只执行一次
 *
 * 目标页：`/design-system`（仅 DEV 注册，见 `src/core/router/index.ts`）。
 * 块定位沿用 `primitives.spec.ts` 的 `.ds-block[data-ds="..."]`；
 * 交互演示单独占一块 `data-ds="interaction-demo"`，**不往 8 个基元块里加节点**
 * —— 那会让 `docs/screenshots/ds/*.png` 的 22 张基线全部漂移。
 */

const DB_NAME = 'FamilyLearningDB'

/** 交互演示块（`src/views/DesignSystem.vue` 最后一块，DEV-only） */
function demo(page: Page) {
  return page.locator('.ds-block[data-ds="interaction-demo"]')
}

// ===========================================================================
// 一、8 个基元里的 3 个：真实交互
// ===========================================================================
test.describe('UI 基元 · 交互', () => {
  test.beforeEach(async ({ page }) => {
    // 固定主题，避免浅/深配色差异影响计算样式的断言（不冻时钟：这些基元不读时间）
    await page.addInitScript(() => {
      localStorage.setItem(
        'fls:theme',
        JSON.stringify({ preset: 'junior', mode: 'light', fontSize: 'medium', presetManual: false })
      )
    })
    await page.goto('/design-system')
    await page.waitForLoadState('networkidle')
    await expect(demo(page)).toBeVisible()
  })

  test('AppButton disabled：原生属性存在，且点击不触发 click 事件', async ({ page }) => {
    const counter = demo(page).locator('[data-t="click-count"]')
    const enabled = demo(page).locator('[data-t="btn-count"]')
    const disabled = demo(page).locator('[data-t="btn-count-disabled"]')

    // ---- 对照组：先证明"计数器是活的" ----
    // 没有这一步，下面"点了还是 0"就可能是因为计数器根本没接上（空转断言）。
    await expect(counter).toHaveText('0')
    await enabled.click()
    await expect(counter).toHaveText('1')

    // ---- ① 原生 DOM 属性（不是只看 .n-button--disabled 之类的 class）----
    await expect(disabled).toBeDisabled()
    // 同一个断言的反面：启用态**没有** disabled 属性，证明上面不是"两者都带"
    await expect(enabled).not.toBeDisabled()

    // ---- ② 点击不触发 emit('click') ----
    // 用 `force: true` 发**真实鼠标点击**（落在元素坐标上）：
    // · `locator.click()` 默认会等元素 enabled，对 disabled 按钮必然超时；
    // · 而 `dispatchEvent('click')` 是脚本派发，会绕过浏览器"禁用控件不派发点击"的
    //   原生行为 —— 那样测的就不是用户能做的事了。
    // 真实鼠标点在 disabled 按钮上：浏览器不派发 click → Vue 监听器不跑 → 读数不变。
    await disabled.click({ force: true })
    await expect(counter).toHaveText('1')

    // 再点一次启用态，读数继续增长：证明"不变"是因为禁用，而不是页面卡死
    await enabled.click()
    await expect(counter).toHaveText('2')
  })

  test('AppBadge closable：点击关闭按钮后该 badge 从 DOM 移除', async ({ page }) => {
    const badges = demo(page).locator('[data-t="badge"]')
    const count = demo(page).locator('[data-t="badge-count"]')

    await expect(badges).toHaveCount(2)
    await expect(count).toHaveText('2')

    // 只点 A 的关闭按钮
    const badgeA = badges.filter({ hasText: '可关闭 A' })
    await expect(badgeA).toHaveCount(1)
    await badgeA.locator('button.app-badge__close[aria-label="移除"]').click()

    // ---- ① 真的从 DOM 消失（不是 visibility:hidden / opacity:0）----
    await expect(badgeA).toHaveCount(0)
    await expect(badges).toHaveCount(1)
    await expect(count).toHaveText('1')

    // ---- ② close 事件被消费，且只消费了那一个 ----
    await expect(badges.filter({ hasText: '可关闭 B' })).toHaveCount(1)

    // 关到空：再点一次，出现"已清空"占位（证明列表状态真的在变，不是 CSS 藏起来）
    await badges.filter({ hasText: '可关闭 B' }).locator('.app-badge__close').click()
    await expect(badges).toHaveCount(0)
    await expect(demo(page).locator('[data-t="badge-empty"]')).toBeVisible()
  })

  test('AppBadge：只有 closable 才渲染关闭按钮', async ({ page }) => {
    // 契约面：`closable` 为假时不该出现关闭按钮（否则键盘会多一个空 tab 停点）
    const block = page.locator('.ds-block[data-ds="app-badge"]')
    const plain = block.locator('.app-badge').first() // 「中性」，非 closable
    const closable = block.locator('.app-badge--closable')

    await expect(plain).toBeVisible()
    await expect(plain.locator('.app-badge__close')).toHaveCount(0)
    await expect(closable).toHaveCount(1)
    await expect(closable.locator('.app-badge__close')).toHaveCount(1)
  })

  test('ProgressBar：aria-valuenow 与 value 对应，0 与超 max 边界被裁剪', async ({ page }) => {
    const bar = (key: string) => demo(page).locator(`[data-t="${key}"]`)

    // ---- ① role / 量纲 ----
    await expect(bar('pb-0')).toHaveAttribute('role', 'progressbar')
    await expect(bar('pb-0')).toHaveAttribute('aria-valuemin', '0')
    await expect(bar('pb-0')).toHaveAttribute('aria-valuemax', '100')

    // ---- ② 两个不同 value 各自对上（不是写死一个值蒙对）----
    await expect(bar('pb-45')).toHaveAttribute('aria-valuenow', '45')
    await expect(bar('pb-72')).toHaveAttribute('aria-valuenow', '72')
    await expect(bar('pb-45')).toHaveAttribute('aria-valuetext', '45%')
    await expect(bar('pb-72')).toHaveAttribute('aria-valuetext', '72%')

    // ---- ③ 视觉也真的跟着 value 走（只改 aria 不改宽度同样是缺陷）----
    expect(await fillWidth(bar('pb-45'))).toBe('45%')
    expect(await fillWidth(bar('pb-72'))).toBe('72%')
    // 给家长看的百分比标签与 value 一致（`show-label` 的可见后果）
    await expect(page.locator('.progress-wrap:has([data-t="pb-72"]) .progress-wrap__label')).toHaveText(
      '72%'
    )

    // ---- ④ 边界：0 ----
    await expect(bar('pb-0')).toHaveAttribute('aria-valuenow', '0')
    await expect(bar('pb-0')).toHaveAttribute('aria-valuetext', '0%')
    expect(await fillWidth(bar('pb-0'))).toBe('0%')

    // ---- ⑤ 边界：150 > max(100) 被 clamp 到 100（读屏与视觉同时收敛）----
    await expect(bar('pb-150')).toHaveAttribute('aria-valuenow', '100')
    await expect(bar('pb-150')).toHaveAttribute('aria-valuetext', '100%')
    expect(await fillWidth(bar('pb-150'))).toBe('100%')
  })

  test('键盘 Tab 聚焦基元后 :focus-visible 出现焦点环（失焦即消失）', async ({ page }) => {
    const target = demo(page).locator('[data-t="btn-count"]')

    // ---- 对照组 A：还没聚焦过 → 同一类元素上没有焦点环（证明不是无条件 outline）----
    const idle = await ringOf(demo(page).locator('[data-t="btn-count-disabled"]'))
    expect(idle.focusVisible).toBe(false)
    expect(idle.style).toBe('none')

    // ---- 只用键盘：循环 Tab 直到落在这个按钮上（不用 .focus()，那不会命中 :focus-visible）----
    let reached = false
    for (let i = 0; i < 300 && !reached; i++) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset['t'] === 'btn-count'
      )
    }
    expect(reached, '键盘 Tab 300 次仍未走到交互演示区的计数按钮').toBe(true)
    await expect(target).toBeFocused()

    // ---- 键盘聚焦：焦点环来自 `:focus-visible` ----
    const keyboard = await ringOf(target)
    expect(keyboard.focusVisible).toBe(true)
    expect(keyboard.style).toBe('solid')
    expect(keyboard.width).toBe('2px')
    expect(keyboard.color).not.toBe('rgba(0, 0, 0, 0)')

    // ---- 对照组 B：把焦点移开（点页面空白）→ 同一个元素立刻没有焦点环 ----
    // 这条钉住"焦点环是聚焦的结果"，而不是"这个元素上永远有一条 2px 线"。
    await page.locator('.ds-page').click({ position: { x: 4, y: 4 } })
    expect(await target.evaluate((el) => document.activeElement === el)).toBe(false)
    const blurred = await ringOf(target)
    expect(blurred.focusVisible).toBe(false)
    expect(blurred.style).toBe('none')
  })
})

/** 读填充条的 inline width（value → 视觉的唯一真身） */
async function fillWidth(bar: Locator): Promise<string> {
  return bar.locator('.progress__fill').evaluate((el) => (el as HTMLElement).style.width)
}

/** 读一个元素的计算焦点环三要素 + 是否命中 :focus-visible */
async function ringOf(locator: Locator): Promise<{
  focusVisible: boolean
  style: string
  width: string
  color: string
}> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      focusVisible: el.matches(':focus-visible'),
      style: s.outlineStyle,
      width: s.outlineWidth,
      color: s.outlineColor,
    }
  })
}

// ===========================================================================
// 二、A6 遗留：导入快速失败后的 2 秒冷却窗口
// ===========================================================================
//
// `ImportPreview.confirmImport` 的第一行是 `if (Date.now() < importCooldownUntil) return`。
// `isImporting` 只能挡 in-flight；写库失败只要几毫秒，`finally` 放开按钮后手指还没离开
// 就是第二次真实事务。要稳定复现这个窗口，**必须让导入确定性地失败**。
//
// 失败注入（确定性，无随机、无长 sleep）：
//   1. 备份里带一条本机**没有**的进度行 → 预览结论 ready，`stalenessGuard` 基线为 `null`；
//   2. 预览生成后、点确认前，直接往同一个 IndexedDB 的 `progress` 表 add 一条同 key 的行
//      → apply 事务里的 L2 守卫读到"基线 null vs 现存一行"→ 抛 `stale-local-data`。
//   3. 第二次点击依然命中同一条守卫（注入的行还在）→ 只要两次都跑，就会出现两条失败。
//
// ⚠️ 复用**已存在**的库：先让页面正常加载（Dexie 建库并迁移到 v4）再 `indexedDB.open(name)`。
// 绝不可以用无版本号的 open 去"探库"—— 那会抢先建一个空库（本项目 V1.3 踩过）。

const COOLDOWN_MS = 2000

/** 等库真的就绪（`/home` 的成就头计数要等数据加载完才出现） */
async function waitDbReady(page: Page): Promise<void> {
  // ⚠️ 选择器是 `.hall-head-count` 而不是 `.ach-head-count`：
  // 从 V2.7 起首页的勋章墙换成了 `AchievementHall`（陈列室），旧的
  // `AchievementSection`（图鉴）只留在 `/achievements` 独立页。类名也跟着
  // 从 ach-head-count 变成 hall-head-count —— 这里原先沿用的是失效的旧类名，
  // 导致等待必然超时（与业务无关的假失败）。同类迁移在 achievement-repeat /
  // achievement-story 里已经做过，本文件与 achievement.spec.ts 是漏改的。
  await page.locator('.hall-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
}

/** 删除整库并重载（每个用例从一致的空白库开始） */
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

/** 种子：装一个学习包 + 决定本机有没有进度行（`rows: []` = 完全没有） */
async function seedPackage(page: Page, packageId: string, kpIds: string[]): Promise<void> {
  await page.evaluate(
    async ({ dbName, packageId, kpIds }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        // 这里可以无版本号 open：页面已加载，库已由 Dexie 建好（见文件内注释）
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      const now = new Date().toISOString()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['packages', 'settings'], 'readwrite')
        tx.objectStore('packages').put({
          packageId,
          manifest: {
            packageId,
            type: 'unit',
            subject: 'math',
            grade: 4,
            term: 'up',
            title: `冷却窗口测试单元 ${packageId}`,
          },
          knowledgePoints: kpIds.map((id) => ({ id, title: `知识点 ${id}` })),
          exercises: [],
          units: [],
        })
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: now }] },
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, packageId, kpIds }
  )
  await page.reload()
}

/**
 * 往 `progress` 里直接 add 一行（"预览之后本机又产生了新记录"）。返回写入后的行数。
 */
async function injectProgressRow(
  page: Page,
  row: {
    profileId: string
    packageId: string
    knowledgePointId: string
    status: '未学' | '学习中' | '已掌握' | '需复习'
    lastStudiedAt: string
  }
): Promise<number> {
  return page.evaluate(
    async ({ dbName, row }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(['progress'], 'readwrite')
        const store = tx.objectStore('progress')
        store.add({
          ...row,
          correctCount: 9,
          wrongCount: 0,
          correctStreak: 9,
          wrongStreak: 0,
          studySeconds: 120,
        })
        const req = store.count()
        let rows = 0
        req.onsuccess = () => {
          rows = req.result
        }
        tx.oncomplete = () => {
          db.close()
          resolve(rows)
        }
        tx.onerror = () => reject(tx.error)
      })
      return count
    },
    { dbName: DB_NAME, row }
  )
}

/**
 * 在页面里数「readwrite 事务开了几次」= 导入真正执行了几次。
 *
 * 为什么要这个计数器而不是只数 toast：toast 3 秒自动消失，而冷却窗口正好在这段时间里，
 * 两者时间重叠 —— 靠 toast 数量判断"第二次有没有执行"会被时序干扰（而且"仍然是 1 条"
 * 这种断言在点击后立刻读必然通过，属于假断言）。事务计数是**同步**的：
 * `db.transaction(...)` 在点击处理函数的第一段同步代码里就被调用，
 * 所以 `await handle.dispatchEvent('click')` 一返回就能读，不需要 sleep、不需要轮询。
 *
 * ⚠️ 必须用 `addInitScript`（在页面脚本之前）打补丁：Dexie 4 在**建库时**就把
 * `db.transaction.bind(db)` 存进了 dbcore（`createDBCore` 里那行），之后在页面上改
 * `IDBDatabase.prototype.transaction` 对已打开的库**完全无效**（第一版就是这么静默数到 0 的）。
 * 每个导航都是新 document，所以计数天然从 0 开始。
 */
async function armTxCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & { __rwPatched?: boolean }
    if (proto.__rwPatched) return
    const orig = proto.transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proto as any).transaction = function (this: IDBDatabase, ...args: any[]) {
      if (args[1] === 'readwrite') {
        const w = window as unknown as { __rwTx?: number }
        w.__rwTx = (w.__rwTx ?? 0) + 1
      }
      return orig.apply(this, args as unknown as [string | string[], IDBTransactionMode])
    }
    proto.__rwPatched = true
    ;(window as unknown as { __rwTx?: number }).__rwTx = 0
  })
}

async function rwTxCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __rwTx?: number }).__rwTx ?? 0)
}

/** 上传一份 JSON 到导入卡片的第一屏 */
async function pickBackup(page: Page, name: string, json: unknown): Promise<void> {
  await page
    .locator('.import-pick input[type="file"]')
    .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) })
}

test.describe('A6 · 导入防连点（2 秒冷却）', () => {
  test('导入确定性失败后，冷却窗口内连点只执行一次', async ({ page }) => {
    const PKG = 'unit-cooldown'
    const KP = 'unit-cooldown::kp1'
    const STALE_ROW = {
      profileId: 'default',
      packageId: PKG,
      knowledgePointId: KP,
      status: '学习中' as const,
      lastStudiedAt: '2026-03-01T00:00:00.000Z',
    }

    // 计数器必须在页面脚本之前注入（见 `armTxCounter` 的注释）
    await armTxCounter(page)

    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedPackage(page, PKG, [KP])
    // v1 扁平备份：本机**没有**这条进度 → 预览 = 「新增进度 1 条」= ready
    const backup = {
      version: '1.0',
      exportedAt: '2026-02-01T00:00:00.000Z',
      progress: [
        {
          profileId: 'default',
          packageId: PKG,
          knowledgePointId: KP,
          status: '已掌握',
          correctCount: 3,
          wrongCount: 0,
          correctStreak: 3,
          wrongStreak: 0,
          lastStudiedAt: '2026-02-01T00:00:00.000Z',
          studySeconds: 60,
        },
      ],
      mistakes: [],
      settings: [],
    }

    await page.goto('/settings')
    await pickBackup(page, 'fls-cooldown.json', backup)
    await expect(page.locator('.import-ready')).toBeVisible({ timeout: 15_000 })
    // 预览态：警告条 + 确认按钮同时在场（A6-L1 的可见面）
    await expect(page.locator('.import-warning')).toContainText('导入期间请不要在学习页答题')
    await expect(page.locator('.import-confirm')).toHaveCount(1)

    // ---- 失败注入：预览已定格，本机这时"又学了一次" ----
    // plan 里的基线是 null（快照时没有这行），注入后 apply 会读到一行 → stale-local-data
    expect(await injectProgressRow(page, STALE_ROW)).toBe(1)

    // 先拿 handle：失败后按钮**不会**离场（`applied` 仍为 null，只是文案变「重试导入」），
    // 但用 handle 派发仍然更稳 —— 不依赖任何一次重新解析选择器。
    const confirm = await page.locator('.import-confirm').elementHandle()
    expect(confirm, '第 2 步应出现「确认导入」按钮').not.toBeNull()

    // 以点击前的计数为基线：页面上任何后台写入都不会让下面的差值失真
    const baseTx = await rwTxCount(page)

    // ---- 第 1 次点击：确定性失败 ----
    await confirm!.dispatchEvent('click')
    await expect(page.locator('.import-error')).toBeVisible({ timeout: 5_000 })
    // 断言"技术细节"而不是家长文案：这句是 core 的守卫原文（`applyMergePlan` 抛的
    // Error.message），能证明失败原因确实是 `stale-local-data`，而家长向的人话文案
    // 正在被 B4（错误码翻译）改写，钉在 UI 文案上会让两个任务互相绊。
    await expect(page.locator('.import-error-text')).toContainText('检测到新的学习记录')
    await expect(page.locator('.n-message--error-type')).toHaveCount(1)
    // 必须真的"失败"：没有成功 toast，按钮还在且变成重试
    await expect(page.locator('.n-message--success-type')).toHaveCount(0)
    await expect(page.locator('.import-confirm')).toContainText('重试导入')
    expect(await rwTxCount(page), '第 1 次点击应真的执行了一次导入事务').toBe(baseTx + 1)

    // ---- 第 2 次点击：同一 handle，冷却窗口内（t0 + 数百毫秒）----
    // `dispatchEvent` 返回时处理函数已经同步跑完（冷却判断在第一个 await 之前），
    // 所以紧接着读事务计数是确定性的，不需要 sleep / 不需要轮询。
    await confirm!.dispatchEvent('click')
    expect(await rwTxCount(page), '冷却窗口内的第二次点击不应再开事务').toBe(baseTx + 1)
    await expect(page.locator('.n-message--error-type')).toHaveCount(1)
    // 页面上仍然是"一次失败"的样子：一条错误块、按钮仍是重试
    await expect(page.locator('.import-error')).toHaveCount(1)

    // ---- 冷却过期后可以重试（证明上面被挡的是"时间窗"，不是按钮坏了）----
    // 这是唯一一处需要真等的地方：等的就是 2 秒窗口本身。
    await page.waitForTimeout(COOLDOWN_MS + 150)
    const beforeThird = await rwTxCount(page)
    await confirm!.dispatchEvent('click')
    await expect
      .poll(() => rwTxCount(page), {
        timeout: 5_000,
        message: '冷却结束后重试应重新执行一次导入',
      })
      .toBe(beforeThird + 1)

    // 失败是"一行都没写进去"：progress 里仍只有注入的那 1 行（事务回滚，无半截写入）
    expect(await countProgressRows(page)).toBe(1)
  })
})

/** 读 progress 表行数（用于断言失败后"一行都没写进去"） */
async function countProgressRows(page: Page): Promise<number> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB 被阻塞'))
    })
    const n = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(['progress'], 'readonly')
      const req = tx.objectStore('progress').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return n
  }, DB_NAME)
}
