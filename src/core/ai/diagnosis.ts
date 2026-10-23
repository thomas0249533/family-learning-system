/**
 * G2 · AI 批量错题诊断 —— 三级降级路由
 *
 * ## 结构照抄 `requestAiHint`（aiClient.ts），为什么不再包一层通用路由
 * F1 与 G2 的降级语义**相同**（DeepSeek → Ollama → 本地兜底；aborted 不降级），
 * 但**最后一级完全不同**：F1 兜"题库自带解析"（要题目字段），G2 兜"本地统计报告"
 * （只要统计摘要）。强行抽公共路由会把两种输入类型搅在一起，类型层面的
 * 隐私边界（见 diagnosisPrompt.ts）就糊了。两份 90 行的相似代码，好过一个
 * 靠泛型续命的路由 —— 这笔账本仓已经算过一次（weeklyCardExporter 顶部）。
 *
 * ## 可断言的失败链
 * 每一级失败都进 `failures`（engine + reason），测试据此证明"确实降了级"；
 * 唯一的提前退出是**用户中断**：`aborted` 原样抛出，绝不降级 ——
 * 家长自己按的停止，给他一份自动生成的报告属于答非所问。
 *
 * ## 引擎名与文案
 * `AiEngine` 的第三档叫 `static`（"题库自带解析"），对诊断报告不成立，
 * 所以这里单独定义 `DiagnosisEngine`，第三档叫 `rules`（本地规则引擎）。
 * 失败原因的人话**直接复用** `describeDegradation()`（aiMessages.ts）：
 * "没填 Key 去设置页"、"网络不通"这些动作指引与单题场景一字不差。
 */

import {
  AiHintError,
  probeOllama,
  streamDeepSeek,
  streamOllama,
  type AiFetch,
} from './aiClient'
import type { AiFailReason } from './aiMessages'
import {
  buildDiagnosisPrompt,
  buildLocalDiagnosis,
  type DiagnosisSummaryInput,
} from './diagnosisPrompt'

/** 三个引擎。顺序即优先级；第三档是本地规则引擎（离线、永不失败） */
export type DiagnosisEngine = 'deepseek' | 'ollama' | 'rules'

/** 引擎的人话名字（UI 上告诉家长"这份报告是谁给的"） */
export const DIAGNOSIS_ENGINE_LABEL: Record<DiagnosisEngine, string> = {
  deepseek: '云端 AI（DeepSeek）',
  ollama: '本地模型（Ollama）',
  rules: '本地统计诊断（离线）',
}

/** 走过的失败链的一条记录（第三档永不失败，所以 engine 只有两云取值） */
export interface DiagnosisFailure {
  engine: 'deepseek' | 'ollama'
  reason: AiFailReason
}

export interface DiagnosisRequest {
  /** 统计摘要（类型上就塞不进姓名 / 档案 id / 题干，见 diagnosisPrompt.ts） */
  summary: DiagnosisSummaryInput
  /** API Key（null = 未配置，直接跳到 Ollama） */
  apiKey: string | null
  model?: string
  ollamaModel?: string
  baseUrl?: string
  ollamaBaseUrl?: string
}

export interface DiagnosisOptions {
  signal?: AbortSignal
  /** 流式增量回调（打字机） */
  onDelta?: (delta: string) => void
  fetchImpl?: AiFetch
  deepseekTimeoutMs?: number
  ollamaTimeoutMs?: number
  ollamaProbeTimeoutMs?: number
}

export interface DiagnosisOutcome {
  /** 最终生效的引擎 */
  engine: DiagnosisEngine
  text: string
  /** 走过的失败链（**可断言**） */
  failures: DiagnosisFailure[]
  /** 是否降了级（rules 恒为 true） */
  degraded: boolean
}

/**
 * 三级降级路由：DeepSeek（有 Key 才试）→ Ollama（先探测）→ 本地规则引擎（永不失败）。
 */
export async function requestDiagnosis(
  req: DiagnosisRequest,
  opts: DiagnosisOptions = {},
): Promise<DiagnosisOutcome> {
  const built = buildDiagnosisPrompt(req.summary)
  const failures: DiagnosisFailure[] = []

  const emit = (delta: string): void => {
    opts.onDelta?.(delta)
  }

  // 1) DeepSeek（没 Key 不浪费一次网络往返，但必须进失败链：UI 靠它提示"去填 Key"）
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
    failures.push({ engine: 'deepseek', reason: 'no-key' })
  }

  // 2) Ollama（先短超时探测：没启动是常态，不能让孩子干等 30 秒）
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

  // 3) 本地规则引擎：纯统计拼装，永不失败
  const text = buildLocalDiagnosis(req.summary)
  // 兜底也走一次打字机：否则 UI 上是"卡一下整段蹦出来"
  emit(text)
  return { engine: 'rules', text, failures, degraded: true }
}
