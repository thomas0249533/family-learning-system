import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * V1.6 · Stage D · D3 —— 练习页键盘交互（Enter / Space / 焦点 / 播报）端到端回归网
 *
 * 背景：`QuizEngine.vue` 原本有一套**半成品**键盘实现（window 级 Space 监听），
 * 它有三个真缺陷，本 spec 每一条都对应一个缺陷：
 *   (a) 无条件 `preventDefault` 写在分支之前 → 焦点在「退出 ✕」/ 题号导航 /
 *       判断题 T/F 按钮 / 自评按钮 / naive Radio 上时，空格无法激活它们；
 *   (b) `TopicDetail` 会同时挂两个引擎（热身 + 同步练习）→ window 监听无法区分
 *       实例，一次空格推进两个引擎；
 *   (c) 填空题已交卷后 `onInputEnter` 是死分支 → "再按一次回车进下一题"走不通。
 *
 * 数据播种复用 `learning-flow.spec.ts` 的套路（真实导入向导，不塞库），
 * 但本 spec 需要 single / blank / judge 三种题型 + 一个前置知识点，
 * 用 `tests/fixtures/` 里现成的两个迷你包拼不出来，所以就地生成一份 JSON
 * 直接喂给 `setInputFiles`（Playwright 支持 `{name, mimeType, buffer}`，不落盘）。
 */

const PACKAGE_ID = 'kb-mini-e2e'

/** 本 spec 专用的迷你包：单选主题 / 填空主题 / 判断主题 + 1 个前置知识点 */
function buildPackage(): string {
  const kp = (id: string) => `${PACKAGE_ID}::${id}`
  return JSON.stringify({
    manifest: {
      schemaVersion: '1.0',
      packageId: PACKAGE_ID,
      type: 'unit',
      subject: 'math',
      grade: 4,
      term: 'up',
      edition: '人教版',
      title: 'E2E 键盘交互包',
      subtitle: 'D3 键盘交互的固定测试数据',
      isInternal: false,
      author: 'tests/e2e',
    },
    knowledgePoints: [
      {
        id: kp('kp0'),
        type: 'concept',
        title: '前置：一位数加法',
        content: '加法就是把两个数合起来。',
        prerequisites: [],
      },
      {
        id: kp('kp1'),
        type: 'concept',
        title: '两位数乘一位数',
        content: '把两位数拆成整十数与个位数，分别与一位数相乘后相加。',
        // 故意留一个未掌握的前置 → 专题页会出现「前置热身」入口（用例 6 要用）
        prerequisites: [kp('kp0')],
      },
    ],
    // 顶层 exercises 只进"全局题池"：TopicDetail 的前置热身题从池子里捞，
    // 所以这两道题不属于任何 topic，不会出现在同步练习里。
    exercises: [
      {
        id: 'kb-warm-001',
        type: 'single',
        question: '3 + 4 = ?',
        options: ['A. 7', 'B. 6', 'C. 8', 'D. 9'],
        answer: 'A',
        explanation: '3 + 4 = 7。',
        knowledgePointIds: [kp('kp0')],
      },
      {
        id: 'kb-warm-002',
        type: 'single',
        question: '2 + 5 = ?',
        options: ['A. 6', 'B. 7', 'C. 8', 'D. 9'],
        answer: 'B',
        explanation: '2 + 5 = 7。',
        knowledgePointIds: [kp('kp0')],
      },
    ],
    units: [
      {
        id: `${PACKAGE_ID}::u1`,
        name: '第一单元',
        title: '第一单元 键盘',
        desc: '三种题型的键盘交互样本',
        topics: [
          {
            id: `${PACKAGE_ID}::t1`,
            title: '主题一：单选题',
            knowledgePointIds: [kp('kp1')],
            modules: [],
            exercises: [
              {
                id: 'kb-001',
                type: 'single',
                question: '12 × 3 = ?',
                options: ['A. 36', 'B. 33', 'C. 26', 'D. 63'],
                answer: 'A',
                explanation: '12 × 3 = 36。',
                knowledgePointIds: [kp('kp1')],
              },
              {
                id: 'kb-002',
                type: 'single',
                question: '23 × 2 = ?',
                options: ['A. 26', 'B. 46', 'C. 56', 'D. 43'],
                answer: 'B',
                explanation: '20 × 2 = 40，3 × 2 = 6，合计 46。',
                knowledgePointIds: [kp('kp1')],
              },
            ],
          },
          {
            id: `${PACKAGE_ID}::t2`,
            title: '主题二：填空题',
            knowledgePointIds: [kp('kp1')],
            modules: [],
            exercises: [
              {
                id: 'kb-003',
                type: 'blank',
                question: '5 × 6 = ?',
                answer: '30',
                explanation: '五六三十。',
                knowledgePointIds: [kp('kp1')],
              },
              {
                id: 'kb-004',
                type: 'blank',
                question: '7 × 8 = ?',
                answer: '56',
                explanation: '七八五十六。',
                knowledgePointIds: [kp('kp1')],
              },
            ],
          },
          {
            id: `${PACKAGE_ID}::t3`,
            title: '主题三：判断题',
            knowledgePointIds: [kp('kp1')],
            modules: [],
            exercises: [
              {
                id: 'kb-005',
                type: 'judge',
                question: '地球绕着太阳转。',
                answer: '对',
                explanation: '日心说，地球绕太阳公转。',
                knowledgePointIds: [kp('kp1')],
              },
              {
                id: 'kb-006',
                type: 'single',
                question: '9 × 9 = ?',
                options: ['A. 81', 'B. 18', 'C. 99', 'D. 72'],
                answer: 'A',
                explanation: '九九八十一。',
                knowledgePointIds: [kp('kp1')],
              },
            ],
          },
        ],
      },
    ],
  })
}

/** 清库：保证用例之间零残留（照抄 learning-flow，必须在 goto 之后调用） */
async function resetDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('FamilyLearningDB')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })
  await page.reload()
}

/** 走真实导入向导导入上面那份包（不塞库、不 mock） */
async function importKeyboardPackage(page: Page): Promise<void> {
  await page.goto('/settings/import')
  await expect(page.getByText('导入学习包').first()).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'keyboard-unit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(buildPackage(), 'utf8'),
  })

  await expect(page.getByText('确认学习包信息')).toBeVisible()
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('学习包导入成功')).toBeVisible({ timeout: 15_000 })
}

/** 播种 + 直达某个专题（路由与 TopicDetail.goToPrerequisite 用的是同一套 URL） */
async function seedAndOpenTopic(page: Page, topicId: 't1' | 't2' | 't3'): Promise<void> {
  await page.goto('/home')
  await resetDb(page)
  await importKeyboardPackage(page)
  await page.goto(`/learn/${PACKAGE_ID}/unit/u1/topic/${topicId}`)
  await expect(page.locator('.quiz-engine').first()).toBeVisible()
}

/** 在某个引擎里选中某个选项（选项文案形如 `A. 36`）；scope 可以是 page 也可以是某个引擎 */
async function chooseOption(scope: Page | Locator, letter: string): Promise<void> {
  await scope.locator('.opt-item').filter({ hasText: `${letter}.` }).first().click()
}

/** 当前焦点落在哪里（用于断言"焦点没掉到 body"） */
async function activeElementInfo(page: Page): Promise<{ tag: string; className: string; insideEngine: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      tag: el?.tagName ?? 'null',
      className: typeof el?.className === 'string' ? el.className : '',
      insideEngine: !!el && !!el.closest('.quiz-engine'),
    }
  })
}

test.describe('练习页键盘交互（Enter / Space / 焦点 / 播报）', () => {
  test('① 单选：回车提交 → 回复出现解析 → 再回车进入下一题', async ({ page }) => {
    await seedAndOpenTopic(page, 't1')
    await expect(page.locator('.question-text')).toContainText('12 × 3')

    await chooseOption(page, 'A')
    // 点选项后焦点在隐藏的 radio input 上（实测 activeElement = INPUT.n-radio-input）。
    // radio 上 Enter 没有原生语义，所以这一下由引擎接管 —— 这是"点选项 → 回车提交"的关键。
    await page.keyboard.press('Enter')

    const feedback = page.locator('.feedback-box')
    await expect(feedback).toBeVisible()
    await expect(feedback.locator('.correct-answer')).toContainText('正确答案：A')
    await expect(feedback.locator('.explanation')).toContainText('12 × 3 = 36')

    // 交卷后焦点已被送到"下一题"按钮，回车即原生激活 → 进入第 2 题
    await page.keyboard.press('Enter')
    await expect(page.locator('.question-text')).toContainText('23 × 2')
    await expect(page.locator('.progress-text').first()).toContainText('第 2 / 2 题')
  })

  test('② 单选：空格也能提交（焦点在容器上时）', async ({ page }) => {
    await seedAndOpenTopic(page, 't1')
    await chooseOption(page, 'A')

    // 为什么先把焦点放回容器：Space 在 radio / 按钮 / 输入框上必须**让路**
    // （那是控件的原生激活键，缺陷 (a) 就是缺了这一步）。所以"空格提交"只在
    // 焦点落在容器（或页面空白区）时成立 —— 挂载后组件自己就是这么聚焦的
    // （onMounted → rootRef.focus），这里显式还原同一状态。
    await page.locator('.quiz-engine').first().focus()

    await page.keyboard.press('Space')
    await expect(page.locator('.feedback-box')).toBeVisible()
    await expect(page.locator('.feedback-box .correct-answer')).toContainText('正确答案：A')
  })

  test('③ 空格不吞按钮：判断题 T 按钮被空格激活，且没有触发提交', async ({ page }) => {
    await seedAndOpenTopic(page, 't3')
    await expect(page.locator('.question-text')).toContainText('地球绕着太阳转')

    const trueBtn = page.locator('.judge-group button').first()
    await expect(trueBtn).toContainText('对')

    // press = 先聚焦再按键，等价于键盘用户 Tab 到按钮后按空格
    await trueBtn.press('Space')

    // 按钮真的被激活了：naive 选中态是 type=success
    await expect(trueBtn).toHaveClass(/success/)
    // 而且**没有**被当成"提交"：解析不该出现
    await expect(page.locator('.feedback-box')).toHaveCount(0)
  })

  test('④ 输入框里的空格照常输入，不会被当成提交', async ({ page }) => {
    await seedAndOpenTopic(page, 't2')
    await expect(page.locator('.question-text')).toContainText('5 × 6')

    const input = page.locator('.fill-blank input').first()
    await input.click()
    await input.pressSequentially('30 ', { delay: 20 })

    await expect(input).toHaveValue('30 ')
    await expect(page.locator('.feedback-box')).toHaveCount(0)
  })

  test('⑤ 填空：回车提交 → 再回车进入下一题（补缺陷 (c)）', async ({ page }) => {
    await seedAndOpenTopic(page, 't2')
    await expect(page.locator('.question-text')).toContainText('5 × 6')

    const input = page.locator('.fill-blank input').first()
    await input.click()
    await input.pressSequentially('30', { delay: 20 })

    await input.press('Enter')
    await expect(page.locator('.feedback-box')).toBeVisible()
    await expect(page.locator('.feedback-box .correct-answer')).toContainText('正确答案：30')

    // 旧实现在这里什么都不做（`canSubmit && !showFeedback` 是死分支）
    await page.keyboard.press('Enter')
    await expect(page.locator('.question-text')).toContainText('7 × 8')
  })

  test('⑥ 一次按键只推进一个引擎（两个 QuizEngine 同时挂载，补缺陷 (b)）', async ({ page }) => {
    await seedAndOpenTopic(page, 't1')

    // 有未掌握的前置知识点 → 专题页出现「前置热身」入口
    await page.getByRole('button', { name: /先做 2 道前置热身/ }).click()

    const engines = page.locator('.quiz-engine')
    await expect(engines).toHaveCount(2)

    const warmup = page.locator('.warmup-card .quiz-engine')
    const main = engines.nth(1)
    await expect(warmup.locator('.question-text')).toContainText('3 + 4')
    await expect(main.locator('.question-text')).toContainText('12 × 3')

    // 两个引擎都选好答案：这样"一次按键被两个实例同时处理"才有可观察的后果
    await chooseOption(warmup, 'A')
    await chooseOption(main, 'A')

    // 焦点放回热身引擎的容器，按一次空格
    await warmup.focus()
    await page.keyboard.press('Space')

    // 关键断言：全页只出现 1 个解析框（旧实现的 window 监听会让两个引擎都提交 → 2 个）
    await expect(page.locator('.feedback-box')).toHaveCount(1)
    await expect(warmup.locator('.feedback-box')).toBeVisible()
    await expect(main.locator('.feedback-box')).toHaveCount(0)

    // 再按一次空格（这次焦点在热身引擎新出现的"下一题"按钮上）→ 只推进热身引擎
    await page.keyboard.press('Space')
    await expect(warmup.locator('.progress-text').first()).toContainText('第 2 / 2 题')
    await expect(main.locator('.progress-text').first()).toContainText('第 1 / 2 题')
    await expect(main.locator('.feedback-box')).toHaveCount(0)
  })

  test('⑦ 交卷后焦点不掉到 body（仍在本引擎内）', async ({ page }) => {
    await seedAndOpenTopic(page, 't1')
    await chooseOption(page, 'A')

    // 走"鼠标点按钮"这条最普通的路径：旧实现里按钮被 v-else 销毁 → 焦点掉 body
    await page.getByRole('button', { name: '提交答案' }).click()
    await expect(page.locator('.feedback-box')).toBeVisible()

    const info = await activeElementInfo(page)
    expect(info.insideEngine).toBe(true)
    expect(info.tag).not.toBe('BODY')
    // 落点是新出现的"下一题"按钮（交卷后的主操作）
    expect(info.tag).toBe('BUTTON')
    await expect(page.getByRole('button', { name: /下一题/ })).toBeFocused()
  })

  test('⑧ 解析播报：live region 常驻且含判定与正确答案', async ({ page }) => {
    await seedAndOpenTopic(page, 't1')
    await chooseOption(page, 'B') // 故意选错（正确答案是 A）

    await page.getByRole('button', { name: '提交答案' }).click()

    const live = page.locator('[aria-live="polite"]')
    await expect(live).toHaveCount(1)
    await expect(live).toHaveAttribute('aria-atomic', 'true')
    await expect(live).toContainText('回答错误')
    await expect(live).toContainText('正确答案：A')

    // live region 必须是"常驻节点"：解析消失后容器仍在 DOM 里
    // （v-if 挂在外层的话，节点新生时读屏器不播报）
    await page.keyboard.press('Enter') // 焦点在"下一题"按钮上 → 进入第 2 题
    await expect(page.locator('.question-text')).toContainText('23 × 2')
    await expect(page.locator('.feedback-box')).toHaveCount(0)
    await expect(live).toHaveCount(1)
  })
})
