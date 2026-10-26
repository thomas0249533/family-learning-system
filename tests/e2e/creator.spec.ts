import { test, expect, type Page } from '@playwright/test'

/**
 * V2.2 轨道 I · 创作者中心端到端
 * =====================================================================
 * 仅写不跑（e2e 由主代理统一跑）。用例：
 *   1. /creator 点「导出 .lpkgset」→ 断言触发下载（page.waitForEvent('download')）。
 *   2. catalog 输入框填入不可达 URL → 点「检查更新」→ 断言出现错误文案，
 *      且页面不白屏/不崩溃（验证 CORS/网络失败的优雅处理）。
 *
 * 离线稳定：第 2 条测的就是失败路径，不依赖任何真实外网。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const PKG = 'creator-seed'
const FIXED_NOW = new Date('2025-03-10T10:00:00').getTime()

function buildSeed() {
  return {
    packages: [
      {
        packageId: PKG,
        manifest: {
          schemaVersion: '1.0',
          packageId: PKG,
          type: 'unit',
          subject: 'math',
          grade: 4,
          term: 'up',
          edition: '人教版',
          title: '创作者种子包',
        },
        knowledgePoints: [],
        exercises: [],
        units: [],
      },
    ],
    progress: [],
  }
}

async function installTheme(page: Page): Promise<void> {
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
        JSON.stringify({ preset: 'junior', mode: m, fontSize: 'medium', presetManual: false }),
      )
    },
    { mode: 'light', fixedNow: FIXED_NOW },
  )
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
    async ({ dbName, packages, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages'], 'readwrite')
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        for (const pkg of packages) tx.objectStore('packages').put(pkg)
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
      profileId: PROFILE_ID,
      createdAt: '2025-03-01T00:00:00.000Z',
    },
  )
}

test('创作者中心：导出 .lpkgset 触发下载', async ({ page }) => {
  await installTheme(page)
  await page.goto('/')
  await resetDb(page)
  await seedAll(page, buildSeed())
  await page.goto('/creator')

  // 页面正常挂载（不白屏）
  await expect(page.getByText('创作者中心')).toBeVisible()

  // 默认表单已含 2 道题，直接点导出
  const exportBtn = page.getByRole('button', { name: /导出/ })
  await expect(exportBtn).toBeVisible()

  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await exportBtn.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.lpkgset$/)
})

test('创作者中心：不可达 catalog URL 优雅报错、不白屏', async ({ page }) => {
  await installTheme(page)
  await page.goto('/')
  await resetDb(page)
  await seedAll(page, buildSeed())
  await page.goto('/creator')

  // 切到「库同步」标签页（用标签文本定位，不依赖 naive-ui 的 ARIA role/class）
  await page.getByText('🌐 库同步').click()
  await expect(page.getByText('联网校验与库同步')).toBeVisible()

  // 填入一个不可达 URL（离线环境必失败，测的就是失败分支）
  const urlInput = page.getByPlaceholder(/catalog\.json/)
  await expect(urlInput).toBeVisible()
  await urlInput.fill('https://invalid.invalid.example/nope/catalog.json')

  // V2.6 · 任务2：用 data-testid 精确定位库同步卡片里的按钮。
  // 页面同时存在侧栏/顶栏的「检查更新」（V2.5 引入），按名字会命中多个元素触发
  // strict mode violation，故不再用 getByRole(name)。
  await page.getByTestId('catalog-check-update').click()

  // 失败路径：出现错误提示（network / cors 之一）
  // 精确匹配 alert 标题（正文为「网络请求失败：Failed to fetch」，避免严格模式匹配到两个元素）
  await expect(page.getByText('网络请求失败', { exact: true })).toBeVisible({
    timeout: 15_000,
  })

  // 页面未崩溃：库同步卡片仍在视口内（不白屏）
  await expect(page.getByText('联网校验与库同步')).toBeVisible()
})
