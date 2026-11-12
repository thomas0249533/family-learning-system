/**
 * 语音朗读服务 V3.1.7
 *
 * ## 这一版解决什么
 * 旧版 `getVoices().find(lang.startsWith(prefix))` 只取**第一个**匹配音色，
 * Windows 上常落到 Microsoft Huihui 这类机械音；且 `getVoices()` 在部分
 * WebView 首次调用返回空数组（异步加载），导致根本没选中语音。
 *
 * 现在：
 *   1. `voiceschanged` 就绪保护 + voices 缓存，首次为空时延迟重试；
 *   2. 按**名称优先级**挑更自然的音色（中文 Xiaoxiao/Yunxi 等，英文自然音），
 *      并优先本地音色（localService），避免选中远端合成音；
 *   3. 按语种给默认语速（中文听写更慢），家长可在设置页覆盖；
 *   4. 长句分段朗读，规避 WebView 对长文本的截断；
 *   5. **离线音频包兼容**：词可带 `audio` 资产路径，存在则优先播放音频，
 *      不存在自动回退系统 TTS。本期只建通道，不要求内容包真的带音频。
 *
 * 纯前端、无新依赖；设置持久化走 localStorage（与项目既有 settings 习惯一致）。
 */
import { loadAssetBlob } from '@core/package-manager/packageAssetStore'

export interface SpeakOptions {
  text: string
  lang?: string
  rate?: number
  pitch?: number
  /** 离线音频资产：存在则优先播放（packageId + 包内相对路径） */
  audio?: { packageId: string; path: string }
  onStart?: () => void
  onEnd?: () => void
  onError?: (e: any) => void
}

/** 家长可调的语音偏好 */
export interface VoicePreferences {
  /** 指定音色名（voice.name）；空串 = 自动优选 */
  voiceName: string
  /** 语速倍率，0.5~1.5；null = 按语种用默认值 */
  rate: number | null
}

const PREFS_KEY = 'fls.voice.preferences.v1'
const DEFAULT_PREFS: VoicePreferences = { voiceName: '', rate: null }

export function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw)
    return {
      voiceName: typeof p.voiceName === 'string' ? p.voiceName : '',
      rate: typeof p.rate === 'number' && p.rate >= 0.5 && p.rate <= 1.5 ? p.rate : null,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function saveVoicePreferences(p: VoicePreferences): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* 只读环境忽略 */ }
}

export function isSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 语种推断：有中文 → zh-CN，否则 en-US */
export function detectLang(text: string): string {
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN'
  return 'en-US'
}

/**
 * 音色优先级：名字里含这些片段的更自然（系统装了就用），按数组顺序降序。
 * 未命中时退回任意同语种音色，最后退回系统默认 —— 绝不因为挑不到就放弃朗读。
 */
const VOICE_PRIORITY: Record<string, string[]> = {
  zh: ['xiaoxiao', 'xiaoyi', 'yunxi', 'yunjian', 'kangkang', 'huihui', 'yaoyao', 'tingting', 'google 普通话', 'chinese'],
  en: ['jenny', 'aria', 'sonia', 'zira', 'samantha', 'google us english', 'natural', 'english'],
}

let voicesCache: SpeechSynthesisVoice[] = []
let voicesReady = false

function refreshVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechAvailable()) return []
  try {
    const v = window.speechSynthesis.getVoices()
    if (v && v.length > 0) {
      voicesCache = v
      voicesReady = true
    }
  } catch { /* 某些 WebView 首次抛错，忽略 */ }
  return voicesCache
}

/** 供设置页列出可选音色 */
export function listVoices(): SpeechSynthesisVoice[] {
  const v = refreshVoices()
  return v.length > 0 ? v : voicesCache
}

export function areVoicesReady(): boolean {
  refreshVoices()
  return voicesReady
}

/** 等 voices 就绪（最多 ~1.2s），解决 WebView 首次 getVoices() 为空 */
async function waitForVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  const v = refreshVoices()
  if (v.length > 0) return v
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve(refreshVoices())
    }
    const timer = window.setTimeout(finish, timeoutMs)
    const onChange = () => {
      const now = refreshVoices()
      if (now.length > 0) {
        window.clearTimeout(timer)
        finish()
      }
    }
    try { window.speechSynthesis.addEventListener?.('voiceschanged', onChange, { once: true }) } catch { /* 老实现忽略 */ }
  })
}

/** 挑一个尽量自然的音色 */
export function pickVoice(lang: string, preferredName?: string): SpeechSynthesisVoice | null {
  const voices = voicesCache.length > 0 ? voicesCache : refreshVoices()
  if (voices.length === 0) return null
  const prefix = lang.split('-')[0].toLowerCase()
  const same = voices.filter(v => v.lang?.toLowerCase().startsWith(prefix))
  if (same.length === 0) return null

  if (preferredName) {
    const exact = same.find(v => v.name === preferredName)
    if (exact) return exact
  }
  const priority = VOICE_PRIORITY[prefix] ?? []
  for (const key of priority) {
    const hit = same.find(v => v.name.toLowerCase().includes(key))
    if (hit) return hit
  }
  // 优先本地音色（离线更稳、延迟更低）
  return same.find(v => v.localService) ?? same[0]
}

/** 中文听写放慢，英文稍快；家长设置优先 */
export function effectiveRate(lang: string, explicit?: number): number {
  if (typeof explicit === 'number') return explicit
  const p = loadVoicePreferences()
  if (p.rate !== null) return p.rate
  return lang.toLowerCase().startsWith('zh') ? 0.82 : 0.92
}

/** 长文本按标点分段，避免 WebView 一次性朗读被截断 */
export function splitForSpeech(text: string, maxLen = 80): string[] {
  const t = String(text ?? '').trim()
  if (t.length <= maxLen) return t ? [t] : []
  const parts = t.split(/(?<=[，。！？；、,.!?;])/u).filter(s => s.trim())
  const out: string[] = []
  let buf = ''
  for (const p of parts) {
    if ((buf + p).length > maxLen && buf) { out.push(buf); buf = '' }
    buf += p
  }
  if (buf) out.push(buf)
  return out
}

/** 当前正在播放的离线音频（切换词条时先停） */
let activeAudio: HTMLAudioElement | null = null
let activeAudioUrl: string | null = null

function stopActiveAudio(): void {
  if (activeAudio) {
    try { activeAudio.pause(); activeAudio.currentTime = 0 } catch { /* 忽略 */ }
    activeAudio = null
  }
  if (activeAudioUrl) {
    try { URL.revokeObjectURL(activeAudioUrl) } catch { /* 忽略 */ }
    activeAudioUrl = null
  }
}

/**
 * 播放离线音频资产；不存在/损坏返回 false，由调用方回退 TTS。
 * 这是「离线语音包兼容能力」的落点：内容包只要在词上写 `audio.path`
 * 并把文件放进 `assets/`，无需改 App 即可生效。
 */
export async function playAudioAsset(
  asset: { packageId: string; path: string },
  opts: { onStart?: () => void; onEnd?: () => void; onError?: (e: any) => void } = {}
): Promise<boolean> {
  stopActiveAudio()
  let blob: Blob | null = null
  try { blob = await loadAssetBlob(asset.packageId, asset.path) } catch { /* 视为不存在 */ }
  if (!blob) return false

  const url = URL.createObjectURL(blob)
  activeAudioUrl = url
  const audio = new Audio(url)
  activeAudio = audio
  const prefs = loadVoicePreferences()
  if (prefs.rate !== null) audio.playbackRate = Math.min(1.5, Math.max(0.5, prefs.rate))

  audio.onplay = () => opts.onStart?.()
  audio.onended = () => { stopActiveAudio(); opts.onEnd?.() }
  audio.onerror = (e) => { stopActiveAudio(); opts.onError?.(e) }
  try {
    await audio.play()
    return true
  } catch (e) {
    stopActiveAudio()
    return false
  }
}

/** 朗读：有离线音频优先，否则系统 TTS */
export async function speak(opts: SpeakOptions): Promise<void> {
  if (opts.audio) {
    const played = await playAudioAsset(opts.audio, {
      onStart: opts.onStart, onEnd: opts.onEnd, onError: opts.onError,
    })
    if (played) return
  }
  if (!isSpeechAvailable()) {
    console.warn('[Speech] 当前环境不支持语音朗读')
    opts.onError?.(new Error('speechSynthesis unavailable'))
    return
  }

  stopActiveAudio()
  window.speechSynthesis.cancel()
  await waitForVoices()

  const lang = opts.lang ?? detectLang(opts.text)
  const prefs = loadVoicePreferences()
  const rate = opts.rate ?? effectiveRate(lang)
  const segments = splitForSpeech(opts.text)
  if (segments.length === 0) return

  const voice = pickVoice(lang, prefs.voiceName || undefined)
  for (let i = 0; i < segments.length; i++) {
    await new Promise<void>(resolve => {
      const u = new SpeechSynthesisUtterance(segments[i])
      u.lang = lang
      u.rate = rate
      u.pitch = opts.pitch ?? 1
      if (voice) u.voice = voice
      if (i === 0) u.onstart = () => opts.onStart?.()
      u.onend = () => {
        if (i === segments.length - 1) opts.onEnd?.()
        resolve()
      }
      u.onerror = e => {
        if (i === segments.length - 1) opts.onError?.(e)
        resolve()
      }
      window.speechSynthesis.speak(u)
    })
  }
}

export function stop(): void {
  stopActiveAudio()
  if (!isSpeechAvailable()) return
  window.speechSynthesis.cancel()
}

export function isSpeaking(): boolean {
  if (activeAudio && !activeAudio.paused) return true
  if (!isSpeechAvailable()) return false
  return window.speechSynthesis.speaking
}
