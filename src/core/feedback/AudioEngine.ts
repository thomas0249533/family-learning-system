// =====================================================================
// AudioEngine · 事件音效实时合成（V2.11 · 多邻国风「跃动心流」）
// ---------------------------------------------------------------------
// 设计铁律（与 NoiseGenerator 同源，见 src/core/focus/NoiseGenerator.ts）：
//   1. **零外部音频资源**：全部用 OscillatorNode 现场合成，仓库里不出现
//      .mp3/.wav。这样安装包不膨胀、也无需处理音频版权。
//   2. **首次交互才建 ctx**：浏览器策略下 AudioContext 在无用户手势时是
//      suspended，创建了也无声。本引擎在第一次 play* 时惰性创建并 resume()。
//   3. **测试环境必须静音**：Playwright 的 `navigator.webdriver === true`，
//      无头环境里真的建 AudioContext + 出声会拖慢/污染，甚至触发
//      `NotAllowedError`。故检测到 webdriver 直接短路（见 isAudioSuppressed）。
//   4. **绝不抛出**：音效是「锦上添花」，任何失败都必须静默吞掉，不能因为
//      播放失败把答题流程带崩。
//   5. **可注入**：构造函数接收 AudioContext 或工厂，单测传 mock 即可全路径
//      覆盖，不需要真实声卡。
// =====================================================================

/** 单个音效的合成参数（频率、波形、包络）。 */
interface ToneSpec {
  /** 起始频率（Hz） */
  freqStart: number
  /** 结束频率（Hz）；与起始相同表示不滑音 */
  freqEnd: number
  /** 波形：Sine 干净、Triangle 略闷、Square 硬 */
  type: OscillatorType
  /** 峰值增益（0~1），过高会破音 */
  peak: number
  /** 起音时长（秒），过短会有「咔」的爆音 */
  attack: number
  /** 衰减时长（秒） */
  decay: number
  /** 低通截止频率（Hz）；省略则不接滤波器 */
  lowpass?: number
}

/**
 * 三种关键音效的参数表。
 *
 * · correct「叮」：Sine 880→1320 上行两度滑音，8ms 起音 + 280ms 衰减。
 *   上行音程在听觉上天然对应「完成 / 正确」，这是多邻国 Ding 的核心。
 * · wrong「嗡」：Triangle 196→146 **下行**，加 900Hz 低通滤掉高频毛刺，
 *   听着闷而不刺耳。刻意不用锯齿波——那是「错误警报」，会吓到孩子。
 * · click「哒」：Square 极短脉冲（30ms），只做按钮的触感确认。
 */
const TONES: Record<'correct' | 'wrong' | 'click', ToneSpec> = {
  correct: {
    freqStart: 880,
    freqEnd: 1320,
    type: 'sine',
    peak: 0.22,
    attack: 0.008,
    decay: 0.28,
  },
  wrong: {
    freqStart: 196,
    freqEnd: 146,
    type: 'triangle',
    peak: 0.18,
    attack: 0.012,
    decay: 0.34,
    lowpass: 900,
  },
  click: {
    freqStart: 1046,
    freqEnd: 1046,
    type: 'square',
    peak: 0.1,
    attack: 0.002,
    decay: 0.03,
  },
}

export type FeedbackSound = keyof typeof TONES

export interface AudioEngineOptions {
  /** 注入 AudioContext，或传工厂延迟创建（单测传 mock）。 */
  context?: AudioContext | (() => AudioContext)
  /** 强制静音（优先级高于 webdriver 检测） */
  muted?: boolean
  /** 主音量 0~1，默认 1（各音效的 peak 已单独调过） */
  volume?: number
}

/**
 * 当前环境是否必须静音。
 *
 * 命中 `navigator.webdriver === true` 即判定为自动化环境（Playwright /
 * Puppeteer / 部分 CI 容器）。这是**唯一**可静态判定的可靠信号——不要试图
 * 用 `AudioContext.state === 'suspended'` 判断，用户没交互时它也是 suspended。
 */
export function isAudioSuppressed(): boolean {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & { webdriver?: boolean }
  return nav.webdriver === true
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private readonly source: AudioContext | (() => AudioContext) | null
  private readonly volume: number
  private muted: boolean
  /** 构造 ctx 失败过一次就不再重试，避免每次答题都抛异常 */
  private broken = false

  constructor(options: AudioEngineOptions = {}) {
    this.source = options.context ?? null
    this.volume = clamp01(options.volume ?? 1)
    this.muted = options.muted ?? isAudioSuppressed()
  }

  /** 外部开关（设置页「音效」）与生命周期控制 */
  setMuted(muted: boolean): void {
    this.muted = muted
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** 答对「叮」 */
  playCorrect(): void {
    this.play('correct')
  }

  /** 答错「嗡」 */
  playWrong(): void {
    this.play('wrong')
  }

  /** 按钮「哒」 */
  playClick(): void {
    this.play('click')
  }

  /** 播放指定音效；任何异常静默吞掉（铁律 #4） */
  play(name: FeedbackSound): void {
    if (this.muted || this.broken) return
    const ctx = this.ensureContext()
    if (!ctx) return
    try {
      // 铁律 #2：每次播放前唤醒（用户切后台再回来时 ctx 会重新 suspended）
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      this.scheduleTone(ctx, TONES[name])
    } catch {
      // 静默：音效失败绝不影响答题
    }
  }

  /**
   * 释放。AudioContext 不会自动 GC，长期持有会占用音频线程。
   * 本应用约定：应用卸载/测试收尾时调用，不在每次答题后销毁。
   */
  destroy(): void {
    const ctx = this.ctx
    this.ctx = null
    if (!ctx) return
    try {
      void ctx.close().catch(() => {})
    } catch {
      // ignore
    }
  }

  // ---------- 内部 ----------

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (this.broken) return null
    try {
      const src = this.source
      this.ctx = typeof src === 'function' ? src() : src ?? new AudioContext()
      return this.ctx
    } catch {
      this.broken = true
      return null
    }
  }

  private scheduleTone(ctx: AudioContext, spec: ToneSpec): void {
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = spec.type
    osc.frequency.setValueAtTime(spec.freqStart, t0)
    const end = t0 + spec.attack + spec.decay
    if (spec.freqEnd !== spec.freqStart) {
      // exponentialRamp 要求正数，故终值不会是 0
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), end)
    }

    // ⚠️ exponentialRampToValueAtTime 不能从 0 起跳，惯例用极小正数
    const peak = Math.max(0.0001, spec.peak * this.volume)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + spec.attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    let tail: AudioNode = gain
    if (spec.lowpass) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(spec.lowpass, t0)
      gain.connect(filter)
      tail = filter
    }
    osc.connect(gain)
    tail.connect(ctx.destination)

    osc.start(t0)
    // 多留 20ms 余量，避免在衰减末尾被硬切产生爆音
    osc.stop(end + 0.02)
  }
}

/**
 * 全局单例。
 *
 * 为什么共享：WebView2 对同时存在的 AudioContext 数量有上限（约 6 个），
 * FocusMode 的白噪音已占一个。音效若每处 new 一个实例，很快会撞上限且
 * 无法统一静音。所有组件一律走本函数，不要自行 new。
 */
let shared: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!shared) shared = new AudioEngine()
  return shared
}

/** 仅测试用：清掉单例，避免用例之间互相污染 */
export function resetAudioEngineForTest(engine: AudioEngine | null = null): void {
  shared = engine
}
