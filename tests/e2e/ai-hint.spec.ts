import { test, expect, type Page } from '@playwright/test'

/**
 * F1 · 错题 AI 启发式讲评（e2e，`page.route` 全程 mock，零真实网络）
 * =========================================================================
 * 为什么必须有这个 spec：单测已经证明了 Prompt、SSE 解析、降级链都对，
 * 但**没有证明"点按钮之后抽屉里真的有字在长"**。这里补的就是 UI 这一段：
 *
 *   1. 打字机：mock 一个流式引擎 → 断言 `.ai-hint-text` 的文字**逐渐变长**
 *      （不是断言"最终有字"——那会把"整段蹦出来"也判成通过）；
 *   2. 降级：把 mock 改成**一直 pending**（不 fulfill）→ 断言抽屉里出现
 *      **具体的降级人话**，而不是"按钮点了没报错"的假绿；
 *   3. 加载态：请求期间按钮是 loading、抽屉里有「⏹ 停止」。
 *
 * 纪律：种子日期一律本地构造；`waitDbReady` 用 `.ach-head-count`
 * （读库完成后才渲染，裸开 IDB 会造空库，V1.3 已踩过）。
 */

const DB_NAME = 'FamilyLearningDB'
const OLLAMA_TAGS = '**://localhost:11434/api/tags'
const OLLAMA_GENERATE = '**://localhost:11434/api/generate'
const DEEPSEEK = '**://api.deepseek.com/**'

/** 逐段 NDJSON（Ollama 流式形态） */
const STREAM_PARTS: readonly string[] = [
  '【先想这一步】把题目再读一遍，用笔圈出关键条件：数字、单位，',
  '以及「一共 / 剩余 / 至少」这类词。\n',
  '【为什么】这类错误是题目信息没看全就开始算，方向从第一步就偏了。\n',
  '【你来试试】题目里的关键条件一共有几个？哪一个是你刚才答题时漏掉的？',
]
const NDJSON_BODY = STREAM_PARTS.map(
  (part) => JSON.stringify({ model: 'qwen2.5:7b-instruct', response: part, done: false }),
)
  .concat([JSON.stringify({ model: 'qwen2.5:7b-instruct', response: '', done: true })])
  .join('\n')
/** mock 引擎最终给的完整文本（打字机最终应该长到这么长） */
const FULL_TEXT = STREAM_PARTS.join('')

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

/** 一个数学单元包 + 一条「审题不清」的错题 */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
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
        value: {
          activeId: 'default',
          list: [{ id: 'default', name: '我', createdAt: new Date().toISOString() }],
        },
      })
      tx.objectStore('packages').put({
        packageId: 'unit-math',
        manifest: { packageId: 'unit-math', type: 'unit', subject: 'math', grade: 4, title: 'AI 讲评测试单元' },
        knowledgePoints: [{ id: 'unit-math::kp1', title: '两位数乘法' }],
        exercises: [],
        units: [
          {
            id: 'u1',
            title: '单元一',
            topics: [{ id: 't1', title: '话题一', knowledgePointIds: ['unit-math::kp1'] }],
          },
        ],
      })
      tx.objectStore('mistakes').put({
        profileId: 'default',
        packageId: 'unit-math',
        exerciseId: 'ex-ai-1',
        knowledgePointIds: ['unit-math::kp1'],
        wrongAt: new Date().toISOString(),
        wrongCount: 3,
        mastered: false,
        masteryLevel: 'none',
        mistakeCause: 'misread',
        lastUserAnswer: 'B',
        questionData: {
          id: 'ex-ai-1',
          question: '一根绳子长 12 米，平均分成 3 段，每段长多少米？',
          options: ['A. 4 米', 'B. 36 米'],
          answer: 'A',
          type: 'choice',
          explanation: '总量除以段数，注意单位是米',
        },
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    })
  }, DB_NAME)
}

/** 抽屉里打字机文本的当前长度（去首尾空白） */
async function hintLen(page: Page): Promise<number> {
  return (await page.locator('.ai-hint-text').innerText()).trim().length
}

async function waitUntil(fn: () => Promise<boolean>, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}

test.describe('F1 · 错题 AI 启发式讲评', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page)
  })

  test('打字机流式渲染：文字逐渐变长，最终等于模型给的完整内容', async ({ page }) => {
    // 本地模型可用 → 走 Ollama 引擎（无需 Key，e2e 不发任何真实请求）
    await page.route(OLLAMA_TAGS, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[]}' }),
    )
    // 故意让首字节晚 800ms 到：真实模型不会瞬间给全，
    // 而且没有这段延迟的话 loading 态一闪而过，"可中断"根本测不到。
    await page.route(OLLAMA_GENERATE, async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: NDJSON_BODY })
    })

    await page.goto('/mistakes')
    const hintBtn = page.getByRole('button', { name: /启发一下/ }).first()
    await expect(hintBtn).toBeVisible({ timeout: 20_000 })

    await hintBtn.click()

    const drawer = page.locator('.n-drawer')
    await expect(drawer).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.ai-hint-question')).toContainText('一根绳子长 12 米')

    // ① 期间是 loading 态，且可以中断（不是点了就干等）
    await expect(page.getByRole('button', { name: /停止/ })).toBeVisible({ timeout: 5_000 })

    // ② 文字**逐渐**出现：先等到有字，记下长度，再等到完整 —— 两者必须不等
    const started = await waitUntil(async () => (await hintLen(page)) > 0, 15_000)
    expect(started, '抽屉里始终没有出现任何文字').toBe(true)
    const firstLen = await hintLen(page)

    const settled = await waitUntil(async () => (await hintLen(page)) === FULL_TEXT.length, 20_000)
    expect(settled, `打字机没有走完（停在 ${firstLen} 字，应为 ${FULL_TEXT.length} 字）`).toBe(true)
    expect(firstLen, '文字必须是一点点长出来的，而不是整段蹦出来').toBeLessThan(FULL_TEXT.length)

    // ③ 内容来自 mock 的引擎，且标明了"这条提示是谁给的"
    await expect(page.locator('.ai-hint-text')).toContainText('先想这一步')
    await expect(page.locator('.ai-hint-text')).toContainText('你来试试')
    await expect(page.locator('.ai-hint-engine')).toContainText('本地模型（Ollama）')

    // ④ 讲评结束后按钮回到「关闭」，不再 loading
    await expect(page.getByRole('button', { name: '关闭' })).toBeVisible({ timeout: 10_000 })
  })

  test('mock 一直 pending（本地探测挂住）→ 抽屉给出降级人话，不是"点了没报错"', async ({ page }) => {
    // 三处全部挂住：**不 fulfill、不 abort**，让请求永远 pending
    await page.route(DEEPSEEK, () => {
      /* 故意什么都不做：模拟云端卡住 */
    })
    await page.route(OLLAMA_TAGS, () => {
      /* 同样挂住 */
    })
    await page.route(OLLAMA_GENERATE, () => {
      /* 同样挂住 */
    })

    await page.goto('/mistakes')
    await page.getByRole('button', { name: /启发一下/ }).first().click()

    const drawer = page.locator('.n-drawer')
    await expect(drawer).toBeVisible({ timeout: 10_000 })

    // 降级提示必须是**具体的人话**，且探测挂住时要在一个探测周期内（1.5s）给出结论，
    // 不能让孩子盯着转圈等满 30 秒
    const notice = page.locator('.ai-hint-notice')
    await expect(notice).toBeVisible({ timeout: 8_000 })
    const noticeText = (await notice.innerText()).trim()
    expect(noticeText.length, '降级提示不能是空的').toBeGreaterThan(10)
    // 文案里的说法是"题库自带的解析"，这里只钉住"题库自带"四个字（不跟语气词较劲）
    expect(noticeText).toContain('题库自带')
    // 没配 Key 这件事必须被点名（家长能做的唯一动作就是去设置页填）
    expect(noticeText).toContain('AI 助手设置')

    // 最终生效的引擎是静态解析，并且**确实有内容**（不是空抽屉）
    await expect(page.locator('.ai-hint-engine')).toContainText('题库自带解析')
    const hasText = await waitUntil(async () => (await hintLen(page)) > 30, 15_000)
    expect(hasText, '降级到静态解析后抽屉里必须有可看的启发').toBe(true)
  })

  test('配好 Key 但云端一直 pending → 等满超时后降级，提示写明"响应太慢"', async ({ page }) => {
    await page.route(DEEPSEEK, () => {
      /* 故意挂住：模拟云端不返回 */
    })
    await page.route(OLLAMA_TAGS, (route) => route.abort('connectionrefused'))
    await page.route(OLLAMA_GENERATE, (route) => route.abort('connectionrefused'))

    // 先在设置页填 Key（填完只在本次会话生效），**必须走 SPA 导航**——
    // `page.goto` 会整页刷新，模块里的会话 Key 就没了（这正是"不落盘"的语义）。
    await page.goto('/settings')
    const keyInput = page.getByPlaceholder('粘贴 DeepSeek 的 API Key（sk-…）')
    await expect(keyInput).toBeVisible({ timeout: 20_000 })
    await keyInput.fill('sk-e2e-not-a-real-key')
    await keyInput.blur()
    await expect(page.getByText('Key 已在本机本次使用中生效')).toBeVisible({ timeout: 10_000 })

    await page
      .locator('.sidebar-item:has-text("错题本"):visible, .nav-item:has-text("错题本"):visible')
      .first()
      .click()
    await expect(page).toHaveURL(/\/mistakes/, { timeout: 10_000 })

    await page.getByRole('button', { name: /启发一下/ }).first().click()
    await expect(page.locator('.n-drawer')).toBeVisible({ timeout: 10_000 })

    // 云端挂住 → 走满 20 秒超时 → 降级（这条断言同时证明超时阈值真的生效）
    const notice = page.locator('.ai-hint-notice')
    await expect(notice).toBeVisible({ timeout: 40_000 })
    const noticeText = (await notice.innerText()).trim()
    expect(noticeText).toContain('响应太慢')

    await expect(page.locator('.ai-hint-engine')).toContainText('题库自带解析')
  })
})
