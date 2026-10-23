import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 纯 UI 运行时状态 · 沉浸式专注模式（V2.1 · Stage H）
 * ---------------------------------------------------------------------
 * 仅控制「做题时是否隐藏布局外壳（侧栏 / 顶栏 / 底部 tab）」，**不落盘**、
 * **不动任何数据库**（H 铁律：纯前端、零依赖）。
 *
 * 生命周期铁律（用户明确要求）：
 *   · 初始值必须是 false（普通页面）；
 *   · 离开练习页（TopicDetail 卸载）必须重置为 false，否则用户回首页会发现
 *     侧边栏没了、疑似"全局黑屏"。
 * 因此本 store 不做持久化，重置由 AppShell（Esc / 退出全屏）与 TopicDetail
 * （onUnmounted）负责。
 */
export const useUiStore = defineStore('ui', () => {
  const isFocusMode = ref(false)

  function enterFocus(): void {
    isFocusMode.value = true
  }

  function exitFocus(): void {
    isFocusMode.value = false
  }

  function toggleFocus(): void {
    isFocusMode.value = !isFocusMode.value
  }

  return { isFocusMode, enterFocus, exitFocus, toggleFocus }
})
