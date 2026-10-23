/**
 * A3 · Candle IPC —— **全仓唯一** import `@tauri-apps/api` 的地方。
 *
 * ## 为什么必须收在一个文件里
 * 这个包是 V2.0 唯一放行的新前端依赖（见方案修正二），但它只能在 Tauri 容器里工作。
 * 一旦被 `Mistakes.vue` / `aiClient.ts` 直接 import，Web 构建与 Node 单测都会在
 * "没有 `window.__TAURI_INTERNALS__`"的环境里把模块求值成半残状态。所以：
 *   ① `isTauri()` 为假 → **直接返回 null**，连 `import()` 都不执行（惰性 + 短路）；
 *   ② 其它模块只依赖本文件导出的函数签名（`CandleIpc`），永远不 import 这个包。
 *
 * ## 为什么一律"不抛"（环境类）
 * 浏览器里打开设置页是很正常的用法。那里没有 Tauri，就不该出现"Rust 命令不存在"
 * 这种吓人的红字 —— 引擎不可用是一个**事实**，不是一次错误。真正来自 Rust 的失败
 * （模型坏了 / 内存不够）才抛 `CandleError`，因为那时家长确实需要知道。
 *
 * ## 监听一定要退订
 * `listen` 返回的 unlisten 不解除，每点一次"启发一下"就多一个监听器，
 * 对话框关掉之后事件还在往旧闭包里灌字。所以 done / error / abort 三条出口
 * 统一走 `settle()` 清理。
 */

import { isTauri } from '@core/pwa/isTauri'

// ===========================================================================
// 事件名与命令名（与 Rust 侧 `ai/inference.rs`、`ai/models.rs` 逐字对应）
// ===========================================================================

export const EV_AI_STREAM_CHUNK = 'ai-stream-chunk'
export const EV_AI_STREAM_DONE = 'ai-stream-done'
export const EV_AI_STREAM_ERROR = 'ai-stream-error'
export const EV_AI_MODEL_PROGRESS = 'ai-model-progress'

/** Rust 侧的错误码（`ai-stream-error` / invoke reject 的前缀） */
export type CandleErrorCode =
  | 'no-model'
  | 'model-corrupt'
  | 'oom'
  | 'decode-failed'
  | 'aborted'
  | 'unavailable'

/** 带错误码的异常：`code` 是契约，`message` 只用于日志 */
export class CandleError extends Error {
  readonly code: string

  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'CandleError'
    this.code = code
  }
}

/** 把 `"model-corrupt: xxx"` 这种 Rust 侧错误串拆成码 + 详情 */
export function parseCodedError(err: unknown): CandleError {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const idx = raw.indexOf(':')
  if (idx > 0) {
    const code = raw.slice(0, idx).trim()
    if (/^[a-z][a-z0-9-]*$/.test(code)) return new CandleError(code, raw.slice(idx + 1).trim())
  }
  return new CandleError('decode-failed', raw)
}

// ===========================================================================
// 惰性加载：非 Tauri 环境连模块都不求值
// ===========================================================================

type CoreModule = typeof import('@tauri-apps/api/core')
type EventModule = typeof import('@tauri-apps/api/event')

interface Bridge {
  core: CoreModule
  event: EventModule
}

let bridgePromise: Promise<Bridge | null> | null = null

async function loadBridge(): Promise<Bridge | null> {
  if (!isTauri()) return null
  if (!bridgePromise) {
    bridgePromise = (async (): Promise<Bridge | null> => {
      try {
        const [core, event] = await Promise.all([
          import('@tauri-apps/api/core'),
          import('@tauri-apps/api/event'),
        ])
        return { core, event }
      } catch {
        // 包不在（例如老版本 exe 里跑新前端）→ 当作不可用，不抛
        return null
      }
    })()
  }
  return bridgePromise
}

/** 同步探测：当前进程能否走 Tauri IPC（设置页首帧就要用它决定渲染哪一态） */
export function isCandleAvailable(): boolean {
  return isTauri()
}

// ===========================================================================
// 推理流
// ===========================================================================

export interface CandleStreamArgs {
  id: string
  prompt: string
  system?: string
  maxNewTokens?: number
  temperature?: number
  topP?: number
  signal?: AbortSignal
  onDelta?: (delta: string) => void
}

interface ChunkPayload {
  id?: string
  delta?: string
  code?: string
}

/**
 * 起一次本地推理，返回**最终全文**。
 *
 * - 非 Tauri / 包缺失 / 命令不存在 / 事件不可用 → `null`（引擎不可用，调用方静默降级）
 * - Rust 报错 → 抛 `CandleError(code)`（`no-model` / `oom` / `model-corrupt` / `decode-failed`）
 * - 主动中断 → 抛 `CandleError('aborted')`（**不降级**：用户按的是停止）
 */
export async function streamCandleRaw(args: CandleStreamArgs): Promise<string | null> {
  const bridge = await loadBridge()
  if (!bridge) return null
  const { invoke } = bridge.core
  const { listen } = bridge.event
  if (typeof invoke !== 'function' || typeof listen !== 'function') return null

  const { id } = args
  let text = ''
  let settled = false
  const unlisteners: Array<() => void> = []

  let resolveDone: (value: string | null) => void = () => {}
  let rejectDone: (err: unknown) => void = () => {}
  const finished = new Promise<string | null>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  function cleanup(): void {
    for (const off of unlisteners.splice(0)) {
      try {
        off()
      } catch {
        /* 已退订过就算了：清理本身不该再造一个错误 */
      }
    }
    args.signal?.removeEventListener('abort', onAbort)
  }

  function settle(run: () => void): void {
    if (settled) return
    settled = true
    cleanup()
    run()
  }

  function onAbort(): void {
    // 先告诉 Rust 停手（置位后下一个 token 就退出），再结束本地等待
    void Promise.resolve(invoke('ai_chat_abort', { id })).catch(() => {})
    settle(() => rejectDone(new CandleError('aborted')))
  }

  try {
    unlisteners.push(
      await listen<ChunkPayload>(EV_AI_STREAM_CHUNK, (ev) => {
        const p = ev.payload
        if (!p || p.id !== id) return // 并发隔离：只认自己那条流
        const delta = typeof p.delta === 'string' ? p.delta : ''
        if (!delta) return
        text += delta
        args.onDelta?.(delta)
      }),
    )
    unlisteners.push(
      await listen<ChunkPayload>(EV_AI_STREAM_DONE, (ev) => {
        if (ev.payload?.id !== id) return
        settle(() => resolveDone(text))
      }),
    )
    unlisteners.push(
      await listen<ChunkPayload>(EV_AI_STREAM_ERROR, (ev) => {
        const p = ev.payload
        if (!p || p.id !== id) return
        const code = typeof p.code === 'string' && p.code ? p.code : 'decode-failed'
        settle(() => rejectDone(new CandleError(code)))
      }),
    )
  } catch {
    cleanup()
    return null
  }

  if (args.signal?.aborted) {
    onAbort()
  } else {
    args.signal?.addEventListener('abort', onAbort, { once: true })
  }

  try {
    await invoke('ai_chat_stream', {
      id,
      prompt: args.prompt,
      system: args.system ?? null,
      maxNewTokens: args.maxNewTokens ?? null,
      temperature: args.temperature ?? null,
      topP: args.topP ?? null,
    })
  } catch {
    // 命令不存在 / 参数不合法（例如老 exe）：当作"这台机器没有这个引擎"
    settle(() => resolveDone(null))
  }

  return finished
}

// ===========================================================================
// 模型管理（设置页用）
// ===========================================================================

export interface CandleModelStatus {
  installed: boolean
  available: boolean
  reason: string
  path: string | null
  fileName: string | null
  sizeBytes: number
  sha256: string | null
  sha256FromCache: boolean
}

export interface ModelProgress {
  received: number
  total: number
}

/** 读模型状态；非 Tauri 返回 null（设置页据此渲染"Web 端不支持"） */
export async function aiModelStatus(): Promise<CandleModelStatus | null> {
  const bridge = await loadBridge()
  if (!bridge) return null
  try {
    return await bridge.core.invoke<CandleModelStatus>('ai_model_status')
  } catch {
    return null
  }
}

/**
 * 下载模型。`onProgress` 会在收到 `ai-model-progress` 时被调用。
 *
 * 失败抛 `CandleError`（`http` / `network` / `model-corrupt` / `io`）—— 下载失败
 * 是家长必须看到的事，不能静默。
 */
export async function aiModelDownload(
  url: string,
  expectedSha256: string,
  onProgress?: (p: ModelProgress) => void,
): Promise<CandleModelStatus | null> {
  const bridge = await loadBridge()
  if (!bridge) return null
  let off: (() => void) | null = null
  if (onProgress) {
    try {
      off = await bridge.event.listen<ModelProgress>(EV_AI_MODEL_PROGRESS, (ev) => {
        const p = ev.payload
        if (!p || typeof p.received !== 'number') return
        onProgress({ received: p.received, total: typeof p.total === 'number' ? p.total : 0 })
      })
    } catch {
      off = null
    }
  }
  try {
    return await bridge.core.invoke<CandleModelStatus>('ai_model_download', {
      url,
      expectedSha256,
    })
  } catch (err) {
    throw parseCodedError(err)
  } finally {
    try {
      off?.()
    } catch {
      /* 忽略 */
    }
  }
}

/** 弹系统文件框选 `.gguf`（弹窗在 Rust 侧，前端拿不到路径）。取消 → 返回当前状态 */
export async function aiModelPick(): Promise<CandleModelStatus | null> {
  const bridge = await loadBridge()
  if (!bridge) return null
  try {
    return await bridge.core.invoke<CandleModelStatus>('ai_model_pick')
  } catch (err) {
    throw parseCodedError(err)
  }
}

export async function aiModelRemove(): Promise<CandleModelStatus | null> {
  const bridge = await loadBridge()
  if (!bridge) return null
  try {
    return await bridge.core.invoke<CandleModelStatus>('ai_model_remove')
  } catch {
    return null
  }
}

/** 后端信息（诊断用；`available` 与讲评同口径） */
export interface CandleBackendInfo {
  available: boolean
  reason: string
  candleVersion: string
  model?: string | null
  sizeBytes?: number
}

export async function aiBackendInfo(): Promise<CandleBackendInfo | null> {
  const bridge = await loadBridge()
  if (!bridge) return null
  try {
    return await bridge.core.invoke<CandleBackendInfo>('ai_backend_info')
  } catch {
    return null
  }
}
