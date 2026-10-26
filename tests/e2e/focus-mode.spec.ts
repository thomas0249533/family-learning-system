import { test, expect, type Page } from '@playwright/test'

/**
 * V2.1 · 沉浸式专注模式（H 线端到端）
 * =====================================================================
 * 断言链：播种一个专题包 → 进入专题页 → 点「⛶ 专注模式」→
 *   · 侧栏 / 顶栏 / 底部 tab 全部隐藏（`.not.toBeVisible()`，不用 toHaveCount(0)）；
 *   · 主内容区铺满视口宽度；
 *   · 点「退出专注」→ 侧栏恢复显示。
 *
 * 防护（按派发叮嘱）：
 *   · 即使浏览器拒绝 / 不支持 requestFullscreen，侧栏也必须被隐藏——
 *     因为隐藏只依赖 isFocusMode 类，与全屏成功与否解耦；
 *   · 用 toBeHidden() 而非 toHaveCount(0) 断言显隐。
 *
 * 生命周期铁律：专注态**不落盘**，离开练习页（TopicDetail 卸载）即重置。
 * 本 spec 不测"刷新后仍在专注"（故意选每次进入重置为 false 的安全路径）。
 *
 * 播种 / 主题冻结姿势照抄 b-resume.spec.ts（addInitScript 预置 fls:theme +
 * 清 IndexedDB 必须在 goto 之后）。
 */
const DB_NAME = 'FamilyLearningDB'
const PROFILE_ID = 'default'
const PKG = 'focus-mode'
const TOTAL = 5
const FIXED_NOW = new Date('2025-03-10T10:00:00').getTime()

function buildSeed() {
  const exercises = Array.from({ length: TOTAL }, (_, i) => ({
    id: `${PKG}::q${i + 1}`,
    type: 'single',
    question: `第 ${i + 1} 题：${i + 1} + 1 = ?`,
    options: ['A. 正确选项', 'B. 干扰项一', 'C. 干扰项二', 'D. 干扰项三'],
    answer: 'A',
    explanation: `第 ${i + 1} 题的解析`,
    knowledgePointIds: [],
  }))
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
          title: '专注模式包',
          examMode: false,
        },
        knowledgePoints: [],
        exercises: [],
        units: [
          {
            id: 'u1',
            title: '单元一',
            topics: [
              { id: 't1', title: '专注专题', knowledgePointIds: [], exercises },
            ],
          },
        ],
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
      createdAt: '2025-03-01T00:00:00.000Z',
    },
  )
}

const TOPIC_URL = `/learn/${PKG}/unit/u1/topic/t1`

test('沉浸式专注模式：进入后隐藏布局外壳、退出后恢复', async ({ page }) => {
  await installTheme(page)
  await page.goto('/')
  await resetDb(page)
  await seedAll(page, buildSeed())
  await page.goto(TOPIC_URL)

  // 练习区挂载（含专注按钮）
  await page.locator('.quiz-header').first().waitFor({ state: 'visible', timeout: 30_000 })
  const focusBtn = page.locator('[data-testid="focus-toggle"]')
  await focusBtn.waitFor({ state: 'visible' })

  // 进入前：桌面视口下侧栏 + 顶栏可见（底部 tab 在 ≥1024px 本就隐藏，故不在此断言）
  await expect(page.locator('.app-sidebar')).toBeVisible()
  await expect(page.locator('.app-header')).toBeVisible()

  // 进入专注
  await focusBtn.click()

  // 侧栏 / 顶栏 / 底 tab 全部隐藏（不依赖全屏是否成功）
  await expect(page.locator('.app-sidebar')).toBeHidden()
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(page.locator('.app-nav')).toBeHidden()

  // 主内容区铺满视口（去掉侧栏宽度后 ≈ 1280）
  const mainBox = await page.locator('.app-main').boundingBox()
  expect(mainBox).not.toBeNull()
  expect(mainBox!.width).toBeGreaterThan(1200)

  // 悬浮退出按钮存在
  await expect(page.locator('.focus-exit-btn')).toBeVisible()

  // 退出专注：侧栏 + 顶栏恢复显示（底部 tab 在 ≥1024px 始终隐藏，故不在此断言）
  await page.locator('.focus-exit-btn').click()
  await expect(page.locator('.app-sidebar')).toBeVisible()
  await expect(page.locator('.app-header')).toBeVisible()
})

// =====================================================================
// V2.7 · 轨道 B2：本地音频（导入 → 播放 → 删除）
// =====================================================================

/** 造一段 0.2 秒的静音 WAV（16bit 单声道 8kHz）：足以让 decodeAudioData 成功 */
function silentWav(): Buffer {
  const rate = 8000
  const samples = 1600
  const dataSize = samples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

test('本地音频：导入后自动播放、落进 IndexedDB、删除即消失', async ({ page }) => {
  await installTheme(page)
  await page.goto('/')
  await resetDb(page)
  await seedAll(page, buildSeed())
  await page.goto(TOPIC_URL)

  await page.locator('.quiz-header').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-testid="focus-toggle"]').click()

  const panel = page.locator('.focus-panel')
  await expect(panel).toBeVisible()

  // 导入（input 被视觉隐藏，setInputFiles 不需要它可见）
  await panel.locator('input[type="file"]').setInputFiles({
    name: '我的雨声.wav',
    mimeType: 'audio/wav',
    buffer: silentWav(),
  })

  const chip = panel.locator('.sound-chip__play', { hasText: '我的雨声' })
  await expect(chip).toBeVisible()
  // 导入成功即自动播放：chip 呈按下态，且音量条出现（= 有音源在响）
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('.vol-slider')).toBeVisible()

  // 真的落库了（不是只活在内存里）
  const rows = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('FamilyLearningDB')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const all = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction('customSounds', 'readonly')
      const req = tx.objectStore('customSounds').getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return all.map((r) => ({ name: r.name, size: r.size, hasBlob: r.blob instanceof Blob }))
  })
  expect(rows).toHaveLength(1)
  expect(rows[0].name).toBe('我的雨声')
  expect(rows[0].hasBlob).toBe(true)

  // 删除：chip 消失，且音源回到「关」
  await panel.locator('.sound-chip__del').click()
  await expect(chip).toHaveCount(0)
  await expect(panel.locator('.local-sounds__hint')).toBeVisible()
})
