import { type Component, markRaw } from 'vue'
import UnknownModule from '@modules/core/UnknownModule.vue'

export interface ModuleProps {
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}

const moduleRegistry = new Map<string, Component>()

/**
 * 注册单个模块
 * 幂等：同类型重复注册时静默跳过，不再警告
 */
export function registerModule(type: string, component: Component) {
  if (moduleRegistry.has(type)) return
  moduleRegistry.set(type, markRaw(component))
}

export function getModuleComponent(type: string): Component {
  const c = moduleRegistry.get(type)
  if (!c) {
    console.warn(`[ModuleRegistry] 未找到模块类型 "${type}"，已降级显示。`)
    return UnknownModule
  }
  return c
}

export function listRegisteredModules(): string[] {
  return Array.from(moduleRegistry.keys())
}