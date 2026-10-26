// =====================================================================
// NoiseGenerator · 纯前端白噪音引擎（V2.2 · 轨道 H）
// ---------------------------------------------------------------------
// 设计铁律（用户明确要求）：
//   1. 纯前端、零依赖：音频全部用 Web Audio API **实时合成**，
//      绝不引入 .mp3/.wav 等音频文件。
//   2. 浏览器在无用户交互时 AudioContext 处于 suspended（无声）。
//      必须在用户点击「开启雨声」时 await ctx.resume()。
//   3. 销毁即释放：destroy() 必须 stop 所有 source、disconnect 所有节点、
//      并 ctx.close()，否则退出专注模式会内存泄漏（AudioContext 永不 GC）。
//
// 可测试性：构造函数接收可注入的 AudioContext 或工厂函数，便于单测传 mock。
// 真实使用：new NoiseGenerator() 或 new NoiseGenerator({ context: () => new AudioContext() })。
// =====================================================================

/** 可播放的噪音种类（UI 里的「关」用 'off' 单独表示，不在此枚举内） */
export type NoiseKind = 'white' | 'pink' | 'rain' | 'campfire' | 'ocean' | 'stream'

/**
 * 当前正在播放什么。`'custom'` 表示用户导入的本地音频（见 `startBuffer`）——
 * 它不是"合成噪音"，所以不进 `NoiseKind`：UI 上仍要区分"系统音源 / 我的音频"。
 */
export type PlayingKind = NoiseKind | 'custom'

export interface NoiseGeneratorConfig {
  /** 注入 AudioContext（单测传 mock），或传工厂函数延迟创建。真实使用留空即可。 */
  context?: AudioContext | (() => AudioContext)
  /** 淡入/淡出时长（秒），默认 0.8，避免爆音 */
  fadeSeconds?: number
  /** 初始目标音量 0~1，默认 0.5 */
  volume?: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export class NoiseGenerator {
  private readonly ctx: AudioContext
  private readonly fadeSeconds: number
  private targetVolume: number

  private source: AudioBufferSourceNode | null = null
  private filterChain: AudioNode[] = []
  private masterGain: GainNode | null = null
  private currentKind: NoiseKind | null = null
  private crackleTimer: ReturnType<typeof setTimeout> | null = null
  /** V2.7 起：慢速 LFO（海浪/水泡/雨声游移）。销毁时必须一起停，否则 CPU 空转 */
  private lfos: { osc: OscillatorNode; gain: GainNode }[] = []
  /** 当前播放的是不是用户导入的音频 */
  private customPlaying = false

  constructor(config: NoiseGeneratorConfig = {}) {
    const ctxInput = config.context ?? (() => new AudioContext())
    this.ctx = typeof ctxInput === 'function' ? ctxInput() : ctxInput
    this.fadeSeconds = config.fadeSeconds ?? 0.8
    this.targetVolume = clamp(config.volume ?? 0.5, 0, 1)
  }

  // ---------- 公共 API ----------

  /**
   * 开启某种噪音（用户点击音源按钮时调用）。
   * 内部会 await ctx.resume()，确保 suspended 状态被唤醒（铁律 #2）。
   */
  async start(kind: NoiseKind, options: { volume?: number } = {}): Promise<void> {
    if (options.volume !== undefined) this.targetVolume = clamp(options.volume, 0, 1)

    // 切源前先停掉旧的（立即、同步），避免多个 source 叠加
    this.teardownNodes()

    const buffer = this.createBufferFor(kind)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const filters = this.buildFilterChain(kind)
    this.filterChain = filters

    // 主增益：先置 0，再线性淡入到目标音量（铁律 #1：避免爆音）
    const gain = this.ctx.createGain()
    const now = this.ctx.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.targetVolume, now + this.fadeSeconds)

    // 连接链：source -> filter(s) -> gain -> destination
    let prev: AudioNode = source
    for (const f of filters) {
      prev.connect(f)
      prev = f
    }
    prev.connect(gain)
    gain.connect(this.ctx.destination)

    this.source = source
    this.masterGain = gain
    this.currentKind = kind
    this.customPlaying = false

    // V2.7：叠加慢速调制，把"一片死噪声"变成"有呼吸的环境音"
    this.applyModulation(kind, filters)

    // 铁律 #2：用户交互后恢复上下文（suspended 状态下无声）
    await this.ctx.resume()
    source.start()

    if (kind === 'campfire') this.scheduleCrackle()
  }

  /**
   * 播放一段**外部解码好的音频**（用户导入的 MP3 / M4A …）。
   *
   * 与 `start` 共用同一条主增益与淡入逻辑，所以音量滑块、切源、销毁的行为完全一致。
   * 刻意不接受 URL：`decodeAudioData` 之后就没有 objectURL 需要 revoke 了 ——
   * 少一条"忘记释放"的路径。
   */
  async startBuffer(buffer: AudioBuffer, options: { volume?: number } = {}): Promise<void> {
    if (options.volume !== undefined) this.targetVolume = clamp(options.volume, 0, 1)

    this.teardownNodes()

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const gain = this.ctx.createGain()
    const now = this.ctx.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.targetVolume, now + this.fadeSeconds)

    source.connect(gain)
    gain.connect(this.ctx.destination)

    this.source = source
    this.masterGain = gain
    this.currentKind = null
    this.customPlaying = true

    await this.ctx.resume()
    source.start()
  }

  /**
   * 解码一段音频数据。
   *
   * 调用方**不要缓存返回值**：一段 5 分钟的立体声 MP3 解码成 Float32 约 100MB，
   * 缓存几个就足以让低配平板卡死。用完即弃（交给 source 持有），切源后自然可回收。
   */
  async decodeToBuffer(data: ArrayBuffer): Promise<AudioBuffer> {
    return await this.ctx.decodeAudioData(data)
  }

  /** 即时停止（无淡出，用于切源/销毁） */
  stop(): void {
    this.teardownNodes()
  }

  /** 带淡出的停止：淡出后自动停 source 并断开节点，避免占用与爆音 */
  fadeOutAndStop(): void {
    this.clearCrackle()
    if (!this.masterGain || !this.source) {
      this.teardownNodes()
      return
    }
    const now = this.ctx.currentTime
    const gain = this.masterGain
    const src = this.source
    const filters = this.filterChain
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0.0001, now + this.fadeSeconds)
    try {
      src.stop(now + this.fadeSeconds)
    } catch {
      /* 已停止 */
    }
    src.onended = () => {
      try {
        src.disconnect()
      } catch {
        /* noop */
      }
      try {
        gain.disconnect()
      } catch {
        /* noop */
      }
      for (const f of filters) {
        try {
          f.disconnect()
        } catch {
          /* noop */
        }
      }
    }
    this.source = null
    this.masterGain = null
    this.filterChain = []
  }

  /** 调节音量（带短淡变，避免咔哒声） */
  setVolume(v: number): void {
    this.targetVolume = clamp(v, 0, 1)
    if (!this.masterGain) return
    const now = this.ctx.currentTime
    const g = this.masterGain.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(this.targetVolume, now + this.fadeSeconds)
  }

  /** 当前是否正在播放某音源（自定义音频返回 'custom'） */
  get current(): PlayingKind | null {
    return this.customPlaying ? 'custom' : this.currentKind
  }

  /**
   * 销毁：释放全部资源（铁律 #3）。
   * 必须 stop 所有 source、disconnect 所有节点、并 ctx.close()。
   */
  destroy(): void {
    this.teardownNodes()
    void this.ctx.close()
  }

  // ---------- 内部：节点构建 ----------

  private teardownNodes(): void {
    this.clearCrackle()

    // LFO 先停：它们连着 filter 的 frequency，节点断开后再停会报 InvalidStateError
    for (const { osc, gain } of this.lfos) {
      try {
        osc.stop()
      } catch {
        /* 已停止 */
      }
      try {
        osc.disconnect()
      } catch {
        /* noop */
      }
      try {
        gain.disconnect()
      } catch {
        /* noop */
      }
    }
    this.lfos = []
    this.customPlaying = false

    if (this.source) {
      try {
        this.source.stop()
      } catch {
        /* 已停止 */
      }
      try {
        this.source.disconnect()
      } catch {
        /* noop */
      }
      this.source = null
    }
    for (const f of this.filterChain) {
      try {
        f.disconnect()
      } catch {
        /* noop */
      }
    }
    this.filterChain = []
    if (this.masterGain) {
      try {
        this.masterGain.disconnect()
      } catch {
        /* noop */
      }
      this.masterGain = null
    }
  }

  private clearCrackle(): void {
    if (this.crackleTimer !== null) {
      clearTimeout(this.crackleTimer)
      this.crackleTimer = null
    }
  }

  /** 偶发「噼啪」：以一定概率随机扰动增益，模拟篝火噼啪声（仅在 campfire 时调度） */
  private scheduleCrackle(): void {
    this.clearCrackle()
    const tick = (): void => {
      if (!this.masterGain || this.currentKind !== 'campfire') return
      if (Math.random() < 0.5) {
        const now = this.ctx.currentTime
        const base = this.targetVolume
        const spike = base * (1 + Math.random() * 0.6)
        const g = this.masterGain.gain
        g.cancelScheduledValues(now)
        g.setValueAtTime(g.value, now)
        g.linearRampToValueAtTime(spike, now + 0.02)
        g.linearRampToValueAtTime(base, now + 0.12)
      }
      this.crackleTimer = setTimeout(tick, 120 + Math.random() * 380)
    }
    this.crackleTimer = setTimeout(tick, 200 + Math.random() * 400)
  }

  // ---------- 内部：噪音缓冲合成 ----------

  private createBufferFor(kind: NoiseKind): AudioBuffer {
    switch (kind) {
      case 'white':
        return this.createWhiteBuffer()
      case 'pink':
        return this.createPinkBuffer()
      case 'rain':
        // 雨声基于白噪音，靠高通/高频搁架滤波塑造（见 buildFilterChain）
        return this.createWhiteBuffer()
      case 'campfire':
        // 篝火基于棕噪音（低频轰鸣），靠低通滤波塑造
        return this.createBrownBuffer()
      case 'ocean':
        // 海浪 = 棕噪音（浪体的低频能量）+ 低通缓慢游移（见 applyModulation）
        return this.createBrownBuffer()
      case 'stream':
        // 溪流 = 粉红噪音（比白噪音柔）+ 带通，接近"水在石头上"的频谱
        return this.createPinkBuffer()
    }
  }

  /** 白噪音：均匀分布 [-1, 1] */
  private createWhiteBuffer(): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * 2)
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /** 粉红噪音：Paul Kellet 经典滤波法（refined） */
  private createPinkBuffer(): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * 2)
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.969 * b2 + white * 0.153852
      b3 = 0.8665 * b3 + white * 0.3104856
      b4 = 0.55 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.016898
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
      b6 = white * 0.115926
      data[i] = pink * 0.11
    }
    return buffer
  }

  /** 棕噪音（积分白噪音）：低频轰鸣，适合篝火底噪 */
  private createBrownBuffer(): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * 2)
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    return buffer
  }

  /** 按音源类型构建 BiquadFilter 链（返回需按顺序 connect 的节点） */
  private buildFilterChain(kind: NoiseKind): AudioNode[] {
    switch (kind) {
      case 'white':
      case 'pink':
        return [] // 直接用缓冲，无需滤波
      case 'rain': {
        // 高通去掉低频闷响 + 高频搁架增强「沙沙」感
        const hp = this.ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 600
        const shelf = this.ctx.createBiquadFilter()
        shelf.type = 'highshelf'
        shelf.frequency.value = 3000
        shelf.gain.value = 6
        return [hp, shelf]
      }
      case 'campfire': {
        // 低通保留低频轰鸣，滤掉高频嘶声
        const lp = this.ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 500
        return [lp]
      }
      case 'ocean': {
        // 低通压在 520Hz：浪体是"闷"的，留一点高频会变成风噪
        const lp = this.ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 520
        lp.Q.value = 0.9
        return [lp]
      }
      case 'stream': {
        // 高通去掉低频"轰"，带通用 1.1k 附近的水声中频
        const hp = this.ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 380
        const bp = this.ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 1100
        bp.Q.value = 0.7
        return [hp, bp]
      }
    }
  }

  // ---------- 内部：慢速调制（V2.7 · 轨道 B1） ----------

  /**
   * 给静态噪声加"呼吸"。
   *
   * 只动 filter 的 frequency（AudioParam），不动增益结构 ——
   * 这样音量滑块的语义保持不变，任何调制的幅度都相对固定，不会与用户音量叠乘。
   *
   * 老 mock 没有 createOscillator 时直接跳过（本方法对引擎不是必需能力）。
   */
  private applyModulation(kind: NoiseKind, filters: AudioNode[]): void {
    switch (kind) {
      case 'rain':
        // 雨势的轻微起伏：高通截止缓慢游移 ±260Hz
        this.addLfo(filters[0] as BiquadFilterNode, 0.05, 260)
        break
      case 'ocean':
        // 浪涌：0.07Hz ≈ 14 秒一个完整潮汐，接近真实海浪的周期
        this.addLfo(filters[0] as BiquadFilterNode, 0.07, 300)
        break
      case 'stream':
        // 水泡的颤动：带通中心快速小幅晃动
        this.addLfo(filters[1] as BiquadFilterNode, 0.6, 260)
        break
      default:
        break
    }
  }

  /** 把 `freqHz` 的正弦 LFO 以 `depth` 幅度接到某个 AudioParam 上 */
  private addLfo(filter: BiquadFilterNode | undefined, freqHz: number, depth: number): void {
    const param = filter?.frequency
    if (!param || typeof this.ctx.createOscillator !== 'function') return

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freqHz
    gain.gain.value = depth

    osc.connect(gain)
    gain.connect(param)
    osc.start()

    this.lfos.push({ osc, gain })
  }
}
