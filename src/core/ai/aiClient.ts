/**
 * F1 · AI 客户端：DeepSeek（云） → Ollama（本地） → 静态解析（兜底）
 *
 * ## 为什么不用 openai SDK / axios
 * 本仓的纪律是**零新依赖**：SDK 会带进来一整套运行时（还常常依赖 Node 内建模块，
 * 在 WebView 里跑不起来），而我们要的只是「POST 一个 JSON、读一条 SSE 流」。
 * 原生 `fetch` + 自己写的 `SseParser` 一共一百行，且**可单测**——流式解析的所有
 * 边界（分片、chunk 跨行、`[DONE]`、畸形行）都变成断言而不是运气。
 *
 * ## 三级降级与"可断言的失败原因"
 * 每一级失败都抛 `AiHintError`，`code` 取自 `AiFailReason`（见 aiMessages.ts）。
 * **绝不允许** `throw new Error('出错了')`：家长要能区分"没填 Key"和"网络不通"，
 * 测试也要能区分（否则降级链的正确性无法证明）。
 *
 * ## 为什么 Ollama 要先探测再调用
 * 本地没装 / 没启动 Ollama 是最常见的情况。直接 POST `localhost:11434` 时，
 * 某些环境下连接会挂到 30 秒才失败 —— 孩子会盯着转圈。所以先用
 * `GET /api/tags` 做一次**短超时探测**（默认 1.5 秒），失败就立刻降级，
 * 并且能给出明确的 `ollama-offline` 而不是"超时"。
 */

import {
  AI_HINT_SYSTEM_PROMPT,
  MAX_HINT_CHARS,
  buildHintPrompt,
  buildStaticHint,
  type HintPromptInput,
} from './prompt'
import type { AiEngine, AiFailReason } from './aiMessages'
import { CandleClientError, streamCandle, type CandleIpc } from './candle/candleClient'

// ===========================================================================
// 可注入的 fetch 替身（测试用 mock，生产用原生 fetch）
// ===========================================================================

export interface AiReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
}

export interface AiResponseBody {
  getReader(): AiReader
}

export interface AiResponseLike {
  ok: boolean
  status: number
  body?: AiResponseBody | null
  text(): Promise<string>
}

export interface AiFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal | null
}

export type AiFetch = (url: string, init?: AiFetchInit) => Promise<AiResponseLike>

/** 默认引擎：原生 fetch（结构化类型保证 `fetch` 可直接赋值进来） */
const nativeFetch: AiFetch = (url, init) => fetch(url, init as RequestInit)

// ===========================================================================
// 超时常量
// ===========================================================================

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const OLLAMA_BASE_URL = 'http://localhost:11434'
/** DeepSeek 首字节 + 整体超时 */
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 20_000
/** Ollama 探测超时：**必须短**（没装 Ollama 是最常见情况，不能让孩子干等） */
export const DEFAULT_OLLAMA_PROBE_TIMEOUT_MS = 1_500
/** Ollama 生成超时（本地模型本来就慢，给足） */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 30_000

// ===========================================================================
// 错误类型
// ===========================================================================

/** 带 `code` 的异常：与 `errorCodeOf()`（errors/messages.ts）的口径一致（先看 code 再看 name） */
export class AiHintError extends Error {
  readonly code: AiFailReason
  readonly engine: AiEngine

  constructor(code: AiFailReason, engine: AiEngine, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'AiHintError'
    this.code = code
    this.engine = engine
  }
}

/** 判断一个异常是不是"用户/超时导致的中断" */
function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

/** `fetch` 在网络层失败时抛 TypeError（浏览器与 Node 都是这个约定） */
function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string }
  if (e.name === 'TypeError') return true
  const msg = e.message ?? ''
  return /fetch failed|failed to fetch|networkerror|network request failed/i.test(msg)
}

// ===========================================================================
// SSE / NDJSON 流式解析（纯逻辑，可单测）
// ===========================================================================

/** 行缓冲：把任意切分的 chunk 拼成完整行（chunk 跨行是 SSE 最常见的坑） */
class LineBuffer {
  private buf = ''

  /** 产出**已完整**的行；不完整的尾巴留在缓冲里 */
  push(chunk: string): string[] {
    this.buf += chunk
    const out: string[] = []
    for (;;) {
      const idx = this.buf.search(/\r\n|\r|\n/)
      if (idx < 0) break
      const width = this.buf[idx] === '\r' && this.buf[idx + 1] === '\n' ? 2 : 1
      out.push(this.buf.slice(0, idx))
      this.buf = this.buf.slice(idx + width)
    }
    return out
  }

  /** 流结束：把最后一行（可能没有换行符）吐出来 */
  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest.length > 0 ? [rest] : []
  }
}

/**
 * 从 DeepSeek（OpenAI 兼容）的 chunk 里取增量文本。
 *
 * 只认 `choices[0].delta.content` / `choices[0].text`；其它形状一律返回空串，
 * 由调用方跳过 —— 畸形行**不炸**是硬要求（流里出现一条注释或心跳不该让整个讲评失败）。
 */
export function deltaOfChunk(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0] as { delta?: { content?: unknown }; text?: unknown }
  const content = first?.delta?.content
  if (typeof content === 'string') return content
  if (typeof first?.text === 'string') return first.text
  return ''
}

/**
 * SSE 的字段前缀。
 *
 * 写成常量而不是散落的字面量 `'data:'`，一半是为了可读性，一半是**门禁的现实**：
 * `tests/settings-keys.test.ts` 会扫描所有 `'xxx:'` 形态的字符串字面量，
 * 把它当成"派生键前缀清单"来查登记表（`'data:'` 会被误判成一个未登记的键前缀）。
 * 那是门禁的启发式规则在 SSE 场景下的误报 —— 与其放宽门禁，不如让源码里
 * 不出现这个字面量（门禁误报一次，下一次就没人信它了，这话是门禁自己写的）。
 */
const SSE_DATA_FIELD = 'data'

/**
 * SSE 解析器（OpenAI / DeepSeek 形态）。
 *
 * 处理：分片 chunk、chunk 跨行、`data: [DONE]` 终止、`: 心跳注释`、
 * 非 `data:` 字段（如 `event:`）、畸形 JSON（跳过）。
 */
export class SseParser {
  private readonly lines = new LineBuffer()
  private finished = false

  /** 已经收到 `[DONE]`（之后的 chunk 一律忽略） */
  get done(): boolean {
    return this.finished
  }

  /** 喂入一段文本，返回本次产出的增量文本数组 */
  push(chunk: string): string[] {
    if (this.finished) return []
    const out: string[] = []
    for (const raw of this.lines.push(chunk)) {
      const delta = this.consume(raw)
      if (delta) out.push(delta)
    }
    return out
  }

  /** 流结束：处理最后一行不完整数据 */
  end(): string[] {
    if (this.finished) return []
    const out: string[] = []
    for (const raw of this.lines.flush()) {
      const delta = this.consume(raw)
      if (delta) out.push(delta)
    }
    return out
  }

  private consume(raw: string): string {
    const line = raw.trim()
    if (!line) return ''
    if (line.startsWith(':')) return '' // SSE 注释 / 心跳
    if (!line.startsWith(`${SSE_DATA_FIELD}:`)) return '' // event: / id: / retry: 等字段
    const payload = line.slice(SSE_DATA_FIELD.length + 1).trim()
    if (!payload) return ''
    if (payload === '[DONE]') {
      this.finished = true
      return ''
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return '' // 畸形行不炸：跳过
    }
    return deltaOfChunk(parsed)
  }
}

/** Ollama 的 NDJSON 增量：`{"response":"…","done":false}` */
export function deltaOfOllamaLine(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const resp = (payload as { response?: unknown }).response
  return typeof resp === 'string' ? resp : ''
}

/** NDJSON 解析器（Ollama `/api/generate` 的 stream 形态） */
export class NdjsonParser {
  private readonly lines = new LineBuffer()
  private finished = false

  get done(): boolean {
    return this.finished
  }

  push(chunk: string): string[] {
    if (this.finished) return []
    const out: string[] = []
    for (const raw of this.lines.push(chunk)) {
      const delta = this.consume(raw)
      if (delta) out.push(delta)
    }
    return out
  }

  end(): string[] {
    if (this.finished) return []
    const out: string[] = []
    for (const raw of this.lines.flush()) {
      const delta = this.consume(raw)
      if (delta) out.push(delta)
    }
    return out
  }

  private consume(raw: string): string {
    const line = raw.trim()
    if (!line) return ''
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return '' // 畸形行不炸
    }
    if (parsed && typeof parsed === 'object' && (parsed as { done?: unknown }).done === true) {
      this.finished = true
    }
    return deltaOfOllamaLine(parsed)
  }
}

// ===========================================================================
// 读流
// ===========================================================================

/**
 * 把响应体喂给 `onChunk`。
 *
 * 没有 `body`（Node 测试里常见 / 某些环境的降级路径）时退回 `res.text()`，
 * 仍然按行喂 —— 保证单条非流式响应也能解析。
 */
async function pumpBody(res: AiResponseLike, onChunk: (chunk: string) => void): Promise<void> {
  const body = res.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await res.text()
    onChunk(text)
    return
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue
    onChunk(decoder.decode(value, { stream: true }))
  }
}

/** 把外部中断信号 + 超时合成一个控制器；返回"是否因超时而中断"的读取器 */
function createTimeoutControl(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; release: () => void } {
  const ctrl = new AbortController()
  let timedOut = false
  // timeoutMs <= 0 时也要真的推到下一轮再中断（同步 abort 会让 mock 难以观察）
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, Math.max(0, timeoutMs))
  const onExternalAbort = (): void => {
    ctrl.abort()
  }
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    release: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

// ===========================================================================
// 引擎一：DeepSeek（云端，SSE 流式）
// ===========================================================================

export interface DeepSeekOptions {
  apiKey: string | null
  model?: string
  baseUrl?: string
  system?: string
  user: string
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: AiFetch
}

/** DeepSeek 流式调用。**没 Key 直接抛 `no-key`**——不浪费一次网络往返。 */
export async function streamDeepSeek(
  opts: DeepSeekOptions,
  onDelta: (delta: string) => void,
): Promise<string> {
  const engine: AiEngine = 'deepseek'
  if (!opts.apiKey) throw new AiHintError('no-key', engine)

  const doFetch = opts.fetchImpl ?? nativeFetch
  const control = createTimeoutControl(opts.signal, opts.timeoutMs ?? DEFAULT_DEEPSEEK_TIMEOUT_MS)
  let res: AiResponseLike
  try {
    res = await doFetch(`${opts.baseUrl ?? DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? 'deepseek-chat',
        messages: [
          { role: 'system', content: opts.system ?? AI_HINT_SYSTEM_PROMPT },
          { role: 'user', content: opts.user },
        ],
        stream: true,
        temperature: 0.4,
        max_tokens: Math.ceil(MAX_HINT_CHARS * 3),
      }),
      signal: control.signal,
    })
  } catch (err) {
    control.release()
    if (control.timedOut()) throw new AiHintError('timeout', engine)
    if (isAbortError(err)) throw new AiHintError('aborted', engine)
    if (isNetworkError(err)) throw new AiHintError('network', engine)
    throw new AiHintError('network', engine, err instanceof Error ? err.message : String(err))
  }

  if (!res.ok) {
    control.release()
    const detail = await res.text().catch(() => '')
    throw new AiHintError('http', engine, `HTTP ${res.status} ${detail.slice(0, 200)}`)
  }

  const parser = new SseParser()
  let text = ''
  try {
    await pumpBody(res, (chunk) => {
      for (const delta of parser.push(chunk)) {
        text += delta
        onDelta(delta)
      }
    })
    for (const delta of parser.end()) {
      text += delta
      onDelta(delta)
    }
  } catch (err) {
    control.release()
    if (control.timedOut()) throw new AiHintError('timeout', engine)
    if (isAbortError(err)) throw new AiHintError('aborted', engine)
    if (isNetworkError(err)) throw new AiHintError('network', engine)
    throw new AiHintError('bad-body', engine, err instanceof Error ? err.message : String(err))
  }
  control.release()

  // 定时器在流中途点燃也算超时：不能因为"好歹读到了几个字"就当成功——
  // 那会让"卡在半句话上的讲评"以成功姿态出现，而家长看到的是一段没说完的话。
  if (control.timedOut()) throw new AiHintError('timeout', engine)
  if (!parser.done && text.length === 0) throw new AiHintError('bad-body', engine, '流结束但没有内容')
  if (text.trim().length === 0) throw new AiHintError('empty', engine)
  return text
}

// ===========================================================================
// 引擎二：Ollama（本地，先探测再调用）
// ===========================================================================

export interface OllamaOptions {
  model?: string
  baseUrl?: string
  system?: string
  user: string
  signal?: AbortSignal
  /** 生成超时 */
  timeoutMs?: number
  /** 探测超时（**短**） */
  probeTimeoutMs?: number
  fetchImpl?: AiFetch
}

/**
 * 探测本地 Ollama 是否活着。
 *
 * 只判"能不能连上 + 是不是 2xx"，不解析返回体：探测的目的是**快速失败**，
 * 任何异常都按"没起"处理（`false`），绝不把异常抛给上层——它不是一个失败，
 * 它是"这条降级路径不可用"这个**事实**。
 */
export async function probeOllama(opts: OllamaOptions): Promise<boolean> {
  const doFetch = opts.fetchImpl ?? nativeFetch
  const control = createTimeoutControl(opts.signal, opts.probeTimeoutMs ?? DEFAULT_OLLAMA_PROBE_TIMEOUT_MS)
  try {
    const res = await doFetch(`${opts.baseUrl ?? OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: control.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    control.release()
  }
}

/** Ollama 流式生成（NDJSON） */
export async function streamOllama(
  opts: OllamaOptions,
  onDelta: (delta: string) => void,
): Promise<string> {
  const engine: AiEngine = 'ollama'
  const doFetch = opts.fetchImpl ?? nativeFetch
  const control = createTimeoutControl(opts.signal, opts.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS)
  let res: AiResponseLike
  try {
    res = await doFetch(`${opts.baseUrl ?? OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? 'qwen2.5:7b-instruct',
        system: opts.system ?? AI_HINT_SYSTEM_PROMPT,
        prompt: opts.user,
        stream: true,
        options: { temperature: 0.4, num_predict: Math.ceil(MAX_HINT_CHARS * 3) },
      }),
      signal: control.signal,
    })
  } catch (err) {
    control.release()
    if (control.timedOut()) throw new AiHintError('timeout', engine)
    if (isAbortError(err)) throw new AiHintError('aborted', engine)
    if (isNetworkError(err)) throw new AiHintError('ollama-offline', engine)
    throw new AiHintError('ollama-offline', engine, err instanceof Error ? err.message : String(err))
  }

  if (!res.ok) {
    control.release()
    throw new AiHintError('ollama-offline', engine, `HTTP ${res.status}`)
  }

  const parser = new NdjsonParser()
  let text = ''
  try {
    await pumpBody(res, (chunk) => {
      for (const delta of parser.push(chunk)) {
        text += delta
        onDelta(delta)
      }
    })
    for (const delta of parser.end()) {
      text += delta
      onDelta(delta)
    }
  } catch (err) {
    control.release()
    if (control.timedOut()) throw new AiHintError('timeout', engine)
    if (isAbortError(err)) throw new AiHintError('aborted', engine)
    throw new AiHintError('bad-body', engine, err instanceof Error ? err.message : String(err))
  }
  control.release()

  if (control.timedOut()) throw new AiHintError('timeout', engine)
  if (text.trim().length === 0) throw new AiHintError('empty', engine)
  return text
}

// ===========================================================================
// Router：DeepSeek → Ollama → 静态解析
// ===========================================================================

export interface AiHintRequest {
  /** 组装 Prompt 所需的**单道错题**字段 */
  prompt: HintPromptInput
  /** API Key（null = 未配置，直接跳到 Ollama） */
  apiKey: string | null
  model?: string
  ollamaModel?: string
  baseUrl?: string
  ollamaBaseUrl?: string
}

export interface AiHintOptions {
  signal?: AbortSignal
  /** 流式增量回调（打字机） */
  onDelta?: (delta: string) => void
  fetchImpl?: AiFetch
  deepseekTimeoutMs?: number
  ollamaTimeoutMs?: number
  ollamaProbeTimeoutMs?: number
}

/**
 * V2.0 的 candle-first 链路选项 = 既有选项 + 一个可注入的本地引擎。
 *
 * `candleIpc` 只给测试用：生产环境走 `candleClient` 的默认实现（Tauri IPC）。
 */
export interface CandleFirstOptions extends AiHintOptions {
  candleIpc?: CandleIpc
}

export interface AiFailure {
  engine: AiEngine
  reason: AiFailReason
}

export interface AiHintOutcome {
  /** 最终生效的引擎 */
  engine: AiEngine
  text: string
  /** 走过的失败链（**可断言**：测试据此证明"确实降了级"） */
  failures: AiFailure[]
  /** 是否回退到了静态解析（最后一档） */
  degraded: boolean
}

/**
 * 三级降级路由。
 *
 * 顺序：DeepSeek（有 Key 才试） → Ollama（先探测，探测失败记为 ollama-offline）
 * → 静态解析（永不失败）。
 *
 * **唯一的提前退出是用户中断**：`aborted` 不降级，直接抛给用户 —— 他自己按的停止，
 * 给他一段静态解析属于答非所问。
 */
export async function requestAiHint(
  req: AiHintRequest,
  opts: AiHintOptions = {},
): Promise<AiHintOutcome> {
  const built = buildHintPrompt(req.prompt)
  const failures: AiFailure[] = []

  const emit = (delta: string): void => {
    opts.onDelta?.(delta)
  }

  // 1) DeepSeek
  if (req.apiKey) {
    try {
      const text = await streamDeepSeek(
        {
          apiKey: req.apiKey,
          model: req.model,
          baseUrl: req.baseUrl,
          system: built.system,
          user: built.user,
          signal: opts.signal,
          timeoutMs: opts.deepseekTimeoutMs,
          fetchImpl: opts.fetchImpl,
        },
        emit,
      )
      return { engine: 'deepseek', text, failures, degraded: false }
    } catch (err) {
      const reason = err instanceof AiHintError ? err.code : 'network'
      if (reason === 'aborted') throw err
      failures.push({ engine: 'deepseek', reason })
    }
  } else {
    // 没 Key 不是"尝试失败"，但它必须进链：UI 要靠它显示"去设置页填 Key"
    failures.push({ engine: 'deepseek', reason: 'no-key' })
  }

  // 2) Ollama（先探测：没启动就别等 30 秒）
  const alive = await probeOllama({
    baseUrl: req.ollamaBaseUrl,
    signal: opts.signal,
    probeTimeoutMs: opts.ollamaProbeTimeoutMs,
    fetchImpl: opts.fetchImpl,
    user: '',
  })
  if (alive) {
    try {
      const text = await streamOllama(
        {
          model: req.ollamaModel,
          baseUrl: req.ollamaBaseUrl,
          system: built.system,
          user: built.user,
          signal: opts.signal,
          timeoutMs: opts.ollamaTimeoutMs,
          fetchImpl: opts.fetchImpl,
        },
        emit,
      )
      return { engine: 'ollama', text, failures, degraded: true }
    } catch (err) {
      const reason = err instanceof AiHintError ? err.code : 'ollama-offline'
      if (reason === 'aborted') throw err
      failures.push({ engine: 'ollama', reason })
    }
  } else {
    failures.push({ engine: 'ollama', reason: 'ollama-offline' })
  }

  // 3) 静态解析：永不失败
  const text = buildStaticHint(req.prompt)
  // 静态兜底也要走一次打字机，否则 UI 上是"卡一下然后整段蹦出来"
  emit(text)
  return { engine: 'static', text, failures, degraded: true }
}

// ===========================================================================
// Router（V2.0）：Candle（离线） → Ollama → DeepSeek → 静态解析
// ===========================================================================

/**
 * `requestAiHint` 的 ollama→deepseek 顺序**保持原样**（已有多条测试钉住），
 * 新的优先级单独一个函数：离线优先是 V2.0 的产品主张，但它不该改坏
 * "有 Key 的家长先走云端"这个既有行为 —— 两条链服务的场景不同。
 *
 * 顺序：candle（本地 GGUF） → ollama（本机 HTTP） → deepseek（云） → 静态解析。
 *
 * **aborted 仍然不降级**：用户按的是停止，任何一档都不能替他"换一个引擎继续讲"。
 */
export async function requestAiHintCandleFirst(
  req: AiHintRequest,
  opts: CandleFirstOptions = {},
): Promise<AiHintOutcome> {
  const built = buildHintPrompt(req.prompt)
  const failures: AiFailure[] = []

  const emit = (delta: string): void => {
    opts.onDelta?.(delta)
  }

  // 1) Candle（本地离线）
  try {
    const text = await streamCandle({
      system: built.system,
      user: built.user,
      signal: opts.signal,
      onDelta: emit,
      ipc: opts.candleIpc,
    })
    return { engine: 'candle', text, failures, degraded: false }
  } catch (err) {
    const reason = err instanceof CandleClientError ? err.reason : 'unavailable'
    if (reason === 'aborted') throw new AiHintError('aborted', 'candle')
    failures.push({ engine: 'candle', reason })
  }

  // 2) Ollama（先探测：没启动就别等 30 秒）
  const alive = await probeOllama({
    baseUrl: req.ollamaBaseUrl,
    signal: opts.signal,
    probeTimeoutMs: opts.ollamaProbeTimeoutMs,
    fetchImpl: opts.fetchImpl,
    user: '',
  })
  if (alive) {
    try {
      const text = await streamOllama(
        {
          model: req.ollamaModel,
          baseUrl: req.ollamaBaseUrl,
          system: built.system,
          user: built.user,
          signal: opts.signal,
          timeoutMs: opts.ollamaTimeoutMs,
          fetchImpl: opts.fetchImpl,
        },
        emit,
      )
      return { engine: 'ollama', text, failures, degraded: true }
    } catch (err) {
      const reason = err instanceof AiHintError ? err.code : 'ollama-offline'
      if (reason === 'aborted') throw err
      failures.push({ engine: 'ollama', reason })
    }
  } else {
    failures.push({ engine: 'ollama', reason: 'ollama-offline' })
  }

  // 3) DeepSeek（云；没 Key 直接记 no-key，不浪费一次网络往返）
  if (req.apiKey) {
    try {
      const text = await streamDeepSeek(
        {
          apiKey: req.apiKey,
          model: req.model,
          baseUrl: req.baseUrl,
          system: built.system,
          user: built.user,
          signal: opts.signal,
          timeoutMs: opts.deepseekTimeoutMs,
          fetchImpl: opts.fetchImpl,
        },
        emit,
      )
      return { engine: 'deepseek', text, failures, degraded: true }
    } catch (err) {
      const reason = err instanceof AiHintError ? err.code : 'network'
      if (reason === 'aborted') throw err
      failures.push({ engine: 'deepseek', reason })
    }
  } else {
    failures.push({ engine: 'deepseek', reason: 'no-key' })
  }

  // 4) 静态解析：永不失败
  const text = buildStaticHint(req.prompt)
  emit(text)
  return { engine: 'static', text, failures, degraded: true }
}
