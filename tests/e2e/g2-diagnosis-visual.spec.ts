import { test, expect, type Page } from '@playwright/test'
import { freezeSmil } from './freeze-smil'

/**
 * G2 · AI 诊断报告视觉基线（V1.12 Stage G）
 * =====================================================================
 * e2e 环境没有 API Key、也没有 Ollama —— 这恰好是最该被钉住的**降级路径**：
 * DeepSeek(no-key) → Ollama(probe 失败) → 本地规则引擎(rules)。
 * 断言：
 *   1. 点「生成诊断报告」后 `.diag-report` 出现且含「本地统计诊断（离线生成）」；
 *   2. 引擎标签显示"本地"（降级确实生效，不是假装云端成功）；
 *   3. `.diag-notice` 有降级人话；
 *   4. 打字机结束后（`.diag-actions` 出现 = flush 完成）才截图，基线确定性。
 *
 * 流式打字机的正向证据在单测 tests/ai-diagnosis.test.ts（Mock 流）；这里只钉
 * "降级 + 渲染 + 能导出按钮出现"这三件视觉可见的事。
 */

const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const FIXED_NOW = new Date('2025-01-15T10:00:00').getTime()
const PROFILE_CREATED_AT = '2025-01-01T00:00:00.000Z'

const G2_PKG = 'g2-diagnosis-visual'
const K1 = `${G2_PKG}::k1`
const K2 = `${G2_PKG}::k2`

function buildSeed(): {
  packages: Array<Record<string, unknown>>
  mistakes: Array<Record<string, unknown>>
} {
  return {
    packages: [
      {
        packageId: G2_PKG,
        manifest: {
          schemaVersion: '1.0',
          packageId: G2_PKG,
          type: 'unit',
          subject: 'math',
          grade: 4,
          term: 'up',
          edition: '人教版',
          title: 'G2 视觉 · 诊断包',
          examMode: false,
        },
        knowledgePoints: [
          { id: K1, type: 'concept', title: '小数的意义', content: '' },
          { id: K2, type: 'concept', title: '小数加减法', content: '' },
        ],
        exercises: [],
        units: [],
      },
    ],
    // 4 条未掌握错题：错因分布 knowledge/careless 各 2，卡壳点 K2 更多
    mistakes: [
      {
        profileId: PROFILE_ID,
        packageId: G2_PKG,
        exerciseId: 'g2-ex-1',
        knowledgePointIds: [K1],
        wrongAt: '2025-01-05T09:00:00',
        wrongCount: 1,
        mastered: false,
        mistakeCause: 'knowledge',
        questionData: { question: '0.3 表示几个十分之一？', answer: '3' },
        lastUserAnswer: '30',
      },
      {
        profileId: PROFILE_ID,
        packageId: G2_PKG,
        exerciseId: 'g2-ex-2',
        knowledgePointIds: [K1],
        wrongAt: '2025-01-06T09:00:00',
        wrongCount: 2,
        mastered: false,
        mistakeCause: 'careless',
        questionData: { question: '0.25 + 0.75 = ?', answer: '1' },
        lastUserAnswer: '0.100',
      },
      {
        profileId: PROFILE_ID,
        packageId: G2_PKG,
        exerciseId: 'g2-ex-3',
        knowledgePointIds: [K2],
        wrongAt: '2025-01-08T09:00:00',
        wrongCount: 3,
        mastered: false,
        mistakeCause: 'knowledge',
        questionData: { question: '1.2 - 0.35 = ?', answer: '0.85' },
        lastUserAnswer: '0.95',
      },
      {
        profileId: PROFILE_ID,
        packageId: G2_PKG,
        exerciseId: 'g2-ex-4',
        knowledgePointIds: [K2],
        wrongAt: '2025-01-10T09:00:00',
        wrongCount: 1,
        mastered: false,
        mistakeCause: 'careless',
        questionData: { question: '3.6 + 2.4 = ?', answer: '6' },
        lastUserAnswer: '5',
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
    async ({ dbName, packages, mistakes, profileId, createdAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'mistakes'], 'readwrite')
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: profileId, list: [{ id: profileId, name: '我', createdAt }] },
        })
        for (const pkg of packages) tx.objectStore('packages').put(pkg)
        for (const row of mistakes) tx.objectStore('mistakes').put(row)
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
      mistakes: seed.mistakes,
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
  test(`ai-diagnosis-${mode}`, async ({ page }) => {
    await installDeterminismHooks(page, mode)

    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seedAll(page, buildSeed())

    await page.goto('/parent')
    await page.waitForLoadState('networkidle')
    await waitToastsSettled(page)

    // 卡片就绪 + 按钮可点（summary 非空的前提是播种的错题行被 store 读到）
    await expect(page.locator('.diag-entry')).toBeVisible({ timeout: 20_000 })
    const runBtn = page.getByRole('button', { name: '生成诊断报告' })
    await expect(runBtn).toBeEnabled({ timeout: 20_000 })
    await runBtn.click()

    // 报告出现（降级路径：本地规则引擎，无需 Key / Ollama）
    await expect(page.locator('.diag-report')).toBeVisible({ timeout: 20_000 })
    // 生成结束信号：`.diag-actions` 出现 ⇔ diagnosing=false ⇔ 打字机已 flush 全量
    await expect(page.locator('.diag-actions')).toBeVisible({ timeout: 30_000 })

    // 降级确实生效：引擎标签是"本地…"，报告是离线统计版，且有降级人话
    await expect(page.locator('.diag-engine')).toContainText('本地', { timeout: 10_000 })
    await expect(page.locator('.diag-report')).toContainText('本地统计诊断', { timeout: 10_000 })
    await expect(page.locator('.diag-report')).toContainText('错因分布')
    const notice = await page.locator('.diag-notice').innerText()
    expect(notice.trim().length).toBeGreaterThan(0)

    await freezeSmil(page)
    await page.screenshot({
      path: `docs/screenshots/ai-diagnosis-${mode}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
}
