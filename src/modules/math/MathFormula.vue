<template>
  <AppCard class="math-module-card" title="📐 公式速查">
    <div v-for="kp in knowledgePoints" :key="kp.id" class="formula-item">
      <h4>{{ kp.title }}</h4>
      <div class="latex-content" v-html="renderLatex(kp.content)"></div>
    </div>
  </AppCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import AppCard from '@/components/ui/AppCard.vue'

defineProps<{
  type: string
  knowledgePointIds?: string[]
  data?: any
  packageId: string
}>()

const knowledgePoints = computed(() => {
  return [
    { id: '1', title: '乘法分配律', content: '(a+b) \\times c = a \\times c + b \\times c' }
  ]
})

function renderLatex(text: string) {
  try {
    return katex.renderToString(text, { throwOnError: false })
  } catch (e) {
    return text
  }
}
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.math-module-card { margin-bottom: 16px; }
.formula-item { padding: 12px 0; border-bottom: 1px dashed $border-light; }
.formula-item:last-child { border-bottom: none; }
.latex-content { font-size: 18px; padding: 8px 0; color: $danger-color; }
</style>