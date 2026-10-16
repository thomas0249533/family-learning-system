<template>
  <n-card class="math-module-card" title="📐 公式速查">
    <div v-for="kp in knowledgePoints" :key="kp.id" class="formula-item">
      <h4>{{ kp.title }}</h4>
      <div class="latex-content" v-html="renderLatex(kp.content)"></div>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCard } from 'naive-ui'
import katex from 'katex'
import 'katex/dist/katex.min.css'

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
.math-module-card { margin-bottom: 16px; border-radius: 14px; box-shadow: $shadow-sm; }
.formula-item { padding: 12px 0; border-bottom: 1px dashed $border-light; }
.formula-item:last-child { border-bottom: none; }
.latex-content { font-size: 18px; padding: 8px 0; color: $danger-color; }
</style>