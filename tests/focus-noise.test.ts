import { describe, expect, it, vi } from 'vitest'
import { NoiseGenerator } from '@core/focus/NoiseGenerator'

// ---------------------------------------------------------------------
// 轻量 mock AudioContext：只实现本引擎用到的 API，并记录调用，便于断言。
// 覆盖的方法：createBufferSource / createBiquadFilter / createGain /
// createBuffer / destination / currentTime / state / resume / close。
// 每个被创建的节点都暴露 connect / disconnect / start / stop 等可断言方法。
// ---------------------------------------------------------------------
function createMockAudioContext() {
  const calls = { resume: 0, close: 0, decode: 0 }
  const sources: any[] = []
  const gains: any[] = []
  const filters: any[] = []
  const buffers: any[] = []
  /** V2.7 起音源叠加了慢速 LFO：必须能被断言"有没有建、有没有停" */
  const oscillators: any[] = []

  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  })

  const ctx: any = {
    currentTime: 0,
    state: 'suspended',
    sampleRate: 44100,
    destination: { connect: vi.fn(), disconnect: vi.fn() },
    resume: vi.fn(() => {
      calls.resume++
      ctx.state = 'running'
      return Promise.resolve()
    }),
    close: vi.fn(() => {
      calls.close++
      return Promise.resolve()
    }),
    createBuffer: vi.fn((ch: number, len: number) => {
      const buf = {
        numberOfChannels: ch,
        length: len,
        sampleRate: 44100,
        getChannelData: vi.fn(() => new Float32Array(len)),
      }
      buffers.push(buf)
      return buf
    }),
    createBufferSource: vi.fn(() => {
      const s = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as any,
      }
      sources.push(s)
      return s
    }),
    createBiquadFilter: vi.fn(() => {
      const f = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        type: '',
        frequency: makeParam(),
        Q: makeParam(),
        gain: makeParam(),
      }
      filters.push(f)
      return f
    }),
    createGain: vi.fn(() => {
      const g = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: makeParam(),
      }
      gains.push(g)
      return g
    }),
    createOscillator: vi.fn(() => {
      const o = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        type: '',
        frequency: makeParam(),
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(o)
      return o
    }),
    decodeAudioData: vi.fn(async () => {
      calls.decode++
      return { duration: 1, length: 44100, numberOfChannels: 1, sampleRate: 44100 }
    }),
  }

  return {
    ctx: ctx as unknown as AudioContext,
    calls,
    sources,
    gains,
    filters,
    buffers,
    oscillators,
  }
}

describe('NoiseGenerator · Web Audio 实时合成', () => {
  it('start("rain") 创建 source+filter+gain、正确 connect、gain 淡入 ramp、并 resume()', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx, fadeSeconds: 0.8, volume: 0.6 })

    await gen.start('rain')

    // rain 用白噪音缓冲（1 个 buffer）+ 2 个 filter（highpass + highshelf）
    // + 2 个 gain：主增益（音量/淡入）+ LFO 深度增益（V2.7 起雨势会缓慢起伏）
    expect(mock.buffers.length).toBe(1)
    expect(mock.sources.length).toBe(1)
    expect(mock.filters.length).toBe(2)
    expect(mock.gains.length).toBe(2)
    // gains[0] 才是主增益：LFO 的深度增益只用 .value，不做 ramp（见下方 ramp 断言）
    expect(mock.oscillators.length).toBe(1)

    // 连接链存在：source/filter/gain 都至少 connect 了一次（连到下一个节点或 destination）
    expect(mock.sources[0].connect).toHaveBeenCalled()
    expect(mock.filters[0].connect).toHaveBeenCalled()
    expect(mock.filters[1].connect).toHaveBeenCalled()
    expect(mock.gains[0].connect).toHaveBeenCalled()

    // 淡入 ramp：gain 调用了 linearRampToValueAtTime，且参数 = (目标音量 0.6, 起始时刻 + fade 0.8)
    const ramp = mock.gains[0].gain.linearRampToValueAtTime as any
    expect(ramp).toHaveBeenCalled()
    const args = ramp.mock.calls[0]
    expect(args[0]).toBeCloseTo(0.6, 5)
    expect(args[1]).toBeCloseTo(0.8, 5)

    // 铁律 #2：必须在用户点击时 resume()，否则 suspended 状态下无声
    expect(mock.calls.resume).toBe(1)
  })

  it('destroy() 必须 stop() + disconnect() + close()（内存泄漏守卫）', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.start('rain')

    gen.destroy()

    // source 被 stop 并 disconnect
    expect(mock.sources[0].stop).toHaveBeenCalled()
    expect(mock.sources[0].disconnect).toHaveBeenCalled()
    // gain 被 disconnect
    expect(mock.gains[0].disconnect).toHaveBeenCalled()
    // 关键：ctx.close 被调用 —— 否则退出专注模式 AudioContext 永不释放，内存泄漏
    expect(mock.calls.close).toBe(1)

    // ---- 反向验证（注释说明）----
    // 如果有人把 destroy() 里的 `void this.ctx.close()` 删掉，
    // 上面的 `expect(mock.calls.close).toBe(1)` 会失败（变为 0）。
    // 这条断言就是「内存泄漏守卫」：AudioContext 不显式 close 永远不会被 GC，
    // 反复进出专注模式会累积泄漏。
  })

  it('切换音源会先停掉旧 source（不叠加多个 source）', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.start('rain')
    await gen.start('campfire')

    // 第二次 start 前 teardownNodes 会 stop 掉第一个 source
    expect(mock.sources[0].stop).toHaveBeenCalled()
    // 当前只有 1 个活跃 source（campfire 那条）
    expect(mock.sources.length).toBe(2)
    expect(gen.current).toBe('campfire')
  })
})

// =====================================================================
// V2.7 · 轨道 B1：调制（让噪声"有呼吸"）与本地音频播放
// =====================================================================
describe('NoiseGenerator · V2.7 精细合成', () => {
  it('海浪 = 棕噪音 + 低通 + 1 个慢速 LFO，且 LFO 接到 filter.frequency 上', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.start('ocean')

    expect(mock.sources.length).toBe(1)
    expect(mock.filters.length).toBe(1)
    // LFO = 1 个 Oscillator + 1 个 Gain（Gain 用来把 ±1 的振荡缩放到 ±300Hz）
    expect(mock.oscillators.length).toBe(1)
    expect(mock.oscillators[0].start).toHaveBeenCalled()

    const lfo = mock.oscillators[0]
    expect(lfo.connect).toHaveBeenCalled()
    // 低频（<1Hz）：人耳听不到振荡本身，只听到"浪涌"
    expect(lfo.frequency.value).toBeLessThan(1)
  })

  it('溪流 = 粉噪音 + 高通/带通两级滤波 + LFO', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.start('stream')

    expect(mock.filters.length).toBe(2)
    expect(mock.filters[1].type).toBe('bandpass')
    expect(mock.oscillators.length).toBe(1)
  })

  it('纯白/粉噪不加调制（不需要 LFO 就不该占 CPU）', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.start('white')
    expect(mock.oscillators.length).toBe(0)
  })

  it('切源与销毁都必须停掉 LFO（否则振荡器一直跑，CPU 空转）', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.start('ocean')
    await gen.start('ocean') // 切源 → teardown 上一组

    expect(mock.oscillators[0].stop).toHaveBeenCalled()
    expect(mock.oscillators[0].disconnect).toHaveBeenCalled()

    const last = mock.oscillators[mock.oscillators.length - 1]
    gen.destroy()
    expect(last.stop).toHaveBeenCalled()
    expect(last.disconnect).toHaveBeenCalled()
  })

  it('startBuffer 播放用户音频：loop + 淡入 + resume，current 报 "custom"', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx, fadeSeconds: 0.5, volume: 0.4 })

    const buf = { duration: 3 } as unknown as AudioBuffer
    await gen.startBuffer(buf, { volume: 0.4 })

    expect(mock.sources.length).toBe(1)
    expect(mock.sources[0].buffer).toBe(buf)
    expect(mock.sources[0].loop).toBe(true)
    expect(mock.sources[0].start).toHaveBeenCalled()
    // 用户点"播放"才 resume（浏览器自动播放策略）
    expect(mock.calls.resume).toBe(1)

    const ramp = mock.gains[0].gain.linearRampToValueAtTime as any
    expect(ramp.mock.calls[0][0]).toBeCloseTo(0.4, 5)
    expect(ramp.mock.calls[0][1]).toBeCloseTo(0.5, 5)

    expect(gen.current).toBe('custom')
  })

  it('从自定义音频切回合成噪音：current 立刻回到该音源', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    await gen.startBuffer({ duration: 1 } as unknown as AudioBuffer)
    expect(gen.current).toBe('custom')

    await gen.start('rain')
    expect(gen.current).toBe('rain')
  })

  it('decodeToBuffer 走 ctx.decodeAudioData（不自己造 PCM）', async () => {
    const mock = createMockAudioContext()
    const gen = new NoiseGenerator({ context: mock.ctx })

    const out = await gen.decodeToBuffer(new ArrayBuffer(8))
    expect(mock.calls.decode).toBe(1)
    expect(out).toBeTruthy()
  })
})
