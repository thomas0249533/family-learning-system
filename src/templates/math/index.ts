import { registerTemplate } from '@/core/registry/templateRegistry'

// 导入数学模块组件（请确保这几个文件已存在）
import MathFormula from '@modules/math/MathFormula.vue'
import MathLife from '@modules/math/MathLife.vue'
import MathConcept from '@modules/math/MathConcept.vue'

export function registerMathTemplate() {
  registerTemplate({
    id: 'math.primary.v1',
    subject: 'math',
    name: '小学数学模板 V1',
    moduleTypes: {
      'math.formula': MathFormula, // 公式速查
      'math.concept': MathConcept, // 概念精讲
      'math.life': MathLife,       // 生活应用
      'math.unknown': null as any  // 故意留空测试降级，或者不写这行
    }
  })
}