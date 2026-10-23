import { test, expect, type Page } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * G1 · 技能树视觉基线（V1.12 Stage G）
 * =====================================================================
 * 断言链：/home 顶部「🌳 技能树」入口 → 跳 /graph → echarts 树渲染出 canvas
 * → 图例可见、无空态 → 截图 knowledge-graph-{light,dark}.png。
 *
 * 播种：1 个 unit 包（subject=math，2 单元 4 知识点）+ 3 条进度行，
 * 覆盖 mastered / learning / review 三态（第 4 个知识点无行 → unlearned）。
 * 四态齐全才能证明"节点色映射"真的按状态分叉。
 *
 * 确定性：字面量数据、无随机、无网络、无 new Date()（时钟已冻结）。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

const G1_PKG = 'g1-graph-visual'
const K = (n: number) => `${G1_PKG}::k${n}`

function buildSeed(): {
  packages: Array<Record<string, unknown>>
  progress: Array<Record<string, unknown>>
} {
  const kp = (id: string, title: string) => ({ id, type: 'concept', title, content: '' })
  return {
    packages: [
      {
        packageId: G1_PKG,
        manifest: {
          schemaVersion: '1.0',
          packageId: G1_PKG,
          type: 'unit',
          subject: 'math',
          grade: 4,
          term: 'up',
          edition: '人教版',
          title: 'G1 视觉 · 技能树包',
          examMode: false,
        },
        knowledgePoints: [
          kp(K(1), '小数的意义'),
          kp(K(2), '小数的性质'),
          kp(K(3), '小数加减法'),
          kp(K(4), '单位换算'),
        ],
        exercises: [],
        units: [
          {
            id: 'u1',
            title: '小数的认识',
            topics: [
              { id: 'u1t1', title: '小数', knowledgePointIds: [K(1), K(2)], exercises: [] },
            ],
          },
          {
            id: 'u2',
            title: '小数的运算',
            topics: [
              { id: 'u2t1', title: '加减', knowledgePointIds: [K(3), K(4)], exercises: [] },
            ],
          },
        ],
      },
    ],
    // 三态各一 + k4 无行（unlearned）
    progress: [
      {
        profileId: PROFILE_ID,
        packageId: G1_PKG,
        knowledgePointId: K(1),
        status: '已掌握',
        wrongCount: 0,
        lastStudiedAt: '2025-01-10T09:00:00',
      },
      {
        profileId: PROFILE_ID,
        packageId: G1_PKG,
        knowledgePointId: K(2),
        status: '学习中',
        wrongCount: 2,
        lastStudiedAt: '2025-01-11T09:00:00',
      },
      {
        profileId: PROFILE_ID,
        packageId: G1_PKG,
        knowledgePointId: K(3),
        status: '需复习',
        wrongCount: 5,
        lastStudiedAt: '2025-01-12T09:00:00',
      },
    ],
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

async function waitToastsSettled(page: Page, quietMs = 3000, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let quietSince = Date.now()
  do {
    if ((await page.locator('.ach-toast').count()) > 0) quietSince = Date.now()
    if (Date.now() - quietSince >= quietMs) return
    if (Date.now() > deadline) throw new Error(`${timeoutMs}ms 内成就 toast 没有静默`)
    await page.waitForTimeout(100)
  } while (true)
}

for (const mode of ['light', 'dark'] as const) {
  test(`knowledge-graph-${mode}`, async ({ page }) => {
    await installDeterminismHooks(page, mode)

    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedAll(page, buildSeed())

    // 入口按钮存在 → 点它跳 /graph（证明入口接线，而不只是路由直开）
    await page.goto('/home')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.graph-entry button')).toBeVisible({ timeout: 20_000 })
    await waitToastsSettled(page)
    await page.locator('.graph-entry button').click()
    await expect(page).toHaveURL(/\/graph$/, { timeout: 10_000 })

    // echarts 渲染出 canvas 才算画上了
    await expect(page.locator('.graph-chart canvas').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.graph-legend')).toBeVisible()
    await expect(page.locator('.graph-empty')).toHaveCount(0)
    // 等 echarts 首帧动画稳定（截图不允许半张图）
    await page.waitForTimeout(1500)

    await freezeSmil(page)
    await page.screenshot({
      path: `docs/screenshots/knowledge-graph-${mode}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
}
