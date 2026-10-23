/**
 * A3 · 本地离线引擎（Candle）客户端与 candle-first 降级链（单测）
 * =========================================================================
 * 本文件只证明四件事，多一件都不测（真实推理由用户在 16G 机器上手动验收）：
 *   1. **chunk 缝合**：逐段 delta 的顺序 == 引擎给出的顺序，最终全文 == 拼接；
 *   2. **错误码透传**：Rust 的 `no-model`/`oom`/… 一路传到 `AiFailReason` 不变形；
 *   3. **abort 不降级**：用户按了停止，就不能替他换引擎继续讲；
 *   4. **反向验证**：candle 强制不可用 → `failures[0] === {candle, unavailable}`
 *      且最终文本来自 ollama；再逐级挂掉 → deepseek → 规则。
 *
 * 全程零 Tauri、零真实网络：Tauri 那一侧由 `CandleIpc` 注入替身，
 * ollama/deepseek 由 `fetchImpl` 注入替身（与 ai-hint.test.ts 同一套写法）。
 */

import { describe, expect, it } from 'vitest'
import type { HintPromptInput } from '@core/ai/prompt'
import { AI_ENGINE_LABEL, AI_FAILURE_TEXT, describeDegradation } from '@core/ai/aiMessages'
import {
  requestAiHint,
  requestAiHintCandleFirst,
  type AiFetch,
  type AiFetchInit,
  type AiResponseLike,
} from '@core/ai/aiClient'
import {
  CandleClientError,
  defaultCandleIpc,
  reasonOfCandleCode,
  streamCandle,
  type CandleIpc,
} from '@core/ai/candle/candleClient'
import { CandleError, isCandleAvailable, streamCandleRaw } from '@core/ai/candle/ipc'

// ===========================================================================
// 替身
// ===========================================================================

/** 会吐 chunk 的假本地引擎；`fail` 存在时在吐完 chunk 后抛错 */
function fakeIpc(chunks: string[], opts: { fail?: CandleError; delayMs?: number } = {}): CandleIpc {
  return {
    available: () => true,
    async stream({ onDelta, signal }) {
      for (const c of chunks) {
        if (signal?.aborted) throw new CandleError('aborted')
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        onDelta?.(c)
      }
      if (opts.fail) throw opts.fail
      return chunks.join('')
    },
  }
}

/** 不可用的本地引擎（非 Tauri / 没装包） */
const unavailableIpc: CandleIpc = {
  available: () => false,
  async stream() {
    throw new Error('不该被调用：available() 为假时 stream 必须短路')
  },
}

function hintInput(): HintPromptInput {
  return {
    question: '小明有 12 个苹果，平均分给 3 个小朋友，每人分到几个？',
    correctAnswer: 'A',
    userAnswer: 'B',
    cause: 'knowledge',
    subject: 'math',
    grade: 4,
    explanation: '先算总数再除以人数',
  }
}

interface MockCall {
  url: string
  init?: AiFetchInit
}

function streamOf(chunks: string[]): { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } {
  const enc = new TextEncoder()
  let i = 0
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true }
          const value = enc.encode(chunks[i] as string)
          i += 1
          return { done: false, value }
        },
      }
    },
  }
}

function okStream(chunks: string[]): AiResponseLike {
  return {
    ok: true,
    status: 200,
    body: streamOf(chunks),
    async text() {
      return chunks.join('')
    },
  }
}

function httpError(status: number): AiResponseLike {
  return {
    ok: false,
    status,
    body: null,
    async text() {
      return 'error'
    },
  }
}

interface MockEnv {
  fetchImpl: AiFetch
  calls: MockCall[]
}

function mockEnv(routes: {
  deepseek?: () => AiResponseLike
  ollamaTags?: () => AiResponseLike
  ollamaGenerate?: () => AiResponseLike
}): MockEnv {
  const calls: MockCall[] = []
  const fetchImpl: AiFetch = async (url, init) => {
    calls.push({ url, init })
    if (url.includes('/chat/completions')) {
      if (!routes.deepseek) throw new Error('unexpected deepseek call')
      return routes.deepseek()
    }
    if (url.includes('/api/tags')) {
      if (!routes.ollamaTags) throw new Error('unexpected ollama probe')
      return routes.ollamaTags()
    }
    if (url.includes('/api/generate')) {
      if (!routes.ollamaGenerate) throw new Error('unexpected ollama generate')
      return routes.ollamaGenerate()
    }
    throw new Error(`unexpected url ${url}`)
  }
  return { fetchImpl, calls }
}

const NDJSON_OK = ['{"response":"本地启发","done":false}\n', '{"response":"。","done":true}\n']
const SSE_OK = ['data: {"choices":[{"delta":{"content":"云端启发"}}]}\n', 'data: {"choices":[{"delta":{"content":"。"}}]}\n', 'data: [DONE]\n\n']

// ===========================================================================
// 1 · 客户端：chunk 缝合 / done 收尾 / 错误码 / abort
// ===========================================================================

describe('A3 · streamCandle（注入式 IPC）', () => {
  it('chunk 按顺序到达，onDelta 的顺序与引擎一致，最终全文是拼接结果', async () => {
    const deltas: string[] = []
    const text = await streamCandle({
      user: '问题',
      ipc: fakeIpc(['【先想', '这一步】', '先说出知识点', '。']),
      onDelta: (d) => deltas.push(d),
    })
    expect(deltas).toEqual(['【先想', '这一步】', '先说出知识点', '。'])
    expect(text).toBe('【先想这一步】先说出知识点。')
    // 不是"一次性给出整段"：至少分两次到达
    expect(deltas.length).toBeGreaterThan(1)
  })

  it('done 收尾：把所有 delta 拼起来 == 返回值（前端不必自己再拼一次）', async () => {
    const deltas: string[] = []
    const text = await streamCandle({
      user: '问题',
      ipc: fakeIpc(['甲', '乙', '丙']),
      onDelta: (d) => deltas.push(d),
    })
    expect(deltas.join('')).toBe(text)
  })

  it('错误码透传：no-model / oom / model-corrupt / decode-failed 各自落到对应 reason', async () => {
    const cases: Array<[string, string]> = [
      ['no-model', 'no-model'],
      ['oom', 'oom'],
      ['model-corrupt', 'bad-body'],
      ['decode-failed', 'bad-body'],
    ]
    for (const [code, reason] of cases) {
      const err = await streamCandle({
        user: '问题',
        ipc: fakeIpc(['半句'], { fail: new CandleError(code) }),
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CandleClientError)
      expect((err as CandleClientError).reason).toBe(reason)
      expect((err as CandleClientError).code).toBe(code)
    }
  })

  it('未知错误码不猜：一律落 bad-body，绝不冒泡成"未处理的异常"', () => {
    expect(reasonOfCandleCode('something-new')).toBe('bad-body')
    expect(reasonOfCandleCode('oom')).toBe('oom')
  })

  it('abort：传进来的 signal 已中断时立刻以 aborted 失败，不再产字', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const deltas: string[] = []
    const err = await streamCandle({
      user: '问题',
      signal: ctrl.signal,
      ipc: fakeIpc(['不该出现'], { delayMs: 1 }),
      onDelta: (d) => deltas.push(d),
    }).catch((e: unknown) => e)
    expect((err as CandleClientError).reason).toBe('aborted')
    expect(deltas).toEqual([])
  })

  it('空文本按失败处理（一个字都不吐的"成功"没有意义，应当继续降级）', async () => {
    const err = await streamCandle({ user: '问题', ipc: fakeIpc(['   ']) }).catch((e: unknown) => e)
    expect((err as CandleClientError).reason).toBe('empty')
  })
})

describe('A3 · ipc.ts 在非 Tauri 环境必须短路（Node 里就是非 Tauri）', () => {
  it('isCandleAvailable() 为假，streamCandleRaw 返回 null 而不是抛', async () => {
    expect(typeof globalThis.window).toBe('undefined')
    expect(isCandleAvailable()).toBe(false)
    await expect(
      streamCandleRaw({ id: 'x', prompt: '你好', onDelta: () => { throw new Error('不该收到 chunk') } }),
    ).resolves.toBeNull()
  })

  it('默认 CandleIpc 在 Node 里 → unavailable（真实生产路径，不是替身）', async () => {
    expect(defaultCandleIpc.available()).toBe(false)
    const err = await streamCandle({ user: '问题' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CandleClientError)
    expect((err as CandleClientError).reason).toBe('unavailable')
    expect((err as CandleClientError).code).toBe('not-tauri')
  })
})

// ===========================================================================
// 2 · 降级链反向验证：candle → ollama → deepseek → 规则
// ===========================================================================

describe('A3 · candle-first 降级链（candle 强制不可用）', () => {
  it('candle 不可用 → failures[0] 是 candle/unavailable，最终文本来自 ollama', async () => {
    const env = mockEnv({
      ollamaTags: () => ({ ok: true, status: 200, body: null, async text() { return '{}' } }),
      ollamaGenerate: () => okStream(NDJSON_OK),
    })
    const out = await requestAiHintCandleFirst(
      { prompt: hintInput(), apiKey: null },
      { fetchImpl: env.fetchImpl, candleIpc: unavailableIpc },
    )
    expect(out.failures[0]).toEqual({ engine: 'candle', reason: 'unavailable' })
    expect(out.engine).toBe('ollama')
    expect(out.text).toBe('本地启发。')
    expect(out.degraded).toBe(true)
    // 确实没走云端：只有 ollama 的两条请求
    expect(env.calls.map((c) => c.url.includes('/api/'))).toEqual([true, true])
  })

  it('candle 装了但没模型（no-model）→ 该原因进链，仍然降级到 ollama', async () => {
    const env = mockEnv({
      ollamaTags: () => ({ ok: true, status: 200, body: null, async text() { return '{}' } }),
      ollamaGenerate: () => okStream(NDJSON_OK),
    })
    const out = await requestAiHintCandleFirst(
      { prompt: hintInput(), apiKey: null },
      { fetchImpl: env.fetchImpl, candleIpc: fakeIpc([], { fail: new CandleError('no-model') }) },
    )
    expect(out.failures[0]).toEqual({ engine: 'candle', reason: 'no-model' })
    expect(out.engine).toBe('ollama')
  })

  it('ollama 也挂 → 落到 deepseek（有 Key）', async () => {
    const env = mockEnv({
      ollamaTags: () => httpError(500),
      deepseek: () => okStream(SSE_OK),
    })
    const out = await requestAiHintCandleFirst(
      { prompt: hintInput(), apiKey: 'sk-test' },
      { fetchImpl: env.fetchImpl, candleIpc: unavailableIpc },
    )
    expect(out.failures.map((f) => `${f.engine}/${f.reason}`)).toEqual([
      'candle/unavailable',
      'ollama/ollama-offline',
    ])
    expect(out.engine).toBe('deepseek')
    expect(out.text).toBe('云端启发。')
  })

  it('三级 AI 全挂 → 规则引擎兜底，且失败链完整可断言', async () => {
    const env = mockEnv({ ollamaTags: () => httpError(500) })
    const out = await requestAiHintCandleFirst(
      { prompt: hintInput(), apiKey: null },
      { fetchImpl: env.fetchImpl, candleIpc: unavailableIpc },
    )
    expect(out.engine).toBe('static')
    expect(out.failures).toEqual([
      { engine: 'candle', reason: 'unavailable' },
      { engine: 'ollama', reason: 'ollama-offline' },
      { engine: 'deepseek', reason: 'no-key' },
    ])
    expect(out.text).toContain('【先想这一步】')
    expect(out.text).toContain('先算总数再除以人数')
    // 没 Key 不该白发一次网络请求
    expect(env.calls.some((c) => c.url.includes('/chat/completions'))).toBe(false)
  })

  it('candle 成功时 degraded=false，且完全不碰网络', async () => {
    const env = mockEnv({})
    const out = await requestAiHintCandleFirst(
      { prompt: hintInput(), apiKey: 'sk-test' },
      { fetchImpl: env.fetchImpl, candleIpc: fakeIpc(['离线', '启发']) },
    )
    expect(out.engine).toBe('candle')
    expect(out.text).toBe('离线启发')
    expect(out.failures).toEqual([])
    expect(out.degraded).toBe(false)
    expect(env.calls).toEqual([])
  })

  it('aborted 不降级：用户按了停止，不允许偷偷换引擎继续讲', async () => {
    const ctrl = new AbortController()
    const env = mockEnv({
      ollamaTags: () => ({ ok: true, status: 200, body: null, async text() { return '{}' } }),
    })
    const slow: CandleIpc = {
      available: () => true,
      async stream({ signal }) {
        await new Promise((_r, reject) => {
          const stop = (): void => reject(new CandleError('aborted'))
          if (signal?.aborted) stop()
          else signal?.addEventListener('abort', stop, { once: true })
        })
        return ''
      },
    }
    const promise = requestAiHintCandleFirst(
      { prompt: hintInput(), apiKey: null },
      { fetchImpl: env.fetchImpl, candleIpc: slow, signal: ctrl.signal },
    )
    await new Promise((r) => setTimeout(r, 10))
    ctrl.abort()
    await expect(promise).rejects.toMatchObject({ code: 'aborted', engine: 'candle' })
    // 没有降级：ollama 一次都没被问
    expect(env.calls).toEqual([])
  })
})

// ===========================================================================
// 3 · 既有语义没被改坏
// ===========================================================================

describe('A3 · 既有 requestAiHint 的顺序保持 deepseek → ollama', () => {
  it('有 Key 时先走云端（不因为新链而变成 ollama 优先）', async () => {
    const env = mockEnv({
      deepseek: () => okStream(SSE_OK),
      ollamaTags: () => httpError(500),
    })
    const out = await requestAiHint({ prompt: hintInput(), apiKey: 'sk-test' }, { fetchImpl: env.fetchImpl })
    expect(out.engine).toBe('deepseek')
    expect(env.calls[0]?.url).toContain('/chat/completions')
  })
})

describe('A3 · aiMessages 扩宽后的文案完整性', () => {
  it("AiEngine 含 'candle'，且四种引擎都有中文标签", () => {
    expect(AI_ENGINE_LABEL.candle).toBe('本地离线 AI')
    expect(Object.keys(AI_ENGINE_LABEL).sort()).toEqual(['candle', 'deepseek', 'ollama', 'static'])
  })

  it('新增的三个原因都有人话文案，且 candle 不可用说的是"已改用其他方式"', () => {
    for (const reason of ['unavailable', 'no-model', 'oom'] as const) {
      expect(AI_FAILURE_TEXT[reason].title.length).toBeGreaterThan(0)
      expect(AI_FAILURE_TEXT[reason].hint.length).toBeGreaterThan(0)
    }
    expect(describeDegradation([{ reason: 'unavailable' }])).toContain('改用')
  })

  it('降级链里"最值得修"的仍是配置类：no-key 优先于没装模型', () => {
    const line = describeDegradation([{ reason: 'no-model' }, { reason: 'no-key' }])
    expect(line).toContain('AI 助手设置')
  })
})
