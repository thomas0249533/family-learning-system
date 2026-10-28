import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 学习包图片资产 · 端到端（V2.12）
 * ------------------------------------------------------------------
 * 单测（`tests/package-assets.test.ts`）已经把路径规则、限额、`planPackageAssets`、
 * `normalizePackage` 的三道关卡全穷举过了。但有三件事**结构上验不了**，只能真机跑：
 *
 *   1. **ZIP 里的图真的落进了 IndexedDB**：
 *      `unzipSync` 的字节 → `new Blob` → Dexie `packageAssets` 表。
 *      中间任何一环（事务表没声明、路径没剥 `packages/<pkgId>/` 前缀）都会静默丢图，
 *      而题目照常导入 —— 表现就是"题在、图没了"。
 *   2. **答题页真的渲染出图**：`<img src="blob:...">`。
 *      这里要的是 `naturalWidth > 0`，而不是"元素存在"：Blob 类型错、SVG 被清洗坏，
 *      元素一样在，只是空白。
 *   3. **url 是 blob: 而不是 data:**：确认走的是资产表而不是把图内联进包 JSON。
 *
 * 为什么直接读库而不是只看 UI：UI 上"有图"和"图能解码"是两件事，
 * 而 `img.complete && naturalWidth === 0` 表示解码失败 —— 这条只有浏览器里能拿到。
 */

const DB_NAME = 'FamilyLearningDB'
const ZIP = 'content/math-4-up-rjb/math-4-up-rjb-set.lpkgset.zip'
const PKG_ID = 'special-math-4-up-shape'

/** 等库就绪（裸开 IDB 抢在 Dexie 之前会造空库） */
async function waitDbReady(page: Page): Promise<void> {
  await page.locator('.hall-head-count').first().waitFor({ state: 'visible', timeout: 20_000 })
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

/** 读该包已入库的图片资产（只取元信息 + blob 大小/类型，不取内容） */
async function readAssets(page: Page): Promise<{ path: string; size: number; type: string }[]> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB 被阻塞'))
    })
    const rows = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(['packageAssets'], 'readonly')
      const req = tx.objectStore('packageAssets').getAll()
      req.onsuccess = () => resolve(req.result as any[])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rows.map((r) => ({
      packageId: r.packageId as string,
      path: r.path as string,
      size: (r.blob as Blob)?.size ?? 0,
      type: (r.blob as Blob)?.type ?? '',
    }))
  }, DB_NAME).then((rows) => rows as any)
}

test.describe('学习包图片资产（V2.12）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedProfiles(page)
  })

  test('导入含图 zip → 13 张图进 packageAssets → 答题页渲染出真图', async ({ page }) => {
    // ---------- 1. 走真实导入 UI ----------
    await page.goto('/settings/import')
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
      name: 'math-4-up-rjb-set.lpkgset.zip',
      mimeType: 'application/zip',
      buffer: readFileSync(resolve(process.cwd(), ZIP)),
    })
    // 导入完成会弹结果框
    await expect(page.locator('.n-modal, .n-dialog').first()).toBeVisible({ timeout: 30_000 })

    // ---------- 2. 图真的落库了 ----------
    await expect
      .poll(async () => {
        const rows = await readAssets(page)
        return rows.filter((r) => r.path.endsWith('.svg')).length
      }, { timeout: 15_000 })
      .toBe(13)

    const assets = (await readAssets(page)).filter((r) => r.path.endsWith('.svg'))
    // 路径必须是剥掉 `packages/<pkgId>/` 前缀后的包内路径，否则渲染时按 exercise.image 查不到
    expect(assets.map((a) => a.path).sort()).toEqual(
      Array.from({ length: 13 }, (_, i) => `assets/q${String(i + 1).padStart(2, '0')}.svg`).sort(),
    )
    for (const a of assets) {
      expect(a.type, a.path).toBe('image/svg+xml')
      expect(a.size, a.path).toBeGreaterThan(100)
    }

    // ---------- 3. 进答题页看渲染 ----------
    await page.goto(`/learn/${PKG_ID}/unit/u1/topic/u1-t1`)
    const img = page.locator('.qimage__img').first()
    await expect(img).toBeVisible({ timeout: 20_000 })

    // blol: 而不是 data: —— 证明走的是资产表，不是把图内联进包
    const src = await img.getAttribute('src')
    expect(src, `img src 应为 blob URL，实际 ${src}`).toMatch(/^blob:/)

    // 真解码成功（元素存在但 naturalWidth=0 就是白板）
    const dims = await img.evaluate((el) => {
      const i = el as HTMLImageElement
      return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight }
    })
    expect(dims.complete).toBe(true)
    expect(dims.w, '图片没解码出来（白板）').toBeGreaterThan(0)
    expect(dims.h).toBeGreaterThan(0)

    // 配图缺失占位不该出现（出现了说明 blob 取不到）
    await expect(page.locator('.qimage__placeholder-text')).toHaveCount(0)
  })
})
