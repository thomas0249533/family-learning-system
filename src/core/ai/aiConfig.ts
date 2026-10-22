/**
 * F1 · AI 助手配置（settings 读写 + Key 的会话态）
 *
 * ## 这个键为什么是**设备级**（GLOBAL_KEYS）而不是按档案分片
 * AI 配置是**家长的资产**：家里只有一份 API Key、一个模型名，老大老二共用。
 * 按 `profileId` 分片意味着每个孩子要各填一次 Key，而且换孩子时"没填 Key"
 * 会被误判成"这个孩子不能用 AI"。所以这里**刻意不用** `settingsScope.scopedKey()`，
 * 直接登记进 `GLOBAL_KEYS`（见 `tests/settings-keys.test.ts` 的门禁）。
 *
 * ## Key 的两条存放路径（详见 secretCipher.ts 顶部的"为什么不是 Keychain"）
 *   1. **会话内有效（默认）**：`sessionApiKey` 是一个模块级变量，
 *      关掉页面就没了。**不落盘**，所以也**不加密**——给不落盘的东西加密是假的。
 *   2. **记住我的 Key（可选）**：家长口令 → PBKDF2 → AES-GCM，
 *      只把 `{ salt, iv, data }` 落进 settings。**口令本身绝不落盘**，
 *      所以下次打开必须重新输口令才能解锁。
 *
 * ## 为什么配置读写集中在这一个文件
 * `tests/settings-keys.test.ts` 是一道静态扫描门禁：它解析每一个
 * `db.settings.get/put` 的键表达式。散落在 .vue 里的访问点既难解析也难 review；
 * 集中到一处之后，全部访问点就是下面这两个（get 一个、put 一个）。
 */

import { db } from '@/db'
import { decryptSecret, encryptSecret, isSecretCipher, type SecretCipher } from './secretCipher'

/** 设备级 settings 键（已登记进 `GLOBAL_KEYS`） */
export const AI_CONFIG_KEY = 'ai:config'

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b-instruct'

export interface AiConfig {
  v: 1
  /** DeepSeek 模型名 */
  model: string
  /** 本地 Ollama 模型名 */
  ollamaModel: string
  /** 是否曾经"记住"过 Key（用于 UI 提示，不表示当前已解锁） */
  remember: boolean
  /** 加密后的 Key（仅当 remember 为 true 时存在） */
  cipher: SecretCipher | null
}

const DEFAULT_CONFIG: AiConfig = {
  v: 1,
  model: DEFAULT_DEEPSEEK_MODEL,
  ollamaModel: DEFAULT_OLLAMA_MODEL,
  remember: false,
  cipher: null,
}

/**
 * 会话内 Key。**刻意放在模块变量里而不是 settings**：
 * 它的全部语义就是"关掉页面就消失"，一旦落盘就背叛了这个语义。
 */
let sessionApiKey: string | null = null

/** 写入会话（空串按"清除"处理） */
export function setSessionApiKey(key: string): void {
  const trimmed = (key ?? '').trim()
  sessionApiKey = trimmed.length > 0 ? trimmed : null
}

export function getSessionApiKey(): string | null {
  return sessionApiKey
}

export function clearSessionApiKey(): void {
  sessionApiKey = null
}

function normalize(raw: unknown): AiConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  const c = raw as Partial<AiConfig>
  return {
    v: 1,
    model: typeof c.model === 'string' && c.model.trim() ? c.model.trim() : DEFAULT_DEEPSEEK_MODEL,
    ollamaModel:
      typeof c.ollamaModel === 'string' && c.ollamaModel.trim()
        ? c.ollamaModel.trim()
        : DEFAULT_OLLAMA_MODEL,
    remember: c.remember === true && isSecretCipher(c.cipher),
    cipher: isSecretCipher(c.cipher) ? c.cipher : null,
  }
}

/** 读配置。**读失败当没有配置处理**——AI 是加分项，不能因为它拖垮设置页。 */
export async function loadAiConfig(): Promise<AiConfig> {
  try {
    const rec = await db.settings.get(AI_CONFIG_KEY)
    return normalize(rec?.value)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** 写配置（合并式：只覆盖传入的字段） */
export async function saveAiConfig(patch: Partial<AiConfig>): Promise<AiConfig> {
  const current = await loadAiConfig()
  const next: AiConfig = {
    ...current,
    ...patch,
    v: 1,
    // remember 与 cipher 必须自洽：没有密文就谈不上"已记住"
    remember: (patch.remember ?? current.remember) === true && isSecretCipher(patch.cipher ?? current.cipher),
    cipher: patch.cipher !== undefined ? patch.cipher : current.cipher,
  }
  await db.settings.put({ key: AI_CONFIG_KEY, value: next })
  return next
}

/** 是否保存过加密 Key（还没解锁也算） */
export function hasRememberedKey(config: AiConfig): boolean {
  return config.remember && isSecretCipher(config.cipher)
}

/** 「记住我的 Key」：加密后落盘，并把它同时放进会话（本次直接用，不用再解锁） */
export async function rememberApiKey(key: string, passphrase: string): Promise<AiConfig> {
  const cipher = await encryptSecret(key, passphrase)
  setSessionApiKey(key)
  return saveAiConfig({ remember: true, cipher })
}

/** 忘记：清掉密文 + 清掉会话 Key */
export async function forgetRememberedKey(): Promise<AiConfig> {
  clearSessionApiKey()
  return saveAiConfig({ remember: false, cipher: null })
}

/**
 * 用家长口令解锁已保存的 Key。
 *
 * 口令不对时 AES-GCM 会直接抛（认证标签校验失败），这里的语义就是"口令不对"——
 * 不额外存任何可比对的东西（存了就等于给攻击者一个离线爆破的靶子）。
 * 成功时同时写入会话，UI 拿到返回值即可展示"已解锁"。
 */
export async function unlockRememberedKey(passphrase: string): Promise<string> {
  const config = await loadAiConfig()
  if (!hasRememberedKey(config)) throw new Error('本机没有保存过 API Key')
  const key = await decryptSecret(config.cipher as SecretCipher, passphrase)
  setSessionApiKey(key)
  return key
}

/** 当前可用的 Key（会话优先；没解锁就返回 null，由上层降级） */
export function currentApiKey(): string | null {
  return sessionApiKey
}
