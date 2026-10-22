/**
 * F1 · AI 讲评的失败原因与人话文案（纯数据 + 纯函数）
 *
 * ## 为什么要单独一个文件
 * `aiClient.ts` 负责"怎么失败"（超时、非 2xx、连不上），这个文件负责"怎么说"。
 * 分开的理由和 `src/core/errors/messages.ts` 一样：**每一级失败都必须有可断言的原因**。
 * 全链路都抛 `new Error('出错了')` 的话，UI 只能给家长一句"出错了"——
 * 而"没填 Key"、"网络不通"、"本地模型没启动"这三件事，家长能做的动作完全不同。
 *
 * ## 与 `errors/messages.ts` 的分工
 * 那边是**导入链路**（会给家长看到整批拒绝），这边是**AI 讲评**（失败是可降级的，
 * 最坏情况回退静态解析，不阻塞任何功能）。所以这边的 `hint` 一律是"已经改用……"，
 * 不说"操作失败"——因为功能确实没失败，只是换了引擎。
 */

/** 三个引擎。顺序即优先级 */
export type AiEngine = 'deepseek' | 'ollama' | 'static'

/**
 * 可断言的失败原因。
 *
 * 每个值都必须对应**一种家长能做的动作**，否则它不配成为一个独立的原因：
 *   no-key → 去设置页填 Key；network → 检查网络；ollama-offline → 去开本地模型；
 *   http → 检查 Key 是否有效 / 额度；timeout → 稍后再试。
 */
export type AiFailReason =
  /** 没填 API Key（会话内没有，也没有记住的） */
  | 'no-key'
  /** DeepSeek 在阈值内没返回（含首字节超时） */
  | 'timeout'
  /** 网络层失败（DNS / 断网 / CORS / fetch reject） */
  | 'network'
  /** HTTP 非 2xx（401 = Key 不对，429 = 额度，5xx = 服务端） */
  | 'http'
  /** 返回体不是能解析的流（空响应 / 结构不符） */
  | 'bad-body'
  /** 模型返回了空内容 */
  | 'empty'
  /** 本地 Ollama 探测失败（没启动 / 端口不通） */
  | 'ollama-offline'
  /** 用户主动中断 */
  | 'aborted'
  /** 环境不支持 WebCrypto（只在"记住 Key"时可能出现） */
  | 'no-webcrypto'
  /** 口令错误或密文损坏（AES-GCM 解密失败） */
  | 'bad-passphrase'

export interface AiFailureCopy {
  /** 发生了什么 */
  title: string
  /** 现在怎么办（降级链里还要说清"已经改用……"） */
  hint: string
}

export const AI_FAILURE_TEXT: Record<AiFailReason, AiFailureCopy> = {
  'no-key': {
    title: '还没有设置 AI 的钥匙',
    hint: '到「设置 → 🤖 AI 助手设置」里填一个 API Key 就能用 AI 启发了。现在先用题库自带的解析。',
  },
  timeout: {
    title: '云端 AI 这次响应太慢',
    hint: '已经改用本地模型；本地模型也没起来的话，会用题库自带解析。稍后网络顺畅时可以再点一次。',
  },
  network: {
    title: '连不上云端 AI',
    hint: '网络不通（或浏览器拦截了跨域请求）。已经改用本地模型；本地模型也没起来的话，会用题库自带解析。',
  },
  http: {
    title: '云端 AI 返回了错误',
    hint: '常见是 Key 填错了、或者额度用完了。已经改用本地模型；本地模型也没起来的话，会用题库自带解析。',
  },
  'bad-body': {
    title: '云端 AI 返回的内容读不懂',
    hint: '可能是接口或模型名填错了。已经改用本地模型；本地模型也没起来的话，会用题库自带解析。',
  },
  empty: {
    title: '云端 AI 这次没有给出内容',
    hint: '已经改用本地模型；本地模型也没起来的话，会用题库自带解析。',
  },
  'ollama-offline': {
    title: '本地模型（Ollama）没有启动',
    hint: '本机 11434 端口没有响应。先在电脑上启动 Ollama 再用这个功能；现在先用题库自带解析。',
  },
  aborted: {
    title: '已停止',
    hint: '这次讲评被手动停掉了。再点一次「💡 启发一下」可以重新开始。',
  },
  'no-webcrypto': {
    title: '这个浏览器不支持加密保存',
    hint: 'Key 只在本次使用中有效，关闭页面后需要重新填写。',
  },
  'bad-passphrase': {
    title: '口令不对，或者保存的 Key 已损坏',
    hint: '请重新输入当时设置的家长口令；想不起来就重新填一次 API Key。',
  },
}

/** 引擎的人话名字（UI 上要告诉家长"这条提示是谁给的"） */
export const AI_ENGINE_LABEL: Record<AiEngine, string> = {
  deepseek: '云端 AI（DeepSeek）',
  ollama: '本地模型（Ollama）',
  static: '题库自带解析',
}

/** 单条失败 → 一句话（UI 直接显示；测试可直接断言命中哪一档） */
export function describeAiFailure(reason: AiFailReason): string {
  const copy = AI_FAILURE_TEXT[reason]
  return `${copy.title}：${copy.hint}`
}

/**
 * 降级链里"最值得修"的那一级 → 优先级从高到低。
 *
 * **为什么不是简单取最后一级**：最后一级通常是 `ollama-offline`，而"家里根本没装
 * Ollama"是**常态**（多数家庭永远不会装）。把常态当成"这次失败的原因"报给家长，
 * 等于什么都没说——真正可修的是"没填 Key"或"Key 不对"。
 *
 * 所以按"家长改一下就能好"的程度排序：配置类（no-key / http）> 环境类
 * （timeout / network）> 本地没装（ollama-offline）。
 */
const FAILURE_PRIORITY: readonly AiFailReason[] = [
  'no-key',
  'http',
  'bad-body',
  'empty',
  'timeout',
  'network',
  'no-webcrypto',
  'bad-passphrase',
  'ollama-offline',
  'aborted',
]

/**
 * 降级链 → 给家长看的一句话。
 *
 * 只说**一条**：三条堆在一起，家长看到的是三句互相矛盾的指引（"去填 Key"
 * 与"去开本地模型"同时出现时，他不知道先做哪个）。
 */
export function describeDegradation(failures: readonly { reason: AiFailReason }[]): string {
  if (failures.length === 0) return ''
  for (const reason of FAILURE_PRIORITY) {
    if (failures.some((f) => f.reason === reason)) return describeAiFailure(reason)
  }
  return ''
}
