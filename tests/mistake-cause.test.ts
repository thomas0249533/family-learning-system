import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { createFakeDexie } from './helpers/fakeDexie'
import {
  MISTAKE_CAUSE_LABELS,
  MISTAKE_CAUSE_ORDER,
  MISTAKE_CAUSE_UNLABELED,
  mistakeCauseLabelOf,
  mistakeCauseOf,
} from '@core/mistake/mistakeCause'

/**
 * C1 · 错题归因模型（`mistakeCause`）回归测试。
 *
 * 覆盖三层：
 *   1. 纯函数 —— 逻辑层兜底（knowledge）与 UI 层区分（未分类）必须不同；
 *   2. store 的 `setMistakeCause` —— 打标 / 覆盖 / 取消 / 档案隔离 / 静默路径；
 *   3. 写入纪律 —— 旧错题走一轮 `addMistake` 不会获得凭空的原因字段
 *      （防"顺手机器写入"：那等于给历史数据编原因）。
 *   4. 模板静态锁 —— radio `name` 必须按渲染实例唯一（见文件末尾 describe）。
 *
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相），
 * 索引清单与 `src/db/index.ts` 的 `version(4)` 逐字对应。
 */
const fake = createFakeDexie()

vi.mock('@/db', () => ({ db: fake.db }))

const { useUserDataStore } = await import('@core/stores/userData')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const {
  __resetProfileForTest,
  createProfile,
  currentProfileId,
  switchProfile,
} = await import('@core/profile/currentProfile')

/** 一行错题夹具。默认落在 `default` 档案（测试用的当前档案）。 */
function mistakeRow(over: Partial<import('@/db').MistakeRecord> = {}) {
  return {
    profileId: 'default',
    packageId: 'pkg-1',
    exerciseId: 'ex-1',
    knowledgePointIds: ['kp-1'],
    wrongAt: new Date().toISOString(),
    wrongCount: 1,
    mastered: false,
    ...over,
  }
}

/** 一个题目对象（addMistake 只用到 id / type / question / answer / options / explanation） */
function question(id: string): import('@modules/core/QuizEngine.vue').QuizQuestion {
  return {
    id,
    type: 'single',
    question: `${id} 题干`,
    answer: 'A',
    options: ['A', 'B'],
    explanation: '',
  }
}

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

/** 建第二个档案，然后**切回 default**（createProfile 会自动切到新档案，必须切回来） */
async function makeSecondProfile(): Promise<string> {
  const meta = await createProfile('老二', new Date(2024, 0, 1))
  await switchProfile('default')
  expect(currentProfileId()).toBe('default')
  return meta.id
}

beforeEach(() => {
  fake.__reset()
  // `__resetProfileForTest` 之后 `currentProfileId()` 本来就是 'default'，
  // 所以**不调** `initProfile()` —— 它会往 fake.settings 写一个 profiles 键，
  // 污染"不写库"那条断言里的 `fake.writes`。
  __resetProfileForTest()
  // 归属索引是进程内缓存，测试之间必须清掉（addMistake 会读它）
  invalidateOwnerIndex()
})

describe('mistakeCause · 纯函数', () => {
  it('mistakeCauseOf：旧行没有该字段 → knowledge 兜底', () => {
    expect(mistakeCauseOf(mistakeRow())).toBe('knowledge')
  })

  it('mistakeCauseOf：四个枚举值原样返回', () => {
    for (const c of MISTAKE_CAUSE_ORDER) {
      expect(mistakeCauseOf(mistakeRow({ mistakeCause: c }))).toBe(c)
    }
  })

  it('mistakeCauseLabelOf：未打标 → 「未分类」，而不是逻辑层的「知识盲区」', () => {
    // 两个函数的兜底**故意不同**：显示层不许替用户选一个
    expect(mistakeCauseLabelOf(mistakeRow())).toBe(MISTAKE_CAUSE_UNLABELED)
    expect(mistakeCauseLabelOf(mistakeRow())).toBe('未分类')
    expect(mistakeCauseLabelOf(mistakeRow())).not.toBe('知识盲区')
  })

  it('mistakeCauseLabelOf：四枚举标签齐全且不含英文码', () => {
    for (const c of MISTAKE_CAUSE_ORDER) {
      const label = mistakeCauseLabelOf(mistakeRow({ mistakeCause: c }))
      expect(label).toBe(MISTAKE_CAUSE_LABELS[c])
      expect(label).not.toMatch(/[A-Za-z]/)
    }
    // 标签表与顺序表必须一一对应（少了任何一个枚举，Record 类型会先在 tsc 炸）
    expect(Object.keys(MISTAKE_CAUSE_LABELS).sort()).toEqual([...MISTAKE_CAUSE_ORDER].sort())
  })
})

describe('setMistakeCause · store', () => {
  it('打标 → 读回是所选值；改标 → 覆盖（不新增行）', async () => {
    await fake.mistakes.add(mistakeRow({ id: 1, exerciseId: 'ex-1' }))
    const s = store()

    await s.setMistakeCause('ex-1', 'careless')
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].mistakeCause).toBe('careless')

    await s.setMistakeCause('ex-1', 'timeout')
    expect(fake.mistakes.rows).toHaveLength(1)
    expect(fake.mistakes.rows[0].mistakeCause).toBe('timeout')
  })

  it('★ 传 null → 字段真的消失（键不在，而不是留着 undefined）', async () => {
    await fake.mistakes.add(mistakeRow({ id: 1, exerciseId: 'ex-1', mistakeCause: 'careless' }))
    const s = store()

    await s.setMistakeCause('ex-1', null)

    const row = fake.mistakes.rows[0]
    // 这同时锁死"取消打标"的实现方式：读出行 → 删键 → put 整行。
    // （Dexie 4 的 update 对 undefined 本是 delete 语义，但 toPlain 的 JSON
    //   往返会先把 undefined 键丢掉，patch 变 {}，删不到键 —— 见 store 注释。）
    expect('mistakeCause' in row).toBe(false)
    expect(row.mistakeCause).toBeUndefined()
    // 取消打标不能顺手把别的字段抹掉
    expect(row.wrongCount).toBe(1)
    expect(row.exerciseId).toBe('ex-1')
  })

  it('★ 档案隔离：A 档案打标，B 档案同 exerciseId 的行不受影响', async () => {
    const p2 = await makeSecondProfile()
    await fake.mistakes.add(mistakeRow({ id: 1, profileId: 'default', exerciseId: 'ex-1' }))
    await fake.mistakes.add(mistakeRow({ id: 2, profileId: p2, exerciseId: 'ex-1' }))

    await store().setMistakeCause('ex-1', 'misread')

    const byPid = new Map(fake.mistakes.rows.map((r) => [r.profileId, r]))
    expect(byPid.get('default')!.mistakeCause).toBe('misread')
    // B 档案那一行连键都不该有（不是"值没变"，是"根本没被写过"）
    expect('mistakeCause' in byPid.get(p2)!).toBe(false)
  })

  it('不存在的 exerciseId → 静默返回、不抛错、不写库', async () => {
    const s = store()
    await expect(s.setMistakeCause('no-such-ex', 'careless')).resolves.toBeUndefined()
    // "取消打标"的良性路径：一个字节都没写（含 settings —— 所以 beforeEach 不调 initProfile）
    expect(fake.writes).toHaveLength(0)
  })

  it('★ 旧错题（无该字段）经过一轮 addMistake 之后不会获得凭空的原因字段', async () => {
    const s = store()
    // add 路径（新行）
    await s.addMistake(question('ex-old'), 'pkg-1', ['kp-1'], 'B')
    // update 路径（已存在的行）—— 如果有人把 mistakeCause 塞进 update 载荷就会现形
    await s.addMistake(question('ex-old'), 'pkg-1', ['kp-1'], 'C')

    expect(fake.mistakes.rows).toHaveLength(1)
    const row = fake.mistakes.rows[0]
    expect('mistakeCause' in row).toBe(false)
    // addMistake 的既有语义没被破坏
    expect(row.wrongCount).toBe(2)
    expect(row.lastUserAnswer).toBe('C')
  })
})

/**
 * Mistakes.vue · radio `name` 唯一性（静态 SFC 断言）
 *
 * ## 为什么只能做静态断言
 * 本仓单测环境是 node，没有挂载组件的设施（@vue/test-utils / jsdom 都没装，
 * 也不打算为一个断言装），所以锁"模板里 name 怎么生成"的唯一手段是读 SFC
 * 源文件匹配。先例：`tests/settings-keys.test.ts`（A3）同样读源码做静态扫描。
 *
 * ## 为什么值得锁（这个缺陷单测跑不出来，但用户一按方向键就会遇到）
 * radio 的 `name` 在整份文档内唯一即同组。分组视图（`groupedMistakes`）会把
 * **同一道错题**按 `knowledgePointIds` push 进多个分组 —— 一道题挂在 3 个
 * 知识点下就渲染 3 张卡片。若 name 只按 mistake 生成（`'cause-' + m.id`），
 * 这 3 张卡片的 radio 共用一个组：
 *   - 键盘 ↓/↑ 会在分组之间跳焦点（按一次方向键，焦点跑到页面另一段）；
 *   - 打标后到 `loadUserData()` 完成前，其他分组的实例短暂显示"什么都没选"。
 * 所以分组视图的 name 必须带 `group.kpId`（按渲染实例唯一）；平铺视图每道题
 * 只渲染一次，保持按 mistake 即可。两套生成式不同，将来若改成同时渲染也不串。
 */
describe('Mistakes.vue · 归因 radio 的 name 唯一性（静态断言）', () => {
  // 压平空白后再匹配：模板将来被重新换行折断也不该把这个锁误伤
  const sfc = readFileSync(
    pathResolve(process.cwd(), 'src/views/Mistakes.vue'),
    'utf8'
  ).replace(/\s+/g, ' ')
  const PER_MISTAKE = "'cause-' + m.id"
  const PER_INSTANCE = "'cause-' + group.kpId + '-' + m.id"

  it('分组视图的 name 含 group.kpId（同一道题进多个分组也不会共用一个 radio 组）', () => {
    expect(sfc).toContain(PER_INSTANCE)
  })

  it('平铺视图的 name 按 mistake（该视图每道题只渲染一次）', () => {
    expect(sfc).toContain(PER_MISTAKE)
  })

  it('两种视图的 name 生成式不同、各只出现一次（防回退成按 mistake 命名）', () => {
    // 回退症状：分组视图改回 'cause-' + m.id → PER_INSTANCE 计数变 0、
    // PER_MISTAKE 计数变 2。两条都钉住，只改一处另一处会红。
    expect(sfc.split(PER_INSTANCE).length - 1).toBe(1)
    expect(sfc.split(PER_MISTAKE).length - 1).toBe(1)
  })
})
