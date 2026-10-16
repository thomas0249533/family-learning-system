import { defineStore } from 'pinia'
import { ref, computed, watch, watchEffect } from 'vue'
import type { ThemePreset } from '@core/styles/palette'
import { inferPreset, type GradeSource } from '@core/theme/presetInference'

export type FontSize = 'small' | 'medium' | 'large'
export type ThemeModePreference = 'light' | 'dark' | 'system'

/** localStorage 键（与 index.html 内联防 FOUC 脚本共用同一 schema）。 */
const STORAGE_KEY = 'fls:theme'

interface PersistedTheme {
  preset: ThemePreset
  mode: ThemeModePreference
  fontSize: FontSize
  presetManual: boolean
}

const PRESET_VALUES: ThemePreset[] = ['primary', 'junior', 'senior']
const MODE_VALUES: ThemeModePreference[] = ['light', 'dark', 'system']
const SIZE_VALUES: FontSize[] = ['small', 'medium', 'large']

const DEFAULTS: PersistedTheme = {
  preset: 'junior',
  mode: 'light',
  fontSize: 'medium',
  presetManual: false,
}

/** 依据明暗偏好解析是否深色（system 走 prefers-color-scheme）。 */
export function resolveDark(mode: ThemeModePreference): boolean {
  if (mode === 'system') {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return mode === 'dark'
}

/** 从 localStorage 同步读取并逐字段校验枚举；非法即回默认。 */
function loadPersisted(): PersistedTheme {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const obj = JSON.parse(raw) as Partial<PersistedTheme>
    return {
      preset: PRESET_VALUES.includes(obj?.preset as ThemePreset) ? (obj!.preset as ThemePreset) : DEFAULTS.preset,
      mode: MODE_VALUES.includes(obj?.mode as ThemeModePreference) ? (obj!.mode as ThemeModePreference) : DEFAULTS.mode,
      fontSize: SIZE_VALUES.includes(obj?.fontSize as FontSize) ? (obj!.fontSize as FontSize) : DEFAULTS.fontSize,
      presetManual: typeof obj?.presetManual === 'boolean' ? obj.presetManual : DEFAULTS.presetManual,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export const useThemeStore = defineStore('theme', () => {
  const initial = loadPersisted()

  const themeMode = ref<ThemeModePreference>(initial.mode)
  const fontSize = ref<FontSize>(initial.fontSize)
  const preset = ref<ThemePreset>(initial.preset)
  /** 家长是否手动覆盖过学段预设（true 后永久停止自动推荐） */
  const presetManual = ref<boolean>(initial.presetManual)

  // 计算实际生效的明暗（处理 system 模式）
  const actualTheme = computed<'light' | 'dark'>(() => {
    if (themeMode.value === 'system') {
      return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    return themeMode.value
  })

  // 同步 state 到 body：深色 class + 学段属性（供 theme.scss 的 6 组选择器命中）
  watchEffect(() => {
    if (typeof document === 'undefined') return
    document.body.classList.toggle('dark-mode', actualTheme.value === 'dark')
    document.body.dataset.themePreset = preset.value
    // B1：不再写 documentElement.style.fontSize（改为 naive-ui themeOverrides 单一缩放源）
  })

  // 持久化：任一字段变化同步回写（写「原始意图值」，mode 存 system 而非解析值）
  watch(
    [themeMode, fontSize, preset, presetManual],
    () => {
      if (typeof localStorage === 'undefined') return
      try {
        const data: PersistedTheme = {
          preset: preset.value,
          mode: themeMode.value,
          fontSize: fontSize.value,
          presetManual: presetManual.value,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        /* 存储不可用时静默 */
      }
    },
  )

  function setTheme(mode: ThemeModePreference) {
    themeMode.value = mode
  }

  function setFontSize(size: FontSize) {
    fontSize.value = size
  }

  /**
   * 设置学段预设。
   * @param value  目标预设
   * @param manual 是否视为「家长手动选择」（true 时标记 presetManual，停止自动推荐）
   */
  function setPreset(value: ThemePreset, manual: boolean = true) {
    preset.value = value
    if (manual) presetManual.value = true
  }

  /** 恢复自动推荐（置回 presetManual=false），并可选地立即重新推断。 */
  function restoreAuto(sources: GradeSource[] = []) {
    presetManual.value = false
    reconcilePreset(sources)
  }

  /**
   * 编排：仅当 presetManual===false 时，用学习包年级推断结果应用预设。
   * 数据源：packageStore.packages[].manifest（grade / updatedAt / createdAt）。
   */
  function reconcilePreset(sources: GradeSource[]) {
    if (presetManual.value) return
    const inferred = inferPreset(sources)
    setPreset(inferred.preset, false)
  }

  return {
    themeMode,
    fontSize,
    preset,
    presetManual,
    actualTheme,
    setTheme,
    setFontSize,
    setPreset,
    restoreAuto,
    reconcilePreset,
    resolveDark,
  }
})
