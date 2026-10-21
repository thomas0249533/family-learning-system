import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 当前档案门面（currentProfile）+ 写入端的档案隔离。
 *
 * 这里守的是本版**最贵的失败模式**：`profileId` 传错不会报错，只会把记录写进
 * 另一个孩子的档案，而统计层看不出任何异常（数字都对，只是归属错）。
 * 所以断言全部落在"另一个人看不到"这类**可见后果**上，而不是"函数被调用了"。
 */
import { createFakeDexie } from './helpers/fakeDexie'

/**
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（V1.6 · A2 抽取的单一真相）。
 *
 * 本文件的两个注入点：
 *   - `flagFailSettingsGet` → 让 `settings.get` 抛错（模拟读失败）
 *   - `fake.settings.puts` → 写入次数，用来断言"同 id 切换不该落库"
 */
let flagFailSettingsGet = false

const fake = createFakeDexie({
  overrides: {
    settings: {
      onGet: () => {
        if (flagFailSettingsGet) throw new Error('settings get failed')
      },
    },
  },
})

vi.mock('@/db', () => ({ db: fake.db }))

const { useUserDataStore } = await import('@core/stores/userData')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')
const {
  DEFAULT_PROFILE_ID,
  ProfileLimitError,
  __resetProfileForTest,
  createProfile,
  currentProfile,
  currentProfileId,
  deleteProfile,
  initProfile,
  isProfileInitialized,
  listProfilesSync,
  onBeforeProfileSwitch,
  onProfileChange,
  profilesState,
  renameProfile,
  switchProfile,
} = await import('@core/profile/currentProfile')

beforeEach(() => {
  fake.__reset()
  // 注入的读失败必须跟着复位：否则"读库抛错"那个用例会把后面全部用例都带崩
  flagFailSettingsGet = false
  // 档案状态与监听器都是模块级单例，测试之间必须复位，否则上一个用例的档案会漏到下一个
  __resetProfileForTest()
  invalidateOwnerIndex()
})

function store() {
  setActivePinia(createPinia())
  return useUserDataStore()
}

describe('currentProfile — 未初始化 / 读库', () => {
  it('未 init 时就是 default，且不抛错（惰性默认：启动窗口内还没有用户交互）', () => {
    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
    expect(isProfileInitialized()).toBe(false)
    expect(currentProfile().id).toBe(DEFAULT_PROFILE_ID)
    expect(listProfilesSync()).toHaveLength(1)
  })

  it('★ initProfile 从 settings 的 profiles 键读入 activeId，并把归一化结果写回', async () => {
    await fake.settings.put({
      key: 'profiles',
      value: {
        activeId: 'p2',
        list: [
          { id: 'p1', name: '老大', createdAt: 'c1' },
          { id: 'p2', name: '老二', createdAt: 'c2' },
        ],
      },
    })

    const state = await initProfile()

    expect(state.activeId).toBe('p2')
    expect(currentProfileId()).toBe('p2')
    expect(currentProfile().name).toBe('老二')
    expect(isProfileInitialized()).toBe(true)
    // 落库：导出/导入时这个键必须存在
    expect((await fake.settings.get('profiles'))!.value).toMatchObject({ activeId: 'p2' })
  })

  it('★ 读库抛错 → 回落 default 且不抛（v4 的口径就是存量数据都在 default）', async () => {
    flagFailSettingsGet = true

    const state = await initProfile()

    expect(state.activeId).toBe(DEFAULT_PROFILE_ID)
    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
    expect(isProfileInitialized()).toBe(true)
  })

  it('库里是脏数据（activeId 指向不存在的档案）→ 归一化后落到 list[0]', async () => {
    await fake.settings.put({
      key: 'profiles',
      value: { activeId: 'ghost', list: [{ id: 'p1' }, { id: 'p2' }] },
    })
    await initProfile()
    expect(currentProfileId()).toBe('p1')
    expect(profilesState().list.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('currentProfile — create / rename / delete', () => {
  beforeEach(async () => {
    await initProfile()
  })

  it('★ 第 5 个档案抛 ProfileLimitError（code 供 UI 判分支），且状态不被改动', async () => {
    for (let i = 0; i < 3; i++) await createProfile(`娃${i}`, new Date(2000 + i * 1000))
    expect(listProfilesSync()).toHaveLength(4)

    const err = await createProfile('第五个', new Date(9000)).catch((e) => e)
    expect(err).toBeInstanceOf(ProfileLimitError)
    expect(err.code).toBe('PROFILE_LIMIT')
    expect(err.message).toContain('4')
    expect(listProfilesSync()).toHaveLength(4)
  })

  it('新建后自动切到新档案，并落库（否则重启后回到老大）', async () => {
    const meta = await createProfile('老二', new Date(2000))

    expect(currentProfileId()).toBe(meta.id)
    expect(meta.name).toBe('老二')
    expect(meta.id).not.toBe(DEFAULT_PROFILE_ID)
    const saved = (await fake.settings.get('profiles'))!.value
    expect(saved.activeId).toBe(meta.id)
    expect(saved.list).toHaveLength(2)
  })

  it('空名字 → 用「档案 N」兜底（不能存一个空名字让 UI 显示成空白）', async () => {
    const meta = await createProfile('   ', new Date(2000))
    expect(meta.name).toBe('档案 2')
  })

  it('★ renameProfile 空名抛错且原名不变', async () => {
    await expect(renameProfile(DEFAULT_PROFILE_ID, '   ')).rejects.toThrow()
    expect(currentProfile().name).toBe('我')
  })

  it('renameProfile 对不存在的 id 抛错；正常改名会落库', async () => {
    await expect(renameProfile('ghost', '某人')).rejects.toThrow()
    await renameProfile(DEFAULT_PROFILE_ID, '  哥哥  ')
    expect(currentProfile().name).toBe('哥哥')
    expect((await fake.settings.get('profiles'))!.value.list[0].name).toBe('哥哥')
  })

  it('★ 只剩 1 个档案时删除抛错（删到 0 会让 currentProfileId 指向不存在的档案）', async () => {
    await expect(deleteProfile(DEFAULT_PROFILE_ID)).rejects.toThrow()
    expect(listProfilesSync()).toHaveLength(1)
  })

  it('★ 删掉当前档案 → activeId 回落到剩下的第一个，而不是留在幽灵 id 上', async () => {
    const meta = await createProfile('老二', new Date(2000))
    expect(currentProfileId()).toBe(meta.id)

    await deleteProfile(meta.id)

    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
    expect(listProfilesSync().map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID])
    expect((await fake.settings.get('profiles'))!.value.activeId).toBe(DEFAULT_PROFILE_ID)
  })
})

describe('currentProfile — switchProfile', () => {
  beforeEach(async () => {
    await initProfile()
  })

  it('切到不存在的 id 抛错（静默切换会让 UI 与数据不一致）', async () => {
    await expect(switchProfile('ghost')).rejects.toThrow()
    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
  })

  it('★ 切到相同 id：不写库、不发通知（否则每次进入页面都会触发全量缓存失效）', async () => {
    let emitted = 0
    onProfileChange(() => emitted++)
    const before = fake.settings.puts

    await switchProfile(DEFAULT_PROFILE_ID)

    expect(fake.settings.puts).toBe(before)
    expect(emitted).toBe(0)
  })

  it('正常切换：落库 + 通知携带 next/prev', async () => {
    const meta = await createProfile('老二', new Date(2000))
    const seen: Array<{ next: string; prev: string }> = []
    onProfileChange((next, prev) => seen.push({ next: next.activeId, prev: prev.activeId }))

    await switchProfile(DEFAULT_PROFILE_ID)

    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
    expect(seen).toEqual([{ next: DEFAULT_PROFILE_ID, prev: meta.id }])
    expect((await fake.settings.get('profiles'))!.value.activeId).toBe(DEFAULT_PROFILE_ID)
  })
})

describe('currentProfile — 监听器', () => {
  beforeEach(async () => {
    await initProfile()
  })

  it('★ switch / create / rename / delete 四种变更都要通知（漏一个 = 缓存不失效，老二看到老大的数据）', async () => {
    let n = 0
    onProfileChange(() => n++)

    const meta = await createProfile('老二', new Date(2000))
    expect(n).toBe(1)

    await switchProfile(DEFAULT_PROFILE_ID)
    expect(n).toBe(2)

    await renameProfile(DEFAULT_PROFILE_ID, '哥哥')
    expect(n).toBe(3)

    await deleteProfile(meta.id)
    expect(n).toBe(4)
  })

  it('★ 某个监听器抛错不能阻断其他监听器，也不能阻断变更本身', async () => {
    const reached: string[] = []
    onProfileChange(() => {
      throw new Error('bad listener')
    })
    onProfileChange((next) => reached.push(next.activeId))

    const meta = await createProfile('老二', new Date(2000))

    expect(reached).toEqual([meta.id])
    expect(currentProfileId()).toBe(meta.id)
  })

  it('返回的反注册函数生效（组件卸载后不该继续被调用）', async () => {
    let n = 0
    const off = onProfileChange(() => n++)
    await renameProfile(DEFAULT_PROFILE_ID, '哥哥')
    expect(n).toBe(1)

    off()
    await renameProfile(DEFAULT_PROFILE_ID, '弟弟')
    expect(n).toBe(1)
  })

  it('★ 切换前钩子先跑、onProfileChange 后跑（成就结算必须在数据换人之前完成）', async () => {
    const order: string[] = []
    await createProfile('老二', new Date(2000)) // 当前在老二，下面的 switch 才是真切换
    onBeforeProfileSwitch(() => {
      order.push('before')
    })
    onProfileChange(() => order.push('after'))

    await switchProfile(DEFAULT_PROFILE_ID)

    expect(order).toEqual(['before', 'after'])
  })

  it('★ 切换前钩子抛错不阻断切换（结算失败不能让用户被卡在当前档案里）', async () => {
    const meta = await createProfile('老二', new Date(2000))
    onBeforeProfileSwitch(() => {
      throw new Error('结算失败')
    })

    await expect(switchProfile(DEFAULT_PROFILE_ID)).resolves.toBeTruthy()
    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
    expect(currentProfileId()).not.toBe(meta.id)
  })

  it('__resetProfileForTest 复位状态、清空监听器', async () => {
    let n = 0
    onProfileChange(() => n++)
    await createProfile('老二', new Date(2000))
    expect(n).toBe(1)

    __resetProfileForTest()

    expect(currentProfileId()).toBe(DEFAULT_PROFILE_ID)
    expect(isProfileInitialized()).toBe(false)
    expect(listProfilesSync()).toHaveLength(1)

    await createProfile('老三', new Date(3000))
    expect(n).toBe(1) // 监听器已被清掉
  })
})

// ---------------------------------------------------------------------------
// 写入端档案隔离：从 store 到库的整条链路
// ---------------------------------------------------------------------------

describe('写入端档案隔离', () => {
  const PKG = 'pkg-unit-1'
  const KP = 'kp-1'

  it('★ recordProgress 写入当前档案；切到 default 后 loadUserData 读不到另一档案的行', async () => {
    await initProfile()
    const meta = await createProfile('老二', new Date(2000))
    const s = store()

    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(1)
    expect(fake.progress.rows[0].profileId).toBe(meta.id)

    await switchProfile(DEFAULT_PROFILE_ID)
    await s.loadUserData()
    expect(s.progress).toEqual([])

    await switchProfile(meta.id)
    await s.loadUserData()
    expect(s.progress).toHaveLength(1)
  })

  it('★ 同一知识点在两个档案各答一次 → 两行、各自 count=1（合并成一行就是串档案）', async () => {
    await initProfile()
    const s = store()

    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })
    const meta = await createProfile('老二', new Date(2000))
    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    expect(fake.progress.rows).toHaveLength(2)
    expect(fake.progress.rows.map((r) => r.profileId).sort()).toEqual(
      [DEFAULT_PROFILE_ID, meta.id].sort()
    )
    expect(fake.progress.rows.every((r) => r.correctCount === 1)).toBe(true)
  })

  it('★ 错题本同样分片：另一个人打开错题页是空的', async () => {
    await initProfile()
    const s = store()
    const question: any = { id: 'ex-1', type: 'blank', question: '1+1=?', answer: '2', explanation: '' }

    await s.addMistake(question, PKG, [KP], '3')
    expect(fake.mistakes.rows[0].profileId).toBe(DEFAULT_PROFILE_ID)

    await createProfile('老二', new Date(2000))
    await s.loadUserData()
    expect(s.mistakes).toEqual([])
  })

  it('★ 打卡天数也写进分片键 `studyStreak:<pid>`，不留裸 `studyStreak`（漏了就是打卡归零）', async () => {
    await initProfile()
    const meta = await createProfile('老二', new Date(2000))
    const s = store()

    await s.recordProgress(PKG, KP, true, { questionType: 'blank' })

    const keys = fake.settings.rows.map((r) => r.key)
    expect(keys).toContain(`studyStreak:${meta.id}`)
    expect(keys).not.toContain('studyStreak')
    expect(keys).not.toContain(`studyStreak:${DEFAULT_PROFILE_ID}`)
  })
})
