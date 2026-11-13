// V4.0 · 设计系统：将图标基元注册为全局组件类型，
// 使任意模板可直接使用 <IconBase> 而无需逐文件 import（与 main.ts 的 app.component 注册对应）。
import IconBase from '@/components/ui/IconBase.vue'
import type { vClickable } from '@/core/a11y/clickable'

declare module 'vue' {
  interface GlobalComponents {
    IconBase: typeof IconBase
  }
  interface GlobalDirectives {
    vClickable: typeof vClickable
  }
}
