import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, isAudioSuppressed } from '@core/feedback/AudioEngine'
import {
  HAPTIC_PATTERNS,
  isHapticsSupported,
  vibrate,
} from '@core/feedback/haptics'
import {
  DEFAULT_FEEDBACK_PREFERENCES,
  normalizeFeedbackPreferences,
} from '@core/feedback/feedbackSettings'

// ---------------------------------------------------------------------
// 轻量 mock AudioContext：只实现 AudioEngine 真正调用的 API，并记录调用次数，
// 便于断言「有没有建节点 / 用了什么波形 / 有没有 resume / 有没有 close」。
// 不追求行为仿真——音频是否"好听"不归单测管。
// ---------------------------------------------------------------------
function createMockAudioContext() {
  const calls = { resume: 0, close: 0 }
  const oscillators: any[] = []
  const gains: any[] = []
  const filters: any[] = []

  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  })

  const ctx: any = {
    currentTime: 0,
    state: 'suspended',
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
    createOscillator: vi.fn(() => {
      const osc = {
        type: 'sine',
        frequency: makeParam(440),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(osc)
      return osc
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: makeParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      gains.push(gain)
      return gain
    }),
    createBiquadFilter: vi.fn(() => {
      const filter = {
        type: 'lowpass',
        frequency: makeParam(350),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      filters.push(filter)
      return filter
    }),
  }

  return { ctx, calls, oscillators, gains, filters }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// =====================================================================
// AudioEngine
// =====================================================================

describe('AudioEngine · 环境静音判定', () => {
  it('webdriver=true 视为自动化环境，必须静音', () => {
    vi.stubGlobal('navigator', { webdriver: true })
    expect(isAudioSuppressed()).toBe(true)
  })

  it('普通浏览器环境不静音', () => {
    vi.stubGlobal('navigator', { webdriver: false })
    expect(isAudioSuppressed()).toBe(false)
  })

  it('无 navigator（纯 Node）时判定为需静音', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isAudioSuppressed()).toBe(true)
  })
})

describe('AudioEngine · 惰性创建与静音短路', () => {
  it('静音时完全不去碰 AudioContext（连工厂都不调用）', () => {
    const factory = vi.fn(() => createMockAudioContext().ctx)
    const engine = new AudioEngine({ context: factory, muted: true })
    engine.playCorrect()
    engine.playWrong()
    engine.playClick()
    expect(factory).not.toHaveBeenCalled()
  })

  it('未静音时首次播放才创建 ctx，且同一实例复用', () => {
    const factory = vi.fn(() => createMockAudioContext().ctx)
    const engine = new AudioEngine({ context: factory, muted: false })
    engine.playCorrect()
    engine.playCorrect()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('ctx 处于 suspended 时播放前会 resume', () => {
    const mock = createMockAudioContext()
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    engine.playCorrect()
    expect(mock.calls.resume).toBe(1)
  })

  it('setMuted 可在运行期切换（设置页改开关）', () => {
    const mock = createMockAudioContext()
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    engine.setMuted(true)
    expect(engine.isMuted).toBe(true)
    engine.playCorrect()
    expect(mock.oscillators).toHaveLength(0)

    engine.setMuted(false)
    engine.playCorrect()
    expect(mock.oscillators).toHaveLength(1)
  })
})

describe('AudioEngine · 三种音效的合成特征', () => {
  it('答对用 Sine 上行（880 → 1320）', () => {
    const mock = createMockAudioContext()
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    engine.playCorrect()

    expect(mock.oscillators).toHaveLength(1)
    const osc = mock.oscillators[0]
    expect(osc.type).toBe('sine')
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(880, expect.any(Number))
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      1320,
      expect.any(Number),
    )
    expect(osc.start).toHaveBeenCalled()
    expect(osc.stop).toHaveBeenCalled()
  })

  it('答错用 Triangle 下行（196 → 146）并接低通滤波', () => {
    const mock = createMockAudioContext()
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    engine.playWrong()

    const osc = mock.oscillators[0]
    expect(osc.type).toBe('triangle')
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(196, expect.any(Number))
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      146,
      expect.any(Number),
    )
    // 低通是「不刺耳」的关键：必须有
    expect(mock.filters).toHaveLength(1)
    expect(mock.filters[0].type).toBe('lowpass')
    expect(mock.filters[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      900,
      expect.any(Number),
    )
  })

  it('点击音用 Square 且不滑音', () => {
    const mock = createMockAudioContext()
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    engine.playClick()

    const osc = mock.oscillators[0]
    expect(osc.type).toBe('square')
    // 起止同频 → 不调用滑音
    expect(osc.frequency.exponentialRampToValueAtTime).not.toHaveBeenCalled()
    // 点击音不接滤波器
    expect(mock.filters).toHaveLength(0)
  })

  it('包络从极小正数起跳（exponentialRamp 不能从 0 开始）', () => {
    const mock = createMockAudioContext()
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    engine.playCorrect()

    const gain = mock.gains[0]
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, expect.any(Number))
    const peak = gain.gain.exponentialRampToValueAtTime.mock.calls[0][0]
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(1)
  })
})

describe('AudioEngine · 容错', () => {
  it('构造 ctx 抛错时不向外抛，且不反复重试', () => {
    const factory = vi.fn(() => {
      throw new Error('no audio device')
    })
    const engine = new AudioEngine({ context: factory as any, muted: false })
    expect(() => engine.playCorrect()).not.toThrow()
    expect(() => engine.playWrong()).not.toThrow()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('节点创建中途抛错也被吞掉', () => {
    const mock = createMockAudioContext()
    mock.ctx.createOscillator = vi.fn(() => {
      throw new Error('boom')
    })
    const engine = new AudioEngine({ context: mock.ctx, muted: false })
    expect(() => engine.playCorrect()).not.toThrow()
  })

  it('destroy 会 close 并允许重新创建', () => {
    const first = createMockAudioContext()
    const factory = vi.fn(() => first.ctx)
    const engine = new AudioEngine({ context: factory, muted: false })
    engine.playCorrect()
    engine.destroy()
    expect(first.calls.close).toBe(1)

    engine.playCorrect()
    expect(factory).toHaveBeenCalledTimes(2)
  })
})

// =====================================================================
// haptics
// =====================================================================

describe('haptics · 能力探测与调用', () => {
  it('无 vibrate API（Windows WebView2 / 桌面）时静默返回 false', () => {
    vi.stubGlobal('navigator', { webdriver: false })
    expect(isHapticsSupported()).toBe(false)
    expect(vibrate('correct')).toBe(false)
  })

  it('支持时按下发预设节奏', () => {
    const v = vi.fn(() => true)
    vi.stubGlobal('navigator', { webdriver: false, vibrate: v })

    expect(isHapticsSupported()).toBe(true)
    expect(vibrate('correct')).toBe(true)
    expect(v).toHaveBeenCalledWith(20)

    vibrate('wrong')
    expect(v).toHaveBeenCalledWith([50, 50, 50])
  })

  it('设置里关掉震动（muted）时不调用', () => {
    const v = vi.fn(() => true)
    vi.stubGlobal('navigator', { webdriver: false, vibrate: v })
    expect(vibrate('correct', true)).toBe(false)
    expect(v).not.toHaveBeenCalled()
  })

  it('自动化环境不调用（保证 e2e 行为确定）', () => {
    const v = vi.fn(() => true)
    vi.stubGlobal('navigator', { webdriver: true, vibrate: v })
    expect(vibrate('correct')).toBe(false)
    expect(v).not.toHaveBeenCalled()
  })

  it('vibrate 抛错时静默', () => {
    vi.stubGlobal('navigator', {
      webdriver: false,
      vibrate: () => {
        throw new Error('not allowed')
      },
    })
    expect(() => vibrate('wrong')).not.toThrow()
    expect(vibrate('wrong')).toBe(false)
  })

  it('预设节奏与产品约定一致', () => {
    expect(HAPTIC_PATTERNS.correct).toBe(20)
    expect(HAPTIC_PATTERNS.wrong).toEqual([50, 50, 50])
  })
})

// =====================================================================
// feedbackSettings · 归一化
// =====================================================================

describe('feedbackSettings · 归一化兜底', () => {
  it('脏数据回落到默认值（默认全开）', () => {
    expect(normalizeFeedbackPreferences(null)).toEqual(DEFAULT_FEEDBACK_PREFERENCES)
    expect(normalizeFeedbackPreferences('x')).toEqual(DEFAULT_FEEDBACK_PREFERENCES)
    expect(normalizeFeedbackPreferences({ sound: 'yes' })).toEqual(DEFAULT_FEEDBACK_PREFERENCES)
  })

  it('保留合法布尔值，缺字段各自回落', () => {
    expect(normalizeFeedbackPreferences({ sound: false })).toEqual({
      sound: false,
      haptics: true,
    })
    expect(normalizeFeedbackPreferences({ sound: false, haptics: false })).toEqual({
      sound: false,
      haptics: false,
    })
  })
})
