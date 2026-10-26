import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomSoundDao } from '@core/focus/customSoundStore'
import type { CustomSoundRecord } from '@/db'

// 本模块只做"校验 + 落库编排"，真正的 Blob 存储由 IndexedDB 负责。
// 单测里把 dao 换成内存实现，同时把 `@/db` 与档案来源打桩 ——
// 这样跑的是**同一份生产代码**，只是把 IO 边界换掉。
vi.mock('@/db', () => ({ db: {} as unknown }))
vi.mock('@core/profile/currentProfile', () => ({ currentProfileId: () => 'p-default' }))

const {
  MAX_SOUNDS,
  MAX_SOUND_BYTES,
  deleteCustomSound,
  displayNameOf,
  formatBytes,
  listCustomSounds,
  loadSoundBlob,
  saveCustomSound,
  validateAudioFile,
} = await import('@core/focus/customSoundStore')

function memoryDao(): CustomSoundDao & { rows: CustomSoundRecord[]; failNextAdd: boolean } {
  const rows: CustomSoundRecord[] = []
  const api = {
    rows,
    failNextAdd: false,
    list: async (profileId: string) => rows.filter((r) => r.profileId === profileId),
    get: async (profileId: string, soundId: string) =>
      rows.find((r) => r.profileId === profileId && r.soundId === soundId),
    add: async (row: CustomSoundRecord) => {
      if (api.failNextAdd) {
        api.failNextAdd = false
        throw new Error('QuotaExceededError')
      }
      rows.push(row)
    },
    remove: async (profileId: string, soundId: string) => {
      const i = rows.findIndex((r) => r.profileId === profileId && r.soundId === soundId)
      if (i >= 0) rows.splice(i, 1)
    },
  }
  return api
}

/** 伪造一个 File：只需要 name / type / size（blob 字段在内存 dao 里不被解引用） */
function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File
}

describe('validateAudioFile · 导入前的守门', () => {
  it('audio/* 通过', () => {
    expect(validateAudioFile({ name: 'a.mp3', type: 'audio/mpeg', size: 1024 })).toBeNull()
  })

  it('MIME 缺失时按扩展名兜底（U 盘里的文件常常没有 MIME）', () => {
    expect(validateAudioFile({ name: '雨声.MP3', type: '', size: 2048 })).toBeNull()
    expect(validateAudioFile({ name: 'loop.ogg', size: 999 })).toBeNull()
  })

  it('空文件 / 超限 / 非音频 各自给出明确原因', () => {
    expect(validateAudioFile({ name: 'a.mp3', type: 'audio/mpeg', size: 0 })).toBe('empty')
    expect(
      validateAudioFile({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_SOUND_BYTES + 1 }),
    ).toBe('too-large')
    expect(validateAudioFile({ name: 'note.txt', type: 'text/plain', size: 10 })).toBe('not-audio')
    expect(validateAudioFile({ name: 'x.m4a.exe', type: '', size: 10 })).toBe('not-audio')
  })
})

describe('展示名与体积', () => {
  it('去扩展名、压空白、空则兜底', () => {
    expect(displayNameOf('rain-loop.mp3')).toBe('rain-loop')
    expect(displayNameOf('  甘 露  .m4a')).toBe('甘 露')
    expect(displayNameOf('')).toBe('本地音频')
    // 只有扩展名 = 没有名字（macOS 上把文件改名成 ".mp3" 是可能的），走兜底而不是显示 ".mp3"
    expect(displayNameOf('.mp3')).toBe('本地音频')
  })

  it('超长名字截断到 40 字', () => {
    expect(displayNameOf(`${'雨'.repeat(80)}.mp3`)).toHaveLength(40)
  })

  it('体积人话化', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('saveCustomSound · 落库编排', () => {
  let dao: ReturnType<typeof memoryDao>

  beforeEach(() => {
    dao = memoryDao()
  })

  it('成功时返回元信息，且列表里能查到（新导入的在前）', async () => {
    const r1 = await saveCustomSound(fakeFile('雨声.mp3', 'audio/mpeg', 1000), {
      dao,
      profileId: 'p1',
      now: new Date('2026-01-01T00:00:00Z'),
    })
    expect(r1.ok).toBe(true)

    const r2 = await saveCustomSound(fakeFile('海浪.m4a', 'audio/mp4', 2000), {
      dao,
      profileId: 'p1',
      now: new Date('2026-01-02T00:00:00Z'),
    })
    expect(r2.ok).toBe(true)

    const list = await listCustomSounds({ dao, profileId: 'p1' })
    expect(list.map((s) => s.name)).toEqual(['海浪', '雨声'])
    // 元信息里绝不带 blob
    expect(Object.keys(list[0])).not.toContain('blob')
  })

  it('同名同体积视为重复，不重复占配额', async () => {
    await saveCustomSound(fakeFile('雨声.mp3', 'audio/mpeg', 1000), { dao, profileId: 'p1' })
    const again = await saveCustomSound(fakeFile('雨声.mp3', 'audio/mpeg', 1000), {
      dao,
      profileId: 'p1',
    })
    expect(again).toEqual({ ok: false, reason: 'duplicate' })
    expect(dao.rows).toHaveLength(1)
  })

  it(`最多 ${MAX_SOUNDS} 段：满了给出 too-many`, async () => {
    for (let i = 0; i < MAX_SOUNDS; i++) {
      const r = await saveCustomSound(fakeFile(`s${i}.mp3`, 'audio/mpeg', 100 + i), {
        dao,
        profileId: 'p1',
      })
      expect(r.ok).toBe(true)
    }
    const overflow = await saveCustomSound(fakeFile('s9.mp3', 'audio/mpeg', 999), {
      dao,
      profileId: 'p1',
    })
    expect(overflow).toEqual({ ok: false, reason: 'too-many' })
  })

  it('写库抛错（配额爆掉）转成 too-large，而不是把异常抛给 UI', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    dao.failNextAdd = true
    const r = await saveCustomSound(fakeFile('雨声.mp3', 'audio/mpeg', 1000), {
      dao,
      profileId: 'p1',
    })
    expect(r).toEqual({ ok: false, reason: 'too-large' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('档案隔离：p1 的音频在 p2 看不到', async () => {
    await saveCustomSound(fakeFile('雨声.mp3', 'audio/mpeg', 1000), { dao, profileId: 'p1' })
    expect(await listCustomSounds({ dao, profileId: 'p2' })).toEqual([])
  })
})

describe('删除与取回', () => {
  it('删除后列表为空、Blob 取不到（删除行即释放那份二进制）', async () => {
    const dao = memoryDao()
    const saved = await saveCustomSound(fakeFile('雨声.mp3', 'audio/mpeg', 1000), {
      dao,
      profileId: 'p1',
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    expect(await loadSoundBlob(saved.meta.soundId, { dao, profileId: 'p1' })).not.toBeNull()
    await deleteCustomSound(saved.meta.soundId, { dao, profileId: 'p1' })

    expect(dao.rows).toHaveLength(0)
    expect(await loadSoundBlob(saved.meta.soundId, { dao, profileId: 'p1' })).toBeNull()
  })

  it('取一个不存在的 id 返回 null 而不是抛错', async () => {
    const dao = memoryDao()
    expect(await loadSoundBlob('nope', { dao, profileId: 'p1' })).toBeNull()
  })
})
