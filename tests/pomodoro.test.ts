import { describe, expect, it } from 'vitest'
import {
  computeProgress,
  createInitialPomodoro,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
  tickTimer,
  type PomodoroState,
} from '@core/focus/pomodoro'

const FOCUS = 25 * 60 * 1000
const SHORT = 5 * 60 * 1000
const LONG = 15 * 60 * 1000

describe('pomodoro · 纯函数番茄钟状态机（绝对时间戳）', () => {
  it('后台挂起（now 一次性跳变 +30min）后，剩余/阶段从绝对时间戳推导，而非 tick 累加', () => {
    let s = createInitialPomodoro()
    s = startTimer(s, 0) // 专注在 t=0 开始

    // 模拟后台挂起：setInterval 被掐断，now 直接跳到 +30min（远超 25min 专注）
    const now = FOCUS + 5 * 60 * 1000
    const p = computeProgress(s, now)

    // focus 已完全过去，剩余 0、且判定为结束
    expect(p.remainingMs).toBe(0)
    expect(p.isComplete).toBe(true)

    // tick 自动切换阶段：进入短休息（第 1 个专注回合完成）
    s = tickTimer(s, now)
    expect(s.phase).toBe('shortBreak')
    expect(s.completedFocus).toBe(1)

    // 休息刚开始，剩余应为完整的 5min
    const bp = computeProgress(s, now)
    expect(bp.totalMs).toBe(SHORT)
    expect(bp.remainingMs).toBe(SHORT)

    // ---- 反向验证（注释说明）----
    // 若本模块改用 setInterval 累加 elapsed（例如每 tick +1000ms），
    // 那么 now 跳变 +30min 后，累加器仍停留在「挂起前」的少数几次自增，
    // remaining 不会自动修正为 0，isComplete 仍为 false，上面的断言会失败。
    // 即：本测试能抓住「用 setInterval 累加」的回归。
  })

  it('pause / resume 保持绝对计时（暂停期间不计时）', () => {
    let s = createInitialPomodoro()
    s = startTimer(s, 0)
    s = pauseTimer(s, 10 * 60 * 1000) // 跑了 10min 后暂停

    // 暂停期间 5min 流逝（如后台挂起），now 跳到 15min
    let p = computeProgress(s, 15 * 60 * 1000)
    expect(p.remainingMs).toBe(FOCUS - 10 * 60 * 1000) // 仍剩 15min（暂停不计时）

    s = resumeTimer(s, 15 * 60 * 1000)
    p = computeProgress(s, 16 * 60 * 1000) // 继续跑 1min
    expect(p.remainingMs).toBe(FOCUS - 11 * 60 * 1000)

    // 二次暂停再恢复，累计仍正确
    s = pauseTimer(s, 20 * 60 * 1000)
    s = resumeTimer(s, 25 * 60 * 1000)
    p = computeProgress(s, 26 * 60 * 1000)
    expect(p.remainingMs).toBe(FOCUS - 16 * 60 * 1000)
  })

  it('短休息 / 长休息切换与长休息计数（每 4 个专注回合一次长休息）', () => {
    let s = createInitialPomodoro({ longBreakInterval: 4 })
    let t = 0

    for (let round = 1; round <= 4; round++) {
      s = startTimer(s, t)
      t += FOCUS + 1000 // 专注结束
      expect(computeProgress(s, t).isComplete).toBe(true)
      s = tickTimer(s, t) // → 休息
      expect(s.phase).toBe(round % 4 === 0 ? 'longBreak' : 'shortBreak')

      // 完成休息
      t += (round % 4 === 0 ? LONG : SHORT) + 1000
      s = tickTimer(s, t) // → 回到专注
      expect(s.phase).toBe('focus')
    }

    expect(s.completedFocus).toBe(4)
    // 第 4 回合后是长休息；前 3 回合是短休息（已在循环内断言）
  })

  it('reset 回到初始专注态并清空已完成回合', () => {
    let s = createInitialPomodoro()
    s = startTimer(s, 0)
    s = tickTimer(s, FOCUS + 1000) // 完成 1 个专注回合
    expect(s.completedFocus).toBe(1)
    expect(s.phase).toBe('shortBreak')

    s = resetTimer(s)
    expect(s.phase).toBe('focus')
    expect(s.completedFocus).toBe(0)
    expect(s.status).toBe('idle')
  })

  it('start 后未到时，isComplete 为 false 且剩余随 now 单调变化', () => {
    let s: PomodoroState = createInitialPomodoro()
    s = startTimer(s, 1000)
    expect(computeProgress(s, 1000 + 60 * 1000).remainingMs).toBe(FOCUS - 60 * 1000)
    expect(computeProgress(s, 1000 + 60 * 1000).isComplete).toBe(false)
  })
})
