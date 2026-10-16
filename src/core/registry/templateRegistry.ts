import type { Component } from 'vue'
import { registerModule } from './moduleRegistry' // ✅ 新增导入

export interface TemplateConfig {
  id: string
  subject: string
  name: string
  moduleTypes: Record<string, Component>
}

const templateRegistry = new Map<string, TemplateConfig>()

export function registerTemplate(config: TemplateConfig) {
  templateRegistry.set(config.id, config)
  
  // ✅ 核心修复：将模板中的模块组件，自动注册到全局模块注册表！
  Object.entries(config.moduleTypes).forEach(([type, component]) => {
    if (component) { // 防止空值
      registerModule(type, component)
    }
  })
}

export function getTemplateConfig(templateId: string): TemplateConfig | undefined {
  return templateRegistry.get(templateId)
}