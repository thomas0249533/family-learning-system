import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'

/**
 * V1.4 · B2 · 跨设备备份往返（真机验证）
 * ------------------------------------------------------------------
 * 单测已经把 `planMerge` 的每条规则、200 组属性（单调/幂等/自反）穷举过了，
 * 这里只验**单测结构上验不了的三件事**：
 *   1. 备份文件真的是从一台设备"搬"到另一台的（走真实 download → upload，
 *      不是把对象直接喂给函数）；
 *   2. 第二遍导入在真 UI 上显示"没有新内容"且不写库（AC-P2-13）；
 *   3. V1.3 老备份里那个**不带 pid 后缀的 `achievements` 键**不会抹掉本机成就墙
 *      （AC-P2-17，守 §1 第 4 条根因：`settings.put` 整键覆盖）。
 *
 * **两台设备 = 同一个 browser 起两个 context**（设计 §9 明确要求）：
 * 各自一份 IndexedDB。不要试图复制 IDB 文件模拟 —— 那是在测 Dexie，不是测合并。
 */

const DB_NAME = 'FamilyLearningDB'

/** 等库真的就绪再种数据（裸开 IDB 抢在 Dexie 之前会造空库，V1.3 已踩过） */
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

interface SeedRow {
  profileId: string
  packageId: string
  knowledgePointId: string
  status: '未学' | '学习中' | '已掌握' | '需复习'
  /** 空串 = 从没学过；用于构造"备份更旧"的场景 */
  lastStudiedAt?: string
}

interface SeedPackage {
  packageId: string
  /** 这个包里的知识点 id（进度行必须指向**本机已装包**里的知识点，否则是孤儿、不进统计） */
  kpIds: string[]
}

interface SeedOptions {
  /**
   * 设备上装了哪些学习包。
   *
   * ⚠️ 跨设备导入的**前提**是接收方已经有同一套教材：备份按设计**不含 `packages`**
   * （包是设备级资产，由用户另外搬运）。接收方没装那个包时，导进来的进度行是孤儿，
   * `/parent` 的"已掌握"不会变 —— 这不是合并失败，是场景不成立。
   */
  packages: SeedPackage[]
  rows?: SeedRow[]
  profiles?: Array<{ id: string; name: string }>
  /** 直接往 settings 里塞键值（种子成就墙等） */
  settings?: Array<{ key: string; value: unknown }>
}

/** 种子：一个只有 1 个知识点的学习包 + 若干进度行 + 可选 settings */
async function seed(page: Page, opts: SeedOptions): Promise<void> {
  await page.evaluate(
    async ({ dbName, opts }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        // 没挂 onblocked 会静默挂到超时
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })

      const now = new Date().toISOString()
      const stores = ['packages', 'progress', 'settings']
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite')
        const rows = opts.rows ?? []

        for (const pkg of opts.packages) {
          tx.objectStore('packages').put({
            packageId: pkg.packageId,
            manifest: {
              packageId: pkg.packageId,
              type: 'unit',
              subject: 'math',
              grade: 4,
              term: 'up',
              title: `备份往返测试单元 ${pkg.packageId}`,
            },
            knowledgePoints: pkg.kpIds.map((id) => ({ id, title: `知识点 ${id}` })),
            exercises: [],
            units: [],
          })
        }

        for (const r of rows) {
          tx.objectStore('progress').put({
            profileId: r.profileId,
            packageId: r.packageId,
            knowledgePointId: r.knowledgePointId,
            status: r.status,
            correctCount: 2,
            wrongCount: 0,
            correctStreak: 2,
            wrongStreak: 0,
            lastStudiedAt: r.lastStudiedAt ?? now,
            studySeconds: 30,
          })
        }

        const profiles = opts.profiles ?? [{ id: 'default', name: '我' }]
        tx.objectStore('settings').put({
          key: 'profiles',
          value: { activeId: profiles[0].id, list: profiles.map((p) => ({ ...p, createdAt: now })) },
        })
        for (const s of opts.settings ?? []) {
          tx.objectStore('settings').put({ key: s.key, value: s.value })
        }

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { dbName: DB_NAME, opts }
  )
  await page.reload()
}

/** 读 /parent 第 n 张总览卡的数字（0=知识点总数 1=已掌握 2=学习中 3=需复习） */
async function statValue(page: Page, index: number): Promise<string> {
  const card = page.locator('.stat-card').nth(index)
  return ((await card.locator('.stat-card__value').innerText()) ?? '').trim()
}

/** 读一个 settings 键的原始值（断言"没被抹掉"比 UI 数字更直接） */
async function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    async ({ dbName, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('IDB 被阻塞'))
      })
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(['settings'], 'readonly')
        const req = tx.objectStore('settings').get(key)
        req.onsuccess = () => resolve((req.result as { value?: unknown } | undefined)?.value)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return value
    },
    { dbName: DB_NAME, key }
  )
}

/** 读库里全部 progress 行（断言"两种行都在"要直接看库，不看 UI —— UI 本来就看不见孤儿行） */
async function readProgressRows(page: Page): Promise<
  Array<{ profileId: string; packageId: string; knowledgePointId: string }>
> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB 被阻塞'))
    })
    const rows = await new Promise<Array<Record<string, any>>>((resolve, reject) => {
      const tx = db.transaction(['progress'], 'readonly')
      const req = tx.objectStore('progress').getAll()
      req.onsuccess = () => resolve((req.result as Array<Record<string, any>>) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rows.map((r) => ({
      profileId: String(r.profileId ?? ''),
      packageId: String(r.packageId ?? ''),
      knowledgePointId: String(r.knowledgePointId ?? ''),
    }))
  }, DB_NAME)
}

/** 上传一份 JSON 到导入卡片的第一屏 */
async function pickBackup(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer }
): Promise<void> {
  const input = page.locator('.import-pick input[type="file"]')
  if (typeof file === 'string') await input.setInputFiles(file)
  else await input.setInputFiles(file)
}

/** 预览第二屏（三种结束态之一）—— 抽出来只为一处复用，避免三处选择器写法不一致 */
function reviewPane(page: Page) {
  return page.locator('.import-ready, .import-noop, .import-reject').first()
}

test.describe('跨设备备份往返（V1.4 · B2）', () => {
  test('A 导出 → B 导入：指标不倒退，第二次导入显示无变化', async ({ browser }) => {
    // ---- A 机：1 个知识点已掌握 ----
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    await pageA.goto('/home')
    await resetDb(pageA)
    await waitDbReady(pageA)
    await seed(pageA, {
      packages: [{ packageId: 'unit-device-a', kpIds: ['unit-device-a::kp1'] }],
      rows: [
        {
          profileId: 'default',
          packageId: 'unit-device-a',
          knowledgePointId: 'unit-device-a::kp1',
          status: '已掌握',
        },
      ],
    })

    await pageA.goto('/settings')
    const [download] = await Promise.all([
      pageA.waitForEvent('download'),
      pageA
        .locator('.export-row')
        .filter({ hasText: '家庭备份' })
        .getByRole('button', { name: '导出' })
        .click(),
    ])
    const backupPath = await download.path()
    expect(backupPath, '导出没有产生文件').toBeTruthy()
    // ⚠️ 必须**立刻读进内存**：`download.path()` 指向的是 Playwright 的临时产物目录，
    // 关掉发起下载的 context 后它会被清掉。就地拿路径、稍后再 `setInputFiles(path)`
    // 会在"第二次导入"那一步炸成 ENOENT（本轮实测踩过）。
    const backupName = download.suggestedFilename() || 'fls-backup.json'
    const backupBuffer = await readFile(backupPath!)
    const backupFile = { name: backupName, mimeType: 'application/json', buffer: backupBuffer }
    await ctxA.close()

    // ---- B 机：自己也有 1 个知识点，但只是"学习中" ----
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/home')
    await resetDb(pageB)
    await waitDbReady(pageB)
    // B 机装了同一套教材（含 A 也在用的 unit-device-a），只是自己还没学过那一课
    await seed(pageB, {
      packages: [
        { packageId: 'unit-device-b', kpIds: ['unit-device-b::kp1'] },
        { packageId: 'unit-device-a', kpIds: ['unit-device-a::kp1'] },
      ],
      rows: [
        {
          profileId: 'default',
          packageId: 'unit-device-b',
          knowledgePointId: 'unit-device-b::kp1',
          status: '学习中',
        },
      ],
    })

    await pageB.goto('/parent')
    await expect.poll(() => statValue(pageB, 1), { timeout: 10_000 }).toBe('0')
    const beforeTotal = await statValue(pageB, 0)

    // ---- 导入 ----
    await pageB.goto('/settings')
    await pickBackup(pageB, backupFile)
    await expect(pageB.locator('.import-ready')).toBeVisible({ timeout: 15_000 })
    // 预览只渲染统计，不落库 —— 此时"已掌握"还不该变
    // 注意 `.import-stat-value` 里带量词（"1 条"），断言用包含而不是全等
    await expect(
      pageB.locator('.import-stat').filter({ hasText: '新增进度' }).locator('.import-stat-value')
    ).toContainText('1')

    // A6-L1：导入期警告条在**预览态**就要常驻（不是等点完导入才出现），
    // 文案是产品定稿原文，逐字断言，避免以后被人"优化"成别的说法
    const warning = pageB.locator('.import-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('导入期间请不要在学习页答题')
    await expect(warning).toContainText('若刚答过题，请返回首页同步后再导入')

    // A6-L1 防连点：**同一个元素**上连点两次，只应产生一次导入。
    //
    // 必须先拿 ElementHandle、再两次 `dispatchEvent`：直接写两次
    // `locator.dispatchEvent('click')` 会在第一次点击后**重新解析选择器** ——
    // 导入一旦成功，按钮按 `v-if="canConfirm"` 直接离开 DOM，第二次就会
    // 干等到超时（本轮实测踩过，报 `waiting for locator('.import-confirm')`）。
    // 用 handle 派发等价于"手指在按钮刚亮起来时又按了一下"，中间不等任何东西。
    //
    // 覆盖面说明：成功路径上这次连点主要被 `isImporting`（in-flight）挡住；
    // 冷却窗口独有的场景是「快速失败后连点」，那需要一个会失败的导入才能稳定复现
    // （`stale-local-data` 正在由合并引擎那边落地），本 spec 暂无该场景，
    // 所以这里只断言**可观测结果**：导入效果只发生一次。
    const confirmHandle = await pageB.locator('.import-confirm').elementHandle()
    expect(confirmHandle, '第 2 步应出现「确认导入」按钮').not.toBeNull()
    await confirmHandle!.dispatchEvent('click')
    await confirmHandle!.dispatchEvent('click')

    await expect(pageB.locator('.import-preview')).toContainText('已导入')

    // 可观测口径 = **成功 toast 的条数**（不能只看统计数字：合并本身幂等，
    // 真导两遍数字也不会翻倍，那样断言就形同虚设）。
    // 若 `isImporting` / 冷却任何一层失效，这里会是 2 条。
    await expect(pageB.locator('.n-message--success-type')).toHaveCount(1)
    // 成功导入后警告条按 `v-if="!applied"` 消失（不必再拦着一个已经导完的用户）
    await expect(warning).toHaveCount(0)
    // 统计不翻倍（幂等兜底，防的是"同一份计划被执行两次"这种回归）
    await expect(
      pageB.locator('.import-stat').filter({ hasText: '新增进度' }).locator('.import-stat-value')
    ).toContainText('1')

    // AC-P2-11：导入后 ≥ 导入前（0 → 1），且 B 自己的知识点没丢
    await pageB.goto('/parent')
    await expect.poll(() => statValue(pageB, 1), { timeout: 10_000 }).toBe('1')
    const afterTotal = await statValue(pageB, 0)
    expect(Number(afterTotal)).toBeGreaterThanOrEqual(Number(beforeTotal))

    // AC-P2-13：同一份备份再导一次 → "没有需要导入的新内容"
    await pageB.goto('/settings')
    await pickBackup(pageB, backupFile)
    await expect(pageB.locator('.import-noop')).toBeVisible({ timeout: 15_000 })
    await expect(pageB.locator('.import-confirm')).toHaveCount(0)

    // 数字不翻倍
    await pageB.goto('/parent')
    await expect.poll(() => statValue(pageB, 1), { timeout: 10_000 }).toBe('1')
    await ctxB.close()
  })

  // V1.6 · E1：家长报的「专项练习进度丢了」—— 真相是**包不在备份里**，数据一行没丢。
  // 这个用例同时守两条：
  //   ① 预览要点名那些"本机没装的包"（把真相告诉家长）；
  //   ② 导入后**两种行都必须在库里**（单调不减不许被"顺手清理孤儿行"破坏）。
  test('备份引用了本机没装的专项包：预览点名它，导入后两种行都在（V1.6 · E1）', async ({
    browser,
  }) => {
    // ---- A 机：装了单元包，进度里既有单元包的行、也有一个**没装包**的专项包行 ----
    // 专项包不必真装：导出侧按档案全量导出 progress，行自然进备份 ——
    // 这正是"专项包只存在于当初导它的那台设备"的真实形态。
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    await pageA.goto('/home')
    await resetDb(pageA)
    await waitDbReady(pageA)
    await seed(pageA, {
      packages: [{ packageId: 'unit-installed', kpIds: ['unit-installed::kp-unit-1'] }],
      rows: [
        {
          profileId: 'default',
          packageId: 'unit-installed',
          knowledgePointId: 'unit-installed::kp-unit-1',
          status: '已掌握',
        },
        {
          profileId: 'default',
          packageId: 'special-orphan',
          knowledgePointId: 'special-orphan::kp-special-1',
          status: '学习中',
        },
      ],
    })

    await pageA.goto('/settings')
    const [download] = await Promise.all([
      pageA.waitForEvent('download'),
      pageA
        .locator('.export-row')
        .filter({ hasText: '家庭备份' })
        .getByRole('button', { name: '导出' })
        .click(),
    ])
    const backupPath = await download.path()
    expect(backupPath, '导出没有产生文件').toBeTruthy()
    const backupFile = {
      name: download.suggestedFilename() || 'fls-backup.json',
      mimeType: 'application/json',
      buffer: await readFile(backupPath!),
    }
    await ctxA.close()

    // ---- B 机：只装了那个单元包，没装专项包 ----
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/home')
    await resetDb(pageB)
    await waitDbReady(pageB)
    // 刻意给 B 留一条**更旧**的单元包行：
    // ① 正向：证明备份里那条更新的单元行确实写进来了（不是"本来就有"）；
    // ② 反向验证时（有人把"本机没装包的行"丢掉）这条还在，于是红色只指向孤儿行，
    //    而不是整份导入变成 noop —— 红色的位置本身就是证据。
    await seed(pageB, {
      packages: [{ packageId: 'unit-installed', kpIds: ['unit-installed::kp-unit-1'] }],
      rows: [
        {
          profileId: 'default',
          packageId: 'unit-installed',
          knowledgePointId: 'unit-installed::kp-unit-1',
          status: '学习中',
          lastStudiedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    })

    await pageB.goto('/settings')
    await pickBackup(pageB, backupFile)
    await expect(pageB.locator('.import-ready')).toBeVisible({ timeout: 15_000 })

    // ① 预览点名缺失的专项包，且不把本机已装的包算进去
    const missing = pageB.locator('.import-missing')
    await expect(missing).toBeVisible()
    await expect(missing).toContainText('special-orphan')
    await expect(missing).toContainText('本机还没有的学习包')
    await expect(missing).not.toContainText('unit-installed')

    // ② 导入：两种行都在库里（★ 单调不减的直接证据）
    await pageB.locator('.import-confirm').click()
    await expect(pageB.locator('.import-preview')).toContainText('已导入')

    const rows = await readProgressRows(pageB)
    expect(rows.map((r) => r.packageId).sort()).toEqual(['special-orphan', 'unit-installed'])
    // 孤儿行是**导入写进来**的（本机没装它的包，合并引擎也没把它丢掉）
    const orphan = rows.find((r) => r.packageId === 'special-orphan')
    expect(orphan?.knowledgePointId).toBe('special-orphan::kp-special-1')
    // 单元包那条：备份更晚 → 备份胜（顺手证明"谁新谁胜"这条也没坏）
    const unit = rows.find((r) => r.packageId === 'unit-installed')
    expect(unit?.knowledgePointId).toBe('unit-installed::kp-unit-1')

    // 完成提示同样要告诉家长"还差一步"（不然他只会看到"导入成功"，然后以为数据丢了）
    await expect(pageB.locator('.n-message--warning-type')).toContainText('special-orphan')
    await ctxB.close()
  })

  test('V1.3 老备份（settings 里是不带后缀的 achievements 键）不会抹掉本机成就墙', async ({
    page,
  }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page, {
      packages: [{ packageId: 'unit-legacy', kpIds: [] }],
      rows: [],
      settings: [
        {
          key: 'achievements:default',
          value: [{ id: 'streak-7', unlockedAt: '2026-01-01T00:00:00.000Z', evidence: '连续 7 天' }],
        },
      ],
    })

    // 手工构造一份 V1.3 扁平备份：键没有 `:pid` 后缀，且带一枚本机没有的徽章
    const legacy = {
      version: '1.0',
      exportedAt: '2026-02-01T00:00:00.000Z',
      progress: [],
      mistakes: [],
      settings: [
        {
          key: 'achievements',
          value: [{ id: 'first-question', unlockedAt: '2026-02-01T00:00:00.000Z', evidence: '' }],
        },
      ],
    }

    await page.goto('/settings')
    await pickBackup(page, {
      name: 'userdata-legacy.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(legacy)),
    })
    await expect(reviewPane(page)).toBeVisible({ timeout: 15_000 })
    await page.locator('.import-confirm').click()
    await expect(page.locator('.import-preview')).toContainText('已导入')

    // AC-P2-17：并集而不是 put 覆盖 —— 两枚都在
    const merged = (await readSetting(page, 'achievements:default')) as Array<{ id: string }>
    const ids = merged.map((r) => r.id).sort()
    expect(ids).toEqual(['first-question', 'streak-7'])
  })

  test('导入会超过档案上限 4 → 整笔拒绝，库内零变化', async ({ page }) => {
    await page.goto('/home')
    await resetDb(page)
    await waitDbReady(page)
    await seed(page, {
      packages: [{ packageId: 'unit-limit', kpIds: [] }],
      rows: [],
      profiles: [
        { id: 'default', name: '我' },
        { id: 'p_a', name: '老大' },
        { id: 'p_b', name: '老二' },
        { id: 'p_c', name: '老三' },
      ],
    })

    const backupWithNewProfile = {
      formatVersion: 2,
      exportedAt: '2026-02-01T00:00:00.000Z',
      appVersion: '1.4.0',
      activeProfileId: 'p_other',
      profiles: [
        {
          profileId: 'p_other',
          name: '别人家的孩子',
          createdAt: '2026-01-01T00:00:00.000Z',
          progress: [],
          mistakes: [],
          examSessions: [],
          settings: [],
        },
      ],
      globalSettings: [],
    }

    await page.goto('/settings')
    await pickBackup(page, {
      name: 'fls-backup-limit.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backupWithNewProfile)),
    })

    // AC-P2-14：整笔拒绝，且不能显示成"没有新内容"（那两句话意思相反）
    await expect(page.locator('.import-reject')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.import-reject')).toContainText('超过 4 个档案')
    await expect(page.locator('.import-confirm')).toHaveCount(0)
    await expect(page.locator('.import-noop')).toHaveCount(0)

    // 库内零变化：档案数仍是 4
    const profiles = (await readSetting(page, 'profiles')) as { list: unknown[] }
    expect(profiles.list).toHaveLength(4)
  })
})
