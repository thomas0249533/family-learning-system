import { describe, expect, it } from 'vitest'
import { adaptV1ToBundles } from '@core/backup/v1Adapter'

/**
 * v1 适配器（§6.6）。
 *
 * 这个适配器只有一条铁律：**不做字段猜测**。
 * 所以本文件的重点是**负面断言** —— 断言输出里"没有"什么。
 * 正面断言（pid 是 default、name 是我）很容易通过，真正会出问题的是
 * "为了让数据看起来完整，偷偷补了默认值"：
 * 补出来的 `masteryProbability` 会参与后续判决，补出来的 `status` 会让
 * 统计把一条从没答过的题算成"学习中"。这类 bug 没有报错、没有日志，只有"数字不对"。
 */

describe('adaptV1ToBundles — 打包成单个档案', () => {
  it('整份扁平备份 → 一个 default 档案，名字是「我」', () => {
    const bundles = adaptV1ToBundles({
      version: '1.0',
      exportedAt: '2024-05-01T08:00:00.000Z',
      progress: [{ packageId: 'pkg-a', knowledgePointId: 'kp-1', correctCount: 3 }],
      mistakes: [{ packageId: 'pkg-a', exerciseId: 'ex-1', wrongCount: 1 }],
    })

    expect(bundles).toHaveLength(1)
    const b = bundles[0]
    expect(b.profileId).toBe('default')
    expect(b.name).toBe('我')
    expect(b.createdAt).toBe('2024-05-01T08:00:00.000Z')
    expect(b.progress).toHaveLength(1)
    expect(b.mistakes).toHaveLength(1)
  })

  it('缺 exportedAt → createdAt 是空串（不拿"现在"冒充导出时间）', () => {
    const b = adaptV1ToBundles({ version: '1.0' })[0]
    expect(b.createdAt).toBe('')
  })

  it('一条数据都没有 → 仍然是 1 个空档案（而不是 0 个或 undefined）', () => {
    const bundles = adaptV1ToBundles({ version: '1.0' })
    expect(bundles).toHaveLength(1)
    expect(bundles[0].progress).toEqual([])
    expect(bundles[0].mistakes).toEqual([])
    expect(bundles[0].examSessions).toEqual([])
    expect(bundles[0].settings).toEqual({})
  })

  it('packages 字段被忽略（包是设备级资产，不进数据备份）', () => {
    const bundles = adaptV1ToBundles({
      version: '1.0',
      packages: [{ packageId: 'pkg-a', manifest: {}, knowledgePoints: [] }],
    })
    expect(bundles).toHaveLength(1)
    // 整个 Bundle 里不该有任何地方出现包内容
    expect(JSON.stringify(bundles[0])).not.toContain('manifest')
  })
})

describe('adaptV1ToBundles — 不做字段猜测（负面断言）', () => {
  it('行里缺 status / correctCount → 输出里也没有，不补默认值', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      progress: [{ packageId: 'pkg-a', knowledgePointId: 'kp-1' }],
    })[0]

    const row = b.progress[0] as unknown as Record<string, unknown>
    expect('status' in row).toBe(false)
    expect('correctCount' in row).toBe(false)
    expect('masteryProbability' in row).toBe(false)
    expect('fsrs' in row).toBe(false)
    expect('bkt' in row).toBe(false)
    expect('lastStudiedAt' in row).toBe(false)
  })

  it('不凭空生成 examSessions（v1 没有这一层）', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      progress: [{ packageId: 'pkg-a', knowledgePointId: 'kp-1', correctCount: 1 }],
    })[0]
    expect(b.examSessions).toEqual([])
  })

  it('不推断第二个档案：settings/progress 再多也只产出一个 bundle', () => {
    const bundles = adaptV1ToBundles({
      version: '1.0',
      progress: [
        { profileId: 'p_x', packageId: 'pkg-a', knowledgePointId: 'kp-1' },
        { packageId: 'pkg-b', knowledgePointId: 'kp-2' },
      ],
    })
    expect(bundles).toHaveLength(1)
    // 行里已有的 pid **原样保留**（不改写、不校验，交给合并引擎）
    const rows = bundles[0].progress as unknown as Record<string, unknown>[]
    expect(rows[0].profileId).toBe('p_x')
    // 原来没有 pid 的行补成 default（归属由外层 Bundle 声明，不是猜字段）
    expect(rows[1].profileId).toBe('default')
  })

  it('值是 null 的行被跳过，不构造空壳记录', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      progress: [null, { packageId: 'pkg-a', knowledgePointId: 'kp-1' }, 'oops'],
    })[0]
    expect(b.progress).toHaveLength(1)
  })
})

describe('adaptV1ToBundles — settings 的作用域划分', () => {
  it('8 个 per-profile 键进 Bundle（键保持基名）', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      settings: [
        { key: 'achievements', value: [{ id: 'badge-a', unlockedAt: '2024-01-01' }] },
        { key: 'dailyStats', value: { date: '2024-05-01', questions: 12 } },
        { key: 'studyStreak', value: { current: 3, best: 5, lastDate: '2024-05-01' } },
        { key: 'achievement:discoveryEnabled', value: true },
      ],
    })[0]

    expect(Object.keys(b.settings).sort()).toEqual([
      'achievement:discoveryEnabled',
      'achievements',
      'dailyStats',
      'studyStreak',
    ])
    // 值原样搬运，不 normalize、不补字段
    expect(b.settings.dailyStats).toEqual({ date: '2024-05-01', questions: 12 })
    expect(b.settings['achievement:discoveryEnabled']).toBe(true)
  })

  it('global 键被丢弃（含 profiles：导入不该覆盖本机档案列表）', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      settings: [
        { key: 'profiles', value: { activeId: 'default', list: [{ id: 'default' }] } },
        { key: 'achievement:customPacks', value: [{ id: 'pack-1' }] },
        { key: 'migration:v4', value: { status: 'ok' } },
        { key: 'achievements', value: [] },
      ],
    })[0]

    expect(Object.keys(b.settings)).toEqual(['achievements'])
  })

  it('未知键按 per-profile 收下（漏搬比多搬可怕）', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      settings: [{ key: 'somethingFromTheFuture', value: { a: 1 } }],
    })[0]
    expect(b.settings.somethingFromTheFuture).toEqual({ a: 1 })
  })

  it('混进了带后缀的键（别的版本写过）→ 剥掉后缀按基名收下，不报错', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      settings: [{ key: 'dailyStats:p2', value: { date: '2024-05-02' } }],
    })[0]
    expect(b.settings.dailyStats).toEqual({ date: '2024-05-02' })
  })

  it('畸形 settings 行（缺 key / 非对象）被跳过，不制造空键', () => {
    const b = adaptV1ToBundles({
      version: '1.0',
      settings: [null, { value: 1 }, { key: '', value: 2 }, { key: 'dailyStats', value: 3 }],
    })[0]
    expect(Object.keys(b.settings)).toEqual(['dailyStats'])
  })
})
