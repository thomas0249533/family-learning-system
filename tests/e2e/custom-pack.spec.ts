import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B3 · 自定义成就包（真机验证）
 * ------------------------------------------------------------------
 * 单测已经把校验器的 24 个错误码、`previewCustomPack` 的三类冲突、`importPack` 的闸门
 * 全部穷举过了（150 + 53 条）。这里只验**单测结构上验不了的三件事**：
 *
 *   1. **AC-P2-1 端到端**：导入 → 图鉴真的多出卡 → 勾选 → 解锁记录真的落库。
 *      这条只有走完整 UI 才成立：`manual-check` 的 `check` 是在**构建 def 时捕获**勾选态的，
 *      勾完必须重建 defs 并重跑 `settle()`。任何一环漏了，卡就只会显示进度、永远不亮。
 *   2. **跨包同 id 在真 UI 上是"点不下去"的**：`previewCustomPack` 算出 conflicts 后
 *      确认按钮置灰，家长根本发不出这次导入（store 里的 `E_ID_OTHER_PACK` 闸门是第二层，
 *      防的是"预览之后另一台包又装了一个"的竞态）。
 *   3. **AC-P2-3/4**：停用只关开关 —— `customChecks` 与 `achievements` 两个 settings 行
 *      必须**逐字节不变**。这是"停用后重新启用，孩子挣到的徽章原样回来"的唯一保证。
 *
 * 为什么断言 settings 原始值而不是 UI 数字：UI 只显示"28 张卡"，
 * 它无法区分"数据被保留了"和"数据被清空了但恰好也显示 28 张"。
 */

const DB_NAME = 'FamilyLearningDB'

/** 等库真的就绪（裸开 IDB 抢在 Dexie 之前会造空库，V1.3 已踩过） */
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

/** 只种档案行（自定义包相关的两张表由导入流程自己写） */
async function seedProfiles(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB 被阻塞'))
    })
    const now = new Date().toISOString()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['settings'], 'readwrite')
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
  }, DB_NAME)
  await page.reload()
}

/** 读一个 settings 键的原始值（判"一字不动"比看 UI 数字直接） */
async function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    async ({ dbName, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(['settings'], 'readonly')
        const req = tx.objectStore('settings').get(key)
        req.onsuccess = () => resolve((req.result as { value?: unknown } | undefined)?.value)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return value
    },
    { dbName: DB_NAME, key }
  )
}

/** 一份合法包：2 枚手工成就（`manual-check` 是 AC-P2-1 唯一能被家长"点亮"的规则类型） */
function manualPack(packId = 'home-chores', over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    packId,
    name: '我们家的家规',
    achievements: [
      {
        id: 'custom::tidy-desk',
        icon: '🧹',
        title: '自己整理书桌',
        desc: '这周自己把书桌收拾干净了',
        category: 'B',
        source: 'habit',
        rule: { kind: 'manual-check', prompt: '这周做到了吗' },
      },
      {
        id: 'custom::read-extra',
        icon: '📖',
        title: '读完一本课外书',
        desc: '读完一本课外书，并能说说它讲了什么',
        category: 'E',
        source: 'habit',
        rule: { kind: 'manual-check', prompt: '读完并复述了吗' },
      },
    ],
    ...over,
  }
}

/** 走一遍"选文件 → 等预览"（第一步只读不算写，任何情况都不会改库） */
async function pickPack(page: Page, pack: Record<string, unknown>, name = 'pack.json'): Promise<void> {
  await page.locator('.cp-import input[type="file"]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pack), 'utf8'),
  })
  // 三态之一：错误区 / 预览区（含冲突分支）。谁先出现都算"读完了"
  await expect(page.locator('.cp-errors, .cp-preview').first()).toBeVisible({ timeout: 10_000 })
}

test.describe('自定义成就包（V1.4 · B3）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedProfiles(page)
  })

  test('导入手工成就包 → 图鉴多 2 张 → 勾选后解锁记录落库（AC-P2-1/2）', async ({ page }) => {
    await page.goto('/achievements')
    await waitDbReady(page)
    // 基线：没有任何自定义包时就是内置 28 枚
    await expect(page.locator('.ach-card')).toHaveCount(28)

    await page.goto('/parent')
    await page.locator('.custom-pack-panel').waitFor({ state: 'visible', timeout: 20_000 })
    await expect(page.locator('.cp-row')).toHaveCount(0)

    await pickPack(page, manualPack())
    // 新包：口径是"将新增 2 枚"（`provided` = 净新增 2 + 保留 0）
    await expect(page.locator('.cp-preview')).toContainText('将新增 2 枚')
    await expect(page.locator('.cp-added')).toHaveCount(2)

    await page.locator('.cp-confirm').click()
    // 导入即启用（PRD §8.3 裁决 9）
    await expect(page.locator('.cp-row')).toHaveCount(1)
    await expect(page.locator('.cp-row')).toContainText('已启用')
    await expect(page.locator('.cp-check-item')).toHaveCount(2)

    // 卡真的进了图鉴：28 + 2
    await page.goto('/achievements')
    await waitDbReady(page)
    await expect(page.locator('.ach-card')).toHaveCount(30)

    // 勾选 → settle 重建 defs → 解锁记录落库
    await page.goto('/parent')
    await page.locator('.cp-check-toggle').first().check()
    await expect(page.locator('.cp-check-hint').first()).toBeVisible()

    await expect
      .poll(async () => {
        const records = (await readSetting(page, 'achievements:default')) as
          | Array<{ id: string }>
          | undefined
        return (records ?? []).map((r) => r.id)
      }, { timeout: 10_000 })
      .toContain('custom::tidy-desk')

    // 勾选态本身也是 per-profile 的独立键（不是塞进解锁记录里）
    const checks = (await readSetting(page, 'customChecks:default')) as Record<string, { at: string }>
    expect(Object.keys(checks)).toContain('home-chores::custom::tidy-desk')
  })

  test('跨包同 id → 预览就置灰确认，库内零变化', async ({ page }) => {
    await page.goto('/parent')
    await page.locator('.custom-pack-panel').waitFor({ state: 'visible', timeout: 20_000 })

    // 先正常装一个包，占住这两个 id
    await pickPack(page, manualPack())
    await page.locator('.cp-confirm').click()
    await expect(page.locator('.cp-row')).toHaveCount(1)
    const before = await readSetting(page, 'achievement:customPacks')

    // 换一个 packId 但复用同一个 achievement id —— 这正是"两套包悄悄并成一张卡"的场景
    await pickPack(
      page,
      manualPack('other-pack', {
        achievements: [
          {
            id: 'custom::tidy-desk',
            icon: '🧹',
            title: '（另一个包里的同名 id）',
            desc: '应当被拒绝',
            category: 'B',
            source: 'habit',
            rule: { kind: 'manual-check', prompt: '做到了吗' },
          },
        ],
      }),
      'conflict.json'
    )

    // 真 UI 上家长根本点不下去（闸门第一层）
    await expect(page.locator('.cp-conflicts')).toBeVisible()
    await expect(page.locator('.cp-conflicts')).toContainText('home-chores')
    await expect(page.locator('.cp-confirm')).toBeDisabled()

    // 库内一个字节都没动（拒绝的导入不留痕迹）
    expect(await readSetting(page, 'achievement:customPacks')).toEqual(before)
    await expect(page.locator('.cp-row')).toHaveCount(1)
  })

  test('停用包 → 图鉴回到 28 张，customChecks 与 achievements 一字不动（AC-P2-3/4）', async ({ page }) => {
    await page.goto('/parent')
    await page.locator('.custom-pack-panel').waitFor({ state: 'visible', timeout: 20_000 })

    await pickPack(page, manualPack())
    await page.locator('.cp-confirm').click()
    await expect(page.locator('.cp-row')).toHaveCount(1)

    // 先勾一枚，让两个键都有内容 —— 否则"不变"是空对空，验不出东西
    await page.locator('.cp-check-toggle').first().check()
    await expect(page.locator('.cp-check-hint').first()).toBeVisible()

    const checksBefore = await readSetting(page, 'customChecks:default')
    const recordsBefore = await readSetting(page, 'achievements:default')
    expect(checksBefore).not.toBeUndefined()

    await page.locator('.cp-row-actions button', { hasText: '停用' }).click()
    await expect(page.locator('.cp-row')).toContainText('已停用')

    // 停用只关开关：两个键逐字节不变
    expect(await readSetting(page, 'customChecks:default')).toEqual(checksBefore)
    expect(await readSetting(page, 'achievements:default')).toEqual(recordsBefore)

    // 图鉴里这 2 张卡消失（停用的包既不显示也不参与结算）
    await page.goto('/achievements')
    await waitDbReady(page)
    await expect(page.locator('.ach-card')).toHaveCount(28)
  })
})
