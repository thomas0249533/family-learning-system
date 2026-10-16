/**
 * 语音朗读服务（基于 Web Speech API）
 * 支持：中文 / 英文 朗读
 */

export interface SpeakOptions {
  text: string
  lang?: string
  rate?: number
  pitch?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (e: any) => void
}

export function isSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}



/** 语种推断 */
export function detectLang(text: string): string {
  // 有中文 → zh-CN
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN'
  return 'en-US'
}

/** 朗读 */
export function speak(opts: SpeakOptions): void {
  if (!isSpeechAvailable()) {
    console.warn('[Speech] 当前环境不支持语音朗读')
    return
  }

  // 停止当前朗读
  window.speechSynthesis.cancel()

  const u = new SpeechSynthesisUtterance(opts.text)
  u.lang = opts.lang ?? detectLang(opts.text)
  u.rate = opts.rate ?? 1
  u.pitch = opts.pitch ?? 1

  // 尽量选择匹配的语音
  const voices = window.speechSynthesis.getVoices()
  const prefix = u.lang.split('-')[0]
  const match = voices.find(v => v.lang.toLowerCase().startsWith(prefix.toLowerCase()))
  if (match) u.voice = match

  if (opts.onStart) u.onstart = opts.onStart
  if (opts.onEnd) u.onend = opts.onEnd
  if (opts.onError) u.onerror = opts.onError

  
  window.speechSynthesis.speak(u)
}

/** 停止 */
export function stop(): void {
  if (!isSpeechAvailable()) return
  window.speechSynthesis.cancel()
  
}

/** 是否正在朗读 */
export function isSpeaking(): boolean {
  if (!isSpeechAvailable()) return false
  return window.speechSynthesis.speaking
}