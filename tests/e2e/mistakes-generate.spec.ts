import { test, expect, type Page } from '@playwright/test'

/**
 * E3 · 错题本「一键生成练习卷」（E2 引擎的 UI 入口，功能断言）
 * =====================================================================
 * 既有单测（`tests/weakpoints-engine.test.ts`）证明引擎逻辑正确，
 * 静态断言证明模板上有按钮 —— 但**没有任何测试**证明"点按钮真的落库、
 * 落库的包真的能进 ExamPanel 渲染出题"。本 spec 补的就是这一段：
 *
 *   1. 点「一键生成练习卷」→ `db.packages` 多出 `special-weakpoints-auto` 行，
 *      且 `manifest.examMode === true` / `isInternal === true` /
 *      `knowledgePoints === []`（只引用不声明，E2 决策 1）；
 *   2. 进 `/learn/special-weakpoints-auto` → ExamPanel（不是单元列表）
 *      渲染出题目（点「开始新会话」后 QuizEngine 出第一题）；
 *   3. 覆盖确认：**首次**生成不弹确认框，**二次**生成弹（照仓库既有
 *      naive-ui dialog 范式），取消后停在原页、不导航。
 *
 * 纪律：种子日期一律本地构造（stage-c.spec.ts 同款），`lastStudiedAt`
 * 不写死过去日期（`applyDecay` 会腐坏种子）—— 本 spec 不种进度行，
 * 故不涉及；错题 `wrongAt` 用"刚刚"。
 */

const DB_NAME = 'FamilyLearningDB'
const WEAKPOINTS_PACKAGE_ID = 'special-weakpoints-auto'

async function waitDbReady(page: Page): Promise<void> {
  // `.ach-head-count` 只在读库完成后渲染 → 「Dexie 已建好 v4 schema」的可靠信号。
  // 裸开 IDB 抢在 Dexie 之前会造空库（V1.3 已踩过）。
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

/** 一个带 units/topics 的数学单元包（KP 的唯一声明者 → 归属解析的源头） */
function unitPackage(): Record<string, unknown> {
  return {
    packageId: 'unit-math',
    manifest: {
      packageId: 'unit-math',
      type: 'unit',
      subject: 'math',
      grade: 4,
      term: 'up',
      title: 'E3 测试单元',
    },
    knowledgePoints: [
      { id: 'unit-math::kp1', title: '两位数乘法' },
      { id: 'unit-math::kp2', title: '带余除法' },
    ],
    exercises: [],
    units: [
      {
        id: 'u1',
        title: '单元一',
        topics: [
          { id: 't1', title: '话题一', knowledgePointIds: ['unit-math::kp1', 'unit-math::kp2'] },
        ],
      },
    ],
  }
}

/** 一条未掌握错题（cause 未打标 → 引擎按 knowledge 兜底 → 主池候选） */
function mistake(exerciseId: string, kpId: string, wrongCount: number): Record<string, unknown> {
  return {
    profileId: 'default',
    packageId: 'unit-math',
    exerciseId,
    knowledgePointIds: [kpId],
    wrongAt: new Date().toISOString(),
    wrongCount,
    mastered: false,
    masteryLevel: 'none',
    questionData: {
      id: exerciseId,
      question: `${exerciseId}: 3 × 4 = ?`,
      options: ['A. 12', 'B. 7'],
      answer: 'A',
      type: 'choice',
    },
    lastUserAnswer: 'B',
  }
}

/** 四表链路播种（settings/packages/progress/mistakes；settings 必须写 profiles 键） */
async function seed(page: Page): Promise<void> {
  await page.evaluate(
    async ({ dbName, pkg, mistakes }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages', 'progress', 'mistakes'], 'readwrite')
        tx.objectStore('settings').put({
          key: 'profiles',
          value: {
            activeId: 'default',
            list: [{ id: 'default', name: '我', createdAt: new Date().toISOString() }],
          },
        })
        tx.objectStore('packages').put(pkg)
        for (const m of mistakes) tx.objectStore('mistakes').put(m)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    {
      dbName: DB_NAME,
      pkg: unitPackage(),
      mistakes: [
        mistake('ex-e3-1', 'unit-math::kp1', 5),
        mistake('ex-e3-2', 'unit-math::kp1', 2),
        mistake('ex-e3-3', 'unit-math::kp2', 1),
      ],
    }
  )
}

/** 读库里的临时包行（落盘效果的核心断言） */
async function readWeakpointsPackage(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rec = await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      const tx = db.transaction(['packages'], 'readonly')
      const req = tx.objectStore('packages').get('special-weakpoints-auto')
      req.onsuccess = () => resolve((req.result as Record<string, unknown>) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rec
  }, DB_NAME)
}

test.describe('E3 · 一键生成练习卷（落盘 + ExamPanel + 覆盖确认）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)
  })

  test('生成 → 落盘 special-weakpoints-auto（examMode/isInternal/零 KP 声明）→ ExamPanel 出题', async ({
    page,
  }) => {
    await page.goto('/mistakes')

    const generateBtn = page.getByRole('button', { name: '一键生成练习卷' })
    await expect(generateBtn).toBeVisible({ timeout: 20_000 })
    // 判空闸：错题本非空才可用（onMounted 的 loadUserData 跑完后启用）
    await expect(generateBtn).toBeEnabled()

    // 首次生成不弹确认（覆盖确认只在"已有临时包"时出现）
    await expect(page.locator('.n-dialog')).toHaveCount(0)
    await generateBtn.click()

    // 1. 落盘效果：多出临时包行
    await expect(page).toHaveURL(new RegExp(`/learn/${WEAKPOINTS_PACKAGE_ID}`), { timeout: 20_000 })
    const pkg = await readWeakpointsPackage(page)
    expect(pkg, 'db.packages 里应有 special-weakpoints-auto 行').not.toBeNull()
    const manifest = pkg!.manifest as Record<string, unknown>
    expect(manifest.examMode, 'examMode 必须为 true（否则 UnitList 不进 ExamPanel）').toBe(true)
    expect(manifest.isInternal, 'isInternal 保持 true（E2 刻意决定：系统生成的卷不进 PackageList）').toBe(true)
    expect(pkg!.knowledgePoints, 'knowledgePoints 必须为空（只引用不声明，E2 决策 1）').toEqual([])
    const exercises = pkg!.exercises as unknown[]
    expect(exercises.length, '3 条错题全部入卷').toBe(3)

    // 2. ExamPanel 直接渲染（不是单元列表）：intro 屏的总题数 = 3
    const panel = page.locator('.exam-panel')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel.locator('.exam-title')).toHaveText('我的弱项攻关卷')
    await expect(panel.locator('.exam-meta .meta-item').first()).toContainText('3')
    // examMode 包没有单元卡可点
    await expect(page.locator('.unit-card')).toHaveCount(0)

    // 3. 开始新会话 → QuizEngine 真的渲染出第一题（题干来自错题原题）
    await page.getByRole('button', { name: /开始新会话/ }).click()
    await expect(page.locator('.quiz-engine')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.progress-text')).toContainText('第 1 / 3 题')
    await expect(page.locator('.question-text').first()).toContainText('3 × 4 = ?')
  })

  test('二次生成弹覆盖确认；取消后停在原页不导航', async ({ page }) => {
    await page.goto('/mistakes')
    const generateBtn = page.getByRole('button', { name: '一键生成练习卷' })
    await expect(generateBtn).toBeEnabled({ timeout: 20_000 })

    // 第一次：直接生成（无确认）
    await generateBtn.click()
    await expect(page).toHaveURL(new RegExp(`/learn/${WEAKPOINTS_PACKAGE_ID}`), { timeout: 20_000 })
    const before = await readWeakpointsPackage(page)
    expect(before).not.toBeNull()

    // 第二次：已有临时包 → 必须先过确认框
    await page.goto('/mistakes')
    await expect(generateBtn).toBeEnabled({ timeout: 20_000 })
    await generateBtn.click()

    const dialog = page.locator('.n-dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText('重新生成练习卷')
    await expect(dialog).toContainText('覆盖旧卷')

    // 取消 → 对话框关闭、停在错题本（不导航 = 没有触发生成后的跳转）
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(page.locator('.n-dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/mistakes/)

    // 确认框的正面路径也走一遍：同意后重新覆盖成卷
    await generateBtn.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '重新生成' }).click()
    await expect(page).toHaveURL(new RegExp(`/learn/${WEAKPOINTS_PACKAGE_ID}`), { timeout: 20_000 })

    // 覆盖是幂等的：仍然只有一行、题目数不变（不累积）
    const after = await readWeakpointsPackage(page)
    expect((after!.exercises as unknown[]).length).toBe(3)
    const count = await page.evaluate(async (dbName) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const n = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(['packages'], 'readonly')
        const req = tx.objectStore('packages').count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return n
    }, DB_NAME)
    expect(count, '覆盖写入不累积：仍然只有 unit-math + 临时包两行').toBe(2)
  })

  test('错题本为空 → 按钮禁用（判空闸）', async ({ page }) => {
    // 重新种一个空错题本（同一档案、无 mistakes 行）
    await page.evaluate(async (dbName) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['mistakes'], 'readwrite')
        tx.objectStore('mistakes').clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    }, DB_NAME)

    await page.goto('/mistakes')
    const generateBtn = page.getByRole('button', { name: '一键生成练习卷' })
    await expect(generateBtn).toBeVisible({ timeout: 20_000 })
    await expect(generateBtn).toBeDisabled()
  })
})
