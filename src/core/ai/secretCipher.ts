/**
 * F1 · API Key 的加密保存（WebCrypto AES-GCM + PBKDF2）
 *
 * ## 为什么是"家长口令 + PBKDF2 + AES-GCM"，而不是系统 Keychain
 *
 * 本仓 Tauri 侧**只装了 `tauri-plugin-log`**（见 `src-tauri/Cargo.toml`），
 * `tauri.conf.json` 也没有 http / keychain 相关的 capabilities。要拿到操作系统
 * 的钥匙串，必须新增 Rust 插件（`tauri-plugin-keychain` 或 `stronghold`）、
 * 补 capabilities 配置、并**重新打包**——那是另一个量级的工作，已单开任务。
 *
 * 所以在真 Keychain 落地之前，这里只有两条路：
 *
 *   - **默认：会话内有效、不落盘**（见 `aiConfig.ts` 的 `sessionApiKey`）。
 *     关掉页面 Key 就没了。零明文落盘，因此**也不需要加密**——
 *     给一个不落盘的东西做加密，只会让代码看起来更安全。
 *   - **可选「记住我的 Key」**：家长输入一个**额外**的口令，用它派生密钥
 *     加密后落盘。口令本身**从不保存**（只落 salt / iv / 密文），
 *     下次要用必须重新输入口令。
 *
 * ## 为什么不能"加密但把口令也存起来"
 * 那就是**假加密**：密文和钥匙放在同一个抽屉里。它能挡住"家长翻 JSON 看到一串
 * sk-xxx"这个最表层的场景，却挡不住任何真正的攻击者，反而让我们在文档里
 * 写下"已加密"三个字。**宁可不落盘，也不做假加密**——这是本文件的第一原则。
 *
 * ## 为什么选 PBKDF2 而不是直接哈希口令
 * 家长口令通常很短很弱。直接 `SHA-256(passphrase)` 当密钥，彩虹表几秒就破。
 * PBKDF2 + 随机 salt + 高迭代把单次猜测的成本抬高几个数量级。
 * 迭代次数取 200k（OWASP 对 PBKDF2-HMAC-SHA256 的下限建议附近）：
 * 本机只做**一次**派生（解锁时），几百毫秒的延迟家长感觉不到。
 */

/** 迭代次数：改这个值会让**已保存**的密文全部解不开（必须同时清掉旧密文） */
export const PBKDF2_ITERATIONS = 200_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface SecretCipher {
  v: 1
  /** base64 */
  salt: string
  /** base64 */
  iv: string
  /** base64（AES-GCM 密文，含 128 位认证标签） */
  data: string
  iterations: number
}

function webcrypto(): Crypto {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto
  if (!c || !c.subtle) {
    const err = new Error('当前环境不支持 WebCrypto（crypto.subtle 不存在）')
    err.name = 'NoWebCrypto'
    throw err
  }
  return c
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number)
  return btoa(s)
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const c = webcrypto()
  const base = await c.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 口令 → 密文包。**只落这个包**，口令本身不落任何地方。 */
export async function encryptSecret(
  plain: string,
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<SecretCipher> {
  if (!passphrase) throw new Error('缺少家长口令')
  const c = webcrypto()
  const salt = c.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = c.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, iterations)
  const cipher = await c.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  )
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)), iterations }
}

/**
 * 密文包 + 口令 → 明文。
 *
 * 口令错或密文被改过都会在这里抛（AES-GCM 的认证标签校验失败）——
 * **这个异常本身就是"口令不对"的证据**，不需要额外存校验值。
 */
export async function decryptSecret(cipher: SecretCipher, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('缺少家长口令')
  const c = webcrypto()
  const key = await deriveKey(passphrase, fromBase64(cipher.salt), cipher.iterations || PBKDF2_ITERATIONS)
  const plain = await c.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(cipher.iv) as BufferSource },
    key,
    fromBase64(cipher.data) as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

/** 形状校验：settings 里读出来的东西不可信（可能被旧版本 / 合并写入弄脏） */
export function isSecretCipher(value: unknown): value is SecretCipher {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<SecretCipher>
  return typeof c.salt === 'string' && typeof c.iv === 'string' && typeof c.data === 'string'
}
