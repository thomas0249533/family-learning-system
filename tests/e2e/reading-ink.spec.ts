import { test, expect, type Page } from '@playwright/test'

/**
 * V1.6 · Stage D · D4 —— 语文阅读理解「划线辅助」的**浏览器级**验证
 * =====================================================================
 * `tests/reading-ink.test.ts` 的 45 条单测覆盖的是 `src/core/reading/ink.ts` 的纯函数
 * （坐标夹取、抽稀、命中、脏数据反序列化）。而这个功能对用户的三句承诺，单测结构上
 * 证明不了：
 *
 *   1. **能画**：pointer 事件真的落到 svg 上、`viewBox 0..1` 下画出来的线跟手；
 *   2. **刷新还在**：痕迹真的写进 sessionStorage 又读回来（不是内存态"看起来对"）；
 *   3. **阅读体验没被毁**：浏览模式不没收文本选中能力，画线期间才禁；
 *      以及"误点一下清除"不会把整页画痕清空。
 *
 * 这四条恰好是 Stage C 补过的同一类缺口（`tests/e2e/stage-c.spec.ts`）：纯函数绿、
 * UI 零验证。这里照同样的标准补齐。
 *
 * 纪律：
 *   - 只新增本文件，**不改 src/**；发现真缺陷就报告，不改断言迁就。
 *   - 每条用例独立：自己清库 + 播种 + 清 sessionStorage，不依赖执行顺序。
 *   - 播种前必须等 Dexie 把 v4 表建好（`.ach-head-count` 可见），否则裸开 IDB
 *     会造出空库、App 后续读到空 schema（V1.3 踩过）。
 */

const DB_NAME = 'FamilyLearningDB'
const PKG_ID = 'read-d4'
const TOPIC_URL = `/learn/${PKG_ID}/unit/ru1/topic/rt1`

/** 正文（≥5 段，`\n\n` 分隔 → markdown-it 渲染成多个 `<p>`） */
const TEXT_CONTENT = [
  '从小丘西行百二十步，隔篁竹，闻水声，如鸣佩环，心乐之。伐竹取道，下见小潭，水尤清冽。',
  '全石以为底，近岸，卷石底以出，为坻，为屿，为嵁，为岩。青树翠蔓，蒙络摇缀，参差披拂。',
  '潭中鱼可百许头，皆若空游无所依。日光下澈，影布石上，佁然不动；俶尔远逝，往来翕忽。',
  '潭西南而望，斗折蛇行，明灭可见。其岸势犬牙差互，不可知其源。',
  '坐潭上，四面竹树环合，寂寥无人，凄神寒骨，悄怆幽邃。以其境过清，不可久居，乃记之而去。',
  '同游者：吴武陵，龚古，余弟宗玄。隶而从者，崔氏二小生，曰恕己，曰奉壹。',
].join('\n\n')

// ===========================================================================
// 播种 / 清库（照抄 stage-c.spec.ts 的已验证链路）
// ===========================================================================

/** `.ach-head-count` 只在读库完成（`refreshView()` await 过）后渲染 → 库已就绪的可靠信号 */
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

/**
 * 每个用例的统一起点：`/home` → 清库 → 等库就绪 → 清掉 sessionStorage 里的划痕。
 *
 * sessionStorage 在同一个 Page 的 reload 之间是保留的（用例 2/5 正是靠这一点），
 * 这里显式清一次，保证"上一个用例画的线"不会漏进下一个用例 —— 让每条用例
 * 都能单独 `-g` 跑。
 */
async function openCleanDb(page: Page): Promise<void> {
  await page.goto('/home')
  await resetDb(page)
  await waitDbReady(page)
  await page.evaluate(() => {
    try {
      sessionStorage.clear()
    } catch {
      // 隐私模式：清不掉也无所谓，下面的断言不依赖它
    }
  })
}

/**
 * 直接往库里种一个"语文阅读"包：一个知识点（正文）+ 一个单元 + 一个专题，
 * 专题的 module 就是 `chinese.text` —— 只有这个模块类型会收到 `doc-key`，
 * 于是 `.ink-layer` 的存在本身就证明了 props 透传链路通了。
 *
 * 一个 transaction 写完：跨表半截状态会让断言随机红。
 * `indexedDB.open(dbName)` 不带版本号 —— 此时 App 已建好 v4 库，不会造空库。
 */
async function seedReadingPackage(page: Page): Promise<void> {
  await page.evaluate(
    async ({ dbName, pkgId, content }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      const nowIso = new Date().toISOString()

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['settings', 'packages'], 'readwrite')
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: 'default', list: [{ id: 'default', name: '我', createdAt: nowIso }] },
        })
        tx.objectStore('packages').put({
          packageId: pkgId,
          manifest: {
            packageId: pkgId,
            type: 'unit',
            subject: 'chinese',
            grade: 4,
            term: 'up',
            title: 'D4 划线检查包',
            examMode: false,
          },
          knowledgePoints: [{ id: `${pkgId}::kp1`, title: '《小石潭记》节选', content }],
          exercises: [],
          units: [
            {
              id: 'ru1',
              title: '阅读单元',
              topics: [
                {
                  id: 'rt1',
                  title: '潭水',
                  knowledgePointIds: [`${pkgId}::kp1`],
                  modules: [{ type: 'chinese.text', knowledgePointIds: [`${pkgId}::kp1`] }],
                },
              ],
            },
          ],
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, pkgId: PKG_ID, content: TEXT_CONTENT }
  )
}

/** 清库 → 播种 → 进阅读页（`.ink-layer` 存在即说明 docKey 已透传到画笔层） */
async function openReadingPage(page: Page): Promise<void> {
  await openCleanDb(page)
  await seedReadingPackage(page)
  await page.goto(TOPIC_URL)
  // 20s 而不是默认 10s：本机 e2e 与多个并行任务共享一个 dev server，
  // 别人改 src 会触发 Vite 重编译，首帧偶尔要十几秒。断言逻辑不变，只放宽等待。
  await expect(page.locator('.text-body')).toBeVisible({ timeout: 20_000 })
  // 等**第 5 段**可见（而不是立刻数个数）：正文真的渲染出来了才继续
  await expect(page.locator('.text-body p').nth(4)).toBeVisible({ timeout: 20_000 })
  // 段落太少会让下面几条用例的"相对坐标"假设变脆，显式守住
  expect(await page.locator('.text-body p').count()).toBeGreaterThanOrEqual(5)
  await expect(page.locator('.ink-layer')).toHaveCount(1)
  await expect(page.locator('.ink-toolbar')).toHaveCount(1)
}

// ===========================================================================
// 画线工具
// ===========================================================================

function inkBtn(page: Page, label: '画笔' | '浏览' | '橡皮' | '清除') {
  return page.locator('.ink-btn', { hasText: label })
}

/** 画笔层的盒子（它 = `.text-host`，坐标空间就是它，不是 `.text-body`） */
async function layerBox(page: Page) {
  const box = await page.locator('.ink-layer').boundingBox()
  if (!box) throw new Error('.ink-layer 没有盒子，画笔层可能没渲染')
  return box
}

/**
 * 以图层盒子的**相对坐标**（0..1）画一条折线。
 *
 * 为什么用相对坐标：`ink.ts` 存的正是归一化坐标，用相对坐标画就等于同时验证了
 * "归一化 → 屏幕"这一层换算；写死像素的话换个字体/换台机器就错位。
 */
async function drawStroke(page: Page, relPoints: Array<[number, number]>): Promise<void> {
  const box = await layerBox(page)
  const pts = relPoints.map(([rx, ry]) => ({
    x: box.x + box.width * rx,
    y: box.y + box.height * ry,
  }))
  await page.mouse.move(pts[0].x, pts[0].y)
  await page.mouse.down()
  for (const p of pts.slice(1)) {
    // steps > 1 才会产生中间点：一个点会退化成"两点直线"，也测不出抽稀
    await page.mouse.move(p.x, p.y, { steps: 6 })
  }
  await page.mouse.up()
}

// ===========================================================================
// 用例
// ===========================================================================

test.describe('D4 · 划线辅助（浏览器级）', () => {
  test('画笔能画：拖一条折线 → 出现 1 条 path，状态播报含「1 笔」', async ({ page }) => {
    await openReadingPage(page)

    // 默认是浏览模式：正文可读，但画不了
    await expect(inkBtn(page, '浏览')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.ink-path')).toHaveCount(0)

    await inkBtn(page, '画笔').click()
    await expect(inkBtn(page, '画笔')).toHaveAttribute('aria-pressed', 'true')

    await drawStroke(page, [
      [0.2, 0.3],
      [0.35, 0.3],
      [0.5, 0.32],
    ])

    await expect(page.locator('.ink-path')).toHaveCount(1)
    await expect(page.locator('.ink-status')).toContainText('1 笔')
    await expect(page.locator('.ink-status')).toContainText('画笔模式')

    // path 必须是能画的折线（M + 至少一个 L），而不是一条空指令
    const d = await page.locator('.ink-path').first().getAttribute('d')
    expect(d).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+$/)

    // 线宽用屏幕像素（non-scaling-stroke）：viewBox 是 0..1，没有它这里会变成 0.003 之类的
    await expect(page.locator('.ink-path').first()).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke'
    )
  })

  test('刷新还在：sessionStorage 真的读回来（不是内存态残留）', async ({ page }) => {
    await openReadingPage(page)
    await inkBtn(page, '画笔').click()
    await drawStroke(page, [
      [0.25, 0.4],
      [0.45, 0.42],
      [0.65, 0.4],
    ])
    await expect(page.locator('.ink-path')).toHaveCount(1)
    const before = await page.locator('.ink-path').first().getAttribute('d')

    // 落笔后是**防抖 300ms** 才写盘的，所以先等写盘真的发生再 reload ——
    // 直接 reload 会落在防抖窗口里，丢掉最后一笔（这是刻意的取舍：不留 beforeunload 钩子）。
    const STORAGE_KEY = 'fls:ink:default:read-d4:rt1#0'
    await expect
      .poll(
        async () =>
          page.evaluate((key) => {
            const raw = sessionStorage.getItem(key)
            if (!raw) return 0
            try {
              const parsed = JSON.parse(raw)
              return Array.isArray(parsed) ? parsed.length : -1
            } catch {
              return -1
            }
          }, STORAGE_KEY),
        { timeout: 8_000, message: '划线没有写进 sessionStorage（键或防抖逻辑坏了）' }
      )
      .toBe(1)

    await page.reload()
    await expect(page.locator('.text-body')).toBeVisible()
    await expect(page.locator('.ink-layer')).toHaveCount(1)

    // 组件重建 → 内存里的 strokes 必然清空，还能有 1 条只能是读回来的
    await expect(page.locator('.ink-path')).toHaveCount(1)
    await expect(page.locator('.ink-status')).toContainText('1 笔')
    // 连坐标一起比对：数量对但坐标错位（比如换了个坐标系读）同样算没通过
    expect(await page.locator('.ink-path').first().getAttribute('d')).toBe(before)
  })

  test('浏览模式不没收文本选中；只有画线期间才禁（双向断言）', async ({ page }) => {
    await openReadingPage(page)

    const textBody = page.locator('.text-body')

    // ---------- ① 浏览（默认）：双击能选中文字 ----------
    await page.locator('.text-body p').first().dblclick()
    const browseSelection = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(browseSelection.length).toBeGreaterThan(0)
    // 不是靠"根本没有选区"糊弄过去：选区文本确实来自正文
    expect(await page.locator('.text-body').innerText()).toContain(browseSelection.trim().slice(0, 4))

    // ---------- ② 画笔：拖动期间 user-select 被禁，且拖完不留选区 ----------
    await inkBtn(page, '画笔').click()
    // 先把 ① 留下的选区清掉：否则"拖完还有选区"可能只是旧选区没被折叠，
    // 断言就变成在测另一件事（这也是本用例唯一一处人工干预页面状态）
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

    const box = await layerBox(page)
    const startX = box.x + box.width * 0.2
    const startY = box.y + box.height * 0.5

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 120, startY, { steps: 8 })

    // 按住不放时正文容器的 user-select 必须是 none（这就是"画线期间禁选"的实现承诺）
    const userSelectWhileDrawing = await page.evaluate(() => {
      const el = document.querySelector('.text-body')
      return el ? getComputedStyle(el).userSelect : 'missing'
    })
    expect(userSelectWhileDrawing).toBe('none')

    await page.mouse.move(startX + 240, startY, { steps: 8 })
    await page.mouse.up()

    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    await expect(page.locator('.ink-path')).toHaveCount(1)

    // 抬笔后立刻恢复（否则画完一次就再也选不中字了 —— 同样毁阅读体验）
    const userSelectAfter = await page.evaluate(() => {
      const el = document.querySelector('.text-body')
      return el ? getComputedStyle(el).userSelect : 'missing'
    })
    expect(userSelectAfter).not.toBe('none')
    await expect(textBody).toBeVisible()
  })

  test('橡皮：两条线擦掉一条 → 剩下的是另一条（按路径内容认，不只看数量）', async ({ page }) => {
    await openReadingPage(page)
    await inkBtn(page, '画笔').click()

    await drawStroke(page, [
      [0.2, 0.3],
      [0.35, 0.3],
      [0.5, 0.3],
    ])
    await drawStroke(page, [
      [0.2, 0.62],
      [0.35, 0.62],
      [0.5, 0.62],
    ])
    await expect(page.locator('.ink-path')).toHaveCount(2)

    const ds = await page.locator('.ink-path').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('d') ?? '')
    )
    expect(ds).toHaveLength(2)
    expect(ds[0]).not.toBe(ds[1])
    const survivor = ds[1]

    await inkBtn(page, '橡皮').click()
    await expect(inkBtn(page, '橡皮')).toHaveAttribute('aria-pressed', 'true')

    // 点在第一条线上
    const box = await layerBox(page)
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3)

    await expect(page.locator('.ink-path')).toHaveCount(1)
    await expect(page.locator('.ink-status')).toContainText('1 笔')
    await expect(page.locator('.ink-status')).toContainText('橡皮模式')
    // 活下来的是下面那条 —— 说明擦的是被点中的那条，不是"删最后一条"
    expect(await page.locator('.ink-path').first().getAttribute('d')).toBe(survivor)
  })

  test('清除要二次确认：第一次点击不生效，第二次才清空并落盘', async ({ page }) => {
    await openReadingPage(page)
    await inkBtn(page, '画笔').click()
    await drawStroke(page, [
      [0.25, 0.45],
      [0.5, 0.45],
    ])
    await expect(page.locator('.ink-path')).toHaveCount(1)

    const clearBtn = inkBtn(page, '清除')
    await expect(clearBtn).toHaveAttribute('aria-label', '清除本页全部笔迹')

    // ---------- 第一次点击：只进入确认态，**一笔都不能少** ----------
    await clearBtn.click()
    await expect(clearBtn).toHaveAttribute('aria-label', '确认清除本页全部笔迹')
    await expect(clearBtn).toHaveText('确认清除？')
    await expect(page.locator('.ink-path')).toHaveCount(1)

    // ---------- 第二次点击：真的清空 ----------
    await clearBtn.click()
    await expect(page.locator('.ink-path')).toHaveCount(0)
    await expect(page.locator('.ink-status')).toContainText('0 笔')

    // 清除也要落盘：刷新后不能"复活"
    await page.reload()
    await expect(page.locator('.text-body')).toBeVisible()
    await expect(page.locator('.ink-path')).toHaveCount(0)
  })

  test('工具栏坐在正文上方的预留行里，不压正文（守住"不挡字"的承诺）', async ({ page }) => {
    await openReadingPage(page)

    const toolbar = await page.locator('.ink-toolbar').boundingBox()
    const body = await page.locator('.text-body').boundingBox()
    // 比的是**第一行文字**的盒子，不是 `.text-body` 的盒子 —— 预留的 32px 是 body 的
    // padding，body 的顶边本来就在工具栏上方；拿 body 当参照会把"留白"误判成"压字"。
    const firstLine = await page.locator('.text-body p').first().boundingBox()
    if (!toolbar || !body || !firstLine) throw new Error('工具栏 / 正文 / 首段没有盒子')

    // ① 工具栏整体落在第一行文字之上（允许 1px 亚像素误差）
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(firstLine.y + 1)
    // ② 它确实在正文盒子顶部那块预留留白里，而不是飘到卡片外面去
    expect(toolbar.y).toBeGreaterThanOrEqual(body.y - 1)
    // ③ 工具栏本身要够大能点（不是被压成 0 高）
    expect(toolbar.height).toBeGreaterThan(16)
    // ④ 留白确实存在（32px）：否则上面两条在"没预留"的旧布局下也可能碰巧成立
    expect(firstLine.y - body.y).toBeGreaterThanOrEqual(28)
  })
})
