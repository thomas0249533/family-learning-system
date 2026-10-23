/**
 * A3 · Candle 客户端：把 IPC 的"推送式事件流"包成 `AiReader` 的**拉齐语义**
 * （一次调用 → 逐段回调 → 返回全文），供降级链当第一档使用。
 *
 * ## 为什么要单独一层，而不是让 `aiClient` 直接调 ipc
 * 三个理由，每个都对应一条测试：
 *   1. **可注入**：`ipc` 参数让单测可以塞一个假引擎（chunk 顺序 / error 码 / abort），
 *      不需要 Tauri、不需要跑模型；
 *   2. **失败语义归一到 `AiFailReason`**：Rust 的错误码是 `no-model`/`oom`/…，
 *      上层只认 `AiFailReason`。映射只在这里发生一次，别处不再猜；
 *   3. **"不可用"与"出错"分开**：不可用 → `unavailable`（静默降级，不当成错误报给家长）；
 *      出错 → 具体码。这条区分是 A3 反向验证的立足点。
 */

import type { AiFailReason } from '../aiMessages'
import { CandleError, isCandleAvailable, streamCandleRaw } from './ipc'

/** Rust 错误码 → 家长可理解的原因。未登记的一律落 `bad-body`（"读不懂内容"）。 */
const CODE_TO_REASON: Record<string, AiFailReason> = {
  'no-model': 'no-model',
  oom: 'oom',
  aborted: 'aborted',
  unavailable: 'unavailable',
  'model-corrupt': 'bad-body',
  'decode-failed': 'bad-body',
}

export function reasonOfCandleCode(code: string): AiFailReason {
  return CODE_TO_REASON[code] ?? 'bad-body'
}

/** 客户端层异常：`reason` 已经是 `AiFailReason`，上层不必再解析字符串 */
export class CandleClientError extends Error {
  readonly reason: AiFailReason
  readonly code: string

  constructor(reason: AiFailReason, code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'CandleClientError'
    this.reason = reason
    this.code = code
  }
}

/**
 * 可注入的 IPC 门面。
 *
 * `stream` 是"拉"的等价物：调用方给一个回调，它把增量推回来，最终 resolve 全文；
 * 引擎不可用 resolve `null`；真失败 reject `CandleError`。
 */
export interface CandleIpc {
  available(): boolean
  stream(args: {
    id: string
    prompt: string
    system?: string
    signal?: AbortSignal
    onDelta?: (delta: string) => void
  }): Promise<string | null>
}

/** 生产实现：唯一的 `@tauri-apps/api` 触点被关在 ipc.ts 里 */
export const defaultCandleIpc: CandleIpc = {
  available: isCandleAvailable,
  stream: (args) => streamCandleRaw(args),
}

export interface CandleStreamOptions {
  /** 系统提示（讲评的"启发不代做"约束就写在这里） */
  system?: string
  /** 用户侧完整提示 */
  user: string
  onDelta?: (delta: string) => void
  signal?: AbortSignal
  /** 测试注入点；不传则走真实 Tauri IPC */
  ipc?: CandleIpc
  /** 请求 id（并发隔离用）；不传则自动生成 */
  id?: string
}

let seq = 0

function nextId(): string {
  seq += 1
  return `candle-${Date.now().toString(36)}-${seq}`
}

/**
 * 跑一次本地推理。成功返回全文；失败抛 `CandleClientError`。
 *
 * **空文本也算失败**（`empty`）：模型可能只吐了一个换行就结束 —— 那在界面上
 * 是一段什么都不像的文字，与"引擎没工作"没有差别，应当继续降级。
 */
export async function streamCandle(opts: CandleStreamOptions): Promise<string> {
  const ipc = opts.ipc ?? defaultCandleIpc
  if (!ipc.available()) {
    throw new CandleClientError('unavailable', 'not-tauri')
  }
  if (opts.signal?.aborted) {
    throw new CandleClientError('aborted', 'aborted')
  }

  let text: string | null
  try {
    text = await ipc.stream({
      id: opts.id ?? nextId(),
      prompt: opts.user,
      system: opts.system,
      signal: opts.signal,
      onDelta: opts.onDelta,
    })
  } catch (err) {
    if (err instanceof CandleError) {
      throw new CandleClientError(reasonOfCandleCode(err.code), err.code, err.message)
    }
    throw new CandleClientError('bad-body', 'decode-failed', String(err))
  }

  // null = 引擎不可用（非 Tauri / 命令不存在）—— 不是错误，是"这档没得用"
  if (text === null) {
    throw new CandleClientError('unavailable', 'unavailable')
  }
  if (opts.signal?.aborted) {
    throw new CandleClientError('aborted', 'aborted')
  }
  if (text.trim().length === 0) {
    throw new CandleClientError('empty', 'empty')
  }
  return text
}
