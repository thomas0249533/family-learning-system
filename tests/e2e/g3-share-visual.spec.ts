import { test, expect, type Page } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * G3 · 二维码分享视觉基线（V1.12 Stage G）
 * =====================================================================
 * 断言链：/learn 列表 → 点卡片「📤 分享」→ 弹窗里二维码 Canvas 渲染不崩溃
 * （有非零尺寸、画了足够多的暗块）→ 截图 share-qrcode-{light,dark}.png。
 *
 * 契约与 visual.spec.ts 一致：
 *   - 输出 `docs/screenshots/{key}-{light|dark}.png`，`page.screenshot()`，
 *     **不用** `toHaveScreenshot()`；
 *   - `addInitScript` 预置 `localStorage['fls:theme']`（首帧即目标主题）+ 冻结时钟；
 *   - 截图前 `freezeSmil()`。
 *
 * 确定性：
 *   1. QR 矩阵由 vendor QrCode 决定，同输入必然同矩阵（单测已钉）；
 *   2. 播种数据全字面量，无随机数、无网络、无 `new Date()`；
 *   3. 弹窗二维码画的是固定的 `FamilyLearning://import?...` 串。
 *
 * 播种链路照抄 learn-status-visual.spec.ts 的已验证做法（先等库就绪再裸开 IDB、
 * 一个 transaction 写完三张表）。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

const G3_PKG = 'g3-share-visual'

/** 单包播种载荷（字面量，可结构化克隆） */
function buildSeed(): { packages: Array<Record<string, unknown>>; progress: Array<Record<string, unknown>> } {
  return {
    packages: [
      {
        packageId: G3_PKG,
        manifest: {
          schemaVersion: '1.0',
          packageId: G3_PKG,
          type: 'unit',
          subject: 'math',
          grade: 4,
          term: 'up',
          edition: '人教版',
          title: 'G3 视觉 · 分享包',
          examMode: false,
        },
        knowledgePoints: [
          { id: `${G3_PKG}::k1`, title: '小数的意义' },
          { id: `${G3_PKG}::k2`, title: '小数的性质' },
        ],
        exercises: [],
        units: [
          {
            id: 'u1',
            title: '单元一',
            topics: [
              {
                id: 'u1t1',
                title: '小数',
                knowledgePointIds: [`${G3_PKG}::k1`, `${G3_PKG}::k2`],
                exercises: [],
              },
            ],
          },
        ],
      },
    ],
    progress: [],
  }
}

async function installDeterminismHooks(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    (cfg: { mode: string; fixedNow: number }) => {
      const { mode: m, fixedNow } = cfg

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

      localStorage.setItem(
        'fls:theme',
        JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false })
      )
    },
    { mode, fixedNow: FIXED_NOW }
  )
}

/** `.ach-head-count` 可见 = Dexie 已建好 schema（照抄 learn-status-visual.spec.ts） */
async function waitDbReady(page: Page): Promise<void> {
  // 首页是 AchievementHall（.hall-head-count），/achievements 页是 AchievementSection
  // （.ach-head-count）—— 二者其一可见即代表 app 挂载 + Dexie schema 就绪。
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

async function seedAll(page: Page, seed: ReturnType<typeof buildSeed>): Promise<void> {
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

/** 等「成就 toast」彻底安静（与 learn-status-visual.spec.ts 同一做法） */
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

for (const mode of ['light', 'dark'] as const) {
  test(`share-qrcode-${mode}`, async ({ page }) => {
    await installDeterminismHooks(page, mode)

    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedAll(page, buildSeed())
    await page.goto('/learn')
    await page.waitForLoadState('networkidle')

    // 包卡就绪（播种生效的信号）
    await expect(page.locator('.pkg-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.pkg-card')).toHaveCount(1)

    await page.waitForTimeout(1200)
    await waitToastsSettled(page)

    // 点分享按钮 → 弹窗出现
    await page.locator('.pkg-card .pkg-share-btn').first().click()
    await expect(page.locator('.share-canvas')).toBeVisible({ timeout: 10_000 })

    // Canvas 渲染不崩溃：有非零尺寸 + 画了足够多的暗块（finder + 数据模块）
    const canvasInfo = await page.evaluate(() => {
      const el = document.querySelector('.share-canvas') as HTMLCanvasElement | null
      if (!el) return null
      const ctx = el.getContext('2d')
      if (!ctx) return null
      const { width, height } = el
      const img = ctx.getImageData(0, 0, width, height).data
      let dark = 0
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] < 128 && img[i + 3] > 0) dark++
      }
      return { width, height, dark }
    })
    expect(canvasInfo).not.toBeNull()
    expect(canvasInfo!.width).toBeGreaterThan(0)
    expect(canvasInfo!.height).toBeGreaterThan(0)
    // 白底黑块：暗像素必须实质存在（渲染真的画了东西）
    expect(canvasInfo!.dark).toBeGreaterThan(200)

    // 分享码文本也在弹窗里（手输兜底的可见证据）
    await expect(page.locator('.share-code-text')).toContainText('FamilyLearning://import?')

    await freezeSmil(page)
    await page.screenshot({
      path: `docs/screenshots/share-qrcode-${mode}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
}
