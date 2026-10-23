// =====================================================================
// pomodoro · 纯函数番茄钟状态机（V2.2 · 轨道 H）
// ---------------------------------------------------------------------
// 设计铁律（用户明确要求）：
//   后台挂起/休眠时 setInterval 会被掐断，**必须用绝对时间戳**推导 elapsed，
//   **禁止 setInterval 累加**。所有时间函数接收注入的 now()（默认 Date.now）。
//
// 因此本模块完全是纯函数：state 不可变（每次操作返回新 state），
// 剩余时间永远 = duration(phase) - (accumulatedMs + (running ? now - startAt : 0))，
// 与「调用了几次 tick」无关。
// =====================================================================

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'
export type PomodoroStatus = 'idle' | 'running' | 'paused'

export interface PomodoroConfig {
  /** 专注时长（毫秒），默认 25min */
  focusMs?: number
  /** 短休息时长（毫秒），默认 5min */
  shortBreakMs?: number
  /** 长休息时长（毫秒），默认 15min */
  longBreakMs?: number
  /** 每完成多少个专注回合进入一次长休息，默认 4 */
  longBreakInterval?: number
}

export interface PomodoroState {
  config: Required<PomodoroConfig>
  phase: PomodoroPhase
  status: PomodoroStatus
  /** 当前阶段（segment）开始的绝对时间戳；非 running 时为 null */
  startAt: number | null
  /** 本阶段在「上次暂停」之前已累计的毫秒数（用于 pause/resume） */
  accumulatedMs: number
  /** 已完成的专注回合数 */
  completedFocus: number
}

export interface PomodoroProgress {
  /** 本阶段总时长（毫秒） */
  totalMs: number
  /** 本阶段已过毫秒 */
  elapsedMs: number
  /** 本阶段剩余毫秒（下限 0） */
  remainingMs: number
  /** 本阶段是否已结束 */
  isComplete: boolean
}

const DEFAULTS: Required<PomodoroConfig> = {
  focusMs: 25 * 60 * 1000,
  shortBreakMs: 5 * 60 * 1000,
  longBreakMs: 15 * 60 * 1000,
  longBreakInterval: 4,
}

export function createInitialPomodoro(config: PomodoroConfig = {}): PomodoroState {
  return {
    config: {
      focusMs: config.focusMs ?? DEFAULTS.focusMs,
      shortBreakMs: config.shortBreakMs ?? DEFAULTS.shortBreakMs,
      longBreakMs: config.longBreakMs ?? DEFAULTS.longBreakMs,
      longBreakInterval: config.longBreakInterval ?? DEFAULTS.longBreakInterval,
    },
    phase: 'focus',
    status: 'idle',
    startAt: null,
    accumulatedMs: 0,
    completedFocus: 0,
  }
}

function durationOf(state: PomodoroState): number {
  switch (state.phase) {
    case 'focus':
      return state.config.focusMs
    case 'shortBreak':
      return state.config.shortBreakMs
    case 'longBreak':
      return state.config.longBreakMs
  }
}

/**
 * 纯推导：基于绝对时间戳的剩余/已过时间。
 * 不修改 state，可任意多次调用，与 tick 次数无关。
 */
export function computeProgress(state: PomodoroState, now: number): PomodoroProgress {
  const total = durationOf(state)
  const elapsed =
    state.accumulatedMs + (state.status === 'running' && state.startAt !== null ? now - state.startAt : 0)
  const remaining = Math.max(0, total - elapsed)
  return {
    totalMs: total,
    elapsedMs: elapsed,
    remainingMs: remaining,
    isComplete: elapsed >= total,
  }
}

/** 开始/重启当前阶段 */
export function startTimer(state: PomodoroState, now: number): PomodoroState {
  return {
    ...state,
    status: 'running',
    startAt: now,
    accumulatedMs: 0,
  }
}

/** 暂停：把已跑时间并入 accumulatedMs，startAt 置空（暂停期间不再计时） */
export function pauseTimer(state: PomodoroState, now: number): PomodoroState {
  if (state.status !== 'running' || state.startAt === null) return state
  return {
    ...state,
    status: 'paused',
    accumulatedMs: state.accumulatedMs + (now - state.startAt),
    startAt: null,
  }
}

/** 继续：从暂停点恢复，startAt 重置为 now，accumulatedMs 保留 */
export function resumeTimer(state: PomodoroState, now: number): PomodoroState {
  if (state.status !== 'paused') return state
  return {
    ...state,
    status: 'running',
    startAt: now,
  }
}

/**
 * 推进：若当前阶段已结束，则切换到下一阶段（自动开始）。
 * 纯函数：未结束则原样返回（新引用）。
 *   focus 结束 → 完成回合 +1，进入 shortBreak / longBreak（按长休息间隔）
 *   break 结束 → 回到 focus
 */
export function tickTimer(state: PomodoroState, now: number): PomodoroState {
  const p = computeProgress(state, now)
  if (!p.isComplete) return { ...state }

  if (state.phase === 'focus') {
    const completedFocus = state.completedFocus + 1
    const isLong = completedFocus % state.config.longBreakInterval === 0
    return {
      ...state,
      phase: isLong ? 'longBreak' : 'shortBreak',
      status: 'running',
      startAt: now,
      accumulatedMs: 0,
      completedFocus,
    }
  }

  // 休息结束 → 回到专注
  return {
    ...state,
    phase: 'focus',
    status: 'running',
    startAt: now,
    accumulatedMs: 0,
  }
}

/** 重置：回到初始专注态（保留配置），清空已完成的回合 */
export function resetTimer(state: PomodoroState): PomodoroState {
  return createInitialPomodoro(state.config)
}

// ---------- 便捷只读派生 ----------

export function isRunning(state: PomodoroState): boolean {
  return state.status === 'running'
}

export function isPaused(state: PomodoroState): boolean {
  return state.status === 'paused'
}

export function phaseLabel(phase: PomodoroPhase): string {
  switch (phase) {
    case 'focus':
      return '专注'
    case 'shortBreak':
      return '短休息'
    case 'longBreak':
      return '长休息'
  }
}
