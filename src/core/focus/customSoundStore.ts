// =====================================================================
// customSoundStore · 本地环境音（V2.7 · 轨道 B2）
// ---------------------------------------------------------------------
// 需求：家长可以把自家的一段 MP3（雨声录音 / 白噪音 / 轻音乐）导入进来，
// 在专注模式里当环境音循环播放。全部留在本机，不上传、不进备份。
//
// 三条铁律：
//   1. **Blob 只存一处**（IndexedDB）。不生成 objectURL、不做内存缓存 ——
//      任何"第二处引用"都意味着忘记释放的风险。
//   2. **解码后的 PCM 绝不缓存**（见 NoiseGenerator.decodeToBuffer 的说明）：
//      一段 5 分钟立体声解码后约 100MB。
//   3. 限额明确：单个 ≤ 8MB、最多 5 个。配额爆掉时 IndexedDB 抛的是
//      `QuotaExceededError`，用户看到的必须是"存不下"而不是"程序坏了"。
//
// 可测性：`dao` 可注入（与 catalogService 的 transport 同一种做法），
// 所以校验/限额/命名这些纯逻辑不需要真的开 IndexedDB。
// =====================================================================
import { db, type CustomSoundRecord } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'

/** 单个音频上限：8MB（约 8~12 分钟 MP3，足够做环境音循环） */
export const MAX_SOUND_BYTES = 8 * 1024 * 1024
/** 最多保存几段（再多列表就变成管理器，且配额风险陡增） */
export const MAX_SOUNDS = 5

/** 列表用的轻量元信息（**不含 blob**，列表页不该把几十 MB 读进内存） */
export interface CustomSoundMeta {
  soundId: string
  name: string
  mime: string
  size: number
  createdAt: string
}

export type SoundRejectReason = 'empty' | 'too-large' | 'not-audio' | 'too-many' | 'duplicate'

export type SaveSoundResult =
  | { ok: true; meta: CustomSoundMeta }
  | { ok: false; reason: SoundRejectReason }

export interface CustomSoundDao {
  list(profileId: string): Promise<CustomSoundRecord[]>
  get(profileId: string, soundId: string): Promise<CustomSoundRecord | undefined>
  add(row: CustomSoundRecord): Promise<void>
  remove(profileId: string, soundId: string): Promise<void>
}

/** 生产实现：Dexie（表见 db/index.ts 的 version(6)） */
export const dexieSoundDao: CustomSoundDao = {
  list: (profileId) => db.customSounds.where('profileId').equals(profileId).toArray(),
  get: (profileId, soundId) =>
    db.customSounds.where('[profileId+soundId]').equals([profileId, soundId]).first(),
  add: async (row) => {
    await db.customSounds.add(row)
  },
  remove: async (profileId, soundId) => {
    await db.customSounds.where('[profileId+soundId]').equals([profileId, soundId]).delete()
  },
}

/**
 * 文件校验（纯函数）。
 *
 * `type` 为空是真实情况：有些系统对 `.mp3` 给不出 MIME（尤其从 U 盘拖进来的），
 * 这时**按扩展名兜底**，而不是直接拒 —— 否则用户会遇到"明明能播却导不进来"。
 */
export function validateAudioFile(file: {
  name?: string
  type?: string
  size: number
}): SoundRejectReason | null {
  if (!file.size || file.size <= 0) return 'empty'
  if (file.size > MAX_SOUND_BYTES) return 'too-large'

  const mime = (file.type ?? '').toLowerCase()
  if (mime.startsWith('audio/')) return null

  const name = (file.name ?? '').toLowerCase()
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/.test(name)) return null

  return 'not-audio'
}

/** 展示名：去掉扩展名、压掉多余空白；全空时兜底「本地音频」 */
export function displayNameOf(fileName: string): string {
  const base = (fileName ?? '').replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim()
  return base.length > 0 ? base.slice(0, 40) : '本地音频'
}

/** 给人看的体积（列表右侧那行小字） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function newSoundId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `snd-${uuid}`
  return `snd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toMeta(row: CustomSoundRecord): CustomSoundMeta {
  return {
    soundId: row.soundId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    createdAt: row.createdAt,
  }
}

/** 列表（新导入的在前），**不含 blob** */
export async function listCustomSounds(
  opts: { dao?: CustomSoundDao; profileId?: string } = {},
): Promise<CustomSoundMeta[]> {
  const dao = opts.dao ?? dexieSoundDao
  const profileId = opts.profileId ?? currentProfileId()
  const rows = await dao.list(profileId)
  return rows
    .map(toMeta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 保存一段音频。
 *
 * 重复判定按 **名字 + 体积**：同名同大小基本就是同一个文件（用户重复点两次导入），
 * 直接告诉他"已经有了"比默默多存一份 8MB 更友好。
 */
export async function saveCustomSound(
  file: File,
  opts: { dao?: CustomSoundDao; profileId?: string; now?: Date } = {},
): Promise<SaveSoundResult> {
  const rejection = validateAudioFile(file)
  if (rejection) return { ok: false, reason: rejection }

  const dao = opts.dao ?? dexieSoundDao
  const profileId = opts.profileId ?? currentProfileId()

  const existing = await dao.list(profileId)
  if (existing.length >= MAX_SOUNDS) return { ok: false, reason: 'too-many' }

  const name = displayNameOf(file.name)
  if (existing.some((r) => r.name === name && r.size === file.size)) {
    return { ok: false, reason: 'duplicate' }
  }

  const row: CustomSoundRecord = {
    profileId,
    soundId: newSoundId(),
    name,
    mime: file.type || 'audio/mpeg',
    size: file.size,
    blob: file,
    createdAt: (opts.now ?? new Date()).toISOString(),
  }

  try {
    await dao.add(row)
  } catch (e) {
    // 配额爆掉 / 浏览器禁止写 Blob：都是"存不下"，不是"程序坏了"
    console.warn('[本地音频] 写入失败，可能超出浏览器存储配额', e)
    return { ok: false, reason: 'too-large' }
  }

  return { ok: true, meta: toMeta(row) }
}

/**
 * 删除一段音频。
 *
 * 删除行即释放那份 Blob：本模块从不产生 objectURL，也没有第二处引用，
 * 所以"释放"这件事在架构上就是免费的（不需要 revoke，也不需要手动置空）。
 */
export async function deleteCustomSound(
  soundId: string,
  opts: { dao?: CustomSoundDao; profileId?: string } = {},
): Promise<void> {
  const dao = opts.dao ?? dexieSoundDao
  const profileId = opts.profileId ?? currentProfileId()
  await dao.remove(profileId, soundId)
}

/** 取原始 Blob（播放前才调用：解码要 ArrayBuffer） */
export async function loadSoundBlob(
  soundId: string,
  opts: { dao?: CustomSoundDao; profileId?: string } = {},
): Promise<Blob | null> {
  const dao = opts.dao ?? dexieSoundDao
  const profileId = opts.profileId ?? currentProfileId()
  const row = await dao.get(profileId, soundId)
  return row?.blob ?? null
}
