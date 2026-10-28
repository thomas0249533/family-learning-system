import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 剑桥 Movers 阅读写作包 · 端到端冒烟
 * ------------------------------------------------------------------
 * 单测（`tests/movers-pack.test.ts`）已经把题量、答案、配图路径、module 声明全查过了。
 * 但有三件事只有真机跑得出来：
 *
 *   1. **ZIP 能被真实导入**：三层嵌套（外层 zip → 内层 zip → PDF）里抠出来的包，
 *      结构一旦和导入器预期不一致，`normalizePackage` 会在 E006/E008 上炸掉；
 *   2. **阅读正文真的渲染在题目上方**：`english.reading` module 挂的 kp 若 id 写错，
 *      卡片会变成"暂无阅读内容"，而孩子面对 7 道填空无从下手；
 *   3. **配图真的出图**：模拟卷 Part 6 的海盗图是裁剪渲染出来的 PNG，
 *      blob 解码失败时元素仍在、只是白板（naturalWidth = 0）。
 */

const DB_NAME = 'FamilyLearningDB'
const ZIP = 'content/english-movers-cep/english-movers-cep-set.lpkgset.zip'
const UNIT = 'special-english-movers-unit'
const MOCK = 'special-english-movers-mock'

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

test.describe('剑桥 Movers 阅读写作包', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedProfiles(page)
  })

  test('导入集合 zip → 阅读正文与题目都在 → 看图题真的出图', async ({ page }) => {
    await page.goto('/settings/import')
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
      name: 'english-movers-cep-set.lpkgset.zip',
      mimeType: 'application/zip',
      buffer: readFileSync(resolve(process.cwd(), ZIP)),
    })

    // 批量导入结果弹窗：三个包全成，且两张配图入库
    const modal = page.locator('.n-modal, .n-dialog').first()
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText('3')
    await expect(page.locator('.result-assets')).toContainText('2')

    // ---------- 阅读正文 + 题目 ----------
    await page.goto(`/learn/${UNIT}/unit/mv-u3/topic/mv-u3-t1`)
    // 正文挂在 english.reading 里（换行用 pre-wrap 保留）
    await expect(page.locator('.reading-body').first()).toContainText('Lions are a kind of big cat', {
      timeout: 20_000,
    })
    await expect(page.locator('.grammar-body').first()).toContainText('一般现在时')
    await expect(page.locator('.question-text').first()).toContainText('big teeth')

    // ---------- 看图题 ----------
    await page.goto(`/learn/${MOCK}/unit/mv-mock/topic/mv-mock-t6`)
    const img = page.locator('.qimage__img').first()
    await expect(img).toBeVisible({ timeout: 20_000 })
    const dims = await img.evaluate((el) => {
      const i = el as HTMLImageElement
      return { src: i.src, complete: i.complete, w: i.naturalWidth }
    })
    expect(dims.src).toMatch(/^blob:/)
    expect(dims.complete).toBe(true)
    expect(dims.w, '海盗图没解码出来（白板）').toBeGreaterThan(0)
    await expect(page.locator('.qimage__placeholder-text')).toHaveCount(0)

    // ---------- 点图放大：场景插图在 320px 高度里只有 300px 宽，看不清就点开 ----------
    // 这条链路只靠单测验不了（需要真实 pointer 事件 + Teleport 到 body 的层级）
    await expect(page.locator('.qimage-lb')).toHaveCount(0)
    // 比的是"显示尺寸"：320px 高度上限把近正方形的图压到 300px 左右，才对得上"看不清"这件事
    const thumbW = await img.evaluate((el) => (el as HTMLImageElement).clientWidth)
    await page.locator('.qimage__zoom').first().click()
    const lb = page.locator('.qimage-lb')
    await expect(lb).toBeVisible()
    const big = await lb.locator('img').evaluate((el) => (el as HTMLImageElement).clientWidth)
    expect(big, `缩略图 ${thumbW}px → 大图 ${big}px，没有真的放大`).toBeGreaterThan(thumbW * 1.5)

    // Esc 关闭（键盘通道），再点一次幕布也能关
    await page.keyboard.press('Escape')
    await expect(lb).toHaveCount(0)
    await page.locator('.qimage__zoom').first().click()
    await expect(lb).toBeVisible()
    await lb.click({ position: { x: 10, y: 10 } })
    await expect(lb).toHaveCount(0)
  })
})
