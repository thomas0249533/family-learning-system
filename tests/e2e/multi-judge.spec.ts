import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 多陈述判断题 · 端到端验证（批 7）
 *
 * 单测（tests/judge.test.ts）覆盖的是 `@core/quiz/judge` 纯函数；
 * 但**模板渲染与交互接线**只能靠浏览器验证 —— 本机无 @vue/test-utils/jsdom，
 * SFC 挂载类测试做不了。
 *
 * 做法：把真实内容里的一道多陈述判断题（`special-ex-006`，answer = ["F","T","F","T"]）
 * 直接读出来塞进 IndexedDB（window.db，main.ts 已暴露），再深链进 TopicDetail。
 * 用**真内容**而非手写 fixture，避免 fixture 与真实形状脱节导致假绿。
 */

const SRC = resolve(process.cwd(), 'content/english-7-up-rjb/special-english-7-up-youandme.json')

function findMultiJudge(node: any, out: any[] = []) {
  if (Array.isArray(node)) node.forEach((v) => findMultiJudge(v, out))
  else if (node && typeof node === 'object') {
    if (node.type === 'judge' && Array.isArray(node.answer)) out.push(node)
    Object.values(node).forEach((v) => findMultiJudge(v, out))
  }
  return out
}

const raw = JSON.parse(readFileSync(SRC, 'utf-8'))
const multi = findMultiJudge(raw)
const QUESTION = multi[0]
const ANSWER: string[] = QUESTION.answer

const PKG = {
  // Dexie 主键是**顶层** packageId（见 LearningPackageRecord），不能只写在 manifest 里
  packageId: 'e2e-multi-judge',
  exercises: [],
  manifest: {
    packageId: 'e2e-multi-judge',
    type: 'special',
    title: '多陈述判断题（e2e）',
    dependencies: [], // 必须为空：非空会被当成聚合包
    schemaVersion: '1.0',
    subject: 'english',
    grade: 7,
    term: 'up',
    examMode: false,
    sourceUnitIds: [],
  },
  knowledgePoints: [{ id: 'kp-e2e-1', name: 'e2e 知识点' }],
  units: [
    {
      id: 'u1',
      name: '单元一',
      title: '单元一',
      topics: [
        {
          id: 't1',
          title: '多陈述专题',
          knowledgePointIds: ['kp-e2e-1'],
          modules: [],
          exercises: [QUESTION],
        },
      ],
    },
  ],
}

/** answer 元素 → 该点哪个按钮：T 是第 1 个（✅），F 是第 2 个（❌） */
const buttonIndexFor = (v: string) => (String(v).trim().toUpperCase() === 'T' ? 0 : 1)

async function seed(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.evaluate(async (pkg) => {
    await (window as any).db.packages.put(JSON.parse(JSON.stringify(pkg)))
  }, PKG)
  await page.goto('/learn/e2e-multi-judge/unit/u1/topic/t1')
  await page.waitForSelector('.judge-stmt', { timeout: 15000 })
}

test.beforeAll(() => {
  if (!QUESTION) throw new Error('未能在内容中找到多陈述判断题 —— 本测试形同虚设')
})

test('渲染：逐句列出陈述 + 按钮文案按 options 显示 T/F', async ({ page }) => {
  await seed(page)

  const stmts = page.locator('.judge-stmt')
  await expect(stmts).toHaveCount(ANSWER.length)

  // 按钮文案来自 options:["T","F"]，不是硬编码的「对/错」
  const first = stmts.first().locator('button')
  await expect(first.nth(0)).toContainText('T')
  await expect(first.nth(1)).toContainText('F')

  // 陈述句不含 (1) 这类编号残留
  const text0 = await stmts.first().locator('.judge-stmt__text').innerText()
  expect(text0).not.toMatch(/^\(?\d+\)?/)
})

test('全对 → 判为正确（修复前这里 100% 判错）', async ({ page }) => {
  await seed(page)

  for (let i = 0; i < ANSWER.length; i++) {
    await page.locator('.judge-stmt').nth(i).locator('button').nth(buttonIndexFor(ANSWER[i])).click()
  }

  await page.locator('.quiz-actions button').first().click()
  await expect(page.locator('.feedback-box.correct')).toBeVisible()
})

test('错一句 → 判为错误（全或无，不做部分给分）', async ({ page }) => {
  await seed(page)

  for (let i = 0; i < ANSWER.length; i++) {
    // 故意把第 1 句选反
    const v = i === 0 ? (ANSWER[i].toUpperCase() === 'T' ? 'F' : 'T') : ANSWER[i]
    await page.locator('.judge-stmt').nth(i).locator('button').nth(buttonIndexFor(v)).click()
  }

  await page.locator('.quiz-actions button').first().click()
  await expect(page.locator('.feedback-box.wrong')).toBeVisible()
})

test('漏答 → 不允许提交', async ({ page }) => {
  await seed(page)

  // 只答第一句
  await page.locator('.judge-stmt').nth(0).locator('button').nth(buttonIndexFor(ANSWER[0])).click()

  await expect(page.locator('.quiz-actions button').first()).toBeDisabled()
})
